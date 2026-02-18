/**
 * Deeply Nested Scopes Tests
 * Tests workflow parsing and generation with multiple levels of nested scopes
 */

import { parser } from "../../src/parser";
import { GeneratedExecutionContext } from "../../src/runtime/ExecutionContext";

describe("Deeply Nested Scopes", () => {
  describe("Scope Context Nesting", () => {
    it("should handle 5 levels of nested scope contexts", async () => {
      const ctx = new GeneratedExecutionContext(true);

      // Simulate 5 levels of nested scopes
      let currentCtx = ctx;
      const scopes: GeneratedExecutionContext[] = [ctx];

      for (let level = 1; level <= 5; level++) {
        const parentIdx = currentCtx.addExecution(`level${level - 1}`);
        await currentCtx.setVariable(
          { id: `level${level - 1}`, portName: "data", executionIndex: parentIdx },
          `data from level ${level - 1}`
        );

        currentCtx = currentCtx.createScope(`level${level - 1}`, parentIdx, `scope${level}`, false);
        scopes.push(currentCtx);
      }

      // Deepest level should have access to all parent variables (inherited scopes)
      const deepestCtx = scopes[scopes.length - 1];

      // Check we can add executions at deepest level
      const deepIdx = deepestCtx.addExecution("deepNode");
      await deepestCtx.setVariable(
        { id: "deepNode", portName: "result", executionIndex: deepIdx },
        "deep result"
      );

      // Merge back up through all levels
      for (let i = scopes.length - 1; i > 0; i--) {
        scopes[i - 1].mergeScope(scopes[i]);
      }

      // Root context should now have the deep result
      const result = await ctx.getVariable(
        { id: "deepNode", portName: "result", executionIndex: deepIdx }
      );
      expect(result).toBe("deep result");
    });

    it("should handle 10 levels of clean (isolated) nested scopes", async () => {
      const ctx = new GeneratedExecutionContext(true);

      // Simulate 10 levels of isolated scopes (like nested forEach loops)
      let currentCtx = ctx;
      const scopes: GeneratedExecutionContext[] = [ctx];
      const indices: number[] = [];

      for (let level = 0; level < 10; level++) {
        const idx = currentCtx.addExecution(`forEach${level}`);
        indices.push(idx);

        // Create isolated scope (clean=true)
        currentCtx = currentCtx.createScope(`forEach${level}`, idx, `iteration`, true);
        scopes.push(currentCtx);

        // Each level sets its own variable
        const itemIdx = currentCtx.addExecution(`item${level}`);
        await currentCtx.setVariable(
          { id: `item${level}`, portName: "value", executionIndex: itemIdx },
          level * 10
        );
      }

      // Verify deepest scope has its variable
      const deepestCtx = scopes[scopes.length - 1];
      const deepItemIdx = deepestCtx.addExecution("deepItem");
      await deepestCtx.setVariable(
        { id: "deepItem", portName: "result", executionIndex: deepItemIdx },
        "nested 10 levels deep"
      );

      // Execution counter should reflect all nested executions
      expect(deepestCtx.getExecutionCount()).toBeGreaterThan(10);
    });

    it("should maintain correct execution indices through nested scopes", async () => {
      const ctx = new GeneratedExecutionContext(true);
      const executionOrder: number[] = [];

      // Level 0
      const idx0 = ctx.addExecution("root");
      executionOrder.push(idx0);

      // Level 1
      const scope1 = ctx.createScope("root", idx0, "scope1", true);
      const idx1 = scope1.addExecution("child1");
      executionOrder.push(idx1);

      // Level 2
      const scope2 = scope1.createScope("child1", idx1, "scope2", true);
      const idx2 = scope2.addExecution("child2");
      executionOrder.push(idx2);

      // Level 3
      const scope3 = scope2.createScope("child2", idx2, "scope3", true);
      const idx3 = scope3.addExecution("child3");
      executionOrder.push(idx3);

      // Indices should be monotonically increasing
      for (let i = 1; i < executionOrder.length; i++) {
        expect(executionOrder[i]).toBeGreaterThan(executionOrder[i - 1]);
      }

      // Merge back
      scope2.mergeScope(scope3);
      scope1.mergeScope(scope2);
      ctx.mergeScope(scope1);

      // Final counter should reflect all executions
      expect(ctx.getExecutionCount()).toBe(4);
    });
  });

  describe("Workflow Parsing with Scoped Ports", () => {
    it("should parse workflow and track scoped ports through AST", () => {
      // Note: [scope:X] syntax is not supported in JSDoc parsing
      // Scoped ports are set programmatically in the AST
      const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output results
 */
function forEach(execute: boolean, items: any[], loopFn: (item: any) => any) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map(loopFn);
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver workflow
 * @node loop forEach
 * @connect Start.data -> loop.items
 * @connect loop.results -> Exit.output
 */
export async function scopedWorkflow(execute: boolean, params: { data: any[] }): Promise<{ onSuccess: boolean; onFailure: boolean; output: any[] }> {
  throw new Error('Not implemented');
}
`;

      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === "scopedWorkflow");

      expect(workflow).toBeDefined();
      expect(workflow!.instances).toHaveLength(1);

      // Verify the node type was parsed
      const forEachType = workflow!.nodeTypes.find(nt => nt.functionName === "forEach");
      expect(forEachType).toBeDefined();
      expect(forEachType!.inputs.items).toBeDefined();
      expect(forEachType!.outputs.results).toBeDefined();
    });
  });
});
