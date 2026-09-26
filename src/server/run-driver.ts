/**
 * Driving runs from HTTP: the segments this process has in flight, and
 * everything that follows one. It decides when a new segment is admitted
 * (the in-flight limit), starts and resumes runs in the shared store,
 * cancels them, lets the clock wake sleeping runs and time out gates, and,
 * when a segment ends, either answers the agent gate it reached from the
 * project's profiles or has the finished run's callback delivered. Every
 * state change is announced to the streams following the run and to the
 * embedding's `onRun`.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  answerAgentGate,
  noteAnswerMisfit,
  isAnswering,
  RunNotFoundError,
  type LocalCoordinator,
  type RunRecord,
  type TraceEntry,
} from '../coordinator/index.js';
import { loadAgentProfiles, type AgentProfiles, type AgentProfile } from '../agent/profiles.js';
import type { AgentGateEvent } from '../agent/gate.js';
import type { AgentProvider } from '../agent/types.js';
import { gateOutputSchemas } from '../console/schema.js';
import { parseWorkflow } from '../api/parse.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { ExecutionTraceEvent } from '../mcp/workflow-executor.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { createCallbackDelivery, type CallbackOutcome } from './callback-delivery.js';
import type { CallbackPolicy } from './callback-url.js';
import { HttpError } from './http-error.js';
import type { Json } from './respond.js';
import { runView, dataOf, type InFlightRun } from './run-view.js';
import type { ServerRequest, ServerResponse } from './transport.js';
import type { RunResponse, WorkflowEndpoint } from './types.js';

/** A segment in flight here. */
interface Live extends InFlightRun {
  id: string;
  events: TraceEntry[];
  abort: AbortController;
}
interface AgentEntry { t: number; e: AgentGateEvent }

export interface RunDriverOptions {
  /** The project: agent profiles are read from its `.flowweaver/agents.yaml`. */
  dir: string;
  coordinator: LocalCoordinator;
  /** The function names of the workflows served here; the run list shows only their runs. */
  workflowNames(): Set<string>;
  /** Answer agent gates from the profiles. */
  agents: boolean;
  env?: NodeJS.ProcessEnv;
  agentProvider?: (profile: AgentProfile, env: NodeJS.ProcessEnv) => AgentProvider;
  trace?: boolean;
  origin?: string;
  maxInFlight: number;
  onRun?: (run: RunResponse) => void;
  /** Which URLs callbacks go to, and the token that signs them. */
  callbacks?: CallbackPolicy;
  token?: string;
  onCallback?: (outcome: CallbackOutcome) => void;
}

export type RunDriver = ReturnType<typeof createRunDriver>;

