/**
 * Tests for Workflow File Operations
 * TDD: Tests written first, implementation follows
 */

import {
  addWorkflowToSource,
  removeWorkflowFromSource,
  toggleWorkflowExport,
  getAvailableWorkflows,
} from "../../src/api/workflow-file-operations";

describe("Workflow File Operations", () => {
  // Sample source with single workflow
  const singleWorkflowSource = `
/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`.trim();

  // Sample source with multiple workflows
  const multiWorkflowSource = `
/**
 * @flowWeaver workflow
 */
export function firstWorkflow(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}

/**
 * @flowWeaver workflow
 */
export function secondWorkflow(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`.trim();

  // Source with runtime section
  const sourceWithRuntime = `
// @flow-weaver-runtime-start
// Runtime code here
// @flow-weaver-runtime-end

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`.trim();

  // Source with non-exported workflow
  const nonExportedWorkflowSource = `
/**
 * @flowWeaver workflow
 */
function privateWorkflow(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`.trim();

  describe("addWorkflowToSource", () => {
    it("should add a new workflow function to source with @flowWeaver annotation", () => {
      const result = addWorkflowToSource(singleWorkflowSource, "newWorkflow");

      expect(result).toContain("@flowWeaver workflow");
      expect(result).toContain("function newWorkflow");
      expect(result).toContain("execute: boolean");
    });

    it("should insert after runtime section if present", () => {
      const result = addWorkflowToSource(sourceWithRuntime, "newWorkflow");

      const runtimeEndIndex = result.indexOf("@flow-weaver-runtime-end");
      const newWorkflowIndex = result.indexOf("function newWorkflow");

      expect(newWorkflowIndex).toBeGreaterThan(runtimeEndIndex);
    });

    it("should generate valid JSDoc with @flowWeaver workflow", () => {
      const result = addWorkflowToSource(singleWorkflowSource, "newWorkflow");

      // Should have JSDoc before the function
      const jsdocMatch = result.match(/\/\*\*[\s\S]*?@flowWeaver workflow[\s\S]*?\*\/\s*(?:export\s+)?function newWorkflow/);
      expect(jsdocMatch).not.toBeNull();
    });

    it("should throw if workflow name already exists", () => {
      expect(() => addWorkflowToSource(singleWorkflowSource, "myWorkflow")).toThrow(
        /already exists/
      );
    });

    it("should add workflow as exported by default", () => {
      const result = addWorkflowToSource(singleWorkflowSource, "newWorkflow");

      expect(result).toContain("export function newWorkflow");
    });

    it("should add non-exported workflow when specified", () => {
      const result = addWorkflowToSource(singleWorkflowSource, "newWorkflow", { exported: false });

      expect(result).toContain("function newWorkflow");
      expect(result).not.toMatch(/export\s+function newWorkflow/);
    });
  });

  describe("removeWorkflowFromSource", () => {
    it("should remove workflow function and its JSDoc", () => {
      const result = removeWorkflowFromSource(multiWorkflowSource, "firstWorkflow");

      expect(result).not.toContain("function firstWorkflow");
      expect(result).toContain("function secondWorkflow");
    });

    it("should throw if workflow not found", () => {
      expect(() => removeWorkflowFromSource(singleWorkflowSource, "nonExistent")).toThrow(
        /not found/
      );
    });

    it("should throw if trying to remove last workflow", () => {
      expect(() => removeWorkflowFromSource(singleWorkflowSource, "myWorkflow")).toThrow(
        /cannot remove.*last/i
      );
    });

    it("should preserve other workflows in file", () => {
      const result = removeWorkflowFromSource(multiWorkflowSource, "firstWorkflow");

      expect(result).toContain("@flowWeaver workflow");
      expect(result).toContain("function secondWorkflow");
      expect(result).toContain("execute: boolean");
    });

    it("should preserve runtime section when removing workflow", () => {
      const sourceWithRuntimeAndMultiple = `
// @flow-weaver-runtime-start
// Runtime code
// @flow-weaver-runtime-end

/**
 * @flowWeaver workflow
 */
export function first(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}

/**
 * @flowWeaver workflow
 */
export function second(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`.trim();

      const result = removeWorkflowFromSource(sourceWithRuntimeAndMultiple, "first");

      expect(result).toContain("@flow-weaver-runtime-start");
      expect(result).toContain("@flow-weaver-runtime-end");
      expect(result).toContain("function second");
    });
  });

  describe("toggleWorkflowExport", () => {
    it("should add export keyword to non-exported workflow", () => {
      const result = toggleWorkflowExport(nonExportedWorkflowSource, "privateWorkflow");

      expect(result).toContain("export function privateWorkflow");
    });

    it("should remove export keyword from exported workflow", () => {
      const result = toggleWorkflowExport(singleWorkflowSource, "myWorkflow");

      expect(result).not.toMatch(/export\s+function myWorkflow/);
      expect(result).toContain("function myWorkflow");
    });

    it("should preserve JSDoc and function body", () => {
      const result = toggleWorkflowExport(singleWorkflowSource, "myWorkflow");

      expect(result).toContain("@flowWeaver workflow");
      expect(result).toContain('throw new Error("Not implemented")');
    });

    it("should throw if workflow not found", () => {
      expect(() => toggleWorkflowExport(singleWorkflowSource, "nonExistent")).toThrow(
        /not found/
      );
    });
  });

  describe("getAvailableWorkflows", () => {
    it("should return all workflow names in file", () => {
      const result = getAvailableWorkflows(multiWorkflowSource);

      expect(result).toHaveLength(2);
      expect(result.map((w) => w.name)).toContain("firstWorkflow");
      expect(result.map((w) => w.name)).toContain("secondWorkflow");
    });

    it("should return isExported status for each", () => {
      const mixedSource = `
/**
 * @flowWeaver workflow
 */
export function exportedOne(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}

/**
 * @flowWeaver workflow
 */
function privateOne(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`.trim();

      const result = getAvailableWorkflows(mixedSource);

      const exported = result.find((w) => w.name === "exportedOne");
      const private_ = result.find((w) => w.name === "privateOne");

      expect(exported?.isExported).toBe(true);
      expect(private_?.isExported).toBe(false);
    });

    it("should return empty array for source with no workflows", () => {
      const noWorkflowSource = `
function regularFunction() {
  return 42;
}
`.trim();

      const result = getAvailableWorkflows(noWorkflowSource);

      expect(result).toHaveLength(0);
    });

    it("should handle workflows with @name tag", () => {
      const sourceWithNameTag = `
/**
 * @flowWeaver workflow
 * @name customName
 */
export function actualFunctionName(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`.trim();

      const result = getAvailableWorkflows(sourceWithNameTag);

      expect(result).toHaveLength(1);
      // The name should be the @name tag value, not the function name
      expect(result[0].name).toBe("customName");
      expect(result[0].functionName).toBe("actualFunctionName");
    });
  });
});
