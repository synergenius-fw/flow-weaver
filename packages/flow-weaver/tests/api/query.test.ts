/**
 * Comprehensive tests for Query API
 * Tests all 24 read-only query functions
 */

import {
  getNode,
  getNodes,
  getNodesByType,
  getNodesInScope,
  hasNode,
  findNodesByName,
  getConnections,
  getIncomingConnections,
  getOutgoingConnections,
  isConnected,
  getConnectedPorts,
  getUnconnectedPorts,
  getDependencies,
  getDependents,
  getDataDependencies,
  getTransitiveDependencies,
  findPath,
  getTopologicalOrder,
  getExecutionGroups,
  countNodes,
  countConnections,
  countNodeTypes,
  findIsolatedNodes,
  findUnusedNodeTypes,
  findDeadEnds,
  findDisconnectedOutputPorts,
  findDeadEndDetails,
} from '../../src/api/query';
import { addNode, createScope, addConnection } from '../../src/api/manipulation';
import type { TNodeInstanceAST, TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';
import {
  createChainWorkflow as createTestWorkflow,
  createScopedWorkflow,
} from '../helpers/test-fixtures';

describe('Query API - Node Queries', () => {
  describe('getNode', () => {
    it('should return node when it exists', () => {
      const workflow = createTestWorkflow();

      const node = getNode(workflow, 'node1');

      expect(node).toBeDefined();
      expect(node?.id).toBe('node1');
      expect(node?.nodeType).toBe('process');
    });

    it("should return undefined when node doesn't exist", () => {
      const workflow = createTestWorkflow();

      const node = getNode(workflow, 'nonExistent');

      expect(node).toBeUndefined();
    });
  });

  describe('getNodes', () => {
    it('should return all nodes when no filter', () => {
      const workflow = createTestWorkflow();

      const nodes = getNodes(workflow);

      expect(nodes).toHaveLength(3);
      expect(nodes.map((n) => n.id)).toEqual(['node1', 'node2', 'node3']);
    });

    it('should filter by node type', () => {
      const workflow = createTestWorkflow();

      const nodes = getNodes(workflow, { type: 'process' });

      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id)).toEqual(['node1', 'node2']);
    });

    it('should filter by scope', () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'testScope', ['node1', 'node2']);

      const nodes = getNodes(workflow, { scope: 'testScope' });

      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id)).toEqual(['node1', 'node2']);
    });

    it('should apply custom predicate', () => {
      const workflow = createTestWorkflow();
      workflow.instances[0].config = { label: 'Special' };

      const nodes = getNodes(workflow, {
        predicate: (node) => node.config?.label === 'Special',
      });

      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe('node1');
    });
  });

  describe('getNodesByType', () => {
    it('should return nodes of specific type', () => {
      const workflow = createTestWorkflow();

      const nodes = getNodesByType(workflow, 'process');

      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id)).toEqual(['node1', 'node2']);
    });

    it('should return empty array for non-existent type', () => {
      const workflow = createTestWorkflow();

      const nodes = getNodesByType(workflow, 'nonExistent');

      expect(nodes).toHaveLength(0);
    });
  });

  describe('getNodesInScope', () => {
    it('should return nodes in scope', () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'mainLoop', ['node1', 'node3']);

      const nodes = getNodesInScope(workflow, 'mainLoop');

      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id)).toEqual(['node1', 'node3']);
    });

    it('should return empty array for non-existent scope', () => {
      const workflow = createTestWorkflow();

      const nodes = getNodesInScope(workflow, 'nonExistent');

      expect(nodes).toHaveLength(0);
    });
  });

  describe('hasNode', () => {
    it('should return true when node exists', () => {
      const workflow = createTestWorkflow();

      expect(hasNode(workflow, 'node1')).toBe(true);
    });

    it("should return false when node doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(hasNode(workflow, 'nonExistent')).toBe(false);
    });
  });

  describe('findNodesByName', () => {
    it('should find nodes by ID pattern', () => {
      const workflow = createTestWorkflow();

      const nodes = findNodesByName(workflow, 'node');

      expect(nodes).toHaveLength(3);
    });

    it('should be case-insensitive by default', () => {
      const workflow = createTestWorkflow();

      const nodes = findNodesByName(workflow, 'NODE');

      expect(nodes).toHaveLength(3);
    });

    it('should support case-sensitive search', () => {
      const workflow = createTestWorkflow();

      const nodes = findNodesByName(workflow, 'NODE', true);

      expect(nodes).toHaveLength(0);
    });

    it('should search in config labels', () => {
      const workflow = createTestWorkflow();
      workflow.instances[0].config = { label: 'Main Processor' };

      const nodes = findNodesByName(workflow, 'Processor');

      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe('node1');
    });

    it('should support regex patterns', () => {
      const workflow = createTestWorkflow();

      const nodes = findNodesByName(workflow, /^node[12]$/);

      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id)).toEqual(['node1', 'node2']);
    });
  });
});

