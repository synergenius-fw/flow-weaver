/**
 * Tests for validator required input port detection
 */

import { WorkflowValidator } from "../../src/validator";
import type { TWorkflowAST, TNodeTypeAST } from "../../src/ast/types";

describe("Validator Required Inputs", () => {
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
      onFailure: { dataType: "STEP", failure: true },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
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

  it("should report error for unconnected required input port", () => {
    const nodeType = createNodeType({
      value: { dataType: "NUMBER" }, // Required - no optional, no default, no expression
    });

    const workflow = createWorkflow(
      [{ type: "NodeInstance", id: "node1", nodeType: "testNode", config: { x: 0, y: 0 } }],
      [], // No connections
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(result.errors.some(e =>
      e.code === "MISSING_REQUIRED_INPUT" &&
      e.message.includes("node1") &&
      e.message.includes("value")
    )).toBe(true);
  });

  it("should include fix suggestion in error message", () => {
    const nodeType = createNodeType({
      value: { dataType: "NUMBER" },
    });

    const workflow = createWorkflow(
      [{ type: "NodeInstance", id: "node1", nodeType: "testNode", config: { x: 0, y: 0 } }],
      [],
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(result.errors.some(e =>
      e.code === "MISSING_REQUIRED_INPUT" &&
      e.message.includes("@input [value]")
    )).toBe(true);
  });

  it("should NOT report error when port has connection", () => {
    const nodeType = createNodeType({
      value: { dataType: "NUMBER" },
    });

    const workflow = createWorkflow(
      [{ type: "NodeInstance", id: "node1", nodeType: "testNode", config: { x: 0, y: 0 } }],
      [{ type: "Connection", from: { node: "Start", port: "value" }, to: { node: "node1", port: "value" } }],
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(result.errors.some(e =>
      e.code === "MISSING_REQUIRED_INPUT" &&
      e.message.includes("value")
    )).toBe(false);
  });

  it("should NOT report error when port is optional", () => {
    const nodeType = createNodeType({
      value: { dataType: "NUMBER", optional: true },
    });

    const workflow = createWorkflow(
      [{ type: "NodeInstance", id: "node1", nodeType: "testNode", config: { x: 0, y: 0 } }],
      [],
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(result.errors.some(e =>
      e.code === "MISSING_REQUIRED_INPUT" &&
      e.message.includes("value")
    )).toBe(false);
  });

  it("should NOT report error when port has default value", () => {
    const nodeType = createNodeType({
      value: { dataType: "NUMBER", default: 0 },
    });

    const workflow = createWorkflow(
      [{ type: "NodeInstance", id: "node1", nodeType: "testNode", config: { x: 0, y: 0 } }],
      [],
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(result.errors.some(e =>
      e.code === "MISSING_REQUIRED_INPUT" &&
      e.message.includes("value")
    )).toBe(false);
  });

  it("should NOT report error when port has node-type-level expression", () => {
    const nodeType = createNodeType({
      value: { dataType: "NUMBER", expression: "() => 5" },
    });

    const workflow = createWorkflow(
      [{ type: "NodeInstance", id: "node1", nodeType: "testNode", config: { x: 0, y: 0 } }],
      [],
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(result.errors.some(e =>
      e.code === "MISSING_REQUIRED_INPUT" &&
      e.message.includes("value")
    )).toBe(false);
  });

  it("should NOT report error when instance has constant expression for the port", () => {
    const nodeType = createNodeType({
      value: { dataType: "NUMBER" }, // Required at node type level
    });

    const workflow = createWorkflow(
      [{
        type: "NodeInstance",
        id: "node1",
        nodeType: "testNode",
        config: {
          x: 0,
          y: 0,
          portConfigs: [{
            portName: "value",
            direction: "INPUT",
            expression: "5",
          }],
        },
      }],
      [], // No connections
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    // Should NOT have the error because instance has a constant expression
    expect(result.errors.some(e =>
      e.code === "MISSING_REQUIRED_INPUT" &&
      e.message.includes("value")
    )).toBe(false);
  });

  it("should NOT report error when instance has constant value for the port", () => {
    const nodeType = createNodeType({
      value: { dataType: "NUMBER" },
    });

    const workflow = createWorkflow(
      [{
        type: "NodeInstance",
        id: "node1",
        nodeType: "testNode",
        config: {
          x: 0,
          y: 0,
          portConfigs: [{
            portName: "value",
            direction: "INPUT",
            expression: "42",
          }],
        },
      }],
      [],
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(result.errors.some(e =>
      e.code === "MISSING_REQUIRED_INPUT" &&
      e.message.includes("value")
    )).toBe(false);
  });
});
