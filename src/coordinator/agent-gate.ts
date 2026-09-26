/**
 * An agent gate answered by a profile, through the coordinator.
 *
 * The engine yields at `waitForAgent` and keeps nothing. The coordinator
 * holds the run, and somebody must supply `agentResult`. This is that somebody
 * when a profile in `.flowweaver/agents.yaml` matches the gate: it looks the
 * profile up, records on the run that an answer is being worked out, calls
 * the model (`src/agent/gate.ts`), keeps the transcript beside the run, and
 * records what came of it. Resuming is left to the driver -- the console
 * drives its own segments so it can stream them, and `autoAnswerAgentGates`
 * below does it for callers with no such needs, `fw serve` among them.
 *
 * A gate with no matching profile, a profile that is not ready, or a model
 * that never submits leaves the run exactly as it was: waiting, for a
 * person. Nothing here can lose a run.
 */
import * as os from 'node:os';
import type { LocalCoordinator, RunRecord, RunView, DriveOptions, AgentNote } from './run-store.js';
import { RunBusyError } from './store.js';
import { MissingOutputsError, InvalidAnswerError } from './gate-resolution.js';
import { loadAgentProfiles, profileForGate, readiness, DEFAULT_MODEL, type AgentProfile, type AgentProfiles } from '../agent/profiles.js';
import { answerGate, type AgentGateEvent, type FieldSchema, type GateOutcome, type GateUsage } from '../agent/gate.js';
import type { AgentMessage, AgentProvider } from '../agent/types.js';

export interface AgentGateOptions {
  /** Where `.flowweaver/agents.yaml` is looked for, and the CLI provider's working directory. */
  projectDir: string;
  env?: NodeJS.ProcessEnv;
  /** Already-loaded profiles, when the caller caches them. */
  profiles?: AgentProfiles;
  /** The shape of the gate's outputs, when the caller can derive it from the workflow's types. */
  outputSchema?: (record: RunRecord) => Promise<{ schema: Record<string, FieldSchema> | null; types?: Record<string, string> } | undefined> | { schema: Record<string, FieldSchema> | null; types?: Record<string, string> } | undefined;
  /** The workflow's description, for the model's frame. */
  workflowDescription?: (record: RunRecord) => string | undefined;
  onEvent?: (event: AgentGateEvent) => void;
  signal?: AbortSignal;
  /** Build the provider yourself -- a test's fake, say -- instead of from the profile. */
  provider?: (profile: AgentProfile, env: NodeJS.ProcessEnv) => AgentProvider;
}

export type AgentGateStep =
  | { kind: 'skip'; why: 'not-waiting' | 'not-agent' | 'manual' | 'no-profile' | 'already-answering' }
  | { kind: 'not-ready'; profile: string; reason: string; note: AgentNote }
  | { kind: 'answer'; profile: string; answer: unknown; note: AgentNote }
  | { kind: 'reject'; profile: string; reason: string; note: AgentNote }
  | { kind: 'failed'; profile: string; error: string; note: AgentNote };

/** What is kept beside the run for one answered gate. */
export interface AgentTranscript {
  gateId: string;
  node: string;
  profile: string;
  provider: string;
  model?: string;
  startedAt: string;
  endedAt: string;
  ms: number;
  outcome: GateOutcome;
  usage: GateUsage;
  toolCalls: number;
  text: string;
  messages: AgentMessage[];
}

/** The document name a gate's transcript is kept under. */
export function transcriptName(gateId: string): string {
  return `agent-${gateId.slice(0, 16)}`;
}

/** An answer in progress with no owner recorded, or one on another host, counts as abandoned after this long. */
const ANSWER_ABANDONED_AFTER_MS = 60 * 60 * 1000;

/**
 * Whether the process that was answering is gone. On this host the pid is
 * probed; a note from another host, or one written before owners were
 * recorded, is trusted for an hour and then presumed abandoned.
 */
