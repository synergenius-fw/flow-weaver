/**
 * Tests for execution events with explicit expectations.
 * Verifies that each node emits correct events with proper structure.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";
import {
  TEvent,
  TStatusChangedEvent,
  TVariableSetEvent,
  TWorkflowCompletedEvent,
} from "../../src/runtime/events";

describe("Execution Events", () => {
  const uniqueId = `execution-events-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);
  const testFile = path.join(tempDir, "execution-events-test.ts");
  const outputDir = global.testHelpers?.outputDir || path.join(os.tmpdir(), `flow-weaver-exec-events-output-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    // Cleanup all generated files
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir);
      files.forEach((file) => {
        if (file.startsWith("exec-events-")) {
          fs.unlinkSync(path.join(outputDir, file));
        }
      });
    }
  });

  describe("STATUS_CHANGED events", () => {
    it("should emit STATUS_CHANGED with executionIndex 0 for each node", async () => {
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
 * @name testWorkflow
 * @node double1 double
 * @connect Start.x -> double1.x
 * @connect double1.result -> Exit.result
 */
export async function testWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      fs.writeFileSync(testFile, content);

      const code = await generator.generate(testFile, "testWorkflow", {
        production: false,
      });

      const outputFile = path.join(
        outputDir,
        "exec-events-1.generated.ts"
      );
      fs.writeFileSync(outputFile, code, "utf-8");
      const { testWorkflow } = await import(outputFile);

      const events: TEvent[] = [];
      const mockDebugger = {
        sendEvent: (event: TEvent) => events.push(event),
        innerFlowInvocation: false,
      };

      await testWorkflow(true, { x: 5 }, mockDebugger);

      // Filter STATUS_CHANGED events
      const statusEvents = events.filter(
        (e): e is TStatusChangedEvent => e.type === "STATUS_CHANGED"
      );

      // Start node: should have SUCCEEDED with executionIndex 0
      const startSucceeded = statusEvents.find(
        (e) => e.id === "Start" && e.status === "SUCCEEDED"
      );
      expect(startSucceeded).toEqual(
        expect.objectContaining({
          type: "STATUS_CHANGED",
          id: "Start",
          nodeTypeName: "Start",
          executionIndex: 0,
          status: "SUCCEEDED",
        })
      );

      // double1 node: should have RUNNING and SUCCEEDED with executionIndex 0
      const double1Running = statusEvents.find(
        (e) => e.id === "double1" && e.status === "RUNNING"
      );
      expect(double1Running).toEqual(
        expect.objectContaining({
          type: "STATUS_CHANGED",
          id: "double1",
          nodeTypeName: "double",
          executionIndex: 0,
          status: "RUNNING",
        })
      );

      const double1Succeeded = statusEvents.find(
        (e) => e.id === "double1" && e.status === "SUCCEEDED"
      );
      expect(double1Succeeded).toEqual(
        expect.objectContaining({
          type: "STATUS_CHANGED",
          id: "double1",
          nodeTypeName: "double",
          executionIndex: 0,
          status: "SUCCEEDED",
        })
      );

      // Exit node: should have SUCCEEDED with executionIndex 0
      const exitSucceeded = statusEvents.find(
        (e) => e.id === "Exit" && e.status === "SUCCEEDED"
      );
      expect(exitSucceeded).toEqual(
        expect.objectContaining({
          type: "STATUS_CHANGED",
          id: "Exit",
          nodeTypeName: "Exit",
          executionIndex: 0,
          status: "SUCCEEDED",
        })
      );
    });

    it("should emit events in correct order: Start -> Node (RUNNING -> SUCCEEDED) -> Exit", async () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function triple(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x * 3 };
}

/**
 * @flowWeaver workflow
 * @name orderWorkflow
 * @node triple1 triple
 * @connect Start.x -> triple1.x
 * @connect triple1.result -> Exit.result
 */
