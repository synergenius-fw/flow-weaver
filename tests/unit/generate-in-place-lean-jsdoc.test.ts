/**
 * Regenerated JSDoc must not grow what the author never wrote.
 *
 * The parser assigns every port an implicit order from its declaration
 * position and adds the mandatory STEP ports (execute, onSuccess, onFailure)
 * with default labels. The emitters then wrote all of that back: `[order:N]`
 * on every port and three unauthored port lines per node type -- plus
 * `@param execute` / `@returns onSuccess` on the workflow. Every compile made
 * the file longer, every re-read cost more tokens, and every diff was noise.
 *
 * Round-trip fidelity does not need any of it: the parser recomputes exactly
 * those values from declaration order. So an `[order:]` is written only when
 * it differs from what the parser would infer, and a mandatory port line only
 * when it carries something beyond its defaults.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parser } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';

const SOURCE = `/**
 * @flowWeaver nodeType
 * @label Double
 * @input value - The number
 * @output result - Twice the number
 */
export function double(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * Declared b before a, but ordered a first: an authored order that differs
 * from declaration position and must survive.
 *
 * @flowWeaver nodeType
 * @expression
 * @input b [order:1] - Second
 * @input a [order:0] - First
 * @output sum - Sum
 */
export function add(b: number, a: number): { sum: number } {
  return { sum: a + b };
}

/**
 * A customised mandatory port: the label is not the default, so the line
 * carries information and stays.
 *
 * @flowWeaver nodeType
 * @input execute - Fire when the upstream check passed
 * @input value - The number
 * @output result - The number, unchanged
 */
export function keep(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: execute, onFailure: !execute, result: value };
}

/**
 * @flowWeaver workflow
 * @param value - The input
 * @returns result - The output
 * @node d double
 * @node k keep
 * @path Start -> d -> k -> Exit
 * @connect d.result -> k.value
 */
export async function lean(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('generated body was not installed');
}
`;

function jsdocBlockContaining(code: string, marker: string): string {
  const markerIdx = code.indexOf(marker);
  expect(markerIdx, `marker ${marker} present`).toBeGreaterThan(-1);
  const start = code.lastIndexOf('/**', markerIdx);
  const end = code.indexOf('*/', markerIdx);
  return code.slice(start, end);
}

describe('regenerated JSDoc stays as lean as the author wrote it', () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-lean-'));
    tmpFile = path.join(tmpDir, 'lean.ts');
    fs.writeFileSync(tmpFile, SOURCE, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes no implicit [order:] and no default mandatory port lines on a node type', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    const { code } = generateInPlace(SOURCE, wf, { annotationsOnly: true });

    const block = jsdocBlockContaining(code, '@label Double');
    expect(block).toContain('@input value - The number');
    expect(block).toContain('@output result - Twice the number');
    expect(block).not.toContain('[order:');
    expect(block).not.toContain('@input execute');
    expect(block).not.toContain('@output onSuccess');
    expect(block).not.toContain('@output onFailure');
  });

  it('keeps an authored order that differs from declaration position', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    const { code } = generateInPlace(SOURCE, wf, { annotationsOnly: true });

    const block = jsdocBlockContaining(code, 'ordered a first');
    expect(block).toContain('@input b [order:1] - Second');
    expect(block).toContain('@input a [order:0] - First');
  });

  it('keeps a mandatory port whose label is not the default', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    const { code } = generateInPlace(SOURCE, wf, { annotationsOnly: true });

    const block = jsdocBlockContaining(code, 'customised mandatory port');
    expect(block).toContain('@input execute - Fire when the upstream check passed');
    expect(block).not.toContain('@output onSuccess');
  });

  it('writes no implicit [order:] and no default mandatory ports on the workflow', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    const { code } = generateInPlace(SOURCE, wf, { annotationsOnly: true });

    const block = jsdocBlockContaining(code, '@flowWeaver workflow');
    expect(block).toContain('@param value - The input');
    expect(block).toContain('@returns result - The output');
    expect(block).not.toContain('[order:');
    expect(block).not.toContain('@param execute');
    expect(block).not.toContain('@returns onSuccess');
    expect(block).not.toContain('@returns onFailure');
  });

  it('round-trips: the regenerated file parses to the same ports and regenerates unchanged', () => {
    const first = parser.parse(tmpFile).workflows[0];
    const once = generateInPlace(SOURCE, first, { annotationsOnly: true });

    fs.writeFileSync(tmpFile, once.code, 'utf-8');
    parser.clearCache();
    const second = parser.parse(tmpFile).workflows[0];

    const ports = (nt: (typeof first.nodeTypes)[number]) => ({
      name: nt.functionName,
      inputs: Object.entries(nt.inputs).map(([n, p]) => [n, p.metadata?.order, p.label]),
      outputs: Object.entries(nt.outputs).map(([n, p]) => [n, p.metadata?.order, p.label]),
    });
    expect(second.nodeTypes.map(ports)).toEqual(first.nodeTypes.map(ports));

    const twice = generateInPlace(once.code, second, { annotationsOnly: true });
    expect(twice.code).toBe(once.code);
  });
});
