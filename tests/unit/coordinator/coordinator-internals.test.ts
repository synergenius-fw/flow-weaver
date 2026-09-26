/**
 * The coordinator's parts, one at a time, on the memory store: building a
 * gate's resolution from an answer, what the clock does with each due run,
 * the trace's failed step, effect receipts on recovery, notes and kept
 * documents, cancelling and removing, the refusals a resume meets before
 * anything runs, choosing a file's workflow, the bundle digest cache, and
 * the messages every refusal carries.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildGateResolution, InvalidAnswerError, MissingOutputsError } from '../../../src/coordinator/gate-resolution.js';
import { tickDue } from '../../../src/coordinator/clock-tick.js';
import { failedNodeIn, observe } from '../../../src/coordinator/run-trace.js';
import { createStoreEffectAdapter, createFileEffectAdapter } from '../../../src/coordinator/effect-receipts.js';
import { setAgentNote, keepDoc, keptDoc } from '../../../src/coordinator/run-annotations.js';
import { cancelRun, removeRun } from '../../../src/coordinator/run-ending.js';
import { resumable, resumeRun } from '../../../src/coordinator/run-resume.js';
import { createRunContext } from '../../../src/coordinator/run-context.js';
import { parseSelected } from '../../../src/coordinator/workflow-selection.js';
import { computeBundleDigest } from '../../../src/coordinator/bundle-digest.js';
import { missingParams, MissingParamsError } from '../../../src/coordinator/params.js';
import { resolveProjectRoot } from '../../../src/coordinator/runs-dir.js';
import { ParseError, AmbiguousWorkflowError, RunNotFoundError, RunNotWaitingError, BundleChangedError } from '../../../src/coordinator/errors.js';
import { checkDocName, RunBusyError } from '../../../src/coordinator/store.js';
import { createMemoryRunStore, createFileRunStore } from '../../../src/coordinator/index.js';
import type { RunRecord, RunView, ResumeRequest } from '../../../src/coordinator/run-store.js';
import type { ContinuationEnvelope } from '../../../src/runtime/continuation.js';
import type { TWorkflowAST } from '../../../src/ast/types.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'continuation', 'fixtures');
const approval = path.join(fixtures, 'durable-approval.ts');

const NOW = '2030-01-01T00:00:00.000Z';
function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    formatVersion: 1,
    runId: 'r1',
    filePath: approval,
    workflowName: 'durableApproval',
    params: {},
    bundleDigest: 'sha256:x',
    status: 'waiting',
    gate: { id: 'g1', kind: 'approval', node: 'approval', nodeType: 'waitForApproval', inputs: {}, absent: [], outputs: ['value'], hasSuccessPort: true, hasFailurePort: true },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('building a gate resolution', () => {
  const gate = (outputs: string[], hasSuccessPort = true, hasFailurePort = true) => ({ outputs, hasSuccessPort, hasFailurePort });

  it('fills the control ports for an answer and for a refusal, each only when the gate has it', () => {
    expect(buildGateResolution(gate(['value']), 'g', { answer: 3 })).toEqual({ gateId: 'g', value: { onSuccess: true, onFailure: false, value: 3 } });
    expect(buildGateResolution(gate(['value']), 'g', { reject: 'no' })).toEqual({ gateId: 'g', value: { onSuccess: false, onFailure: true, value: null } });
    expect(buildGateResolution(gate(['value'], false, false), 'g', { answer: 3 })).toEqual({ gateId: 'g', value: { value: 3 } });
    expect(buildGateResolution(gate(['value'], false, false), 'g', { reject: 'no' })).toEqual({ gateId: 'g', value: { value: null } });
  });

  it('takes a gate with no data outputs only with a null answer', () => {
    expect(buildGateResolution(gate([]), 'g', { answer: null }).value).toEqual({ onSuccess: true, onFailure: false });
    expect(buildGateResolution(gate([]), 'g', { answer: undefined }).value).toEqual({ onSuccess: true, onFailure: false });
    expect(() => buildGateResolution(gate([]), 'g', { answer: 0 })).toThrow(new InvalidAnswerError('this gate has no data outputs, so answer must be null'));
  });

  it('picks each output of a gate with several from an object answer, and only those', () => {
    expect(buildGateResolution(gate(['a', 'b']), 'g', { answer: { a: 1, b: null, extra: 2 } }).value).toEqual({ onSuccess: true, onFailure: false, a: 1, b: null });
  });

  it('names the outputs an answer leaves out, or all of them when it is not an object', () => {
    const missing = (answer: unknown) => {
      try { buildGateResolution(gate(['a', 'b']), 'g', { answer }); } catch (e) { return e; }
      throw new Error('expected a refusal');
    };
    expect(missing({ a: 1 })).toMatchObject({ name: 'MissingOutputsError', missing: ['b'], message: 'answer is missing gate outputs: b' });
    for (const answer of [5, 'x', null, [1, 2]]) {
      const e = missing(answer);
      expect(e, JSON.stringify(answer)).toBeInstanceOf(MissingOutputsError);
      expect((e as MissingOutputsError).message).toBe('answer is missing gate outputs: a, b');
    }
  });

  it('refuses a value that cannot cross the wire, as an invalid answer', () => {
    expect(() => buildGateResolution(gate(['value']), 'g', { answer: () => 1 })).toThrow(InvalidAnswerError);
    try { buildGateResolution(gate(['value']), 'g', { answer: new Date(0) }); } catch (e) { expect((e as Error).name).toBe('InvalidAnswerError'); }
  });
});

describe('the clock', () => {
  const view = (runId: string): RunView => ({ status: 'completed', runId, workflowName: 'w' });
  async function tickWith(records: RunRecord[], resume: (r: ResumeRequest) => Promise<RunView>, now = Date.parse('2030-01-01T00:01:00.000Z')) {
    const store = createMemoryRunStore();
    for (const r of records) await store.put(r);
    return tickDue(store, resume, now);
  }

  it('moves only waiting runs whose due time has come, and says what it did', async () => {
    const seen: ResumeRequest[] = [];
    const result = await tickWith([
      record({ runId: 'sleepy', gate: { ...record().gate!, kind: 'timer', outputs: ['wokeAt'] }, due: { at: '2030-01-01T00:00:30.000Z', action: 'wake' } }),
      record({ runId: 'silent', gate: { ...record().gate!, kind: 'timer', outputs: [] }, due: { at: '2030-01-01T00:01:00.000Z', action: 'wake' } }),
      record({ runId: 'late', gate: { ...record().gate!, inputs: { timeout: '5m' } }, due: { at: '2030-01-01T00:00:00.000Z', action: 'timeout' } }),
      record({ runId: 'plain', due: { at: '2030-01-01T00:00:00.000Z', action: 'timeout' } }),
      record({ runId: 'future', due: { at: '2030-01-01T00:02:00.000Z', action: 'wake' } }),
      record({ runId: 'undue' }),
      record({ runId: 'done', status: 'completed', due: { at: '2030-01-01T00:00:00.000Z', action: 'wake' } }),
    ], async (r) => { seen.push(r); return view(r.runId); });
    expect(seen.sort((a, b) => a.runId.localeCompare(b.runId))).toEqual([
      { runId: 'late', input: { reject: 'no answer within 5m' } },
      { runId: 'plain', input: { reject: 'no answer within the timeout' } },
      { runId: 'silent', input: { answer: null } },
      { runId: 'sleepy', input: { answer: '2030-01-01T00:01:00.000Z' } },
    ]);
    expect(result.woke.map((v) => v.runId).sort()).toEqual(['silent', 'sleepy']);
    expect(result.timedOut.map((v) => v.runId).sort()).toEqual(['late', 'plain']);
    expect(result.skipped).toEqual([]);
  });

  it('skips a run it could not move, saying why, with the message only for a failure', async () => {
    const errorNamed = (name: string, message = 'x') => Object.assign(new Error(message), { name });
    const due = { at: NOW, action: 'wake' as const };
    const failures: Record<string, Error> = {
      busy: errorNamed('RunBusyError'),
      waiting: errorNamed('RunNotWaitingError'),
      changed: errorNamed('BundleChangedError'),
      broken: errorNamed('TypeError', 'it broke'),
    };
    const result = await tickWith(Object.keys(failures).map((runId) => record({ runId, due })), async (r) => { throw failures[r.runId]; });
    expect(result.skipped.sort((a, b) => a.runId.localeCompare(b.runId))).toEqual([
      { runId: 'broken', reason: 'failed', message: 'it broke' },
      { runId: 'busy', reason: 'busy' },
      { runId: 'changed', reason: 'bundle-changed' },
      { runId: 'waiting', reason: 'not-waiting' },
    ]);
    const thrownString = await tickWith([record({ runId: 's', due })], async () => { throw 'plain text'; });
    expect(thrownString.skipped).toEqual([{ runId: 's', reason: 'failed', message: 'plain text' }]);
  });
});

describe('the trace', () => {
  it('opens a failed run at the last step whose error it recorded', () => {
    expect(failedNodeIn(undefined)).toBeUndefined();
    expect(failedNodeIn([])).toBeUndefined();
    expect(failedNodeIn([
      { t: 1, e: { type: 'LOG_ERROR', id: 'first' } },
      { t: 2, e: { type: 'STATUS_CHANGED', status: 'FAILED', id: 'second' } },
      { t: 3, e: { type: 'STATUS_CHANGED', status: 'SUCCEEDED', id: 'third' } },
      { t: 4, e: { type: 'LOG_ERROR' } },
      { t: 5, e: undefined },
      { t: 6, e: { type: 'NODE_STARTED', id: 'fourth' } },
    ])).toBe('second');
    expect(failedNodeIn([{ t: 1, e: { type: 'STATUS_CHANGED', status: 'FAILED', id: 'a' } }, { t: 2, e: { type: 'LOG_ERROR', id: 'b' } }])).toBe('b');
    expect(failedNodeIn([{ t: 1, e: { type: 'LOG_ERROR', id: 'only' } }])).toBe('only');
  });

  it('keeps events only when the driver asks for a trace or watches them, and passes them on', () => {
    expect(observe(undefined)).toEqual({ kept: undefined, request: { includeTrace: false, production: true } });
    expect(observe({ trace: false }).kept).toBeUndefined();
    const seen: unknown[] = [];
    const watched = observe({ onEvent: (e) => seen.push(e) });
    expect(watched.request).toMatchObject({ includeTrace: true, production: false });
    const event = { type: 'x', timestamp: 5, data: { id: 'n' } } as unknown as Parameters<NonNullable<typeof watched.request.onEvent>>[0];
    watched.request.onEvent!(event);
    expect(watched.kept).toEqual([{ t: 5, e: { id: 'n' } }]);
    expect(seen).toEqual([event]);
    const traced = observe({ trace: true });
    const bare = { type: 'y', timestamp: 6 } as unknown as Parameters<NonNullable<typeof traced.request.onEvent>>[0];
    traced.request.onEvent!(bare);
    expect(traced.kept).toEqual([{ t: 6, e: bare }]);
  });
});

describe('effect receipts on recovery', () => {
  const address = { nodeId: 'n' } as never;
  const receiptDoc = `effect-${createHash('sha256').update('op').digest('hex')}`;

  /** An adapter whose stored receipt for `op` has been replaced by `doc`, or whose store cannot read it. */
  const adapterOver = async (doc: unknown) => {
    const store = createMemoryRunStore();
    if (doc instanceof Error) return createStoreEffectAdapter({ ...store, getDoc: async () => { throw doc; } }, 'r1');
    await store.putDoc('r1', receiptDoc, doc);
    return createStoreEffectAdapter(store, 'r1');
  };

  it('are committed with their result and receipt, or not committed when there is no document', async () => {
    const store = createMemoryRunStore();
    const adapter = createStoreEffectAdapter(store, 'r1');
    expect(await adapter.recover('op', address)).toEqual({ kind: 'not-committed' });
    await adapter.commit!('op', address, { result: 1, receipt: 'first' } as never);
    expect(await store.getDoc('r1', receiptDoc)).toMatchObject({ operationKey: 'op', result: 1, receipt: 'first' });
    expect(await adapter.recover('op', address)).toEqual({ kind: 'committed', receipt: 'first', result: 1 });
  });

  it('are ambiguous when the document is unreadable or is not a receipt, so the effect never runs twice', async () => {
    for (const doc of ['text', null, 7, { result: 1 }, new Error('disk')]) {
      expect(await (await adapterOver(doc)).recover('op', address), String(doc)).toEqual({ kind: 'ambiguous' });
    }
  });

  it('live in the file store\'s effects folder under the old adapter name too', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-effects-'));
    try {
      const adapter = createFileEffectAdapter(path.join(root, 'run-7'));
      await adapter.commit!('op', address, { result: 2, receipt: 'r' } as never);
      expect(fs.readdirSync(path.join(root, 'run-7', 'effects'))).toHaveLength(1);
      expect(await createStoreEffectAdapter(createFileRunStore(root), 'run-7').recover('op', address)).toEqual({ kind: 'committed', receipt: 'r', result: 2 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('notes and kept documents', () => {
  it('set and clear an agent note, and refuse an unknown run', async () => {
    const ctx = createRunContext({ store: createMemoryRunStore() });
    await ctx.store.put(record());
    const noted = await setAgentNote(ctx, 'r1', { status: 'working' } as never);
    expect(noted.agent).toEqual({ status: 'working' });
    expect((await ctx.store.get('r1'))?.agent).toEqual({ status: 'working' });
    const cleared = await setAgentNote(ctx, 'r1', undefined);
    expect('agent' in cleared).toBe(false);
    await expect(setAgentNote(ctx, 'nope', undefined)).rejects.toThrow(new RunNotFoundError('nope'));
  });

  it('keep a driver\'s document, but none the coordinator keeps itself, and only for a known run', async () => {
    const ctx = createRunContext({ store: createMemoryRunStore() });
    await ctx.store.put(record());
    await keepDoc(ctx, 'r1', 'http', { callbackUrl: 'x' });
    expect(await keptDoc(ctx, 'r1', 'http')).toEqual({ callbackUrl: 'x' });
    for (const name of ['continuation', 'trace', 'claim', 'run', 'effect-abc']) {
      await expect(keepDoc(ctx, 'r1', name, {}), name).rejects.toThrow(`${name} is a document the coordinator keeps itself`);
    }
    await expect(keepDoc(ctx, 'r1', 'my-effect-notes', {})).resolves.toBeUndefined();
    await expect(keepDoc(ctx, 'nope', 'http', {})).rejects.toThrow(new RunNotFoundError('nope'));
    await expect(keepDoc(ctx, 'r1', '../x', {})).rejects.toThrow('not a valid document name: ../x');
    await expect(keptDoc(ctx, 'r1', 'A B')).rejects.toThrow('not a valid document name: A B');
  });
});

describe('cancelling and removing', () => {
  it('cancels only a waiting run, dropping its gate, continuation and due time', async () => {
    const ctx = createRunContext({ store: createMemoryRunStore() });
    await ctx.store.put(record({ due: { at: NOW, action: 'wake' }, continuation: { gateId: 'g1' } as unknown as ContinuationEnvelope }));
    await ctx.store.putDoc('r1', 'continuation', { old: true });
    expect(await cancelRun(ctx, 'r1')).toEqual({ status: 'cancelled', runId: 'r1', workflowName: 'durableApproval' });
    const after = await ctx.store.get('r1');
    expect(after).toMatchObject({ status: 'cancelled' });
    expect(after?.gate ?? after?.continuation ?? after?.due).toBeUndefined();
    expect(await ctx.store.getDoc('r1', 'continuation')).toBeUndefined();
    await expect(cancelRun(ctx, 'r1')).rejects.toThrow(new RunNotWaitingError('cancelled'));
    await expect(cancelRun(ctx, 'nope')).rejects.toThrow(new RunNotFoundError('nope'));
  });

  it('removes only a run that is not waiting', async () => {
    const ctx = createRunContext({ store: createMemoryRunStore() });
    await ctx.store.put(record());
    await expect(removeRun(ctx, 'r1')).rejects.toThrow('run is waiting, not waiting at a gate');
    await ctx.store.put(record({ status: 'failed', gate: undefined }));
    await removeRun(ctx, 'r1');
    expect(await ctx.store.get('r1')).toBeUndefined();
    await expect(removeRun(ctx, 'r1')).rejects.toBeInstanceOf(RunNotFoundError);
  });
});

describe('a resume refused before anything runs', () => {
  let digest: string;
  beforeAll(async () => { digest = await computeBundleDigest(approval, 'durableApproval'); });

  it('is refused for an unknown run, one not waiting, or one with no gate', async () => {
    const ctx = createRunContext({ store: createMemoryRunStore() });
    await expect(resumable(ctx, { runId: 'nope', input: { answer: 1 } })).rejects.toThrow('no run with id nope');
    await ctx.store.put(record({ status: 'completed', gate: undefined }));
    await expect(resumable(ctx, { runId: 'r1', input: { answer: 1 } })).rejects.toThrow('run is completed, not waiting at a gate');
    await ctx.store.put(record({ gate: undefined }));
    await expect(resumable(ctx, { runId: 'r1', input: { answer: 1 } })).rejects.toThrow('run is waiting, not waiting at a gate');
  });

  it('is refused when the workflow changed, or the answer does not fit the gate', async () => {
    const ctx = createRunContext({ store: createMemoryRunStore() });
    await ctx.store.put(record());
    await expect(resumable(ctx, { runId: 'r1', input: { answer: 1 } })).rejects.toThrow(new BundleChangedError());
    await ctx.store.put(record({ bundleDigest: digest, gate: { ...record().gate!, outputs: [] } }));
    await expect(resumable(ctx, { runId: 'r1', input: { answer: 1 } })).rejects.toBeInstanceOf(InvalidAnswerError);
    expect((await resumable(ctx, { runId: 'r1', input: { answer: null } })).runId).toBe('r1');
  });

  it('is refused, leaving the run waiting, when there is no continuation or it is at another gate', async () => {
    const ctx = createRunContext({ store: createMemoryRunStore() });
    await ctx.store.put(record({ bundleDigest: digest }));
    await expect(resumeRun(ctx, { runId: 'r1', input: { answer: 1 } }, undefined)).rejects.toThrow('run is waiting, not waiting at a gate');
    await ctx.store.put(record({ bundleDigest: digest, continuation: { gateId: 'g0' } as unknown as ContinuationEnvelope }));
    await expect(resumeRun(ctx, { runId: 'r1', input: { answer: 1 } }, undefined)).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      message: expect.stringContaining("the run's record names gate g1 but its continuation is at gate g0"),
    });
    expect((await ctx.store.get('r1'))?.status).toBe('waiting');
  });

  it('refuses a resume while another owner holds the run', async () => {
    const ctx = createRunContext({ store: createMemoryRunStore() });
    await ctx.store.put(record({ bundleDigest: digest }));
    await ctx.store.claim('r1', 'someone-else', 60_000);
    await expect(resumeRun(ctx, { runId: 'r1', input: { answer: 1 } }, undefined)).rejects.toThrow(new RunBusyError('r1'));
  });
});

describe('choosing the workflow of a file', () => {
  let dir: string;
  const two = path.join(os.tmpdir(), `fw-two-${process.pid}`, 'two.ts');
  beforeAll(() => {
    dir = path.dirname(two);
    fs.mkdirSync(dir, { recursive: true });
    const wf = (name: string) => `
/**
 * @flowWeaver workflow
 * @param value - A value
 * @returns value - The value
 * @connect Start.value -> Exit.value
 * @connect Start.execute -> Exit.onSuccess
 */
export async function ${name}(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error('not compiled');
}
`;
    fs.writeFileSync(two, wf('first') + wf('second'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('refuses to guess between several workflows, naming them', async () => {
    await expect(parseSelected(two, undefined)).rejects.toThrow(new AmbiguousWorkflowError(['first', 'second']));
    await expect(parseSelected(two, undefined)).rejects.toThrow('file declares several workflows. Pass workflowName, one of: first, second');
  });

  it('refuses a name the file does not declare, naming the ones it does', async () => {
    const e = await parseSelected(two, 'third').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ParseError);
    expect(e).toMatchObject({ name: 'ParseError', message: 'Workflow "third" not found. Available: first, second' });
  });

  it('parses the named workflow, including one that is not first', async () => {
    expect((await parseSelected(two, 'second')).ast.functionName).toBe('second');
    expect((await parseSelected(two, 'first')).workflowName).toBe('first');
    const only = await parseSelected(approval, undefined);
    expect([only.workflowName, only.ast.functionName]).toEqual(['durableApproval', 'durableApproval']);
  });
});

describe('the bundle digest', () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('is computed again when the file changes, even at the same size or the same time', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-digest-'));
    const file = path.join(dir, 'wf.ts');
    const source = fs.readFileSync(approval, 'utf8');
    fs.writeFileSync(file, source);
    const stamp = new Date('2030-01-01T00:00:00Z');
    fs.utimesSync(file, stamp, stamp);
    const first = await computeBundleDigest(file, 'durableApproval');
    expect(await computeBundleDigest(file, 'durableApproval')).toBe(first);

    // Same size, a new modification time.
    fs.writeFileSync(file, source.replace('value * 2', 'value * 3'));
    fs.utimesSync(file, new Date('2030-01-02T00:00:00Z'), new Date('2030-01-02T00:00:00Z'));
    const second = await computeBundleDigest(file, 'durableApproval');
    expect(second).not.toBe(first);

    // A different size, the same modification time as before.
    fs.writeFileSync(file, source.replace('value * 2', 'value * 20'));
    fs.utimesSync(file, new Date('2030-01-02T00:00:00Z'), new Date('2030-01-02T00:00:00Z'));
    expect(await computeBundleDigest(file, 'durableApproval')).not.toBe(second);
  });
});

describe('parameters and refusals', () => {
  const ast = (startPorts: TWorkflowAST['startPorts']) => ({ startPorts }) as TWorkflowAST;

  it('names the required parameters a start leaves out', () => {
    const ports: TWorkflowAST['startPorts'] = {
      execute: { dataType: 'STEP' },
      go: { dataType: 'STEP' },
      a: { dataType: 'NUMBER' },
      b: { dataType: 'STRING', optional: true },
      c: { dataType: 'STRING', defaultValue: 'x' } as TWorkflowAST['startPorts'][string],
      d: { dataType: 'OBJECT' },
    };
    expect(missingParams(ast(ports), undefined)).toEqual(['a', 'd']);
    expect(missingParams(ast(ports), { a: 1, d: undefined })).toEqual(['d']);
    expect(missingParams(ast(ports), { a: 0, d: null })).toEqual([]);
    expect(missingParams(ast(ports), Object.create({ a: 1, d: 1 }) as Record<string, unknown>)).toEqual(['a', 'd']);
  });

  it('say what is wrong in words a driver can show', () => {
    expect(new MissingParamsError('wf', ['a']).message).toBe('wf needs a parameter it was not given: a');
    expect(new MissingParamsError('wf', ['a', 'b']).message).toBe('wf needs parameters it was not given: a, b');
    expect(new RunBusyError('r1')).toMatchObject({ name: 'RunBusyError', message: 'run r1 is being driven by another process. Try again shortly' });
    expect(new RunNotFoundError('r1')).toMatchObject({ name: 'RunNotFoundError', message: 'no run with id r1' });
    expect(new RunNotWaitingError('failed')).toMatchObject({ name: 'RunNotWaitingError', status: 'failed', message: 'run is failed, not waiting at a gate' });
    expect(new BundleChangedError()).toMatchObject({ name: 'BundleChangedError', message: 'workflow or its compiled output changed since the run paused. Start a new run' });
    expect(new AmbiguousWorkflowError(['x', 'y'])).toMatchObject({ name: 'AmbiguousWorkflowError', names: ['x', 'y'] });
    expect(new ParseError('bad')).toMatchObject({ name: 'ParseError', message: 'bad' });
    expect(() => checkDocName('fine-name')).not.toThrow();
  });
});

describe('the memory store', () => {
  afterEach(() => vi.useRealTimers());

  it('gives copies, so a caller cannot change what it keeps', async () => {
    const store = createMemoryRunStore();
    const r = record();
    await store.put(r);
    r.status = 'failed';
    const got = (await store.get('r1'))!;
    got.params.x = 1;
    expect(await store.get('r1')).toMatchObject({ status: 'waiting', params: {} });
    await store.putDoc('r1', 'note', { a: 1 });
    const doc = (await store.getDoc('r1', 'note')) as { a: number };
    doc.a = 2;
    expect(await store.getDoc('r1', 'note')).toEqual({ a: 1 });
    await store.deleteDoc('r1', 'note');
    expect(await store.getDoc('r1', 'note')).toBeUndefined();
    await expect(store.deleteDoc('r1', '../x')).rejects.toThrow('not a valid document name');
  });

  it('lets a claim lapse exactly when its time is up, and releases only its owner\'s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    const store = createMemoryRunStore();
    expect(await store.claim('r1', 'a', 1000)).toBe(true);
    expect(await store.claim('r1', 'b', 1000)).toBe(false);
    await store.release('r1', 'b');
    expect(await store.claim('r1', 'b', 1000)).toBe(false);
    vi.setSystemTime(new Date(Date.parse(NOW) + 1000));
    expect(await store.claim('r1', 'b', 1000)).toBe(true);
    await store.release('unclaimed', 'a');
    await store.release('r1', 'b');
    expect(await store.claim('r1', 'c', 1000)).toBe(true);
  });
});

describe('the project a file belongs to', () => {
  it('is the nearest folder with a package.json or a .fw folder, else the file\'s own folder', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-root-'));
    try {
      const deep = path.join(base, 'proj', 'src', 'deep');
      fs.mkdirSync(deep, { recursive: true });
      expect(resolveProjectRoot(path.join(deep, 'wf.ts'))).toBe(path.resolve(deep));
      fs.mkdirSync(path.join(base, 'proj', '.fw'));
      expect(resolveProjectRoot(path.join(deep, 'wf.ts'))).toBe(path.resolve(base, 'proj'));
      fs.writeFileSync(path.join(base, 'proj', 'src', 'package.json'), '{}');
      expect(resolveProjectRoot(deep)).toBe(path.resolve(base, 'proj', 'src'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
