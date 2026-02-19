/**
 * Test that unreached branch nodes emit CANCELLED status events
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generator } from '../../src/generator';
import { TEvent, TStatusChangedEvent } from '../../src/runtime/events';

describe('Branch CANCELLED status events', () => {
  const uniqueId = `branch-cancelled-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);
  const testFile = path.join(tempDir, 'branch-cancelled-test.ts');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    global.testHelpers?.cleanupOutput?.('branch-cancelled-success.generated.ts');
    global.testHelpers?.cleanupOutput?.('branch-cancelled-failure.generated.ts');
    global.testHelpers?.cleanupOutput?.('branch-cancelled-index.generated.ts');
    global.testHelpers?.cleanupOutput?.('branch-cancelled-order.generated.ts');
    global.testHelpers?.cleanupOutput?.('branch-cancelled-no-failure.generated.ts');
    global.testHelpers?.cleanupOutput?.('branch-cancelled-throwing.generated.ts');
  });

  it('should emit CANCELLED for failure branch nodes when success path taken', async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function branchingNode(execute: boolean, x: number) {
  // Always succeeds
  return { onSuccess: true, onFailure: false, result: x * 2 };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function successHandler(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x + 100 };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function failureHandler(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x - 100 };
}

/**
 * @flowWeaver workflow
 * @name branchCancelledSuccessWorkflow
 * @node branch1 branchingNode
 * @node onSuccess1 successHandler
 * @node onFailure1 failureHandler
 * @connect Start.x -> branch1.x
 * @connect branch1.onSuccess -> onSuccess1.execute
 * @connect branch1.result -> onSuccess1.x
 * @connect branch1.onFailure -> onFailure1.execute
 * @connect branch1.result -> onFailure1.x
 * @connect onSuccess1.result -> Exit.result
 * @connect onFailure1.result -> Exit.result
 */
