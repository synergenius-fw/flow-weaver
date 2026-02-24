/**
 * Tests for streaming trace event functionality: the onEvent callback path
 * and computeTraceSummary utility.
 */

import {
  computeTraceSummary,
  type ExecutionTraceEvent,
} from '../../src/mcp/workflow-executor';

describe('streaming trace events', () => {
  describe('computeTraceSummary', () => {
    it('returns correct counts from mixed STATUS_CHANGED events', () => {
      const trace: ExecutionTraceEvent[] = [
        { type: 'STATUS_CHANGED', timestamp: 100, data: { type: 'STATUS_CHANGED', id: 'nodeA', status: 'RUNNING', executionIndex: 0 } },
        { type: 'STATUS_CHANGED', timestamp: 120, data: { type: 'STATUS_CHANGED', id: 'nodeA', status: 'SUCCEEDED', executionIndex: 0 } },
        { type: 'STATUS_CHANGED', timestamp: 130, data: { type: 'STATUS_CHANGED', id: 'nodeB', status: 'RUNNING', executionIndex: 0 } },
        { type: 'STATUS_CHANGED', timestamp: 180, data: { type: 'STATUS_CHANGED', id: 'nodeB', status: 'FAILED', executionIndex: 0 } },
        { type: 'STATUS_CHANGED', timestamp: 200, data: { type: 'STATUS_CHANGED', id: 'nodeC', status: 'RUNNING', executionIndex: 0 } },
        { type: 'STATUS_CHANGED', timestamp: 210, data: { type: 'STATUS_CHANGED', id: 'nodeC', status: 'SUCCEEDED', executionIndex: 0 } },
        { type: 'STATUS_CHANGED', timestamp: 220, data: { type: 'STATUS_CHANGED', id: 'nodeD', status: 'RUNNING', executionIndex: 0 } },
        { type: 'STATUS_CHANGED', timestamp: 225, data: { type: 'STATUS_CHANGED', id: 'nodeD', status: 'CANCELLED', executionIndex: 0 } },
      ];

      const summary = computeTraceSummary(trace);

      expect(summary.totalNodes).toBe(4);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.cancelled).toBe(1);
      expect(summary.totalDurationMs).toBe(125); // 225 - 100
    });

    it('handles empty trace', () => {
      const summary = computeTraceSummary([]);

      expect(summary.totalNodes).toBe(0);
      expect(summary.succeeded).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.cancelled).toBe(0);
      expect(summary.nodeTimings).toHaveLength(0);
      expect(summary.totalDurationMs).toBe(0);
    });

    it('computes per-node timings from RUNNING to terminal status', () => {
      const trace: ExecutionTraceEvent[] = [
        { type: 'STATUS_CHANGED', timestamp: 1000, data: { type: 'STATUS_CHANGED', id: 'alpha', status: 'RUNNING', executionIndex: 0 } },
        { type: 'VARIABLE_SET', timestamp: 1010, data: { type: 'VARIABLE_SET', nodeId: 'alpha', name: 'x', value: 42 } },
        { type: 'STATUS_CHANGED', timestamp: 1025, data: { type: 'STATUS_CHANGED', id: 'alpha', status: 'SUCCEEDED', executionIndex: 0 } },
        { type: 'STATUS_CHANGED', timestamp: 1030, data: { type: 'STATUS_CHANGED', id: 'beta', status: 'RUNNING', executionIndex: 0 } },
        { type: 'VARIABLE_SET', timestamp: 1050, data: { type: 'VARIABLE_SET', nodeId: 'beta', name: 'y', value: 99 } },
        { type: 'STATUS_CHANGED', timestamp: 1230, data: { type: 'STATUS_CHANGED', id: 'beta', status: 'SUCCEEDED', executionIndex: 0 } },
      ];

      const summary = computeTraceSummary(trace);

      expect(summary.nodeTimings).toHaveLength(2);

      const alphaTiming = summary.nodeTimings.find(t => t.nodeId === 'alpha');
      expect(alphaTiming).toBeDefined();
      expect(alphaTiming!.durationMs).toBe(25); // 1025 - 1000

      const betaTiming = summary.nodeTimings.find(t => t.nodeId === 'beta');
      expect(betaTiming).toBeDefined();
      expect(betaTiming!.durationMs).toBe(200); // 1230 - 1030
    });
  });

  describe('onEvent callback', () => {
    it('receives events in real-time alongside the trace array', () => {
      // Simulate the executor's sendEvent→onEvent wiring without running a full workflow.
      // This mirrors the exact pattern from executeWorkflowFromFile where the debugger's
      // sendEvent pushes to the trace array and also calls options.onEvent.
      const trace: ExecutionTraceEvent[] = [];
      const streamed: ExecutionTraceEvent[] = [];
      const onEvent = vi.fn((event: ExecutionTraceEvent) => {
        streamed.push(event);
      });

      const debugger_ = {
        sendEvent: (event: Record<string, unknown>) => {
          const traceEvent: ExecutionTraceEvent = {
            type: (event.type as string) || 'UNKNOWN',
            timestamp: Date.now(),
            data: event,
          };
          trace.push(traceEvent);
          onEvent(traceEvent);
        },
        innerFlowInvocation: false,
      };

      // Simulate a node running then succeeding
      debugger_.sendEvent({ type: 'STATUS_CHANGED', id: 'myNode', status: 'RUNNING', executionIndex: 0 });
      debugger_.sendEvent({ type: 'VARIABLE_SET', nodeId: 'myNode', name: 'output', value: 'hello' });
      debugger_.sendEvent({ type: 'STATUS_CHANGED', id: 'myNode', status: 'SUCCEEDED', executionIndex: 0 });

      // Both trace array and onEvent callback should have all 3 events
      expect(trace).toHaveLength(3);
      expect(streamed).toHaveLength(3);
      expect(onEvent).toHaveBeenCalledTimes(3);

      // The exact same object reference is passed to both
      expect(trace[0]).toBe(streamed[0]);
      expect(trace[1]).toBe(streamed[1]);
      expect(trace[2]).toBe(streamed[2]);

      // Verify event types are correct
      expect(streamed[0].type).toBe('STATUS_CHANGED');
      expect(streamed[1].type).toBe('VARIABLE_SET');
      expect(streamed[2].type).toBe('STATUS_CHANGED');

      // The accumulated trace should produce a valid summary
      const summary = computeTraceSummary(trace);
      expect(summary.totalNodes).toBe(1);
      expect(summary.succeeded).toBe(1);
    });
  });
});
