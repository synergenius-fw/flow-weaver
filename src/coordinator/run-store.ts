import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseWorkflow } from '../api/index.js';
import type { TWorkflowAST } from '../ast/types.js';
import type { ContinuationEnvelope, DurableGateKind } from '../runtime/continuation.js';
import type { EffectAdapter } from '../runtime/durable-execution.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import { executeWorkflow, type ExecutionTraceEvent, type WorkflowExecutionOutcome } from '../mcp/workflow-executor.js';
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
  /**
   * Answers for the built-in gates and calls (`waitForEvent`, `waitForAgent`,
   * `invokeWorkflow`, `delay`), so a run can go through them unattended.
   * Kept with the record, so a later segment is mocked the same way.
   */
  mocks?: FwMockConfig;
  /** Where the file stood when the run started -- a commit, and whether it had uncommitted changes -- as the driver knows it. */
  source?: { commit?: string; dirty?: boolean };
  /**
   * The run's identity, when the driver needs it before the run ends. The
   * console answers `POST /api/runs` with the id while the run goes on in
   * the background; an assistant over MCP waits and is told afterwards.
   */
  runId?: string;
}

/** One entry of a kept step trace: the event and when it happened. */
export interface TraceEntry {
  t: number;
  e: unknown;
}

/**
 * How a driver watches a run it is driving.
 *
 * An assistant over MCP wants none of this: fewer tokens is the point. A
 * person at the console wants all of it: each step as it runs, and the
 * same trace again when the run is opened tomorrow.
 */
export interface DriveOptions {
  /** Every trace event as it happens. Implies `trace`. */
  onEvent?: (event: ExecutionTraceEvent) => void;
  /** Keep the step trace beside the record, so a later reader has it too. */
  trace?: boolean;
  /** Cooperative cancellation. A run stopped this way is recorded as `cancelled`. */
  abortSignal?: AbortSignal;
}

export interface ResumeRequest {
  runId: string;
  input: ResolveInput;
}

