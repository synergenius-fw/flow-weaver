/**
 * Delivering a declared route's callback once its run is over: when it is
 * due, how a failure backs off, when delivery gives up, and that a run is
 * never posted twice at once. The serve API tests cover the same path end
 * to end; these pin the edges with a clock of their own.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createLocalCoordinator, createMemoryRunStore, type LocalCoordinator, type RunRecord, type RunStore } from '../../../src/coordinator/index.js';
import { createCallbackDelivery, CALLBACK_BACKOFF_MS, type CallbackOutcome, type HttpNote } from '../../../src/server/callback-delivery.js';

let store: RunStore;
let coordinator: LocalCoordinator;
let sink: http.Server;
let url: string;
let answer = 204;
let received: Array<{ headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
let clock = Date.parse('2026-09-26T00:00:00Z');
let inFlight = new Set<string>();
let outcomes: CallbackOutcome[] = [];

const record = (runId: string, over: Partial<RunRecord> = {}) => ({
  formatVersion: 1, runId, filePath: '/wf.ts', workflowName: 'wf', params: {}, bundleDigest: 'sha256:x',
  status: 'completed', result: { onSuccess: true, onFailure: false, out: 42 },
  createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString(), ...over,
}) as RunRecord;

const delivery = (token?: string) => createCallbackDelivery({
  coordinator, token, policy: { allowPrivate: true },
  inFlight: (id) => inFlight.has(id),
  outputs: (result) => {
    const r = result as Record<string, unknown>;
    const data = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'onSuccess' && k !== 'onFailure'));
    return { data, failed: r.onFailure === true };
  },
  onCallback: (o) => outcomes.push(o),
  now: () => clock,
});

async function owing(runId: string, over: Partial<RunRecord> = {}, note: Partial<HttpNote> = {}) {
  await store.put(record(runId, over));
  await coordinator.keep(runId, 'http', { route: { method: 'POST', path: '/wf' }, callbackUrl: url, ...note });
}
const note = async (id: string) => coordinator.kept<HttpNote>(id, 'http');

beforeEach(async () => {
  store = createMemoryRunStore();
  coordinator = createLocalCoordinator({ store });
  answer = 204; received = []; inFlight = new Set(); outcomes = [];
  sink = http.createServer((req, res) => {
    let text = '';
    req.on('data', (c) => { text += c; });
    req.on('end', () => { received.push({ headers: req.headers, body: JSON.parse(text) }); res.writeHead(answer).end(); });
  });
  await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/hook`;
});
afterEach(async () => { await new Promise<void>((r) => sink.close(() => r())); });

describe('callback delivery', () => {
  it('posts a completed run once, with its outputs and a signature, and records the delivery', async () => {
    await owing('r1');
    const d = delivery('secret');
    await d.deliver('r1');
    await d.deliver('r1');
    expect(received).toHaveLength(1);
    expect(received[0].body).toEqual({ runId: 'r1', workflow: 'wf', status: 'completed', result: { out: 42 }, failed: false });
    const signature = createHmac('sha256', 'secret').update(JSON.stringify(received[0].body)).digest('hex');
    expect(received[0].headers['x-flow-weaver-signature']).toBe(`sha256=${signature}`);
    expect(received[0].headers['x-flow-weaver-attempt']).toBe('1');
    expect(await note('r1')).toMatchObject({ attempts: 1, delivered: new Date(clock).toISOString() });
    expect(d.pending()).toEqual([]);
  });

  it('sends a failed run its error', async () => {
    await owing('r2', { status: 'failed', result: undefined, error: 'boom' });
    await delivery().deliver('r2');
    expect(received[0].body).toEqual({ runId: 'r2', workflow: 'wf', status: 'failed', error: { code: 'EXECUTION_ERROR', message: 'boom' } });
  });

  it('waits while the run is waiting at a gate or a segment of it is in flight', async () => {
    await owing('w', { status: 'waiting' });
    await owing('f');
    inFlight.add('f');
    const d = delivery();
    await d.deliver('w');
    await d.deliver('f');
    expect(received).toEqual([]);
    expect([...d.pending()].sort()).toEqual(['f', 'w']);
  });

  it('backs off after a failed attempt, and tries again once the delay has passed', async () => {
    await owing('b');
    answer = 500;
    const d = delivery();
    await d.deliver('b');
    expect(await note('b')).toMatchObject({ attempts: 1, lastError: 'callback answered 500', nextAt: new Date(clock + CALLBACK_BACKOFF_MS[0]).toISOString() });

    await d.deliverPending();
    expect(received).toHaveLength(1);

    clock += CALLBACK_BACKOFF_MS[0];
    answer = 204;
    await d.deliverPending();
    expect(received).toHaveLength(2);
    expect(received[1].headers['x-flow-weaver-attempt']).toBe('2');
    expect((await note('b'))?.delivered).toBeDefined();
  });

  it('gives up after the last attempt, says so, and tries no more', async () => {
    await owing('g', {}, { attempts: CALLBACK_BACKOFF_MS.length - 1 });
    answer = 503;
    const d = delivery();
    await d.deliver('g');
    expect(outcomes.at(-1)).toMatchObject({ runId: 'g', ok: false, status: 503, gaveUp: true, attempt: CALLBACK_BACKOFF_MS.length });
    expect((await note('g'))?.gaveUp).toBe(new Date(clock).toISOString());
    expect(d.pending()).toEqual([]);
    clock += 10 * 60 * 60 * 1000;
    await d.deliver('g');
    expect(received).toHaveLength(1);
  });

  it('does not follow a redirect, and says why', async () => {
    await owing('re');
    answer = 302;
    await delivery().deliver('re');
    expect((await note('re'))?.lastError).toBe('callback answered 302, redirects are not followed');
  });

  it('posts a run once when two deliveries race', async () => {
    await owing('race');
    const d = delivery();
    await Promise.all([d.deliver('race'), d.deliver('race'), d.deliver('race')]);
    expect(received).toHaveLength(1);
  });

  it('finds the callbacks still owed for its own workflows when it starts', async () => {
    await owing('owed');
    await owing('done', {}, { delivered: new Date(clock).toISOString() });
    await owing('dead', {}, { gaveUp: new Date(clock).toISOString() });
    await owing('other', { workflowName: 'elsewhere' });
    const d = delivery();
    await d.scan(new Set(['wf']));
    expect(d.pending()).toEqual(['owed']);
  });
});
