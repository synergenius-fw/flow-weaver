/**
 * Tests for validator structural type mismatch detection
 */

import { WorkflowValidator } from "../../src/validator";
import type { TWorkflowAST, TNodeTypeAST } from "../../src/ast/types";

describe("Validator Structural Type Mismatch", () => {
  const createNodeType = (
    name: string,
    inputs: Record<string, any> = {},
    outputs: Record<string, any> = {}
  ): TNodeTypeAST => ({
    type: "NodeType",
    name,
    functionName: name,
    inputs: {
      execute: { dataType: "STEP" },
      ...inputs,
    },
    outputs: {
      onSuccess: { dataType: "STEP" },
      onFailure: { dataType: "STEP", failure: true },
      ...outputs,
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: "CONJUNCTION",
    isAsync: false,
  });

  const createWorkflow = (
    instances: TWorkflowAST["instances"],
    connections: TWorkflowAST["connections"],
    nodeTypes: TNodeTypeAST[]
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
    exitPorts: { result: { dataType: "OBJECT" } },
    imports: [],
  });

  it("should warn when OBJECT ports have different tsType", () => {
    const validatorNode = createNodeType(
      "validateLead",
      { lead: { dataType: "OBJECT", tsType: "RawLead" } },
      { validationResult: { dataType: "OBJECT", tsType: "ValidationResult" } }
    );

    const enricherNode = createNodeType(
      "enrichLead",
      { lead: { dataType: "OBJECT", tsType: "RawLead" } },
      { enrichedLead: { dataType: "OBJECT", tsType: "EnrichedLead" } }
    );

    const workflow = createWorkflow(
      [
        { type: "NodeInstance", id: "validator", nodeType: "validateLead", config: { x: 0, y: 0 } },
        { type: "NodeInstance", id: "enricher", nodeType: "enrichLead", config: { x: 200, y: 0 } },
      ],
      [
        // This is the problematic connection: ValidationResult -> RawLead
        {
          type: "Connection",
          from: { node: "validator", port: "validationResult" },
          to: { node: "enricher", port: "lead" }
        },
        // Exit connection to satisfy validator
        {
          type: "Connection",
          from: { node: "enricher", port: "enrichedLead" },
          to: { node: "Exit", port: "result" }
        },
      ],
      [validatorNode, enricherNode]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    // Should have a warning about structural type mismatch
    expect(result.warnings.some(w =>
      w.code === "OBJECT_TYPE_MISMATCH" &&
      w.message.includes("ValidationResult") &&
      w.message.includes("RawLead")
    )).toBe(true);
  });

  it("should NOT warn when OBJECT ports have same tsType", () => {
    const producerNode = createNodeType(
      "producer",
      {},
      { data: { dataType: "OBJECT", tsType: "UserData" } }
    );

    const consumerNode = createNodeType(
      "consumer",
      { data: { dataType: "OBJECT", tsType: "UserData" } },
      {}
    );

    const workflow = createWorkflow(
      [
        { type: "NodeInstance", id: "producer", nodeType: "producer", config: { x: 0, y: 0 } },
        { type: "NodeInstance", id: "consumer", nodeType: "consumer", config: { x: 200, y: 0 } },
      ],
      [
        {
          type: "Connection",
          from: { node: "producer", port: "data" },
          to: { node: "consumer", port: "data" }
        },
      ],
      [producerNode, consumerNode]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    // Should NOT have a warning about structural type mismatch
    expect(result.warnings.some(w =>
      w.code === "OBJECT_TYPE_MISMATCH"
    )).toBe(false);
  });

  it("should NOT warn when OBJECT ports lack tsType", () => {
    const producerNode = createNodeType(
      "producer",
      {},
      { data: { dataType: "OBJECT" } } // No tsType
    );

    const consumerNode = createNodeType(
      "consumer",
      { data: { dataType: "OBJECT" } }, // No tsType
      {}
    );

    const workflow = createWorkflow(
      [
        { type: "NodeInstance", id: "producer", nodeType: "producer", config: { x: 0, y: 0 } },
        { type: "NodeInstance", id: "consumer", nodeType: "consumer", config: { x: 200, y: 0 } },
      ],
      [
        {
          type: "Connection",
          from: { node: "producer", port: "data" },
          to: { node: "consumer", port: "data" }
        },
      ],
      [producerNode, consumerNode]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    // Should NOT warn - can't determine mismatch without tsType
    expect(result.warnings.some(w =>
      w.code === "OBJECT_TYPE_MISMATCH"
    )).toBe(false);
  });
});
