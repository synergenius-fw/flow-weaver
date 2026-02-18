/**
 * TDD Test: Dynamic Execution Index
 *
 * Problem: Three locations in unified.ts use hardcoded `executionIndex: 0`
 * instead of dynamic indices:
 * - Line 478: Pull node getVariable
 * - Line 556: sendWorkflowCompletedEvent
 * - Line 1273: Branch return sendWorkflowCompletedEvent
 *
 * Expected: All executionIndex values should be dynamic (e.g., sourceIdx, exitIdx)
 *
 * Additional: Pull nodes use `let` declarations so their index can be undefined.
 * When reading from a pull node, we must use non-null assertion (!) to satisfy TypeScript.
 */
import * as path from 'path';
import * as fs from 'fs';
import { generator } from '../../src/generator';

describe('Dynamic Execution Index', () => {
  const examplesDir = path.join(__dirname, '../../fixtures');
  const tmpDir = path.join(__dirname, '../fixtures/tmp-exec-idx');

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

  it('should use dynamic executionIndex for pull nodes', async () => {
    // Create a workflow with a pull execution node
    const workflowFile = path.join(tmpDir, 'pull-exec-idx.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Lazy node for pull execution
 * @flowWeaver nodeType
 * @pullExecution trigger
 * @input trigger
 * @input value
 * @output result
 */
function lazyTransform(trigger: boolean, value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node lazy1 lazyTransform
 * @connect Start.trigger -> lazy1.trigger
 * @connect Start.value -> lazy1.value
 * @connect lazy1.result -> Exit.result
 * @param trigger
 * @param value
 * @returns result
 */
export function pullWorkflow(
  execute: boolean,
  params: { trigger: boolean; value: number }
): { result: number } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'pullWorkflow');

    // Pull node getVariable should NOT use hardcoded 0
    // It should reference the node's execution index variable
    expect(code).not.toMatch(/getVariable\([^)]*executionIndex:\s*0[^)]*lazy1/);

    // Should have a variable for the pull node's execution index
    expect(code).toMatch(/lazy1Idx/);

    // Pull nodes use let declarations, so index can be undefined
    // Must use non-null assertion (!) when reading from pull node
    expect(code).toMatch(/executionIndex:\s*lazy1Idx!/);
  });

  it('should use exitIdx in sendWorkflowCompletedEvent', async () => {
    const basicExample = path.join(examplesDir, 'basic/example.ts');

    // Skip if example doesn't exist
    if (!fs.existsSync(basicExample)) {
      return;
    }

    const code = await generator.generate(basicExample, 'calculate');

    // sendWorkflowCompletedEvent should use exitIdx, not 0
    expect(code).toMatch(/sendWorkflowCompletedEvent\s*\(\s*\{[\s\S]*?executionIndex:\s*exitIdx/);
    expect(code).not.toMatch(/sendWorkflowCompletedEvent\s*\(\s*\{[\s\S]*?executionIndex:\s*0/);
  });

  it('should use exitIdx in branch return paths', async () => {
    const workflowFile = path.join(tmpDir, 'branch-exec-idx.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Branching node
 * @flowWeaver nodeType
 * @input condition
 * @output onTrue
 * @output onFalse
 */
function branchNode(condition: boolean): { onTrue: boolean; onFalse: boolean } {
  return { onTrue: condition, onFalse: !condition };
}

/**
 * @flowWeaver workflow
 * @node b branchNode
 * @connect Start.condition -> b.condition
 * @connect b.onTrue -> Exit.result
 * @connect b.onFalse -> Exit.result
 * @param condition
 * @returns result
 */
export function branchWorkflow(
  execute: boolean,
  params: { condition: boolean }
): { result: boolean } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'branchWorkflow');

    // All sendWorkflowCompletedEvent calls should use exitIdx
    const completedEventMatches = code.match(/sendWorkflowCompletedEvent\s*\(\s*\{[^}]+\}/g) || [];

    for (const match of completedEventMatches) {
      expect(match).toContain('exitIdx');
      expect(match).not.toMatch(/executionIndex:\s*0/);
    }
  });

  it('should have no hardcoded executionIndex: 0 in sendWorkflowCompletedEvent', async () => {
    const workflowFile = path.join(tmpDir, 'no-hardcode.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Simple transform
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function simpleTransform(value: number): { result: number } {
  return { result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node t simpleTransform
 * @connect Start.value -> t.value
 * @connect t.result -> Exit.result
 * @param value
 * @returns result
 */
export function simpleWorkflow(
  execute: boolean,
  params: { value: number }
): { result: number } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'simpleWorkflow');

    // Verify no hardcoded 0 in sendWorkflowCompletedEvent
    // Find actual sendWorkflowCompletedEvent calls (not type definitions)
    const completedEventCalls = code.match(/ctx\.sendWorkflowCompletedEvent\s*\(\s*\{[^}]+\}/g) || [];
    expect(completedEventCalls.length).toBeGreaterThan(0);

    for (const call of completedEventCalls) {
      expect(call).toContain('exitIdx');
      expect(call).not.toMatch(/executionIndex:\s*0/);
    }
  });

  it('should use proper index variables throughout generated code', async () => {
    const workflowFile = path.join(tmpDir, 'idx-vars.ts');
    fs.writeFileSync(
      workflowFile,
      `
/**
 * Node A
 * @flowWeaver nodeType
 * @input x
 * @output y
 */
function nodeA(x: number): { y: number } {
  return { y: x * 2 };
}

/**
 * Node B
 * @flowWeaver nodeType
 * @input y
 * @output z
 */
function nodeB(y: number): { z: number } {
  return { z: y + 1 };
}

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @connect Start.x -> a.x
 * @connect a.y -> b.y
 * @connect b.z -> Exit.z
 * @param x
 * @returns z
 */
export function chainWorkflow(
  execute: boolean,
  params: { x: number }
): { z: number } {
  throw new Error('Not implemented');
}
`
    );

    const code = await generator.generate(workflowFile, 'chainWorkflow');

    // Should have index variables for each node
    expect(code).toMatch(/const\s+aIdx\s*=/);
    expect(code).toMatch(/const\s+bIdx\s*=/);
    expect(code).toMatch(/exitIdx/);

    // Each ctx.setVariable call should use proper index
    // Match actual calls like: ctx.setVariable({ id: 'a', ... })
    const setVarMatches = code.match(/ctx\.setVariable\s*\(\s*\{[^}]+\}/g) || [];
    expect(setVarMatches.length).toBeGreaterThan(0);

    for (const match of setVarMatches) {
      // Should have an executionIndex that's NOT hardcoded 0 (unless it's for Start which is ok)
      if (!match.includes("id: 'Start'")) {
        // Non-Start nodes should use dynamic index
        expect(match).toMatch(/executionIndex:\s*\w+Idx/);
      }
    }
  });
});
