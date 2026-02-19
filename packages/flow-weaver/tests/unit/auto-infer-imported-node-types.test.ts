/**
 * Auto-infer node types from imported unannotated functions.
 *
 * Phase 2: When a workflow references an imported function via @node that has
 * no @flowWeaver nodeType annotation, the parser should auto-infer a node type
 * from its TypeScript signature as an expression node.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { AnnotationParser } from '../../src/parser';
import { WorkflowValidator } from '../../src/validator';

const tmpDir = path.join(os.tmpdir(), `fw-infer-import-${process.pid}`);

beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function writeFile(name: string, content: string) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('auto-infer node types from imported functions', () => {
  // ── 1. Basic cross-file inference ─────────────────────────────────
  it('should infer a node type from an unannotated imported function', () => {
    writeFile('utils1.ts', `export function add(a: number, b: number) { return { sum: a + b }; }`);
    const workflowPath = writeFile(
      'workflow1.ts',
      `import { add } from './utils1';

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();

    const addNodeType = workflow.nodeTypes.find((nt) => nt.functionName === 'add');
    expect(addNodeType).toBeDefined();
    expect(addNodeType!.expression).toBe(true);
    expect(addNodeType!.inferred).toBe(true);

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

  // ── 2. Primitive return cross-file ────────────────────────────────
  it('should create a single "result" output for imported function with primitive return', () => {
    writeFile('utils2.ts', `export function double(x: number): number { return x * 2; }`);
    const workflowPath = writeFile(
      'workflow2.ts',
      `import { double } from './utils2';

/** @flowWeaver workflow
 * @node d double
 * @connect Start.execute -> d.execute
 * @connect d.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

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

  // ── 3. Annotated import NOT re-inferred ───────────────────────────
  it('should use annotated version and not re-infer for @flowWeaver nodeType imports', () => {
    writeFile(
      'utils3.ts',
      `/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
export function add(a: number, b: number): number { return a + b; }
`
    );
    const workflowPath = writeFile(
      'workflow3.ts',
      `import { add } from './utils3';

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    expect(result.errors).toHaveLength(0);
    const addTypes = result.workflows[0].nodeTypes.filter((nt) => nt.functionName === 'add');
    // Should be exactly one (the annotated one), not a duplicate
    expect(addTypes).toHaveLength(1);
    // Should NOT have inferred flag — it came from annotation
    expect(addTypes[0].inferred).toBeFalsy();
  });

  // ── 4. Mixed annotated + unannotated from same import ─────────────
  it('should handle mixed annotated and unannotated functions from same file', () => {
    writeFile(
      'utils4.ts',
      `/** @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output product
 */
export function multiply(a: number, b: number): number { return a * b; }

export function add(a: number, b: number) { return { sum: a + b }; }
`
    );
    const workflowPath = writeFile(
      'workflow4.ts',
      `import { multiply, add } from './utils4';

