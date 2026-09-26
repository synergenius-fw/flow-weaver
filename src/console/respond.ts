/**
 * Writing the console's answers, and reading its request bodies.
 */
import type * as http from 'node:http';
import * as fs from 'node:fs';

export type Json = Record<string, unknown>;

export function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Open an event stream. */
export function sse(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': ok\n\n');
}

/** One event on an open stream. */
export function send(res: http.ServerResponse, msg: unknown): void {
  res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

export function sendFile(res: http.ServerResponse, file: string, type: string): void {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(file));
}

/** A request body that is not a JSON object is the client's mistake, answered with 400 rather than 500. */
export class BadRequest extends Error {}

const MAX_BODY = 1024 * 1024;

export async function readBody(req: http.IncomingMessage): Promise<Json> {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > MAX_BODY) throw new BadRequest(`the body may not exceed ${MAX_BODY} bytes`);
  }
  if (!s.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(s); } catch { throw new BadRequest('the body is not valid JSON'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BadRequest('the body must be a JSON object');
  return parsed as Json;
}
