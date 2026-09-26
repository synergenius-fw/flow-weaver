import * as path from 'node:path';
import type { ContinuationEnvelope, DurableGateKind } from '../runtime/continuation.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { ExecutionTraceEvent } from '../mcp/workflow-executor.js';
import type { ResolveInput } from './gate-resolution.js';
import type { RunStore } from './store.js';
import type { RunDue } from './time.js';
import { createRunContext } from './run-context.js';
import { startRun } from './run-start.js';
import { resumable, resumeRun } from './run-resume.js';
import { cancelRun, removeRun } from './run-ending.js';
import { keepDoc, keptDoc, setAgentNote } from './run-annotations.js';
import { tickDue } from './clock-tick.js';
import { readTrace } from './run-trace.js';
import { toSummary, toView } from './run-views.js';

export { ParseError, AmbiguousWorkflowError, RunNotFoundError, RunNotWaitingError, BundleChangedError } from './errors.js';
export { resolveProjectRoot, defaultRunsDir } from './runs-dir.js';
export { createStoreEffectAdapter, createFileEffectAdapter } from './effect-receipts.js';

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
 *
 * This module holds the public shapes and puts the coordinator together.
 * What each operation decides lives beside it: `run-context.ts` (the store
 * and the claim), `workflow-selection.ts` (which workflow a run is of),
 * `run-start.ts` and `run-resume.ts` (driving a segment), `run-outcome.ts`
 * (writing down how it ended), `run-trace.ts` (the kept step trace),
 * `run-ending.ts` (cancel and remove), `run-annotations.ts` (agent notes
 * and kept documents), `clock-tick.ts` (the clock), `run-views.ts` (what a
 * driver is shown), `effect-receipts.ts`, `runs-dir.ts` and `errors.ts`.
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
  /**
   * Whether `resume` would refuse this request before running anything:
   * throws the same error it would (no such run, not waiting, the workflow
   * changed, an answer the gate cannot take), and changes nothing. For a
   * driver that resumes in the background and answers the caller first.
   */
  checkResume(request: ResumeRequest): Promise<void>;
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

export function createLocalCoordinator(options: LocalCoordinatorOptions = {}): LocalCoordinator {
  const ctx = createRunContext(options);
  const { store, readRecord } = ctx;

  return {
    store,

    start(request, options) { return startRun(ctx, request, options); },

    checkResume: async (request) => { await resumable(ctx, request); },

    resume(request, options) { return resumeRun(ctx, request, options); },

    cancel(runId) { return cancelRun(ctx, runId); },

    async get(runId) {
      const record = await readRecord(runId);
      return record ? toView(record) : undefined;
    },

    record: readRecord,

    trace: (runId) => readTrace(store, runId),

    remove(runId) { return removeRun(ctx, runId); },

    setAgent(runId, note) { return setAgentNote(ctx, runId, note); },

    keep(runId, name, data) { return keepDoc(ctx, runId, name, data); },

    kept<T = unknown>(runId: string, name: string) { return keptDoc<T>(ctx, runId, name); },

    // Through `this`, so each due run is resumed by the coordinator as it
    // stands when the tick reaches it.
    tick(now = Date.now()) { return tickDue(store, (request) => this.resume(request), now); },

    async list(filter = {}) {
      const records = await store.list(filter.filePath ? { filePath: path.resolve(filter.filePath) } : {});
      return records.map(toSummary);
    },
  };
}
