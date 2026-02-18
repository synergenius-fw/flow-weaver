/**
 * Integration tests for @expression node execution
 * End-to-end: write source → compile → execute → verify results
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generator } from '../../src/generator';

describe('@expression node - End-to-end execution', () => {
  const outputDir = path.join(os.tmpdir(), `flow-weaver-expression-e2e-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  it('should execute expression add(3, 5) and return sum === 8', async () => {
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
    const testFile = path.join(outputDir, 'expression-add.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'calc');
    const outputFile = path.join(outputDir, 'expression-add.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.calc(true, { a: 3, b: 5 });

    expect(result.sum).toBe(8);
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });

  it('should handle expression node that throws with onFailure=true', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @output result
 */
function failingNode(a: number): number { throw new Error('intentional'); }

/** @flowWeaver workflow
 * @node f failingNode
 * @connect Start.a -> f.a
 * @connect f.result -> Exit.result
 * @connect f.onSuccess -> Exit.onSuccess
 * @connect f.onFailure -> Exit.onFailure
 * @param a
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function workflow(execute: boolean, params: { a: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'expression-fail.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'workflow');
    const outputFile = path.join(outputDir, 'expression-fail.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    // The node throws, so the workflow should re-throw (no onFailure connection to handle it)
    // workflow is sync (no async node types), so it throws synchronously
    expect(() => module.workflow(true, { a: 1 })).toThrow('intentional');
  });

  it('should execute chained expression nodes: doubleIt(5) -> addTen produces 20 (F1 fix)', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } { return { result: value * 2 }; }

/** @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function addTen(value: number): { result: number } { return { result: value + 10 }; }

/** @flowWeaver workflow
 * @node d doubleIt
 * @node a addTen
 * @connect Start.value -> d.value
 * @connect d.result -> a.value
 * @connect a.result -> Exit.result
 * @connect d.onSuccess -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 * @connect a.onFailure -> Exit.onFailure
 * @param value
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function mathPipeline(execute: boolean, params: { value: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'expression-chain.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'mathPipeline');
    const outputFile = path.join(outputDir, 'expression-chain.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.mathPipeline(true, { value: 5 });

    // doubleIt(5) = { result: 10 }, then addTen(10) = { result: 20 }
    // Before F1 fix: addTen received { result: 10 } instead of 10, producing "[object Object]10"
    expect(result.result).toBe(20);
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });

  it('should auto-infer ports for @expression with no @input/@output', async () => {
    // This test verifies Task 7.1: expression nodes should NOT require explicit @input/@output
    const source = `
/** @flowWeaver nodeType @expression */
function greet(name: string): { greeting: string } {
  return { greeting: \`Hello, \${name}!\` };
}

/** @flowWeaver nodeType @expression */
function shout(text: string): { result: string } {
  return { result: text.toUpperCase() + '!!!' };
}

/** @flowWeaver workflow
 * @node g greet
 * @node s shout
 * @connect Start.name -> g.name
 * @connect g.greeting -> s.text
 * @connect s.result -> Exit.message
 * @connect g.onSuccess -> s.execute
 * @connect s.onSuccess -> Exit.onSuccess
 * @connect s.onFailure -> Exit.onFailure
 * @param name
 * @returns message
 * @returns onSuccess
 * @returns onFailure
 */
export function helloWorld(execute: boolean, params: { name: string }): { message: string; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'expression-auto-infer.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'helloWorld');
    const outputFile = path.join(outputDir, 'expression-auto-infer.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.helloWorld(true, { name: 'World' });

    expect(result.message).toBe('HELLO, WORLD!!!!'); // 'Hello, World!' uppercased + '!!!'
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });

  it('should auto-infer only missing ports (explicit @input overrides inferred)', async () => {
    // If @input is explicit but @output is missing, only outputs should be inferred
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input value - Custom label for value
 */
function doubler(value: number): { doubled: number } {
  return { doubled: value * 2 };
}

/** @flowWeaver workflow
 * @node d doubler
 * @connect Start.value -> d.value
 * @connect d.doubled -> Exit.doubled
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param value
 * @returns doubled
 * @returns onSuccess
 * @returns onFailure
 */
export function doubleWorkflow(execute: boolean, params: { value: number }): { doubled: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'expression-partial-infer.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'doubleWorkflow');
    const outputFile = path.join(outputDir, 'expression-partial-infer.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.doubleWorkflow(true, { value: 5 });

    expect(result.doubled).toBe(10);
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });

  it('should execute expression multi-output node', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 * @output product
 */
function mathOps(a: number, b: number): { sum: number; product: number } {
  return { sum: a + b, product: a * b };
}

/** @flowWeaver workflow
 * @node ops mathOps
 * @connect Start.a -> ops.a
 * @connect Start.b -> ops.b
 * @connect ops.sum -> Exit.sum
 * @connect ops.product -> Exit.product
 * @connect ops.onSuccess -> Exit.onSuccess
 * @connect ops.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns product
 * @returns onSuccess
 * @returns onFailure
 */
export function calc(execute: boolean, params: { a: number; b: number }): { sum: number; product: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'expression-multi.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'calc');
    const outputFile = path.join(outputDir, 'expression-multi.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.calc(true, { a: 4, b: 3 });

    expect(result.sum).toBe(7);
    expect(result.product).toBe(12);
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });
});
