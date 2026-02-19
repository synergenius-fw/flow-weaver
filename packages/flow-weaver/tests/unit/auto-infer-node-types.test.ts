/**
 * Auto-infer node types from unannotated functions.
 *
 * When a workflow references a function via @node that has no @flowWeaver
 * nodeType annotation, the parser should auto-infer a node type from its
 * TypeScript signature as an expression node.
 *
 * Phase 1: same-file functions only.
 */

import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import { WorkflowValidator } from '../../src/validator';

describe('auto-infer node types from unannotated functions', () => {
  // ── 1. Basic inference ──────────────────────────────────────────────
  it('should infer a node type from an unannotated function with object return', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function add(a: number, b: number) { return { sum: a + b }; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();

    const addNodeType = workflow.nodeTypes.find((nt) => nt.functionName === 'add');
    expect(addNodeType).toBeDefined();
    expect(addNodeType!.expression).toBe(true);
    expect(addNodeType!.inferred).toBe(true);
    expect(addNodeType!.variant).toBe('FUNCTION');

    // Input ports from params
    expect(addNodeType!.inputs.a).toBeDefined();
    expect(addNodeType!.inputs.a.dataType).toBe('NUMBER');
    expect(addNodeType!.inputs.b).toBeDefined();
    expect(addNodeType!.inputs.b.dataType).toBe('NUMBER');

    // Output port from return type property
    expect(addNodeType!.outputs.sum).toBeDefined();
    expect(addNodeType!.outputs.sum.dataType).toBe('NUMBER');

    // Mandatory ports
    expect(addNodeType!.inputs.execute).toBeDefined();
    expect(addNodeType!.inputs.execute.dataType).toBe('STEP');
    expect(addNodeType!.outputs.onSuccess).toBeDefined();
    expect(addNodeType!.outputs.onSuccess.dataType).toBe('STEP');
    expect(addNodeType!.outputs.onFailure).toBeDefined();
    expect(addNodeType!.outputs.onFailure.dataType).toBe('STEP');
  });

  // ── 2. Primitive return ─────────────────────────────────────────────
  it('should create a single "result" output for primitive return type', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function double(x: number): number { return x * 2; }

/** @flowWeaver workflow
 * @node d double
 * @connect Start.execute -> d.execute
 * @connect d.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const nodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'double');
    expect(nodeType).toBeDefined();
    expect(nodeType!.inferred).toBe(true);

    // Primitive return → single output named 'result'
    expect(nodeType!.outputs.result).toBeDefined();
    expect(nodeType!.outputs.result.dataType).toBe('NUMBER');

    // Input port
    expect(nodeType!.inputs.x).toBeDefined();
    expect(nodeType!.inputs.x.dataType).toBe('NUMBER');
  });

  // ── 3. Void return ─────────────────────────────────────────────────
  it('should have no data outputs for void return type', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function log(msg: string): void {}

/** @flowWeaver workflow
 * @node l log
 * @connect Start.execute -> l.execute
 * @connect l.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const nodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'log');
    expect(nodeType).toBeDefined();
    expect(nodeType!.inferred).toBe(true);

    // Only control flow outputs, no data outputs
    const dataOutputs = Object.entries(nodeType!.outputs).filter(
      ([name]) => name !== 'onSuccess' && name !== 'onFailure'
    );
    expect(dataOutputs).toHaveLength(0);

    // Input port
    expect(nodeType!.inputs.msg).toBeDefined();
    expect(nodeType!.inputs.msg.dataType).toBe('STRING');
  });

  // ── 4. No type annotations → ANY ───────────────────────────────────
  it('should default to ANY for untyped parameters and outputs', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function foo(x, y) { return { out: x }; }

/** @flowWeaver workflow
 * @node f foo
 * @connect Start.execute -> f.execute
 * @connect f.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const nodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'foo');
    expect(nodeType).toBeDefined();
    expect(nodeType!.inferred).toBe(true);

    // Untyped params → ANY
    expect(nodeType!.inputs.x.dataType).toBe('ANY');
    expect(nodeType!.inputs.y.dataType).toBe('ANY');
  });

  // ── 5. Async function ──────────────────────────────────────────────
  it('should detect async, unwrap Promise, and set isAsync', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
async function fetchData(url: string): Promise<string> { return ''; }

/** @flowWeaver workflow
 * @node f fetchData
 * @connect Start.execute -> f.execute
 * @connect f.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const nodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'fetchData');
    expect(nodeType).toBeDefined();
    expect(nodeType!.inferred).toBe(true);
    expect(nodeType!.isAsync).toBe(true);

    // Promise<string> unwrapped → single result output of STRING
    expect(nodeType!.outputs.result).toBeDefined();
    expect(nodeType!.outputs.result.dataType).toBe('STRING');
  });

  // ── 6. Optional params ─────────────────────────────────────────────
  it('should mark optional parameters as optional', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function greet(name: string, prefix?: string) { return { greeting: name }; }

/** @flowWeaver workflow
 * @node g greet
 * @connect Start.execute -> g.execute
 * @connect g.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const nodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'greet');
    expect(nodeType).toBeDefined();
    expect(nodeType!.inputs.name.optional).toBeFalsy();
    expect(nodeType!.inputs.prefix.optional).toBe(true);
  });

  // ── 7. Params with defaults ────────────────────────────────────────
  it('should mark parameters with defaults as optional', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function calc(x: number, y: number = 0) { return { sum: x + y }; }

/** @flowWeaver workflow
 * @node c calc
 * @connect Start.execute -> c.execute
 * @connect c.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const nodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'calc');
    expect(nodeType).toBeDefined();
    expect(nodeType!.inputs.x.optional).toBeFalsy();
    expect(nodeType!.inputs.y.optional).toBe(true);
  });

  // ── 8. Annotated function NOT re-inferred ──────────────────────────
  it('should use annotated version and not re-infer for @flowWeaver nodeType functions', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
function add(a: number, b: number): number { return a + b; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const addTypes = result.workflows[0].nodeTypes.filter((nt) => nt.functionName === 'add');
    // Should be exactly one (the annotated one), not a duplicate
    expect(addTypes).toHaveLength(1);
    // Should NOT have inferred flag — it came from annotation
    expect(addTypes[0].inferred).toBeFalsy();
  });

  // ── 9. No UNKNOWN_NODE_TYPE error for inferred types ───────────────
  it('should not produce UNKNOWN_NODE_TYPE for inferred types', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function add(a: number, b: number) { return { sum: a + b }; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const validator = new WorkflowValidator();
    const validationResult = validator.validate(workflow);

    const unknownTypeErrors = validationResult.errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownTypeErrors).toHaveLength(0);
  });

  // ── 10. INFERRED_NODE_TYPE info diagnostic ─────────────────────────
  it('should produce INFERRED_NODE_TYPE info diagnostic', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function add(a: number, b: number) { return { sum: a + b }; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const validator = new WorkflowValidator();
    const validationResult = validator.validate(workflow);

    const inferredInfos = validationResult.warnings.filter((w) => w.code === 'INFERRED_NODE_TYPE');
    expect(inferredInfos).toHaveLength(1);
    expect(inferredInfos[0].message).toContain('add');
    expect(inferredInfos[0].message).toContain('auto-inferred');
  });

  // ── 11. Non-existent function still errors ─────────────────────────
  it('should still produce UNKNOWN_NODE_TYPE for non-existent functions', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node x nonExistent
 * @connect Start.execute -> x.execute
 * @connect x.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    // Parser emits an error about unknown node type
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('nonExistent'))).toBe(true);
  });

  // ── 12. Multiple workflows referencing same function ───────────────
  it('should create only one inferred type for multiple workflow references', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function add(a: number, b: number) { return { sum: a + b }; }

/** @flowWeaver workflow
 * @node adder1 add
 * @node adder2 add
 * @connect Start.execute -> adder1.execute
 * @connect adder1.onSuccess -> adder2.execute
 * @connect adder2.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const addTypes = result.workflows[0].nodeTypes.filter((nt) => nt.functionName === 'add');
    expect(addTypes).toHaveLength(1);
    expect(addTypes[0].inferred).toBe(true);
  });

  // ── 13. Arrow functions ────────────────────────────────────────────
  it('should infer node types from arrow functions', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
const multiply = (a: number, b: number) => ({ product: a * b });

/** @flowWeaver workflow
 * @node m multiply
 * @connect Start.execute -> m.execute
 * @connect m.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const nodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'multiply');
    expect(nodeType).toBeDefined();
    expect(nodeType!.inferred).toBe(true);
    expect(nodeType!.expression).toBe(true);

    expect(nodeType!.inputs.a).toBeDefined();
    expect(nodeType!.inputs.a.dataType).toBe('NUMBER');
    expect(nodeType!.inputs.b).toBeDefined();
    expect(nodeType!.inputs.b.dataType).toBe('NUMBER');
    expect(nodeType!.outputs.product).toBeDefined();
    expect(nodeType!.outputs.product.dataType).toBe('NUMBER');
  });

  // ── 14. Code generation works with inferred expression nodes ───────
  it('should produce valid workflow AST that can be used downstream', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function add(a: number, b: number) { return { sum: a + b }; }

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 */
export function myWorkflow(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();

    // The inferred node type should be present
    const addNodeType = workflow.nodeTypes.find((nt) => nt.functionName === 'add');
    expect(addNodeType).toBeDefined();
    expect(addNodeType!.expression).toBe(true);
    expect(addNodeType!.inferred).toBe(true);

    // The instance should reference the inferred type
    const adderInstance = workflow.instances.find((inst) => inst.id === 'adder');
    expect(adderInstance).toBeDefined();
    expect(adderInstance!.nodeType).toBe('add');

    // Connections should be valid
    expect(workflow.connections).toHaveLength(5);

    // Validator should be happy (no errors)
    const validator = new WorkflowValidator();
    const validationResult = validator.validate(workflow);
    const realErrors = validationResult.errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(realErrors).toHaveLength(0);
  });

  // ── 15. Inferred node with execute param should NOT be expression ────
  it('should set expression: false for inferred functions with execute as first param', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/** @flowWeaver workflow
 * @node d double
 * @connect Start.execute -> d.execute
 * @connect Start.value -> d.value
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.result -> Exit.result
 * @param value
 * @returns result
 */
export function myWorkflow(execute: boolean, params: { value: number }): { result: number; onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const doubleNodeType = workflow.nodeTypes.find((nt) => nt.functionName === 'double');
    expect(doubleNodeType).toBeDefined();
    // Function has execute: boolean as first param → NOT an expression node
    expect(doubleNodeType!.expression).toBe(false);
    expect(doubleNodeType!.inferred).toBe(true);
  });

  // ── 16. Inferred node WITHOUT execute param should be expression ─────
  it('should set expression: true for inferred functions without execute param', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
function addOne(value: number) { return { result: value + 1 }; }

/** @flowWeaver workflow
 * @node a addOne
 * @connect Start.execute -> a.execute
 * @connect Start.value -> a.value
 * @connect a.onSuccess -> Exit.onSuccess
 * @connect a.result -> Exit.result
 * @param value
 * @returns result
 */
export function myWorkflow(execute: boolean, params: { value: number }): { result: number; onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const addOneNodeType = workflow.nodeTypes.find((nt) => nt.functionName === 'addOne');
    expect(addOneNodeType).toBeDefined();
    // Function does NOT have execute param → IS an expression node
    expect(addOneNodeType!.expression).toBe(true);
    expect(addOneNodeType!.inferred).toBe(true);
  });
});