export function createRunDriver(opts: RunDriverOptions) {
  const { dir, coordinator } = opts;
  const live = new Map<string, Live>();
  const agentEvents = new Map<string, AgentEntry[]>();
  const subs = new Map<string, Set<ServerResponse>>();
  let profilesCache: { mtime: number; profiles: AgentProfiles } | undefined;
  const callbacks = createCallbackDelivery({
    coordinator,
    policy: opts.callbacks,
    token: opts.token,
    inFlight: (id) => live.has(id),
    outputs: (result) => dataOf(result),
    onCallback: opts.onCallback,
  });

  function profiles(): AgentProfiles {
    const file = path.join(dir, '.flowweaver', 'agents.yaml');
    let mtime: number;
    try { mtime = fs.statSync(file).mtimeMs; } catch { mtime = 0; }
    if (!profilesCache || profilesCache.mtime !== mtime) profilesCache = { mtime, profiles: loadAgentProfiles(dir) };
    return profilesCache.profiles;
  }

  async function snapshot(id: string, base = ''): Promise<RunResponse | undefined> {
    const l = live.get(id);
    const rec = await coordinator.record(id);
    return runView(id, base, l, rec);
  }

  async function listRuns(workflow: string | undefined, base: string): Promise<{ count: number; runs: RunResponse[] }> {
    const seen = new Set<string>();
    const runs: RunResponse[] = [];
    for (const l of live.values()) {
      if (workflow && l.workflow !== workflow) continue;
      const s = await snapshot(l.id, base); if (s) { runs.push(s); seen.add(l.id); }
    }
    const names = opts.workflowNames();
    for (const r of await coordinator.list()) {
      if (seen.has(r.runId) || !names.has(r.workflowName)) continue;
      if (workflow && r.workflowName !== workflow) continue;
      const s = await snapshot(r.runId, base); if (s) runs.push(s);
    }
    runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { count: runs.length, runs };
  }

  function push(id: string, msg: Json): void {
    const set = subs.get(id);
    if (!set?.size) return;
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of set) res.write(line);
  }

  /** The run changed state: tell the streams and the embedding. */
  async function announce(id: string): Promise<void> {
    const run = await snapshot(id);
    push(id, { type: 'run', run: run });
    if (run) { try { opts.onRun?.(run); } catch { /* the hook's problem */ } }
  }

  async function drive(l: Live, segment: (l: Live, onEvent: (ev: ExecutionTraceEvent) => void) => Promise<unknown>): Promise<void> {
    live.set(l.id, l);
    const onEvent = (ev: ExecutionTraceEvent) => {
      const entry = { t: ev.timestamp, e: ev.data ?? ev };
      l.events.push(entry);
      push(l.id, { type: 'event', ...entry });
    };
    try {
      await segment(l, onEvent);
      live.delete(l.id);
    } catch (err) {
      if (await coordinator.record(l.id)) live.delete(l.id);
      else l.error = getErrorMessage(err);
    }
    await announce(l.id);
    void afterSegment(l.id);
  }

  /** A segment ended: a finished run owes its callback, and an agent gate is answered when agents are on. */
  async function afterSegment(id: string): Promise<void> {
    const rec = await coordinator.record(id);
    if (!rec) return;
    if (rec.status === 'completed' || rec.status === 'failed' || rec.status === 'cancelled') { void callbacks.deliver(id); return; }
    if (!opts.agents || rec.status !== 'waiting' || rec.gate?.kind !== 'agent') return;
    try {
      const step = await answerAgentGate(coordinator, id, {
        projectDir: dir,
        env: opts.env,
        profiles: profiles(),
        provider: opts.agentProvider,
        outputSchema: (r) => outputShape(r),
        onEvent: (e) => {
          const entry = { t: Date.now(), e };
          (agentEvents.get(id) ?? agentEvents.set(id, []).get(id)!).push(entry);
          push(id, { ...e, t: entry.t });
        },
      });
      await announce(id);
      if (step.kind === 'answer') await resume(id, { answer: step.answer });
      else if (step.kind === 'reject') await resume(id, { reject: step.reason });
    } catch (err) {
      if (await noteAnswerMisfit(coordinator, id, err)) await announce(id);
    }
  }

  /** The schema and TypeScript types of the outputs an agent gate asks for. */
  async function outputShape(rec: RunRecord) {
    try {
      const parsed = await parseWorkflow(rec.filePath, { workflowName: rec.workflowName, projectDir: path.dirname(rec.filePath) });
      if (parsed.errors.length || !rec.gate) return undefined;
      const inst = parsed.ast.instances.find((i) => i.id === rec.gate!.node);
      const nt = inst ? parsed.ast.nodeTypes.find((n) => n.name === inst.nodeType) ?? parsed.ast.nodeTypes.find((n) => n.functionName === inst.nodeType) : undefined;
      const types = Object.fromEntries(rec.gate.outputs.map((o) => [o, nt?.outputs?.[o]?.tsType ?? 'unknown']));
      return { schema: gateOutputSchemas(parsed.ast, rec.gate.node, rec.filePath), types };
    } catch { return undefined; }
  }

  /** Refuse a new segment when the server is at its limit. */
  function admit(): void {
    if (live.size >= opts.maxInFlight) throw new HttpError(503, 'BUSY', `${live.size} runs are in flight, the limit here. Try again shortly`, undefined, { 'Retry-After': '2' });
  }

  async function start(endpoint: WorkflowEndpoint, id: string, params: Json, mocks: FwMockConfig | undefined): Promise<void> {
    await drive({ id, workflow: endpoint.name, params, startedAt: Date.now(), events: [], abort: new AbortController() }, (l, onEvent) =>
      coordinator.start(
        { filePath: endpoint.filePath, workflowName: endpoint.functionName, params, runId: id, mocks, agents: opts.agents ? 'auto' : 'manual', origin: opts.origin ?? 'http' },
        { onEvent, trace: opts.trace === true, abortSignal: l.abort.signal },
      ));
  }

  async function resume(id: string, input: { answer?: unknown } | { reject: string }): Promise<void> {
    if (live.has(id)) throw new HttpError(409, 'RUN_IN_FLIGHT', 'the run is already resuming');
    const rec = await coordinator.record(id);
    if (rec?.gate && isAnswering(rec.agent, rec.gate.id)) throw new HttpError(409, 'AGENT_ANSWERING', `agent profile ${rec.agent!.profile} is answering this gate`);
    const resolve = 'reject' in input ? { reject: input.reject } : { answer: input.answer };
    await coordinator.checkResume({ runId: id, input: resolve });
    if (!rec) throw new RunNotFoundError(id);
    await drive({ id, workflow: rec.workflowName, params: rec.params, startedAt: Date.parse(rec.createdAt), events: [], abort: new AbortController() }, (l, onEvent) =>
      coordinator.resume({ runId: id, input: resolve }, { onEvent, trace: opts.trace === true, abortSignal: l.abort.signal }));
  }

  async function cancel(id: string): Promise<void> {
    const l = live.get(id);
    if (l) { l.abort.abort(); return; }
    if ((await coordinator.record(id))?.status === 'waiting') {
      await coordinator.cancel(id);
      await announce(id);
      void callbacks.deliver(id);
    }
  }

  /**
   * Let the clock act. A run it moved is announced and followed like a
   * segment a request drove -- an agent gate it reached is answered, a
   * finished run owes its callback.
   */
  async function tick(): Promise<void> {
    let moved;
    try { moved = await coordinator.tick(); } catch { return; }
    for (const run of [...moved.woke, ...moved.timedOut]) {
      await announce(run.runId);
      await afterSegment(run.runId);
    }
  }

  /** Stream the run: its state, what it has done so far, a synced marker, then every change as it happens. */
  async function follow(req: ServerRequest, res: ServerResponse, id: string, base: string): Promise<void> {
    const first = await snapshot(id, base);
    const kept = await coordinator.trace(id);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'run', run: first })}\n\n`);
    const entries: Array<{ t: number; line: string }> = [];
    for (const e of [...kept, ...(live.get(id)?.events ?? [])]) entries.push({ t: e.t, line: JSON.stringify({ type: 'event', ...e }) });
    for (const a of agentEvents.get(id) ?? []) entries.push({ t: a.t, line: JSON.stringify({ ...a.e, t: a.t }) });
    entries.sort((a, b) => a.t - b.t);
    for (const e of entries) res.write(`data: ${e.line}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'synced' })}\n\n`);
    const set = subs.get(id) ?? subs.set(id, new Set()).get(id)!;
    set.add(res);
    req.on('close', () => { set.delete(res); if (!set.size) subs.delete(id); });
  }

  return {
    callbacks,
    admit,
    start,
    resume,
    cancel,
    tick,
    snapshot,
    listRuns,
    follow,
    /** The parameters of a run this process is driving, before the store has its record. */
    inFlightParams: (id: string) => live.get(id)?.params,
    /** Stop what is in flight and end every stream. */
    close(): void {
      for (const l of live.values()) l.abort.abort();
      for (const set of subs.values()) for (const res of set) res.end();
      subs.clear();
    },
  };
}
