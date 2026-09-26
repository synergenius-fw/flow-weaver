/**
 * The step trace a run keeps beside its record.
 *
 * Decides whether a segment is traced at all (only when its driver asks,
 * since tracing needs the debug build), how its events are kept, whether
 * the run is still traced end to end once the segment is added, and which
 * step a failed run is opened at.
 */
import type { ExecutionTraceEvent } from '../mcp/workflow-executor.js';
import type { DriveOptions, RunRecord, TraceEntry } from './run-store.js';
import type { RunStore } from './store.js';

/**
 * What one segment of execution is given: the driver's observer wrapped so
 * the events are also kept, when asked. Tracing needs the debug build of
 * the workflow, which is where the events come from.
 */
export function observe(options: DriveOptions | undefined) {
  const tracing = options?.trace === true || options?.onEvent !== undefined;
  if (!tracing) return { kept: undefined, request: { includeTrace: false as const, production: true } };
  const kept: TraceEntry[] = [];
  const onEvent = (event: ExecutionTraceEvent) => {
    kept.push({ t: event.timestamp, e: event.data ?? event });
    options?.onEvent?.(event);
  };
  return { kept, request: { includeTrace: true as const, production: false, onEvent } };
}

/**
 * Add a segment's events to the kept trace. Returns whether the run is
 * traced end to end: one segment driven without a trace -- resumed by an
 * assistant, say -- leaves a gap, and a reader must not fill it in.
 */
export async function appendTrace(store: RunStore, record: RunRecord, kept: TraceEntry[] | undefined): Promise<boolean> {
  if (!kept) return false;
  const previous = await readTrace(store, record.runId);
  await store.putDoc(record.runId, 'trace', [...previous, ...kept]);
  return true;
}

export async function readTrace(store: RunStore, runId: string): Promise<TraceEntry[]> {
  const doc = await store.getDoc(runId, 'trace');
  return Array.isArray(doc) ? (doc as TraceEntry[]) : [];
}

/** The step whose error the trace recorded last, if it recorded one. */
export function failedNodeIn(kept: TraceEntry[] | undefined): string | undefined {
  if (!kept) return undefined;
  for (let i = kept.length - 1; i >= 0; i--) {
    const e = kept[i].e as { type?: string; id?: string; status?: string } | undefined;
    if (e?.type === 'LOG_ERROR' && e.id) return e.id;
    if (e?.type === 'STATUS_CHANGED' && e.status === 'FAILED' && e.id) return e.id;
  }
  return undefined;
}
