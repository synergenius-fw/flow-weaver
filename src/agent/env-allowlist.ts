/**
 * Allowlisted environment variables for spawned CLI processes.
 *
 * Only these variables are forwarded from the host process to prevent
 * leaking secrets, user identity, SSH agent sockets, workspace paths,
 * and other sensitive host data to AI CLI tools.
 */

/**
 * Minimal PATH for sandboxed AI CLI processes. Contains only standard
 * system directories. CLI binaries are invoked via `process.execPath`
 * (node) directly, bypassing shebang resolution, so the node binary
 * directory is NOT needed here.
 */
export const MINIMAL_PATH = '/usr/local/bin:/usr/bin:/bin';

export const ENV_ALLOWLIST: readonly string[] = [
  // System basics
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TZ',
  // Node/runtime
  'NODE_ENV',
  'NO_COLOR',
  'FORCE_COLOR',
  // TLS/certificates
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  // Network proxy (needed behind corporate proxies)
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
];

/**
 * Build a safe environment object from the current process, forwarding
 * only allowlisted keys. Callers can spread additional overrides on top.
 */
export function buildSafeEnv(overrides?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  if (overrides) {
    Object.assign(env, overrides);
  }
  return env;
}

/**
 * Convenience helper that returns both `cwd` and `env` in one object,
 * making it harder to forget either when spawning a child process.
 */
export function buildSafeSpawnOpts(
  cwd: string,
  envOverrides?: Record<string, string | undefined>,
): { cwd: string; env: NodeJS.ProcessEnv } {
  return { cwd, env: buildSafeEnv(envOverrides) };
}
