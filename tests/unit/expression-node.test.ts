/**
 * Unit tests for @expression node annotation
 * Tests parser recognition and generator output for expression nodes
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseWorkflow } from '../../src/api/parse';
import { generator } from '../../src/generator';

describe('@expression node - Parser', () => {
  const tmpDir = path.join(os.tmpdir(), `flow-weaver-expression-parser-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it('should set expression: true on parsed node type', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
function add(a: number, b: number): number { return a + b; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function calc(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'expression-parser-test.ts');
    fs.writeFileSync(testFile, source);

    const result = await parseWorkflow(testFile, { workflowName: 'calc' });
    const addNodeType = result.ast.nodeTypes.find((nt) => nt.functionName === 'add');

    expect(addNodeType).toBeDefined();
    expect(addNodeType!.expression).toBe(true);
  });

  it('should still have execute/onSuccess/onFailure ports in AST', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
function add(a: number, b: number): number { return a + b; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function calc(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'expression-ports-test.ts');
    fs.writeFileSync(testFile, source);

    const result = await parseWorkflow(testFile, { workflowName: 'calc' });
    const addNodeType = result.ast.nodeTypes.find((nt) => nt.functionName === 'add');

    expect(addNodeType!.inputs).toHaveProperty('execute');
    expect(addNodeType!.outputs).toHaveProperty('onSuccess');
    expect(addNodeType!.outputs).toHaveProperty('onFailure');
  });

  it('should parse inputs from @input tags (no execute in function signature)', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
function add(a: number, b: number): number { return a + b; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function calc(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'expression-inputs-test.ts');
    fs.writeFileSync(testFile, source);

    const result = await parseWorkflow(testFile, { workflowName: 'calc' });
    const addNodeType = result.ast.nodeTypes.find((nt) => nt.functionName === 'add');

    expect(addNodeType!.inputs).toHaveProperty('a');
    expect(addNodeType!.inputs).toHaveProperty('b');
    expect(addNodeType!.inputs.a.dataType).toBe('NUMBER');
    expect(addNodeType!.inputs.b.dataType).toBe('NUMBER');
  });

  it('should not set expression on non-expression node types', async () => {
    const source = `
/** @flowWeaver nodeType
 * @input x
 * @output y
 */
function normal(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; y: number } {
  return { onSuccess: true, onFailure: false, y: x * 2 };
}

/** @flowWeaver workflow
 * @node n normal
 * @connect Start.x -> n.x
 * @connect n.y -> Exit.y
 * @connect n.onSuccess -> Exit.onSuccess
 * @connect n.onFailure -> Exit.onFailure
 * @param x
 * @returns y
 * @returns onSuccess
 * @returns onFailure
 */
export function calc(execute: boolean, params: { x: number }): { y: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'non-expression-test.ts');
    fs.writeFileSync(testFile, source);

    const result = await parseWorkflow(testFile, { workflowName: 'calc' });
    const nodeType = result.ast.nodeTypes.find((nt) => nt.functionName === 'normal');

    expect(nodeType).toBeDefined();
    expect(nodeType!.expression).toBeUndefined();
  });
});

describe('@expression node - Generator', () => {
  const tmpDir = path.join(os.tmpdir(), `flow-weaver-expression-gen-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it('should call expression function without execute argument', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
function add(a: number, b: number): number { return a + b; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function calc(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'expression-gen-test.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'calc');

    // Should call add(a, b) not add(execute, a, b)
    expect(code).toMatch(/add\(\s*adder_a\s*,\s*adder_b\s*\)/);
    // Should NOT pass execute as first arg to add
    expect(code).not.toMatch(/add\(\s*(?:true|adder_execute|execute)/);
  });

  it('should map raw return to single output port', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
function add(a: number, b: number): number { return a + b; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function calc(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'expression-single-output-test.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'calc');

    // Should set the single data output port to the raw return value
    expect(code).toContain("'sum'");
    // The result should be set as the raw value, not result.sum
    expect(code).toMatch(/setVariable.*'sum'.*adderResult_raw\b/);
  });

  it('should auto-set onSuccess=true and onFailure=false on success', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
function add(a: number, b: number): number { return a + b; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function calc(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'expression-success-test.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'calc');

    // Should auto-set onSuccess and onFailure
    expect(code).toMatch(/setVariable.*'onSuccess'.*true/);
    expect(code).toMatch(/setVariable.*'onFailure'.*false/);
  });

  it('should handle multi-output expression node with object return', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 * @output diff
 */
function calc(a: number, b: number): { sum: number; diff: number } { return { sum: a + b, diff: a - b }; }

/** @flowWeaver workflow
 * @node c calc
 * @connect Start.a -> c.a
 * @connect Start.b -> c.b
 * @connect c.sum -> Exit.sum
 * @connect c.diff -> Exit.diff
 * @connect c.onSuccess -> Exit.onSuccess
 * @connect c.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns diff
 * @returns onSuccess
 * @returns onFailure
 */
export function workflow(execute: boolean, params: { a: number; b: number }): { sum: number; diff: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'expression-multi-output-test.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'workflow');

    // Multi-output: should destructure from object return
    expect(code).toMatch(/setVariable.*'sum'.*cResult\.sum/);
    expect(code).toMatch(/setVariable.*'diff'.*cResult\.diff/);
  });

  it('should set onSuccess=false and onFailure=true in catch block', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @output result
 */
function process(a: number): number { return a * 2; }

/** @flowWeaver workflow
 * @node p process
 * @connect Start.a -> p.a
 * @connect p.result -> Exit.result
 * @connect p.onSuccess -> Exit.onSuccess
 * @connect p.onFailure -> Exit.onFailure
 * @param a
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function workflow(execute: boolean, params: { a: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'expression-error-test.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'workflow');

    // Catch block should set failure flags
    expect(code).toContain('catch');
    // In catch: onSuccess=false, onFailure=true
    expect(code).toMatch(/catch[\s\S]*setVariable.*'onSuccess'.*false/);
    expect(code).toMatch(/catch[\s\S]*setVariable.*'onFailure'.*true/);
  });
});
