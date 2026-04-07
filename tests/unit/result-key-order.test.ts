/**
 * Tests that compiled workflow result object has keys in the expected order:
 * onSuccess first, onFailure second, then data ports.
 *
 * This matters for JSON.stringify output readability (fw run, logging, etc).
 */

import { describe, it, expect } from 'vitest';
import { generateInPlace } from '../../src/api/generate-in-place';
import { parser } from '../../src/parser';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function getCompiledFinalResult(source: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-key-order-'));
  const tmpFile = path.join(tmpDir, 'test.ts');
  fs.writeFileSync(tmpFile, source);

  try {
    const parsed = parser.parse(tmpFile);
    expect(parsed.errors).toHaveLength(0);
    const wf = parsed.workflows[0];
    expect(wf).toBeDefined();

    const result = generateInPlace(source, wf);
    // Extract the finalResult line
    const match = result.code.match(/const finalResult = \{([^}]+)\}/);
    expect(match).not.toBeNull();
    return match![1].trim();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function getKeyOrder(finalResultLine: string): string[] {
  // Parse "onSuccess: true, onFailure: false, message: exit_message as string"
  return finalResultLine.split(',').map(part => part.trim().split(':')[0].trim());
}

describe('compiled result key order', () => {
  const BASE = `
/** @flowWeaver nodeType @expression */
function step(input: string): { output: string } { return { output: input.toUpperCase() }; }
`;

  it('onSuccess comes first, onFailure second, data ports after', () => {
    const source = BASE + `
/**
 * @flowWeaver workflow
 * @node a step
 * @path Start -> a -> Exit
 * @connect Start.input -> a.input
 * @connect a.output -> Exit.result
 * @param input
 * @returns result
 */
export function w(execute: boolean, params: { input: string }): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('compile');
}
`;
    const finalResult = getCompiledFinalResult(source);
    const keys = getKeyOrder(finalResult);

    expect(keys[0]).toBe('onSuccess');
    expect(keys[1]).toBe('onFailure');
    expect(keys[2]).toBe('result');
  });

  it('multiple data ports come after onSuccess/onFailure', () => {
    const source = `
/** @flowWeaver nodeType @expression */
function split(text: string): { first: string; second: string } {
  const parts = text.split(' ');
  return { first: parts[0], second: parts[1] || '' };
}
` + `
/**
 * @flowWeaver workflow
 * @node s split
 * @path Start -> s -> Exit
 * @connect Start.text -> s.text
 * @connect s.first -> Exit.first
 * @connect s.second -> Exit.second
 * @param text
 * @returns first
 * @returns second
 */
export function w(execute: boolean, params: { text: string }): { onSuccess: boolean; onFailure: boolean; first: string; second: string } {
  throw new Error('compile');
}
`;
    const finalResult = getCompiledFinalResult(source);
    const keys = getKeyOrder(finalResult);

    expect(keys[0]).toBe('onSuccess');
    expect(keys[1]).toBe('onFailure');
    // Data ports after control flow
    expect(keys).toContain('first');
    expect(keys).toContain('second');
    expect(keys.indexOf('first')).toBeGreaterThan(1);
    expect(keys.indexOf('second')).toBeGreaterThan(1);
  });

  it('explicitly connected onSuccess still comes first', () => {
    const source = `
/** @flowWeaver nodeType
 * @input data
 * @output result
 */
function proc(execute: boolean, data: string) {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: data };
}
` + `
/**
 * @flowWeaver workflow
 * @node p proc
 * @connect Start.execute -> p.execute
 * @connect Start.data -> p.data
 * @connect p.result -> Exit.result
 * @connect p.onSuccess -> Exit.onSuccess
 * @connect p.onFailure -> Exit.onFailure
 * @param data
 * @returns result
 */
export function w(execute: boolean, params: { data: string }): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('compile');
}
`;
    const finalResult = getCompiledFinalResult(source);
    const keys = getKeyOrder(finalResult);

    expect(keys[0]).toBe('onSuccess');
    expect(keys[1]).toBe('onFailure');
    expect(keys[2]).toBe('result');
  });
});