describe('Query API - Connection Queries', () => {
  describe('getConnections', () => {
    it('should return all connections when no filter', () => {
      const workflow = createTestWorkflow();

      const connections = getConnections(workflow);

      expect(connections).toHaveLength(4);
    });

    it('should filter by node ID', () => {
      const workflow = createTestWorkflow();

      const connections = getConnections(workflow, 'node2');

      expect(connections).toHaveLength(2);
      expect(connections.some((c) => c.from.node === 'node2' || c.to.node === 'node2')).toBe(true);
    });
  });

  describe('getIncomingConnections', () => {
    it('should return all incoming connections to node', () => {
      const workflow = createTestWorkflow();

      const incoming = getIncomingConnections(workflow, 'node2');

      expect(incoming).toHaveLength(1);
      expect(incoming[0].from.node).toBe('node1');
      expect(incoming[0].to.node).toBe('node2');
    });

    it('should filter by port name', () => {
      const workflow = createTestWorkflow();

      const incoming = getIncomingConnections(workflow, 'node2', 'input');

      expect(incoming).toHaveLength(1);
      expect(incoming[0].to.port).toBe('input');
    });

    it('should return empty array for node with no incoming', () => {
      const workflow = createTestWorkflow();

      const incoming = getIncomingConnections(workflow, 'node1');

      expect(incoming).toHaveLength(1);
      expect(incoming[0].from.node).toBe('Start');
    });
  });

  describe('getOutgoingConnections', () => {
    it('should return all outgoing connections from node', () => {
      const workflow = createTestWorkflow();

      const outgoing = getOutgoingConnections(workflow, 'node1');

      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].from.node).toBe('node1');
      expect(outgoing[0].to.node).toBe('node2');
    });

    it('should filter by port name', () => {
      const workflow = createTestWorkflow();

      const outgoing = getOutgoingConnections(workflow, 'node1', 'output');

      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].from.port).toBe('output');
    });

    it('should return empty array for isolated node', () => {
      let workflow = createTestWorkflow();
      const isolatedNode: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'isolated',
        nodeType: 'process',
      };
      workflow = addNode(workflow, isolatedNode);

      const outgoing = getOutgoingConnections(workflow, 'isolated');

      expect(outgoing).toHaveLength(0);
    });
  });

  describe('isConnected', () => {
    it('should return true for connected ports (string format)', () => {
      const workflow = createTestWorkflow();

      const connected = isConnected(workflow, 'node1.output', 'node2.input');

      expect(connected).toBe(true);
    });

    it('should return true for connected ports (object format)', () => {
      const workflow = createTestWorkflow();

      const connected = isConnected(
        workflow,
        { node: 'node1', port: 'output' },
        { node: 'node2', port: 'input' }
      );

      expect(connected).toBe(true);
    });

    it('should return false for unconnected ports', () => {
      const workflow = createTestWorkflow();

      const connected = isConnected(workflow, 'node3.result', 'node1.input');

      expect(connected).toBe(false);
    });
  });

  describe('getConnectedPorts', () => {
    it('should return all connected ports for node', () => {
      const workflow = createTestWorkflow();

      const ports = getConnectedPorts(workflow, 'node2');

      expect(ports.incoming).toHaveLength(1);
      expect(ports.incoming[0]).toEqual({ node: 'node2', port: 'input' });
      expect(ports.outgoing).toHaveLength(1);
      expect(ports.outgoing[0]).toEqual({ node: 'node2', port: 'output' });
    });

    it('should return empty arrays for isolated node', () => {
      let workflow = createTestWorkflow();
      const isolatedNode: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'isolated',
        nodeType: 'process',
      };
      workflow = addNode(workflow, isolatedNode);

      const ports = getConnectedPorts(workflow, 'isolated');

      expect(ports.incoming).toHaveLength(0);
      expect(ports.outgoing).toHaveLength(0);
    });
  });

  describe('getUnconnectedPorts', () => {
    it('should return unconnected ports for partially connected node', () => {
      const workflow = createTestWorkflow();
      workflow.nodeTypes[0].inputs = {
        input: { dataType: 'NUMBER', optional: true },
        input2: { dataType: 'NUMBER', optional: true },
      };
      workflow.nodeTypes[0].outputs = {
        output: { dataType: 'NUMBER' },
        output2: { dataType: 'NUMBER' },
      };

      const unconnected = getUnconnectedPorts(workflow, 'node1');

      expect(unconnected.inputs).toContain('input2');
      expect(unconnected.outputs).toContain('output2');
    });

    it('should return empty arrays for fully connected node', () => {
      const workflow = createTestWorkflow();

      const unconnected = getUnconnectedPorts(workflow, 'node2');

      expect(unconnected.inputs).toHaveLength(0);
      expect(unconnected.outputs).toHaveLength(0);
    });

    it('should return empty arrays for non-existent node', () => {
      const workflow = createTestWorkflow();

      const unconnected = getUnconnectedPorts(workflow, 'nonExistent');

      expect(unconnected.inputs).toHaveLength(0);
      expect(unconnected.outputs).toHaveLength(0);
    });
  });
});

