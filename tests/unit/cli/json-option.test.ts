/**
 * `--params` / `--params-file` and `--mocks` / `--mocks-file`: a JSON object
 * given inline or in a file. `fw run` and `fw dev` read them the same way.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readJsonObjectOption } from '../../../src/cli/utils/json-option.js';

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-json-option-')); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name: string, text: string) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };

describe('readJsonObjectOption', () => {
  it('is undefined when neither form is given', () => {
    expect(readJsonObjectOption(undefined, undefined, 'params')).toBeUndefined();
  });

  it('reads an inline object, and prefers it over the file', () => {
    expect(readJsonObjectOption('{"n": 2}', undefined, 'params')).toEqual({ n: 2 });
    expect(readJsonObjectOption('{"n": 2}', write('other.json', '{"n": 3}'), 'params')).toEqual({ n: 2 });
  });

  it('reads an object from a file', () => {
    expect(readJsonObjectOption(undefined, write('p.json', '{ "events": {} }'), 'mocks')).toEqual({ events: {} });
  });

  it('names the flag when the inline text is not JSON', () => {
    expect(() => readJsonObjectOption('{nope', undefined, 'params')).toThrow('Invalid JSON in --params: {nope');
  });

  it('names the file when it is missing or does not parse', () => {
    const missing = path.join(dir, 'missing.json');
    expect(() => readJsonObjectOption(undefined, missing, 'mocks')).toThrow(`Mocks file not found: ${missing}`);
    expect(() => readJsonObjectOption(undefined, write('bad.json', '{'), 'params')).toThrow(/^Failed to parse params file: /);
  });

  it('refuses JSON that is not an object, which would reach the workflow as its parameters', () => {
    for (const text of ['[1, 2]', '5', '"text"', 'null', 'true']) {
      expect(() => readJsonObjectOption(text, undefined, 'params'), text).toThrow('--params must be a JSON object, like {"name": "value"}');
    }
    expect(() => readJsonObjectOption(undefined, write('list.json', '[]'), 'mocks')).toThrow('--mocks-file must hold a JSON object');
  });
});
