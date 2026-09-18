import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseWorkflow } from '../api/index.js';
import type { TWorkflowAST } from '../ast/types.js';
import type { ContinuationEnvelope, DurableGateKind } from '../runtime/continuation.js';
import type { EffectAdapter } from '../runtime/durable-execution.js';
import { executeWorkflow, type WorkflowExecutionOutcome } from '../mcp/workflow-executor.js';
import { computeBundleDigest } from './bundle-digest.js';
import { labelGate } from './gate-labeling.js';
import { buildGateResolution, type ResolveInput } from './gate-resolution.js';

/**
 * A local, single-machine durable-run coordinator.
 *
 * The engine returns a terminal `yielded` outcome and keeps nothing
 * (`docs/stitch-a2-continuation.md`, "Coordinator"). Somebody has to hold
 * the continuation between the yield and the resume, own run identity, vouch
 * for the bundle, and record effect receipts. Stitch's distributed
 * coordinator is not part of this repository; this one is the smallest thing
 * that meets the same obligations for one developer on one machine, so an
 * assistant driving a workflow over MCP sees `{ runId, gate }` instead of a
 * multi-kilobyte envelope it would have to carry and hand back verbatim.
 *
 * It knows nothing about MCP. `src/mcp/tools-run.ts` is the only caller.
 */

export interface StartRequest {
  filePath: string;
  workflowName?: string;
  params?: Record<string, unknown>;
}

export interface ResumeRequest {
  runId: string;
  input: ResolveInput;
}

/** What a driver is shown. Deliberately the minimum. */
export interface RunView {
  status: 'waiting' | 'completed' | 'failed';
  runId: string;
  workflowName: string;
  gate?: {
    kind: DurableGateKind;
    node: string;
    inputs: Record<string, unknown>;
    absent: string[];
  };
  result?: unknown;
  error?: string;
}

export interface RunSummary {
  status: RunView['status'];
  runId: string;
  workflowName: string;
  filePath: string;
  gate?: { kind: DurableGateKind; node: string };
  updatedAt: string;
}

export interface LocalCoordinator {
  start(request: StartRequest): Promise<RunView>;
  resume(request: ResumeRequest): Promise<RunView>;
  get(runId: string): RunView | undefined;
  list(filter?: { filePath?: string }): RunSummary[];
}

