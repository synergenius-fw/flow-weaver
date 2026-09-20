/**
 * A run store that forgets everything when the process ends. For tests --
 * yours as much as ours -- and for the second implementation an interface
 * needs so it does not quietly become a description of the first.
 */
import type { RunRecord } from './run-store.js';
import { checkDocName, type RunStore } from './store.js';

export function createMemoryRunStore(): RunStore {
  const records = new Map<string, RunRecord>();
  const docs = new Map<string, Map<string, unknown>>();
  const claims = new Map<string, { owner: string; until: number }>();
  const copy = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  const docsOf = (runId: string) => docs.get(runId) ?? docs.set(runId, new Map()).get(runId)!;

  return {
    async get(runId) { return copy(records.get(runId)); },
    async put(record) { records.set(record.runId, copy(record)); },
    async list(filter = {}) {
      return [...records.values()]
        .filter((r) => !filter.filePath || r.filePath === filter.filePath)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(copy);
    },
    async remove(runId) { records.delete(runId); docs.delete(runId); claims.delete(runId); },
    async getDoc(runId, name) { checkDocName(name); return copy(docs.get(runId)?.get(name)); },
    async putDoc(runId, name, data) { checkDocName(name); docsOf(runId).set(name, copy(data)); },
    async deleteDoc(runId, name) { checkDocName(name); docs.get(runId)?.delete(name); },
    async claim(runId, owner, ttlMs) {
      const c = claims.get(runId);
      if (c && c.until > Date.now() && c.owner !== owner) return false;
      claims.set(runId, { owner, until: Date.now() + ttlMs });
      return true;
    },
    async release(runId, owner) { if (claims.get(runId)?.owner === owner) claims.delete(runId); },
  };
}
