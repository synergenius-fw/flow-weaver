/**
 * Who may act on the console.
 *
 * The console has no login. On the loopback interface that is safe for the
 * person at the machine, but a web page they have open can reach the port
 * too, in two ways, and both are refused here:
 *
 * - DNS rebinding points a name the page controls at 127.0.0.1, so the
 *   browser lets the page read the console's answers. The Host header still
 *   names the page's domain, so on a loopback address only a loopback Host
 *   is accepted.
 * - A cross-site form, or a fetch in no-cors mode, sends a POST with no
 *   preflight. The browser still names the sending page in Origin, so a
 *   change is accepted only from the console's own origin, or from a client
 *   that sends no Origin at all (curl, a script, a test).
 */
import { isLoopback } from '../server/api.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The host name of a Host header, without the port; IPv6 keeps its brackets. */
function hostName(host: string): string {
  const bracketed = host.match(/^\[[^\]]*\]/);
  return (bracketed ? bracketed[0] : host.replace(/:\d*$/, '')).toLowerCase();
}

/**
 * Why a request must be refused, or undefined to let it through.
 *
 * @param bound The address the console listens on, as given to `listen`.
 */
export function refusal(
  req: { method?: string; headers: Record<string, string | string[] | undefined> },
  bound: string,
): string | undefined {
  const host = typeof req.headers.host === 'string' ? req.headers.host : '';
  if (!host) return 'the request has no Host header';
  if (isLoopback(bound) && !isLoopback(hostName(host))) {
    return `the console answers only to a loopback Host, not ${host}`;
  }
  const origin = req.headers.origin;
  if (origin === undefined || SAFE_METHODS.has((req.method ?? 'GET').toUpperCase())) return undefined;
  if (origin !== `http://${host}`) {
    return `a change is accepted only from the console's own origin, not ${String(origin)}`;
  }
  return undefined;
}
