/**
 * Step-through debugging for the console.
 *
 * The same `DebugController` the CLI's REPL and the MCP tools drive: the
 * workflow pauses before and after each node, its variables can be read
 * and changed while it waits, and it goes on one node at a time or to the
 * next breakpoint. A session is a held Promise in this process -- not a
 * run in the store, not resumable across a gate. A gated workflow can be
 * stepped as far as its first gate, where the session ends and says so.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseWorkflow } from '../api/parse.js';
import { getTopologicalOrder } from '../api/query.js';
import { DebugController, type DebugPauseState, type DebugResumeAction } from '../runtime/debug-controller.js';
import { executeWorkflow, type ExecutionTraceEvent, type WorkflowExecutionOutcome } from '../mcp/workflow-executor.js';
import { computeBundleDigest, createFileEffectAdapter } from '../coordinator/index.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import { getErrorMessage } from '../utils/error-utils.js';

export type DebugStatus = 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'yielded';

/** A session as the console shows it. */
export interface DebugView {
  id: string;
  file: string;
  name: string;
  params: Record<string, unknown>;
  status: DebugStatus;
  startedAt: number;
  updatedAt: number;
  /** While paused: the node, and whether it is about to run or has just run. */
  node?: string;
  phase?: 'before' | 'after';
  /** How many nodes have completed, out of the execution order. */
  position: number;
  order: string[];
  breakpoints: string[];
  /** The latest value of every port produced so far, as `node.port`. */
  values: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface DebugStartOptions {
  /** The session's id, when the caller needs it before the first pause. */
  id?: string;
  file: string;
  name: string;
  params?: Record<string, unknown>;
  breakpoints?: string[];
  mocks?: FwMockConfig;
  /** Every trace event as it happens, as for any other run. */
  onEvent?: (event: ExecutionTraceEvent) => void;
  /** Called whenever the session's status changes. */
  onChange?: (view: DebugView) => void;
}

type Settled =
  | { kind: 'outcome'; outcome: WorkflowExecutionOutcome }
  | { kind: 'error'; error: unknown };

interface Session {
  view: DebugView;
  controller: DebugController;
  abort: AbortController;
  /** The execution, already caught: it never rejects. */
  done: Promise<Settled>;
  last?: DebugPauseState;
  aborting: boolean;
  effectsDir: string;
  onChange?: (view: DebugView) => void;
}

/** `node:port:index` keys to the latest value per `node.port`. */
export function latestValues(variables: Record<string, unknown>): Record<string, unknown> {
  const best = new Map<string, { index: number; value: unknown }>();
  for (const [key, value] of Object.entries(variables)) {
    const at = key.lastIndexOf(':');
    const mid = key.lastIndexOf(':', at - 1);
    if (at < 0 || mid < 0) continue;
    const name = `${key.slice(0, mid)}.${key.slice(mid + 1, at)}`;
    const index = Number(key.slice(at + 1));
    const cur = best.get(name);
    if (!cur || index > cur.index) best.set(name, { index, value });
  }
  return Object.fromEntries([...best].map(([k, v]) => [k, v.value]));
}

/** The full key for the latest value of `node.port`, or null if it has none yet. */
function latestKey(variables: Record<string, unknown>, node: string, port: string): string | null {
  const prefix = `${node}:${port}:`;
  let found: string | null = null;
  let top = -1;
  for (const key of Object.keys(variables)) {
    if (!key.startsWith(prefix)) continue;
    const index = Number(key.slice(prefix.length));
    if (index > top) { top = index; found = key; }
  }
  return found;
}

export class DebugSessions {
  private readonly sessions = new Map<string, Session>();

  get(id: string): DebugView | undefined {
    return this.sessions.get(id)?.view;
  }

  list(): DebugView[] {
    return [...this.sessions.values()].map((s) => s.view);
  }

  /**
   * Start a session. Resolves at the first pause, or when the run ends
   * without one. The session is listed from the moment this is called, so
   * a caller that answers with the id before the pause can show it.
   */
  async start(options: DebugStartOptions): Promise<DebugView> {
    const file = path.resolve(options.file);
    const id = options.id ?? randomUUID();
    const controller = new DebugController({ debug: true, breakpoints: options.breakpoints });
    const abort = new AbortController();
    // A gated graph is refused without a bundle digest, and one with effects
    // without a recovery adapter. Both are given, so the segment up to the
    // first gate can be stepped; the receipts live only as long as the session.
    const effectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-debug-'));
    const view: DebugView = {
      id, file, name: options.name, params: options.params ?? {},
      status: 'running', startedAt: Date.now(), updatedAt: Date.now(),
      position: 0, order: [], breakpoints: controller.getBreakpoints(), values: {},
    };
    const session: Session = {
      view, controller, abort, done: Promise.resolve({ kind: 'error', error: new Error('not started') }),
      aborting: false, effectsDir, onChange: options.onChange,
    };
    this.sessions.set(id, session);

    const parsed = await parseWorkflow(file, { workflowName: options.name, projectDir: path.dirname(file) });
    if (parsed.errors.length) {
      session.view = { ...view, status: 'failed', error: parsed.errors.join('\n'), updatedAt: Date.now() };
      fs.rmSync(effectsDir, { recursive: true, force: true });
      session.onChange?.(session.view);
      return session.view;
    }
    const order = getTopologicalOrder(parsed.ast, { includeScopedChildren: true });
    controller.setExecutionOrder(order);
    session.view = { ...session.view, order };
    let bundleDigest: string | undefined;
    try { bundleDigest = await computeBundleDigest(file, options.name); } catch { /* an ungated graph does not need one */ }

    session.done = executeWorkflow({
      runId: id, filePath: file, workflowName: options.name, params: options.params,
      includeTrace: true, onEvent: options.onEvent, debugController: controller,
      abortSignal: abort.signal, mocks: options.mocks, bundleDigest,
      effectAdapter: createFileEffectAdapter(effectsDir),
    })
      .then((outcome) => ({ kind: 'outcome' as const, outcome }))
      .catch((error: unknown) => ({ kind: 'error' as const, error }));
    await this.settle(session);
    return session.view;
  }

