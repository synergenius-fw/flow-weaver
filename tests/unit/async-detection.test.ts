/**
 * Async Detection Tests
 * Consolidated tests for async/sync detection across parser, generator, and logic layers
 *
 * Tests cover:
 * 1. Parser detection of async keyword on node types and workflows
 * 2. Logic to determine if a workflow should be async based on node composition
 * 3. Code generation of sync vs async workflows
 */

import * as path from "path";
import { parser } from "../../src/parser";
import { generator } from "../../src/generator";
import { shouldWorkflowBeAsync, validateWorkflowAsync } from "../../src/generator/async-detection";
import { TWorkflowAST, TNodeTypeAST } from "../../src/ast/types";

describe("Async Detection", () => {
  // ========================================
  // PARSER ASYNC DETECTION
  // ========================================
  describe("Parser Async Detection", () => {
    const testWorkflowPath = path.join(
      __dirname,
      "../../fixtures/async-detection/async-sync-nodes.ts"
    );

    let parsed: any;

    beforeAll(() => {
      parsed = parser.parse(testWorkflowPath);
    });

    describe("Node Type Async Detection", () => {
      it("should detect sync node functions and set isAsync = false", () => {
        const syncAddNode = parsed.nodeTypes.find(
          (nt: any) => nt.name === "syncAdd"
        );

        expect(syncAddNode).toBeDefined();
        expect(syncAddNode.isAsync).toBe(false);
      });

      it("should detect async node functions and set isAsync = true", () => {
        const asyncMultiplyNode = parsed.nodeTypes.find(
          (nt: any) => nt.name === "asyncMultiply"
        );

        expect(asyncMultiplyNode).toBeDefined();
        expect(asyncMultiplyNode.isAsync).toBe(true);
      });

      it("should correctly identify all sync nodes", () => {
        const syncNodes = parsed.nodeTypes.filter(
          (nt: any) => nt.name === "syncAdd" || nt.name === "syncDivide"
        );

        expect(syncNodes.length).toBe(2);
        syncNodes.forEach((node: any) => {
          expect(node.isAsync).toBe(false);
        });
      });

      it("should correctly identify all async nodes", () => {
        const asyncNodes = parsed.nodeTypes.filter(
          (nt: any) => nt.name === "asyncMultiply"
        );

        expect(asyncNodes.length).toBe(1);
        asyncNodes.forEach((node: any) => {
          expect(node.isAsync).toBe(true);
        });
      });
    });

    describe("Workflow Function Async Detection", () => {
      it("should detect sync workflow functions and set userSpecifiedAsync = false", () => {
        const syncWorkflow = parsed.workflows.find(
          (wf: any) => wf.functionName === "syncOnlyWorkflow"
        );

        expect(syncWorkflow).toBeDefined();
        expect(syncWorkflow.userSpecifiedAsync).toBe(false);
      });

      it("should detect async workflow functions and set userSpecifiedAsync = true", () => {
        const asyncWorkflow = parsed.workflows.find(
          (wf: any) => wf.functionName === "asyncWorkflow"
        );

        expect(asyncWorkflow).toBeDefined();
        expect(asyncWorkflow.userSpecifiedAsync).toBe(true);
      });
    });
  });

  // ========================================
  // WORKFLOW ASYNC DETECTION LOGIC
  // ========================================
  describe("Workflow Async Detection Logic", () => {
    // Helper to create minimal workflow
    const createWorkflow = (userAsync?: boolean): TWorkflowAST => ({
      type: "Workflow",
      sourceFile: "/test.ts",
      name: "test",
      functionName: "test",
      nodeTypes: [],
      instances: [],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
      userSpecifiedAsync: userAsync,
    });

    // Helper to create node type
    const createNodeType = (name: string, isAsync: boolean): TNodeTypeAST => ({
      type: "NodeType",
      name,
      functionName: name,
      inputs: {},
      outputs: {},
      hasSuccessPort: true,
      hasFailurePort: true,
      executeWhen: "CONJUNCTION",
      isAsync,
    });

    describe("shouldWorkflowBeAsync", () => {
      it("should return false when all nodes are sync", () => {
        const workflow = createWorkflow();
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "syncNode", config: {} },
          { type: "NodeInstance", id: "node2", nodeType: "anotherSyncNode", config: {} },
        ];
        const nodeTypes = [
          createNodeType("syncNode", false),
          createNodeType("anotherSyncNode", false),
        ];

        const result = shouldWorkflowBeAsync(workflow, nodeTypes);

        expect(result).toBe(false);
      });

      it("should return true when any node is async", () => {
        const workflow = createWorkflow();
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "syncNode", config: {} },
          { type: "NodeInstance", id: "node2", nodeType: "asyncNode", config: {} },
        ];
        const nodeTypes = [
          createNodeType("syncNode", false),
          createNodeType("asyncNode", true),
        ];

        const result = shouldWorkflowBeAsync(workflow, nodeTypes);

        expect(result).toBe(true);
      });

      it("should return true when all nodes are async", () => {
        const workflow = createWorkflow();
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "asyncNode1", config: {} },
          { type: "NodeInstance", id: "node2", nodeType: "asyncNode2", config: {} },
        ];
        const nodeTypes = [
          createNodeType("asyncNode1", true),
          createNodeType("asyncNode2", true),
        ];

        const result = shouldWorkflowBeAsync(workflow, nodeTypes);

        expect(result).toBe(true);
      });

      it("should return false for workflow with no instances", () => {
        const workflow = createWorkflow();
        const nodeTypes: TNodeTypeAST[] = [];

        const result = shouldWorkflowBeAsync(workflow, nodeTypes);

        expect(result).toBe(false);
      });

      it("should handle node type not found gracefully", () => {
        const workflow = createWorkflow();
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "missingNode", config: {} },
        ];
        const nodeTypes: TNodeTypeAST[] = [];

        const result = shouldWorkflowBeAsync(workflow, nodeTypes);

        expect(result).toBe(false);
      });
    });

    describe("validateWorkflowAsync", () => {
      it("should respect user's sync choice when all nodes are sync", () => {
        const workflow = createWorkflow(false);
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "syncNode", config: {} },
        ];
        const nodeTypes = [createNodeType("syncNode", false)];

        const result = validateWorkflowAsync(workflow, nodeTypes);

        expect(result.shouldBeAsync).toBe(false);
        expect(result.warning).toBeUndefined();
      });

      it("should respect user's async choice when all nodes are sync", () => {
        const workflow = createWorkflow(true);
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "syncNode", config: {} },
        ];
        const nodeTypes = [createNodeType("syncNode", false)];

        const result = validateWorkflowAsync(workflow, nodeTypes);

        expect(result.shouldBeAsync).toBe(true);
        expect(result.warning).toBeUndefined();
      });

      it("should force async and warn when user wrote sync but contains async nodes", () => {
        const workflow = createWorkflow(false);
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "asyncNode", config: {} },
        ];
        const nodeTypes = [createNodeType("asyncNode", true)];

        const result = validateWorkflowAsync(workflow, nodeTypes);

        expect(result.shouldBeAsync).toBe(true);
        expect(result.warning).toBeDefined();
        expect(result.warning).toContain("test");
        expect(result.warning).toContain("sync");
        expect(result.warning).toContain("async");
      });

      it("should be async when user wrote async and contains async nodes", () => {
        const workflow = createWorkflow(true);
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "asyncNode", config: {} },
        ];
        const nodeTypes = [createNodeType("asyncNode", true)];

        const result = validateWorkflowAsync(workflow, nodeTypes);

        expect(result.shouldBeAsync).toBe(true);
        expect(result.warning).toBeUndefined();
      });

      it("should default to async when userSpecifiedAsync is undefined", () => {
        const workflow = createWorkflow(undefined);
        workflow.instances = [
          { type: "NodeInstance", id: "node1", nodeType: "syncNode", config: {} },
        ];
        const nodeTypes = [createNodeType("syncNode", false)];

        const result = validateWorkflowAsync(workflow, nodeTypes);

        expect(result.shouldBeAsync).toBe(true);
        expect(result.warning).toBeUndefined();
      });
    });
  });

  // ========================================
  // CODE GENERATION (SYNC VS ASYNC)
  // ========================================
  describe("Sync Workflow Code Generation", () => {
    const syncWorkflowPath = path.join(
      __dirname,
      "../../fixtures/async-detection/sync-only.ts"
    );

    it("should generate sync code for sync-only workflow", async () => {
      const code = await global.testHelpers.generateFast(syncWorkflowPath, "syncCalculation");

      // Should generate sync function (no async keyword)
      expect(code).not.toContain("export async function syncCalculation");
      expect(code).toContain("export function syncCalculation(");

      // Should generate direct return type (not Promise)
      expect(code).not.toMatch(/\):\s*Promise<\{/);
      expect(code).toMatch(/\):\s*\{/);

      // Should instantiate ExecutionContext with isAsync=false
      expect(code).toContain("new GeneratedExecutionContext(false");

      // Should not use await on sync node calls
      expect(code).not.toMatch(/await\s+add\(/);
      expect(code).not.toMatch(/await\s+multiply\(/);

      // Should not use await on context operations in sync mode
      expect(code).not.toMatch(/await\s+ctx\.setVariable\(/);
      expect(code).not.toMatch(/await\s+ctx\.getVariable\(/);
    });
  });
});
