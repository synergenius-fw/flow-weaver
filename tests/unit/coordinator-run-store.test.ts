import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BundleChangedError,
  createLocalCoordinator,
  RunNotFoundError,
  RunNotWaitingError,
} from '../../src/coordinator/index.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'continuation', 'fixtures');
const approval = path.join(fixtures, 'durable-approval.ts');
const twoGates = path.join(fixtures, 'durable-two-gates.ts');
const effectGate = path.join(fixtures, 'durable-effect-gate.ts');

let rootDir: string;
beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-runs-'));
});
afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('local coordinator run store', () => {
  it('pauses at an approval gate and persists the gate and continuation', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const view = await coordinator.start({ filePath: approval, params: { value: 4 } });

    expect(view.status).toBe('waiting');
    expect(view.gate).toEqual({ kind: 'approval', node: 'approval', inputs: { value: 8 }, absent: [] });
    expect(fs.existsSync(path.join(rootDir, view.runId, 'run.json'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, view.runId, 'continuation.json'))).toBe(true);
  });

  it('resumes to completion and removes the continuation', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    const done = await coordinator.resume({ runId: paused.runId, input: { answer: 8 } });

    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ onSuccess: true, onFailure: false, result: 9 });
    expect(fs.existsSync(path.join(rootDir, paused.runId, 'continuation.json'))).toBe(false);
  });

  it('holds nothing in memory: a fresh coordinator on the same directory resumes the run', async () => {
    const first = createLocalCoordinator({ rootDir });
    const paused = await first.start({ filePath: approval, params: { value: 4 } });

    const second = createLocalCoordinator({ rootDir });
    const done = await second.resume({ runId: paused.runId, input: { answer: 8 } });
    expect(done.status).toBe('completed');
  });

  it('re-yields at a second gate, replacing the continuation', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const first = await coordinator.start({ filePath: twoGates, params: { value: 1 } });
    expect(first.gate?.kind).toBe('approval');
    const before = fs.readFileSync(path.join(rootDir, first.runId, 'continuation.json'), 'utf8');

    const second = await coordinator.resume({ runId: first.runId, input: { answer: 2 } });
    expect(second.status).toBe('waiting');
    expect(second.gate?.kind).toBe('input');
    const after = fs.readFileSync(path.join(rootDir, first.runId, 'continuation.json'), 'utf8');
    expect(after).not.toBe(before);

    const done = await coordinator.resume({ runId: first.runId, input: { answer: 3 } });
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ value: 3 });
  });

  it('records effect receipts and recovers them instead of re-running after a simulated crash', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const flag = '__a2_effect_gate_called__';
    delete (globalThis as Record<string, unknown>)[flag];

    const paused = await coordinator.start({ filePath: effectGate, params: { params: {} } });
    expect((globalThis as Record<string, unknown>)[flag]).toBe(true);
    const effectsDir = path.join(rootDir, paused.runId, 'effects');
    expect(fs.readdirSync(effectsDir)).toHaveLength(1);

    // Snapshot the committed state, complete the run, then put the snapshot
    // back: this is the window between the engine returning and the
    // coordinator writing, if the process had died there.
    const runFile = path.join(rootDir, paused.runId, 'run.json');
    const contFile = path.join(rootDir, paused.runId, 'continuation.json');
    const runSnapshot = fs.readFileSync(runFile);
    const contSnapshot = fs.readFileSync(contFile);

    const done = await coordinator.resume({ runId: paused.runId, input: { answer: 4 } });
    expect(done.result).toEqual({ onSuccess: true, onFailure: false, value: 4 });

    fs.writeFileSync(runFile, runSnapshot);
    fs.writeFileSync(contFile, contSnapshot);
    delete (globalThis as Record<string, unknown>)[flag];

    const again = await coordinator.resume({ runId: paused.runId, input: { answer: 4 } });
    expect(again.result).toEqual({ onSuccess: true, onFailure: false, value: 4 });
    expect((globalThis as Record<string, unknown>)[flag]).toBeUndefined();
  });

  it('refuses to resume a completed run', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    await coordinator.resume({ runId: paused.runId, input: { answer: 8 } });
    await expect(coordinator.resume({ runId: paused.runId, input: { answer: 8 } })).rejects.toBeInstanceOf(
      RunNotWaitingError,
    );
  });

  it('refuses to resume when the workflow changed since it paused', async () => {
    const copy = path.join(rootDir, 'approval-copy.ts');
    fs.copyFileSync(approval, copy);
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: copy, params: { value: 4 } });

    // A comment changes the compiled artifact's source text, and mtime/size
    // change too, so the digest cache is bypassed.
    fs.appendFileSync(copy, '\n// changed after the pause\n');
    await expect(coordinator.resume({ runId: paused.runId, input: { answer: 8 } })).rejects.toBeInstanceOf(
      BundleChangedError,
    );
  });

  it('refuses an unknown run id', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    await expect(coordinator.resume({ runId: 'nope', input: { answer: 1 } })).rejects.toBeInstanceOf(
      RunNotFoundError,
    );
    expect(coordinator.get('nope')).toBeUndefined();
  });

  it('lists runs newest first and filters by file', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const a = await coordinator.start({ filePath: approval, params: { value: 1 } });
    const b = await coordinator.start({ filePath: twoGates, params: { value: 1 } });

    const all = coordinator.list();
    expect(all.map((run) => run.runId)).toEqual([b.runId, a.runId]);
    expect(all[0]).toMatchObject({ status: 'waiting', gate: { kind: 'approval', node: 'first' } });
    expect(coordinator.list({ filePath: approval }).map((run) => run.runId)).toEqual([a.runId]);
  });
});
