/**
 * Tests for code generation utilities
 * Tests buildNodeArgumentsWithContext and generateNodeWithExecutionContext
 */

import {
  buildNodeArgumentsWithContext,
  generateNodeWithExecutionContext,
  buildExecutionContextReturnForBranch,
} from "../../src/generator/code-utils";
import type { TWorkflowAST, TNodeTypeAST } from "../../src/ast/types";

describe("Code Generation Utilities", () => {
  // Helper to create a minimal node type
  function createNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
    return {
      type: "NodeType",
      name: "testNode",
      functionName: "testNode",
      variant: "FUNCTION",
      inputs: {
        execute: { dataType: "STEP", label: "Execute" },
        input1: { dataType: "STRING", tsType: "string" },
      },
      outputs: {
        onSuccess: { dataType: "STEP", isControlFlow: true },
        onFailure: { dataType: "STEP", isControlFlow: true, failure: true },
        output1: { dataType: "STRING", tsType: "string" },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: "CONJUNCTION",
      ...overrides,
    };
  }

  // Helper to create a minimal workflow
  function createWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
    return {
      type: "Workflow",
      name: "testWorkflow",
      functionName: "testWorkflow",
      sourceFile: "test.ts",
      nodeTypes: [createNodeType()],
      instances: [
        { type: "NodeInstance", id: "node1", nodeType: "testNode" },
      ],
      connections: [
        { type: "Connection", from: { node: "Start", port: "input" }, to: { node: "node1", port: "input1" } },
      ],
      scopes: {},
      startPorts: {
        execute: { dataType: "STEP" },
        input: { dataType: "STRING" },
      },
      exitPorts: {
        onSuccess: { dataType: "STEP", isControlFlow: true },
        result: { dataType: "STRING" },
      },
      imports: [],
      ...overrides,
    };
  }

  describe("buildNodeArgumentsWithContext", () => {
    it("should build arguments for node with single input connection", () => {
      const node = createNodeType();
      const workflow = createWorkflow();
      const lines: string[] = [];

      const args = buildNodeArgumentsWithContext({
        node,
        workflow,
        id: "node1",
        lines,
        indent: "  ",
      });

      // Should have execute and input1 arguments
      expect(args).toHaveLength(2);
      expect(args[0]).toBe("true"); // execute defaults to true when no connection
      expect(args[1]).toBe("node1_input1");

      // Should generate variable declaration for input1
      const linesJoined = lines.join("\n");
      expect(linesJoined).toContain("const node1_input1 = ");
      expect(linesJoined).toContain("getVariable");
      expect(linesJoined).toContain("'Start'");
      expect(linesJoined).toContain("'input'");
    });

    it("should handle execute port connection", () => {
      const node = createNodeType();
      const workflow = createWorkflow({
        connections: [
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "node1", port: "execute" } },
          { type: "Connection", from: { node: "Start", port: "input" }, to: { node: "node1", port: "input1" } },
        ],
      });
      const lines: string[] = [];

      const args = buildNodeArgumentsWithContext({
        node,
        workflow,
        id: "node1",
        lines,
        indent: "  ",
      });

      // Execute should be from connection, not default true
      expect(args[0]).toBe("node1_execute");

      const linesJoined = lines.join("\n");
      expect(linesJoined).toContain("const node1_execute = ");
    });

    it("should use default value for ports with default", () => {
      const node = createNodeType({
        inputs: {
          execute: { dataType: "STEP", label: "Execute" },
          input1: { dataType: "STRING", tsType: "string", default: "default_value" },
        },
      });
      const workflow = createWorkflow({
        connections: [], // No connections
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: "node1",
        lines,
        indent: "  ",
      });

      const linesJoined = lines.join("\n");
      expect(linesJoined).toContain('"default_value"');
    });

    it("should handle optional ports without connection", () => {
      const node = createNodeType({
        inputs: {
          execute: { dataType: "STEP", label: "Execute" },
          input1: { dataType: "STRING", tsType: "string", optional: true },
        },
      });
      const workflow = createWorkflow({
        connections: [],
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: "node1",
        lines,
        indent: "  ",
      });

      const linesJoined = lines.join("\n");
      expect(linesJoined).toContain("const node1_input1 = undefined");
    });

    it("should type-annotate required ports without connection using definite assignment", () => {
      const node = createNodeType({
        inputs: {
          execute: { dataType: "STEP", label: "Execute" },
          input1: { dataType: "NUMBER", tsType: "number" },
        },
      });
      const workflow = createWorkflow({
        connections: [], // No connections — required port is unconnected
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: "node1",
        lines,
        indent: "  ",
      });

      const linesJoined = lines.join("\n");
      // Should use definite assignment assertion with proper type, not bare undefined
      expect(linesJoined).toContain("let node1_input1!: number;");
      // Should NOT contain bare `= undefined` for required ports
      expect(linesJoined).not.toContain("node1_input1 = undefined");
    });

    it("should keep bare undefined for optional ports without connection", () => {
      const node = createNodeType({
        inputs: {
          execute: { dataType: "STEP", label: "Execute" },
          input1: { dataType: "NUMBER", tsType: "number", optional: true },
        },
      });
      const workflow = createWorkflow({
        connections: [],
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: "node1",
        lines,
        indent: "  ",
      });

      const linesJoined = lines.join("\n");
      expect(linesJoined).toContain("const node1_input1 = undefined");
    });

    it("should handle missing source nodes gracefully", () => {
      const node = createNodeType();
      const workflow = createWorkflow({
        connections: [
          // Connection from non-existent node
          { type: "Connection", from: { node: "missingNode", port: "output" }, to: { node: "node1", port: "input1" } },
        ],
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: "node1",
        lines,
        indent: "  ",
      });

      const linesJoined = lines.join("\n");
      expect(linesJoined).toContain("undefined");
      expect(linesJoined).toContain("not found");
    });
  });

  describe("generateNodeWithExecutionContext", () => {
    it("should emit STATUS_CHANGED RUNNING event", () => {
      const node = createNodeType();
      const workflow = createWorkflow();
      const lines: string[] = [];

      generateNodeWithExecutionContext(node, workflow, lines, true, "  ");

      const code = lines.join("\n");
      expect(code).toContain("sendStatusChangedEvent");
      expect(code).toContain("status: 'RUNNING'");
    });

    it("should emit STATUS_CHANGED SUCCEEDED event", () => {
      const node = createNodeType();
      const workflow = createWorkflow();
      const lines: string[] = [];

      generateNodeWithExecutionContext(node, workflow, lines, true, "  ");

      const code = lines.join("\n");
      expect(code).toContain("status: 'SUCCEEDED'");
    });

    it("should emit STATUS_CHANGED FAILED event in catch block", () => {
      const node = createNodeType();
      const workflow = createWorkflow();
      const lines: string[] = [];

      generateNodeWithExecutionContext(node, workflow, lines, true, "  ");

      const code = lines.join("\n");
      expect(code).toContain("} catch (error");
      expect(code).toContain("status: 'FAILED'");
    });

    it("should set output variables after execution", () => {
      const node = createNodeType();
      const workflow = createWorkflow();
      const lines: string[] = [];

      generateNodeWithExecutionContext(node, workflow, lines, true, "  ");

      const code = lines.join("\n");
      // Should set output1 from result
      expect(code).toContain("setVariable");
      expect(code).toContain("'output1'");
      expect(code).toContain("testNodeResult.output1");
    });

    it("should rethrow error when no onFailure connection", () => {
      const node = createNodeType();
      const workflow = createWorkflow({
        connections: [
          { type: "Connection", from: { node: "Start", port: "input" }, to: { node: "node1", port: "input1" } },
          // No onFailure connection
        ],
      });
      const lines: string[] = [];

      generateNodeWithExecutionContext(node, workflow, lines, true, "  ");

      const code = lines.join("\n");
      expect(code).toContain("throw error");
    });

    it("should not rethrow when onFailure connection exists", () => {
      const node = createNodeType();
      const workflow = createWorkflow({
        connections: [
          { type: "Connection", from: { node: "Start", port: "input" }, to: { node: "node1", port: "input1" } },
          { type: "Connection", from: { node: "testNode", port: "onFailure" }, to: { node: "node2", port: "execute" } },
        ],
      });
      const lines: string[] = [];

      generateNodeWithExecutionContext(node, workflow, lines, true, "  ");

      const code = lines.join("\n");
      // The catch block should NOT have throw error when onFailure is connected
      const catchBlockMatch = code.match(/catch \(error.*?\{([\s\S]*?)^\s*\}/m);
      if (catchBlockMatch) {
        expect(catchBlockMatch[1]).not.toContain("throw error");
      }
    });

    it("should use sync calls when isAsync is false", () => {
      const node = createNodeType();
      // Use nodeName as instance id to match generateNodeWithExecutionContext behavior
      const workflow = createWorkflow({
        instances: [{ type: "NodeInstance", id: "testNode", nodeType: "testNode" }],
        connections: [
          { type: "Connection", from: { node: "Start", port: "input" }, to: { node: "testNode", port: "input1" } },
        ],
      });
      const lines: string[] = [];

      generateNodeWithExecutionContext(node, workflow, lines, false, "  ");

      const code = lines.join("\n");
      // Should use ctx.getVariable without await
      expect(code).toContain("ctx.getVariable");
      expect(code).not.toMatch(/await ctx\.getVariable/);
      // Function call should not have await
      expect(code).toMatch(/const testNodeResult = testNode\(/);
    });

    it("should use async calls when isAsync is true", () => {
      const node = createNodeType();
      const workflow = createWorkflow({
        instances: [{ type: "NodeInstance", id: "testNode", nodeType: "testNode" }],
        connections: [
          { type: "Connection", from: { node: "Start", port: "input" }, to: { node: "testNode", port: "input1" } },
        ],
      });
      const lines: string[] = [];

      generateNodeWithExecutionContext(node, workflow, lines, true, "  ");

      const code = lines.join("\n");
      expect(code).toContain("await ctx.getVariable");
      expect(code).toContain("await testNode(");
    });
  });

  describe("buildExecutionContextReturnForBranch", () => {
    it("should build return object from exit connections", () => {
      const workflow = createWorkflow({
        connections: [
          { type: "Connection", from: { node: "node1", port: "output1" }, to: { node: "Exit", port: "result" } },
        ],
      });
      const lines: string[] = [];

      const returnStr = buildExecutionContextReturnForBranch(
        workflow,
        lines,
        true,
        "main",
        "  ",
        ["node1"]
      );

      expect(returnStr).toContain("result:");
      expect(lines.join("\n")).toContain("exit_result_main");
    });

    it("should return undefined for unexecuted source nodes", () => {
      const workflow = createWorkflow({
        connections: [
          { type: "Connection", from: { node: "node1", port: "output1" }, to: { node: "Exit", port: "result" } },
        ],
      });
      const lines: string[] = [];

      const returnStr = buildExecutionContextReturnForBranch(
        workflow,
        lines,
        true,
        "main",
        "  ",
        [] // node1 was not executed
      );

      expect(returnStr).toContain("result: undefined");
    });
  });
});
