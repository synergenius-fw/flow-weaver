import { getMockConfig } from './mock-types.js';
import { CancellationError } from '../runtime/CancellationError.js';
import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

/**
 * @flowWeaver nodeType
 * @input duration - Duration to sleep (e.g. "30s", "5m", "1h", "2d")
 * @output elapsed - Always true after sleep completes
 */
export async function delay(
  execute: boolean,
  duration: string,
  abortSignal?: AbortSignal,
  runtime?: NodeExecutionRuntime,
): Promise<{ onSuccess: boolean; onFailure: boolean; elapsed: boolean }> {
  if (!execute) return { onSuccess: false, onFailure: false, elapsed: false };

  const mocks = getMockConfig(runtime);
  if (mocks?.fast) {
    // Fast mode: skip real sleep, keep async behavior with 1ms
    await waitForDuration(1, abortSignal);
  } else {
    const ms = parseDuration(duration) ?? 0;
    // setTimeout holds a signed 32-bit delay. Past 2^31-1 ms (24.8 days) it
    // fires at once with a warning instead of waiting, so a longer duration
    // is refused rather than silently cut short. A run that waits that long
    // wants `sleep`, which holds no process.
    if (ms > 2147483647) {
      throw new Error(
        'delay: "' + duration + '" is longer than setTimeout can wait (24.8 days); use sleep for a wait this long',
      );
    }
    await waitForDuration(ms, abortSignal);
  }

  return { onSuccess: true, onFailure: false, elapsed: true };
}

function waitForDuration(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) return Promise.reject(new CancellationError());

  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      reject(new CancellationError());
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    abortSignal?.addEventListener('abort', onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
  });
}

// `<number><unit>` with unit `ms`, `s`, `m`, `h` or `d`, whitespace around
// either allowed; `undefined` for anything else, including an empty string.
// This is the one reading of a duration string in the package: the
// coordinator's clock (`src/coordinator/time.ts`) re-exports it for a
// `sleep` duration and a gate `timeout`, and this file's body is inlined into
// compiled workflows, which is why the function lives here and not there.
export function parseDuration(text: unknown): number | undefined {
  if (typeof text !== 'string') return undefined;
  const match = /^\s*(\d+)\s*(ms|s|m|h|d)\s*$/.exec(text);
  if (!match) return undefined;
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Number(match[1]) * units[match[2]];
}
