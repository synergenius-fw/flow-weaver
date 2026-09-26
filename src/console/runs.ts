/**
 * The console's runs.
 *
 * Runs live in the coordinator's store, the same one `fw_run` and
 * `fw_resume` write to, so a run started here can be answered by an
 * assistant over MCP and the other way round. What this process holds is
 * the segment of execution it is driving at the moment, the step-through
 * debug sessions, and the pages watching each run.
 */
import type * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FSWatcher } from 'chokidar';
import type { ExecutionTraceEvent } from '../mcp/workflow-executor.js';
import { answerAgentGate, isAnswering, noteAnswerMisfit, type LocalCoordinator, type RunRecord, type RunSummary, type TraceEntry } from '../coordinator/index.js';
import type { AgentProfiles } from '../agent/profiles.js';
import type { AgentGateEvent } from '../agent/gate.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { TWorkflowAST } from '../ast/types.js';
import { DebugSessions, type DebugView } from './debug.js';
import { gateOutputSchemas, type FieldSchema } from './schema.js';
import { nodeTypeOf, parseOne } from './workflow-view.js';
import { send, sse, type Json } from './respond.js';
import { getErrorMessage } from '../utils/error-utils.js';

type Source = { commit?: string; dirty?: boolean };

/**
 * A segment of execution this process is driving right now.
 *
 * Everything else about a run is in the store. What is held here is the
 * segment in flight -- its events so far, and the way to stop it -- and a
 * run that failed before the store had a record for it, which has nowhere
 * else to be shown.
 */
interface Live {
  id: string;
  file: string;
  name: string;
  params: Json;
  mocks?: FwMockConfig;
  source?: Source;
  startedAt: number;
  status: 'running' | 'failed';
  error?: string;
  events: TraceEntry[];
  abort: AbortController;
}

/** The mocks a request carried, or nothing: only the four known sections, only objects. */
export function mocksFrom(b: Record<string, unknown>): FwMockConfig | undefined {
  const m = b.mocks;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
  const src = m as Record<string, unknown>;
  const out: FwMockConfig = {};
  for (const k of ['events', 'agents', 'invocations', 'gates'] as const) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && Object.keys(src[k]).length) out[k] = src[k] as Record<string, object>;
  }
  if (src.fast === true) out.fast = true;
  return Object.keys(out).length ? out : undefined;
}

const at = (iso: string): number => Date.parse(iso);

type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

/**
 * A debug session as a run. Paused counts as running -- the run is alive
 * and holds the process -- and a session that stopped at a gate or was
 * aborted is neither a success nor a failure, so it is shown as cancelled
 * with the debugger's own account of why.
 */
const DEBUG_STATUS: Record<DebugView['status'], RunStatus> = {
  running: 'running', paused: 'running', completed: 'completed', failed: 'failed', aborted: 'cancelled', yielded: 'cancelled',
};

function debugSnapshot(d: DebugView, source?: Source): Json {
  return {
    id: d.id, file: d.file, name: d.name, params: d.params, source, status: DEBUG_STATUS[d.status],
    startedAt: d.startedAt, updatedAt: d.updatedAt, result: d.result, error: d.error, traced: true,
    debug: { status: d.status, node: d.node, phase: d.phase, position: d.position, order: d.order, breakpoints: d.breakpoints },
  };
}

export interface RunDriverOptions {
  coordinator: LocalCoordinator;
  /** Tell every page something changed. */
  broadcast: (msg: Json) => void;
  /** The project the console is open on, which may change. */
  projectDir: () => string;
  /** The project's agent profiles, for answering agent gates. */
  profiles: () => AgentProfiles;
}

export type RunDriver = ReturnType<typeof createRunDriver>;

