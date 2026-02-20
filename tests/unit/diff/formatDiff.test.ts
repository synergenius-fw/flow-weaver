/**
 * formatDiff tests
 */

import { describe, it, expect } from 'vitest';
import { formatDiff } from '../../../src/diff/formatDiff.js';
import type { TWorkflowDiff } from '../../../src/diff/types.js';

// Helper to create minimal diff
function createDiff(overrides: Partial<TWorkflowDiff> = {}): TWorkflowDiff {
  return {
    identical: false,
    impact: 'MINOR',
    summary: {
      nodeTypesAdded: 0,
      nodeTypesRemoved: 0,
      nodeTypesModified: 0,
      instancesAdded: 0,
      instancesRemoved: 0,
      instancesModified: 0,
      instancesUIModified: 0,
      connectionsAdded: 0,
      connectionsRemoved: 0,
    },
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: { added: [], removed: [], modified: [] },
    exitPorts: { added: [], removed: [], modified: [] },
    scopes: [],
    ...overrides,
  };
}

describe('formatDiff', () => {
  describe('json format', () => {
    it('should return valid JSON', () => {
      const diff = createDiff();
      const output = formatDiff(diff, 'json');
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should include all diff fields', () => {
      const diff = createDiff({ impact: 'BREAKING' });
      const output = formatDiff(diff, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.impact).toBe('BREAKING');
      expect(parsed.identical).toBe(false);
      expect(parsed.summary).toBeDefined();
    });
  });

  describe('compact format', () => {
    it('should return "No changes" for identical diffs', () => {
      const diff = createDiff({ identical: true });
      const output = formatDiff(diff, 'compact');
      expect(output).toBe('No changes');
    });

    it('should include impact level', () => {
      const diff = createDiff({ impact: 'CRITICAL' });
      const output = formatDiff(diff, 'compact');
      expect(output).toContain('[CRITICAL]');
    });

    it('should show added types count', () => {
      const diff = createDiff({
        summary: { ...createDiff().summary, nodeTypesAdded: 3 },
      });
      const output = formatDiff(diff, 'compact');
      expect(output).toContain('+3 types');
    });

    it('should show removed types count', () => {
      const diff = createDiff({
        summary: { ...createDiff().summary, nodeTypesRemoved: 2 },
      });
      const output = formatDiff(diff, 'compact');
      expect(output).toContain('-2 types');
    });

    it('should show modified types count', () => {
      const diff = createDiff({
        summary: { ...createDiff().summary, nodeTypesModified: 1 },
      });
      const output = formatDiff(diff, 'compact');
      expect(output).toContain('~1 types');
    });

    it('should show node counts', () => {
      const diff = createDiff({
        summary: {
          ...createDiff().summary,
          instancesAdded: 2,
          instancesRemoved: 1,
          instancesModified: 3,
        },
      });
      const output = formatDiff(diff, 'compact');
      expect(output).toContain('+2 nodes');
      expect(output).toContain('-1 nodes');
      expect(output).toContain('~3 nodes');
    });

    it('should show connection counts', () => {
      const diff = createDiff({
        summary: {
          ...createDiff().summary,
          connectionsAdded: 5,
          connectionsRemoved: 2,
        },
      });
      const output = formatDiff(diff, 'compact');
      expect(output).toContain('+5 conns');
      expect(output).toContain('-2 conns');
    });
  });

  describe('text format', () => {
    it('should include header with impact', () => {
      const diff = createDiff({ impact: 'BREAKING' });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('WORKFLOW DIFF');
      expect(output).toContain('Impact: BREAKING');
    });

    it('should show identical message for identical diffs', () => {
      const diff = createDiff({ identical: true });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('semantically identical');
    });

    it('should include summary section', () => {
      const diff = createDiff({
        summary: {
          nodeTypesAdded: 1,
          nodeTypesRemoved: 2,
          nodeTypesModified: 3,
          instancesAdded: 4,
          instancesRemoved: 5,
          instancesModified: 6,
          instancesUIModified: 0,
          connectionsAdded: 7,
          connectionsRemoved: 8,
        },
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('SUMMARY');
      expect(output).toContain('+1 added');
      expect(output).toContain('-2 removed');
    });

    it('should list node type changes', () => {
      const diff = createDiff({
        nodeTypes: [
          { name: 'NewNode', changeType: 'ADDED', changes: {} },
          { name: 'OldNode', changeType: 'REMOVED', changes: {} },
          {
            name: 'ModNode',
            changeType: 'MODIFIED',
            changes: { isAsync: { type: 'MODIFIED', before: false, after: true } },
          },
        ],
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('NODE TYPES');
      expect(output).toContain('+ NewNode');
      expect(output).toContain('- OldNode');
      expect(output).toContain('~ ModNode');
      expect(output).toContain('async');
    });

    it('should list instance changes', () => {
      const diff = createDiff({
        instances: [
          { id: 'node1', changeType: 'ADDED', changes: {} },
          { id: 'node2', changeType: 'REMOVED', changes: {} },
          {
            id: 'node3',
            changeType: 'MODIFIED',
            changes: { nodeType: { type: 'MODIFIED', before: 'OldType', after: 'NewType' } },
          },
        ],
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('INSTANCES');
      expect(output).toContain('+ node1');
      expect(output).toContain('- node2');
      expect(output).toContain('~ node3');
      expect(output).toContain('OldType');
      expect(output).toContain('NewType');
    });

    it('should list connection changes', () => {
      const diff = createDiff({
        connections: [
          {
            changeType: 'ADDED',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'n1', port: 'execute' },
          },
          {
            changeType: 'REMOVED',
            from: { node: 'n1', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('CONNECTIONS');
      expect(output).toContain('+ Start.execute');
      expect(output).toContain('- n1.onSuccess');
    });

    it('should show connection scope', () => {
      const diff = createDiff({
        connections: [
          {
            changeType: 'ADDED',
            from: { node: 'loop1', port: 'item', scope: 'iteration' },
            to: { node: 'process1', port: 'data', scope: 'iteration' },
          },
        ],
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain(':iteration');
    });

    it('should list workflow port changes', () => {
      const diff = createDiff({
        startPorts: {
          added: [{ name: 'newInput', definition: { dataType: 'STRING' } }],
          removed: [],
          modified: [],
        },
        exitPorts: {
          added: [],
          removed: [{ name: 'oldOutput', definition: { dataType: 'NUMBER' } }],
          modified: [],
        },
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('WORKFLOW PORTS');
      expect(output).toContain('Start ports added');
      expect(output).toContain('newInput');
      expect(output).toContain('Exit ports removed');
      expect(output).toContain('oldOutput');
    });

    it('should list scope changes', () => {
      const diff = createDiff({
        scopes: [
          { name: 'loop1.iteration', changeType: 'ADDED', after: ['p1'] },
          { name: 'old.scope', changeType: 'REMOVED', before: ['p2'] },
          { name: 'mod.scope', changeType: 'MODIFIED', before: ['a'], after: ['a', 'b'] },
        ],
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('SCOPES');
      expect(output).toContain('+ loop1.iteration');
      expect(output).toContain('- old.scope');
      expect(output).toContain('~ mod.scope');
    });

    it('should show port changes in node types', () => {
      const diff = createDiff({
        nodeTypes: [{
          name: 'Process',
          changeType: 'MODIFIED',
          changes: {
            inputs: [
              { portName: 'newIn', direction: 'INPUT', type: 'ADDED', after: { dataType: 'STRING' } },
              { portName: 'oldIn', direction: 'INPUT', type: 'REMOVED', before: { dataType: 'NUMBER' } },
            ],
            outputs: [
              { portName: 'modOut', direction: 'OUTPUT', type: 'MODIFIED', before: { dataType: 'STRING' }, after: { dataType: 'NUMBER' } },
            ],
          },
        }],
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('+inputs: newIn');
      expect(output).toContain('-inputs: oldIn');
      expect(output).toContain('~outputs: modOut');
    });

    it('should show parent changes in instances', () => {
      const diff = createDiff({
        instances: [{
          id: 'node1',
          changeType: 'MODIFIED',
          changes: {
            parent: {
              type: 'MODIFIED',
              before: null,
              after: { id: 'loop1', scope: 'iteration' },
            },
          },
        }],
      });
      const output = formatDiff(diff, 'text');
      expect(output).toContain('parent: none → loop1.iteration');
    });
  });

  describe('default format', () => {
    it('should default to text format', () => {
      const diff = createDiff();
      const output = formatDiff(diff);
      expect(output).toContain('WORKFLOW DIFF');
    });
  });

  describe('restore semantics display', () => {
    // When showing "what will happen if you restore to snapshot":
    // - Nodes you'll GAIN should show as "+X nodes" (instancesAdded)
    // - Nodes you'll LOSE should show as "-X nodes" (instancesRemoved)

    it('should show "+2 nodes" when restoring will add 2 nodes', () => {
      // compare(current, snapshot) where snapshot has 2 more nodes
      const diff = createDiff({
        summary: {
          ...createDiff().summary,
          instancesAdded: 2,  // 2 nodes in snapshot not in current = will GAIN
          instancesRemoved: 0,
        },
      });

      const output = formatDiff(diff, 'compact');
      expect(output).toContain('+2 nodes');
      expect(output).not.toContain('-');
    });

    it('should show "-2 nodes" when restoring will remove 2 nodes', () => {
      // compare(current, snapshot) where current has 2 more nodes
      const diff = createDiff({
        summary: {
          ...createDiff().summary,
          instancesAdded: 0,
          instancesRemoved: 2,  // 2 nodes in current not in snapshot = will LOSE
        },
      });

      const output = formatDiff(diff, 'compact');
      expect(output).toContain('-2 nodes');
      expect(output).not.toContain('+');
    });

    it('should show both gains and losses', () => {
      const diff = createDiff({
        summary: {
          ...createDiff().summary,
          instancesAdded: 3,   // will GAIN
          instancesRemoved: 1, // will LOSE
        },
      });

      const output = formatDiff(diff, 'compact');
      expect(output).toContain('+3 nodes');
      expect(output).toContain('-1 nodes');
    });
  });
});
