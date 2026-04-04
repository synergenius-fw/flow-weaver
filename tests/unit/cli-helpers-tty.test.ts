/**
 * Tests for cli-helpers.ts readLine/confirm TTY paths.
 * Separate file because readline must be mocked at vi.mock level (before import).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let questionAnswer = 'default';

vi.mock('node:readline', () => ({
  createInterface: () => {
    let closeHandler: (() => void) | null = null;
    return {
      question: (_prompt: string, cb: (answer: string) => void) => {
        cb(questionAnswer);
        // Fire close after question (simulates normal readline lifecycle)
        setTimeout(() => closeHandler?.(), 0);
      },
      on: (event: string, handler: () => void) => {
        if (event === 'close') closeHandler = handler;
      },
      close: vi.fn(),
    };
  },
}));

// Mock credentials/platform-client to satisfy cli-helpers imports
vi.mock('../../src/cli/config/credentials.js', () => ({
  loadCredentials: () => null,
}));

vi.mock('../../src/cli/config/platform-client.js', () => ({
  PlatformClient: class {},
}));

beforeEach(() => {
  questionAnswer = 'default';
});

describe('readLine (TTY)', () => {
  it('returns trimmed input when stdin is TTY', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    questionAnswer = '  hello world  ';
    const { readLine } = await import('../../src/cli/utils/cli-helpers');
    const result = await readLine('prompt: ');

    expect(result).toBe('hello world');

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });
});

describe('confirm (TTY)', () => {
  it('returns true when user types y', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    questionAnswer = 'y';
    const { confirm } = await import('../../src/cli/utils/cli-helpers');
    const result = await confirm('Sure? ');

    expect(result).toBe(true);

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });

  it('returns true when user types Y (case insensitive)', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    questionAnswer = 'Y';
    const { confirm } = await import('../../src/cli/utils/cli-helpers');
    const result = await confirm('Sure? ');

    expect(result).toBe(true);

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });

  it('returns false when user types n', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    questionAnswer = 'n';
    const { confirm } = await import('../../src/cli/utils/cli-helpers');
    const result = await confirm('Sure? ');

    expect(result).toBe(false);

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });

  it('returns false when user types empty string', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    questionAnswer = '';
    const { confirm } = await import('../../src/cli/utils/cli-helpers');
    const result = await confirm('Sure? ');

    expect(result).toBe(false);

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });
});