export function createRunDriver({ coordinator, broadcast, projectDir, profiles }: RunDriverOptions) {
  const live = new Map<string, Live>();
  // Step-through sessions: live only, never in the store, gone with the process.
  const debug = new DebugSessions();
  const debugEvents = new Map<string, TraceEntry[]>();
  /** Where the file stood when each session started; the store keeps it for ordinary runs. */
  const debugSource = new Map<string, Source>();
  // What an agent profile said while answering a gate, per run, for replay
  // to a client that opens the run later in this process's life.
  const agentEvents = new Map<string, TraceEntry[]>();
  const subs = new Map<string, Set<http.ServerResponse>>();

  const push = (id: string, msg: Json) => {
    for (const res of subs.get(id) ?? []) send(res, msg);
  };

  /**
   * The store is read for every listing and every rail refresh; a project
   * with hundreds of past runs would have each of those read hundreds of
   * files. One reading serves everything asked within the same moment.
   */
  let listed: { at: number; rows: RunSummary[] } | undefined;
  const storeList = async (): Promise<RunSummary[]> => {
    if (!listed || Date.now() - listed.at > 500) listed = { at: Date.now(), rows: await coordinator.list() };
    return listed.rows;
  };
  // The latest counts, for callers that cannot wait -- a verdict announced
  // from the checker uses the counts of the last listing.
  let lastCounts = new Map<string, number>();
  const waitingCounts = async () => {
    const counts = new Map<string, number>();
    for (const s of await storeList()) if (s.status === 'waiting') counts.set(`${s.filePath}|${s.workflowName}`, (counts.get(`${s.filePath}|${s.workflowName}`) ?? 0) + 1);
    lastCounts = counts;
    return counts;
  };
  const withWaiting = <W extends { file: string; name: string }>(w: W, counts = lastCounts) => ({
    ...w,
    waiting: counts.get(`${w.file}|${w.name}`) ?? 0,
  });

  /**
   * The parsed workflow behind a run, for labelling its gate. Parsing takes
   * a second; a run is looked at far more often than its file changes.
   */
  const asts = new Map<string, { mtimeMs: number; ast: TWorkflowAST | undefined }>();
  async function astFor(file: string, name: string): Promise<TWorkflowAST | undefined> {
    const key = `${file}|${name}`;
    let mtimeMs: number;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { return undefined; }
    const hit = asts.get(key);
    if (hit && hit.mtimeMs === mtimeMs) return hit.ast;
    const { ast } = await parseOne(file, name);
    asts.set(key, { mtimeMs, ast });
    return ast;
  }

  /** The gate as the answer form needs it: the record's labels plus the shape of each output. */
  async function gateView(rec: RunRecord): Promise<Json | undefined> {
    const g = rec.gate;
    if (!g) return undefined;
    const ast = await astFor(rec.filePath, rec.workflowName);
    const inst = ast?.instances.find((i) => i.id === g.node);
    const nt = ast && inst ? nodeTypeOf(ast, inst) : undefined;
    return {
      id: g.id, kind: g.kind, node: g.node, inputs: g.inputs, absent: g.absent, outputs: g.outputs,
      hasSuccessPort: g.hasSuccessPort, hasFailurePort: g.hasFailurePort,
      outputTypes: Object.fromEntries(g.outputs.map((o) => [o, nt?.outputs?.[o]?.tsType ?? 'unknown'])),
      outputSchema: ast ? gateOutputSchemas(ast, g.node, rec.filePath) : null,
      // The words for whoever answers: the gate function's own description,
      // and each output's label from its @output line. Types alone say what
      // shape an answer has, not what it means.
      description: nt?.description ?? '',
      outputLabels: Object.fromEntries(g.outputs.map((o) => [o, nt?.outputs?.[o]?.label ?? ''])),
      inputLabels: Object.fromEntries(Object.keys(g.inputs).map((i) => [i, nt?.inputs?.[i]?.label ?? ''])),
    };
  }

  /** A run as the client sees it: the live segment if there is one, else the record. */
  async function snapshot(id: string): Promise<Json | undefined> {
    const d = debug.get(id);
    if (d) return debugSnapshot(d, debugSource.get(id));
    const l = live.get(id);
    const rec = await coordinator.record(id);
    if (l) return { id, file: l.file, name: l.name, params: l.params, mocks: l.mocks, source: l.source, status: l.status, startedAt: l.startedAt, updatedAt: Date.now(), error: l.error, traced: true, agent: rec?.agent, agents: rec?.agents, origin: rec?.origin ?? 'console' };
    if (!rec) return undefined;
    return {
      id, file: rec.filePath, name: rec.workflowName, params: rec.params, mocks: rec.mocks, source: rec.source, status: rec.status,
      startedAt: at(rec.createdAt), updatedAt: at(rec.updatedAt),
      gate: rec.gate ? { node: rec.gate.node, kind: rec.gate.kind } : undefined,
      due: rec.due ? { at: at(rec.due.at), action: rec.due.action } : undefined,
      result: rec.result, error: rec.error, failedAt: rec.failedNode, traced: !!rec.traced,
      agent: rec.agent, agents: rec.agents, origin: rec.origin,
    };
  }
  /** The same, with the gate fully labelled -- what an open run shows. */
  async function fullSnapshot(id: string): Promise<Json | undefined> {
    const snap = await snapshot(id);
    const rec = live.has(id) ? undefined : await coordinator.record(id);
    return snap && rec?.gate ? { ...snap, gate: await gateView(rec) } : snap;
  }
  async function pushRun(id: string): Promise<void> {
    if (!subs.get(id)?.size) return;
    const run = await fullSnapshot(id);
    if (run) push(id, { type: 'run', run });
  }

  /** The store changed under a run: tell the pages, and the run's watchers. */
  async function changed(id?: string): Promise<void> {
    listed = undefined;
    if (id) await pushRun(id);
    broadcast({ type: 'runs' });
  }

  /**
   * Drive one segment -- a start, or a resume -- through the coordinator,
   * relaying its events to whoever is watching. The coordinator commits the
   * outcome; this only announces it.
   */
  async function drive(l: Live, segment: (onEvent: (ev: ExecutionTraceEvent) => void) => Promise<unknown>): Promise<void> {
    live.set(l.id, l);
    listed = undefined;
    broadcast({ type: 'runs' });
    void pushRun(l.id);
    const onEvent = (ev: ExecutionTraceEvent) => {
      const entry = { t: ev.timestamp, e: ev.data ?? ev };
      l.events.push(entry);
      push(l.id, { type: 'event', ...entry });
    };
    try {
      await segment(onEvent);
      live.delete(l.id);
    } catch (err) {
      // With a record in the store the failure is already written there. A
      // run refused before that -- a file that stopped parsing, a bundle
      // that could not be fingerprinted -- is kept here so it is still shown.
      if (await coordinator.record(l.id)) live.delete(l.id);
      else { l.status = 'failed'; l.error = getErrorMessage(err); }
    }
    await changed(l.id);
    void afterSegment(l.id);
  }

  /**
   * After a segment stopped at an agent gate: the matching profile answers
   * it, with the model's words streamed to whoever is watching, and the run
   * resumes with the answer -- another segment, which may reach another
   * gate and come back here. A profile that is missing, not ready, or gave
   * nothing usable leaves the gate waiting, with the reason on the run.
   */
  async function afterSegment(id: string, asked = false): Promise<void> {
    const rec = await coordinator.record(id);
    if (!rec || rec.status !== 'waiting' || rec.gate?.kind !== 'agent' || (rec.agents === 'manual' && !asked)) return;
    const note = () => changed(id);
    try {
      // A run started manual is answered only when a person asks for it; the
      // coordinator's own guard is the record's mode, so lift it for this gate.
      if (asked && rec.agents === 'manual') await coordinator.setAgent(id, rec.agent);
      const step = await answerAgentGate(coordinator, id, {
        projectDir: projectDir(),
        profiles: profiles(),
        outputSchema: async (r) => {
          const g = await gateView(r) as { outputSchema?: Record<string, FieldSchema> | null; outputTypes?: Record<string, string> } | undefined;
          return g ? { schema: g.outputSchema ?? null, types: g.outputTypes } : undefined;
        },
        onEvent: (e: AgentGateEvent) => {
          const entry = { t: Date.now(), e };
          (agentEvents.get(id) ?? agentEvents.set(id, []).get(id)!).push(entry);
          push(id, { ...e, t: entry.t });
          if (e.phase === 'start' || e.phase === 'done') void note();
        },
      });
      await note();
      if (step.kind === 'answer') await resume(id, { answer: step.answer });
      else if (step.kind === 'reject') await resume(id, { reject: step.reason });
    } catch (err) {
      // A malformed answer is the model's failure, recorded on its note.
      // Anything else leaves the gate as it was, for a person to answer.
      await noteAnswerMisfit(coordinator, id, err);
      await note();
    }
  }

  /**
   * Start a session that pauses before its first node. Listed at once, so
   * the answer carries the id; the first pause arrives over the stream.
   */
  function startDebug(file: string, name: string, params: Json, breakpoints: string[], mocks: FwMockConfig | undefined, runTo: 'first' | 'breakpoint', source?: Source): Json {
    const id = randomUUID();
    const events: TraceEntry[] = [];
    debugEvents.set(id, events);
    if (source) debugSource.set(id, source);
    void debug.start({
      id, file, name, params, breakpoints, mocks,
      onEvent: (ev) => {
        const entry = { t: ev.timestamp, e: ev.data ?? ev };
        events.push(entry);
        push(id, { type: 'event', ...entry });
      },
      onChange: () => { void pushRun(id); broadcast({ type: 'runs' }); },
    }).then((view) => {
      // A session always pauses before its first step; when the person asked
      // to run to the first breakpoint instead, it is let go from there.
      if (runTo === 'breakpoint' && view.status === 'paused' && breakpoints.length) return debug.continue(id, true).then(() => undefined);
    }).catch(() => undefined);
    broadcast({ type: 'runs' });
    // The session is registered before its first await, so it is here to show.
    return debugSnapshot(debug.get(id)!, debugSource.get(id));
  }

  async function start(file: string, name: string, params: Json, mocks?: FwMockConfig, source?: Source, agents?: 'auto' | 'manual'): Promise<Json> {
    // Refuse a broken file now, with the parser's message, rather than as a
    // failed run a moment later.
    const ast = await astFor(file, name);
    if (!ast) throw new Error((await parseOne(file, name)).errors.join('\n'));
    const id = randomUUID();
    const l: Live = { id, file, name, params, mocks, source, startedAt: Date.now(), status: 'running', events: [], abort: new AbortController() };
    void drive(l, (onEvent) =>
      coordinator.start({ filePath: file, workflowName: name, params, runId: id, mocks, source, agents, origin: 'console' }, { onEvent, abortSignal: l.abort.signal }));
    return (await snapshot(id))!;
  }

  async function resume(id: string, input: { answer?: unknown; reject?: string }): Promise<void> {
    if (live.has(id)) throw new Error('run is already resuming');
    const rec = await coordinator.record(id);
    if (rec?.gate && isAnswering(rec.agent, rec.gate.id)) throw new Error(`agent profile ${rec.agent!.profile} is answering this gate. Wait for it, or cancel the run`);
    // The refusals happen before anything runs, so they are checked here and
    // answered to the person, rather than surfacing from a background segment
    // as a run that quietly stayed waiting.
    const resolve = 'reject' in input ? { reject: input.reject ?? '' } : { answer: input.answer };
    await coordinator.checkResume({ runId: id, input: resolve });
    if (!rec) return;
    const l: Live = { id, file: rec.filePath, name: rec.workflowName, params: rec.params, startedAt: at(rec.createdAt), status: 'running', events: [], abort: new AbortController() };
    void drive(l, (onEvent) => coordinator.resume({ runId: id, input: resolve }, { onEvent, abortSignal: l.abort.signal }));
  }

  async function cancel(id: string): Promise<void> {
    if (debug.get(id)) { await debug.abort(id).catch(() => undefined); return; }
    const l = live.get(id);
    if (l?.status === 'running') { l.abort.abort(); return; }
    if ((await coordinator.record(id))?.status === 'waiting') {
      await coordinator.cancel(id);
      await changed(id);
    }
  }

  /** Runs of one workflow, or all: what is in flight here, then the store, newest first. */
  async function list(file: string, name: string): Promise<Json[]> {
    const inFlight = [
      ...debug.list().filter((d) => (!file || d.file === file) && (!name || d.name === name)).map((d) => debugSnapshot(d, debugSource.get(d.id))),
      ...(await Promise.all([...live.values()].filter((l) => (!file || l.file === file) && (!name || l.name === name)).map(async (l) => (await snapshot(l.id))!))),
    ];
    const stored = (file ? await coordinator.list({ filePath: file }) : await storeList())
      .filter((s) => (!name || s.workflowName === name) && !live.has(s.runId))
      .map((s) => ({
        id: s.runId, file: s.filePath, name: s.workflowName, status: s.status, params: s.params, mocks: s.mocks, source: s.source,
        startedAt: at(s.createdAt), updatedAt: at(s.updatedAt), gate: s.gate, failedAt: s.failedNode, origin: s.origin,
        due: s.due ? { at: at(s.due.at), action: s.due.action } : undefined,
      }));
    // Runs accumulate indefinitely; a list of hundreds is not history a
    // person reads. What is in flight is never dropped.
    return [...inFlight, ...stored].sort((a, b) => (b.startedAt as number) - (a.startedAt as number)).filter((r, i) => i < 20 || live.has(r.id as string) || debug.get(r.id as string));
  }

  /** Forget a run that is over. What is in flight is stopped first, with cancel. */
  async function remove(id: string): Promise<void> {
    if (live.has(id) || debug.get(id)) throw new Error('the run is in flight. Cancel it first');
    await coordinator.remove(id);
    await changed();
  }

  /**
   * Stream a run to a page: its state, what the store kept from earlier
   * segments, the segment in flight, and what the agent said where it
   * happened in time; then every change as it comes.
   */
  async function watch(id: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    sse(res);
    send(res, { type: 'run', run: await fullSnapshot(id) });
    const lines: Array<{ t: number; line: string }> = [];
    for (const entry of [...(await coordinator.trace(id)), ...(live.get(id)?.events ?? []), ...(debugEvents.get(id) ?? [])]) lines.push({ t: entry.t, line: JSON.stringify({ type: 'event', ...entry }) });
    for (const entry of agentEvents.get(id) ?? []) lines.push({ t: entry.t, line: JSON.stringify({ ...(entry.e as AgentGateEvent), t: entry.t }) });
    lines.sort((a, b) => a.t - b.t);
    for (const l of lines) res.write(`data: ${l.line}\n\n`);
    send(res, { type: 'synced' });
    const set = subs.get(id) ?? subs.set(id, new Set()).get(id)!;
    set.add(res);
    req.on('close', () => { set.delete(res); if (!set.size) subs.delete(id); });
  }

  /** A run with every event so far: the store's trace and the segment in flight. */
  async function withEvents(id: string): Promise<Json> {
    return { ...(await fullSnapshot(id)), events: [...(await coordinator.trace(id)), ...(live.get(id)?.events ?? [])] };
  }

  /** A person asking the profile to answer now: after it failed, or on a run started with agents off. */
  async function askAgent(id: string): Promise<string | undefined> {
    const rec = await coordinator.record(id);
    if (!rec || rec.status !== 'waiting' || rec.gate?.kind !== 'agent') return 'the run is not waiting at an agent gate';
    if (isAnswering(rec.agent, rec.gate.id)) return `${rec.agent!.profile} is already answering`;
    void afterSegment(id, true);
    return undefined;
  }

  /**
   * Keep up with runs changed elsewhere. The file store is watched; a store
   * of the caller's own has nothing to watch, so it is asked now and then.
   * And the clock: a sleeping run wakes, a gate with a timeout gives up,
   * without anyone at the console. Runs the server also ticks are moved
   * once; the claim decides who, and the other side sees the record change.
   */
  let storeWatcher: FSWatcher | undefined;
  let storePoll: NodeJS.Timeout | undefined;
  async function follow(opts: { watching: boolean; runsDir?: string }): Promise<void> {
    if (opts.watching && opts.runsDir) {
      fs.mkdirSync(opts.runsDir, { recursive: true });
      const chokidar = await import('chokidar');
      storeWatcher = chokidar.watch(opts.runsDir, { ignoreInitial: true, depth: 1 });
      storeWatcher.on('all', (_event, file) => {
        if (typeof file !== 'string' || path.basename(file) !== 'run.json') return;
        void changed(path.basename(path.dirname(file)));
      });
    } else if (opts.watching) {
      let seen = new Map<string, string>();
      storePoll = setInterval(() => {
        void coordinator.list().then((rows) => {
          const now = new Map(rows.map((r) => [r.runId, r.updatedAt]));
          const moved = rows.filter((r) => seen.get(r.runId) !== r.updatedAt).map((r) => r.runId);
          const gone = [...seen.keys()].some((id) => !now.has(id));
          seen = now;
          if (!moved.length && !gone) return;
          listed = undefined;
          broadcast({ type: 'runs' });
          for (const id of moved) if (!live.has(id)) void pushRun(id);
        }).catch(() => undefined);
      }, 3000);
      storePoll.unref?.();
    }
  }
  const clock = setInterval(() => {
    void coordinator.tick().then(async (moved) => {
      for (const run of [...moved.woke, ...moved.timedOut]) {
        await changed(run.runId);
        void afterSegment(run.runId);
      }
    }).catch(() => undefined);
  }, 3000);
  clock.unref?.();

  return {
    debug,
    /** The stored record, as the coordinator has it. */
    record: (id: string) => coordinator.record(id),
    /** A document kept beside the run. */
    kept: (id: string, name: string) => coordinator.kept(id, name),
    snapshot,
    list,
    start,
    startDebug,
    resume,
    cancel,
    remove,
    watch,
    withEvents,
    askAgent,
    follow,
    waitingCounts,
    withWaiting,
    /** A value set in a paused session, told to the pages that read values from the trace. */
    announce: push,
    /** Keep the run streams open through proxies. */
    ping(): void {
      for (const set of subs.values()) for (const res of set) res.write(': ping\n\n');
    },
    async close(): Promise<void> {
      clearInterval(clock);
      if (storePoll) clearInterval(storePoll);
      await storeWatcher?.close();
      for (const set of subs.values()) for (const res of set) res.end();
    },
  };
}
