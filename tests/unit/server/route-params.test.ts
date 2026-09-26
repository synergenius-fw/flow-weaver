/**
 * The parameters a declared route hands its workflow, read straight from
 * paramsFor rather than through a running server: which source each value
 * comes from, how a text value is read as the declared type, what is taken
 * out of the body, and the 400 a missing or mistyped parameter gets.
 */
import { describe, it, expect } from 'vitest';
import { paramsFor } from '../../../src/server/route-params.js';
import { mountRoutes } from '../../../src/server/route-plan.js';
import { HttpError } from '../../../src/server/http-error.js';
import type { THttpRoute } from '../../../src/ast/types.js';
import type { Json } from '../../../src/server/respond.js';

const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    n: { type: 'number' },
    flag: { type: 'boolean' },
    obj: { type: 'object' },
    list: { type: 'array' },
    loose: {},
    text: { type: 'string' },
  },
};

function routeFor(route: THttpRoute, inputSchema: Record<string, unknown> = SCHEMA) {
  const { compiled, problems } = mountRoutes([
    { name: 'wf', functionName: 'wf', filePath: '/tmp/wf.ts', method: 'POST', path: '/wf', inputSchema, routes: [route] },
  ]);
  expect(problems).toEqual([]);
  return compiled[0];
}

/** Read the params for a request to `pathAndQuery`, with an optional body. */
function read(route: THttpRoute, pathAndQuery: string, opts: { body?: Json; form?: boolean; dev?: boolean; schema?: Record<string, unknown> } = {}) {
  const c = routeFor(route, opts.schema);
  const url = new URL(`http://x${pathAndQuery}`);
  const m = url.pathname.match(c.regex);
  expect(m).not.toBeNull();
  return paramsFor(c, m!, url, opts.body ?? {}, opts.form ?? false, opts.dev);
}

function refusal(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    return e as HttpError;
  }
  throw new Error('expected a refusal');
}

const GET: THttpRoute = { method: 'GET', path: '/items' };
const POST: THttpRoute = { method: 'POST', path: '/items' };

describe('reading a query string (GET, DELETE)', () => {
  it('reads each value as the type its parameter declares', () => {
    const { params } = read(GET, '/items?n=42&flag=true&text=7&obj={"a":1}&list=[1,2]');
    expect(params).toEqual({ n: 42, flag: true, text: '7', obj: { a: 1 }, list: [1, 2] });
  });

  it('reads false as false, and parses JSON for an undeclared type', () => {
    const { params } = read(GET, '/items?flag=false&loose=%20{"b":2}&undeclared=[3]');
    expect(params).toEqual({ flag: false, loose: { b: 2 }, undeclared: [3] });
  });

  it('leaves text that is not JSON, or is declared as text, as it is', () => {
    const { params } = read(GET, '/items?obj={broken&loose=plain&id={"a":1}');
    expect(params).toEqual({ obj: '{broken', loose: 'plain', id: '{"a":1}' });
  });

  it('refuses a number that does not read as a finite number', () => {
    for (const bad of ['abc', 'Infinity']) {
      const err = refusal(() => read(GET, `/items?n=${bad}`));
      expect(err.status).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toBe('parameter n must be a number');
      expect(err.details).toEqual([{ path: 'n', message: 'must be a number' }]);
    }
  });

  it('refuses a boolean that is neither true nor false', () => {
    const err = refusal(() => read(GET, '/items?flag=yes'));
    expect(err.message).toBe('parameter flag must be true or false');
    expect(err.details).toEqual([{ path: 'flag', message: 'must be a boolean' }]);
  });

  it('drops async, and takes callbackUrl out only when the route accepts a callback', () => {
    const plain = read(GET, '/items?async=true&callbackUrl=https://cb.example/x&text=a');
    expect(plain.params).toEqual({ text: 'a' });
    expect(plain.callbackUrl).toBeUndefined();

    const withCallback = read({ ...GET, callback: true }, '/items?callbackUrl=https://cb.example/x');
    expect(withCallback.params).toEqual({});
    expect(withCallback.callbackUrl).toBe('https://cb.example/x');
  });

  it('reads a DELETE from the query string and ignores its body', () => {
    const { params } = read({ method: 'DELETE', path: '/items' }, '/items?n=3', { body: { n: 9, text: 'body' } });
    expect(params).toEqual({ n: 3 });
  });

  it('ignores the query string of a POST', () => {
    const { params } = read(POST, '/items?n=3', { body: { text: 'body' } });
    expect(params).toEqual({ text: 'body' });
  });
});

