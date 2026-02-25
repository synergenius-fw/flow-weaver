import { describe, it, expect } from 'vitest';
import { computeTraceSummary } from '../../../src/mcp/workflow-executor';
import type { ExecutionTraceEvent } from '../../../src/mcp/workflow-executor';

describe('computeTraceSummary', () => {
  it('returns zeroed summary for empty trace', () => {
    const summary = computeTraceSummary([]);
    expect(summary).toEqual({
      totalNodes: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      nodeTimings: [],
      totalDurationMs: 0,
    });
  });

  it('counts succeeded nodes', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'node1', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 1050, data: { id: 'node1', status: 'SUCCEEDED' } },
      { type: 'STATUS_CHANGED', timestamp: 1010, data: { id: 'node2', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 1080, data: { id: 'node2', status: 'SUCCEEDED' } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.cancelled).toBe(0);
  });

  it('counts failed and cancelled nodes', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'a', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 1100, data: { id: 'a', status: 'FAILED' } },
      { type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'b', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 1200, data: { id: 'b', status: 'CANCELLED' } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.succeeded).toBe(0);
  });

  it('computes per-node timings from RUNNING to terminal status', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'n1', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 1250, data: { id: 'n1', status: 'SUCCEEDED' } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.nodeTimings).toHaveLength(1);
    expect(summary.nodeTimings[0]).toEqual({ nodeId: 'n1', durationMs: 250 });
  });

  it('computes totalDurationMs from first to last event', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 500, data: { id: 'x', status: 'RUNNING' } },
      { type: 'VARIABLE_SET', timestamp: 600, data: { var: 'a' } },
      { type: 'STATUS_CHANGED', timestamp: 800, data: { id: 'x', status: 'SUCCEEDED' } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalDurationMs).toBe(300);
  });

  it('ignores non-STATUS_CHANGED events for node counts', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'VARIABLE_SET', timestamp: 100, data: { var: 'x', value: 1 } },
      { type: 'NODE_STARTED', timestamp: 200, data: { id: 'n1' } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(0);
    expect(summary.nodeTimings).toEqual([]);
    expect(summary.totalDurationMs).toBe(100);
  });

  it('handles STATUS_CHANGED events with missing id or status', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 100, data: { status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 200, data: { id: 'a' } },
      { type: 'STATUS_CHANGED', timestamp: 300, data: undefined },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(0);
    expect(summary.totalDurationMs).toBe(200);
  });

  it('handles node that reaches terminal without RUNNING (no timing)', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 100, data: { id: 'n1', status: 'SUCCEEDED' } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.nodeTimings).toEqual([]);
  });

  it('uses last terminal status for nodes with multiple status changes', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 100, data: { id: 'n1', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 200, data: { id: 'n1', status: 'FAILED' } },
      { type: 'STATUS_CHANGED', timestamp: 300, data: { id: 'n1', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 500, data: { id: 'n1', status: 'SUCCEEDED' } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.nodeTimings).toHaveLength(2);
    expect(summary.nodeTimings[0]).toEqual({ nodeId: 'n1', durationMs: 100 });
    expect(summary.nodeTimings[1]).toEqual({ nodeId: 'n1', durationMs: 200 });
  });

  it('handles a mix of succeeded, failed, and cancelled nodes', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 100, data: { id: 'a', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 200, data: { id: 'b', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 300, data: { id: 'c', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 400, data: { id: 'a', status: 'SUCCEEDED' } },
      { type: 'STATUS_CHANGED', timestamp: 500, data: { id: 'b', status: 'FAILED' } },
      { type: 'STATUS_CHANGED', timestamp: 600, data: { id: 'c', status: 'CANCELLED' } },
    ];

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(3);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.nodeTimings).toHaveLength(3);
    expect(summary.totalDurationMs).toBe(500);
  });

  it('computes timing for a single-event trace', () => {
    const trace: ExecutionTraceEvent[] = [
      { type: 'STATUS_CHANGED', timestamp: 42, data: { id: 'only', status: 'RUNNING' } },
    ];

    const summary = computeTraceSummary(trace);
    // Single event: duration is 0 (first - last = same)
    expect(summary.totalDurationMs).toBe(0);
    expect(summary.totalNodes).toBe(0); // RUNNING is not a terminal status
  });

  it('handles interleaved events from many nodes', () => {
    const trace: ExecutionTraceEvent[] = [];
    for (let i = 0; i < 50; i++) {
      trace.push({ type: 'STATUS_CHANGED', timestamp: i * 10, data: { id: `node-${i}`, status: 'RUNNING' } });
    }
    for (let i = 0; i < 50; i++) {
      trace.push({ type: 'STATUS_CHANGED', timestamp: 500 + i * 10, data: { id: `node-${i}`, status: 'SUCCEEDED' } });
    }

    const summary = computeTraceSummary(trace);
    expect(summary.totalNodes).toBe(50);
    expect(summary.succeeded).toBe(50);
    expect(summary.nodeTimings).toHaveLength(50);
    // First node: started at 0, finished at 500
    expect(summary.nodeTimings[0].durationMs).toBe(500);
    // Last node: started at 490, finished at 990
    expect(summary.nodeTimings[49].durationMs).toBe(500);
  });
});
