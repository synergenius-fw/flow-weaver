/**
 * The control around an agent gate, on a coordinator stand-in: when a
 * profile is asked at all, why the automatic loop stops, how an answer that
 * does not fit is recorded, and which answers in progress count as
 * abandoned. The model itself is never called here.
 */
import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import {
  agentOwnerDead,
  isAnswering,
  transcriptName,
  reclaimStaleAgentAnswers,
  answerAgentGate,
  autoAnswerAgentGates,
  noteAnswerMisfit,
} from '../../../src/coordinator/agent-gate.js';
import { MissingOutputsError, InvalidAnswerError } from '../../../src/coordinator/gate-resolution.js';
import { RunBusyError } from '../../../src/coordinator/store.js';
import type { LocalCoordinator, RunRecord, RunView, AgentNote, ResumeRequest } from '../../../src/coordinator/run-store.js';
import type { AgentProfiles } from '../../../src/agent/profiles.js';

const HOUR = 60 * 60 * 1000;
/** A pid no process has: above the largest pid Linux and macOS hand out. */
const GONE_PID = 4_194_305;

function note(overrides: Partial<AgentNote> = {}): AgentNote {
  return { gateId: 'g1', node: 'ask', profile: 'p', provider: 'anthropic', status: 'answering', startedAt: new Date().toISOString(), owner: { pid: process.pid, host: os.hostname() }, ...overrides };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    formatVersion: 1, runId: 'r1', filePath: '/w.ts', workflowName: 'wf', params: {}, bundleDigest: 'sha256:x', status: 'waiting',
    gate: { id: 'g1', kind: 'agent', node: 'ask', nodeType: 'waitForAgent', inputs: {}, absent: [], outputs: ['agentResult'], hasSuccessPort: true, hasFailurePort: true },
    createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A coordinator stand-in over a map of records, with the calls it saw. */
function fake(records: RunRecord[], hooks: { setAgent?: (runId: string, n: AgentNote | undefined) => void; resume?: (r: ResumeRequest) => Promise<RunView> } = {}) {
  const byId = new Map(records.map((r) => [r.runId, r]));
  const calls: string[] = [];
  const view = (r: RunRecord): RunView => ({ status: r.status, runId: r.runId, workflowName: r.workflowName });
  const coordinator = {
    async list() { return [...byId.values()].map((r) => ({ ...view(r), agent: r.agent })); },
    async record(runId: string) { return byId.get(runId); },
    async get(runId: string) { const r = byId.get(runId); return r && view(r); },
    async setAgent(runId: string, n: AgentNote | undefined) {
      calls.push(`setAgent ${runId} ${n?.status}`);
      hooks.setAgent?.(runId, n);
      const r = byId.get(runId)!;
      byId.set(runId, { ...r, agent: n });
      return byId.get(runId)!;
    },
    async keep(runId: string, name: string) { calls.push(`keep ${runId} ${name}`); },
    async resume(request: ResumeRequest) {
      calls.push(`resume ${request.runId} ${JSON.stringify(request.input)}`);
      if (hooks.resume) return hooks.resume(request);
      const r = byId.get(request.runId)!;
      byId.set(request.runId, { ...r, status: 'completed', gate: undefined });
      return view(byId.get(request.runId)!);
    },
  };
  return { coordinator: coordinator as unknown as LocalCoordinator, calls, byId };
}

const NO_PROFILES: AgentProfiles = { file: '/p/agents.yaml', exists: false, agents: {}, gates: {}, errors: [] };
const ONE_PROFILE: AgentProfiles = { file: '/p/agents.yaml', exists: true, agents: { p: { name: 'p', provider: 'anthropic' } }, default: 'p', gates: {}, errors: [] };

describe('who is answering', () => {
  it('names a gate\'s transcript by the start of its id', () => {
    expect(transcriptName('0123456789abcdefXYZ')).toBe('agent-0123456789abcdef');
  });

  it('trusts an answer on another host, or with no owner, for an hour', () => {
    const start = Date.parse('2030-01-01T00:00:00.000Z');
    const elsewhere = note({ startedAt: new Date(start).toISOString(), owner: { pid: GONE_PID, host: `not-${os.hostname()}` } });
    expect(agentOwnerDead(elsewhere, start + HOUR)).toBe(false);
    expect(agentOwnerDead(elsewhere, start + HOUR + 1)).toBe(true);
    const ownerless = note({ startedAt: new Date(start).toISOString(), owner: undefined });
    expect(agentOwnerDead(ownerless, start + HOUR)).toBe(false);
    expect(agentOwnerDead(ownerless, start + HOUR + 1)).toBe(true);
  });

  it('asks the process on this host whether it is still there', () => {
    expect(agentOwnerDead(note())).toBe(false);
    expect(agentOwnerDead(note({ owner: { pid: process.ppid, host: os.hostname() } }))).toBe(false);
    expect(agentOwnerDead(note({ owner: { pid: GONE_PID, host: os.hostname() } }))).toBe(true);
  });

  it('counts only a live answer to this very gate as answering', () => {
    expect(isAnswering(note(), 'g1')).toBe(true);
    expect(isAnswering(note(), 'g2')).toBe(false);
    expect(isAnswering(note({ status: 'answered' }), 'g1')).toBe(false);
    expect(isAnswering(note({ owner: { pid: GONE_PID, host: os.hostname() } }), 'g1')).toBe(false);
    expect(isAnswering(undefined, 'g1')).toBe(false);
  });
});

describe('reclaiming abandoned answers', () => {
  it('fails only a waiting run\'s answer whose process is gone', async () => {
    const { coordinator, calls, byId } = fake([
      run({ runId: 'dead', agent: note({ owner: { pid: GONE_PID, host: os.hostname() } }) }),
      run({ runId: 'alive', agent: note() }),
      run({ runId: 'done', status: 'completed', agent: note({ owner: { pid: GONE_PID, host: os.hostname() } }) }),
      run({ runId: 'answered', agent: note({ status: 'answered', owner: { pid: GONE_PID, host: os.hostname() } }) }),
      run({ runId: 'none' }),
    ]);
    expect(await reclaimStaleAgentAnswers(coordinator)).toEqual(['dead']);
    expect(calls).toEqual(['setAgent dead failed']);
    expect(byId.get('dead')?.agent).toMatchObject({ status: 'failed', error: 'the process answering this gate ended before it could answer' });
  });

  it('leaves a run another driver holds, and passes on any other failure', async () => {
    const dead = note({ owner: { pid: GONE_PID, host: os.hostname() } });
    const busy = fake([run({ runId: 'a', agent: dead }), run({ runId: 'b', agent: dead })], { setAgent: (id) => { if (id === 'a') throw new RunBusyError(id); } });
    expect(await reclaimStaleAgentAnswers(busy.coordinator)).toEqual(['b']);
    const broken = fake([run({ agent: dead })], { setAgent: () => { throw new Error('disk full'); } });
    await expect(reclaimStaleAgentAnswers(broken.coordinator)).rejects.toThrow('disk full');
  });
});

describe('asking a profile', () => {
  const ask = (rec: RunRecord | undefined, profiles = ONE_PROFILE, env: NodeJS.ProcessEnv = {}) =>
    answerAgentGate(fake(rec ? [rec] : []).coordinator, 'r1', { projectDir: '/p', profiles, env });

  it('skips a run that is not waiting at an agent gate, or that a person answers', async () => {
    expect(await ask(undefined)).toEqual({ kind: 'skip', why: 'not-waiting' });
    expect(await ask(run({ status: 'completed' }))).toEqual({ kind: 'skip', why: 'not-waiting' });
    expect(await ask(run({ gate: undefined }))).toEqual({ kind: 'skip', why: 'not-waiting' });
    expect(await ask(run({ gate: { ...run().gate!, kind: 'approval' } }))).toEqual({ kind: 'skip', why: 'not-agent' });
    expect(await ask(run({ agents: 'manual' }))).toEqual({ kind: 'skip', why: 'manual' });
    expect(await ask(run({ agent: note() }))).toEqual({ kind: 'skip', why: 'already-answering' });
    expect(await ask(run(), NO_PROFILES)).toEqual({ kind: 'skip', why: 'no-profile' });
  });

  it('records a profile that cannot run as failed, saying why, and leaves the gate waiting', async () => {
    const { coordinator, byId } = fake([run()]);
    const step = await answerAgentGate(coordinator, 'r1', { projectDir: '/p', profiles: ONE_PROFILE, env: {} });
    expect(step).toMatchObject({ kind: 'not-ready', profile: 'p', reason: 'ANTHROPIC_API_KEY is not set in the environment' });
    expect(byId.get('r1')).toMatchObject({ status: 'waiting', agent: { status: 'failed', error: 'ANTHROPIC_API_KEY is not set in the environment', gateId: 'g1', node: 'ask', profile: 'p' } });
  });
});

describe('answering automatically', () => {
  const auto = (records: RunRecord[], hooks: Parameters<typeof fake>[1] = {}, extra: { maxChain?: number } = {}) => {
    const f = fake(records, hooks);
    return { result: autoAnswerAgentGates(f.coordinator, 'r1', { projectDir: '/p', profiles: ONE_PROFILE, env: {}, ...extra }), ...f };
  };

  it('stops at once for a run that has ended, and refuses an unknown one', async () => {
    expect((await auto([run({ status: 'failed', gate: undefined })]).result).stop).toBe('failed');
    await expect(auto([]).result).rejects.toThrow('no run with id r1');
  });

  it('stops for a person at a gate a profile does not answer', async () => {
    expect((await auto([run({ gate: { ...run().gate!, kind: 'approval' } })]).result).stop).toBe('waiting-human');
    expect((await auto([run({ agents: 'manual' })]).result).stop).toBe('manual');
    expect((await auto([run({ agent: note() })]).result).stop).toBe('waiting-human');
    const f = fake([run()]);
    expect((await autoAnswerAgentGates(f.coordinator, 'r1', { projectDir: '/p', profiles: NO_PROFILES, env: {} })).stop).toBe('no-profile');
  });

  it('stops when the profile cannot run, showing the run as it is now', async () => {
    const { result } = auto([run()]);
    const r = await result;
    expect(r.stop).toBe('not-ready');
    expect(r.run).toEqual({ status: 'waiting', runId: 'r1', workflowName: 'wf' });
  });

  it('gives up after the chain limit', async () => {
    const r = await auto([run()], {}, { maxChain: 0 }).result;
    expect(r).toEqual({ stop: 'chain-limit', run: { status: 'waiting', runId: 'r1', workflowName: 'wf' } });
  });
});

describe('an answer that does not fit the gate', () => {
  it('is recorded as the profile\'s failure, and the gate stays waiting', async () => {
    const { coordinator, byId } = fake([run({ agent: note({ status: 'answered' }) })]);
    expect(await noteAnswerMisfit(coordinator, 'r1', new MissingOutputsError(['agentResult']))).toBe(true);
    expect(byId.get('r1')?.agent).toMatchObject({ status: 'failed', error: 'the answer did not fit the gate: answer is missing gate outputs: agentResult' });
    expect(await noteAnswerMisfit(coordinator, 'r1', new InvalidAnswerError('not JSON'))).toBe(true);
    expect(byId.get('r1')?.agent?.error).toBe('the answer did not fit the gate: not JSON');
  });

  it('is not claimed for any other failure, or a run with no agent note', async () => {
    const { coordinator, calls } = fake([run()]);
    expect(await noteAnswerMisfit(coordinator, 'r1', new Error('boom'))).toBe(false);
    expect(await noteAnswerMisfit(coordinator, 'r1', new MissingOutputsError(['x']))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('is still claimed when another driver holds the run, and other write failures are passed on', async () => {
    const busy = fake([run({ agent: note({ status: 'answered' }) })], { setAgent: () => { throw new RunBusyError('r1'); } });
    expect(await noteAnswerMisfit(busy.coordinator, 'r1', new MissingOutputsError(['x']))).toBe(true);
    const broken = fake([run({ agent: note({ status: 'answered' }) })], { setAgent: () => { throw new Error('disk full'); } });
    await expect(noteAnswerMisfit(broken.coordinator, 'r1', new MissingOutputsError(['x']))).rejects.toThrow('disk full');
  });
});
