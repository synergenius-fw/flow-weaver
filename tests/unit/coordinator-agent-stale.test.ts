/**
 * A profile answering a gate records which process is doing it. When that
 * process is gone -- a crash mid-answer -- the gate must not stay locked:
 * the note is treated as failed and a person or the next process may
 * answer. A live process's answer in progress is left alone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalCoordinator, isAnswering, agentOwnerDead, reclaimStaleAgentAnswers, type AgentNote, type LocalCoordinator } from '../../src/coordinator/index.js';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'continuation', 'fixtures', 'durable-approval.ts');

let runsDir: string;
let coordinator: LocalCoordinator;
let runId: string;
let gateId: string;

/** A pid no process has: far above the usual range, and probed to be sure. */
function deadPid(): number {
  for (let pid = 4_000_000; pid < 4_000_100; pid++) {
    try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') return pid; }
  }
  throw new Error('no free pid found');
}

beforeAll(async () => {
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-stale-'));
  coordinator = createLocalCoordinator({ rootDir: runsDir });
  const view = await coordinator.start({ filePath: fixture, params: { value: 1 } });
  runId = view.runId;
  gateId = (await coordinator.record(runId))!.gate!.id;
}, 60000);

afterAll(() => { fs.rmSync(runsDir, { recursive: true, force: true }); });

const note = (over: Partial<AgentNote>): AgentNote => ({ gateId, node: 'approval', profile: 'p', provider: 'anthropic', status: 'answering', startedAt: new Date().toISOString(), ...over });

describe('an answer in progress and its owner', () => {
  it('is left alone while its process lives', async () => {
    await coordinator.setAgent(runId, note({ owner: { pid: process.pid, host: os.hostname() } }));
    const rec = (await coordinator.record(runId))!;
    expect(agentOwnerDead(rec.agent!)).toBe(false);
    expect(isAnswering(rec.agent, gateId)).toBe(true);
    expect(await reclaimStaleAgentAnswers(coordinator)).toEqual([]);
    expect((await coordinator.record(runId))!.agent!.status).toBe('answering');
  });

  it('is reclaimed as failed when its process is gone', async () => {
    await coordinator.setAgent(runId, note({ owner: { pid: deadPid(), host: os.hostname() } }));
    const rec = (await coordinator.record(runId))!;
    expect(agentOwnerDead(rec.agent!)).toBe(true);
    expect(isAnswering(rec.agent, gateId)).toBe(false);
    expect(await reclaimStaleAgentAnswers(coordinator)).toEqual([runId]);
    const after = (await coordinator.record(runId))!.agent!;
    expect(after.status).toBe('failed');
    expect(after.error).toContain('ended before it could answer');
    expect(after.endedAt).toBeDefined();
  });

  it('trusts a note with no owner, or from another host, for an hour', () => {
    const recent = note({});
    expect(agentOwnerDead(recent)).toBe(false);
    const old = note({ startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });
    expect(agentOwnerDead(old)).toBe(true);
    const elsewhere = note({ owner: { pid: process.pid, host: 'some-other-host' } });
    expect(agentOwnerDead(elsewhere)).toBe(false);
    expect(agentOwnerDead({ ...elsewhere, startedAt: old.startedAt })).toBe(true);
  });

  it('does not count a note for another gate, or one already finished', () => {
    expect(isAnswering(note({ gateId: 'other' }), gateId)).toBe(false);
    expect(isAnswering(note({ status: 'answered' }), gateId)).toBe(false);
    expect(isAnswering(undefined, gateId)).toBe(false);
  });
});
