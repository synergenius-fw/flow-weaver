/**
 * The file store's claims and listing, at the edges the contract check does
 * not reach: whose claim still stands (time, host, process), renewing one's
 * own claim, releasing a claim nobody holds, and a list that meets a missing
 * root, stray entries, a corrupt record, or paths that differ only in case.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFileRunStore } from '../../../src/coordinator/index.js';
import type { RunRecord } from '../../../src/coordinator/run-store.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-file-store-')); });
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

/** A pid no process has: above the largest pid Linux and macOS hand out. */
const GONE_PID = 4_194_305;

const claimFile = (runId: string) => path.join(root, runId, 'claim.json');
const readClaim = (runId: string) => JSON.parse(fs.readFileSync(claimFile(runId), 'utf8')) as { owner: string; pid: number; host: string; expiresAt: string };
function plantClaim(runId: string, claim: { owner: string; pid: number; host: string; expiresAt: string }) {
  fs.mkdirSync(path.join(root, runId), { recursive: true });
  fs.writeFileSync(claimFile(runId), JSON.stringify(claim));
}
const inAMinute = () => new Date(Date.now() + 60_000).toISOString();

const record = (runId: string, filePath: string, updatedAt: string) => ({
  runId, status: 'completed', filePath, workflowName: 'wf', params: {}, createdAt: updatedAt, updatedAt,
}) as unknown as RunRecord;

describe('claims in the file store', () => {
  it('writes a claim for a run nobody has claimed, naming this process and host', async () => {
    const store = createFileRunStore(root);
    expect(await store.claim('r1', 'me', 60_000)).toBe(true);
    const claim = readClaim('r1');
    expect(claim).toMatchObject({ owner: 'me', pid: process.pid, host: os.hostname() });
    expect(Date.parse(claim.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('renews the owner\'s own claim when it claims again', async () => {
    const store = createFileRunStore(root);
    expect(await store.claim('r1', 'me', 1_000)).toBe(true);
    const first = Date.parse(readClaim('r1').expiresAt);
    expect(await store.claim('r1', 'me', 600_000)).toBe(true);
    expect(Date.parse(readClaim('r1').expiresAt)).toBeGreaterThan(first + 500_000);
  });

  it('treats a claim whose time is up at this very moment as lapsed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const store = createFileRunStore(root);
    expect(await store.claim('r1', 'first', 0)).toBe(true);
    expect(await store.claim('r1', 'second', 60_000)).toBe(true);
    expect(readClaim('r1').owner).toBe('second');
  });

  it('takes over an unexpired claim whose process on this host is gone', async () => {
    plantClaim('r1', { owner: 'crashed', pid: GONE_PID, host: os.hostname(), expiresAt: inAMinute() });
    const store = createFileRunStore(root);
    expect(await store.claim('r1', 'me', 60_000)).toBe(true);
    expect(readClaim('r1').owner).toBe('me');
  });

  it('leaves a claim from another host standing, whatever its pid', async () => {
    plantClaim('r1', { owner: 'elsewhere', pid: GONE_PID, host: `not-${os.hostname()}`, expiresAt: inAMinute() });
    const store = createFileRunStore(root);
    expect(await store.claim('r1', 'me', 60_000)).toBe(false);
    expect(readClaim('r1').owner).toBe('elsewhere');
  });

  it('leaves a claim standing while its process on this host is alive', async () => {
    // The parent of this test process is alive for as long as the test runs.
    plantClaim('r1', { owner: 'parent', pid: process.ppid, host: os.hostname(), expiresAt: inAMinute() });
    const store = createFileRunStore(root);
    expect(await store.claim('r1', 'me', 60_000)).toBe(false);
    expect(readClaim('r1').owner).toBe('parent');
  });

  it('releases only the owner\'s claim, and releasing an unclaimed run is a no-op', async () => {
    const store = createFileRunStore(root);
    await expect(store.release('never-claimed', 'me')).resolves.toBeUndefined();
    await store.claim('r1', 'me', 60_000);
    await store.release('r1', 'someone-else');
    expect(fs.existsSync(claimFile('r1'))).toBe(true);
    await store.release('r1', 'me');
    expect(fs.existsSync(claimFile('r1'))).toBe(false);
  });
});

describe('listing the file store', () => {
  it('lists nothing when the root does not exist yet', async () => {
    const store = createFileRunStore(path.join(root, 'not-yet'));
    await expect(store.list()).resolves.toEqual([]);
  });

  it('skips entries that hold no readable record', async () => {
    const store = createFileRunStore(root);
    await store.put(record('good', '/w/a.ts', '2030-01-01T00:00:00.000Z'));
    fs.mkdirSync(path.join(root, 'empty-dir'));
    fs.mkdirSync(path.join(root, 'corrupt'));
    fs.writeFileSync(path.join(root, 'corrupt', 'run.json'), '{ not json');
    fs.writeFileSync(path.join(root, 'stray-file'), 'x');
    expect((await store.list()).map((r) => r.runId)).toEqual(['good']);
    expect(await store.get('corrupt')).toBeUndefined();
  });

  it('filters by file as the same path, not a path that differs in case or in where its slashes fall', async () => {
    const store = createFileRunStore(root);
    await store.put(record('lower', '/w/ab/c.ts', '2030-01-01T00:00:00.000Z'));
    await store.put(record('other', '/w/a/bc.ts', '2030-01-02T00:00:00.000Z'));
    await store.put(record('upper', '/w/AB/c.ts', '2030-01-03T00:00:00.000Z'));
    expect((await store.list({ filePath: '/w/ab/c.ts' })).map((r) => r.runId)).toEqual(
      process.platform === 'win32' ? ['upper', 'lower'] : ['lower'],
    );
  });
});
