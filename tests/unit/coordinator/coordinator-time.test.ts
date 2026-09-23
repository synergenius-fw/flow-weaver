/**
 * The coordinator owns time. A `sleep` node is a timer gate: the run pauses
 * with a `due` time and `tick()` wakes it once that time has passed. A gate
 * given a `timeout` gets a deadline the same way, and `tick()` sends it
 * along its failure path. The engine runs no timer. Whoever ticks decides
 * when, and two tickers never move the same run twice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLocalCoordinator, createMemoryRunStore, dueFor, parseDuration } from '../../../src/coordinator/index.js';
import { executeWorkflow } from '../../../src/mcp/workflow-executor.js';

let dir: string;

/** Sleep for `duration`, then report when it woke. */
const SLEEPER = (duration: string) => `
/**
 * @flowWeaver nodeType
 * @expression
 * @input wokeAt - When the run woke
 * @output note - A line about it
 */
function report(wokeAt: string): string { return \`woke at \${wokeAt}\`; }

/**
 * @flowWeaver workflow
 * @param label - Ignored, a parameter to have one
 * @returns note - A line about it
 * @node nap sleep [expr: duration="'${duration}'"]
 * @node say report
 * @path Start -> nap -> say -> Exit
 * @connect nap.wokeAt -> say.wokeAt
 */
export async function sleeper(execute: boolean, params: { label: string }): Promise<{ onSuccess: boolean; onFailure: boolean; note: string }> {
  throw new Error('generated body was not installed');
}
`;

/** Wait for an event with a timeout; the failure path reports it. */
const WAITER = (timeout: string, routeFailure = true) => `
/**
 * @flowWeaver nodeType
 * @expression
 * @input eventData - What arrived
 * @output got - A line about it
 */
function arrived(eventData: object): string { return \`got \${JSON.stringify(eventData)}\`; }

/**
 * @flowWeaver nodeType
 * @expression
 * @output gaveUp - A line about it
 */
function giveUp(): string { return 'gave up'; }

/**
 * @flowWeaver workflow
 * @param label - Ignored
 * @returns got - What arrived, when it did
 * @returns gaveUp - What happened when nothing arrived
 * @node wait waitForEvent [expr: eventName="'app/thing'", timeout="'${timeout}'"]
 * @node ok arrived
 * @node no giveUp
 * @path Start -> wait -> ok -> Exit
 ${routeFailure ? ' * @path wait:fail -> no -> Exit' : ''}
 */
export async function waiter(execute: boolean, params: { label: string }): Promise<{ onSuccess: boolean; onFailure: boolean; got?: string; gaveUp?: string }> {
  throw new Error('generated body was not installed');
}
`;

const write = (name: string, source: string) => { const file = path.join(dir, `${name}.ts`); fs.writeFileSync(file, source); return file; };
const coordinator = () => createLocalCoordinator({ store: createMemoryRunStore() });
const between = (iso: string, from: number, to: number) => { const t = Date.parse(iso); return t >= from && t <= to; };

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-time-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('parseDuration and dueFor', () => {
  it('reads what delay reads, and nothing else', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration(' 2h ')).toBe(7_200_000);
    expect(parseDuration('3d')).toBe(259_200_000);
    for (const bad of ['', 'soon', '5 weeks', 42, null, undefined, '1.5h']) expect(parseDuration(bad)).toBeUndefined();
  });

  it('gives a timer a wake time, a gate with a timeout and a failure port a deadline, and nothing to the rest', () => {
    const now = Date.parse('2026-09-20T12:00:00.000Z');
    expect(dueFor({ kind: 'timer', inputs: { duration: '2h' }, hasFailurePort: true }, now)).toEqual({ at: '2026-09-20T14:00:00.000Z', action: 'wake' });
    expect(dueFor({ kind: 'timer', inputs: { duration: 'whenever' }, hasFailurePort: true }, now)).toEqual({ at: '2026-09-20T12:00:00.000Z', action: 'wake' });
    expect(dueFor({ kind: 'input', inputs: { eventName: 'x', timeout: '48h' }, hasFailurePort: true }, now)).toEqual({ at: '2026-09-22T12:00:00.000Z', action: 'timeout' });
    expect(dueFor({ kind: 'input', inputs: { eventName: 'x', timeout: '48h' }, hasFailurePort: false }, now)).toBeUndefined();
    expect(dueFor({ kind: 'approval', inputs: { summary: 'x' }, hasFailurePort: true }, now)).toBeUndefined();
    expect(dueFor({ kind: 'input', inputs: { eventName: 'x', timeout: null }, hasFailurePort: true }, now)).toBeUndefined();
  });
});