describe('Query API - Dependency Analysis', () => {
  describe('getDependencies', () => {
    it('should return direct dependencies', () => {
      const workflow = createTestWorkflow();

      const deps = getDependencies(workflow, 'node2');

      expect(deps).toEqual(['node1']);
    });

    it('should exclude Start from dependencies', () => {
      const workflow = createTestWorkflow();

      const deps = getDependencies(workflow, 'node1');

      expect(deps).toHaveLength(0);
    });

    it('should return empty array for node with no dependencies', () => {
      let workflow = createTestWorkflow();
      const isolatedNode: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'isolated',
        nodeType: 'process',
      };
      workflow = addNode(workflow, isolatedNode);

      const deps = getDependencies(workflow, 'isolated');

      expect(deps).toHaveLength(0);
    });
  });

  describe('getDependents', () => {
    it('should return direct dependents', () => {
      const workflow = createTestWorkflow();

      const dependents = getDependents(workflow, 'node1');

      expect(dependents).toEqual(['node2']);
    });

    it('should exclude Exit from dependents', () => {
      const workflow = createTestWorkflow();

      const dependents = getDependents(workflow, 'node3');

      expect(dependents).toHaveLength(0);
    });
  });

  describe('getTransitiveDependencies', () => {
    it('should return all upstream nodes', () => {
      const workflow = createTestWorkflow();

      const deps = getTransitiveDependencies(workflow, 'node3');

      expect(deps).toHaveLength(2);
      expect(deps).toContain('node1');
      expect(deps).toContain('node2');
    });

    it('should return empty array for first node', () => {
      const workflow = createTestWorkflow();

      const deps = getTransitiveDependencies(workflow, 'node1');

      expect(deps).toHaveLength(0);
    });

    it('should handle complex dependency chains', () => {
      let workflow = createTestWorkflow();
      const node4: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'node4',
        nodeType: 'process',
      };
      workflow = addNode(workflow, node4);
      workflow = addConnection(workflow, 'node2.output', 'node4.input');

      const deps = getTransitiveDependencies(workflow, 'node4');

      expect(deps).toContain('node1');
      expect(deps).toContain('node2');
    });
  });

  describe('findPath', () => {
    it('should find path between connected nodes', () => {
      const workflow = createTestWorkflow();

      const path = findPath(workflow, 'node1', 'node3');

      expect(path).toEqual(['node1', 'node2', 'node3']);
    });

    it('should return single-node path for same node', () => {
      const workflow = createTestWorkflow();

      const path = findPath(workflow, 'node1', 'node1');

      expect(path).toEqual(['node1']);
    });

    it('should return null when no path exists', () => {
      const workflow = createTestWorkflow();

      const path = findPath(workflow, 'node3', 'node1');

      expect(path).toBeNull();
    });

    it('should find shortest path', () => {
      let workflow = createTestWorkflow();
      workflow = addConnection(workflow, 'node1.output', 'node3.data');

      const path = findPath(workflow, 'node1', 'node3');

      expect(path).toEqual(['node1', 'node3']);
    });
  });

  describe('getTopologicalOrder', () => {
    it('should return nodes in valid execution order', () => {
      const workflow = createTestWorkflow();

      const order = getTopologicalOrder(workflow);

      expect(order).toHaveLength(3);
      expect(order.indexOf('node1')).toBeLessThan(order.indexOf('node2'));
      expect(order.indexOf('node2')).toBeLessThan(order.indexOf('node3'));
    });

    it('should handle nodes with no dependencies first', () => {
      let workflow = createTestWorkflow();
      const independentNode: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'independent',
        nodeType: 'process',
      };
      workflow = addNode(workflow, independentNode);
      workflow = addConnection(workflow, 'independent.output', 'Exit.output');

      const order = getTopologicalOrder(workflow);

      expect(order).toContain('independent');
      expect(order).toContain('node1');
      const independentIndex = order.indexOf('independent');
      const node1Index = order.indexOf('node1');
      expect(independentIndex).toBeLessThan(order.indexOf('node2'));
      expect(node1Index).toBeLessThan(order.indexOf('node2'));
    });

    it('should throw on cyclic dependencies', () => {
      let workflow = createTestWorkflow();
      workflow = addConnection(workflow, 'node3.result', 'node1.input');

      expect(() => getTopologicalOrder(workflow)).toThrow(/cycles/);
    });
  });

  describe('getExecutionGroups', () => {
    it('should group nodes by execution level', () => {
      const workflow = createTestWorkflow();

      const groups = getExecutionGroups(workflow);

      expect(groups).toHaveLength(3);
      expect(groups[0]).toEqual(['node1']);
      expect(groups[1]).toEqual(['node2']);
      expect(groups[2]).toEqual(['node3']);
    });

    it('should group parallel nodes in same level', () => {
      let workflow = createTestWorkflow();
      const parallel1: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'parallel1',
        nodeType: 'process',
      };
      const parallel2: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'parallel2',
        nodeType: 'process',
      };
      workflow = addNode(workflow, parallel1);
      workflow = addNode(workflow, parallel2);
      workflow = addConnection(workflow, 'Start.x', 'parallel1.input');
      workflow = addConnection(workflow, 'Start.x', 'parallel2.input');
      workflow = addConnection(workflow, 'parallel1.output', 'Exit.output');
      workflow = addConnection(workflow, 'parallel2.output', 'Exit.output');

      const groups = getExecutionGroups(workflow);

      const firstGroup = groups[0];
      expect(firstGroup).toContain('node1');
      expect(firstGroup).toContain('parallel1');
      expect(firstGroup).toContain('parallel2');
    });

    it('should throw on cyclic dependencies', () => {
      let workflow = createTestWorkflow();
      workflow = addConnection(workflow, 'node3.result', 'node1.input');

      expect(() => getExecutionGroups(workflow)).toThrow(/cycles/);
    });
  });
});

