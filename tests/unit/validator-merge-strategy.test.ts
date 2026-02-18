/**
 * Tests for validator mergeStrategy handling
 */

import { WorkflowValidator } from "../../src/validator";
import type { TWorkflowAST, TNodeTypeAST, TMergeStrategy } from "../../src/ast/types";

describe("Validator mergeStrategy", () => {
  const createNodeType = (inputs: Record<string, any> = {}): TNodeTypeAST => ({
    type: "NodeType",
    name: "testNode",
    functionName: "testNode",
    inputs: {
      execute: { dataType: "STEP" },
      ...inputs,
    },
    outputs: {
      onSuccess: { dataType: "STEP" },
      result: { dataType: "ANY" },
    },
    hasSuccessPort: true,
    hasFailurePort: false,
    executeWhen: "CONJUNCTION",
    isAsync: false,
  });

  const createSourceNodeType = (): TNodeTypeAST => ({
    type: "NodeType",
    name: "sourceNode",
    functionName: "sourceNode",
    inputs: {
      execute: { dataType: "STEP" },
    },
    outputs: {
      onSuccess: { dataType: "STEP" },
      value: { dataType: "NUMBER" },
    },
    hasSuccessPort: true,
    hasFailurePort: false,
    executeWhen: "CONJUNCTION",
    isAsync: false,
  });

  const createWorkflow = (
    instances: TWorkflowAST["instances"],
    connections: TWorkflowAST["connections"] = [],
    nodeTypes: TNodeTypeAST[] = []
  ): TWorkflowAST => ({
    type: "Workflow",
    functionName: "testWorkflow",
    name: "testWorkflow",
    sourceFile: "test.ts",
    nodeTypes,
    instances,
    connections,
    scopes: {},
    startPorts: {},
    exitPorts: {},
    imports: [],
  });

  describe("validateMultipleInputConnections with mergeStrategy", () => {
    it("should report error for multiple connections to DATA port without mergeStrategy", () => {
      const nodeType = createNodeType({
        data: { dataType: "NUMBER" }, // No mergeStrategy
      });
      const sourceNode = createSourceNodeType();

      const workflow = createWorkflow(
        [
          { type: "NodeInstance", id: "source1", nodeType: "sourceNode" },
          { type: "NodeInstance", id: "source2", nodeType: "sourceNode" },
          { type: "NodeInstance", id: "target", nodeType: "testNode" },
        ],
        [
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "source1", port: "execute" } },
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "source2", port: "execute" } },
          { type: "Connection", from: { node: "source1", port: "value" }, to: { node: "target", port: "data" } },
          { type: "Connection", from: { node: "source2", port: "value" }, to: { node: "target", port: "data" } },
          { type: "Connection", from: { node: "source1", port: "onSuccess" }, to: { node: "target", port: "execute" } },
        ],
        [nodeType, sourceNode]
      );

      const validator = new WorkflowValidator();
      const result = validator.validate(workflow);

      expect(result.errors.some(e =>
        e.code === "MULTIPLE_CONNECTIONS_TO_INPUT" &&
        e.message.includes("data") &&
        e.message.includes("target")
      )).toBe(true);
    });

    it("should allow multiple connections to DATA port with mergeStrategy:COLLECT", () => {
      const nodeType = createNodeType({
        data: { dataType: "ARRAY", mergeStrategy: "COLLECT" as TMergeStrategy },
      });
      const sourceNode = createSourceNodeType();

      const workflow = createWorkflow(
        [
          { type: "NodeInstance", id: "source1", nodeType: "sourceNode" },
          { type: "NodeInstance", id: "source2", nodeType: "sourceNode" },
          { type: "NodeInstance", id: "target", nodeType: "testNode" },
        ],
        [
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "source1", port: "execute" } },
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "source2", port: "execute" } },
          { type: "Connection", from: { node: "source1", port: "value" }, to: { node: "target", port: "data" } },
          { type: "Connection", from: { node: "source2", port: "value" }, to: { node: "target", port: "data" } },
          { type: "Connection", from: { node: "source1", port: "onSuccess" }, to: { node: "target", port: "execute" } },
        ],
        [nodeType, sourceNode]
      );

      const validator = new WorkflowValidator();
      const result = validator.validate(workflow);

      expect(result.errors.some(e =>
        e.code === "MULTIPLE_CONNECTIONS_TO_INPUT"
      )).toBe(false);
    });

    it("should allow multiple connections with mergeStrategy:MERGE", () => {
      const nodeType = createNodeType({
        data: { dataType: "OBJECT", mergeStrategy: "MERGE" as TMergeStrategy },
      });
      const sourceNode = createSourceNodeType();

      const workflow = createWorkflow(
        [
          { type: "NodeInstance", id: "source1", nodeType: "sourceNode" },
          { type: "NodeInstance", id: "source2", nodeType: "sourceNode" },
          { type: "NodeInstance", id: "target", nodeType: "testNode" },
        ],
        [
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "source1", port: "execute" } },
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "source2", port: "execute" } },
          { type: "Connection", from: { node: "source1", port: "value" }, to: { node: "target", port: "data" } },
          { type: "Connection", from: { node: "source2", port: "value" }, to: { node: "target", port: "data" } },
          { type: "Connection", from: { node: "source1", port: "onSuccess" }, to: { node: "target", port: "execute" } },
        ],
        [nodeType, sourceNode]
      );

      const validator = new WorkflowValidator();
      const result = validator.validate(workflow);

      expect(result.errors.some(e =>
        e.code === "MULTIPLE_CONNECTIONS_TO_INPUT"
      )).toBe(false);
    });

    it("should allow multiple connections with mergeStrategy:FIRST", () => {
      const nodeType = createNodeType({
        data: { dataType: "NUMBER", mergeStrategy: "FIRST" as TMergeStrategy },
      });
      const sourceNode = createSourceNodeType();

      const workflow = createWorkflow(
        [
          { type: "NodeInstance", id: "source1", nodeType: "sourceNode" },
          { type: "NodeInstance", id: "source2", nodeType: "sourceNode" },
          { type: "NodeInstance", id: "target", nodeType: "testNode" },
        ],
        [
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "source1", port: "execute" } },
          { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "source2", port: "execute" } },
          { type: "Connection", from: { node: "source1", port: "value" }, to: { node: "target", port: "data" } },
          { type: "Connection", from: { node: "source2", port: "value" }, to: { node: "target", port: "data" } },
          { type: "Connection", from: { node: "source1", port: "onSuccess" }, to: { node: "target", port: "execute" } },
        ],
        [nodeType, sourceNode]
      );

      const validator = new WorkflowValidator();
      const result = validator.validate(workflow);

      expect(result.errors.some(e =>
        e.code === "MULTIPLE_CONNECTIONS_TO_INPUT"
      )).toBe(false);
    });
  });
});
