import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BundleChangedError,
  createLocalCoordinator,
  createMemoryRunStore,
  RunBusyError,
  RunNotFoundError,
  RunNotWaitingError,
} from '../../../src/coordinator/index.js';
import { ContinuationRefusalError } from '../../../src/mcp/workflow-executor.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'continuation', 'fixtures');
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
    // One file holds the gate and the continuation, so one write commits both.
    const stored = JSON.parse(fs.readFileSync(path.join(rootDir, view.runId, 'run.json'), 'utf8'));
    expect(stored.continuation).toMatchObject({ runId: view.runId, gateId: stored.gate.id });
    expect(fs.existsSync(path.join(rootDir, view.runId, 'continuation.json'))).toBe(false);
  });

  it('resumes to completion and removes the continuation', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    const done = await coordinator.resume({ runId: paused.runId, input: { answer: 8 } });

    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ onSuccess: true, onFailure: false, result: 9 });
    expect((await coordinator.record(paused.runId))?.continuation).toBeUndefined();
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
    const before = (await coordinator.record(first.runId))?.continuation;

    const second = await coordinator.resume({ runId: first.runId, input: { answer: 2 } });
    expect(second.status).toBe('waiting');
    expect(second.gate?.kind).toBe('input');
    const after = (await coordinator.record(first.runId))?.continuation;
    expect(after?.gateId).not.toBe(before?.gateId);

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
    const runSnapshot = fs.readFileSync(runFile);

    const done = await coordinator.resume({ runId: paused.runId, input: { answer: 4 } });
    expect(done.result).toEqual({ onSuccess: true, onFailure: false, value: 4 });

    fs.writeFileSync(runFile, runSnapshot);
    delete (globalThis as Record<string, unknown>)[flag];

    const again = await coordinator.resume({ runId: paused.runId, input: { answer: 4 } });
    expect(again.result).toEqual({ onSuccess: true, onFailure: false, value: 4 });
    expect((globalThis as Record<string, unknown>)[flag]).toBeUndefined();
  });

  it('leaves a run waiting when the resume is refused before anything ran', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    const runFile = path.join(rootDir, paused.runId, 'run.json');
    // A continuation whose checksum no longer matches is refused by the engine
    // before a single node runs. Nothing happened, so nothing has failed.
    const stored = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    fs.writeFileSync(runFile, JSON.stringify({ ...stored, continuation: { ...stored.continuation, checksum: 'sha256:' + '0'.repeat(64) } }));

    await expect(coordinator.resume({ runId: paused.runId, input: { answer: 8 } })).rejects.toBeInstanceOf(ContinuationRefusalError);
    expect((await coordinator.get(paused.runId))?.status).toBe('waiting');
    expect((await coordinator.record(paused.runId))?.continuation).toBeDefined();
  });

  it('recovers a yield whose commit was cut short: the gate the stored continuation is at can be answered', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const first = await coordinator.start({ filePath: twoGates, params: { value: 1 } });
    const runFile = path.join(rootDir, first.runId, 'run.json');
    const recordAtFirstGate = fs.readFileSync(runFile);
    await coordinator.resume({ runId: first.runId, input: { answer: 2 } });
    // The process died while committing the second yield, before the write
    // that commits it landed: the store still holds the first gate.
    fs.writeFileSync(runFile, recordAtFirstGate);

    const again = await coordinator.resume({ runId: first.runId, input: { answer: 2 } });
    expect(again).toMatchObject({ status: 'waiting', gate: { kind: 'input', node: 'second', inputs: { value: 2 } } });
    const done = await coordinator.resume({ runId: first.runId, input: { answer: 3 } });
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ value: 3 });
  });

  it('still resumes a run paused before the continuation moved into the record', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    // The layout an older version wrote: the envelope in its own document.
    const runFile = path.join(rootDir, paused.runId, 'run.json');
    const { continuation, ...legacy } = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    fs.writeFileSync(runFile, JSON.stringify(legacy));
    fs.writeFileSync(path.join(rootDir, paused.runId, 'continuation.json'), JSON.stringify(continuation));

    const done = await coordinator.resume({ runId: paused.runId, input: { answer: 8 } });
    expect(done.result).toEqual({ onSuccess: true, onFailure: false, result: 9 });
    expect(fs.existsSync(path.join(rootDir, paused.runId, 'continuation.json'))).toBe(false);
  });

  it('does not cancel a run that another driver completed while the cancel was on its way', async () => {
    const store = createMemoryRunStore();
    const coordinator = createLocalCoordinator({ store });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    // The claim is the last thing before the write; a driver finishing the run
    // just before it is the race a stale read would lose. The other driver
    // runs once: its own resume claims the run too, and must reach the store.
    const claim = store.claim.bind(store);
    let raced = false;
    store.claim = async (runId, owner, ttl) => {
      if (!raced) {
        raced = true;
        await coordinator.resume({ runId, input: { answer: 8 } });
      }
      return claim(runId, owner, ttl);
    };

    await expect(coordinator.cancel(paused.runId)).rejects.toBeInstanceOf(RunNotWaitingError);
    const done = await coordinator.get(paused.runId);
    expect(done?.status).toBe('completed');
    expect(done?.result).toEqual({ onSuccess: true, onFailure: false, result: 9 });
  });

  it.each([
    ['another coordinator on the store', true],
    ['the same coordinator', false],
  ])('does not lose a commit by %s that lands while an agent note is written', async (_label, separate) => {
    const store = createMemoryRunStore();
    const coordinator = createLocalCoordinator({ store });
    const racer = separate ? createLocalCoordinator({ store }) : coordinator;
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    // The other driver resumes once, after setAgent has read the record and
    // just before it writes. Its own writes go through the same wrapper, so
    // the flag is cleared before it starts.
    const put = store.put.bind(store);
    let armed = false;
    let raced: unknown;
    store.put = async (record) => {
      if (armed) {
        armed = false;
        raced = await racer.resume({ runId: record.runId, input: { answer: 8 } }).catch((error: unknown) => error);
      }
      return put(record);
    };

    armed = true;
    const note = { gateId: 'g', node: 'approval', profile: 'p', provider: 'fake', status: 'answering' as const, startedAt: new Date().toISOString() };
    await coordinator.setAgent(paused.runId, note);

    // Either the commit went in and stays, or it was refused and nothing moved.
    const after = await coordinator.record(paused.runId);
    if (raced instanceof RunBusyError) {
      expect(after).toMatchObject({ status: 'waiting', agent: note });
      const done = await racer.resume({ runId: paused.runId, input: { answer: 8 } });
      expect(done).toMatchObject({ status: 'completed', result: { result: 9 } });
    } else {
      expect(after).toMatchObject({ status: 'completed', result: { result: 9 } });
    }
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

  it('refuses to start without a required parameter, naming it', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    await expect(coordinator.start({ filePath: approval })).rejects.toMatchObject({ name: 'MissingParamsError', missing: ['value'] });
    await expect(coordinator.start({ filePath: approval, params: { other: 1 } })).rejects.toThrow(/needs a parameter it was not given: value/);
    expect(await coordinator.list()).toEqual([]);
  });

  it('refuses an unknown run id', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    await expect(coordinator.resume({ runId: 'nope', input: { answer: 1 } })).rejects.toBeInstanceOf(
      RunNotFoundError,
    );
    expect(await coordinator.get('nope')).toBeUndefined();
  });

  it('lists runs newest first and filters by file', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const a = await coordinator.start({ filePath: approval, params: { value: 1 } });
    const b = await coordinator.start({ filePath: twoGates, params: { value: 1 } });

    const all = await coordinator.list();
    expect(all.map((run) => run.runId)).toEqual([b.runId, a.runId]);
    expect(all[0]).toMatchObject({ status: 'waiting', gate: { kind: 'approval', node: 'first' } });
    expect((await coordinator.list({ filePath: approval })).map((run) => run.runId)).toEqual([a.runId]);
  });

  it('streams the trace to an observer and keeps it beside the record', async () => {
    // The console drives a run this way: each step as it happens, and the
    // same trace again when the run is opened later. Each segment appends.
    const coordinator = createLocalCoordinator({ rootDir });
    const seen: string[] = [];
    const paused = await coordinator.start(
      { filePath: approval, params: { value: 4 } },
      { onEvent: (event) => { seen.push(event.type); } },
    );
    expect(seen).toContain('STATUS_CHANGED');
    expect((await coordinator.record(paused.runId))?.traced).toBe(true);
    const firstSegment = (await coordinator.trace(paused.runId)).length;
    expect(firstSegment).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(rootDir, paused.runId, 'trace.json'))).toBe(true);

    await coordinator.resume({ runId: paused.runId, input: { answer: 8 } }, { trace: true });
    expect((await coordinator.trace(paused.runId)).length).toBeGreaterThan(firstSegment);
  });

  it('is no longer traced end to end once a segment ran without one', async () => {
    // The console started it and watched. An assistant resumed it blind.
    // The first segment's trace is still there, but the run has a gap.
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } }, { trace: true });
    const kept = (await coordinator.trace(paused.runId)).length;
    await coordinator.resume({ runId: paused.runId, input: { answer: 8 } });
    expect((await coordinator.record(paused.runId))?.traced).toBe(false);
    expect((await coordinator.trace(paused.runId)).length).toBe(kept);
  });

  it('keeps no trace unless asked', async () => {
    // An assistant over MCP never asks. Fewer bytes on disk and in its answer.
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    expect(await coordinator.trace(paused.runId)).toEqual([]);
    expect((await coordinator.record(paused.runId))?.traced).toBeFalsy();
    expect(fs.existsSync(path.join(rootDir, paused.runId, 'trace.json'))).toBe(false);
  });

  it('uses the run id the driver brings', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const view = await coordinator.start({ filePath: approval, params: { value: 4 }, runId: 'console-1' });
    expect(view.runId).toBe('console-1');
    expect(await coordinator.record('console-1')).toMatchObject({ params: { value: 4 }, status: 'waiting' });
    expect((await coordinator.list())[0]).toMatchObject({ runId: 'console-1' });
    expect(typeof (await coordinator.list())[0].createdAt).toBe('string');
  });

  it('cancels a waiting run, dropping its continuation', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const paused = await coordinator.start({ filePath: approval, params: { value: 4 } });
    const cancelled = await coordinator.cancel(paused.runId);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toBeUndefined();
    expect((await coordinator.record(paused.runId))?.continuation).toBeUndefined();
    await expect(coordinator.resume({ runId: paused.runId, input: { answer: 8 } })).rejects.toMatchObject({
      name: 'RunNotWaitingError',
      status: 'cancelled',
    });
    await expect(coordinator.cancel(paused.runId)).rejects.toBeInstanceOf(RunNotWaitingError);
  });

  it('records a run stopped by its signal as cancelled, not failed', async () => {
    const coordinator = createLocalCoordinator({ rootDir });
    const abort = new AbortController();
    abort.abort();
    await expect(
      coordinator.start({ filePath: approval, params: { value: 4 }, runId: 'stopped' }, { abortSignal: abort.signal }),
    ).rejects.toThrow();
    expect(await coordinator.get('stopped')).toMatchObject({ status: 'cancelled' });
    expect((await coordinator.get('stopped'))?.error).toBeUndefined();
  });
});
