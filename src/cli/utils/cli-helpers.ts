/**
 * Shared CLI utilities for consistent UX across all commands.
 */

import * as readline from 'node:readline';
import { loadCredentials } from '../config/credentials.js';
import { PlatformClient } from '../config/platform-client.js';

// ---------------------------------------------------------------------------
// UUID detection
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

export interface LoginContext {
  creds: NonNullable<ReturnType<typeof loadCredentials>>;
  client: PlatformClient;
}

/**
 * Require login. Exits with code 1 and a helpful message if not logged in.
 * Returns both the stored credentials and a PlatformClient instance.
 */
export function requireLogin(): LoginContext {
  const creds = loadCredentials();
  if (!creds) {
    console.error('  \x1b[31m✗\x1b[0m Not logged in. Run: fw login');
    process.exit(1);
  }
  return { creds, client: new PlatformClient(creds) };
}

// ---------------------------------------------------------------------------
// Interactive input
// ---------------------------------------------------------------------------

/**
 * Read a line from stdin. Returns the trimmed input.
 * In non-TTY environments (piped input, CI), returns null instead of hanging.
 * Handles Ctrl+C / readline close gracefully by resolving null.
 */
export function readLine(prompt: string): Promise<string | null> {
  if (!process.stdin.isTTY) {
    return Promise.resolve(null);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
    rl.on('close', () => {
      if (!answered) resolve(null);
    });
  });
}

/**
 * Ask for confirmation. Returns true only if user types 'y'.
 * In non-TTY environments, returns false (safe default).
 */
export async function confirm(prompt: string): Promise<boolean> {
  const answer = await readLine(prompt);
  if (answer === null) return false;
  return answer.toLowerCase() === 'y';
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

export const fmt = {
  ok: (msg: string) => `  \x1b[32m✓\x1b[0m ${msg}`,
  err: (msg: string) => `  \x1b[31m✗\x1b[0m ${msg}`,
  dim: (msg: string) => `\x1b[2m${msg}\x1b[0m`,
  bold: (msg: string) => `\x1b[1m${msg}\x1b[0m`,
  cyan: (msg: string) => `\x1b[36m${msg}\x1b[0m`,
  yellow: (msg: string) => `\x1b[33m${msg}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Extract a user-friendly error message. Maps common HTTP status codes
 * to actionable messages.
 */
export function formatError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message;
  if (msg.includes('401') || msg.includes('Auth failed')) {
    return 'Session expired. Run: fw login';
  }
  if (msg.includes('403') || msg.includes('Forbidden')) {
    return msg; // Pass through — 403 errors usually have specific messages like "requires Pro plan"
  }
  return msg;
}

/**
 * Log an error and exit with code 1.
 */
export function exitWithError(err: unknown, fallback: string): never {
  console.error(fmt.err(formatError(err, fallback)));
  process.exit(1);
}
