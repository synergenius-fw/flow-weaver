/**
 * Coverage tests for src/api/manipulation/nodes.ts
 * Targets uncovered lines:
 *   298-299: removeNodes with scopes
 *   348-357: setNodePosition for Start/Exit virtual nodes
 */

import {
  removeNodes,
  setNodePosition,
} from '../../src/api/manipulation/nodes';
import type { TWorkflowAST } from '../../src/ast/types';
import {
  createSimpleWorkflow,
  createNodeInstance,
  createProcessorNodeType,
} from '../helpers/test-fixtures';

function makeWorkflowWithScopes(): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'test',
    functionName: 'test',
    sourceFile: 'test.ts',
    nodeTypes: [createProcessorNodeType()],
    instances: [
      createNodeInstance('nodeA', 'process'),
      createNodeInstance('nodeB', 'process'),
      createNodeInstance('nodeC', 'process'),
    ],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'x' },
        to: { node: 'nodeA', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'nodeA', port: 'output' },
        to: { node: 'nodeB', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'nodeB', port: 'output' },
        to: { node: 'nodeC', port: 'input' },
      },
    ],
    scopes: {
      'parent.scope1': ['nodeA', 'nodeB'],
      'parent.scope2': ['nodeC'],
    },
    startPorts: { x: { dataType: 'NUMBER' } },
    exitPorts: {},
    imports: [],
  };
}

describe('removeNodes - scope cleanup', () => {
  it('should remove nodes from scopes when removing multiple nodes', () => {
    const workflow = makeWorkflowWithScopes();
    const result = removeNodes(workflow, ['nodeA', 'nodeC']);

    // nodeA removed from scope1, nodeC removed from scope2
    expect(result.scopes!['parent.scope1']).toEqual(['nodeB']);
    expect(result.scopes!['parent.scope2']).toEqual([]);
  });

  it('should remove all nodes from a scope', () => {
    const workflow = makeWorkflowWithScopes();
    const result = removeNodes(workflow, ['nodeA', 'nodeB']);

    expect(result.scopes!['parent.scope1']).toEqual([]);
    expect(result.scopes!['parent.scope2']).toEqual(['nodeC']);
  });

  it('should also remove connections involving the removed nodes', () => {
    const workflow = makeWorkflowWithScopes();
    const result = removeNodes(workflow, ['nodeA']);

    // Connection from Start to nodeA and from nodeA to nodeB should be removed
    const nodeAConnections = result.connections.filter(
      c => c.from.node === 'nodeA' || c.to.node === 'nodeA',
    );
    expect(nodeAConnections).toHaveLength(0);

    // Connection from nodeB to nodeC should remain
    const remainingConn = result.connections.find(
      c => c.from.node === 'nodeB' && c.to.node === 'nodeC',
    );
    expect(remainingConn).toBeDefined();
  });

  it('should handle workflow without scopes', () => {
    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [createProcessorNodeType()],
      instances: [
        createNodeInstance('n1', 'process'),
        createNodeInstance('n2', 'process'),
      ],
      connections: [],
      startPorts: {},
      exitPorts: {},
      imports: [],
    };

    // No scopes field at all
    const result = removeNodes(workflow, ['n1']);
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0].id).toBe('n2');
  });
});

describe('setNodePosition - virtual nodes', () => {
  it('should set position on Start virtual node', () => {
    const workflow = createSimpleWorkflow();
    const result = setNodePosition(workflow, 'Start', 100, 200);

    expect(result.ui?.startNode?.x).toBe(100);
    expect(result.ui?.startNode?.y).toBe(200);
  });

  it('should set position on Exit virtual node', () => {
    const workflow = createSimpleWorkflow();
    const result = setNodePosition(workflow, 'Exit', 300, 400);

    expect(result.ui?.exitNode?.x).toBe(300);
    expect(result.ui?.exitNode?.y).toBe(400);
  });

  it('should preserve existing ui properties when setting Start position', () => {
    const workflow = createSimpleWorkflow();
    (workflow as any).ui = { disablePan: true, exitNode: { x: 50, y: 50 } };

    const result = setNodePosition(workflow, 'Start', 10, 20);

    expect(result.ui?.startNode?.x).toBe(10);
    expect(result.ui?.startNode?.y).toBe(20);
    // exitNode should remain
    expect(result.ui?.exitNode?.x).toBe(50);
  });

  it('should preserve existing ui properties when setting Exit position', () => {
    const workflow = createSimpleWorkflow();
    (workflow as any).ui = { startNode: { x: 10, y: 20 } };

    const result = setNodePosition(workflow, 'Exit', 99, 88);

    expect(result.ui?.exitNode?.x).toBe(99);
    expect(result.ui?.exitNode?.y).toBe(88);
    expect(result.ui?.startNode?.x).toBe(10);
  });

  it('should set position on Start when ui is undefined', () => {
    const workflow = createSimpleWorkflow();
    delete (workflow as any).ui;

    const result = setNodePosition(workflow, 'Start', 5, 15);

    expect(result.ui?.startNode?.x).toBe(5);
    expect(result.ui?.startNode?.y).toBe(15);
  });

  it('should not modify the original workflow', () => {
    const workflow = createSimpleWorkflow();
    setNodePosition(workflow, 'Start', 100, 200);

    expect(workflow.ui?.startNode).toBeUndefined();
  });
});
