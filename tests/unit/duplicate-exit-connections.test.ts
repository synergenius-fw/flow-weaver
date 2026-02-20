/**
 * Tests for duplicate exit port connections
 *
 * When multiple connections target the same exit port, the generator
 * must use unique variable names to avoid duplicate declarations.
 */

import { generateControlFlowWithExecutionContext } from "../../src/generator/unified";
import { TWorkflowAST, TNodeTypeAST } from "../../src/ast/types";

describe("Duplicate Exit Connections", () => {
  it("should generate unique variable names when multiple connections target the same exit port", () => {
    // Create a workflow where two connections go to Exit.onSuccess
    const nodeTypes: TNodeTypeAST[] = [
      {
        type: "NodeType",
        name: "NodeTypeA",
        functionName: "NodeTypeA",
        inputs: { execute: { dataType: "STEP" } },
        outputs: {
          onSuccess: { dataType: "STEP" },
          onFailure: { dataType: "STEP" },
          output: { dataType: "ANY" },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: "CONJUNCTION",
        isAsync: false,
      },
    ];

    const workflow: TWorkflowAST = {
      type: "Workflow",
      functionName: "testWorkflow",
      name: "testWorkflow",
      sourceFile: "/test/workflow.ts",
      imports: [],
      instances: [
        { type: "NodeInstance", id: "NodeA", nodeType: "NodeTypeA" },
      ],
      connections: [
        // Two connections to the same exit port
        { type: "Connection", from: { node: "Start", port: "execute" }, to: { node: "Exit", port: "onSuccess" } },
        { type: "Connection", from: { node: "NodeA", port: "output" }, to: { node: "Exit", port: "onSuccess" } },
      ],
      nodeTypes,
      startPorts: { execute: { dataType: "STEP" } },
      exitPorts: { onSuccess: { dataType: "STEP" } },
    };

    // Generate the workflow code (isAsync=false, production=false)
    const code = generateControlFlowWithExecutionContext(workflow, nodeTypes, false, false);

    // Should not have duplicate variable declarations
    const exitVarMatches = code.match(/const exit_onSuccess/g);

    // Only one declaration should exist (last connection wins, or unique names)
    expect(exitVarMatches?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("should handle multiple connections to different exit ports correctly", () => {
    const nodeTypes: TNodeTypeAST[] = [
      {
        type: "NodeType",
        name: "NodeTypeA",
        functionName: "NodeTypeA",
        inputs: { execute: { dataType: "STEP" } },
        outputs: {
          onSuccess: { dataType: "STEP" },
          onFailure: { dataType: "STEP" },
          output1: { dataType: "ANY" },
          output2: { dataType: "ANY" },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: "CONJUNCTION",
        isAsync: false,
      },
    ];

    const workflow: TWorkflowAST = {
      type: "Workflow",
      functionName: "testWorkflow2",
      name: "testWorkflow2",
      sourceFile: "/test/workflow.ts",
      imports: [],
      instances: [
        { type: "NodeInstance", id: "NodeA", nodeType: "NodeTypeA" },
      ],
      connections: [
        { type: "Connection", from: { node: "NodeA", port: "output1" }, to: { node: "Exit", port: "onSuccess" } },
        { type: "Connection", from: { node: "NodeA", port: "output2" }, to: { node: "Exit", port: "onFailure" } },
      ],
      nodeTypes,
      startPorts: { execute: { dataType: "STEP" } },
      exitPorts: { onSuccess: { dataType: "STEP" }, onFailure: { dataType: "STEP" } },
    };

    const code = generateControlFlowWithExecutionContext(workflow, nodeTypes, false, false);

    // Should have separate variables for onSuccess and onFailure
    expect(code).toContain("exit_onSuccess");
    expect(code).toContain("exit_onFailure");

    // Each should be declared only once
    const successMatches = code.match(/const exit_onSuccess/g);
    const failureMatches = code.match(/const exit_onFailure/g);
    expect(successMatches?.length ?? 0).toBe(1);
    expect(failureMatches?.length ?? 0).toBe(1);
  });

  it("should use unknown-typed intermediate variable for single data output to prevent typeof narrowing to never", () => {
    // Expression nodes with a single data output use a typeof check:
    // `typeof result === 'object' && 'key' in result ? result.key : result`
    // When the function returns a primitive (e.g. boolean), TypeScript narrows the
    // true branch to `never`. Using an intermediate `unknown`-typed variable prevents this.
    const nodeTypes: TNodeTypeAST[] = [
      {
        type: "NodeType",
        name: "compare",
        functionName: "compare",
        variant: "FUNCTION",
        expression: true,
        inputs: { a: { dataType: "OBJECT" }, b: { dataType: "OBJECT" } },
        outputs: {
          onSuccess: { dataType: "STEP" },
          onFailure: { dataType: "STEP" },
          result: { dataType: "BOOLEAN" },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: "CONJUNCTION",
        isAsync: false,
      },
    ];

    const workflow: TWorkflowAST = {
      type: "Workflow",
      functionName: "testNarrow",
      name: "testNarrow",
      sourceFile: "/test/workflow.ts",
      imports: [],
      instances: [
        { type: "NodeInstance", id: "cmp", nodeType: "compare" },
      ],
      connections: [
        { type: "Connection", from: { node: "Start", port: "a" }, to: { node: "cmp", port: "a" } },
        { type: "Connection", from: { node: "Start", port: "b" }, to: { node: "cmp", port: "b" } },
        { type: "Connection", from: { node: "cmp", port: "result" }, to: { node: "Exit", port: "result" } },
        { type: "Connection", from: { node: "cmp", port: "onSuccess" }, to: { node: "Exit", port: "onSuccess" } },
      ],
      nodeTypes,
      startPorts: { execute: { dataType: "STEP" }, a: { dataType: "OBJECT" }, b: { dataType: "OBJECT" } },
      exitPorts: { onSuccess: { dataType: "STEP" }, result: { dataType: "BOOLEAN" } },
    };

    const code = generateControlFlowWithExecutionContext(workflow, nodeTypes, false, false);

    // Should have an intermediate unknown-typed variable for the typeof check
    expect(code).toContain("cmpResult_raw: unknown = cmpResult");
    // The typeof check should use the raw variable, not the original result
    expect(code).toContain("typeof cmpResult_raw === 'object'");
    expect(code).not.toMatch(/typeof cmpResult === 'object'/);
  });
});
