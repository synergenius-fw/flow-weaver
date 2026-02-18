/**
 * Test that execution indices are per-node, not global.
 * Each node should have its execution index start at 0.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";
import { TEvent, TStatusChangedEvent } from "../../src/runtime/events";

describe("Per-node execution index", () => {
  const uniqueId = `per-node-exec-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);
  const testFile = path.join(tempDir, "per-node-exec-index-test.ts");

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    global.testHelpers?.cleanupOutput?.("per-node-exec-index.generated.ts");
  });

  it("should have execution index 0 for each node's first execution", async () => {
    // Create a simple workflow with Start -> node -> Exit
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

    // Generate code with debugger (non-production mode)
    const code = await generator.generate(testFile, "testWorkflow", {
      production: false,
    });

    // Write and import generated code
    const outputFile = path.join(global.testHelpers.outputDir, "per-node-exec-index.generated.ts");
    fs.writeFileSync(outputFile, code, "utf-8");
    const { testWorkflow } = await import(outputFile);

    // Collect events
    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    // Execute workflow with debugger
    await testWorkflow(true, { x: 5 }, mockDebugger);

    // Get status events only
    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === "STATUS_CHANGED"
    );

    // Get the first SUCCEEDED event for each node (their first execution)
    const startEvent = statusEvents.find((e) => e.id === "Start" && e.status === "SUCCEEDED");
    const double1Event = statusEvents.find((e) => e.id === "double1" && e.status === "SUCCEEDED");
    const exitEvent = statusEvents.find((e) => e.id === "Exit" && e.status === "SUCCEEDED");

    expect(startEvent).toBeDefined();
    expect(double1Event).toBeDefined();
    expect(exitEvent).toBeDefined();

    // CRITICAL: Each node's execution index should be 0 for its first execution
    // NOT a global counter (0, 1, 2)
    expect(startEvent!.executionIndex).toBe(0);
    expect(double1Event!.executionIndex).toBe(0);
    expect(exitEvent!.executionIndex).toBe(0);
  });
});