/**
 * Test that scoped INPUT ports emit VARIABLE_SET events
 * These ports receive values from child nodes in a scope
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";
import { TEvent, TVariableSetEvent } from "../../src/runtime/events";

describe("Scoped INPUT port VARIABLE_SET events", () => {
  const outputDir = global.testHelpers?.outputDir || path.join(os.tmpdir(), `flow-weaver-scoped-input-events-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterAll(() => {
    global.testHelpers?.cleanupOutput?.("scoped-input-port-events.generated.ts");
  });

  it("should emit VARIABLE_SET for scoped INPUT ports with scope and side info", async () => {
    const workflowContent = `
/**
 * ForEach node type with scoped ports (async-compatible)
 * @flowWeaver nodeType
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @input success scope:processItem
 * @input failure scope:processItem
 * @input processed scope:processItem
 * @output results
 */
async function forEach(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{
    success: boolean;
    failure: boolean;
    processed: any;
  }>
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: any[] = [];
  for (const item of items) {
    const result = await processItem(true, item);
    results.push(result.processed);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Processor node - doubles the input
 * @flowWeaver nodeType
 * @input item
 * @output processed
 */
function doubleValue(execute: boolean, item: number) {
  if (!execute) return { onSuccess: false, onFailure: false, processed: 0 };
  return { onSuccess: true, onFailure: false, processed: item * 2 };
}

/**
 * @flowWeaver workflow
 * @name testScopedInputEvents
 * @node forEach1 forEach
 * @node doubler doubleValue forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> doubler.item
 * @connect doubler.processed -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export async function testScopedInputEvents(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`.trim();

    const testFile = path.join(outputDir, "scoped-input-port-events-test.ts");
    fs.writeFileSync(testFile, workflowContent);

    // Generate code with debug mode (production: false)
    const generatedCode = await generator.generate(testFile, "testScopedInputEvents", {
      production: false,
    });

    const outputFile = path.join(outputDir, "scoped-input-port-events.generated.ts");
    fs.writeFileSync(outputFile, generatedCode);

    // Import and execute with mock debugger
    // Note: Using import() for ESM compatibility
    const { testScopedInputEvents } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await testScopedInputEvents(true, { items: [1, 2, 3] }, mockDebugger);

    // Filter VARIABLE_SET events
    const variableSetEvents = events.filter(
      (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
    );

    // There should be VARIABLE_SET events for forEach1.processed (scoped INPUT)
    // Each iteration should emit one event with scope and side info
    const scopedInputEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "forEach1" && e.identifier.portName === "processed"
    );

    // Should have 3 events (one per iteration)
    expect(scopedInputEvents.length).toBe(3);

    // Each event should have scope and side info
    scopedInputEvents.forEach((event, idx) => {
      expect(event.identifier.scope).toBe("processItem");
      expect(event.identifier.side).toBe("exit");
      // Values should be 2, 4, 6 (doubled)
      expect(event.value).toBe((idx + 1) * 2);
    });

    // Verify success/failure scoped INPUT ports emit VARIABLE_SET events
    const successEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "forEach1" && e.identifier.portName === "success"
    );
    expect(successEvents.length).toBe(3); // One per iteration
    successEvents.forEach((event) => {
      expect(event.identifier.scope).toBe("processItem");
      expect(event.identifier.side).toBe("exit");
      expect(event.value).toBe(true);
    });

    // CRITICAL: Each iteration must have a UNIQUE execution index so UI shows 3 executions
    const successExecIndices = successEvents.map(e => e.identifier.executionIndex);
    const uniqueSuccessIndices = new Set(successExecIndices);
    expect(uniqueSuccessIndices.size).toBe(3); // All 3 indices must be different

    const failureEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "forEach1" && e.identifier.portName === "failure"
    );
    expect(failureEvents.length).toBe(3); // One per iteration
    failureEvents.forEach((event) => {
      expect(event.identifier.scope).toBe("processItem");
      expect(event.identifier.side).toBe("exit");
      expect(event.value).toBe(false);
    });

    // CRITICAL: Each iteration must have a UNIQUE execution index so UI shows 3 executions
    const failureExecIndices = failureEvents.map(e => e.identifier.executionIndex);
    const uniqueFailureIndices = new Set(failureExecIndices);
    expect(uniqueFailureIndices.size).toBe(3); // All 3 indices must be different
  });

  it("should emit VARIABLE_SET for child INPUT ports receiving from parent scoped OUTPUT", async () => {
    const workflowContent = `
/**
 * Iterator node with scoped callback
 * @flowWeaver nodeType
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @input success scope:processItem
 * @input result scope:processItem
 * @output results
 */
async function iterator(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{
    success: boolean;
    result: any;
  }>
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: any[] = [];
  for (const item of items) {
    const r = await processItem(true, item);
    results.push(r.result);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Processor node - receives item from parent scope
 * @flowWeaver nodeType
 * @input item
 * @output result
 */
function processor(execute: boolean, item: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: item + 10 };
}

/**
 * @flowWeaver workflow
 * @name testChildInputEvents
 * @node iterator iterator
 * @node processor processor iterator.processItem
 * @connect Start.items -> iterator.items
 * @connect iterator.item:processItem -> processor.item
 * @connect processor.result -> iterator.result:processItem
 * @connect iterator.results -> Exit.results
 */
export async function testChildInputEvents(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`.trim();

    const testFile = path.join(outputDir, "child-input-port-events-test.ts");
    fs.writeFileSync(testFile, workflowContent);

    // Generate code with debug mode (production: false)
    const generatedCode = await generator.generate(testFile, "testChildInputEvents", {
      production: false,
    });

    const outputFile = path.join(outputDir, "child-input-port-events.generated.ts");
    fs.writeFileSync(outputFile, generatedCode);

    // Import and execute with mock debugger
    // Note: Using import() for ESM compatibility
    const { testChildInputEvents } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await testChildInputEvents(true, { items: [1, 2, 3] }, mockDebugger);

    // Filter VARIABLE_SET events
    const variableSetEvents = events.filter(
      (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
    );

    // There should be VARIABLE_SET events for processor.item (child INPUT receiving from parent scoped OUTPUT)
    // Each iteration should emit one event
    const childInputEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "processor" && e.identifier.portName === "item"
    );

    // Should have 3 events (one per iteration)
    expect(childInputEvents.length).toBe(3);

    // Each event should have the correct value (1, 2, 3)
    childInputEvents.forEach((event, idx) => {
      expect(event.value).toBe(idx + 1);
    });

    // Also verify parent scoped OUTPUT port events (iterator.item)
    const parentScopedOutputEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "iterator" && e.identifier.portName === "item"
    );
    expect(parentScopedOutputEvents.length).toBe(3);
    parentScopedOutputEvents.forEach((event, idx) => {
      expect(event.identifier.scope).toBe("processItem");
      expect(event.identifier.side).toBe("start");
      expect(event.value).toBe(idx + 1);
    });

    // Verify child regular OUTPUT port (processor.result)
    const childOutputEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "processor" && e.identifier.portName === "result"
    );
    expect(childOutputEvents.length).toBe(3);
    childOutputEvents.forEach((event, idx) => {
      expect(event.value).toBe(idx + 1 + 10); // processor adds 10
    });
  });

  it("should emit VARIABLE_SET for child OUTPUT ports including onSuccess and onFailure", async () => {
    const workflowContent = `
/**
 * Iterator node with scoped callback
 * @flowWeaver nodeType
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @input success scope:processItem
 * @input failure scope:processItem
 * @input result scope:processItem
 * @output results
 */
async function iterator(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{
    success: boolean;
    failure: boolean;
    result: any;
  }>
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: any[] = [];
  for (const item of items) {
    const r = await processItem(true, item);
    results.push(r.result);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Processor node - has onSuccess, onFailure, and result outputs
 * @flowWeaver nodeType
 * @input item
 * @output result
 */
function processor(execute: boolean, item: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: item + 10 };
}

/**
 * @flowWeaver workflow
 * @name testChildOutputEvents
 * @node iterator iterator
 * @node processor processor iterator.processItem
 * @connect Start.items -> iterator.items
 * @connect iterator.item:processItem -> processor.item
 * @connect processor.result -> iterator.result:processItem
 * @connect processor.onSuccess -> iterator.success:processItem
 * @connect processor.onFailure -> iterator.failure:processItem
 * @connect iterator.results -> Exit.results
 */
export async function testChildOutputEvents(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`.trim();

    const testFile = path.join(outputDir, "child-output-port-events-test.ts");
    fs.writeFileSync(testFile, workflowContent);

    // Generate code with debug mode (production: false)
    const generatedCode = await generator.generate(testFile, "testChildOutputEvents", {
      production: false,
    });

    const outputFile = path.join(outputDir, "child-output-port-events.generated.ts");
    fs.writeFileSync(outputFile, generatedCode);

    // Import and execute with mock debugger
    // Note: Using import() for ESM compatibility
    const { testChildOutputEvents } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await testChildOutputEvents(true, { items: [1, 2, 3] }, mockDebugger);

    // Filter VARIABLE_SET events
    const variableSetEvents = events.filter(
      (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
    );

    // There should be VARIABLE_SET events for processor.onSuccess (child OUTPUT)
    const onSuccessEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "processor" && e.identifier.portName === "onSuccess"
    );

    // Should have 3 events (one per iteration)
    expect(onSuccessEvents.length).toBe(3);

    // Each event should have value true
    onSuccessEvents.forEach((event) => {
      expect(event.value).toBe(true);
    });

    // There should be VARIABLE_SET events for processor.onFailure (child OUTPUT)
    const onFailureEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "processor" && e.identifier.portName === "onFailure"
    );

    // Should have 3 events (one per iteration)
    expect(onFailureEvents.length).toBe(3);

    // Each event should have value false
    onFailureEvents.forEach((event) => {
      expect(event.value).toBe(false);
    });
  });

  it("should NOT emit scoped INPUT port events in production mode", async () => {
    const workflowContent = `
/**
 * Iterator with scoped callback
 * @flowWeaver nodeType
 * @input items
 * @output item scope:process
 * @input success scope:process
 * @input result scope:process
 * @output results
 */
async function iter(
  execute: boolean,
  items: any[],
  process: (item: any) => Promise<{ success: boolean; result: any }>
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: any[] = [];
  for (const item of items) {
    const r = await process(item);
    results.push(r.result);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input item
 * @output result
 */
function proc(execute: boolean, item: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: item * 2 };
}

/**
 * @flowWeaver workflow
 * @name testProductionMode
 * @node iter iter
 * @node proc proc iter.process
 * @connect Start.items -> iter.items
 * @connect iter.item:process -> proc.item
 * @connect proc.result -> iter.result:process
 * @connect iter.results -> Exit.results
 */
export async function testProductionMode(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`.trim();

    const testFile = path.join(outputDir, "production-mode-test.ts");
    fs.writeFileSync(testFile, workflowContent);

    // Generate code with PRODUCTION mode (production: true)
    const generatedCode = await generator.generate(testFile, "testProductionMode", {
      production: true,
    });

    const outputFile = path.join(outputDir, "production-mode.generated.ts");
    fs.writeFileSync(outputFile, generatedCode);

    // Import and execute
    // Note: Using import() for ESM compatibility
    const { testProductionMode } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await testProductionMode(true, { items: [1, 2, 3] }, mockDebugger);

    // In production mode, we should NOT have VARIABLE_SET events for scoped INPUT ports
    const variableSetEvents = events.filter(
      (e): e is TVariableSetEvent => e.type === "VARIABLE_SET"
    );

    // Specifically, no events for iter.success, iter.failure, iter.result (scoped INPUT exit ports)
    const scopedInputEvents = variableSetEvents.filter(
      (e) => e.identifier.id === "iter" &&
             e.identifier.scope === "process" &&
             e.identifier.side === "exit"
    );
    expect(scopedInputEvents.length).toBe(0);
  });
});