describe('Query API - Statistics', () => {
  describe('countNodes', () => {
    it('should count all nodes', () => {
      const workflow = createTestWorkflow();

      const count = countNodes(workflow);

      expect(count).toBe(3);
    });

    it('should count with filter', () => {
      const workflow = createTestWorkflow();

      const count = countNodes(workflow, { type: 'process' });

      expect(count).toBe(2);
    });
  });

  describe('countConnections', () => {
    it('should count all connections', () => {
      const workflow = createTestWorkflow();

      const count = countConnections(workflow);

      expect(count).toBe(4);
    });

    it('should count connections for specific node', () => {
      const workflow = createTestWorkflow();

      const count = countConnections(workflow, 'node2');

      expect(count).toBe(2);
    });
  });

  describe('countNodeTypes', () => {
    it('should count node type definitions', () => {
      const workflow = createTestWorkflow();

      const count = countNodeTypes(workflow);

      expect(count).toBe(2);
    });
  });

  describe('findIsolatedNodes', () => {
    it('should find nodes with no connections', () => {
      let workflow = createTestWorkflow();
      const isolated: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'isolated',
        nodeType: 'process',
      };
      workflow = addNode(workflow, isolated);

      const isolatedNodes = findIsolatedNodes(workflow);

      expect(isolatedNodes).toEqual(['isolated']);
    });

    it('should return empty array when all nodes connected', () => {
      const workflow = createTestWorkflow();

      const isolatedNodes = findIsolatedNodes(workflow);

      expect(isolatedNodes).toHaveLength(0);
    });
  });

  describe('findUnusedNodeTypes', () => {
    it('should find node types with no instances', () => {
      const workflow = createTestWorkflow();
      workflow.nodeTypes.push({
        type: 'NodeType',
        name: 'unused',
        functionName: 'unusedFunc',
        inputs: {},
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      });

      const unused = findUnusedNodeTypes(workflow);

      expect(unused).toEqual(['unused']);
    });

    it('should return empty array when all types used', () => {
      const workflow = createTestWorkflow();

      const unused = findUnusedNodeTypes(workflow);

      expect(unused).toHaveLength(0);
    });
  });

  describe('findDeadEnds', () => {
    it('should find nodes with no path to Exit', () => {
      let workflow = createTestWorkflow();
      const deadEnd: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'deadEnd',
        nodeType: 'process',
      };
      workflow = addNode(workflow, deadEnd);
      workflow = addConnection(workflow, 'Start.x', 'deadEnd.input');

      const deadEnds = findDeadEnds(workflow);

      expect(deadEnds).toContain('deadEnd');
    });

    it('should return empty array when all nodes reach Exit', () => {
      const workflow = createTestWorkflow();

      const deadEnds = findDeadEnds(workflow);

      expect(deadEnds).toHaveLength(0);
    });
  });
});