/** Everything persisted about one run. `continuation.json` sits beside it. */
interface RunRecord {
  formatVersion: 1;
  runId: string;
  filePath: string;
  workflowName: string;
  params: Record<string, unknown>;
  bundleDigest: string;
  status: RunView['status'];
  gate?: {
    id: string;
    kind: DurableGateKind;
    node: string;
    nodeType: string;
    inputs: Record<string, unknown>;
    absent: string[];
    outputs: string[];
    hasSuccessPort: boolean;
    hasFailurePort: boolean;
  };
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export class ParseError extends Error {
  readonly name = 'ParseError';
}
export class AmbiguousWorkflowError extends Error {
  readonly name = 'AmbiguousWorkflowError';
  constructor(readonly names: readonly string[]) {
    super(`file declares several workflows; pass workflowName: ${names.join(', ')}`);
  }
}
export class RunNotFoundError extends Error {
  readonly name = 'RunNotFoundError';
  constructor(runId: string) {
    super(`no run with id ${runId}`);
  }
}
export class RunNotWaitingError extends Error {
  readonly name = 'RunNotWaitingError';
  constructor(readonly status: RunView['status']) {
    super(`run is ${status}, not waiting at a gate`);
  }
}
export class BundleChangedError extends Error {
  readonly name = 'BundleChangedError';
  constructor() {
    super('workflow or its compiled output changed since the run paused; start a new run');
  }
}

export function defaultRunsDir(): string {
  return process.env.FW_RUNS_DIR ?? path.join(os.homedir(), '.fw', 'runs');
}

export function createLocalCoordinator(options: { rootDir?: string } = {}): LocalCoordinator {
  const rootDir = options.rootDir ?? defaultRunsDir();
  const runDir = (runId: string) => path.join(rootDir, runId);
  const recordFile = (runId: string) => path.join(runDir(runId), 'run.json');
  const continuationFile = (runId: string) => path.join(runDir(runId), 'continuation.json');

  function readRecord(runId: string): RunRecord | undefined {
    const file = recordFile(runId);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RunRecord;
  }

  /**
   * Commit an outcome. `continuation.json` lands first, then `run.json`;
   * the rename of `run.json` is the atomic commit point. A run directory
   * without `run.json` is an unacknowledged yield and is ignored everywhere.
   */
  function commit(record: RunRecord, outcome: WorkflowExecutionOutcome, ast: TWorkflowAST): RunRecord {
    const now = new Date().toISOString();
    const dir = runDir(record.runId);
    fs.mkdirSync(dir, { recursive: true });

    if (outcome.kind === 'yielded') {
      const labeled = labelGate(outcome.gate, ast);
      writeAtomic(continuationFile(record.runId), JSON.stringify(outcome.continuation));
      const next: RunRecord = {
        ...record,
        status: 'waiting',
        gate: {
          id: outcome.gate.id,
          kind: outcome.gate.kind,
          node: outcome.gate.address.nodeId,
          nodeType: outcome.gate.address.nodeType,
          ...labeled,
        },
        result: undefined,
        error: undefined,
        updatedAt: now,
      };
      writeAtomic(recordFile(record.runId), JSON.stringify(next));
      return next;
    }

    const next: RunRecord = {
      ...record,
      status: 'completed',
      gate: undefined,
      result: outcome.result,
      error: undefined,
      updatedAt: now,
    };
    writeAtomic(recordFile(record.runId), JSON.stringify(next));
    fs.rmSync(continuationFile(record.runId), { force: true });
    return next;
  }

  function fail(record: RunRecord, error: unknown): void {
    const dir = runDir(record.runId);
    fs.mkdirSync(dir, { recursive: true });
    const message = error instanceof Error ? error.message : String(error);
    writeAtomic(
      recordFile(record.runId),
      JSON.stringify({
        ...record,
        status: 'failed',
        gate: undefined,
        result: undefined,
        error: message,
        updatedAt: new Date().toISOString(),
      } satisfies RunRecord),
    );
  }

  async function parseSelected(
    filePath: string,
    requested: string | undefined,
  ): Promise<{ ast: TWorkflowAST; workflowName: string }> {
    const projectDir = path.dirname(filePath);
    const first = await parseWorkflow(filePath, { workflowName: requested, projectDir });
    if (first.errors.length > 0) throw new ParseError(first.errors.join('\n'));

    // The engine silently runs the first workflow in a file
    // (`workflow-executor.ts:210-212`). A driver cannot see which one it got,
    // so ambiguity is refused here instead.
    const available = first.availableWorkflows;
    let workflowName = requested;
    if (workflowName === undefined) {
      if (available.length === 1) workflowName = available[0];
      else throw new AmbiguousWorkflowError(available);
    } else if (!available.includes(workflowName)) {
      throw new ParseError(`workflow ${workflowName} not found; available: ${available.join(', ')}`);
    }

    if (first.ast.functionName === workflowName) return { ast: first.ast, workflowName };
    const second = await parseWorkflow(filePath, { workflowName, projectDir });
    if (second.errors.length > 0) throw new ParseError(second.errors.join('\n'));
    return { ast: second.ast, workflowName };
  }

  return {
    async start(request) {
      const filePath = path.resolve(request.filePath);
      const { ast, workflowName } = await parseSelected(filePath, request.workflowName);
      const bundleDigest = await computeBundleDigest(filePath, workflowName);
      const now = new Date().toISOString();
      const record: RunRecord = {
        formatVersion: 1,
        runId: randomUUID(),
        filePath,
        workflowName,
        params: request.params ?? {},
        bundleDigest,
        status: 'waiting',
        createdAt: now,
        updatedAt: now,
      };

      let outcome: WorkflowExecutionOutcome;
      try {
        outcome = await executeWorkflow({
          runId: record.runId,
          bundleDigest,
          filePath,
          params: record.params,
          workflowName,
          includeTrace: false,
          production: true,
          effectAdapter: createFileEffectAdapter(runDir(record.runId)),
        });
      } catch (error) {
        fail(record, error);
        throw error;
      }
      return toView(commit(record, outcome, ast));
    },

    async resume(request) {
      const record = readRecord(request.runId);
      if (!record) throw new RunNotFoundError(request.runId);
      if (record.status !== 'waiting' || !record.gate) throw new RunNotWaitingError(record.status);

      // Refuse before the engine does, with a message that says what to do.
      const digest = await computeBundleDigest(record.filePath, record.workflowName);
      if (digest !== record.bundleDigest) throw new BundleChangedError();

      const resolution = buildGateResolution(record.gate, record.gate.id, request.input);
      const continuation = JSON.parse(
        fs.readFileSync(continuationFile(record.runId), 'utf8'),
      ) as ContinuationEnvelope;
      const { ast } = await parseSelected(record.filePath, record.workflowName);

      // If this process dies after the engine returns but before `commit`
      // writes, the old `run.json` and `continuation.json` are still intact.
      // A second resume with the same answer re-applies the same resolution,
      // re-runs pure nodes (allowed by definition), and recovers every effect
      // after the gate from `effects/` instead of re-executing it. The
      // outcome converges, so no claim file is needed for one process.
      let outcome: WorkflowExecutionOutcome;
      try {
        outcome = await executeWorkflow({
          runId: record.runId,
          bundleDigest: record.bundleDigest,
          filePath: record.filePath,
          params: record.params,
          workflowName: record.workflowName,
          includeTrace: false,
          production: true,
          continuation,
          resolution,
          effectAdapter: createFileEffectAdapter(runDir(record.runId)),
        });
      } catch (error) {
        fail(record, error);
        throw error;
      }
      return toView(commit(record, outcome, ast));
    },

    get(runId) {
      const record = readRecord(runId);
      return record ? toView(record) : undefined;
    },

    list(filter = {}) {
      if (!fs.existsSync(rootDir)) return [];
      const wanted = filter.filePath ? path.resolve(filter.filePath) : undefined;
      const summaries: RunSummary[] = [];
      for (const entry of fs.readdirSync(rootDir)) {
        const record = readRecord(entry);
        if (!record) continue;
        if (wanted && record.filePath !== wanted) continue;
        summaries.push({
          status: record.status,
          runId: record.runId,
          workflowName: record.workflowName,
          filePath: record.filePath,
          gate: record.gate ? { kind: record.gate.kind, node: record.gate.node } : undefined,
          updatedAt: record.updatedAt,
        });
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  };
}

function toView(record: RunRecord): RunView {
  const view: RunView = {
    status: record.status,
    runId: record.runId,
    workflowName: record.workflowName,
  };
  if (record.status === 'waiting' && record.gate) {
    view.gate = {
      kind: record.gate.kind,
      node: record.gate.node,
      inputs: record.gate.inputs,
      absent: record.gate.absent,
    };
  }
  if (record.status === 'completed') view.result = record.result;
  if (record.status === 'failed') view.error = record.error;
  return view;
}

/**
 * Effect receipts on disk, one file per operation key, so a resume can
 * prove an effect already committed instead of running it again.
 */
export function createFileEffectAdapter(runDir: string): EffectAdapter {
  const dir = path.join(runDir, 'effects');
  const fileFor = (operationKey: string) =>
    path.join(dir, createHash('sha256').update(operationKey).digest('hex') + '.json');

  return {
    async recover(operationKey) {
      const file = fileFor(operationKey);
      if (!fs.existsSync(file)) return { kind: 'not-committed' };
      try {
        const record = JSON.parse(fs.readFileSync(file, 'utf8')) as {
          receipt: unknown;
          result: unknown;
        };
        return {
          kind: 'committed',
          receipt: record.receipt as never,
          result: record.result as never,
        };
      } catch {
        // A receipt we cannot read is evidence something happened that we
        // cannot describe. Fail closed; never re-run the effect.
        return { kind: 'ambiguous' };
      }
    },
    async commit(operationKey, address, execution) {
      fs.mkdirSync(dir, { recursive: true });
      writeAtomic(
        fileFor(operationKey),
        JSON.stringify({ operationKey, address, result: execution.result, receipt: execution.receipt }),
      );
    },
  };
}

/** Write via a sibling temp file and rename, so a reader never sees a partial file. */
function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
