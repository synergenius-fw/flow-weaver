/**
 * Tests readLine close event handler (Ctrl+C / stdin close).
 * Separate file because it needs its own readline mock that simulates close without answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:readline', () => ({
  createInterface: () => {
    let closeHandler: (() => void) | null = null;
    return {
      question: (_prompt: string, _cb: (answer: string) => void) => {
        // Don't call cb — simulate readline closing without user input
        setTimeout(() => closeHandler?.(), 0);
      },
      on: (event: string, handler: () => void) => {
        if (event === 'close') closeHandler = handler;
      },
      close: vi.fn(),
    };
  },
}));

vi.mock('../../src/cli/config/credentials.js', () => ({
  loadCredentials: () => null,
}));

vi.mock('../../src/cli/config/platform-client.js', () => ({
  PlatformClient: class {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readLine close event', () => {
  it('resolves null when readline closes without answering', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { readLine } = await import('../../src/cli/utils/cli-helpers');
    const result = await readLine('prompt: ');

    expect(result).toBeNull();

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });
});

describe('confirm close event', () => {
  it('returns false when readline closes without answering', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { confirm } = await import('../../src/cli/utils/cli-helpers');
    const result = await confirm('Sure? ');

    expect(result).toBe(false);

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });
});
