/**
 * The @http tag: a workflow declaring the route it is served on. Parsed into
 * options.http, written back by the annotation generator in the same words,
 * bad lines reported and dropped, and a :param that names no parameter
 * refused by the validator.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseWorkflow } from '../../src/api/parse';
import { validateWorkflow } from '../../src/api/validate';
import { annotationGenerator, httpRouteText } from '../../src/generator/annotation-generator';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-http-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const source = (tags: string) => `
/**
 * @flowWeaver nodeType
 * @input text - Text
 * @output upper - Upper
 */
function up(execute: boolean, text: string): { onSuccess: boolean; onFailure: boolean; upper: string } {
  return { onSuccess: execute, onFailure: false, upper: text.toUpperCase() };
}

/**
 * @flowWeaver workflow
${tags}
 * @param text - Text to shout
 * @returns upper - Shouted
 * @node u up
 * @connect Start.text -> u.text
 * @connect u.upper -> Exit.upper
 */
export async function shout(execute: boolean, params: { text: string }): Promise<{ onSuccess: boolean; onFailure: boolean; upper: string }> {
  throw new Error('generated body was not installed');
}
`;

const parse = async (tags: string) => {
  const file = path.join(dir, 'shout.ts');
  fs.writeFileSync(file, source(tags));
  return parseWorkflow(file, { projectDir: dir });
};

describe('@http', () => {
  it('parses method, path and options into options.http, in declaration order', async () => {
    const r = await parse(' * @http POST /shout\n * @http GET /shout/:text mode=async auth=none callback');
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => /@http/.test(w))).toEqual([]);
    expect(r.ast.options?.http).toEqual([
      { method: 'POST', path: '/shout' },
      { method: 'GET', path: '/shout/:text', mode: 'async', auth: 'none', callback: true },
    ]);
  });

  it('accepts a lower-case method and drops a trailing slash', async () => {
    const r = await parse(' * @http post /shout/');
    expect(r.ast.options?.http).toEqual([{ method: 'POST', path: '/shout' }]);
  });

  it('warns and drops a line it cannot read, keeping the workflow', async () => {
    const r = await parse(' * @http FETCH /shout\n * @http POST shout\n * @http POST /shout nope=1\n * @http POST /ok');
    expect(r.errors).toEqual([]);
    const w = r.warnings.filter((x) => /Invalid @http/.test(x));
    expect(w).toHaveLength(3);
    expect(w[0]).toMatch(/not one of GET, POST/);
    expect(w[1]).toMatch(/not a path/);
    expect(w[2]).toMatch(/not an option/);
    expect(r.ast.options?.http).toEqual([{ method: 'POST', path: '/ok' }]);
  });

  it('keeps the first of two identical routes and says so', async () => {
    const r = await parse(' * @http POST /shout\n * @http post /shout mode=async');
    expect(r.warnings.some((x) => /Duplicate @http route POST \/shout/.test(x))).toBe(true);
    expect(r.ast.options?.http).toEqual([{ method: 'POST', path: '/shout' }]);
  });

  it('writes the routes back in the words it read', async () => {
    const r = await parse(' * @http POST /shout\n * @http GET /shout/:text mode=async auth=none callback');
    const text = annotationGenerator.generate(r.ast);
    expect(text).toContain(' * @http POST /shout\n');
    expect(text).toContain(' * @http GET /shout/:text mode=async auth=none callback');
    expect(httpRouteText({ method: 'PUT', path: '/x' })).toBe('PUT /x');
  });

  it('refuses a :param that is not a parameter of the workflow', async () => {
    const r = await parse(' * @http GET /shout/:text\n * @http GET /by/:id');
    const v = validateWorkflow(r.ast);
    const bad = v.errors.filter((e) => e.code === 'HTTP_PARAM_UNKNOWN');
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toMatch(/":id" is not a parameter/);
    expect(bad[0].message).toMatch(/parameters: text/);
  });

  it('leaves a workflow without the tag exactly as before', async () => {
    const r = await parse('');
    expect(r.ast.options?.http).toBeUndefined();
    expect(annotationGenerator.generate(r.ast)).not.toContain('@http');
  });
});
