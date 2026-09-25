/**
 * The file store turns a run id into a directory name. An id is chosen by
 * whoever starts the run, so one that is not a single path segment would
 * write a record outside the store and, on removal, delete a directory
 * outside it recursively. Such an id names no run: reads find nothing and
 * writes are refused, and nothing outside the store is touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFileRunStore } from '../../../src/coordinator/index.js';
import type { RunRecord } from '../../../src/coordinator/run-store.js';

let base: string;
let root: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-run-id-'));
  root = path.join(base, '.fw', 'runs');
  fs.mkdirSync(root, { recursive: true });
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const record = (runId: string) => ({
  runId, status: 'completed', filePath: '/x.ts', workflowName: 'wf', params: {},
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}) as unknown as RunRecord;

const BAD = ['', '.', '..', '../escape', '../../', 'a/b', 'a\\b', 'nul\0byte', 'x'.repeat(201)];

describe('run ids in the file store', () => {
  it('refuses to write a record under an id that is not one path segment', async () => {
    const store = createFileRunStore(root);
    for (const id of BAD) {
      await expect(store.put(record(id)), JSON.stringify(id)).rejects.toThrow(/run id/);
    }
    expect(fs.readdirSync(base)).toEqual(['.fw']);
    expect(fs.readdirSync(path.join(base, '.fw'))).toEqual(['runs']);
  });

  it('finds no run under such an id, even when a run.json sits where it points', async () => {
    fs.writeFileSync(path.join(base, '.fw', 'run.json'), JSON.stringify(record('..')));
    const store = createFileRunStore(root);
    expect(await store.get('..')).toBeUndefined();
    expect(await store.get('../escape')).toBeUndefined();
  });

  it('never deletes outside the store', async () => {
    const outside = path.join(base, 'keep');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'run.json'), '{}');
    const store = createFileRunStore(root);
    await expect(store.remove('../../keep')).rejects.toThrow(/run id/);
    await expect(store.remove('..')).rejects.toThrow(/run id/);
    expect(fs.existsSync(path.join(outside, 'run.json'))).toBe(true);
    expect(fs.existsSync(root)).toBe(true);
  });

  it('refuses documents and claims under such an id', async () => {
    const store = createFileRunStore(root);
    await expect(store.putDoc('../x', 'note', {})).rejects.toThrow(/run id/);
    await expect(store.claim('..', 'me', 1000)).rejects.toThrow(/run id/);
    expect(await store.getDoc('../x', 'note')).toBeUndefined();
  });

  it('keeps accepting the ids runs are given today', async () => {
    const store = createFileRunStore(root);
    for (const id of ['3f2b8c1e-8d4a-4c7e-9a51-0e6f2b7d9c10', 'console-1', 'test:executor-trace', 'a.b', 'x'.repeat(200)]) {
      await store.put(record(id));
      expect((await store.get(id))?.runId).toBe(id);
    }
  });
});
