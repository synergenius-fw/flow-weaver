/**
 * Whether the CLI is running without a terminal to prompt on (piped stdin,
 * CI). Commands that would otherwise ask questions fall back to defaults.
 */
export function isNonInteractive(): boolean {
  return !process.stdin.isTTY;
}
