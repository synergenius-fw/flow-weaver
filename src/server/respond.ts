/**
 * Reading the API's requests and writing its answers: a request header, the
 * body as an object (JSON or a form post, up to the size limit, or what a
 * framework already parsed), a path segment decoded, whether the caller asked
 * for an answer at once and how long it will wait, and JSON or HTML written
 * back.
 */
import type { ServerRequest, ServerResponse } from './transport.js';
import { HttpError } from './http-error.js';

export type Json = Record<string, unknown>;

export function header(req: ServerRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...extra });
  res.end(text);
}

export function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

/** A path segment decoded, or 400 when the percent-encoding is malformed. */
export function decodeSegment(raw: string): string {
  try { return decodeURIComponent(raw); } catch { throw new HttpError(400, 'BAD_PATH', `the path segment "${raw}" is not valid percent-encoding`); }
}

const isForm = (req: ServerRequest) => /application\/x-www-form-urlencoded/i.test(header(req, 'content-type') ?? '');

/** A body's text as an object: JSON, or a form post's fields as strings. */
function parseBodyText(text: string, form: boolean): Json {
  const t = text.trim();
  if (!t) return {};
  if (form) {
    const out: Json = {};
    for (const [k, v] of new URLSearchParams(t)) out[k] = v;
    return out;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(t); } catch { throw new HttpError(400, 'INVALID_JSON', 'the body is not valid JSON'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HttpError(400, 'INVALID_JSON', 'the body must be a JSON object');
  return parsed as Json;
}

/**
 * The request body. A body the framework already parsed is used as is --
 * the stream cannot be read twice, and `express.json()` will have read
 * it. Otherwise the stream, up to the size limit. `form` says the values
 * are strings from a form post, to be read by the parameters' types.
 */
export async function readBody(req: ServerRequest, given: unknown, maxBody: number): Promise<{ body: Json; form: boolean }> {
  const form = isForm(req);
  const pre = given !== undefined ? given : req.body;
  if (pre !== undefined && pre !== null) {
    if (typeof pre === 'string') return { body: parseBodyText(pre, form), form };
    if (Buffer.isBuffer(pre) || pre instanceof Uint8Array) return { body: parseBodyText(Buffer.from(pre).toString('utf8'), form), form };
    if (typeof pre !== 'object' || Array.isArray(pre)) throw new HttpError(400, 'INVALID_JSON', 'the body must be a JSON object');
    return { body: pre as Json, form };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBody) throw new HttpError(413, 'BODY_TOO_LARGE', `the body may not exceed ${maxBody} bytes`);
    chunks.push(buf);
  }
  return { body: parseBodyText(Buffer.concat(chunks).toString('utf8'), form), form };
}

/** Whether the caller asked for 202 at once: `?async`, or `Prefer: respond-async`. */
export function wantsAsync(req: ServerRequest, url: URL): boolean {
  const q = url.searchParams.get('async');
  if (q !== null) return q !== '0' && q !== 'false';
  return /respond-async/i.test(header(req, 'prefer') ?? '');
}

/** How long this request is willing to wait: `Prefer: wait=<seconds>`, never more than the server's limit. */
export function waitBudget(req: ServerRequest, maxWait: number): number {
  const m = /wait=(\d+(?:\.\d+)?)/i.exec(header(req, 'prefer') ?? '');
  return m ? Math.min(maxWait, Math.max(0, Number(m[1]) * 1000)) : maxWait;
}

/**
 * Wait for the segment, but not past the budget. True when it settled in
 * time (a rejection is rethrown by the caller's own await); false when
 * the request should answer 202 and let the run go on without it.
 */
export async function settledWithin(segment: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const done = await Promise.race([
    segment.then(() => true, () => true),
    new Promise<boolean>((r) => { timer = setTimeout(() => r(false), ms); timer.unref?.(); }),
  ]);
  if (timer) clearTimeout(timer);
  if (!done) segment.catch(() => undefined);
  return done;
}
