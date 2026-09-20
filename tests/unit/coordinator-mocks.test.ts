/**
 * What the console needs from the run store beyond start and resume: a run
 * started with mocks goes through its built-in gates unattended and keeps
 * the mocks for later segments; a failed run remembers the step that threw;
 * a finished run can be forgotten.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLocalCoordinator, RunNotWaitingError, RunNotFoundError } from '../../src/coordinator/index.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'continuation', 'fixtures');
const agent = path.join(fixtures, 'durable-agent-labeled.ts');
const approval = path.join(fixtures, 'durable-approval.ts');

const THROWING = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input v - Value
 * @output v - Value
 */
export function boom(v: number): { v: number } { throw new Error('boom ' + v); }
/**
 * @flowWeaver workflow
 * @param v - Value
 * @returns v - Value
 * @node b boom
 * @path Start -> b -> Exit
 */
export async function failing(execute: boolean, params: { v: number }): Promise<{ onSuccess: boolean; onFailure: boolean; v: number }> {
  throw new Error('generated body was not installed');
}
`;

let rootDir: string;
beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-runs-')); });
afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }); });

describe('run store: mocks, the failed step, removal', () => {
  it('runs through a built-in gate with a mock keyed by node, and keeps the mocks on the record', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const mocks = { agents: { 'agent:*': { summary: 'looks fine', risk: 'low' } } };
    const done = await coordinator.start({ filePath: agent, params: { path: 'a.ts', text: 'x' }, mocks });
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ report: expect.stringContaining('risk: low') });
    expect(coordinator.record(done.runId)?.mocks).toEqual(mocks);
    // Without them the same run waits for the agent.
    const waiting = await coordinator.start({ filePath: agent, params: { path: 'a.ts', text: 'x' } });
    expect(waiting.status).toBe('waiting');
    expect(coordinator.record(waiting.runId)?.mocks).toBeUndefined();
  }, 60000);

  it('answers an authored gate from `gates`, keyed by node, as a person would have', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    const out = coordinator.record(paused.runId)!.gate!.outputs;
    expect(out).toHaveLength(1);
    const done = await coordinator.start({ filePath: approval, params: { value: 4 }, mocks: { gates: { approval: { [out[0]]: 8 } } } });
    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ onSuccess: true, onFailure: false, result: 9 });
  }, 60000);

  it('records the step that threw when the trace was kept', async () => {
    const file = path.join(rootDir, 'failing.ts');
    fs.writeFileSync(file, THROWING);
    const coordinator = createLocalCoordinator({ rootDir });
    await expect(coordinator.start({ filePath: file, params: { v: 1 } }, { trace: true })).rejects.toThrow(/boom 1/);
    const rec = coordinator.list({ filePath: file }).map((s) => coordinator.record(s.runId)!)[0];
    expect(rec.status).toBe('failed');
    expect(rec.failedNode).toBe('b');
    expect(rec.error).toContain('boom 1');
  }, 60000);

  it('forgets a finished run, but not one waiting at a gate', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    expect(() => coordinator.remove(paused.runId)).toThrow(RunNotWaitingError);
    coordinator.cancel(paused.runId);
    coordinator.remove(paused.runId);
    expect(coordinator.get(paused.runId)).toBeUndefined();
    expect(fs.existsSync(path.join(rootDir, paused.runId))).toBe(false);
    expect(() => coordinator.remove('nope')).toThrow(RunNotFoundError);
  }, 60000);
});
