/**
 * Does a run store keep the contract? Run this against yours from any test
 * framework. It throws on the first thing that is wrong, naming it.
 *
 *   import { checkRunStore } from '@synergenius/flow-weaver/testing';
 *   it('keeps the run store contract', () => checkRunStore(() => createMyStore(url)));
 *
 * The factory is called once, and the store should start empty.
 */
import assert from 'node:assert/strict';
import type { RunStore } from '../coordinator/store.js';
import type { RunRecord } from '../coordinator/run-store.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function record(runId: string, over: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  return {
    formatVersion: 1, runId, filePath: '/project/order.ts', workflowName: 'placeOrder', params: { amount: 3 },
    bundleDigest: 'digest', status: 'waiting',
    gate: { id: 'g1', kind: 'approval', node: 'approve', nodeType: 'waitForApproval', inputs: { amount: 3 }, absent: [], outputs: ['ok'], hasSuccessPort: true, hasFailurePort: true },
    // A waiting run carries its continuation in the record: a store that
    // keeps only the fields it knows would lose it.
    continuation: { formatVersion: 1, runId, gateId: 'g1', state: { completed: [], variables: [] }, receipts: [] } as unknown as RunRecord['continuation'],
    createdAt: now, updatedAt: now, ...over,
  };
}

export async function checkRunStore(make: () => RunStore | Promise<RunStore>): Promise<void> {
  const store = await make();

  // Records.
  assert.equal(await store.get('missing'), undefined, 'get of an unknown run is undefined');
  const a = record('run-a');
  await store.put(a);
  const gotA = await store.get('run-a');
  assert.deepEqual(gotA, a, 'get returns what put stored');
  gotA!.params.amount = 99;
  assert.equal((await store.get('run-a'))!.params.amount, 3, 'get returns a copy, so mutating it changes nothing');
  await store.put({ ...a, status: 'completed', gate: undefined, result: { ok: true }, updatedAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal((await store.get('run-a'))!.status, 'completed', 'put replaces the whole record');

  // Listing.
  await sleep(2);
  const b = record('run-b', { filePath: '/project/other.ts', updatedAt: new Date(Date.now() + 5000).toISOString() });
  await store.put(b);
  const all = await store.list();
  assert.deepEqual(all.map((r) => r.runId), ['run-b', 'run-a'], 'list is newest first by updatedAt');
  assert.deepEqual((await store.list({ filePath: '/project/other.ts' })).map((r) => r.runId), ['run-b'], 'list filters by file');
  assert.deepEqual(await store.list({ filePath: '/nowhere.ts' }), [], 'list of an unknown file is empty');

  // Documents.
  assert.equal(await store.getDoc('run-a', 'trace'), undefined, 'a missing document is undefined');
  await store.putDoc('run-a', 'trace', [{ t: 1, e: { type: 'x' } }]);
  await store.putDoc('run-a', 'effect-abc123', { receipt: 1 });
  await store.putDoc('run-a', 'continuation', { frames: [] });
  assert.deepEqual(await store.getDoc('run-a', 'trace'), [{ t: 1, e: { type: 'x' } }], 'a document reads back as written');
  assert.deepEqual(await store.getDoc('run-a', 'effect-abc123'), { receipt: 1 }, 'an effect receipt reads back');
  await store.putDoc('run-a', 'trace', []);
  assert.deepEqual(await store.getDoc('run-a', 'trace'), [], 'a document is replaced, not merged');
  await store.deleteDoc('run-a', 'continuation');
  assert.equal(await store.getDoc('run-a', 'continuation'), undefined, 'a deleted document is gone');
  await store.deleteDoc('run-a', 'continuation');
  await store.putDoc('run-new', 'http', { callbackUrl: 'https://x' });
  assert.deepEqual(await store.getDoc('run-new', 'http'), { callbackUrl: 'https://x' }, 'a document may precede its record');
  await assert.rejects(store.putDoc('run-a', '../escape', {}), 'a name that is not a slug is refused');

  // Claims.
  assert.equal(await store.claim('run-a', 'one', 60_000), true, 'the first claim is granted');
  assert.equal(await store.claim('run-a', 'two', 60_000), false, 'a second owner is refused while the first holds it');
  assert.equal(await store.claim('run-a', 'one', 60_000), true, 'the holder may claim again');
  await store.release('run-a', 'two');
  assert.equal(await store.claim('run-a', 'two', 60_000), false, 'a release by a non-holder changes nothing');
  await store.release('run-a', 'one');
  assert.equal(await store.claim('run-a', 'two', 60_000), true, 'after release another owner may claim');
  await store.release('run-a', 'two');
  assert.equal(await store.claim('run-b', 'short', 20), true, 'a claim may be short');
  await sleep(40);
  assert.equal(await store.claim('run-b', 'late', 60_000), true, 'a lapsed claim may be taken by another owner');
  await store.release('run-b', 'late');
  assert.equal(await store.claim('run-unknown', 'x', 60_000), true, 'a run may be claimed before it has a record');
  await store.release('run-unknown', 'x');
  const race = await Promise.all(['p', 'q', 'r', 's'].map((o) => store.claim('run-a', o, 60_000)));
  assert.equal(race.filter(Boolean).length, 1, 'of concurrent claimers exactly one wins');

  // Removal.
  await store.remove('run-a');
  assert.equal(await store.get('run-a'), undefined, 'a removed run has no record');
  assert.equal(await store.getDoc('run-a', 'trace'), undefined, 'a removed run has no documents');
  assert.equal(await store.claim('run-a', 'after', 60_000), true, 'a removed run has no claim');
  await store.release('run-a', 'after');
  await store.remove('never-existed');
}
