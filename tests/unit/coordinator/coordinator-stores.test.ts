/**
 * The run store contract, kept by both built-in stores. The coordinator
 * driving a gated workflow on a store that is not a directory. The
 * claim keeping two coordinators off the same run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalCoordinator, createFileRunStore, createMemoryRunStore, RunBusyError } from '../../../src/coordinator/index.js';
import { checkRunStore } from '../../../src/testing/run-store-check.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'continuation', 'fixtures');
const approval = path.join(fixtures, 'durable-approval.ts');
const effectGate = path.join(fixtures, 'durable-effect-gate.ts');

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-stores-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the run store contract', () => {
  it('is kept by the file store', async () => {
    await checkRunStore(() => createFileRunStore(dir));
  });

  it('is kept by the memory store', async () => {
    await checkRunStore(() => createMemoryRunStore());
  });

  it('keeps the file layout the console and the tools know', async () => {
    const store = createFileRunStore(dir);
    await store.putDoc('r1', 'continuation', { a: 1 });
    await store.putDoc('r1', 'trace', []);
    await store.putDoc('r1', 'effect-abc', { receipt: 1 });
    await store.putDoc('r1', 'http', { callbackUrl: 'x' });
    expect(fs.existsSync(path.join(dir, 'r1', 'continuation.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'r1', 'trace.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'r1', 'effects', 'abc.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'r1', 'http.json'))).toBe(true);
  });
});

describe('a coordinator on the memory store', () => {
  it('runs a gated workflow to its gate, keeps effect receipts, and resumes to completion', async () => {
    const store = createMemoryRunStore();
    const coordinator = createLocalCoordinator({ store });
    expect(coordinator.store).toBe(store);

    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } }, { trace: true });
    expect(paused.status).toBe('waiting');
    expect(await store.getDoc(paused.runId, 'continuation')).toBeDefined();
    expect((await coordinator.trace(paused.runId)).length).toBeGreaterThan(0);
    expect((await coordinator.list()).map((r) => r.runId)).toEqual([paused.runId]);

    const done = await coordinator.resume({ runId: paused.runId, input: { answer: 8 } });
    expect(done).toMatchObject({ status: 'completed', result: { result: 9 } });
    expect(await store.getDoc(paused.runId, 'continuation')).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual([]);   // nothing touched the disk

    const flag = '__a2_effect_gate_called__';
    delete (globalThis as Record<string, unknown>)[flag];
    const withEffect = await coordinator.start({ filePath: effectGate, params: { params: {} } });
    expect((globalThis as Record<string, unknown>)[flag]).toBe(true);
    const receipts = (await Promise.all(['continuation', 'trace'].map((n) => store.getDoc(withEffect.runId, n)))).filter(Boolean).length;
    expect(receipts).toBe(1);
    const finished = await coordinator.resume({ runId: withEffect.runId, input: { answer: 4 } });
    expect(finished.result).toEqual({ onSuccess: true, onFailure: false, value: 4 });
  });

  it('keeps documents, cancels, and removes through the store', async () => {
    const coordinator = createLocalCoordinator({ store: createMemoryRunStore() });
    const paused = await coordinator.start({ filePath: approval, params: { value: 1 } });
    await coordinator.keep(paused.runId, 'note', { hello: 1 });
    expect(await coordinator.kept(paused.runId, 'note')).toEqual({ hello: 1 });
    await expect(coordinator.keep(paused.runId, 'continuation', {})).rejects.toThrow('coordinator keeps itself');
    await expect(coordinator.remove(paused.runId)).rejects.toMatchObject({ name: 'RunNotWaitingError' });
    expect((await coordinator.cancel(paused.runId)).status).toBe('cancelled');
    await coordinator.remove(paused.runId);
    expect(await coordinator.get(paused.runId)).toBeUndefined();
  });
});

describe('claims', () => {
  it('refuse a resume while another process holds the run, and allow it once released', async () => {
    const store = createFileRunStore(dir);
    const coordinator = createLocalCoordinator({ store });
    const paused = await coordinator.start({ filePath: approval, params: { value: 2 } });
    // Another process, mid-segment on the same run.
    expect(await store.claim(paused.runId, 'other-process', 60_000)).toBe(true);
    await expect(coordinator.resume({ runId: paused.runId, input: { answer: 4 } })).rejects.toBeInstanceOf(RunBusyError);
    await expect(coordinator.cancel(paused.runId)).rejects.toBeInstanceOf(RunBusyError);
    await store.release(paused.runId, 'other-process');
    expect((await coordinator.resume({ runId: paused.runId, input: { answer: 4 } })).status).toBe('completed');
  });

  it('take over a lapsed claim by moving it aside, never by deleting it', async () => {
    const store = createFileRunStore(dir);
    fs.mkdirSync(path.join(dir, 'r1'), { recursive: true });
    const lapsed = { owner: 'dead-process', pid: 1, host: 'elsewhere', expiresAt: new Date(Date.now() - 1000).toISOString() };
    fs.writeFileSync(path.join(dir, 'r1', 'claim.json'), JSON.stringify(lapsed));

    expect(await store.claim('r1', 'me', 60_000)).toBe(true);
    expect(await store.claim('r1', 'someone-else', 60_000)).toBe(false);
    // The lapsed claim was renamed, not unlinked, so a second taker's rename
    // fails instead of deleting the winner's claim; and nothing is left behind.
    expect(fs.readdirSync(path.join(dir, 'r1')).filter((f) => f.startsWith('claim'))).toEqual(['claim.json']);
  });

  it('are released after a segment, including one that failed', async () => {
    const store = createMemoryRunStore();
    const coordinator = createLocalCoordinator({ store });
    const abort = new AbortController();
    abort.abort();
    await expect(coordinator.start({ filePath: approval, params: { value: 1 }, runId: 'stopped' }, { abortSignal: abort.signal })).rejects.toThrow();
    expect(await store.claim('stopped', 'someone-else', 1000)).toBe(true);
  });
});