export async function branchCancelledSuccessWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, 'branchCancelledSuccessWorkflow', {
      production: false,
    });

    const outputFile = path.join(
      global.testHelpers.outputDir,
      'branch-cancelled-success.generated.ts'
    );
    fs.writeFileSync(outputFile, code, 'utf-8');
    const { branchCancelledSuccessWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await branchCancelledSuccessWorkflow(true, { x: 5 }, mockDebugger);

    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === 'STATUS_CHANGED'
    );

    // onFailure1 should be CANCELLED since success path was taken
    const cancelledEvents = statusEvents.filter((e) => e.status === 'CANCELLED');
    const cancelledIds = cancelledEvents.map((e) => e.id);

    expect(cancelledIds).toContain('onFailure1');
    expect(cancelledIds).not.toContain('onSuccess1');
  });

  it('should emit CANCELLED for success branch nodes when failure path taken', async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function failingNode(execute: boolean, x: number) {
  // Always fails
  return { onSuccess: false, onFailure: true, result: x };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function successHandler2(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x + 100 };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function failureHandler2(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x - 100 };
}

/**
 * @flowWeaver workflow
 * @name branchCancelledFailureWorkflow
 * @node branch1 failingNode
 * @node onSuccess1 successHandler2
 * @node onFailure1 failureHandler2
 * @connect Start.x -> branch1.x
 * @connect branch1.onSuccess -> onSuccess1.execute
 * @connect branch1.result -> onSuccess1.x
 * @connect branch1.onFailure -> onFailure1.execute
 * @connect branch1.result -> onFailure1.x
 * @connect onSuccess1.result -> Exit.result
 * @connect onFailure1.result -> Exit.result
 */
export async function branchCancelledFailureWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, 'branchCancelledFailureWorkflow', {
      production: false,
    });

    const outputFile = path.join(
      global.testHelpers.outputDir,
      'branch-cancelled-failure.generated.ts'
    );
    fs.writeFileSync(outputFile, code, 'utf-8');
    const { branchCancelledFailureWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await branchCancelledFailureWorkflow(true, { x: 5 }, mockDebugger);

    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === 'STATUS_CHANGED'
    );

    // onSuccess1 should be CANCELLED since failure path was taken
    const cancelledEvents = statusEvents.filter((e) => e.status === 'CANCELLED');
    const cancelledIds = cancelledEvents.map((e) => e.id);

    expect(cancelledIds).toContain('onSuccess1');
    expect(cancelledIds).not.toContain('onFailure1');
  });

  it('should emit CANCELLED with executionIndex -1', async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function branchNode3(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function successNode3(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function failureNode3(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver workflow
 * @name branchCancelledIndexWorkflow
 * @node branch1 branchNode3
 * @node onSuccess1 successNode3
 * @node onFailure1 failureNode3
 * @connect Start.x -> branch1.x
 * @connect branch1.onSuccess -> onSuccess1.execute
 * @connect branch1.result -> onSuccess1.x
 * @connect branch1.onFailure -> onFailure1.execute
 * @connect branch1.result -> onFailure1.x
 * @connect onSuccess1.result -> Exit.result
 * @connect onFailure1.result -> Exit.result
 */
export async function branchCancelledIndexWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, 'branchCancelledIndexWorkflow', {
      production: false,
    });

    const outputFile = path.join(
      global.testHelpers.outputDir,
      'branch-cancelled-index.generated.ts'
    );
    fs.writeFileSync(outputFile, code, 'utf-8');
    const { branchCancelledIndexWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await branchCancelledIndexWorkflow(true, { x: 5 }, mockDebugger);

    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === 'STATUS_CHANGED'
    );

    const cancelledEvents = statusEvents.filter((e) => e.status === 'CANCELLED');

    // All CANCELLED events should have valid executionIndex (>= 0)
    // Phase 1 fix: CANCELLED events now get proper indices from addExecution()
    expect(cancelledEvents.length).toBeGreaterThan(0);
    cancelledEvents.forEach((event) => {
      expect(event.executionIndex).toBeGreaterThanOrEqual(0);
    });
  });

  it('should emit CANCELLED immediately after branch decision', async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function branchNode4(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function successNode4(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function failureNode4(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver workflow
 * @name branchCancelledOrderWorkflow
 * @node branch1 branchNode4
 * @node onSuccess1 successNode4
 * @node onFailure1 failureNode4
 * @connect Start.x -> branch1.x
 * @connect branch1.onSuccess -> onSuccess1.execute
 * @connect branch1.result -> onSuccess1.x
 * @connect branch1.onFailure -> onFailure1.execute
 * @connect branch1.result -> onFailure1.x
 * @connect onSuccess1.result -> Exit.result
 * @connect onFailure1.result -> Exit.result
 */
export async function branchCancelledOrderWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, 'branchCancelledOrderWorkflow', {
      production: false,
    });

    const outputFile = path.join(
      global.testHelpers.outputDir,
      'branch-cancelled-order.generated.ts'
    );
    fs.writeFileSync(outputFile, code, 'utf-8');
    const { branchCancelledOrderWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await branchCancelledOrderWorkflow(true, { x: 5 }, mockDebugger);

    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === 'STATUS_CHANGED'
    );

    // Find the index of branch1 SUCCEEDED
    const branch1SucceededIdx = statusEvents.findIndex(
      (e) => e.id === 'branch1' && e.status === 'SUCCEEDED'
    );

    // Find the index of onFailure1 CANCELLED
    const onFailure1CancelledIdx = statusEvents.findIndex(
      (e) => e.id === 'onFailure1' && e.status === 'CANCELLED'
    );

    // Find the index of onSuccess1 RUNNING
    const onSuccess1RunningIdx = statusEvents.findIndex(
      (e) => e.id === 'onSuccess1' && e.status === 'RUNNING'
    );

    expect(branch1SucceededIdx).toBeGreaterThan(-1);
    expect(onFailure1CancelledIdx).toBeGreaterThan(-1);
    expect(onSuccess1RunningIdx).toBeGreaterThan(-1);

    // CANCELLED should come after branch decision and before running the success node
    expect(onFailure1CancelledIdx).toBeGreaterThan(branch1SucceededIdx);
    expect(onFailure1CancelledIdx).toBeLessThan(onSuccess1RunningIdx);
  });

  it('should emit CANCELLED for success nodes when no failure branch exists', async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function alwaysFailsNode(execute: boolean, x: number) {
  // Always fails - no failure branch downstream
  return { onSuccess: false, onFailure: true, result: x };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function successOnlyHandler(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x + 100 };
}

/**
 * @flowWeaver workflow
 * @name noFailureBranchWorkflow
 * @node branch1 alwaysFailsNode
 * @node onSuccess1 successOnlyHandler
 * @connect Start.x -> branch1.x
 * @connect branch1.onSuccess -> onSuccess1.execute
 * @connect branch1.result -> onSuccess1.x
 * @connect branch1.onFailure -> Exit.onFailure
 * @connect onSuccess1.result -> Exit.result
 */
export async function noFailureBranchWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, 'noFailureBranchWorkflow', {
      production: false,
    });

    const outputFile = path.join(
      global.testHelpers.outputDir,
      'branch-cancelled-no-failure.generated.ts'
    );
    fs.writeFileSync(outputFile, code, 'utf-8');
    const { noFailureBranchWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    await noFailureBranchWorkflow(true, { x: 5 }, mockDebugger);

    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === 'STATUS_CHANGED'
    );

    // onSuccess1 should be CANCELLED since failure path was taken (and there's no failure node)
    const cancelledEvents = statusEvents.filter((e) => e.status === 'CANCELLED');
    const cancelledIds = cancelledEvents.map((e) => e.id);

    expect(cancelledIds).toContain('onSuccess1');
  });

  it('should emit CANCELLED for downstream nodes when branching node throws', async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function throwingBranchNode(execute: boolean, x: number) {
  // Always throws - simulates node failure via exception
  throw new Error("Node threw an error");
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function successHandler3(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x + 100 };
}

/**
 * @flowWeaver workflow
 * @name throwingBranchWorkflow
 * @node branch1 throwingBranchNode
 * @node onSuccess1 successHandler3
 * @connect Start.x -> branch1.x
 * @connect branch1.onSuccess -> onSuccess1.execute
 * @connect branch1.result -> onSuccess1.x
 * @connect onSuccess1.result -> Exit.result
 */
export async function throwingBranchWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, 'throwingBranchWorkflow', {
      production: false,
    });

    const outputFile = path.join(
      global.testHelpers.outputDir,
      'branch-cancelled-throwing.generated.ts'
    );
    fs.writeFileSync(outputFile, code, 'utf-8');
    const { throwingBranchWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    // Should throw but we catch it to check events
    try {
      await throwingBranchWorkflow(true, { x: 5 }, mockDebugger);
    } catch (_e) {
      // Expected to throw
    }

    const statusEvents = events.filter(
      (e): e is TStatusChangedEvent => e.type === 'STATUS_CHANGED'
    );

    // branch1 should be FAILED (it threw)
    const failedEvents = statusEvents.filter((e) => e.status === 'FAILED');
    expect(failedEvents.map((e) => e.id)).toContain('branch1');

    // onSuccess1 should be CANCELLED since branch threw before reaching it
    const cancelledEvents = statusEvents.filter((e) => e.status === 'CANCELLED');
    const cancelledIds = cancelledEvents.map((e) => e.id);
    expect(cancelledIds).toContain('onSuccess1');
  });
});
