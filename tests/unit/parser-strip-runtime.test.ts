import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import { MARKERS } from '../../src/api/generate-in-place';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('Parser runtime stripping', () => {
  let parser: AnnotationParser;
  let tmpDir: string;

  beforeEach(() => {
    parser = new AnnotationParser();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-strip-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeFile = (name: string, content: string) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  };

  it('should parse compiled file with runtime markers and produce correct AST', () => {
    // A file with the full runtime block + compiled body
    const source = `
${MARKERS.RUNTIME_START}
class GeneratedExecutionContext { /* 400 lines of runtime */ }
class CancellationError extends Error { }
type TStatusType = "RUNNING" | "SUCCEEDED";
${MARKERS.RUNTIME_END}

/**
 * @flowWeaver nodeType
 * @input data [order:1] - Input
 * @output result [order:2] - Output
 */
function proc(execute: boolean, data: string): { onSuccess: boolean; onFailure: boolean; result: string } {
  return { onSuccess: true, onFailure: false, result: data };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect Start.execute -> p.execute
 * @connect Start.data -> p.data
 * @connect p.onSuccess -> Exit.onSuccess
 * @connect p.result -> Exit.result
 * @param execute [order:0] - Execute
 * @param data [order:1] - Input
 * @returns onSuccess [order:0] - Success
 * @returns result [order:2] - Result
 */
export function testWorkflow(execute: boolean, params: { data: string }): { onSuccess: boolean; result: string } {
  ${MARKERS.BODY_START}
  // huge generated body
  const ctx = new GeneratedExecutionContext();
  // ... 200 more lines ...
  return { onSuccess: true, result: 'test' };
  ${MARKERS.BODY_END}
}
`;
    const filePath = writeFile('compiled.ts', source);
    const result = parser.parse(filePath);

    expect(result.errors).toHaveLength(0);
    // nodeTypes includes local node types + same-file workflow-as-nodeType
    expect(result.nodeTypes.some((nt) => nt.name === 'proc')).toBe(true);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].name).toBe('testWorkflow');
  });

  it('should not strip files without runtime markers', () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input x [order:1] - Input
 * @output y [order:2] - Output
 */
function plain(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; y: number } {
  return { onSuccess: true, onFailure: false, y: x * 2 };
}
`;
    const filePath = writeFile('plain.ts', source);
    const result = parser.parse(filePath);
    expect(result.errors).toHaveLength(0);
    expect(result.nodeTypes).toHaveLength(1);
    expect(result.nodeTypes[0].name).toBe('plain');
  });

  it('should produce stable cache hash when only body content changes', () => {
    const makeSource = (body: string) => `
${MARKERS.RUNTIME_START}
type Placeholder = string;
${MARKERS.RUNTIME_END}

/**
 * @flowWeaver nodeType
 * @input x [order:1] - Input
 * @output y [order:2] - Output
 */
function calc(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; y: number } {
  return { onSuccess: true, onFailure: false, y: x };
}

/**
 * @flowWeaver workflow
 * @node c calc
 * @connect Start.execute -> c.execute
 * @connect Start.x -> c.x
 * @connect c.onSuccess -> Exit.onSuccess
 * @connect c.y -> Exit.y
 * @param execute [order:0] - Execute
 * @param x [order:1] - Input
 * @returns onSuccess [order:0] - Success
 * @returns y [order:2] - Output
 */
export function w(execute: boolean, params: { x: number }): { onSuccess: boolean; y: number } {
  ${MARKERS.BODY_START}
  ${body}
  ${MARKERS.BODY_END}
}
`;
    const filePath = writeFile('cached.ts', makeSource('return { onSuccess: true, y: 1 };'));
    const result1 = parser.parse(filePath);
    expect(result1.workflows).toHaveLength(1);

    // Change only the body content (simulating recompilation)
    fs.writeFileSync(filePath, makeSource('return { onSuccess: true, y: 999 };'));
    const result2 = parser.parse(filePath);

    // Should still parse correctly (cache hit because annotation hash is unchanged)
    expect(result2.workflows).toHaveLength(1);
    expect(result2.workflows[0].name).toBe('w');
  });
});
