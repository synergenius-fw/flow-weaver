/**
 * Who may call the API and from where: the bearer token a request must
 * carry, the CORS headers a browser is given, and which hosts count as this
 * machine.
 */
import { timingSafeEqual } from 'node:crypto';
import type { ServerRequest, ServerResponse } from './transport.js';
import { header } from './respond.js';

export const isLoopback = (host: string) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);

/** Whether the request carries the token, compared in constant time. No token configured means every request is. */
export function authorized(req: ServerRequest, token: string | undefined): boolean {
  if (!token) return true;
  const raw = req.headers.authorization;
  const line = Array.isArray(raw) ? raw[0] : raw;
  const given = /^Bearer\s+(.+)$/i.exec(line ?? '')?.[1]?.trim() ?? '';
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * CORS headers for the configured origin(s). A browser accepts one origin
 * in the header, so with a list the request's own Origin is echoed when it
 * is on the list, and the response varies by Origin so a cache never
 * serves one origin's answer to another.
 */
export function cors(req: ServerRequest, res: ServerResponse, allowed: string | string[] | undefined): void {
  if (!allowed) return;
  let origin: string | undefined;
  if (Array.isArray(allowed)) {
    const requested = header(req, 'origin');
    origin = requested !== undefined && allowed.includes(requested) ? requested : undefined;
    res.setHeader('Vary', 'Origin');
  } else {
    origin = allowed;
  }
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Prefer, Idempotency-Key, X-Callback-Url');
}