export function agentOwnerDead(note: AgentNote, now = Date.now()): boolean {
  const age = now - Date.parse(note.startedAt);
  if (!note.owner || note.owner.host !== os.hostname()) return age > ANSWER_ABANDONED_AFTER_MS;
  if (note.owner.pid === process.pid) return false;
  try { process.kill(note.owner.pid, 0); return false; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
}

/** Whether a profile is answering this gate right now -- not a crashed process's leftover. */
export function isAnswering(note: AgentNote | undefined, gateId: string): boolean {
  return !!note && note.status === 'answering' && note.gateId === gateId && !agentOwnerDead(note);
}

/**
 * Mark as failed every answer in progress whose process is gone, so the
 * gate is a person's or the next process's to answer instead of locked
 * forever. Called when a driver starts. Returns the runs it reclaimed.
 */
export async function reclaimStaleAgentAnswers(coordinator: LocalCoordinator): Promise<string[]> {
  const reclaimed: string[] = [];
  for (const s of await coordinator.list()) {
    if (s.status !== 'waiting' || s.agent?.status !== 'answering') continue;
    const rec = await coordinator.record(s.runId);
    if (!rec?.agent || rec.agent.status !== 'answering' || !agentOwnerDead(rec.agent)) continue;
    try {
      await coordinator.setAgent(s.runId, { ...rec.agent, status: 'failed', endedAt: new Date().toISOString(), error: 'the process answering this gate ended before it could answer' });
    } catch (e) {
      // A run being driven right now is moving past the gate anyway.
      if (e instanceof RunBusyError) continue;
      throw e;
    }
    reclaimed.push(s.runId);
  }
  return reclaimed;
}

/** Ask the matching profile to answer the run's current agent gate. Does not resume. */
export async function answerAgentGate(coordinator: LocalCoordinator, runId: string, opts: AgentGateOptions): Promise<AgentGateStep> {
  const rec = await coordinator.record(runId);
  if (!rec || rec.status !== 'waiting' || !rec.gate) return { kind: 'skip', why: 'not-waiting' };
  if (rec.gate.kind !== 'agent') return { kind: 'skip', why: 'not-agent' };
  if (rec.agents === 'manual') return { kind: 'skip', why: 'manual' };
  if (isAnswering(rec.agent, rec.gate.id)) return { kind: 'skip', why: 'already-answering' };

  const env = opts.env ?? process.env;
  const profiles = opts.profiles ?? loadAgentProfiles(opts.projectDir);
  const profile = profileForGate(profiles, { workflow: rec.workflowName, node: rec.gate.node, agentId: rec.gate.inputs.agentId });
  if (!profile) return { kind: 'skip', why: 'no-profile' };

  const startedAt = new Date().toISOString();
  const model = profile.model || DEFAULT_MODEL[profile.provider] || undefined;
  const base: AgentNote = { gateId: rec.gate.id, node: rec.gate.node, profile: profile.name, provider: profile.provider, model, status: 'answering', startedAt, owner: { pid: process.pid, host: os.hostname() } };

  const ready = readiness(profile, env);
  if (!ready.ready) {
    const note: AgentNote = { ...base, status: 'failed', endedAt: startedAt, error: ready.reason };
    await coordinator.setAgent(runId, note);
    return { kind: 'not-ready', profile: profile.name, reason: ready.reason ?? 'not ready', note };
  }

  await coordinator.setAgent(runId, base);
  const shape = await opts.outputSchema?.(rec);
  const result = await answerGate({
    gate: { node: rec.gate.node, inputs: rec.gate.inputs, absent: rec.gate.absent, outputs: rec.gate.outputs, hasFailurePort: rec.gate.hasFailurePort, outputSchema: shape?.schema ?? null, outputTypes: shape?.types },
    workflow: { name: rec.workflowName, description: opts.workflowDescription?.(rec) },
    profile,
    provider: opts.provider?.(profile, env),
    env,
    cwd: opts.projectDir,
    signal: opts.signal,
    onEvent: opts.onEvent,
  });

  const endedAt = new Date().toISOString();
  const transcript: AgentTranscript = {
    gateId: rec.gate.id, node: rec.gate.node, profile: profile.name, provider: profile.provider, model,
    startedAt, endedAt, ms: result.ms, outcome: result.outcome, usage: result.usage, toolCalls: result.toolCalls, text: result.text, messages: result.transcript,
  };
  // The run may have been cancelled while the model worked; then there is
  // nowhere to keep anything and nothing to answer.
  if (!(await coordinator.record(runId))) return { kind: 'skip', why: 'not-waiting' };
  await coordinator.keep(runId, transcriptName(rec.gate.id), transcript);

  const done = { ...base, endedAt, usage: result.usage, toolCalls: result.toolCalls };
  if (result.outcome.kind === 'answer') {
    const note: AgentNote = { ...done, status: 'answered' };
    await coordinator.setAgent(runId, note);
    return { kind: 'answer', profile: profile.name, answer: result.outcome.answer, note };
  }
  if (result.outcome.kind === 'reject') {
    const note: AgentNote = { ...done, status: 'rejected', error: result.outcome.reason };
    await coordinator.setAgent(runId, note);
    return { kind: 'reject', profile: profile.name, reason: result.outcome.reason, note };
  }
  const note: AgentNote = { ...done, status: 'failed', error: result.outcome.error };
  await coordinator.setAgent(runId, note);
  return { kind: 'failed', profile: profile.name, error: result.outcome.error, note };
}

export interface AutoAgentResult {
  /** Why the loop stopped: the run ended, or it needs a person. */
  stop: 'completed' | 'failed' | 'cancelled' | 'waiting-human' | 'manual' | 'no-profile' | 'not-ready' | 'agent-failed' | 'chain-limit';
  run: RunView;
}

/**
 * After a resume with a profile's answer failed: when the answer did not
 * fit the gate (outputs missing, or a value the gate cannot take), that is
 * the model's failure, not the run's, so it is recorded on the agent note
 * and the gate stays waiting for a person. Any other failure is left to the
 * caller. True when the failure was a misfit and has been recorded.
 */
export async function noteAnswerMisfit(coordinator: LocalCoordinator, runId: string, error: unknown): Promise<boolean> {
  if (!(error instanceof MissingOutputsError || error instanceof InvalidAnswerError)) return false;
  const agent = (await coordinator.record(runId))?.agent;
  if (!agent) return false;
  try {
    await coordinator.setAgent(runId, { ...agent, status: 'failed', error: `the answer did not fit the gate: ${error.message}` });
  } catch (e) {
    // Busy: another driver has the run, and its commit says what happened.
    if (!(e instanceof RunBusyError)) throw e;
  }
  return true;
}

/**
 * Answer agent gates and resume, again and again, until the run ends or
 * reaches something a person must do. A malformed answer -- the model
 * returned the wrong outputs -- is the model's failure, not the run's: it is
 * recorded on the note and the gate stays waiting.
 */
export async function autoAnswerAgentGates(
  coordinator: LocalCoordinator,
  runId: string,
  opts: AgentGateOptions & { drive?: DriveOptions; maxChain?: number },
): Promise<AutoAgentResult> {
  const max = opts.maxChain ?? 20;
  for (let i = 0; i < max; i++) {
    const view = await coordinator.get(runId);
    if (!view) throw new Error(`no run with id ${runId}`);
    if (view.status !== 'waiting') return { stop: view.status, run: view };
    const step = await answerAgentGate(coordinator, runId, opts);
    const now = async () => (await coordinator.get(runId)) ?? view;
    if (step.kind === 'skip') {
      const stop = step.why === 'manual' ? 'manual' : step.why === 'no-profile' ? 'no-profile' : step.why === 'not-agent' ? 'waiting-human' : step.why === 'not-waiting' ? ((await now()).status as AutoAgentResult['stop']) : 'waiting-human';
      return { stop, run: await now() };
    }
    if (step.kind === 'not-ready') return { stop: 'not-ready', run: await now() };
    if (step.kind === 'failed') return { stop: 'agent-failed', run: await now() };
    try {
      await coordinator.resume({ runId, input: step.kind === 'answer' ? { answer: step.answer } : { reject: step.reason } }, opts.drive);
    } catch (e) {
      if (await noteAnswerMisfit(coordinator, runId, e)) return { stop: 'agent-failed', run: await now() };
      throw e;
    }
  }
  return { stop: 'chain-limit', run: (await coordinator.get(runId))! };
}