describe('Scoped workflow queries', () => {
  describe('getTopologicalOrder', () => {
    it('should succeed (no throw) on scoped workflow', () => {
      const workflow = createScopedWorkflow();
      expect(() => getTopologicalOrder(workflow)).not.toThrow();
    });

    it('should return only main-flow nodes (not scoped children)', () => {
      const workflow = createScopedWorkflow();
      const order = getTopologicalOrder(workflow);
      expect(order).toContain('forEach1');
      expect(order).not.toContain('child1');
    });
  });

  describe('getExecutionGroups', () => {
    it('should succeed on scoped workflow', () => {
      const workflow = createScopedWorkflow();
      expect(() => getExecutionGroups(workflow)).not.toThrow();
    });

    it('should not include scoped children in groups', () => {
      const workflow = createScopedWorkflow();
      const groups = getExecutionGroups(workflow);
      const allNodes = groups.flat();
      expect(allNodes).toContain('forEach1');
      expect(allNodes).not.toContain('child1');
    });
  });

  describe('getDependencies', () => {
    it('should return empty for scoped child (scoped connections filtered)', () => {
      const workflow = createScopedWorkflow();
      const deps = getDependencies(workflow, 'child1');
      expect(deps).toHaveLength(0);
    });
  });

  describe('getDependents', () => {
    it('should not include scoped children as dependents of parent', () => {
      const workflow = createScopedWorkflow();
      const dependents = getDependents(workflow, 'forEach1');
      expect(dependents).not.toContain('child1');
    });
  });

  describe('findDeadEnds', () => {
    it('should not flag scoped children as dead ends', () => {
      const workflow = createScopedWorkflow();
      const deadEnds = findDeadEnds(workflow);
      expect(deadEnds).not.toContain('child1');
    });
  });

  describe('findIsolatedNodes', () => {
    it('should not flag scoped children as isolated', () => {
      const workflow = createScopedWorkflow();
      const isolated = findIsolatedNodes(workflow);
      expect(isolated).not.toContain('child1');
    });
  });
});

