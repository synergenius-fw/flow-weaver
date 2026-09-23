/**
 * Tests for src/api/manipulation/nodes.ts
 * Tests:
 *   - removeNodes with scopes
 */

import {
  removeNodes,
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

