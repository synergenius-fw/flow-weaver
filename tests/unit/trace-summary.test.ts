/**
 * Tests for execution trace summary computation.
 * The summary provides a concise overview of workflow execution from raw trace events.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  computeTraceSummary,
  type ExecutionTraceEvent,
} from '../../src/mcp/workflow-executor';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

describe('computeTraceSummary', () => {
  it('should count succeeded/failed/cancelled nodes', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 1000, data: { type: 'STATUS_CHANGED', id: 'a', status: 'RUNNING', executionIndex: 0 } },
      { type: 'STATUS_CHANGED', timestamp: 1010, data: { type: 'STATUS_CHANGED', id: 'a', status: 'SUCCEEDED', executionIndex: 0 } },
      { type: 'STATUS_CHANGED', timestamp: 1020, data: { type: 'STATUS_CHANGED', id: 'b', status: 'RUNNING', executionIndex: 0 } },
      { type: 'STATUS_CHANGED', timestamp: 1030, data: { type: 'STATUS_CHANGED', id: 'b', status: 'FAILED', executionIndex: 0 } },
      { type: 'STATUS_CHANGED', timestamp: 1040, data: { type: 'STATUS_CHANGED', id: 'c', status: 'RUNNING', executionIndex: 0 } },
      { type: 'STATUS_CHANGED', timestamp: 1050, data: { type: 'STATUS_CHANGED', id: 'c', status: 'CANCELLED', executionIndex: 0 } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(3);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.cancelled).toBe(1);
  });

  it('should include per-node timing', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 1000, data: { type: 'STATUS_CHANGED', id: 'fast', status: 'RUNNING', executionIndex: 0 } },
      { type: 'STATUS_CHANGED', timestamp: 1005, data: { type: 'STATUS_CHANGED', id: 'fast', status: 'SUCCEEDED', executionIndex: 0 } },
      { type: 'STATUS_CHANGED', timestamp: 1010, data: { type: 'STATUS_CHANGED', id: 'slow', status: 'RUNNING', executionIndex: 0 } },
      { type: 'STATUS_CHANGED', timestamp: 1110, data: { type: 'STATUS_CHANGED', id: 'slow', status: 'SUCCEEDED', executionIndex: 0 } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.nodeTimings).toHaveLength(2);

    const fastTiming = summary.nodeTimings.find((t) => t.nodeId === 'fast');
    expect(fastTiming).toBeDefined();
    expect(fastTiming!.durationMs).toBe(5);

    const slowTiming = summary.nodeTimings.find((t) => t.nodeId === 'slow');
    expect(slowTiming).toBeDefined();
    expect(slowTiming!.durationMs).toBe(100);
  });

  it('should handle empty trace', () => {
    const summary = computeTraceSummary([]);
    expect(summary.totalNodes).toBe(0);
    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.cancelled).toBe(0);
    expect(summary.nodeTimings).toHaveLength(0);
    expect(summary.totalDurationMs).toBe(0);
  });

  it('should compute total duration from first to last event', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 5000, data: { type: 'STATUS_CHANGED', id: 'a', status: 'RUNNING', executionIndex: 0 } },
      { type: 'VARIABLE_SET', timestamp: 5050, data: { type: 'VARIABLE_SET' } },
      { type: 'STATUS_CHANGED', timestamp: 5200, data: { type: 'STATUS_CHANGED', id: 'a', status: 'SUCCEEDED', executionIndex: 0 } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalDurationMs).toBe(200);
  });

  it('should skip non-STATUS_CHANGED events when counting nodes', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 1000, data: { type: 'STATUS_CHANGED', id: 'a', status: 'RUNNING', executionIndex: 0 } },
      { type: 'VARIABLE_SET', timestamp: 1005, data: { type: 'VARIABLE_SET' } },
      { type: 'VARIABLE_SET', timestamp: 1008, data: { type: 'VARIABLE_SET' } },
      { type: 'STATUS_CHANGED', timestamp: 1010, data: { type: 'STATUS_CHANGED', id: 'a', status: 'SUCCEEDED', executionIndex: 0 } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(1);
    expect(summary.succeeded).toBe(1);
  });

  it('should be included in ExecuteWorkflowResult when trace is enabled', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function doubleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} doubled - Doubled value
 * @node d doubleIt
 * @connect Start.num -> d.value
 * @connect d.doubled -> Exit.doubled
 */
export async function simpleWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'trace-summary-integration.ts');
    fs.writeFileSync(testFile, source);

    try {
      const result = await executeWorkflowFromFile(testFile, { num: 5 }, {
        workflowName: 'simpleWorkflow',
        includeTrace: true,
      });

      expect(result.summary).toBeDefined();
      expect(result.summary!.totalNodes).toBeGreaterThan(0);
      expect(result.summary!.succeeded).toBeGreaterThan(0);
      expect(result.summary!.failed).toBe(0);
      expect(result.summary!.nodeTimings.length).toBeGreaterThan(0);
      expect(result.summary!.totalDurationMs).toBeGreaterThanOrEqual(0);
    } finally {
      fs.unlinkSync(testFile);
    }
  });
});
