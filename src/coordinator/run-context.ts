/**
 * What every operation of one coordinator shares: the store and the claim.
 *
 * Decides which store a coordinator uses when it is given none, how long a
 * claim lasts, and who owns it. Each use of the claim is its own owner, so
 * two operations of one coordinator on one run exclude each other as two
 * processes do.
 */
import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import type { LocalCoordinatorOptions, RunRecord } from './run-store.js';
import { RunBusyError, type RunStore } from './store.js';
import { createFileRunStore } from './file-store.js';
import { defaultRunsDir } from './runs-dir.js';

export interface RunContext {
  readonly store: RunStore;
  /** Do `work` holding the run's claim; `RunBusyError` when another owner holds it. */
  claimed<T>(runId: string, work: () => Promise<T>): Promise<T>;
  /** The run's record as the store has it now, or undefined. */
  readRecord(runId: string): Promise<RunRecord | undefined>;
}

export function createRunContext(options: LocalCoordinatorOptions): RunContext {
  const store = options.store ?? createFileRunStore(options.rootDir ?? defaultRunsDir());
  const claimTtl = options.claimTtlMs ?? 60 * 60 * 1000;
  const instance = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  let uses = 0;

  /**
   * Do `work` holding the run's claim. Each use is its own owner, so two
   * operations of this coordinator on one run exclude each other as two
   * processes do: a store lets the same owner claim again, and with one
   * owner per coordinator a second use would share the claim and its
   * `release` would drop the first use's claim early.
   */
  async function claimed<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const owner = `${instance}:${++uses}`;
    if (!(await store.claim(runId, owner, claimTtl))) throw new RunBusyError(runId);
    try { return await work(); }
    finally { await store.release(runId, owner); }
  }

  async function readRecord(runId: string): Promise<RunRecord | undefined> {
    return store.get(runId);
  }

  return { store, claimed, readRecord };
}
