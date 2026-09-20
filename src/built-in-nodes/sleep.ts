import { getMockConfig } from './mock-types.js';
import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

/**
 * @flowWeaver nodeType
 * @input duration - How long the run sleeps before it goes on (e.g. "30s", "2h", "3d")
 * @output wokeAt - When the run went on, as an ISO 8601 time
 */
export async function sleep(
  execute: boolean,
  duration: string,
  runtime?: NodeExecutionRuntime,
): Promise<{ onSuccess: boolean; onFailure: boolean; wokeAt: string }> {
  if (!execute) return { onSuccess: false, onFailure: false, wokeAt: '' };

  const mocks = getMockConfig(runtime);
  if (mocks) {
    // Mock mode -- `fast` wakes at once, as it makes `delay` return at once
    if (mocks.fast) return { onSuccess: true, onFailure: false, wokeAt: new Date().toISOString() };
  }

  // A timer gate: in a compiled workflow this body is never called. The run
  // yields here and whoever keeps it -- the coordinator, or a host of its
  // own -- resumes it once `duration` has passed. Called directly, it does
  // not hold the process: that is what `delay` is for.
  void duration;
  return { onSuccess: true, onFailure: false, wokeAt: new Date().toISOString() };
}
