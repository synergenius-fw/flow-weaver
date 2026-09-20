/**
 * Lifting a workflow's JSDoc and signature out of its file.
 *
 * Node types arrive from the parser with a complete `functionText`; a
 * workflow does not. Taking everything up to the first `{` after the name
 * looked right until it met an inline object type -- which every workflow's
 * `params` has -- and cut the signature off at `params: {`.
 */
import { describe, it, expect } from 'vitest';
import { workflowSource } from '../../../src/console/source';

const jsdoc = `/**
 * @flowWeaver workflow
 * @param email - Contact email address
 */`;

describe('workflowSource', () => {
  it('keeps the whole signature when a parameter has an inline object type', () => {
    const text = `${jsdoc}
export function contactPipeline(
  execute: boolean,
  params: {
    email: string;
    name: string;
  },
): { onSuccess: boolean; onFailure: boolean; record: string } {
  throw new Error('generated body was not installed');
}
`;
    const { source } = workflowSource(text, 'contactPipeline');
    expect(source).toContain('email: string;');
    expect(source).toContain('record: string }');
    // up to and including the body's opening brace, and no further
    expect(source.endsWith('{')).toBe(true);
    expect(source).not.toContain('generated body was not installed');
  });

  it('starts at the JSDoc block that carries the annotations', () => {
    const text = `const other = 1;\n${jsdoc}\nexport function wf(execute: boolean, params: { a: string }): { onSuccess: boolean } {\n  throw new Error('x');\n}\n`;
    const { source, line } = workflowSource(text, 'wf');
    expect(source.startsWith('/**')).toBe(true);
    expect(source).toContain('@flowWeaver workflow');
    expect(line).toBe(2);
  });

  it('is not confused by a brace inside a string default', () => {
    const text = `export function wf(execute: boolean, params: { tag?: string } = { tag: '{' }): { onSuccess: boolean } {\n  throw new Error('x');\n}\n`;
    const { source } = workflowSource(text, 'wf');
    expect(source).toContain("tag: '{'");
    expect(source.endsWith('{')).toBe(true);
  });

  it('is not confused by a brace inside a comment in the signature', () => {
    const text = `export function wf(\n  execute: boolean, // a { brace\n  params: { a: string },\n): { onSuccess: boolean } {\n  throw new Error('x');\n}\n`;
    const { source } = workflowSource(text, 'wf');
    expect(source).toContain('a: string');
    expect(source.endsWith('{')).toBe(true);
  });

  it('handles an async workflow', () => {
    const text = `export async function wf(execute: boolean, params: { a: string }): Promise<{ onSuccess: boolean }> {\n  throw new Error('x');\n}\n`;
    const { source } = workflowSource(text, 'wf');
    expect(source).toContain('Promise<{ onSuccess: boolean }>');
    expect(source.endsWith('{')).toBe(true);
  });

  it('does not match a different function whose name merely starts the same', () => {
    const text = `export function wfHelper(execute: boolean): { onSuccess: boolean } {\n  return { onSuccess: true };\n}\nexport function wf(execute: boolean, params: { a: string }): { onSuccess: boolean } {\n  throw new Error('x');\n}\n`;
    const { source } = workflowSource(text, 'wf');
    expect(source).toContain('params: { a: string }');
    expect(source).not.toContain('wfHelper');
  });

  it('leaves a detached comment above out of the extract', () => {
    // A JSDoc separated by other code belongs to that code, not the workflow.
    const text = `${jsdoc}\nconst between = 1;\nexport function wf(execute: boolean, params: { a: string }): { onSuccess: boolean } {\n  throw new Error('x');\n}\n`;
    const { source } = workflowSource(text, 'wf');
    expect(source.startsWith('export function wf')).toBe(true);
  });

  it('returns nothing when the workflow is not there', () => {
    expect(workflowSource('const a = 1;\n', 'missing')).toEqual({ source: '', line: 1 });
  });
});
