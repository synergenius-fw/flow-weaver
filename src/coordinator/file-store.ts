/**
 * The default run store: one directory per run under a root, `~/.fw/runs`
 * unless told otherwise.
 *
 *   <root>/<runId>/run.json            the record
 *   <root>/<runId>/continuation.json   what a waiting run resumes from
 *   <root>/<runId>/trace.json          the kept step trace
 *   <root>/<runId>/effects/<sha>.json  effect receipts
 *   <root>/<runId>/<name>.json         any other document
 *   <root>/<runId>/claim.json          who is driving the run, until when
 *
 * Every write goes through a sibling temp file and a rename, so a reader
 * never sees half a file. A claim is a file created exclusively; one whose
 * process is gone on this host, or whose time is up, is taken over. That
 * is enough for the processes on one machine sharing the directory, which
 * is what this store is for; a directory on a network share is not, and a
 * database store is the answer past one host.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunRecord } from './run-store.js';
import { checkDocName, EFFECT_DOC_PREFIX, type RunStore } from './store.js';

interface Claim { owner: string; pid: number; host: string; expiresAt: string }

export function createFileRunStore(rootDir: string): RunStore {
  const runDir = (runId: string) => path.join(rootDir, runId);
  const recordFile = (runId: string) => path.join(runDir(runId), 'run.json');
  const claimFile = (runId: string) => path.join(runDir(runId), 'claim.json');
  const docFile = (runId: string, name: string) => {
    checkDocName(name);
    if (name.startsWith(EFFECT_DOC_PREFIX)) return path.join(runDir(runId), 'effects', `${name.slice(EFFECT_DOC_PREFIX.length)}.json`);
    return path.join(runDir(runId), `${name}.json`);
  };

  const readJson = <T>(file: string): T | undefined => {
    if (!fs.existsSync(file)) return undefined;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return undefined; }
  };

  /** Write via a sibling temp file and rename, so a reader never sees a partial file. */
  const writeAtomic = (file: string, data: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${randomUUID()}`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  };

  /** A claim still stands when its time is not up and, on this host, its process is alive. */
  const standing = (c: Claim | undefined): c is Claim => {
    if (!c) return false;
    if (Date.parse(c.expiresAt) <= Date.now()) return false;
    if (c.host !== os.hostname() || c.pid === process.pid) return true;
    try { process.kill(c.pid, 0); return true; }
    catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
  };

  return {
    async get(runId) {
      return readJson<RunRecord>(recordFile(runId));
    },
    async put(record) {
      writeAtomic(recordFile(record.runId), record);
    },
    async list(filter = {}) {
      if (!fs.existsSync(rootDir)) return [];
      const wanted = filter.filePath ? path.resolve(filter.filePath) : undefined;
      const records: RunRecord[] = [];
      for (const entry of fs.readdirSync(rootDir)) {
        const record = readJson<RunRecord>(recordFile(entry));
        if (!record) continue;
        if (wanted && record.filePath !== wanted) continue;
        records.push(record);
      }
      return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async remove(runId) {
      fs.rmSync(runDir(runId), { recursive: true, force: true });
    },
    async getDoc(runId, name) {
      return readJson<unknown>(docFile(runId, name));
    },
    async putDoc(runId, name, data) {
      writeAtomic(docFile(runId, name), data);
    },
    async deleteDoc(runId, name) {
      fs.rmSync(docFile(runId, name), { force: true });
    },
    async claim(runId, owner, ttlMs) {
      const file = claimFile(runId);
      const mine: Claim = { owner, pid: process.pid, host: os.hostname(), expiresAt: new Date(Date.now() + ttlMs).toISOString() };
      fs.mkdirSync(runDir(runId), { recursive: true });
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = readJson<Claim>(file);
        if (standing(current) && current.owner !== owner) return false;
        if (standing(current) && current.owner === owner) { writeAtomic(file, mine); return true; }
        // Nobody stands on it: take it exclusively, so two takers cannot both win.
        if (current) fs.rmSync(file, { force: true });
        try {
          fs.writeFileSync(file, JSON.stringify(mine), { flag: 'wx' });
          return true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          // Someone else got there first; look again.
        }
      }
      return false;
    },
    async release(runId, owner) {
      const file = claimFile(runId);
      const current = readJson<Claim>(file);
      if (current?.owner === owner) fs.rmSync(file, { force: true });
    },
  };
}
