import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseWorkflow } from '../api/index.js';
import type { TWorkflowAST } from '../ast/types.js';
import type { ContinuationEnvelope, DurableGateKind } from '../runtime/continuation.js';
import type { EffectAdapter } from '../runtime/durable-execution.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import { executeWorkflow, ContinuationRefusalError, type ExecutionTraceEvent, type WorkflowExecutionOutcome } from '../mcp/workflow-executor.js';
import { computeBundleDigest } from './bundle-digest.js';
import { labelGate } from './gate-labeling.js';
import { buildGateResolution, type ResolveInput } from './gate-resolution.js';
import { checkDocName, EFFECT_DOC_PREFIX, RESERVED_DOCS, RunBusyError, type RunStore } from './store.js';
import { missingParams, MissingParamsError } from './params.js';
import { createFileRunStore } from './file-store.js';
import { dueFor, type RunDue } from './time.js';

/**
 * The local durable-run coordinator.
 *
 * The engine returns a terminal `yielded` outcome and keeps nothing
 * (see `docs/adr/0001-durable-gate-continuation.md`). Somebody has to hold
 * the continuation between the yield and the resume, own run identity, vouch
 * for the bundle, and record effect receipts. This is that somebody, for a
 * driver in the same process: an assistant over MCP sees `{ runId, gate }`
 * instead of a multi-kilobyte envelope, the console sees each step, and
 * `fw serve` answers a request with a run id.
 *
 * Everything it keeps goes through a `RunStore` (`store.ts`): a directory
 * under `~/.fw/runs` by default, memory in tests, a database of yours in
 * production. While a segment runs, the run is claimed in the store, so two
 * processes on one store never drive the same run at once.
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
   * the background. An assistant over MCP waits and is told afterwards.
   */
  runId?: string;
  /**
   * Whether an agent gate may be answered by a configured agent profile
   * (`auto`, the default) or must wait for a person (`manual`). Kept with
   * the record so every later gate of the run is treated the same way.
   */
  agents?: 'auto' | 'manual';
  /** Who started the run -- `console`, `http`, `mcp`, or a name of the driver's own -- for a list to say so. */
  origin?: string;
}

/**
 * What an agent profile did about the run's latest agent gate. Written by
 * the driver before the model is called and again when it is done, so a
 * reader opening the run sees an answer in progress, one that was given, or
 * why one was not.
 */
export interface AgentNote {
  gateId: string;
  node: string;
  profile: string;
  provider: string;
  model?: string;
  status: 'answering' | 'answered' | 'rejected' | 'failed';
  startedAt: string;
  endedAt?: string;
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
  toolCalls?: number;
  /** Why it failed, or the reason it gave for rejecting. */
  error?: string;
  /** The process doing the answering, so a crash mid-answer can be told from an answer in progress. */
  owner?: { pid: number; host: string };
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
  /** When the clock will move the run, while it waits: a sleep wakes, a gate with a timeout times out. */
  due?: RunDue;
  result?: unknown;
  error?: string;
}

