/**
 * The parameters a declared route hands its workflow: the path segments,
 * then the query string (GET, DELETE) or the body, each read as the type
 * the workflow's params schema declares. A missing or mistyped parameter is
 * refused with 400 and the field it was about. `callbackUrl` and, in dev,
 * `mocks` are taken out of the body rather than passed on.
 */
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import { HttpError } from './http-error.js';
import { decodeSegment, type Json } from './respond.js';
import type { CompiledRoute } from './route-plan.js';

/** A query-string or path value as the parameter's declared type. */
function coerce(value: string, schema: Record<string, unknown> | undefined): unknown {
  const type = schema?.type;
  if (type === 'number') { const n = Number(value); return Number.isFinite(n) ? n : value; }
  if (type === 'boolean') return value === 'true' ? true : value === 'false' ? false : value;
  if (type === 'object' || type === 'array' || type === undefined) {
    if (/^[[{]/.test(value.trim())) { try { return JSON.parse(value); } catch { return value; } }
  }
  return value;
}

/** Parameters for a declared route: the path, then the query or the body, coerced by the params schema. */
export function paramsFor(c: CompiledRoute, m: RegExpMatchArray, url: URL, body: Json, form: boolean, dev: boolean | undefined): { params: Json; callbackUrl?: string; mocks?: FwMockConfig } {
  const schemas = (c.endpoint.inputSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  // Only a parameter's own schema: `constructor` is not a parameter.
  const props = (k: string) => (Object.hasOwn(schemas, k) ? schemas[k] : undefined);
  // A `__proto__` key would replace the object's prototype rather than add a
  // parameter, and an inherited value would pass the required check below
  // while the type check, which reads own keys, never saw it. It is never copied.
  const params: Json = {};
  const set = (k: string, v: unknown) => { if (k !== '__proto__') params[k] = v; };
  let callbackUrl: string | undefined;
  let mocks: FwMockConfig | undefined;
  if (c.route.method === 'GET' || c.route.method === 'DELETE') {
    for (const [k, v] of url.searchParams) {
      if (k === 'async') continue;
      if (k === 'callbackUrl') { callbackUrl = v; continue; }
      set(k, coerce(v, props(k)));
    }
  } else {
    for (const [k, v] of Object.entries(body)) {
      if (k === 'callbackUrl' && typeof v === 'string') { callbackUrl = v; continue; }
      if (k === 'mocks' && dev && typeof v === 'object' && v !== null) { mocks = v; continue; }
      // A form post's fields are strings; a JSON body's types are the caller's own.
      set(k, form && typeof v === 'string' ? coerce(v, props(k)) : v);
    }
  }
  c.keys.forEach((k, i) => { set(k, coerce(decodeSegment(m[i + 1]), props(k))); });
  const missing = ((c.endpoint.inputSchema?.required as string[] | undefined) ?? []).filter((k) => !Object.hasOwn(params, k) || params[k] === undefined);
  if (missing.length) throw new HttpError(400, 'VALIDATION_ERROR', `missing parameter${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`, missing.map((k) => ({ path: k, message: 'required' })));
  for (const [k, v] of Object.entries(params)) {
    const t = props(k)?.type;
    if (t === 'number' && typeof v !== 'number') throw new HttpError(400, 'VALIDATION_ERROR', `parameter ${k} must be a number`, [{ path: k, message: 'must be a number' }]);
    if (t === 'boolean' && typeof v !== 'boolean') throw new HttpError(400, 'VALIDATION_ERROR', `parameter ${k} must be true or false`, [{ path: k, message: 'must be a boolean' }]);
    if (t === 'string' && typeof v !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', `parameter ${k} must be text`, [{ path: k, message: 'must be a string' }]);
  }
  return { params, callbackUrl: c.route.callback ? callbackUrl : undefined, mocks };
}
