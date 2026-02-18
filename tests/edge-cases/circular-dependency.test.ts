/**
 * Circular Dependency Tests
 * Tests that Flow Weaver correctly detects and rejects circular dependencies
 *
 * Uses in-memory parsing (parseFromString) for speed - no file I/O.
 */

import { parser } from "../../src/parser";
import { generateCode } from "../../src/api/generate";

describe("Circular Dependency Detection", () => {
  const testCases = [
    {
      name: "two-node cycle (A → B → A)",
      sourceCode: `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function processA(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function processB(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node A processA
 * @node B processB
 * @connect Start.input -> A.value
 * @connect A.result -> B.value
 * @connect A.onSuccess -> B.execute
 * @connect B.onSuccess -> A.execute
 * @connect B.result -> Exit.result
 */
export async function simpleCycle(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`,
      workflowName: "simpleCycle",
      expectedNodes: ["A", "B"],
    },
    {
      name: "three-node cycle (A → B → C → A)",
      sourceCode: `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function processA(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function processB(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function processC(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node A processA
 * @node B processB
 * @node C processC
 * @connect Start.input -> A.value
 * @connect A.result -> B.value
 * @connect B.result -> C.value
 * @connect A.onSuccess -> B.execute
 * @connect B.onSuccess -> C.execute
 * @connect C.onSuccess -> A.execute
 * @connect C.result -> Exit.result
 */
export async function multiNodeCycle(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`,
      workflowName: "multiNodeCycle",
      expectedNodes: ["A", "B", "C"],
    },
    {
      name: "self-referential cycle (A → A)",
      sourceCode: `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function processA(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node A processA
 * @connect Start.input -> A.value
 * @connect A.onSuccess -> A.execute
 * @connect A.result -> Exit.result
 */
export async function selfLoop(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`,
      workflowName: "selfLoop",
      expectedNodes: ["A"],
    }
  ];

  it.each(testCases)(
    "should detect $name",
    async ({ sourceCode, workflowName, expectedNodes }) => {
      // Parse in-memory (no file I/O)
      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === workflowName);

      if (!workflow) {
        throw new Error(`Workflow ${workflowName} not found`);
      }

      // generateCode is where cycle detection happens
      let caughtError: Error | null = null;
      try {
        await generateCode(workflow);
        throw new Error(`Should have thrown circular dependency error for ${workflowName}`);
      } catch (error: any) {
        caughtError = error;
      }

      // Verify cycle was detected
      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toMatch(/circular dependency/i);

      // Verify the error message contains the expected node names
      expectedNodes.forEach(nodeName => {
        expect(caughtError!.message).toContain(nodeName);
      });
    }
  );
});