  /** Run the next node and pause again. */
  step(id: string): Promise<DebugView> { return this.act(id, { type: 'step' }); }

  /** Run to the end, or to the next breakpoint. */
  continue(id: string, toBreakpoint = false): Promise<DebugView> {
    return this.act(id, { type: toBreakpoint ? 'continueToBreakpoint' : 'continue' });
  }

  /** Stop the session, paused or not. */
  async abort(id: string): Promise<DebugView> {
    const s = this.need(id);
    s.aborting = true;
    if (s.view.status === 'paused') return this.act(id, { type: 'abort' });
    s.abort.abort();
    await this.settle(s);
    return s.view;
  }

  /**
   * Change a value a node produced. Takes effect before the next node runs,
   * which is how a branch is forced or a bad value patched without a rerun.
   */
  setVariable(id: string, node: string, port: string, value: unknown): DebugView {
    const s = this.need(id);
    if (s.view.status !== 'paused' || !s.last) throw new Error('the session is not paused');
    const key = latestKey(s.last.variables, node, port);
    if (!key) throw new Error(`${node}.${port} has no value yet. It can be set once ${node} has run`);
    s.controller.setVariable(key, value);
    s.last.variables[key] = value;
    s.view = { ...s.view, values: { ...s.view.values, [`${node}.${port}`]: value }, updatedAt: Date.now() };
    s.onChange?.(s.view);
    return s.view;
  }

  breakpoint(id: string, action: 'add' | 'remove', node: string): DebugView {
    const s = this.need(id);
    if (action === 'add') s.controller.addBreakpoint(node); else s.controller.removeBreakpoint(node);
    s.view = { ...s.view, breakpoints: s.controller.getBreakpoints(), updatedAt: Date.now() };
    s.onChange?.(s.view);
    return s.view;
  }

  private need(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no debug session ${id}`);
    return s;
  }

  private async act(id: string, action: DebugResumeAction): Promise<DebugView> {
    const s = this.need(id);
    if (s.view.status !== 'paused') throw new Error(`the session is ${s.view.status}, not paused`);
    s.view = { ...s.view, status: 'running', node: undefined, phase: undefined, updatedAt: Date.now() };
    s.onChange?.(s.view);
    s.controller.resume(action);
    await this.settle(s);
    return s.view;
  }

  /** Wait for the next pause or the end, and record which it was. */
  private async settle(s: Session): Promise<void> {
    // `onPause()` is read after any resume: resuming replaces the promise.
    const paused = s.controller.onPause().then((state) => ({ kind: 'paused' as const, state }));
    const next = await Promise.race([s.done, paused]);
    const now = Date.now();
    if (next.kind === 'paused') {
      s.last = next.state;
      s.view = {
        ...s.view, status: 'paused', node: next.state.currentNodeId, phase: next.state.phase,
        position: next.state.position, breakpoints: next.state.breakpoints,
        values: latestValues(next.state.variables), updatedAt: now,
      };
    } else if (next.kind === 'outcome' && next.outcome.kind === 'completed') {
      s.view = { ...s.view, status: 'completed', node: undefined, phase: undefined, position: s.view.order.length, result: next.outcome.result, updatedAt: now };
    } else if (next.kind === 'outcome' && next.outcome.kind === 'yielded') {
      const gate = next.outcome.gate.address.nodeId;
      s.view = {
        ...s.view, status: 'yielded', node: gate, phase: undefined, updatedAt: now,
        error: `Reached the gate at ${gate}. The debugger cannot hold a gate. Run the workflow without it to answer one.`,
      };
    } else {
      const error = next.kind === 'error' ? next.error : undefined;
      const message = getErrorMessage(error);
      const aborted = s.aborting || s.abort.signal.aborted || /Debug session aborted/.test(message);
      s.view = { ...s.view, status: aborted ? 'aborted' : 'failed', node: undefined, phase: undefined, error: aborted ? undefined : message, updatedAt: now };
    }
    if (s.view.status !== 'paused' && s.view.status !== 'running') fs.rmSync(s.effectsDir, { recursive: true, force: true });
    s.onChange?.(s.view);
  }
}
