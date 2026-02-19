/**
 * Test that workflows emit VARIABLE_SET events for input ports
 * including ports with constant expressions and default values
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";
import { generateCode } from "../../src/api/generate";
import { TEvent, TVariableSetEvent } from "../../src/runtime/events";
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST } from "../../src/ast/types";

describe("Input port VARIABLE_SET events", () => {
  const uniqueId = `input-port-events-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);
  const testFile = path.join(tempDir, "input-port-events-test.ts");

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    global.testHelpers?.cleanupOutput?.("input-port-connected.generated.ts");
    global.testHelpers?.cleanupOutput?.("input-port-default.generated.ts");
    global.testHelpers?.cleanupOutput?.("input-port-constant.generated.ts");
  });

  it("should emit VARIABLE_SET for input ports with connections", async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function double(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x * 2 };
}

/**
 * @flowWeaver workflow
 * @name connectedInputWorkflow
 * @node double1 double
 * @connect Start.x -> double1.x
 * @connect double1.result -> Exit.result
 */
export async function connectedInputWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, "connectedInputWorkflow", {
      production: false,
    });

    const outputFile = path.join(global.testHelpers.outputDir, "input-port-connected.generated.ts");
    fs.writeFileSync(outputFile, code, "utf-8");
    const { connectedInputWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await connectedInputWorkflow(true, { x: 5 }, mockDebugger);

    const variableSetEvents = events.filter(
      (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
    );

    // Should have VARIABLE_SET for double1.x (input port)
    const inputEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "double1" && e.identifier.portName === "x"
    );

    expect(inputEvents.length).toBeGreaterThan(0);
    expect(inputEvents[0].value).toBe(5);
  });

  it("should emit VARIABLE_SET for input ports with default values", async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input [x=10]
 * @output result
 */
function withDefault(execute: boolean, x: number = 10) {
  return { onSuccess: true, onFailure: false, result: x * 2 };
}

/**
 * @flowWeaver workflow
 * @name defaultInputWorkflow
 * @node withDefault1 withDefault
 * @connect withDefault1.result -> Exit.result
 */
export async function defaultInputWorkflow(execute: boolean, params: {}): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, "defaultInputWorkflow", {
      production: false,
    });

    const outputFile = path.join(global.testHelpers.outputDir, "input-port-default.generated.ts");
    fs.writeFileSync(outputFile, code, "utf-8");
    const { defaultInputWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await defaultInputWorkflow(true, {}, mockDebugger);

    const variableSetEvents = events.filter(
      (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
    );

    // Should have VARIABLE_SET for withDefault1.x using default value
    const inputEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "withDefault1" && e.identifier.portName === "x"
    );

    expect(inputEvents.length).toBeGreaterThan(0);
    expect(inputEvents[0].value).toBe(10);
  });

  it("should emit VARIABLE_SET for input ports with constant expressions at instance level", async () => {
    // Build the AST programmatically for instance-level constant
    const nodeType: TNodeTypeAST = {
      type: "NodeType",
      name: "multiply",
      functionName: "multiply",
      inputs: { x: { dataType: "NUMBER" } },
      outputs: { result: { dataType: "NUMBER" } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: "CONJUNCTION",
    };

    const instance: TNodeInstanceAST = {
      type: "NodeInstance",
      id: "multiply1",
      nodeType: "multiply",
      config: {
        portConfigs: [
          {
            portName: "x",
            direction: "INPUT",
            expression: "42",
          },
        ],
      },
    };

    const workflow: TWorkflowAST = {
      type: "Workflow",
      name: "constantInputWorkflow",
      functionName: "constantInputWorkflow",
      sourceFile: "test.ts",
      nodeTypes: [nodeType],
      instances: [instance],
      connections: [
        {
          type: "Connection",
          from: { node: "multiply1", port: "result" },
          to: { node: "Exit", port: "result" },
        },
      ],
      scopes: {},
      startPorts: {},
      exitPorts: { result: { dataType: "NUMBER" } },
      imports: [],
    };

    // Generate code with debug mode
    const code = generateCode(workflow, { production: false });

    // Add the multiply function definition
    const fullCode = `
function multiply(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x * 3 };
}

${code}
`;

    const outputFile = path.join(global.testHelpers.outputDir, "input-port-constant.generated.ts");
    fs.writeFileSync(outputFile, fullCode, "utf-8");
    const { constantInputWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    const result = await constantInputWorkflow(true, {}, mockDebugger);

    // Result should be 42 * 3 = 126
    expect(result.result).toBe(126);

    const variableSetEvents = events.filter(
      (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
    );

    // Should have VARIABLE_SET for multiply1.x with constant value 42
    const inputEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "multiply1" && e.identifier.portName === "x"
    );

    expect(inputEvents.length).toBeGreaterThan(0);
    expect(inputEvents[0].value).toBe(42);
  });
});