describe('Query API - Data Dependencies', () => {
  function createWorkflowWithControlAndData(): TWorkflowAST {
    const nodeTypeA: TNodeTypeAST = {
      type: 'NodeType',
      name: 'nodeTypeA',
      functionName: 'nodeTypeA',
      inputs: { execute: { dataType: 'STEP' }, input: { dataType: 'NUMBER', optional: true } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const nodeTypeB: TNodeTypeAST = {
      type: 'NodeType',
      name: 'nodeTypeB',
      functionName: 'nodeTypeB',
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'NUMBER', optional: true } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        output: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    return {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [nodeTypeA, nodeTypeB],
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeTypeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeTypeB' },
      ],
      connections: [
        // Start -> a
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'a', port: 'execute' },
        },
        // a -> b via control flow (onSuccess)
        {
          type: 'Connection',
          from: { node: 'a', port: 'onSuccess' },
          to: { node: 'b', port: 'execute' },
        },
        // a -> b via data flow (result -> data)
        {
          type: 'Connection',
          from: { node: 'a', port: 'result' },
          to: { node: 'b', port: 'data' },
        },
        // b -> Exit
        {
          type: 'Connection',
          from: { node: 'b', port: 'output' },
          to: { node: 'Exit', port: 'result' },
        },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
    };
  }

  describe('getDataDependencies', () => {
    it('should return only data dependencies, excluding control flow', () => {
      const workflow = createWorkflowWithControlAndData();

      const deps = getDataDependencies(workflow, 'b');

      expect(deps).toEqual(['a']);
    });

    it('should return empty array for node with only control flow connections', () => {
      const workflow = createWorkflowWithControlAndData();
      // Remove the data connection a.result -> b.data
      workflow.connections = workflow.connections.filter(
        (c) => !(c.from.node === 'a' && c.from.port === 'result')
      );

      const deps = getDataDependencies(workflow, 'b');

      expect(deps).toHaveLength(0);
    });

    it('should return empty array for first node (from Start only via execute)', () => {
      const workflow = createWorkflowWithControlAndData();

      const deps = getDataDependencies(workflow, 'a');

      expect(deps).toHaveLength(0);
    });

    it('should include Start when it provides data (not just execute)', () => {
      const workflow = createWorkflowWithControlAndData();
      // Add a data connection from Start to node b
      workflow.connections.push({
        type: 'Connection',
        from: { node: 'Start', port: 'prefix' },
        to: { node: 'b', port: 'data' },
      });
      workflow.startPorts.prefix = { dataType: 'STRING' };

      const deps = getDataDependencies(workflow, 'b');

      expect(deps).toContain('Start');
    });

    it('should NOT include Start when only execute port is connected', () => {
      const workflow = createWorkflowWithControlAndData();
      // Add Start.execute -> b.execute (control flow only)
      workflow.connections.push({
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: 'b', port: 'execute' },
      });

      const deps = getDataDependencies(workflow, 'b');

      // Start should not appear because execute is STEP (control flow)
      expect(deps).not.toContain('Start');
    });
  });
});

