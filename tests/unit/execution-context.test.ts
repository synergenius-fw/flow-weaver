/**
 * Tests for GeneratedExecutionContext
 * Tests variable storage, execution tracking, and scope management
 */

import { GeneratedExecutionContext } from "../../src/runtime/ExecutionContext";
import { CancellationError } from "../../src/runtime/CancellationError";

describe("GeneratedExecutionContext", () => {
  describe("Variable Storage", () => {
    it("should store and retrieve variables", async () => {
      const ctx = new GeneratedExecutionContext(true);
      const idx = ctx.addExecution("node1");

      await ctx.setVariable({ id: "node1", portName: "result", executionIndex: idx }, 42);
      const value = await ctx.getVariable({ id: "node1", portName: "result", executionIndex: idx });

      expect(value).toBe(42);
    });

    it("should track execution indices", () => {
      const ctx = new GeneratedExecutionContext(true);

      const idx1 = ctx.addExecution("node1");
      const idx2 = ctx.addExecution("node2");
      const idx3 = ctx.addExecution("node1"); // Same node, new execution

      expect(idx1).toBe(0);
      expect(idx2).toBe(1);
      expect(idx3).toBe(2);
    });

    it("should throw when variable not found", () => {
      const ctx = new GeneratedExecutionContext(true);

      // getVariable throws synchronously when variable doesn't exist
      expect(() =>
        ctx.getVariable({ id: "nonexistent", portName: "result", executionIndex: 0 })
      ).toThrow("Variable not found");
    });

    it("should check if variable exists with hasVariable", async () => {
      const ctx = new GeneratedExecutionContext(true);
      const idx = ctx.addExecution("node1");

      expect(ctx.hasVariable({ id: "node1", portName: "result", executionIndex: idx })).toBe(false);

      await ctx.setVariable({ id: "node1", portName: "result", executionIndex: idx }, "test");

      expect(ctx.hasVariable({ id: "node1", portName: "result", executionIndex: idx })).toBe(true);
    });

    it("should reset clears all data", async () => {
      const ctx = new GeneratedExecutionContext(true);
      const idx = ctx.addExecution("node1");
      await ctx.setVariable({ id: "node1", portName: "result", executionIndex: idx }, 42);

      ctx.reset();

      expect(ctx.getExecutionCount()).toBe(0);
      expect(ctx.hasVariable({ id: "node1", portName: "result", executionIndex: idx })).toBe(false);
    });
  });

  describe("Pull Execution", () => {
    it("should support pull execution with registerPullExecutor", async () => {
      const ctx = new GeneratedExecutionContext(true);
      let executed = false;

      ctx.registerPullExecutor("lazyNode", async () => {
        executed = true;
        const idx = ctx.addExecution("lazyNode");
        await ctx.setVariable({ id: "lazyNode", portName: "result", executionIndex: idx }, "lazy value");
      });

      // Node hasn't executed yet
      expect(executed).toBe(false);

      // Getting variable triggers pull execution
      const value = await ctx.getVariable({ id: "lazyNode", portName: "result", executionIndex: 0 });

      expect(executed).toBe(true);
      expect(value).toBe("lazy value");
    });

    it("should not re-execute if variable already exists", async () => {
      const ctx = new GeneratedExecutionContext(true);
      let executeCount = 0;
      const idx = ctx.addExecution("node1");

      ctx.registerPullExecutor("node1", async () => {
        executeCount++;
        await ctx.setVariable({ id: "node1", portName: "result", executionIndex: idx }, "value");
      });

      // Pre-set the variable
      await ctx.setVariable({ id: "node1", portName: "result", executionIndex: idx }, "preset");

      // Get should not trigger executor since variable exists
      const value = await ctx.getVariable({ id: "node1", portName: "result", executionIndex: idx });

      expect(executeCount).toBe(0);
      expect(value).toBe("preset");
    });
  });

  describe("Scope Management", () => {
    describe("createScope", () => {
      it("should create isolated scope with cleanScope=true", async () => {
        const ctx = new GeneratedExecutionContext(true);
        const idx = ctx.addExecution("parent");
        await ctx.setVariable({ id: "parent", portName: "data", executionIndex: idx }, "parent value");

        const scopedCtx = ctx.createScope("parent", idx, "iteration", true);

        // Clean scope should not have parent's variables
        expect(scopedCtx.hasVariable({ id: "parent", portName: "data", executionIndex: idx })).toBe(false);
      });

      it("should inherit variables with cleanScope=false", async () => {
        const ctx = new GeneratedExecutionContext(true);
        const idx = ctx.addExecution("parent");
        await ctx.setVariable({ id: "parent", portName: "data", executionIndex: idx }, "parent value");

        const scopedCtx = ctx.createScope("parent", idx, "block", false);

        // Should have parent's variables
        const value = await scopedCtx.getVariable({ id: "parent", portName: "data", executionIndex: idx });
        expect(value).toBe("parent value");
      });

      it("should inherit execution counter", () => {
        const ctx = new GeneratedExecutionContext(true);
        ctx.addExecution("node1");
        ctx.addExecution("node2");
        ctx.addExecution("node3");

        const scopedCtx = ctx.createScope("parent", 0, "scope", true);

        // New executions in scope should continue from parent counter
        const newIdx = scopedCtx.addExecution("scopedNode");
        expect(newIdx).toBe(3);
      });
    });

    describe("mergeScope", () => {
      it("should copy variables from scoped context", async () => {
        const ctx = new GeneratedExecutionContext(true);
        const parentIdx = ctx.addExecution("parent");

        const scopedCtx = ctx.createScope("parent", parentIdx, "iteration", true);
        const childIdx = scopedCtx.addExecution("child");
        await scopedCtx.setVariable({ id: "child", portName: "result", executionIndex: childIdx }, "child value");

        ctx.mergeScope(scopedCtx);

        // Parent should now have child's variable
        const value = await ctx.getVariable({ id: "child", portName: "result", executionIndex: childIdx });
        expect(value).toBe("child value");
      });

      it("should update execution counter after merge", () => {
        const ctx = new GeneratedExecutionContext(true);
        ctx.addExecution("node1"); // 0

        const scopedCtx = ctx.createScope("parent", 0, "scope", true);
        scopedCtx.addExecution("child1"); // 1
        scopedCtx.addExecution("child2"); // 2
        scopedCtx.addExecution("child3"); // 3

        ctx.mergeScope(scopedCtx);

        // Next execution in parent should continue from merged counter
        const nextIdx = ctx.addExecution("afterMerge");
        expect(nextIdx).toBe(4);
      });
    });
  });

  describe("Sync vs Async Mode", () => {
    it("should return Promise in async mode", async () => {
      const ctx = new GeneratedExecutionContext(true);
      const idx = ctx.addExecution("node1");

      const setResult = ctx.setVariable({ id: "node1", portName: "result", executionIndex: idx }, 42);
      expect(setResult).toBeInstanceOf(Promise);

      await setResult;
      const getResult = ctx.getVariable({ id: "node1", portName: "result", executionIndex: idx });
      expect(getResult).toBeInstanceOf(Promise);
    });

    it("should return value directly in sync mode", () => {
      const ctx = new GeneratedExecutionContext(false);
      const idx = ctx.addExecution("node1");

      const setResult = ctx.setVariable({ id: "node1", portName: "result", executionIndex: idx }, 42);
      expect(setResult).toBeUndefined();

      const getResult = ctx.getVariable({ id: "node1", portName: "result", executionIndex: idx });
      expect(getResult).toBe(42);
    });
  });

  describe("Function Values", () => {
    it("should call function values when retrieving", async () => {
      const ctx = new GeneratedExecutionContext(true);
      const idx = ctx.addExecution("node1");

      // Store a function as value
      await ctx.setVariable({ id: "node1", portName: "result", executionIndex: idx }, () => "computed value");

      const value = await ctx.getVariable({ id: "node1", portName: "result", executionIndex: idx });
      expect(value).toBe("computed value");
    });

    it("should handle async function values", async () => {
      const ctx = new GeneratedExecutionContext(true);
      const idx = ctx.addExecution("node1");

      // Store an async function as value
      await ctx.setVariable(
        { id: "node1", portName: "result", executionIndex: idx },
        async () => "async computed"
      );

      const value = await ctx.getVariable({ id: "node1", portName: "result", executionIndex: idx });
      expect(value).toBe("async computed");
    });
  });

  describe("Cancellation", () => {
    it("should return false for isAborted() when no signal provided", () => {
      const ctx = new GeneratedExecutionContext(true);
      expect(ctx.isAborted()).toBe(false);
    });

    it("should return false for isAborted() when signal not aborted", () => {
      const controller = new AbortController();
      const ctx = new GeneratedExecutionContext(true, undefined, controller.signal);
      expect(ctx.isAborted()).toBe(false);
    });

    it("should detect aborted signal via isAborted()", () => {
      const controller = new AbortController();
      const ctx = new GeneratedExecutionContext(true, undefined, controller.signal);

      expect(ctx.isAborted()).toBe(false);
      controller.abort();
      expect(ctx.isAborted()).toBe(true);
    });

    it("should not throw on checkAborted() when not aborted", () => {
      const controller = new AbortController();
      const ctx = new GeneratedExecutionContext(true, undefined, controller.signal);

      expect(() => ctx.checkAborted("testNode")).not.toThrow();
    });

    it("should throw CancellationError on checkAborted() when aborted", () => {
      const controller = new AbortController();
      const ctx = new GeneratedExecutionContext(true, undefined, controller.signal);

      controller.abort();
      expect(() => ctx.checkAborted("testNode")).toThrow(CancellationError);
    });

    it("should include nodeId in CancellationError", () => {
      const controller = new AbortController();
      const ctx = new GeneratedExecutionContext(true, undefined, controller.signal);

      controller.abort();
      try {
        ctx.checkAborted("myNode");
        throw new Error("Should have thrown CancellationError");
      } catch (e) {
        expect(CancellationError.isCancellationError(e)).toBe(true);
        expect((e as CancellationError).nodeId).toBe("myNode");
      }
    });

    it("should propagate abortSignal to scoped contexts", () => {
      const controller = new AbortController();
      const ctx = new GeneratedExecutionContext(true, undefined, controller.signal);
      const idx = ctx.addExecution("parent");

      const scopedCtx = ctx.createScope("parent", idx, "scope", true);

      expect(scopedCtx.isAborted()).toBe(false);
      controller.abort();
      expect(scopedCtx.isAborted()).toBe(true);
    });

    it("should throw in scoped context when parent signal aborted", () => {
      const controller = new AbortController();
      const ctx = new GeneratedExecutionContext(true, undefined, controller.signal);
      const idx = ctx.addExecution("parent");

      const scopedCtx = ctx.createScope("parent", idx, "scope", true);
      controller.abort();

      expect(() => scopedCtx.checkAborted("childNode")).toThrow(CancellationError);
    });
  });
});