/** @flowWeaver workflow
 * @node m multiply
 * @node adder add
 * @connect Start.execute -> m.execute
 * @connect m.onSuccess -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    expect(result.errors).toHaveLength(0);

    const multiplyType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'multiply');
    expect(multiplyType).toBeDefined();
    expect(multiplyType!.inferred).toBeFalsy();

    const addType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'add');
    expect(addType).toBeDefined();
    expect(addType!.inferred).toBe(true);
  });

  // ── 5. Async imported function ────────────────────────────────────
  it('should detect async and unwrap Promise for imported functions', () => {
    writeFile(
      'utils5.ts',
      `export async function fetchData(url: string): Promise<string> { return ''; }`
    );
    const workflowPath = writeFile(
      'workflow5.ts',
      `import { fetchData } from './utils5';

/** @flowWeaver workflow
 * @node f fetchData
 * @connect Start.execute -> f.execute
 * @connect f.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    expect(result.errors).toHaveLength(0);
    const nodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'fetchData');
    expect(nodeType).toBeDefined();
    expect(nodeType!.inferred).toBe(true);
    expect(nodeType!.isAsync).toBe(true);

    // Promise<string> unwrapped → single result output of STRING
    expect(nodeType!.outputs.result).toBeDefined();
    expect(nodeType!.outputs.result.dataType).toBe('STRING');
  });

  // ── 6. Non-imported function still errors ─────────────────────────
  it('should still produce error for functions not in any import', () => {
    const workflowPath = writeFile(
      'workflow6.ts',
      `/** @flowWeaver workflow
 * @node x notImported
 * @connect Start.execute -> x.execute
 * @connect x.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('notImported'))).toBe(true);
  });

  // ── 7. sourceLocation points to original file ─────────────────────
  it('should set sourceLocation to the imported file path', () => {
    writeFile('utils7.ts', `export function add(a: number, b: number) { return { sum: a + b }; }`);
    const workflowPath = writeFile(
      'workflow7.ts',
      `import { add } from './utils7';

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    expect(result.errors).toHaveLength(0);
    const addNodeType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'add');
    expect(addNodeType).toBeDefined();
    expect(addNodeType!.sourceLocation).toBeDefined();
    expect(addNodeType!.sourceLocation!.file).toContain('utils7.ts');
  });

  // ── 8. Validator INFERRED_NODE_TYPE diagnostic fires for imported inferred types ──
  it('should produce INFERRED_NODE_TYPE warning for imported inferred types', () => {
    writeFile('utils8.ts', `export function add(a: number, b: number) { return { sum: a + b }; }`);
    const workflowPath = writeFile(
      'workflow8.ts',
      `import { add } from './utils8';

/** @flowWeaver workflow
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const validator = new WorkflowValidator();
    const validationResult = validator.validate(workflow);

    const inferredInfos = validationResult.warnings.filter((w) => w.code === 'INFERRED_NODE_TYPE');
    expect(inferredInfos).toHaveLength(1);
    expect(inferredInfos[0].message).toContain('add');
    expect(inferredInfos[0].message).toContain('auto-inferred');
  });

  // ── 9. Only named imports considered ──────────────────────────────
  it('should NOT infer functions that are not in named imports', () => {
    writeFile(
      'utils9.ts',
      `export function add(a: number, b: number) { return { sum: a + b }; }
export function subtract(a: number, b: number) { return { diff: a - b }; }
`
    );
    const workflowPath = writeFile(
      'workflow9.ts',
      `import { add } from './utils9';

/** @flowWeaver workflow
 * @node s subtract
 * @connect Start.execute -> s.execute
 * @connect s.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    // subtract is NOT in the named imports, so it should error
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('subtract'))).toBe(true);
  });

  // ── 10. File-level JSDoc mentioning @flowWeaver should not block inference ──
  it('should not confuse file-level JSDoc containing @flowWeaver text with actual annotations', () => {
    writeFile(
      'utils10.ts',
      `/**
 * Utility functions with NO @flowWeaver annotation.
 * These should be auto-inferred when referenced via @node.
 */

export function add(a: number, b: number) { return { sum: a + b }; }

export async function fetchGreeting(name: string): Promise<string> { return ''; }
`
    );
    const workflowPath = writeFile(
      'workflow10.ts',
      `import { add, fetchGreeting } from './utils10';

/** @flowWeaver workflow
 * @node adder add
 * @node greeter fetchGreeting
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> greeter.execute
 * @connect greeter.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const parser = new AnnotationParser();
    const result = parser.parse(workflowPath);

    expect(result.errors).toHaveLength(0);

    const addType = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'add');
    expect(addType).toBeDefined();
    expect(addType!.inferred).toBe(true);

    const greetType = result.workflows[0].nodeTypes.find(
      (nt) => nt.functionName === 'fetchGreeting'
    );
    expect(greetType).toBeDefined();
    expect(greetType!.inferred).toBe(true);
  });
});