export interface RunSummary {
  status: RunView['status'];
  runId: string;
  workflowName: string;
  filePath: string;
  gate?: { kind: DurableGateKind; node: string };
  due?: RunDue;
  /** What the run was given, so a list can tell two runs apart. */
  params: Record<string, unknown>;
  failedNode?: string;
  mocks?: FwMockConfig;
  source?: { commit?: string; dirty?: boolean };
  agents?: 'auto' | 'manual';
  /** The latest agent activity, enough for a list row. */
  agent?: Pick<AgentNote, 'status' | 'profile' | 'node'>;
  origin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalCoordinator {
  start(request: StartRequest, options?: DriveOptions): Promise<RunView>;
  resume(request: ResumeRequest, options?: DriveOptions): Promise<RunView>;
  /** Give up on a run waiting at a gate: the continuation is dropped and the run recorded as cancelled. */
  cancel(runId: string): Promise<RunView>;
  get(runId: string): Promise<RunView | undefined>;
  list(filter?: { filePath?: string }): Promise<RunSummary[]>;
  /** Everything persisted about a run, for a driver that shows more than the minimum. */
  record(runId: string): Promise<RunRecord | undefined>;
  /** The kept step trace, in order across every segment. Empty when none was kept. */
  trace(runId: string): Promise<TraceEntry[]>;
  /** Forget a finished run: its record, trace and receipts. A waiting run must be cancelled first. */
  remove(runId: string): Promise<void>;
  /**
   * Record what an agent profile is doing, or did, about the run's current
   * gate. Takes the run's claim for the write, so it throws `RunBusyError`
   * while a segment of the run is being driven.
   */
  setAgent(runId: string, note: AgentNote | undefined): Promise<RunRecord>;
  /** Keep a named JSON document beside the run -- an agent transcript, say. The name is a plain slug. */
  keep(runId: string, name: string, data: unknown): Promise<void>;
  /** Read a document kept with `keep`, or undefined. */
  kept<T = unknown>(runId: string, name: string): Promise<T | undefined>;
  /**
   * Let the clock act: every waiting run whose `due` time has passed is
   * resumed -- a sleeping run woken along its success path, a gate with a
   * timeout sent along its failure path. Safe to call from several
   * processes at once: a run another process is driving, or already moved,
   * is skipped. `fw serve` and the console call it every few seconds.
   */
  tick(now?: number): Promise<TickResult>;
  /** The store behind it. */
  readonly store: RunStore;
}

/** What one tick did. A run that could not be moved says why, in a word. */
export interface TickResult {
  woke: RunView[];
  timedOut: RunView[];
  skipped: { runId: string; reason: 'busy' | 'not-waiting' | 'bundle-changed' | 'failed'; message?: string }[];
}

/** Everything persisted about one run. */
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
  /**
   * What the run resumes from, while it waits. Kept in the record, not in a
   * document beside it, so the single `put` that moves the run to a gate
   * commits the gate and its continuation together. Cleared with the gate.
   */
  continuation?: ContinuationEnvelope;
  /** When the clock will move the run, while it waits. Set with the gate, cleared with it. */
  due?: RunDue;
  result?: unknown;
  error?: string;
  /** The step that threw, when the trace said which. A failed run is opened there. */
  failedNode?: string;
  /** True when every segment kept its step trace, false when any did not. */
  traced?: boolean;
  /** The mocks the run was started with. Every segment uses the same. */
  mocks?: FwMockConfig;
  /** Where the file stood when the run started, when the driver said. */
  source?: { commit?: string; dirty?: boolean };
  /** Whether agent gates may be answered by a profile. Absent means `auto`. */
  agents?: 'auto' | 'manual';
  /** What an agent profile did about the latest agent gate, if one was asked. */
  agent?: AgentNote;
  /** Who started the run, when the driver said. */
  origin?: string;
  createdAt: string;
  updatedAt: string;
}

export class ParseError extends Error {
  readonly name = 'ParseError';
}
export class AmbiguousWorkflowError extends Error {
  readonly name = 'AmbiguousWorkflowError';
  constructor(readonly names: readonly string[]) {
    super(`file declares several workflows. Pass workflowName, one of: ${names.join(', ')}`);
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
    super('workflow or its compiled output changed since the run paused. Start a new run');
  }
}

/**
 * The project a workflow file belongs to: the nearest ancestor directory with
 * a `package.json` or an existing `.fw/` folder, or — when neither is found —
 * the file's own directory. `anchor` may be a file or a directory.
 *
 * This is what makes a run store follow the file rather than the process: two
 * processes launched from different working directories (a console, and an MCP
 * server a tool spawned elsewhere) resolve the SAME project for the SAME file,
 * so they share one store. The walk is case- and separator-tolerant because
 * `path` is already platform-native; the containment the store relies on is the
 * resolved root, not the raw string.
 */
export function resolveProjectRoot(anchor: string): string {
  let current: string;
  try {
    current = fs.statSync(anchor).isDirectory() ? path.resolve(anchor) : path.dirname(path.resolve(anchor));
  } catch {
    // The path need not exist yet (a not-yet-written file): treat it as a file.
    current = path.dirname(path.resolve(anchor));
  }
  const root = path.parse(current).root;
  // Walk up to the nearest project marker.
  for (let dir = current; ; dir = path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) ||
      fs.existsSync(path.join(dir, '.fw'))
    ) {
      return dir;
    }
    if (dir === root || path.dirname(dir) === dir) break;
  }
  // No marker found: the file's own directory is the project.
  return current;
}

/**
 * Where a run store lives. Precedence:
 *   1. `FW_RUNS_DIR` — an explicit override for operators pointing every
 *      process at one store.
 *   2. `<projectRoot>/.fw/runs` — when an anchor (a workflow file or its
 *      directory) is given, so the store follows the file across processes.
 *   3. `~/.fw/runs` — the legacy global fallback when there is no anchor.
 *
 * Passing no anchor keeps the old global behaviour, so existing callers and
 * runs are unaffected; nothing migrates.
 */
export function defaultRunsDir(anchor?: string): string {
  if (process.env.FW_RUNS_DIR) return process.env.FW_RUNS_DIR;
  if (anchor) return path.join(resolveProjectRoot(anchor), '.fw', 'runs');
  return path.join(os.homedir(), '.fw', 'runs');
}

