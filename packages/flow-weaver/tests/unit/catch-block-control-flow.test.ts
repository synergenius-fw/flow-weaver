/**
 * TDD Test: Catch Block Control Flow
 *
 * Problem: Pull nodes and regular (non-expression) nodes don't set
 * onSuccess/onFailure control flow ports in their catch blocks.
 *
 * Locations:
 * - Lines 1402-1409: Pull node catch block missing setVariable for control flow
 * - Lines 1716-1724: Regular node catch has condition `if (nodeType.expression)` - should apply to all nodes
 *
 * Expected: All node types should set onSuccess=false and onFailure=true in catch blocks
 */
import * as path from 'path';
import * as fs from 'fs';
import { generator } from '../../src/generator';

describe('Catch Block Control Flow', () => {
  const tmpDir = path.join(__dirname, '../fixtures/tmp-catch-flow');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should set onSuccess=false in pull node catch block', async () => {
    const workflowFile = path.join(tmpDir, 'pull-catch-flow.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Pull execution node
 * @flowWeaver nodeType
 * @pullExecution trigger
 * @input trigger
 * @input value
 * @output result
 */
function lazyNode(trigger: boolean, value: number): { result: number } {
  if (value < 0) throw new Error('Negative value');
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node lazy lazyNode
 * @connect Start.trigger -> lazy.trigger
 * @connect Start.value -> lazy.value
 * @connect lazy.result -> Exit.result
 * @connect lazy.onSuccess -> Exit.onSuccess
 * @connect lazy.onFailure -> Exit.onFailure
 * @param trigger
 * @param value
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function pullCatchTest(
  execute: boolean,
  params: { trigger: boolean; value: number }
): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'pullCatchTest');

    // Find the catch block for the pull node
    const catchMatch = code.match(/catch\s*\(error[^)]*\)[\s\S]*?throw\s+error;/);
    expect(catchMatch).toBeTruthy();

    if (catchMatch) {
      const catchBody = catchMatch[0];
      // Should set onSuccess=false in catch block
      expect(catchBody).toContain("'onSuccess'");
      expect(catchBody).toMatch(/onSuccess[\s\S]*?,\s*false\s*\)/);
    }
  });

  it('should set onFailure=true in pull node catch block', async () => {
    const workflowFile = path.join(tmpDir, 'pull-failure-flow.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Pull execution node
 * @flowWeaver nodeType
 * @pullExecution trigger
 * @input trigger
 * @input data
 * @output processed
 */
function lazyProcessor(trigger: boolean, data: string): { processed: string } {
  return { processed: data.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node lp lazyProcessor
 * @connect Start.trigger -> lp.trigger
 * @connect Start.data -> lp.data
 * @connect lp.processed -> Exit.processed
 * @connect lp.onFailure -> Exit.onFailure
 * @param trigger
 * @param data
 * @returns processed
 * @returns onFailure
 */
export function pullFailureTest(
  execute: boolean,
  params: { trigger: boolean; data: string }
): { processed: string; onFailure: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'pullFailureTest');

    // Find catch blocks
    const catchBlocks = code.match(/catch\s*\(error[^)]*\)[\s\S]*?throw\s+error;/g) || [];

    // At least one catch block should set onFailure=true
    let hasOnFailureTrue = false;
    for (const catchBody of catchBlocks) {
      if (catchBody.includes("'onFailure'") && catchBody.match(/onFailure[\s\S]*?,\s*true\s*\)/)) {
        hasOnFailureTrue = true;
        break;
      }
    }

    expect(hasOnFailureTrue).toBe(true);
  });

  it('should set onSuccess=false in regular node catch block', async () => {
    const workflowFile = path.join(tmpDir, 'regular-catch-flow.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Regular (non-expression) node
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function regularDouble(value: number): { doubled: number } {
  return { doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node rd regularDouble
 * @connect Start.value -> rd.value
 * @connect rd.doubled -> Exit.doubled
 * @connect rd.onSuccess -> Exit.onSuccess
 * @param value
 * @returns doubled
 * @returns onSuccess
 */
export function regularCatchTest(
  execute: boolean,
  params: { value: number }
): { doubled: number; onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'regularCatchTest');

    // Find catch blocks for regular nodes
    const catchBlocks = code.match(/catch\s*\(error[^)]*\)[\s\S]*?throw\s+error;/g) || [];

    // Should have catch block with onSuccess=false
    let hasOnSuccessFalse = false;
    for (const catchBody of catchBlocks) {
      if (catchBody.includes("'onSuccess'") && catchBody.match(/onSuccess[\s\S]*?,\s*false\s*\)/)) {
        hasOnSuccessFalse = true;
        break;
      }
    }

    expect(hasOnSuccessFalse).toBe(true);
  });

  it('should set onFailure=true in regular node catch block', async () => {
    const workflowFile = path.join(tmpDir, 'regular-failure-flow.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Regular (non-expression) node
 * @flowWeaver nodeType
 * @input text
 * @output upper
 */
function regularUpper(text: string): { upper: string } {
  return { upper: text.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node ru regularUpper
 * @connect Start.text -> ru.text
 * @connect ru.upper -> Exit.upper
 * @connect ru.onFailure -> Exit.onFailure
 * @param text
 * @returns upper
 * @returns onFailure
 */
export function regularFailureTest(
  execute: boolean,
  params: { text: string }
): { upper: string; onFailure: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'regularFailureTest');

    // Find catch blocks
    const catchBlocks = code.match(/catch\s*\(error[^)]*\)[\s\S]*?throw\s+error;/g) || [];

    // Should have catch block with onFailure=true
    let hasOnFailureTrue = false;
    for (const catchBody of catchBlocks) {
      if (catchBody.includes("'onFailure'") && catchBody.match(/onFailure[\s\S]*?,\s*true\s*\)/)) {
        hasOnFailureTrue = true;
        break;
      }
    }

    expect(hasOnFailureTrue).toBe(true);
  });

  it('should apply control flow to ALL node types, not just expressions', async () => {
    // Create workflow with both expression and non-expression nodes
    const workflowFile = path.join(tmpDir, 'mixed-nodes.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Expression node
 * @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output sum
 */
function exprAdd(a: number, b: number): { sum: number } {
  return { sum: a + b };
}

/**
 * Regular node (NOT expression)
 * @flowWeaver nodeType
 * @input x
 * @output y
 */
function regularMultiply(x: number): { y: number } {
  return { y: x * 3 };
}

/**
 * @flowWeaver workflow
 * @node e exprAdd
 * @node r regularMultiply
 * @connect Start.a -> e.a
 * @connect Start.b -> e.b
 * @connect e.sum -> r.x
 * @connect r.y -> Exit.result
 * @connect e.onSuccess -> Exit.exprSuccess
 * @connect r.onSuccess -> Exit.regularSuccess
 * @connect e.onFailure -> Exit.exprFailure
 * @connect r.onFailure -> Exit.regularFailure
 * @param a
 * @param b
 * @returns result
 * @returns exprSuccess
 * @returns regularSuccess
 * @returns exprFailure
 * @returns regularFailure
 */
export function mixedNodesTest(
  execute: boolean,
  params: { a: number; b: number }
): {
  result: number;
  exprSuccess: boolean;
  regularSuccess: boolean;
  exprFailure: boolean;
  regularFailure: boolean;
} {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'mixedNodesTest');

    // Find all catch blocks
    const catchBlocks = code.match(/catch\s*\(error[^)]*\)[\s\S]*?throw\s+error;/g) || [];

    // Should have at least 2 catch blocks (one for each node)
    expect(catchBlocks.length).toBeGreaterThanOrEqual(2);

    // Count how many have onSuccess/onFailure
    let blocksWithControlFlow = 0;
    for (const catchBody of catchBlocks) {
      if (catchBody.includes("'onSuccess'") && catchBody.includes("'onFailure'")) {
        blocksWithControlFlow++;
      }
    }

    // ALL catch blocks should have control flow, not just expression nodes
    expect(blocksWithControlFlow).toBe(catchBlocks.length);
  });

  it('should handle nested catch blocks correctly', async () => {
    const workflowFile = path.join(tmpDir, 'nested-catch.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Node A
 * @flowWeaver nodeType
 * @input input
 * @output output
 */
function nodeA(input: number): { output: number } {
  return { output: input + 1 };
}

/**
 * Node B
 * @flowWeaver nodeType
 * @input input
 * @output output
 */
function nodeB(input: number): { output: number } {
  return { output: input * 2 };
}

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @connect Start.value -> a.input
 * @connect a.output -> b.input
 * @connect b.output -> Exit.result
 * @connect a.onSuccess -> Exit.aSuccess
 * @connect b.onSuccess -> Exit.bSuccess
 * @param value
 * @returns result
 * @returns aSuccess
 * @returns bSuccess
 */
export function nestedCatchTest(
  execute: boolean,
  params: { value: number }
): { result: number; aSuccess: boolean; bSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'nestedCatchTest');

    // Each node's catch block should properly reference its own id
    expect(code).toMatch(/id:\s*'a'[\s\S]*?'onSuccess'/);
    expect(code).toMatch(/id:\s*'b'[\s\S]*?'onSuccess'/);
  });

  it('should not add control flow to cancellation errors', async () => {
    const workflowFile = path.join(tmpDir, 'cancellation-check.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Simple node
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function simpleNode(value: number): { result: number } {
  return { result: value };
}

/**
 * @flowWeaver workflow
 * @node s simpleNode
 * @connect Start.value -> s.value
 * @connect s.result -> Exit.result
 * @connect s.onSuccess -> Exit.onSuccess
 * @param value
 * @returns result
 * @returns onSuccess
 */
export function cancellationTest(
  execute: boolean,
  params: { value: number }
): { result: number; onSuccess: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'cancellationTest');

    // Should check for cancellation before setting control flow
    // The pattern should be: if (!isCancellation) { ... set control flow ... }
    expect(code).toContain('isCancellation');

    // Control flow should be inside the !isCancellation block
    const catchBlocks = code.match(/catch\s*\(error[^)]*\)[\s\S]*?throw\s+error;/g) || [];
    for (const catchBody of catchBlocks) {
      if (catchBody.includes("'onSuccess'")) {
        // onSuccess/onFailure should appear after isCancellation check
        expect(catchBody).toMatch(/if\s*\(\s*!isCancellation\s*\)[\s\S]*?onSuccess/);
      }
    }
  });
});
