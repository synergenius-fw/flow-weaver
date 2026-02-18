/**
 * WorkflowDiffer tests - TDD approach
 */

import { describe, it, expect } from 'vitest';
import { WorkflowDiffer } from '../../../src/diff/WorkflowDiffer.js';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TConnectionAST } from '../../../src/ast/types.js';

// Helper to create minimal workflow
function createWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: 'test.ts',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: { onSuccess: { dataType: 'STEP' } },
    imports: [],
    ...overrides,
  };
}

// Helper to create node type
function createNodeType(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { execute: { dataType: 'STEP' } },
    outputs: { onSuccess: { dataType: 'STEP' } },
    hasSuccessPort: true,
    hasFailurePort: false,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
    ...overrides,
  };
}

// Helper to create instance
function createInstance(id: string, nodeType: string, overrides: Partial<TNodeInstanceAST> = {}): TNodeInstanceAST {
  return {
    type: 'NodeInstance',
    id,
    nodeType,
    ...overrides,
  };
}

// Helper to create connection
function createConnection(fromNode: string, fromPort: string, toNode: string, toPort: string): TConnectionAST {
  return {
    type: 'Connection',
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort },
  };
}

describe('WorkflowDiffer', () => {
  describe('identical workflows', () => {
    it('should detect identical empty workflows', () => {
      const before = createWorkflow();
      const after = createWorkflow();

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(true);
      expect(diff.summary.nodeTypesAdded).toBe(0);
      expect(diff.summary.nodeTypesRemoved).toBe(0);
      expect(diff.summary.instancesAdded).toBe(0);
      expect(diff.summary.connectionsAdded).toBe(0);
    });

    it('should detect identical workflows with nodes', () => {
      const nodeType = createNodeType('Process');
      const instance = createInstance('process1', 'Process');
      const connection = createConnection('Start', 'execute', 'process1', 'execute');

      const before = createWorkflow({
        nodeTypes: [nodeType],
        instances: [instance],
        connections: [connection],
      });
      const after = createWorkflow({
        nodeTypes: [nodeType],
        instances: [instance],
        connections: [connection],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(true);
    });

    it('should ignore visual fields (x, y, label, description)', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', { x: 100, y: 200, label: 'Old', description: 'Old desc' })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', { x: 500, y: 600, label: 'New', description: 'New desc' })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(true);
    });

    it('should ignore metadata fields', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', { metadata: { custom: 'old' } })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', { metadata: { custom: 'new' } })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(true);
    });

    it('should ignore sourceLocation', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', { sourceLocation: { file: 'a.ts', line: 1, column: 1 } })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', { sourceLocation: { file: 'b.ts', line: 99, column: 5 } })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(true);
    });
  });

  describe('node type changes', () => {
    it('should detect added node type', () => {
      const before = createWorkflow();
      const after = createWorkflow({
        nodeTypes: [createNodeType('NewNode')],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.nodeTypesAdded).toBe(1);
      expect(diff.nodeTypes).toHaveLength(1);
      expect(diff.nodeTypes[0].name).toBe('NewNode');
      expect(diff.nodeTypes[0].changeType).toBe('ADDED');
    });

    it('should detect removed node type', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('OldNode')],
      });
      const after = createWorkflow();

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.nodeTypesRemoved).toBe(1);
      expect(diff.nodeTypes[0].name).toBe('OldNode');
      expect(diff.nodeTypes[0].changeType).toBe('REMOVED');
    });

    it('should detect modified node type - functionName change', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', { functionName: 'oldFunc' })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', { functionName: 'newFunc' })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.nodeTypesModified).toBe(1);
      expect(diff.nodeTypes[0].changeType).toBe('MODIFIED');
      expect(diff.nodeTypes[0].changes.functionName?.before).toBe('oldFunc');
      expect(diff.nodeTypes[0].changes.functionName?.after).toBe('newFunc');
    });

    it('should detect modified node type - isAsync change', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', { isAsync: false })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', { isAsync: true })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.nodeTypes[0].changes.isAsync?.before).toBe(false);
      expect(diff.nodeTypes[0].changes.isAsync?.after).toBe(true);
    });

    it('should detect modified node type - executeWhen change', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', { executeWhen: 'CONJUNCTION' })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', { executeWhen: 'DISJUNCTION' })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.nodeTypes[0].changes.executeWhen?.before).toBe('CONJUNCTION');
      expect(diff.nodeTypes[0].changes.executeWhen?.after).toBe('DISJUNCTION');
    });

    it('should detect added input port', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', { inputs: { execute: { dataType: 'STEP' } } })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', {
          inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
        })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.nodeTypes[0].changes.inputs).toBeDefined();
      expect(diff.nodeTypes[0].changes.inputs?.some(p => p.portName === 'data' && p.type === 'ADDED')).toBe(true);
    });

    it('should detect removed output port', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', {
          outputs: { onSuccess: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
        })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', { outputs: { onSuccess: { dataType: 'STEP' } } })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.nodeTypes[0].changes.outputs?.some(p => p.portName === 'result' && p.type === 'REMOVED')).toBe(true);
    });

    it('should detect modified port dataType', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('Process', {
          inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
        })],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('Process', {
          inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'NUMBER' } },
        })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      const dataPortChange = diff.nodeTypes[0].changes.inputs?.find(p => p.portName === 'data');
      expect(dataPortChange?.type).toBe('MODIFIED');
      expect(dataPortChange?.before?.dataType).toBe('STRING');
      expect(dataPortChange?.after?.dataType).toBe('NUMBER');
    });
  });

  describe('instance changes', () => {
    it('should detect added instance', () => {
      const nodeType = createNodeType('Process');
      const before = createWorkflow({ nodeTypes: [nodeType] });
      const after = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('process1', 'Process')],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.instancesAdded).toBe(1);
      expect(diff.instances[0].id).toBe('process1');
      expect(diff.instances[0].changeType).toBe('ADDED');
    });

    it('should detect removed instance', () => {
      const nodeType = createNodeType('Process');
      const before = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('process1', 'Process')],
      });
      const after = createWorkflow({ nodeTypes: [nodeType] });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.instancesRemoved).toBe(1);
      expect(diff.instances[0].id).toBe('process1');
      expect(diff.instances[0].changeType).toBe('REMOVED');
    });

    it('should detect modified instance - nodeType change', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('OldType'), createNodeType('NewType')],
        instances: [createInstance('node1', 'OldType')],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('OldType'), createNodeType('NewType')],
        instances: [createInstance('node1', 'NewType')],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.instancesModified).toBe(1);
      expect(diff.instances[0].changes.nodeType?.before).toBe('OldType');
      expect(diff.instances[0].changes.nodeType?.after).toBe('NewType');
    });

    it('should detect modified instance - config.pullExecution change', () => {
      const nodeType = createNodeType('Process');
      const before = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('process1', 'Process', {
          config: { pullExecution: { triggerPort: 'execute' } },
        })],
      });
      const after = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('process1', 'Process', {
          config: { pullExecution: { triggerPort: 'data' } },
        })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.instances[0].changes.config?.pullExecution?.before?.triggerPort).toBe('execute');
      expect(diff.instances[0].changes.config?.pullExecution?.after?.triggerPort).toBe('data');
    });

    it('should detect modified instance - parent change', () => {
      const nodeType = createNodeType('Process');
      const before = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('process1', 'Process', { parent: null })],
      });
      const after = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('process1', 'Process', { parent: { id: 'loop1', scope: 'iteration' } })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.instances[0].changes.parent?.before).toBeNull();
      expect(diff.instances[0].changes.parent?.after).toEqual({ id: 'loop1', scope: 'iteration' });
    });

    it('should ignore instance dependencies/dependents (computed fields)', () => {
      const nodeType = createNodeType('Process');
      const before = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('process1', 'Process', { dependencies: ['a'], dependents: ['b'] })],
      });
      const after = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('process1', 'Process', { dependencies: ['x'], dependents: ['y'] })],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(true);
    });
  });

  describe('connection changes', () => {
    it('should detect added connection', () => {
      const nodeType = createNodeType('Process');
      const instance = createInstance('process1', 'Process');
      const before = createWorkflow({ nodeTypes: [nodeType], instances: [instance] });
      const after = createWorkflow({
        nodeTypes: [nodeType],
        instances: [instance],
        connections: [createConnection('Start', 'execute', 'process1', 'execute')],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.connectionsAdded).toBe(1);
      expect(diff.connections[0].changeType).toBe('ADDED');
      expect(diff.connections[0].from).toEqual({ node: 'Start', port: 'execute' });
      expect(diff.connections[0].to).toEqual({ node: 'process1', port: 'execute' });
    });

    it('should detect removed connection', () => {
      const nodeType = createNodeType('Process');
      const instance = createInstance('process1', 'Process');
      const connection = createConnection('Start', 'execute', 'process1', 'execute');
      const before = createWorkflow({
        nodeTypes: [nodeType],
        instances: [instance],
        connections: [connection],
      });
      const after = createWorkflow({ nodeTypes: [nodeType], instances: [instance] });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.connectionsRemoved).toBe(1);
      expect(diff.connections[0].changeType).toBe('REMOVED');
    });

    it('should detect connection with scope', () => {
      const nodeType = createNodeType('Process');
      const instance = createInstance('process1', 'Process');
      const before = createWorkflow({ nodeTypes: [nodeType], instances: [instance] });
      const after = createWorkflow({
        nodeTypes: [nodeType],
        instances: [instance],
        connections: [{
          type: 'Connection',
          from: { node: 'loop1', port: 'item', scope: 'iteration' },
          to: { node: 'process1', port: 'data', scope: 'iteration' },
        }],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.connections[0].from.scope).toBe('iteration');
      expect(diff.connections[0].to.scope).toBe('iteration');
    });

    it('should ignore connection metadata/sourceLocation', () => {
      const nodeType = createNodeType('Process');
      const instance = createInstance('process1', 'Process');
      const before = createWorkflow({
        nodeTypes: [nodeType],
        instances: [instance],
        connections: [{
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'process1', port: 'execute' },
          sourceLocation: { file: 'a.ts', line: 1, column: 1 },
          metadata: { old: true },
        }],
      });
      const after = createWorkflow({
        nodeTypes: [nodeType],
        instances: [instance],
        connections: [{
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'process1', port: 'execute' },
          sourceLocation: { file: 'b.ts', line: 99, column: 5 },
          metadata: { new: true },
        }],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(true);
    });
  });

  describe('start/exit port changes', () => {
    it('should detect added start port', () => {
      const before = createWorkflow({
        startPorts: { execute: { dataType: 'STEP' } },
      });
      const after = createWorkflow({
        startPorts: { execute: { dataType: 'STEP' }, input: { dataType: 'STRING' } },
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.startPorts.added).toHaveLength(1);
      expect(diff.startPorts.added[0].name).toBe('input');
    });

    it('should detect removed exit port', () => {
      const before = createWorkflow({
        exitPorts: { onSuccess: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
      });
      const after = createWorkflow({
        exitPorts: { onSuccess: { dataType: 'STEP' } },
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.exitPorts.removed).toHaveLength(1);
      expect(diff.exitPorts.removed[0].name).toBe('result');
    });

    it('should detect modified port definition', () => {
      const before = createWorkflow({
        startPorts: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING', optional: false } },
      });
      const after = createWorkflow({
        startPorts: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING', optional: true } },
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.startPorts.modified).toHaveLength(1);
      expect(diff.startPorts.modified[0].name).toBe('data');
      expect(diff.startPorts.modified[0].before.optional).toBe(false);
      expect(diff.startPorts.modified[0].after.optional).toBe(true);
    });
  });

  describe('scope changes', () => {
    it('should detect added scope', () => {
      const before = createWorkflow();
      const after = createWorkflow({
        scopes: { 'loop1.iteration': ['process1', 'process2'] },
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.scopes).toHaveLength(1);
      expect(diff.scopes[0].name).toBe('loop1.iteration');
      expect(diff.scopes[0].changeType).toBe('ADDED');
    });

    it('should detect removed scope', () => {
      const before = createWorkflow({
        scopes: { 'loop1.iteration': ['process1'] },
      });
      const after = createWorkflow();

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.scopes[0].changeType).toBe('REMOVED');
    });

    it('should detect modified scope members', () => {
      const before = createWorkflow({
        scopes: { 'loop1.iteration': ['process1'] },
      });
      const after = createWorkflow({
        scopes: { 'loop1.iteration': ['process1', 'process2'] },
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.scopes[0].changeType).toBe('MODIFIED');
      expect(diff.scopes[0].before).toEqual(['process1']);
      expect(diff.scopes[0].after).toEqual(['process1', 'process2']);
    });
  });

  describe('restore semantics - compare(current, snapshot)', () => {
    // When restoring to an old version, we want to know:
    // - ADDED = what you'll GAIN (exists in snapshot, not in current)
    // - REMOVED = what you'll LOSE (exists in current, not in snapshot)

    it('should show nodes you will GAIN as ADDED when snapshot has more nodes', () => {
      const nodeType = createNodeType('Process');

      // Current workflow: empty (no instances)
      const current = createWorkflow({ nodeTypes: [nodeType] });

      // Snapshot workflow: has 2 nodes
      const snapshot = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          createInstance('process1', 'Process'),
          createInstance('process2', 'Process'),
        ],
      });

      // compare(current, snapshot) - what happens if we restore to snapshot
      const diff = WorkflowDiffer.compare(current, snapshot);

      // Should show 2 nodes as ADDED (you'll gain them by restoring)
      expect(diff.summary.instancesAdded).toBe(2);
      expect(diff.summary.instancesRemoved).toBe(0);
      expect(diff.instances.filter(i => i.changeType === 'ADDED')).toHaveLength(2);
      expect(diff.instances.filter(i => i.changeType === 'REMOVED')).toHaveLength(0);
    });

    it('should show nodes you will LOSE as REMOVED when current has more nodes', () => {
      const nodeType = createNodeType('Process');

      // Current workflow: has 2 nodes
      const current = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          createInstance('process1', 'Process'),
          createInstance('process2', 'Process'),
        ],
      });

      // Snapshot workflow: empty (no instances)
      const snapshot = createWorkflow({ nodeTypes: [nodeType] });

      // compare(current, snapshot) - what happens if we restore to snapshot
      const diff = WorkflowDiffer.compare(current, snapshot);

      // Should show 2 nodes as REMOVED (you'll lose them by restoring)
      expect(diff.summary.instancesAdded).toBe(0);
      expect(diff.summary.instancesRemoved).toBe(2);
      expect(diff.instances.filter(i => i.changeType === 'ADDED')).toHaveLength(0);
      expect(diff.instances.filter(i => i.changeType === 'REMOVED')).toHaveLength(2);
    });

    it('should correctly identify mixed changes when restoring', () => {
      const nodeType = createNodeType('Process');

      // Current workflow: has node A
      const current = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('nodeA', 'Process')],
      });

      // Snapshot workflow: has node B
      const snapshot = createWorkflow({
        nodeTypes: [nodeType],
        instances: [createInstance('nodeB', 'Process')],
      });

      const diff = WorkflowDiffer.compare(current, snapshot);

      // Should show: nodeB as ADDED (gain), nodeA as REMOVED (lose)
      expect(diff.summary.instancesAdded).toBe(1);
      expect(diff.summary.instancesRemoved).toBe(1);

      const added = diff.instances.find(i => i.changeType === 'ADDED');
      const removed = diff.instances.find(i => i.changeType === 'REMOVED');

      expect(added?.id).toBe('nodeB');
      expect(removed?.id).toBe('nodeA');
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple changes at once', () => {
      const before = createWorkflow({
        nodeTypes: [createNodeType('OldNode')],
        instances: [createInstance('old1', 'OldNode')],
        connections: [createConnection('Start', 'execute', 'old1', 'execute')],
      });
      const after = createWorkflow({
        nodeTypes: [createNodeType('NewNode')],
        instances: [createInstance('new1', 'NewNode')],
        connections: [createConnection('Start', 'execute', 'new1', 'execute')],
      });

      const diff = WorkflowDiffer.compare(before, after);

      expect(diff.identical).toBe(false);
      expect(diff.summary.nodeTypesAdded).toBe(1);
      expect(diff.summary.nodeTypesRemoved).toBe(1);
      expect(diff.summary.instancesAdded).toBe(1);
      expect(diff.summary.instancesRemoved).toBe(1);
      expect(diff.summary.connectionsAdded).toBe(1);
      expect(diff.summary.connectionsRemoved).toBe(1);
    });
  });
});
