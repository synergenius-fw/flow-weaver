/**
 * Test that workflows emit STATUS_CHANGED events for all nodes
 * including Start and Exit nodes
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";
import { TEvent, TStatusChangedEvent } from "../../src/runtime/events";

describe("Status events for all nodes", () => {
  const uniqueId = `status-events-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);
  const testFile = path.join(tempDir, "status-events-test.ts");

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    global.testHelpers?.cleanupOutput?.("status-events.generated.ts");
    global.testHelpers?.cleanupOutput?.("status-events-running.generated.ts");
    global.testHelpers?.cleanupOutput?.("status-events-order.generated.ts");
  });

  it("should emit SUCCEEDED status for Start, nodes, and Exit", async () => {
    // Create a simple workflow
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
 * @name simpleWorkflow
 * @node double1 double
 * @connect Start.x -> double1.x
 * @connect double1.result -> Exit.result
 */
export async function simpleWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    // Generate code with debugger (non-production mode)
    const code = await generator.generate(testFile, "simpleWorkflow", {
      production: false,
    });

    // Write and import generated code
    const outputFile = path.join(global.testHelpers.outputDir, "status-events.generated.ts");
    fs.writeFileSync(outputFile, code, "utf-8");
    const { simpleWorkflow } = await import(outputFile);

    // Collect events
    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    // Execute workflow with debugger
    const result = await simpleWorkflow(true, { x: 5 }, mockDebugger);

    // Verify result
    expect(result.result).toBe(10);
    expect(result.onSuccess).toBe(true);

    // Get status events only
    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === "STATUS_CHANGED"
    );

    // Should have SUCCEEDED for: Start, double1, Exit
    const succeededEvents = statusEvents.filter((e) => e.status === "SUCCEEDED");
    const nodeIds = succeededEvents.map((e) => e.id);

    expect(nodeIds).toContain("Start");
    expect(nodeIds).toContain("double1");
    expect(nodeIds).toContain("Exit");
  });

  it("should emit RUNNING and SUCCEEDED status for regular nodes", async () => {
    // Create a simple workflow
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
 * @name runningStatusWorkflow
 * @node triple1 triple
 * @connect Start.x -> triple1.x
 * @connect triple1.result -> Exit.result
 */
export async function runningStatusWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, "runningStatusWorkflow", {
      production: false,
    });

    // Use a unique output file
    const outputFile = path.join(global.testHelpers.outputDir, "status-events-running.generated.ts");
    fs.writeFileSync(outputFile, code, "utf-8");

    const { runningStatusWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await runningStatusWorkflow(true, { x: 4 }, mockDebugger);

    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === "STATUS_CHANGED"
    );

    // triple1 should have both RUNNING and SUCCEEDED
    const triple1Events = statusEvents.filter((e) => e.id === "triple1");
    const triple1Statuses = triple1Events.map((e) => e.status);

    expect(triple1Statuses).toContain("RUNNING");
    expect(triple1Statuses).toContain("SUCCEEDED");
  });

  it("should emit Exit SUCCEEDED before WORKFLOW_COMPLETED", async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function add(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x + 1 };
}

/**
 * @flowWeaver workflow
 * @name orderTestWorkflow
 * @node add1 add
 * @connect Start.x -> add1.x
 * @connect add1.result -> Exit.result
 */
export async function orderTestWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, "orderTestWorkflow", {
      production: false,
    });

    const outputFile = path.join(global.testHelpers.outputDir, "status-events-order.generated.ts");
    fs.writeFileSync(outputFile, code, "utf-8");

    const { orderTestWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await orderTestWorkflow(true, { x: 10 }, mockDebugger);

    // Find indices of Exit SUCCEEDED and WORKFLOW_COMPLETED
    const exitSucceededIndex = events.findIndex(
      (e) => e.type === "STATUS_CHANGED" && (e as TStatusChangedEvent).id === "Exit" && (e as TStatusChangedEvent).status === "SUCCEEDED"
    );
    const workflowCompletedIndex = events.findIndex(
      (e) => e.type === "WORKFLOW_COMPLETED"
    );

    expect(exitSucceededIndex).toBeGreaterThan(-1);
    expect(workflowCompletedIndex).toBeGreaterThan(-1);
    expect(exitSucceededIndex).toBeLessThan(workflowCompletedIndex);
  });
});
