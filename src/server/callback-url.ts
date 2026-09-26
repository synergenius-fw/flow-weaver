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
import * as http from 'node:http';
import * as https from 'node:https';
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
    const low = canonicalIPv6(ip);
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true;           // unique local
    if (/^fe[89ab]/.test(low)) return true;                                  // link local
    // IPv4 mapped. The canonical spelling carries the IPv4 address as two
    // hex groups (::ffff:127.0.0.1 is ::ffff:7f00:1), and a connection to it
    // reaches that IPv4 address.
    const mapped = low.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
  }
  return false;
}

/**
 * One spelling per IPv6 address, the URL parser's: lower case, leading
 * zeros dropped, the longest run of zero groups compressed, an embedded
 * IPv4 address in hex. `0:0:0:0:0:0:0:1` is `::1`. An address the parser
 * refuses (one with a zone, `fe80::1%eth0`) is only lower-cased.
 */
function canonicalIPv6(ip: string): string {
  try {
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return ip.toLowerCase();
  }
}

const hostMatches = (host: string, pattern: string) => {
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return host.endsWith(p.slice(1)) && host.length > p.length - 1;
  return host === p;
};

/** Resolves a host name to its addresses; the system resolver unless a test hands in its own. */
export type Resolve = (host: string) => Promise<Array<{ address: string; family: number }>>;
const systemResolve: Resolve = (host) => lookup(host, { all: true });

/** Where a callback is posted: the URL, and the one address it connects to. */
export interface CallbackTarget {
  url: URL;
  address: string;
  family: number;
}

/**
 * What the policy says about the URL alone, before any lookup: a refusal,
 * or whether the addresses the host resolves to must still be public.
 */
function judgeUrl(raw: string, policy: CallbackPolicy): { refused: string } | { url: URL; host: string; publicOnly: boolean } {
  let url: URL;
  try { url = new URL(raw); } catch { return { refused: 'not a valid URL' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { refused: 'only http and https callbacks are delivered' };
  if (url.username || url.password) return { refused: 'credentials in the URL are not allowed' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (policy.allow) {
    const verdict = policy.allow(url);
    if (verdict !== true) return { refused: typeof verdict === 'string' ? verdict : 'refused by the server\'s callback policy' };
    return { url, host, publicOnly: false };
  }
  if (policy.hosts) {
    return policy.hosts.some((h) => hostMatches(host, h))
      ? { url, host, publicOnly: false }
      : { refused: `${host} is not among the hosts this server delivers callbacks to` };
  }
  if (policy.allowPrivate) return { url, host, publicOnly: false };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return { refused: `${host} is a private host, and callbacks go to public addresses only` };
  return { url, host, publicOnly: true };
}

/**
 * The addresses of a host, or why a callback may not go there. A literal
 * address is its own answer; a name is looked up.
 */
async function addressesOf(host: string, publicOnly: boolean, resolve: Resolve): Promise<{ refused: string } | Array<{ address: string; family: number }>> {
  const literal = isIP(host);
  let found: Array<{ address: string; family: number }>;
  if (literal) found = [{ address: host, family: literal }];
  else {
    try { found = await resolve(host); } catch { return { refused: `${host} does not resolve` }; }
    if (!found.length) return { refused: `${host} does not resolve` };
  }
  const bad = publicOnly ? found.find((a) => isPrivateAddress(a.address)) : undefined;
  if (bad) {
    return { refused: literal ? `${host} is a private address, and callbacks go to public addresses only` : `${host} resolves to ${bad.address}, a private address, and callbacks go to public addresses only` };
  }
  return found;
}

/**
 * The reason a callback URL is refused, or undefined when it may be used.
 * Checked when a run is accepted; delivery checks again with
 * `callbackTarget`. A host named by the policy is not looked up here.
 */
export async function refuseCallbackUrl(raw: string, policy: CallbackPolicy = {}, resolve: Resolve = systemResolve): Promise<string | undefined> {
  const judged = judgeUrl(raw, policy);
  if ('refused' in judged) return judged.refused;
  if (!judged.publicOnly) return undefined;
  const found = await addressesOf(judged.host, true, resolve);
  return 'refused' in found ? found.refused : undefined;
}

/**
 * Where to deliver a callback now: the URL checked again, its host resolved
 * once, and every address checked. The post then connects to the address
 * returned here, so a name that has since been pointed at a private
 * address (DNS rebinding) is refused rather than fetched.
 */
export async function callbackTarget(raw: string, policy: CallbackPolicy = {}, resolve: Resolve = systemResolve): Promise<CallbackTarget | { refused: string }> {
  const judged = judgeUrl(raw, policy);
  if ('refused' in judged) return judged;
  const found = await addressesOf(judged.host, judged.publicOnly, resolve);
  if ('refused' in found) return found;
  return { url: judged.url, address: found[0].address, family: found[0].family };
}

/**
 * POST a callback to the target's address, naming the URL's host in the
 * Host header and, over https, in the certificate check. Redirects are not
 * followed. Resolves with the status; rejects on a network error or when
 * `timeoutMs` passes.
 */
export function postCallback(target: CallbackTarget, headers: Record<string, string>, body: string, timeoutMs: number): Promise<number> {
  const { url, address, family } = target;
  const send = url.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const req = send(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      signal: AbortSignal.timeout(timeoutMs),
      // Every connection goes to the checked address, whatever the name resolves to now.
      lookup: (_host, options, callback) => {
        if ((options as { all?: boolean }).all) (callback as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
        else (callback as (e: null, a: string, f: number) => void)(null, address, family);
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}
