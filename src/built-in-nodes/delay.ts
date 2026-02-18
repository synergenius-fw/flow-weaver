import { getMockConfig } from './mock-types.js';

/**
 * @flowWeaver nodeType
 * @input duration - Duration to sleep (e.g. "30s", "5m", "1h", "2d")
 * @output elapsed - Always true after sleep completes
 */
export async function delay(
  execute: boolean,
  duration: string
): Promise<{ onSuccess: boolean; onFailure: boolean; elapsed: boolean }> {
  if (!execute) return { onSuccess: false, onFailure: false, elapsed: false };

  const mocks = getMockConfig();
  if (mocks?.fast) {
    // Fast mode: skip real sleep, keep async behavior with 1ms
    await new Promise((resolve) => setTimeout(resolve, 1));
  } else {
    const ms = parseDuration(duration);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  return { onSuccess: true, onFailure: false, elapsed: true };
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 0;
  const [, value, unit] = match;
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(value) * (multipliers[unit] || 0);
}