/** What a driver is shown. Deliberately the minimum. */
export interface RunView {
  status: 'waiting' | 'completed' | 'failed' | 'cancelled';
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
  /** What the run was given, so a list can tell two runs apart. */
  params: Record<string, unknown>;
  failedNode?: string;
  mocks?: FwMockConfig;
  source?: { commit?: string; dirty?: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface LocalCoordinator {
  start(request: StartRequest, options?: DriveOptions): Promise<RunView>;
  resume(request: ResumeRequest, options?: DriveOptions): Promise<RunView>;
  /** Give up on a run waiting at a gate: the continuation is dropped and the run recorded as cancelled. */
  cancel(runId: string): RunView;
  get(runId: string): RunView | undefined;
  list(filter?: { filePath?: string }): RunSummary[];
  /** Everything persisted about a run, for a driver that shows more than the minimum. */
  record(runId: string): RunRecord | undefined;
  /** The kept step trace, in order across every segment; empty when none was kept. */
  trace(runId: string): TraceEntry[];
  /** Forget a finished run: its record, trace and receipts. A waiting run must be cancelled first. */
  remove(runId: string): void;
}

/** Everything persisted about one run. `continuation.json` sits beside it. */
export interface RunRecord {
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
  /** The step that threw, when the trace said which; a failed run is opened there. */
  failedNode?: string;
  /** True when every segment kept its step trace in `trace.json`; false when any did not. */
  traced?: boolean;
  /** The mocks the run was started with; every segment uses the same. */
  mocks?: FwMockConfig;
  /** Where the file stood when the run started, when the driver said. */
  source?: { commit?: string; dirty?: boolean };
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
  const traceFile = (runId: string) => path.join(runDir(runId), 'trace.json');

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
  function commit(record: RunRecord, outcome: WorkflowExecutionOutcome, ast: TWorkflowAST, kept?: TraceEntry[]): RunRecord {
    const now = new Date().toISOString();
    const dir = runDir(record.runId);
    fs.mkdirSync(dir, { recursive: true });
    const traced = appendTrace(record, kept);

    if (outcome.kind === 'yielded') {
      const labeled = labelGate(outcome.gate, ast);
      writeAtomic(continuationFile(record.runId), JSON.stringify(outcome.continuation));
      const next: RunRecord = {
        ...record,
        traced,
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
      traced,
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

  /**
   * A run that did not reach an outcome. Stopped by its driver's signal it
   * is `cancelled`, which is not a failure and is not shown as one; anything
   * else is `failed` with the error.
   */
  function fail(record: RunRecord, error: unknown, options: DriveOptions | undefined, kept?: TraceEntry[]): void {
    const dir = runDir(record.runId);
    fs.mkdirSync(dir, { recursive: true });
    const traced = appendTrace(record, kept);
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = options?.abortSignal?.aborted === true;
    writeAtomic(
      recordFile(record.runId),
      JSON.stringify({
        ...record,
        traced,
        status: cancelled ? 'cancelled' : 'failed',
        gate: undefined,
        result: undefined,
        error: cancelled ? undefined : message,
        failedNode: cancelled ? undefined : failedNodeIn(kept),
        updatedAt: new Date().toISOString(),
      } satisfies RunRecord),
    );
    fs.rmSync(continuationFile(record.runId), { force: true });
  }

  /** The step whose error the trace recorded last, if it recorded one. */
  function failedNodeIn(kept: TraceEntry[] | undefined): string | undefined {
    if (!kept) return undefined;
    for (let i = kept.length - 1; i >= 0; i--) {
      const e = kept[i].e as { type?: string; id?: string; status?: string } | undefined;
      if (e?.type === 'LOG_ERROR' && e.id) return e.id;
      if (e?.type === 'STATUS_CHANGED' && e.status === 'FAILED' && e.id) return e.id;
    }
    return undefined;
  }

  /**
   * Add a segment's events to the kept trace. Returns whether the run is
   * traced end to end: one segment driven without a trace -- resumed by an
   * assistant, say -- leaves a gap, and a reader must not fill it in.
   */
  function appendTrace(record: RunRecord, kept: TraceEntry[] | undefined): boolean {
    if (!kept) return false;
    const previous = readTrace(record.runId);
    writeAtomic(traceFile(record.runId), JSON.stringify([...previous, ...kept]));
    return true;
  }

  function readTrace(runId: string): TraceEntry[] {
    const file = traceFile(runId);
    if (!fs.existsSync(file)) return [];
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as TraceEntry[];
    } catch {
      return [];
    }
  }

  /**
   * What one segment of execution is given: the driver's observer wrapped so
   * the events are also kept, when asked. Tracing needs the debug build of
   * the workflow, which is where the events come from.
   */
  function observe(options: DriveOptions | undefined) {
    const tracing = options?.trace === true || options?.onEvent !== undefined;
    if (!tracing) return { kept: undefined, request: { includeTrace: false as const, production: true } };
    const kept: TraceEntry[] = [];
    const onEvent = (event: ExecutionTraceEvent) => {
      kept.push({ t: event.timestamp, e: event.data ?? event });
      options?.onEvent?.(event);
    };
    return { kept, request: { includeTrace: true as const, production: false, onEvent } };
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
    async start(request, options) {
      const filePath = path.resolve(request.filePath);
      const { ast, workflowName } = await parseSelected(filePath, request.workflowName);
      const bundleDigest = await computeBundleDigest(filePath, workflowName);
      const now = new Date().toISOString();
      const record: RunRecord = {
        formatVersion: 1,
        runId: request.runId ?? randomUUID(),
        filePath,
        workflowName,
        params: request.params ?? {},
        bundleDigest,
        status: 'waiting',
        ...(request.mocks ? { mocks: request.mocks } : {}),
        ...(request.source ? { source: request.source } : {}),
        createdAt: now,
        updatedAt: now,
      };

      const { kept, request: observed } = observe(options);
      let outcome: WorkflowExecutionOutcome;
      try {
        outcome = await executeWorkflow({
          runId: record.runId,
          bundleDigest,
          filePath,
          params: record.params,
          workflowName,
          mocks: record.mocks,
          ...observed,
          abortSignal: options?.abortSignal,
          effectAdapter: createFileEffectAdapter(runDir(record.runId)),
        });
      } catch (error) {
        fail(record, error, options, kept);
        throw error;
      }
      return toView(commit(record, outcome, ast, kept));
    },

    async resume(request, options) {
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
      const { kept, request: observed } = observe(options);
      let outcome: WorkflowExecutionOutcome;
      try {
        outcome = await executeWorkflow({
          runId: record.runId,
          bundleDigest: record.bundleDigest,
          filePath: record.filePath,
          params: record.params,
          workflowName: record.workflowName,
          mocks: record.mocks,
          ...observed,
          abortSignal: options?.abortSignal,
          continuation,
          resolution,
          effectAdapter: createFileEffectAdapter(runDir(record.runId)),
        });
      } catch (error) {
        fail(record, error, options, kept);
        throw error;
      }
      return toView(commit(record, outcome, ast, kept));
    },

    cancel(runId) {
      const record = readRecord(runId);
      if (!record) throw new RunNotFoundError(runId);
      if (record.status !== 'waiting') throw new RunNotWaitingError(record.status);
      const next: RunRecord = {
        ...record,
        status: 'cancelled',
        gate: undefined,
        updatedAt: new Date().toISOString(),
      };
      writeAtomic(recordFile(runId), JSON.stringify(next));
      fs.rmSync(continuationFile(runId), { force: true });
      return toView(next);
    },

    get(runId) {
      const record = readRecord(runId);
      return record ? toView(record) : undefined;
    },

    record: readRecord,

    trace: readTrace,

    remove(runId) {
      const record = readRecord(runId);
      if (!record) throw new RunNotFoundError(runId);
      if (record.status === 'waiting') throw new RunNotWaitingError(record.status);
      fs.rmSync(runDir(runId), { recursive: true, force: true });
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
          params: record.params,
          failedNode: record.failedNode,
          mocks: record.mocks,
          source: record.source,
          createdAt: record.createdAt,
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
