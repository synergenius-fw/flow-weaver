/**
 * Whether a caller-supplied callback URL may be fetched.
 *
 * A callback is the server making a request to an address the caller
 * chose, which is the shape of a server-side request forgery: pointed at
 * the metadata service, a database admin port, or the API itself. So by
 * default only public http(s) hosts are allowed: literal private, loopback
 * and link-local addresses are refused, as is a name that resolves to one.
 * An embedding names the hosts it trusts instead, or allows private
 * addresses outright for development.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface CallbackPolicy {
  /** Allow loopback, private and link-local addresses. For development. */
  allowPrivate?: boolean;
  /** Hosts that may receive callbacks (`example.com`, `*.internal.example.com`). Anything else is refused. */
  hosts?: string[];
  /** Your own rule. A string is the reason for refusing. */
  allow?: (url: URL) => boolean | string;
}

/** Whether an IP is one that should not be reached from a public server. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true;           // unique local
    if (/^fe[89ab]/.test(low)) return true;                                  // link local
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);               // IPv4 mapped
    if (mapped) return isPrivateAddress(mapped[1]);
  }
  return false;
}

const hostMatches = (host: string, pattern: string) => {
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return host.endsWith(p.slice(1)) && host.length > p.length - 1;
  return host === p;
};

/** The reason a callback URL is refused, or undefined when it may be used. */
export async function refuseCallbackUrl(raw: string, policy: CallbackPolicy = {}): Promise<string | undefined> {
  let url: URL;
  try { url = new URL(raw); } catch { return 'not a valid URL'; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'only http and https callbacks are delivered';
  if (url.username || url.password) return 'credentials in the URL are not allowed';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (policy.allow) {
    const verdict = policy.allow(url);
    if (verdict !== true) return typeof verdict === 'string' ? verdict : 'refused by the server\'s callback policy';
    return undefined;
  }
  if (policy.hosts) {
    return policy.hosts.some((h) => hostMatches(host, h)) ? undefined : `${host} is not among the hosts this server delivers callbacks to`;
  }
  if (policy.allowPrivate) return undefined;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return `${host} is a private host, and callbacks go to public addresses only`;
  if (isIP(host)) return isPrivateAddress(host) ? `${host} is a private address, and callbacks go to public addresses only` : undefined;
  try {
    const found = await lookup(host, { all: true });
    if (!found.length) return `${host} does not resolve`;
    const bad = found.find((a) => isPrivateAddress(a.address));
    if (bad) return `${host} resolves to ${bad.address}, a private address, and callbacks go to public addresses only`;
  } catch {
    return `${host} does not resolve`;
  }
  return undefined;
}
