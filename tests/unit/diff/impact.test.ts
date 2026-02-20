/**
 * Impact assessment tests
 */

import { describe, it, expect } from 'vitest';
import {
  IMPACT_DESCRIPTIONS,
  IMPACT_COLORS,
  getImpactReasons,
  hasBreakingChanges,
  getNodeTypeChanges,
  getCriticalConnections,
} from '../../../src/diff/impact.js';
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

describe('impact utilities', () => {
  describe('IMPACT_DESCRIPTIONS', () => {
    it('should have descriptions for all impact levels', () => {
      expect(IMPACT_DESCRIPTIONS.CRITICAL).toBeDefined();
      expect(IMPACT_DESCRIPTIONS.BREAKING).toBeDefined();
      expect(IMPACT_DESCRIPTIONS.MINOR).toBeDefined();
      expect(IMPACT_DESCRIPTIONS.COSMETIC).toBeDefined();
    });
  });

  describe('IMPACT_COLORS', () => {
    it('should have colors for all impact levels', () => {
      expect(IMPACT_COLORS.CRITICAL).toBe('red');
      expect(IMPACT_COLORS.BREAKING).toBe('yellow');
      expect(IMPACT_COLORS.MINOR).toBe('blue');
      expect(IMPACT_COLORS.COSMETIC).toBe('gray');
    });
  });

  describe('getImpactReasons', () => {
    it('should return identical message for identical diffs', () => {
      const diff = createDiff({ identical: true });
      const reasons = getImpactReasons(diff);
      expect(reasons).toContain('Workflows are semantically identical');
    });

    it('should list removed start ports', () => {
      const diff = createDiff({
        startPorts: {
          added: [],
          removed: [{ name: 'input1', definition: { dataType: 'STRING' } }],
          modified: [],
        },
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('input1') && r.includes('input port'))).toBe(true);
    });

    it('should list removed exit ports', () => {
      const diff = createDiff({
        exitPorts: {
          added: [],
          removed: [{ name: 'result', definition: { dataType: 'NUMBER' } }],
          modified: [],
        },
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('result') && r.includes('output port'))).toBe(true);
    });

    it('should list removed node types', () => {
      const diff = createDiff({
        summary: { ...createDiff().summary, nodeTypesRemoved: 1 },
        nodeTypes: [{ name: 'OldNode', changeType: 'REMOVED', changes: {} }],
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('OldNode') && r.includes('Removed'))).toBe(true);
    });

    it('should list added node types', () => {
      const diff = createDiff({
        summary: { ...createDiff().summary, nodeTypesAdded: 1 },
        nodeTypes: [{ name: 'NewNode', changeType: 'ADDED', changes: {} }],
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('NewNode') && r.includes('Added'))).toBe(true);
    });

    it('should list modified node types', () => {
      const diff = createDiff({
        summary: { ...createDiff().summary, nodeTypesModified: 1 },
        nodeTypes: [{ name: 'ModNode', changeType: 'MODIFIED', changes: {} }],
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('ModNode') && r.includes('Modified'))).toBe(true);
    });

    it('should list removed instances', () => {
      const diff = createDiff({
        summary: { ...createDiff().summary, instancesRemoved: 1 },
        instances: [{ id: 'node1', changeType: 'REMOVED', changes: {} }],
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('node1') && r.includes('Removed'))).toBe(true);
    });

    it('should list connection changes', () => {
      const diff = createDiff({
        summary: { ...createDiff().summary, connectionsRemoved: 2 },
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('2 connection'))).toBe(true);
    });

    it('should list scope changes', () => {
      const diff = createDiff({
        scopes: [
          { name: 'loop1.iteration', changeType: 'ADDED', after: ['p1'] },
          { name: 'old.scope', changeType: 'REMOVED', before: ['p2'] },
        ],
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('Added scope'))).toBe(true);
      expect(reasons.some(r => r.includes('Removed scope'))).toBe(true);
    });

    it('should list removed input ports on node types', () => {
      const diff = createDiff({
        nodeTypes: [{
          name: 'Process',
          changeType: 'MODIFIED',
          changes: {
            inputs: [{ portName: 'data', direction: 'INPUT', type: 'REMOVED', before: { dataType: 'STRING' } }],
          },
        }],
      });
      const reasons = getImpactReasons(diff);
      expect(reasons.some(r => r.includes('Process') && r.includes('data') && r.includes('input port'))).toBe(true);
    });
  });

  describe('hasBreakingChanges', () => {
    it('should return true for CRITICAL impact', () => {
      const diff = createDiff({ impact: 'CRITICAL' });
      expect(hasBreakingChanges(diff)).toBe(true);
    });

    it('should return true for BREAKING impact', () => {
      const diff = createDiff({ impact: 'BREAKING' });
      expect(hasBreakingChanges(diff)).toBe(true);
    });

    it('should return false for MINOR impact', () => {
      const diff = createDiff({ impact: 'MINOR' });
      expect(hasBreakingChanges(diff)).toBe(false);
    });

    it('should return false for COSMETIC impact', () => {
      const diff = createDiff({ impact: 'COSMETIC' });
      expect(hasBreakingChanges(diff)).toBe(false);
    });
  });

  describe('getNodeTypeChanges', () => {
    it('should group node types by change type', () => {
      const diff = createDiff({
        nodeTypes: [
          { name: 'Added1', changeType: 'ADDED', changes: {} },
          { name: 'Added2', changeType: 'ADDED', changes: {} },
          { name: 'Removed1', changeType: 'REMOVED', changes: {} },
          { name: 'Modified1', changeType: 'MODIFIED', changes: {} },
        ],
      });

      const { added, removed, modified } = getNodeTypeChanges(diff);

      expect(added).toHaveLength(2);
      expect(removed).toHaveLength(1);
      expect(modified).toHaveLength(1);
      expect(added.map(n => n.name)).toEqual(['Added1', 'Added2']);
    });
  });

  describe('getCriticalConnections', () => {
    it('should return connections from Start', () => {
      const diff = createDiff({
        connections: [
          { changeType: 'ADDED', from: { node: 'Start', port: 'execute' }, to: { node: 'n1', port: 'execute' } },
          { changeType: 'ADDED', from: { node: 'n1', port: 'out' }, to: { node: 'n2', port: 'in' } },
        ],
      });

      const critical = getCriticalConnections(diff);

      expect(critical).toHaveLength(1);
      expect(critical[0].from.node).toBe('Start');
    });

    it('should return connections to Exit', () => {
      const diff = createDiff({
        connections: [
          { changeType: 'REMOVED', from: { node: 'n1', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });

      const critical = getCriticalConnections(diff);

      expect(critical).toHaveLength(1);
      expect(critical[0].to.node).toBe('Exit');
    });

    it('should not return non-critical connections', () => {
      const diff = createDiff({
        connections: [
          { changeType: 'ADDED', from: { node: 'n1', port: 'out' }, to: { node: 'n2', port: 'in' } },
        ],
      });

      const critical = getCriticalConnections(diff);

      expect(critical).toHaveLength(0);
    });
  });
});
