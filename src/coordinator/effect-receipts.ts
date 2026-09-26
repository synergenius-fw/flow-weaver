/**
 * Effect receipts, kept as documents of the run.
 *
 * Decides where the receipt for an operation key is kept and what a stored
 * document says about it on recovery: committed, not committed, or
 * ambiguous, which a resume must never treat as permission to run the
 * effect again.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { EffectAdapter } from '../runtime/durable-execution.js';
import { EFFECT_DOC_PREFIX, type RunStore } from './store.js';
import { createFileRunStore } from './file-store.js';

/** The document holding effect receipts for an operation key. */
const effectDoc = (operationKey: string) => `${EFFECT_DOC_PREFIX}${createHash('sha256').update(operationKey).digest('hex')}`;

/**
 * Effect receipts as documents of the run, one per operation key, so a
 * resume can prove an effect already committed instead of running it again.
 */
export function createStoreEffectAdapter(store: RunStore, runId: string): EffectAdapter {
  return {
    async recover(operationKey) {
      let doc: unknown;
      try { doc = await store.getDoc(runId, effectDoc(operationKey)); }
      catch {
        // A receipt we cannot read is evidence something happened that we
        // cannot describe. Fail closed; never re-run the effect.
        return { kind: 'ambiguous' };
      }
      if (doc === undefined) return { kind: 'not-committed' };
      if (typeof doc !== 'object' || doc === null || !('receipt' in doc)) return { kind: 'ambiguous' };
      const record = doc as { receipt: unknown; result: unknown };
      return { kind: 'committed', receipt: record.receipt as never, result: record.result as never };
    },
    async commit(operationKey, address, execution) {
      await store.putDoc(runId, effectDoc(operationKey), { operationKey, address, result: execution.result, receipt: execution.receipt });
    },
  };
}

/** Effect receipts under `<runDir>/effects/`, as the file store keeps them. Kept for callers of the old name. */
export function createFileEffectAdapter(runDir: string): EffectAdapter {
  return createStoreEffectAdapter(createFileRunStore(path.dirname(runDir)), path.basename(runDir));
}