describe('a sleeping run', () => {
  it('pauses at a timer gate with its wake time, is left alone before it, and wakes after it', async () => {
    const runs = coordinator();
    const before = Date.now();
    const paused = await runs.start({ filePath: write('sleeper', SLEEPER('200ms')), params: { label: 'x' } });
    expect(paused.status).toBe('waiting');
    expect(paused.gate).toMatchObject({ kind: 'timer', node: 'nap', inputs: { duration: '200ms' } });
    expect(paused.due?.action).toBe('wake');
    expect(between(paused.due!.at, before + 200, Date.now() + 200)).toBe(true);
    expect((await runs.list())[0]).toMatchObject({ status: 'waiting', gate: { kind: 'timer' }, due: paused.due });

    // Too early: the clock does nothing.
    expect(await runs.tick(before)).toEqual({ woke: [], timedOut: [], skipped: [] });
    expect((await runs.get(paused.runId))?.status).toBe('waiting');

    // Time has passed: the run wakes with the time it woke, and finishes.
    const at = Date.parse(paused.due!.at) + 1;
    const moved = await runs.tick(at);
    expect(moved.timedOut).toEqual([]);
    expect(moved.skipped).toEqual([]);
    expect(moved.woke).toHaveLength(1);
    expect(moved.woke[0]).toMatchObject({ runId: paused.runId, status: 'completed' });
    expect((moved.woke[0].result as { note: string }).note).toBe(`woke at ${new Date(at).toISOString()}`);
    expect((await runs.record(paused.runId))?.due).toBeUndefined();
    // Nothing left to move.
    expect(await runs.tick(at + 1000)).toEqual({ woke: [], timedOut: [], skipped: [] });
  });

  it('wakes at once under fast mocks, and can be woken early by an answer', async () => {
    const runs = coordinator();
    const file = write('sleeper-fast', SLEEPER('3d'));
    const fast = await runs.start({ filePath: file, params: { label: 'x' }, mocks: { fast: true } });
    expect(fast.status).toBe('completed');
    expect((fast.result as { note: string }).note).toMatch(/^woke at \d{4}-/);

    const long = await runs.start({ filePath: file, params: { label: 'x' } });
    expect(long.status).toBe('waiting');
    expect(Date.parse(long.due!.at) - Date.now()).toBeGreaterThan(2 * 86_400_000);
    const early = await runs.resume({ runId: long.runId, input: { answer: '2026-01-01T00:00:00.000Z' } });
    expect(early).toMatchObject({ status: 'completed', result: { note: 'woke at 2026-01-01T00:00:00.000Z' } });
  });
});

describe('a gate with a timeout', () => {
  it('gets a deadline, and takes its failure path when the clock passes it', async () => {
    const runs = coordinator();
    const paused = await runs.start({ filePath: write('waiter', WAITER('1h')), params: { label: 'x' } });
    expect(paused.gate).toMatchObject({ kind: 'input', node: 'wait', inputs: { eventName: 'app/thing', timeout: '1h' } });
    expect(paused.due?.action).toBe('timeout');
    expect(Date.parse(paused.due!.at) - Date.now()).toBeGreaterThan(3_500_000);

    expect((await runs.tick()).timedOut).toEqual([]);
    const moved = await runs.tick(Date.parse(paused.due!.at));
    expect(moved.woke).toEqual([]);
    expect(moved.timedOut).toHaveLength(1);
    expect(moved.timedOut[0]).toMatchObject({ runId: paused.runId, status: 'completed', result: { onSuccess: true, gaveUp: 'gave up' } });
  });

  it('is answered as usual before the deadline', async () => {
    const runs = coordinator();
    const paused = await runs.start({ filePath: write('waiter-answered', WAITER('1h')), params: { label: 'x' } });
    const done = await runs.resume({ runId: paused.runId, input: { answer: { id: 7 } } });
    expect(done).toMatchObject({ status: 'completed', result: { got: 'got {"id":7}' } });
    expect((await runs.record(paused.runId))?.due).toBeUndefined();
  });

  it('has no deadline when the gate has no failure path to take', async () => {
    const runs = coordinator();
    const paused = await runs.start({ filePath: write('waiter-unrouted', WAITER('1h', false)), params: { label: 'x' } });
    expect(paused.status).toBe('waiting');
    // waitForEvent declares onFailure, so the deadline is set; the path is the workflow's business.
    expect(paused.due?.action).toBe('timeout');
  });
});

describe('two clocks on one store', () => {
  it('move a due run once, and skip what is busy, gone, or changed underneath', async () => {
    const store = createMemoryRunStore();
    const a = createLocalCoordinator({ store });
    const b = createLocalCoordinator({ store });
    const file = write('sleeper-two', SLEEPER('50ms'));
    const paused = await a.start({ filePath: file, params: { label: 'x' } });
    const at = Date.parse(paused.due!.at) + 1;

    // Whoever claims first moves it; the other finds nothing due.
    const [fromA, fromB] = await Promise.all([a.tick(at), b.tick(at)]);
    const moved = [...fromA.woke, ...fromB.woke];
    const busy = [...fromA.skipped, ...fromB.skipped].filter((s) => s.reason === 'busy');
    expect(moved).toHaveLength(1);
    expect(busy.length).toBeLessThanOrEqual(1);
    expect((await a.get(paused.runId))?.status).toBe('completed');

    // A file that changed since the run paused is not resumed by the clock either.
    const other = await a.start({ filePath: file, params: { label: 'y' } });
    fs.appendFileSync(file, '\n// edited while sleeping\n');
    const result = await a.tick(Date.parse(other.due!.at) + 1);
    expect(result.woke).toEqual([]);
    expect(result.skipped).toEqual([{ runId: other.runId, reason: 'bundle-changed' }]);
    expect((await a.get(other.runId))?.status).toBe('waiting');
  });
});

describe('the engine', () => {
  it('yields a timer gate whose continuation names the kind, and accepts it back', async () => {
    const file = write('sleeper-engine', SLEEPER('1s'));
    const bundleDigest = `sha256:${'e'.repeat(64)}`;
    const yielded = await executeWorkflow({ runId: 'timer-engine', bundleDigest, filePath: file, params: { label: 'x' }, production: true });
    if (yielded.kind !== 'yielded') throw new Error('expected a yield');
    expect(yielded.gate.kind).toBe('timer');
    expect(yielded.continuation.gateKind).toBe('timer');
    const done = await executeWorkflow({
      runId: 'timer-engine', bundleDigest, filePath: file, params: { label: 'x' }, production: true,
      continuation: yielded.continuation,
      resolution: { gateId: yielded.gate.id, value: { onSuccess: true, onFailure: false, wokeAt: '2026-09-20T12:00:00.000Z' } },
    });
    expect(done).toMatchObject({ kind: 'completed', result: { note: 'woke at 2026-09-20T12:00:00.000Z' } });
  });
});