export async function orderWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      fs.writeFileSync(testFile, content);

      const code = await generator.generate(testFile, "orderWorkflow", {
        production: false,
      });

      const outputFile = path.join(
        outputDir,
        "exec-events-2.generated.ts"
      );
      fs.writeFileSync(outputFile, code, "utf-8");
      const { orderWorkflow } = await import(outputFile);

      const events: TEvent[] = [];
      const mockDebugger = {
        sendEvent: (event: TEvent) => events.push(event),
        innerFlowInvocation: false,
      };

      await orderWorkflow(true, { x: 3 }, mockDebugger);

      const statusEvents = events.filter(
        (e): e is TStatusChangedEvent => e.type === "STATUS_CHANGED"
      );

      // Find indices
      const startSucceededIdx = statusEvents.findIndex(
        (e) => e.id === "Start" && e.status === "SUCCEEDED"
      );
      const triple1RunningIdx = statusEvents.findIndex(
        (e) => e.id === "triple1" && e.status === "RUNNING"
      );
      const triple1SucceededIdx = statusEvents.findIndex(
        (e) => e.id === "triple1" && e.status === "SUCCEEDED"
      );
      const exitSucceededIdx = statusEvents.findIndex(
        (e) => e.id === "Exit" && e.status === "SUCCEEDED"
      );

      // Verify order
      expect(startSucceededIdx).toBeLessThan(triple1RunningIdx);
      expect(triple1RunningIdx).toBeLessThan(triple1SucceededIdx);
      expect(triple1SucceededIdx).toBeLessThan(exitSucceededIdx);
    });
  });

  describe("VARIABLE_SET events", () => {
    it("should emit VARIABLE_SET for output ports with executionIndex 0", async () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function addTen(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x + 10 };
}

/**
 * @flowWeaver workflow
 * @name varSetWorkflow
 * @node addTen1 addTen
 * @connect Start.x -> addTen1.x
 * @connect addTen1.result -> Exit.result
 */
export async function varSetWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      fs.writeFileSync(testFile, content);

      const code = await generator.generate(testFile, "varSetWorkflow", {
        production: false,
      });

      const outputFile = path.join(
        outputDir,
        "exec-events-3.generated.ts"
      );
      fs.writeFileSync(outputFile, code, "utf-8");
      const { varSetWorkflow } = await import(outputFile);

      const events: TEvent[] = [];
      const mockDebugger = {
        sendEvent: (event: TEvent) => events.push(event),
        innerFlowInvocation: false,
      };

      await varSetWorkflow(true, { x: 5 }, mockDebugger);

      const varSetEvents = events.filter(
        (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
      );

      // Start.x should be set with value 5
      const startXEvent = varSetEvents.find(
        (e) => e.identifier.id === "Start" && e.identifier.portName === "x"
      );
      expect(startXEvent).toEqual(
        expect.objectContaining({
          type: "VARIABLE_SET",
          identifier: expect.objectContaining({
            id: "Start",
            portName: "x",
            executionIndex: 0,
          }),
          value: 5,
        })
      );

      // addTen1.result should be set with value 15
      const addTenResultEvent = varSetEvents.find(
        (e) =>
          e.identifier.id === "addTen1" && e.identifier.portName === "result"
      );
      expect(addTenResultEvent).toEqual(
        expect.objectContaining({
          type: "VARIABLE_SET",
          identifier: expect.objectContaining({
            id: "addTen1",
            nodeTypeName: "addTen",
            portName: "result",
            executionIndex: 0,
          }),
          value: 15,
        })
      );
    });

    it("should emit VARIABLE_SET for input ports with connected values", async () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @output sum
 */
function add(execute: boolean, a: number, b: number) {
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @name inputVarWorkflow
 * @node add1 add
 * @connect Start.a -> add1.a
 * @connect Start.b -> add1.b
 * @connect add1.sum -> Exit.result
 */
export async function inputVarWorkflow(execute: boolean, params: { a: number; b: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      fs.writeFileSync(testFile, content);

      const code = await generator.generate(testFile, "inputVarWorkflow", {
        production: false,
      });

      const outputFile = path.join(
        outputDir,
        "exec-events-4.generated.ts"
      );
      fs.writeFileSync(outputFile, code, "utf-8");
      const { inputVarWorkflow } = await import(outputFile);

      const events: TEvent[] = [];
      const mockDebugger = {
        sendEvent: (event: TEvent) => events.push(event),
        innerFlowInvocation: false,
      };

      await inputVarWorkflow(true, { a: 3, b: 7 }, mockDebugger);

      const varSetEvents = events.filter(
        (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
      );

      // Start.a = 3
      const startAEvent = varSetEvents.find(
        (e) => e.identifier.id === "Start" && e.identifier.portName === "a"
      );
      expect(startAEvent).toEqual(
        expect.objectContaining({
          type: "VARIABLE_SET",
          identifier: expect.objectContaining({
            id: "Start",
            portName: "a",
            executionIndex: 0,
          }),
          value: 3,
        })
      );

      // Start.b = 7
      const startBEvent = varSetEvents.find(
        (e) => e.identifier.id === "Start" && e.identifier.portName === "b"
      );
      expect(startBEvent).toEqual(
        expect.objectContaining({
          type: "VARIABLE_SET",
          identifier: expect.objectContaining({
            id: "Start",
            portName: "b",
            executionIndex: 0,
          }),
          value: 7,
        })
      );

      // add1.sum = 10
      const sumEvent = varSetEvents.find(
        (e) => e.identifier.id === "add1" && e.identifier.portName === "sum"
      );
      expect(sumEvent).toEqual(
        expect.objectContaining({
          type: "VARIABLE_SET",
          identifier: expect.objectContaining({
            id: "add1",
            portName: "sum",
            executionIndex: 0,
          }),
          value: 10,
        })
      );
    });
  });

  describe("WORKFLOW_COMPLETED event", () => {
    it("should emit WORKFLOW_COMPLETED with status SUCCEEDED", async () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function identity(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver workflow
 * @name completedWorkflow
 * @node id1 identity
 * @connect Start.x -> id1.x
 * @connect id1.result -> Exit.result
 */
export async function completedWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      fs.writeFileSync(testFile, content);

      const code = await generator.generate(testFile, "completedWorkflow", {
        production: false,
      });

      const outputFile = path.join(
        outputDir,
        "exec-events-5.generated.ts"
      );
      fs.writeFileSync(outputFile, code, "utf-8");
      const { completedWorkflow } = await import(outputFile);

      const events: TEvent[] = [];
      const mockDebugger = {
        sendEvent: (event: TEvent) => events.push(event),
        innerFlowInvocation: false,
      };

      const result = await completedWorkflow(true, { x: 42 }, mockDebugger);

      // Find WORKFLOW_COMPLETED event
      const completedEvent = events.find(
        (e): e is TWorkflowCompletedEvent => e.type === "WORKFLOW_COMPLETED"
      );

      expect(completedEvent).toEqual(
        expect.objectContaining({
          type: "WORKFLOW_COMPLETED",
          status: "SUCCEEDED",
          executionIndex: 0,
          result: expect.objectContaining({
            result: 42,
            onSuccess: true,
            onFailure: false,
          }),
        })
      );

      // Verify result matches
      expect(result.result).toBe(42);
    });

    it("should emit WORKFLOW_COMPLETED after Exit SUCCEEDED", async () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function passThrough(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver workflow
 * @name orderCheckWorkflow
 * @node pt1 passThrough
 * @connect Start.x -> pt1.x
 * @connect pt1.result -> Exit.result
 */
export async function orderCheckWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      fs.writeFileSync(testFile, content);

      const code = await generator.generate(testFile, "orderCheckWorkflow", {
        production: false,
      });

      const outputFile = path.join(
        outputDir,
        "exec-events-6.generated.ts"
      );
      fs.writeFileSync(outputFile, code, "utf-8");
      const { orderCheckWorkflow } = await import(outputFile);

      const events: TEvent[] = [];
      const mockDebugger = {
        sendEvent: (event: TEvent) => events.push(event),
        innerFlowInvocation: false,
      };

      await orderCheckWorkflow(true, { x: 1 }, mockDebugger);

      const exitSucceededIdx = events.findIndex(
        (e) =>
          e.type === "STATUS_CHANGED" &&
          (e as TStatusChangedEvent).id === "Exit" &&
          (e as TStatusChangedEvent).status === "SUCCEEDED"
      );
      const workflowCompletedIdx = events.findIndex(
        (e) => e.type === "WORKFLOW_COMPLETED"
      );

      expect(exitSucceededIdx).toBeGreaterThan(-1);
      expect(workflowCompletedIdx).toBeGreaterThan(-1);
      expect(exitSucceededIdx).toBeLessThan(workflowCompletedIdx);
    });
  });

  describe("Full event sequence", () => {
    it("should emit complete event sequence for simple workflow", async () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function square(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x * x };
}

/**
 * @flowWeaver workflow
 * @name fullSequenceWorkflow
 * @node sq1 square
 * @connect Start.x -> sq1.x
 * @connect sq1.result -> Exit.result
 */
export async function fullSequenceWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      fs.writeFileSync(testFile, content);

      const code = await generator.generate(testFile, "fullSequenceWorkflow", {
        production: false,
      });

      const outputFile = path.join(
        outputDir,
        "exec-events-7.generated.ts"
      );
      fs.writeFileSync(outputFile, code, "utf-8");
      const { fullSequenceWorkflow } = await import(outputFile);

      const events: TEvent[] = [];
      const mockDebugger = {
        sendEvent: (event: TEvent) => events.push(event),
        innerFlowInvocation: false,
      };

      await fullSequenceWorkflow(true, { x: 4 }, mockDebugger);

      // Log all events for debugging
      // console.log(JSON.stringify(events, null, 2));

      // All executionIndex values should be 0 for single execution
      const statusEvents = events.filter(
        (e): e is TStatusChangedEvent => e.type === "STATUS_CHANGED"
      );
      statusEvents.forEach((e) => {
        expect(e.executionIndex).toBe(0);
      });

      const varSetEvents = events.filter(
        (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
      );
      varSetEvents.forEach((e) => {
        expect(e.identifier.executionIndex).toBe(0);
      });

      // Verify we have the expected events
      expect(statusEvents.length).toBeGreaterThanOrEqual(4); // Start, sq1 RUNNING, sq1 SUCCEEDED, Exit
      expect(varSetEvents.length).toBeGreaterThanOrEqual(2); // Start.x, sq1.result

      // Verify final result event
      const sq1Result = varSetEvents.find(
        (e) => e.identifier.id === "sq1" && e.identifier.portName === "result"
      );
      expect(sq1Result?.value).toBe(16); // 4 * 4
    });
  });
});
