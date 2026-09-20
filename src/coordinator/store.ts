/**
 * Where runs live.
 *
 * The coordinator keeps three kinds of thing per run: the record (what the
 * run is and where it stands), named documents beside it (the continuation
 * it resumes from, its step trace, effect receipts, an agent's transcript,
 * a callback's state), and a claim while a process is driving it. A store
 * is anything that can hold those. The file store under `~/.fw/runs` is the
 * default; the memory store serves tests; a database store is yours to
 * write against this interface, and `checkRunStore` from
 * `@synergenius/flow-weaver/testing` says whether it holds up.
 *
 * Every method is asynchronous, because a real store is remote. The
 * contract each must keep:
 *
 * - `put` is all or nothing: a concurrent `get` sees the old record or the
 *   new one, never a mix. `get` returns a copy the caller may mutate.
 * - `list` is newest first by `updatedAt`, optionally one workflow file's.
 * - Documents are JSON values under a slug name, per run. `remove` takes
 *   the record and every document with it.
 * - `claim` is atomic: of two callers claiming the same run at once, one
 *   gets `true`. The same owner may claim again. A claim lapses after its
 *   `ttlMs`, or when `release`d by its owner. A store that can tell its
 *   owner's process is gone may lapse it sooner.
 */
import type { RunRecord } from './run-store.js';

export interface RunStore {
  /** The record, or undefined when there is no such run. */
  get(runId: string): Promise<RunRecord | undefined>;
  /** Write the whole record, atomically from a reader's point of view. */
  put(record: RunRecord): Promise<void>;
  /** Every run's record, newest first; only one file's when asked. */
  list(filter?: { filePath?: string }): Promise<RunRecord[]>;
  /** Forget the run: its record, its documents, its claim. */
  remove(runId: string): Promise<void>;
  /** A document kept beside the run, or undefined. */
  getDoc(runId: string, name: string): Promise<unknown | undefined>;
  /** Write a document, atomically; a run need not have a record yet. */
  putDoc(runId: string, name: string, data: unknown): Promise<void>;
  /** Drop a document; nothing happens when it is not there. */
  deleteDoc(runId: string, name: string): Promise<void>;
  /** Take the run for `owner` for up to `ttlMs`. False when another owner holds it. */
  claim(runId: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Give the run back; nothing happens when `owner` does not hold it. */
  release(runId: string, owner: string): Promise<void>;
}

/** A document name: a plain slug, so a file store can use it as a file name as it is. */
export const DOC_NAME = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

/** The documents the coordinator itself keeps; `keep()` refuses these names. */
export const RESERVED_DOCS = ['continuation', 'trace', 'claim', 'run'] as const;
/** Effect receipts are documents named `effect-<sha256 of the operation key>`. */
export const EFFECT_DOC_PREFIX = 'effect-';

export function checkDocName(name: string): void {
  if (!DOC_NAME.test(name)) throw new Error(`not a valid document name: ${name}`);
}

/** Another process is driving this run right now. */
export class RunBusyError extends Error {
  readonly name = 'RunBusyError';
  constructor(readonly runId: string) {
    super(`run ${runId} is being driven by another process; try again shortly`);
  }
}