describe('reading a body (POST, PUT, PATCH)', () => {
  it('keeps a JSON body\'s own types, so a number sent as text is refused', () => {
    expect(read(POST, '/items', { body: { n: 5, flag: false } }).params).toEqual({ n: 5, flag: false });
    const err = refusal(() => read(POST, '/items', { body: { n: '5' } }));
    expect(err.message).toBe('parameter n must be a number');
  });

  it('reads a form post\'s text fields as their declared types', () => {
    const { params } = read(POST, '/items', { body: { n: '5', flag: 'true', text: '12' }, form: true });
    expect(params).toEqual({ n: 5, flag: true, text: '12' });
  });

  it('refuses text declared as a number or boolean, and a non-string declared as text', () => {
    expect(refusal(() => read(POST, '/items', { body: { flag: 'true' } })).message).toBe('parameter flag must be true or false');
    const err = refusal(() => read(POST, '/items', { body: { text: 12 } }));
    expect(err.message).toBe('parameter text must be text');
    expect(err.details).toEqual([{ path: 'text', message: 'must be a string' }]);
  });

  it('takes a string callbackUrl out of the body, and keeps any other callbackUrl as a parameter', () => {
    const route: THttpRoute = { ...POST, callback: true };
    const taken = read(route, '/items', { body: { callbackUrl: 'https://cb.example/x', text: 'a' } });
    expect(taken.params).toEqual({ text: 'a' });
    expect(taken.callbackUrl).toBe('https://cb.example/x');

    const kept = read(route, '/items', { body: { callbackUrl: 5 } });
    expect(kept.params).toEqual({ callbackUrl: 5 });
    expect(kept.callbackUrl).toBeUndefined();

    // Without `callback` on the route the URL is still not a parameter, and not used.
    const ignored = read(POST, '/items', { body: { callbackUrl: 'https://cb.example/x' } });
    expect(ignored.params).toEqual({});
    expect(ignored.callbackUrl).toBeUndefined();
  });

  it('takes mocks out of the body only in dev, and only when they are an object', () => {
    const mocks = { events: { e: { ok: true } } };
    const dev = read(POST, '/items', { body: { mocks }, dev: true });
    expect(dev.mocks).toEqual(mocks);
    expect(dev.params).toEqual({});

    const prod = read(POST, '/items', { body: { mocks }, dev: false });
    expect(prod.mocks).toBeUndefined();
    expect(prod.params).toEqual({ mocks });

    const notAnObject = read(POST, '/items', { body: { mocks: null }, dev: true });
    expect(notAnObject.mocks).toBeUndefined();
    expect(notAnObject.params).toEqual({ mocks: null });

    const text = read(POST, '/items', { body: { mocks: 'x' }, dev: true });
    expect(text.params).toEqual({ mocks: 'x' });
  });
});

describe('path parameters', () => {
  it('reads a path segment, decoded, as its declared type, over the same name in the body', () => {
    const route: THttpRoute = { method: 'POST', path: '/items/:n/:id' };
    const { params } = read(route, '/items/7/a%20b', { body: { n: 1, text: 't' } });
    expect(params).toEqual({ n: 7, id: 'a b', text: 't' });
  });

  it('refuses a segment that is not valid percent-encoding', () => {
    const err = refusal(() => read({ method: 'GET', path: '/items/:id' }, '/items/%E0%A4%A'));
    expect(err.status).toBe(400);
    expect(err.code).toBe('BAD_PATH');
  });
});

describe('required parameters', () => {
  const schema = { ...SCHEMA, required: ['id', 'n'] };

  it('names the one parameter that is missing', () => {
    const err = refusal(() => read(POST, '/items', { body: { id: 'a' }, schema }));
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('missing parameter: n');
    expect(err.details).toEqual([{ path: 'n', message: 'required' }]);
  });

  it('names every parameter that is missing', () => {
    const err = refusal(() => read(POST, '/items', { body: {}, schema }));
    expect(err.message).toBe('missing parameters: id, n');
    expect(err.details).toEqual([{ path: 'id', message: 'required' }, { path: 'n', message: 'required' }]);
  });

  it('accepts a request that has them all', () => {
    expect(read(POST, '/items', { body: { id: 'a', n: 1 }, schema }).params).toEqual({ id: 'a', n: 1 });
  });

  it('never copies __proto__, so a required parameter cannot arrive through the prototype', () => {
    const body = JSON.parse('{"__proto__": {"id": "a", "n": 1}}') as Json;
    const err = refusal(() => read(POST, '/items', { body, schema }));
    expect(err.message).toBe('missing parameters: id, n');
    const { params } = read(GET, '/items?__proto__=x&text=a');
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
    expect(Object.keys(params)).toEqual(['text']);
  });
});
