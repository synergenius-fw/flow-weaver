/**
 * CLI logging utility with colors and formatting
 */

import pc from 'picocolors';

const isTTY = process.stdout.isTTY === true;

// Spinner frames
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Where output for a person goes. A command whose stdout carries a result
 * for a program (`--json`) sends it to stderr instead, so the two never mix.
 */
let humanToStderr = false;
const print = (...args: unknown[]): void => {
  if (humanToStderr) console.error(...args);
  else console.log(...args);
};

export const logger = {
  /** Send what the logger prints for a person to stderr (true) or back to stdout. */
  toStderr(on: boolean): void {
    humanToStderr = on;
  },

  info(message: string): void {
    print(`${pc.blue('ℹ')} ${message}`);
  },

  success(message: string): void {
    print(`${pc.green('✓')} ${message}`);
  },

  error(message: string): void {
    console.error(`${pc.red('✗')} ${message}`);
  },

  warn(message: string): void {
    console.warn(pc.yellow(message));
  },

  debug(message: string): void {
    if (process.env.DEBUG) {
      print(pc.dim(message));
    }
  },

  log(message: string): void {
    print(message);
  },

  newline(): void {
    print();
  },

  section(title: string): void {
    print();
    print(`  ${pc.bold(title)}`);
    print();
  },

  progress(current: number, total: number, item: string): void {
    print(`${pc.dim(`[${current}/${total}]`)} ${item}`);
  },

  // --- Formatting helpers ---

  dim(message: string): string {
    return pc.dim(message);
  },

  bold(message: string): string {
    return pc.bold(message);
  },

  highlight(value: string): string {
    return pc.cyan(value);
  },

  // --- Branded output ---

  banner(version: string): void {
    print(`  ${pc.bold(pc.cyan('flow-weaver'))} ${pc.dim(`v${version}`)}`);
  },

  // --- Table output ---

  table(rows: [string, string, string?][]): void {
    if (rows.length === 0) return;
    const col0 = Math.max(...rows.map((r) => r[0].length)) + 2;
    const col1 = Math.max(...rows.map((r) => r[1].length)) + 2;
    for (const [label, value, status] of rows) {
      const line = `  ${label.padEnd(col0)}${value.padEnd(col1)}${status ?? ''}`;
      print(line);
    }
  },

  // --- Spinner ---

  spinner(message: string): { stop: (msg?: string) => void; fail: (msg?: string) => void; update: (msg: string) => void } {
    if (!isTTY) {
      // Non-TTY: print a static line
      process.stderr.write(`  ${message}\n`);
      return {
        stop(msg?: string) { if (msg) process.stderr.write(`  ${pc.green('✓')} ${msg}\n`); },
        fail(msg?: string) { if (msg) process.stderr.write(`  ${pc.red('✗')} ${msg}\n`); },
        update() {},
      };
    }

    let frame = 0;
    let text = message;
    const interval = setInterval(() => {
      const spinner = pc.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
      process.stderr.write(`\r\x1b[K  ${spinner} ${text}`);
      frame++;
    }, 80);

    const clear = () => {
      clearInterval(interval);
      process.stderr.write('\r\x1b[K');
    };

    return {
      stop(msg?: string) {
        clear();
        if (msg) process.stderr.write(`  ${pc.green('✓')} ${msg}\n`);
      },
      fail(msg?: string) {
        clear();
        if (msg) process.stderr.write(`  ${pc.red('✗')} ${msg}\n`);
      },
      update(msg: string) {
        text = msg;
      },
    };
  },

  // --- Timer ---

  timer(): { elapsed: () => string; ms: () => number } {
    const start = performance.now();
    return {
      elapsed(): string {
        const ms = performance.now() - start;
        if (ms < 1000) return `${Math.round(ms)}ms`;
        if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
        const mins = Math.floor(ms / 60_000);
        const secs = Math.round((ms % 60_000) / 1000);
        return `${mins}m ${secs}s`;
      },
      ms(): number {
        return Math.round(performance.now() - start);
      },
    };
  },
};
