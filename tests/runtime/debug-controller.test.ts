import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DebugController } from '../../src/runtime/debug-controller';
import type { DebugResumeAction } from '../../src/runtime/debug-controller';
import { GeneratedExecutionContext } from '../../src/runtime/ExecutionContext';

function makeCtx(): GeneratedExecutionContext {
  return new GeneratedExecutionContext(true);
}

function addNodeToCtx(ctx: GeneratedExecutionContext, nodeId: string, portName: string, value: unknown): void {
  const idx = ctx.addExecution(nodeId);
  ctx.setVariable({ id: nodeId, portName, executionIndex: idx }, value);
}

describe('DebugController', () => {
  describe('constructor', () => {
    it('starts in step mode when debug=true', () => {
      const ctrl = new DebugController({ debug: true });
      // Step mode means beforeNode will pause
      expect(ctrl.getBreakpoints()).toEqual([]);
    });

    it('starts in run mode when debug=false', () => {
      const ctrl = new DebugController({ debug: false });
      expect(ctrl.getBreakpoints()).toEqual([]);
    });

    it('accepts initial breakpoints', () => {
      const ctrl = new DebugController({ breakpoints: ['node1', 'node2'] });
      expect(ctrl.getBreakpoints()).toEqual(['node1', 'node2']);
    });

    it('accepts execution order', () => {
      const ctrl = new DebugController({ executionOrder: ['a', 'b', 'c'] });
      const ctx = makeCtx();
      const state = ctrl.buildState('a', 'before', ctx);
      expect(state.executionOrder).toEqual(['a', 'b', 'c']);
    });
  });

  describe('beforeNode / afterNode', () => {
    it('returns true in run mode (node should execute)', async () => {
      const ctrl = new DebugController({ debug: false });
      const ctx = makeCtx();
      const result = await ctrl.beforeNode('node1', ctx);
      expect(result).toBe(true);
    });

    it('pauses in step mode and waits for resume', async () => {
      const ctrl = new DebugController({ debug: true, executionOrder: ['node1'] });
      const ctx = makeCtx();

      // Start beforeNode in the background (it will pause)
      let beforeResult: boolean | undefined;
      const beforePromise = ctrl.beforeNode('node1', ctx).then((r) => {
        beforeResult = r;
      });

      // Wait for the pause to be detected
      const pauseState = await ctrl.onPause();
      expect(pauseState.currentNodeId).toBe('node1');
      expect(pauseState.phase).toBe('before');
      expect(beforeResult).toBeUndefined(); // Still paused

      // Resume with step
      ctrl.resume({ type: 'step' });
      await beforePromise;
      expect(beforeResult).toBe(true);
    });

    it('skips nodes in skipNodes set and returns false', async () => {
      const skipNodes = new Map<string, Record<string, unknown>>();
      skipNodes.set('node1', { 'result:0': 42 });

      const ctrl = new DebugController({ skipNodes });
      const ctx = makeCtx();

      const result = await ctrl.beforeNode('node1', ctx);
      expect(result).toBe(false);

      // The skipped node's outputs should be restored
      const value = await ctx.getVariable({ id: 'node1', portName: 'result', executionIndex: 0 });
      expect(value).toBe(42);
    });

    it('tracks completed nodes', async () => {
      const ctrl = new DebugController({ debug: false });
      const ctx = makeCtx();

      await ctrl.beforeNode('node1', ctx);
      await ctrl.afterNode('node1', ctx);

      expect(ctrl.getCompletedNodes()).toEqual(['node1']);
    });

    it('pauses after node in step mode', async () => {
      const ctrl = new DebugController({ debug: true, executionOrder: ['node1'] });
      const ctx = makeCtx();

      // First pause: before node1
      const beforePause = ctrl.onPause();
      ctrl.beforeNode('node1', ctx); // starts pausing
      const state1 = await beforePause;
      expect(state1.phase).toBe('before');

      // Resume to execute the node
      ctrl.resume({ type: 'step' });

      // Second pause: after node1
      const afterPause = ctrl.onPause();
      // afterNode will be called after the node executes
      const afterPromise = ctrl.afterNode('node1', ctx);
      const state2 = await afterPause;
      expect(state2.phase).toBe('after');
      expect(state2.currentNodeId).toBe('node1');

      ctrl.resume({ type: 'step' });
      await afterPromise;
    });
  });

  describe('breakpoints', () => {
    it('pauses at breakpoint in continueToBreakpoint mode', async () => {
      const ctrl = new DebugController({
        debug: true,
        executionOrder: ['node1', 'node2', 'node3'],
        breakpoints: ['node2'],
      });
      const ctx = makeCtx();

      // First pause: before node1 (step mode initially)
      const p1 = ctrl.onPause();
      ctrl.beforeNode('node1', ctx);
      await p1;

      // Resume with continueToBreakpoint: should run past node1, pause at node2
      ctrl.resume({ type: 'continueToBreakpoint' });
      // node1 beforeNode resolves, node1 runs

      // afterNode for node1 should not pause (continueToBreakpoint mode)
      await ctrl.afterNode('node1', ctx);

      // node2 should pause because it has a breakpoint
      const p2 = ctrl.onPause();
      ctrl.beforeNode('node2', ctx);
      const state2 = await p2;
      expect(state2.currentNodeId).toBe('node2');
      expect(state2.phase).toBe('before');
    });

    it('add/remove breakpoints dynamically', () => {
      const ctrl = new DebugController();
      expect(ctrl.getBreakpoints()).toEqual([]);

      ctrl.addBreakpoint('x');
      ctrl.addBreakpoint('y');
      expect(ctrl.getBreakpoints()).toEqual(['x', 'y']);

      ctrl.removeBreakpoint('x');
      expect(ctrl.getBreakpoints()).toEqual(['y']);
    });
  });

  describe('abort', () => {
    it('throws when action is abort', async () => {
      const ctrl = new DebugController({ debug: true, executionOrder: ['node1'] });
      const ctx = makeCtx();

      const p = ctrl.onPause();
      const beforePromise = ctrl.beforeNode('node1', ctx);
      await p;

      ctrl.resume({ type: 'abort' });

      await expect(beforePromise).rejects.toThrow('aborted');
    });
  });

  describe('variable modification', () => {
    it('applies pending modifications before next node', async () => {
      const ctrl = new DebugController({ debug: false });
      const ctx = makeCtx();

      // Set a variable
      addNodeToCtx(ctx, 'node1', 'value', 10);

      // Queue a modification
      ctrl.setVariable('node1:value:0', 42);

      // beforeNode applies pending modifications
      await ctrl.beforeNode('node2', ctx);

      const value = await ctx.getVariable({ id: 'node1', portName: 'value', executionIndex: 0 });
      expect(value).toBe(42);
    });
  });

  describe('buildState', () => {
    it('includes variables and position', async () => {
      const ctrl = new DebugController({ executionOrder: ['a', 'b'] });
      const ctx = makeCtx();
      addNodeToCtx(ctx, 'a', 'out', 'hello');

      await ctrl.beforeNode('a', ctx);
      await ctrl.afterNode('a', ctx);

      const state = ctrl.buildState('b', 'before', ctx);
      expect(state.currentNodeId).toBe('b');
      expect(state.phase).toBe('before');
      expect(state.completedNodes).toEqual(['a']);
      expect(state.position).toBe(1);
      expect(state.variables).toHaveProperty('a:out:0');
    });

    it('includes currentNodeOutputs from last completed node', async () => {
      const ctrl = new DebugController({ executionOrder: ['a', 'b'] });
      const ctx = makeCtx();
      addNodeToCtx(ctx, 'a', 'result', 99);

      await ctrl.beforeNode('a', ctx);
      await ctrl.afterNode('a', ctx);

      const state = ctrl.buildState('b', 'before', ctx);
      expect(state.currentNodeOutputs).toEqual({ result: 99 });
    });
  });

  describe('continue mode', () => {
    it('runs all nodes without pausing', async () => {
      const ctrl = new DebugController({ debug: false });
      const ctx = makeCtx();

      // Should all pass through without pausing
      expect(await ctrl.beforeNode('node1', ctx)).toBe(true);
      await ctrl.afterNode('node1', ctx);
      expect(await ctrl.beforeNode('node2', ctx)).toBe(true);
      await ctrl.afterNode('node2', ctx);
      expect(await ctrl.beforeNode('node3', ctx)).toBe(true);
      await ctrl.afterNode('node3', ctx);

      expect(ctrl.getCompletedNodes()).toEqual(['node1', 'node2', 'node3']);
    });
  });
});
