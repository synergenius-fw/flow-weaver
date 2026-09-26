/**
 * Delivering the callbacks declared routes promise: the final response of a
 * run POSTed to the URL its caller named, once the run is over.
 *
 * What is owed is kept beside the run in the store (the `http` document), so
 * a callback survives a restart and is delivered by whichever API process
 * finds the run finished -- the gate may well have been answered in the
 * console. This module holds only which runs to look at, and never posts the
 * same run twice at once.
 */
import { createHmac } from 'node:crypto';
import type { LocalCoordinator, RunRecord } from '../coordinator/index.js';
import { callbackTarget, postCallback, type CallbackPolicy } from './callback-url.js';

type Json = Record<string, unknown>;

/** What a declared-route start remembers beside the run: the route, and the callback with its delivery state. */
export interface HttpNote {
  route: { method: string; path: string };
  callbackUrl?: string;
  /** When the callback was accepted. */
  delivered?: string;
  /** Attempts so far, and when the next may be made. */
  attempts?: number;
  nextAt?: string;
  lastError?: string;
  /** Set when every attempt failed; nothing more is tried. */
  gaveUp?: string;
}

/** Delay before each retry of a callback. After the last, delivery gives up and records why. */
export const CALLBACK_BACKOFF_MS = [2_000, 10_000, 60_000, 300_000, 900_000];

/** How long one attempt may take. */
const ATTEMPT_TIMEOUT_MS = 10_000;

export interface CallbackOutcome { runId: string; url: string; ok: boolean; status?: number; error?: string; attempt: number; gaveUp?: boolean }

export interface CallbackDeliveryOptions {
  coordinator: LocalCoordinator;
  /** Which URLs may receive callbacks; checked again at every attempt. */
  policy?: CallbackPolicy;
  /** Signs each body with an HMAC when set. */
  token?: string;
  /** Whether this process is driving the run right now; its callback waits for the segment to end. */
  inFlight: (runId: string) => boolean;
  /** A completed run's output ports, without the control ports, and whether it took its failure path. */
  outputs: (result: unknown) => { data: Json; failed: boolean };
  /** Called after each attempt. */
  onCallback?: (outcome: CallbackOutcome) => void;
  /** The clock, for tests. */
  now?: () => number;
}

export type CallbackDelivery = ReturnType<typeof createCallbackDelivery>;

export function createCallbackDelivery(opts: CallbackDeliveryOptions) {
  const { coordinator } = opts;
  const now = opts.now ?? Date.now;
  // Runs with a callback still owed: found in the store at start, added to
  // as requests come in, swept on a timer.
  const pending = new Set<string>();
  const delivering = new Set<string>();

  /** The body a callback carries: the run, its status, and its outputs or its error. */
  function bodyFor(rec: RunRecord): Json {
    const body: Json = { runId: rec.runId, workflow: rec.workflowName, status: rec.status };
    if (rec.status === 'completed') { const { data, failed } = opts.outputs(rec.result); body.result = data; body.failed = failed; }
    if (rec.status === 'failed') body.error = { code: 'EXECUTION_ERROR', message: rec.error };
    return body;
  }

  /**
   * One attempt at a run's callback, when one is owed and due. A failure
   * records when the next may be made, with growing delays, until the last
   * attempt gives up and says why. The URL is checked again at each attempt
   * and the post goes to the address that check resolved, so a name
   * re-pointed at a private address since the run began is refused.
   * Redirects are not followed, for the same reason.
   */
  async function deliver(id: string): Promise<void> {
    const note = await coordinator.kept<HttpNote>(id, 'http');
    if (!note?.callbackUrl || note.delivered || note.gaveUp) { pending.delete(id); return; }
    const rec = await coordinator.record(id);
    if (!rec) { pending.delete(id); return; }
    if (rec.status === 'waiting' || opts.inFlight(id)) { pending.add(id); return; }
    if (note.nextAt && Date.parse(note.nextAt) > now()) { pending.add(id); return; }
    if (delivering.has(id)) return;
    delivering.add(id);
    const attempt = (note.attempts ?? 0) + 1;
    try {
      const text = JSON.stringify(bodyFor(rec));
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Flow-Weaver-Run': id, 'X-Flow-Weaver-Status': rec.status, 'X-Flow-Weaver-Attempt': String(attempt) };
      if (opts.token) headers['X-Flow-Weaver-Signature'] = `sha256=${createHmac('sha256', opts.token).update(text).digest('hex')}`;
      let error = '';
      let status: number | undefined;
      try {
        const target = await callbackTarget(note.callbackUrl, opts.policy);
        if ('refused' in target) throw new Error(`callbackUrl refused at delivery: ${target.refused}`);
        status = await postCallback(target, headers, text, ATTEMPT_TIMEOUT_MS);
        if (status >= 200 && status < 300) {
          await coordinator.keep(id, 'http', { ...note, attempts: attempt, delivered: new Date(now()).toISOString() });
          pending.delete(id);
          opts.onCallback?.({ runId: id, url: note.callbackUrl, ok: true, status, attempt });
          return;
        }
        error = status >= 300 && status < 400 ? `callback answered ${status}, redirects are not followed` : `callback answered ${status}`;
      } catch (e) { error = e instanceof Error ? e.message : String(e); }
      const gaveUp = attempt >= CALLBACK_BACKOFF_MS.length;
      const next: HttpNote = { ...note, attempts: attempt, lastError: error, ...(gaveUp ? { gaveUp: new Date(now()).toISOString() } : { nextAt: new Date(now() + CALLBACK_BACKOFF_MS[attempt - 1]).toISOString() }) };
      // A run removed meanwhile has nowhere to keep the note.
      if (await coordinator.record(id)) await coordinator.keep(id, 'http', next);
      if (gaveUp) pending.delete(id); else pending.add(id);
      opts.onCallback?.({ runId: id, url: note.callbackUrl, ok: false, status, error, attempt, gaveUp });
    } finally {
      delivering.delete(id);
    }
  }

  return {
    deliver,
    /** A run now owes a callback: remember it, and try at once. */
    owe(id: string): void { pending.add(id); void deliver(id); },
    /** Find the runs of these workflows that still owe a callback, as when the API starts. */
    async scan(workflowNames: ReadonlySet<string>): Promise<void> {
      for (const s of await coordinator.list()) {
        if (!workflowNames.has(s.workflowName)) continue;
        const note = await coordinator.kept<HttpNote>(s.runId, 'http');
        if (note?.callbackUrl && !note.delivered && !note.gaveUp) pending.add(s.runId);
      }
    },
    /** Try every callback still owed. */
    async deliverPending(): Promise<void> {
      for (const id of [...pending]) await deliver(id);
    },
    /** The runs still owing a callback. */
    pending: (): readonly string[] => [...pending],
  };
}
