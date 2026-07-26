import { getMockConfig } from './mock-types.js';
import { CancellationError } from '../runtime/CancellationError.js';

/**
 * @flowWeaver nodeType
 * @input duration - Duration to sleep (e.g. "30s", "5m", "1h", "2d")
 * @output elapsed - Always true after sleep completes
 */
export async function delay(
  execute: boolean,
  duration: string,
  abortSignal?: AbortSignal
): Promise<{ onSuccess: boolean; onFailure: boolean; elapsed: boolean }> {
  if (!execute) return { onSuccess: false, onFailure: false, elapsed: false };

  const mocks = getMockConfig();
  if (mocks?.fast) {
    // Fast mode: skip real sleep, keep async behavior with 1ms
    await waitForDuration(1, abortSignal);
  } else {
    const ms = parseDuration(duration);
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

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 0;
  const [, value, unit] = match;
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(value) * (multipliers[unit] || 0);
}
