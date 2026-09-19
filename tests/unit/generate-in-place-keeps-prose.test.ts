/**
 * In-place compilation must not destroy what the author wrote.
 *
 * The compiler regenerates node-type and workflow JSDoc blocks from the AST.
 * Two things used to be lost on the way: the free text above a workflow's
 * `@flowWeaver workflow` tag (the parser only captured an explicit
 * `@description` tag), and every line after the first of a multi-paragraph
 * description (the emitters pushed the whole text as one line, so only the
 * first line got its ` * ` prefix). For an assistant-driven authoring loop this
 * is the worst kind of failure: the explanation of a design vanishes, silently,
 * on the very compile that makes the design run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parser } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';

const SOURCE = `/**
 * Doubles a number.
 *
 * Second paragraph of the node description, kept on purpose: it explains
 * why the node exists, which the tags cannot.
 *
 * @flowWeaver nodeType
 * @expression
 * @input value - The number
 * @output result - Twice the number
 */
export function double(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * The workflow doubles its input once.
 *
 * This second paragraph is the design note. It says why the graph is shaped
 * the way it is, and it must survive compilation.
 *
 * @flowWeaver workflow
 * @param value - The input
 * @returns result - The output
 * @node d double
 * @path Start -> d -> Exit
 */
export async function doubleOnce(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('generated body was not installed');
}
`;

/** Every line of a JSDoc block, between its opening and closing fence. */
function jsdocBlockContaining(code: string, marker: string): string[] {
  const markerIdx = code.indexOf(marker);
  expect(markerIdx, `marker ${marker} present`).toBeGreaterThan(-1);
  const start = code.lastIndexOf('/**', markerIdx);
  const end = code.indexOf('*/', markerIdx);
  // Drop the opening fence and the partial closing line (the indent before `*/`).
  return code.slice(start, end).split('\n').slice(1, -1);
}

describe('generateInPlace keeps authored prose', () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-prose-'));
    tmpFile = path.join(tmpDir, 'prose.ts');
    fs.writeFileSync(tmpFile, SOURCE, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses the free text above @flowWeaver workflow as the description', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    expect(wf.description).toContain('The workflow doubles its input once.');
    expect(wf.description).toContain('This second paragraph is the design note.');
  });

  it('keeps every line of a multi-paragraph node description prefixed', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    const { code } = generateInPlace(SOURCE, wf);

    const block = jsdocBlockContaining(code, '@flowWeaver nodeType');
    expect(block.join('\n')).toContain('Second paragraph of the node description');
    for (const line of block) {
      expect(line.trimStart().startsWith('*'), `unprefixed JSDoc line: ${JSON.stringify(line)}`).toBe(true);
    }
  });

  it('keeps the workflow prose through compilation, and a recompile changes nothing', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    const first = generateInPlace(SOURCE, wf);

    const block = jsdocBlockContaining(first.code, '@flowWeaver workflow');
    expect(block.join('\n')).toContain('The workflow doubles its input once.');
    expect(block.join('\n')).toContain('This second paragraph is the design note.');
    for (const line of block) {
      expect(line.trimStart().startsWith('*'), `unprefixed JSDoc line: ${JSON.stringify(line)}`).toBe(true);
    }
    // The prose is free text, not a tag: it must not come back as @description.
    expect(first.code).not.toContain('@description');

    fs.writeFileSync(tmpFile, first.code, 'utf-8');
    parser.clearCache();
    const reparsed = parser.parse(tmpFile).workflows[0];
    const second = generateInPlace(first.code, reparsed);
    expect(second.code).toBe(first.code);
  });
});
