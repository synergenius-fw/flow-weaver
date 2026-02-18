/* eslint-disable no-console */
/**
 * CLI logging utility with colors and formatting
 */

// ANSI color support - respects NO_COLOR env var and non-TTY
const USE_COLOR = !process.env.NO_COLOR && process.stdout.isTTY !== false;

const RESET = USE_COLOR ? '\x1b[0m' : '';
const GREEN = USE_COLOR ? '\x1b[32m' : '';
const RED = USE_COLOR ? '\x1b[31m' : '';
const YELLOW = USE_COLOR ? '\x1b[33m' : '';
const BLUE = USE_COLOR ? '\x1b[34m' : '';
const BOLD = USE_COLOR ? '\x1b[1m' : '';
const DIM = USE_COLOR ? '\x1b[2m' : '';

export const logger = {
  info(message: string): void {
    console.log(`${BLUE}ℹ ${message}${RESET}`);
  },

  success(message: string): void {
    console.log(`${GREEN}✓ ${message}${RESET}`);
  },

  error(message: string): void {
    console.error(`${RED}✗ ${message}${RESET}`);
  },

  warn(message: string): void {
    console.warn(`${YELLOW}⚠ ${message}${RESET}`);
  },

  debug(message: string): void {
    if (process.env.DEBUG) {
      console.log(`${DIM}🔍 ${message}${RESET}`);
    }
  },

  log(message: string): void {
    console.log(message);
  },

  newline(): void {
    console.log();
  },

  section(title: string): void {
    console.log();
    console.log(`${BOLD}━━━ ${title} ━━━${RESET}`);
  },

  progress(current: number, total: number, item: string): void {
    console.log(`[${current}/${total}] ${item}`);
  },
};