describe('Query API - Disconnected Output Ports', () => {
  function createWorkflowWithDisconnectedPort(): TWorkflowAST {
    const nodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'calc',
      functionName: 'calc',
      inputs: { execute: { dataType: 'STEP' }, input: { dataType: 'NUMBER', optional: true } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
        extra: { dataType: 'STRING' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    return {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [nodeType],
      instances: [{ type: 'NodeInstance', id: 'calc1', nodeType: 'calc' }],
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'calc1', port: 'execute' },
        },
        // Only connect result, not extra
        {
          type: 'Connection',
          from: { node: 'calc1', port: 'result' },
          to: { node: 'Exit', port: 'output' },
        },
        {
          type: 'Connection',
          from: { node: 'calc1', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { output: { dataType: 'NUMBER' }, onSuccess: { dataType: 'STEP' } },
      imports: [],
    };
  }

  describe('findDisconnectedOutputPorts', () => {
    it('should find node with unused data output port', () => {
      const workflow = createWorkflowWithDisconnectedPort();

      const results = findDisconnectedOutputPorts(workflow);

      expect(results).toHaveLength(1);
      expect(results[0].nodeId).toBe('calc1');
      expect(results[0].ports).toContain('extra');
      // result is connected, should not appear
      expect(results[0].ports).not.toContain('result');
    });

    it('should return empty when all outputs are connected', () => {
      const workflow = createWorkflowWithDisconnectedPort();
      // Connect the extra port too
      workflow.connections.push({
        type: 'Connection',
        from: { node: 'calc1', port: 'extra' },
        to: { node: 'Exit', port: 'extra' },
      });
      workflow.exitPorts.extra = { dataType: 'STRING' };

      const results = findDisconnectedOutputPorts(workflow);

      expect(results).toHaveLength(0);
    });

    it('should exclude control flow ports even when unconnected', () => {
      const workflow = createWorkflowWithDisconnectedPort();
      // Remove the onSuccess connection to Exit
      workflow.connections = workflow.connections.filter(
        (c) => !(c.from.node === 'calc1' && c.from.port === 'onSuccess')
      );

      const results = findDisconnectedOutputPorts(workflow);

      // Should still only report 'extra', not 'onSuccess' or 'onFailure'
      const calc1 = results.find((r) => r.nodeId === 'calc1');
      expect(calc1).toBeDefined();
      expect(calc1!.ports).toContain('extra');
      expect(calc1!.ports).not.toContain('onSuccess');
      expect(calc1!.ports).not.toContain('onFailure');
    });
  });

  describe('findDeadEndDetails', () => {
    it('WU12: should return both dead-end nodes and disconnected output ports', () => {
      const workflow = createWorkflowWithDisconnectedPort();

      const details = findDeadEndDetails(workflow);

      expect(details).toBeDefined();
      expect(details.deadEndNodes).toBeDefined();
      expect(details.disconnectedOutputs).toBeDefined();
      // calc1 reaches Exit so it's not a dead-end
      expect(details.deadEndNodes).not.toContain('calc1');
      // But calc1 has 'extra' port disconnected
      expect(details.disconnectedOutputs).toHaveLength(1);
      expect(details.disconnectedOutputs[0].nodeId).toBe('calc1');
      expect(details.disconnectedOutputs[0].ports).toContain('extra');
    });

    it('WU12: should identify actual dead-end nodes', () => {
      const workflow = createWorkflowWithDisconnectedPort();
      // Add a node that doesn't reach Exit
      const deadNodeType = {
        type: 'NodeType' as const,
        name: 'deadProc',
        functionName: 'deadProc',
        inputs: { execute: { dataType: 'STEP' } },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION' as const,
      };
      workflow.nodeTypes.push(deadNodeType);
      workflow.instances.push({
        type: 'NodeInstance',
        id: 'deadNode',
        nodeType: 'deadProc',
      });
      workflow.connections.push({
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: 'deadNode', port: 'execute' },
      });

      const details = findDeadEndDetails(workflow);

      expect(details.deadEndNodes).toContain('deadNode');
    });
  });
});
