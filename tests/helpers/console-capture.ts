/**
 * Capture what a CLI command prints, so a test can assert on the output
 * instead of only checking that the command did not throw.
 */
import { vi } from 'vitest';

type Stream = 'log' | 'info' | 'warn' | 'error';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

export interface ConsoleCapture {
  /** Everything printed, ANSI colours stripped, one call per line. */
  text(): string;
  /** Output of the given console methods only. */
  of(...streams: Stream[]): string;
  restore(): void;
}

export function captureConsole(): ConsoleCapture {
  const lines: Array<{ stream: Stream; text: string }> = [];
  const spies = (['log', 'info', 'warn', 'error'] as const).map((stream) =>
    vi.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
      lines.push({ stream, text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') });
    }),
  );
  const join = (keep: (s: Stream) => boolean) =>
    lines
      .filter((l) => keep(l.stream))
      .map((l) => l.text.replace(ANSI, ''))
      .join('\n');
  return {
    text: () => join(() => true),
    of: (...streams) => join((s) => streams.includes(s)),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}