export interface LocalCoordinatorOptions {
  /** The store runs live in. Default: the file store under `rootDir`. */
  store?: RunStore;
  /** The file store's directory when no `store` is given. Default `~/.fw/runs`, or `FW_RUNS_DIR`. */
  rootDir?: string;
  /**
   * How long a claim on a run lasts while a segment is driven. A segment
   * that runs longer than this may be taken over by another process; a
   * process that dies leaves its claim to lapse after it. Default one hour.
   */
  claimTtlMs?: number;
}

/** The document holding effect receipts for an operation key. */
const effectDoc = (operationKey: string) => `${EFFECT_DOC_PREFIX}${createHash('sha256').update(operationKey).digest('hex')}`;

export function createLocalCoordinator(options: LocalCoordinatorOptions = {}): LocalCoordinator {
  const store = options.store ?? createFileRunStore(options.rootDir ?? defaultRunsDir());
  const claimTtl = options.claimTtlMs ?? 60 * 60 * 1000;
  const instance = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  let uses = 0;

  /**
   * Do `work` holding the run's claim. Each use is its own owner, so two
   * operations of this coordinator on one run exclude each other as two
   * processes do: a store lets the same owner claim again, and with one
   * owner per coordinator a second use would share the claim and its
   * `release` would drop the first use's claim early.
   */
  async function claimed<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const owner = `${instance}:${++uses}`;
    if (!(await store.claim(runId, owner, claimTtl))) throw new RunBusyError(runId);
    try { return await work(); }
    finally { await store.release(runId, owner); }
  }

  /**
   * Commit an outcome with one `put`: the gate and the continuation it
   * resumes from are in the same record, so a process that dies before the
   * write leaves the run at its previous gate with that gate's continuation,
   * and a resume with that gate's answer moves it on again. A run with
   * documents and no record is an unacknowledged yield and is ignored
   * everywhere. Runs paused by an older version keep the envelope in a
   * `continuation` document instead; a terminal outcome drops it.
   */
  async function commit(record: RunRecord, outcome: WorkflowExecutionOutcome, ast: TWorkflowAST, kept?: TraceEntry[]): Promise<RunRecord> {
    const now = new Date().toISOString();
    const traced = await appendTrace(record, kept);

    if (outcome.kind === 'yielded') {
      const labeled = labelGate(outcome.gate, ast);
      const gate = {
        id: outcome.gate.id,
        kind: outcome.gate.kind,
        node: outcome.gate.address.nodeId,
        nodeType: outcome.gate.address.nodeType,
        ...labeled,
      };
      const next: RunRecord = {
        ...record,
        traced,
        status: 'waiting',
        gate,
        continuation: outcome.continuation,
        due: dueFor(gate),
        result: undefined,
        error: undefined,
        updatedAt: now,
      };
      if (next.due === undefined) delete next.due;
      await store.put(next);
      return next;
    }

    const next: RunRecord = {
      ...record,
      traced,
      status: 'completed',
      gate: undefined,
      continuation: undefined,
      due: undefined,
      result: outcome.result,
      error: undefined,
      updatedAt: now,
    };
    await store.put(next);
    await store.deleteDoc(record.runId, 'continuation');
    return next;
  }

  /**
   * A run that did not reach an outcome. Stopped by its driver's signal it
   * is `cancelled`, which is not a failure and is not shown as one; anything
   * else is `failed` with the error.
   */
  async function fail(record: RunRecord, error: unknown, options: DriveOptions | undefined, kept?: TraceEntry[]): Promise<void> {
    const traced = await appendTrace(record, kept);
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = options?.abortSignal?.aborted === true;
    await store.put({
      ...record,
      traced,
      status: cancelled ? 'cancelled' : 'failed',
      gate: undefined,
      continuation: undefined,
      due: undefined,
      result: undefined,
      error: cancelled ? undefined : message,
      failedNode: cancelled ? undefined : failedNodeIn(kept),
      updatedAt: new Date().toISOString(),
    } satisfies RunRecord);
    await store.deleteDoc(record.runId, 'continuation');
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
  async function appendTrace(record: RunRecord, kept: TraceEntry[] | undefined): Promise<boolean> {
    if (!kept) return false;
    const previous = await readTrace(record.runId);
    await store.putDoc(record.runId, 'trace', [...previous, ...kept]);
    return true;
  }

  async function readTrace(runId: string): Promise<TraceEntry[]> {
    const doc = await store.getDoc(runId, 'trace');
    return Array.isArray(doc) ? (doc as TraceEntry[]) : [];
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
      throw new ParseError(`workflow ${workflowName} not found. Available: ${available.join(', ')}`);
    }

    if (first.ast.functionName === workflowName) return { ast: first.ast, workflowName };
    const second = await parseWorkflow(filePath, { workflowName, projectDir });
    if (second.errors.length > 0) throw new ParseError(second.errors.join('\n'));
    return { ast: second.ast, workflowName };
  }

  async function readRecord(runId: string): Promise<RunRecord | undefined> {
    return store.get(runId);
  }

  return {
    store,

    async start(request, options) {
      const filePath = path.resolve(request.filePath);
      const { ast, workflowName } = await parseSelected(filePath, request.workflowName);
      const missing = missingParams(ast, request.params);
      if (missing.length) throw new MissingParamsError(workflowName, missing);
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
        ...(request.agents ? { agents: request.agents } : {}),
        ...(request.origin ? { origin: request.origin } : {}),
        createdAt: now,
        updatedAt: now,
      };

      return claimed(record.runId, async () => {
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
            effectAdapter: createStoreEffectAdapter(store, record.runId),
          });
        } catch (error) {
          await fail(record, error, options, kept);
          throw error;
        }
        return toView(await commit(record, outcome, ast, kept));
      });
    },

    async resume(request, options) {
      const record = await readRecord(request.runId);
      if (!record) throw new RunNotFoundError(request.runId);
      if (record.status !== 'waiting' || !record.gate) throw new RunNotWaitingError(record.status);

      // Refuse before the engine does, with a message that says what to do.
      const digest = await computeBundleDigest(record.filePath, record.workflowName);
      if (digest !== record.bundleDigest) throw new BundleChangedError();

      // Built before the claim so a bad answer is refused without taking it.
      buildGateResolution(record.gate, record.gate.id, request.input);

      return claimed(record.runId, async () => {
        // Read again under the claim: another process may have finished it,
        // or moved it to a later gate, between the check above and now.
        const current = await readRecord(record.runId);
        if (!current || current.status !== 'waiting' || !current.gate) throw new RunNotWaitingError(current?.status ?? 'cancelled');
        // A run paused by an older version keeps the envelope in a document.
        const continuation = current.continuation ?? ((await store.getDoc(record.runId, 'continuation')) as ContinuationEnvelope | undefined);
        if (!continuation) throw new RunNotWaitingError(current.status);
        if (continuation.gateId !== current.gate.id) {
          // Only an older version's two-write commit can leave these apart.
          // The run is left waiting: nothing ran.
          throw new ContinuationRefusalError({ accepted: false, reason: 'stale-gate', message: `the run's record names gate ${current.gate.id} but its continuation is at gate ${continuation.gateId}` });
        }
        const resolution = buildGateResolution(current.gate, current.gate.id, request.input);
        const { ast } = await parseSelected(record.filePath, record.workflowName);

        // If this process dies after the engine returns but before `commit`
        // writes, the old record and continuation are still intact. A second
        // resume with the same answer re-applies the same resolution, re-runs
        // pure nodes (allowed by definition), and recovers every effect after
        // the gate from its receipt instead of re-executing it. The outcome
        // converges; the claim only keeps two processes from trying at once.
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
            effectAdapter: createStoreEffectAdapter(store, record.runId),
          });
        } catch (error) {
          // A refusal is thrown before any node runs (the bundle, the
          // continuation or the adapter was not acceptable). The run is
          // still exactly where it paused, so it stays waiting.
          if (error instanceof ContinuationRefusalError) throw error;
          await fail(current, error, options, kept);
          throw error;
        }
        return toView(await commit(current, outcome, ast, kept));
      });
    },

    async cancel(runId) {
      const record = await readRecord(runId);
      if (!record) throw new RunNotFoundError(runId);
      if (record.status !== 'waiting') throw new RunNotWaitingError(record.status);
      return claimed(runId, async () => {
        // Read again under the claim: a driver may have completed the run
        // since the check above, and its result must not become "cancelled".
        const current = await readRecord(runId);
        if (!current || current.status !== 'waiting') throw new RunNotWaitingError(current?.status ?? 'cancelled');
        const next: RunRecord = {
          ...current,
          status: 'cancelled',
          gate: undefined,
          continuation: undefined,
          due: undefined,
          updatedAt: new Date().toISOString(),
        };
        await store.put(next);
        await store.deleteDoc(runId, 'continuation');
        return toView(next);
      });
    },

    async get(runId) {
      const record = await readRecord(runId);
      return record ? toView(record) : undefined;
    },

    record: readRecord,

    trace: readTrace,

    async remove(runId) {
      const record = await readRecord(runId);
      if (!record) throw new RunNotFoundError(runId);
      if (record.status === 'waiting') throw new RunNotWaitingError(record.status);
      await store.remove(runId);
    },

    async setAgent(runId, note) {
      if (!(await readRecord(runId))) throw new RunNotFoundError(runId);
      // Under the claim, so a segment committing between the read and the
      // write cannot be overwritten with the record it replaced.
      return claimed(runId, async () => {
        const record = await readRecord(runId);
        if (!record) throw new RunNotFoundError(runId);
        const next: RunRecord = { ...record, agent: note, updatedAt: new Date().toISOString() };
        if (note === undefined) delete next.agent;
        await store.put(next);
        return next;
      });
    },

    async keep(runId, name, data) {
      checkDocName(name);
      if ((RESERVED_DOCS as readonly string[]).includes(name) || name.startsWith(EFFECT_DOC_PREFIX)) throw new Error(`${name} is a document the coordinator keeps itself`);
      if (!(await readRecord(runId))) throw new RunNotFoundError(runId);
      await store.putDoc(runId, name, data);
    },

    async kept<T = unknown>(runId: string, name: string) {
      checkDocName(name);
      return (await store.getDoc(runId, name)) as T | undefined;
    },

    async tick(now = Date.now()) {
      const result: TickResult = { woke: [], timedOut: [], skipped: [] };
      const at = new Date(now).toISOString();
      for (const summary of await store.list()) {
        if (summary.status !== 'waiting' || !summary.due || summary.due.at > at) continue;
        const { runId, due } = summary;
        // A sleep wakes with the time it woke; a timeout is a refusal the
        // workflow reads on the gate's failure port, like any other.
        const input: ResolveInput = due.action === 'wake'
          ? { answer: summary.gate?.outputs.length ? at : null }
          : { reject: `no answer within ${String(summary.gate?.inputs.timeout ?? 'the timeout')}` };
        try {
          const view = await this.resume({ runId, input });
          (due.action === 'wake' ? result.woke : result.timedOut).push(view);
        } catch (error) {
          const name = error instanceof Error ? error.name : '';
          const reason = name === 'RunBusyError' ? 'busy' : name === 'RunNotWaitingError' ? 'not-waiting' : name === 'BundleChangedError' ? 'bundle-changed' : 'failed';
          result.skipped.push({ runId, reason, ...(reason === 'failed' ? { message: error instanceof Error ? error.message : String(error) } : {}) });
        }
      }
      return result;
    },

    async list(filter = {}) {
      const records = await store.list(filter.filePath ? { filePath: path.resolve(filter.filePath) } : {});
      return records.map((record) => ({
        status: record.status,
        runId: record.runId,
        workflowName: record.workflowName,
        filePath: record.filePath,
        gate: record.gate ? { kind: record.gate.kind, node: record.gate.node } : undefined,
        due: record.due,
        params: record.params,
        failedNode: record.failedNode,
        mocks: record.mocks,
        source: record.source,
        agents: record.agents,
        agent: record.agent ? { status: record.agent.status, profile: record.agent.profile, node: record.agent.node } : undefined,
        origin: record.origin,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
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
    if (record.due) view.due = record.due;
  }
  if (record.status === 'completed') view.result = record.result;
  if (record.status === 'failed') view.error = record.error;
  return view;
}

/**
 * Effect receipts as documents of the run, one per operation key, so a
 * resume can prove an effect already committed instead of running it again.
 */
export function createStoreEffectAdapter(store: RunStore, runId: string): EffectAdapter {
  return {
    async recover(operationKey) {
      let doc: unknown;
      try { doc = await store.getDoc(runId, effectDoc(operationKey)); }
      catch {
        // A receipt we cannot read is evidence something happened that we
        // cannot describe. Fail closed; never re-run the effect.
        return { kind: 'ambiguous' };
      }
      if (doc === undefined) return { kind: 'not-committed' };
      if (typeof doc !== 'object' || doc === null || !('receipt' in doc)) return { kind: 'ambiguous' };
      const record = doc as { receipt: unknown; result: unknown };
      return { kind: 'committed', receipt: record.receipt as never, result: record.result as never };
    },
    async commit(operationKey, address, execution) {
      await store.putDoc(runId, effectDoc(operationKey), { operationKey, address, result: execution.result, receipt: execution.receipt });
    },
  };
}

/** Effect receipts under `<runDir>/effects/`, as the file store keeps them. Kept for callers of the old name. */
export function createFileEffectAdapter(runDir: string): EffectAdapter {
  return createStoreEffectAdapter(createFileRunStore(path.dirname(runDir)), path.basename(runDir));
}
