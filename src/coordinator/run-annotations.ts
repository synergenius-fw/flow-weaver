/**
 * What a driver keeps with a run besides its progress.
 *
 * Decides how an agent note is written onto the record (under the run's
 * claim, so a segment committing meanwhile is never overwritten with the
 * record it replaced) and which named documents a driver may keep beside
 * the run: a plain slug that is none of the coordinator's own.
 */
import { RunNotFoundError } from './errors.js';
import type { RunContext } from './run-context.js';
import type { AgentNote, RunRecord } from './run-store.js';
import { checkDocName, EFFECT_DOC_PREFIX, RESERVED_DOCS } from './store.js';

export async function setAgentNote(ctx: RunContext, runId: string, note: AgentNote | undefined): Promise<RunRecord> {
  const { store, claimed, readRecord } = ctx;
  if (!(await readRecord(runId))) throw new RunNotFoundError(runId);
  // Under the claim, so a segment committing between the read and the
  // write cannot be overwritten with the record it replaced.
  return claimed(runId, async () => {
    const record = await readRecord(runId);
    if (!record) throw new RunNotFoundError(runId);
    const next: RunRecord = { ...record, agent: note, updatedAt: new Date().toISOString() };
    if (note === undefined) delete next.agent;
    await store.put(next);
    return next;
  });
}

export async function keepDoc(ctx: RunContext, runId: string, name: string, data: unknown): Promise<void> {
  checkDocName(name);
  if ((RESERVED_DOCS as readonly string[]).includes(name) || name.startsWith(EFFECT_DOC_PREFIX)) throw new Error(`${name} is a document the coordinator keeps itself`);
  if (!(await ctx.readRecord(runId))) throw new RunNotFoundError(runId);
  await ctx.store.putDoc(runId, name, data);
}

export async function keptDoc<T>(ctx: RunContext, runId: string, name: string): Promise<T | undefined> {
  checkDocName(name);
  return (await ctx.store.getDoc(runId, name)) as T | undefined;
}
