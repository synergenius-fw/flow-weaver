import { describe, it, expect } from 'vitest';
import {
  computeNodeDimensions,
  computePortPositions,
  computeConnectionPath,
  computeBezierPath,
  buildDiagramGraph,
  PORT_SIZE,
  PORT_GAP,
  NODE_MIN_WIDTH,
  NODE_MIN_HEIGHT,
} from '../../../src/diagram/geometry';
import type { DiagramNode, DiagramPort } from '../../../src/diagram/types';
import { createSimpleWorkflow, createParallelWorkflow, createScopedWorkflow } from '../../helpers/test-fixtures';

function makePort(name: string, direction: 'INPUT' | 'OUTPUT'): DiagramPort {
  return { name, label: name, dataType: 'NUMBER', direction, isControlFlow: false, isFailure: false, cx: 0, cy: 0 };
}

function makeNode(id: string, inputs: DiagramPort[], outputs: DiagramPort[], isVirtual = false): DiagramNode {
  return {
    id, label: id, color: '#334155', isVirtual,
    inputs, outputs,
    x: 0, y: 0, width: NODE_MIN_WIDTH, height: NODE_MIN_HEIGHT,
  };
}

describe('computeNodeDimensions', () => {
  it('assigns minimum dimensions for a node with 1 port', () => {
    const node = makeNode('n', [makePort('a', 'INPUT')], []);
    computeNodeDimensions(node);
    expect(node.width).toBe(NODE_MIN_WIDTH);
    expect(node.height).toBe(NODE_MIN_HEIGHT);
  });

  it('increases height when a node has many ports', () => {
    const inputs = Array.from({ length: 5 }, (_, i) => makePort(`p${i}`, 'INPUT'));
    const node = makeNode('n', inputs, []);
    computeNodeDimensions(node);
    expect(node.height).toBeGreaterThan(NODE_MIN_HEIGHT);
  });

  it('assigns rectangular dimensions for virtual nodes (same as regular)', () => {
    const node = makeNode('Start', [], [], true);
    computeNodeDimensions(node);
    expect(node.width).toBe(NODE_MIN_WIDTH);
    expect(node.height).toBe(NODE_MIN_HEIGHT);
  });
});

describe('computePortPositions', () => {
  it('places input ports on the left edge', () => {
    const node = makeNode('n', [makePort('a', 'INPUT')], []);
    node.x = 100; node.y = 50; node.width = 120; node.height = 100;
    computePortPositions(node);
    expect(node.inputs[0].cx).toBe(100); // left edge
  });

  it('places output ports on the right edge', () => {
    const node = makeNode('n', [], [makePort('a', 'OUTPUT')]);
    node.x = 100; node.y = 50; node.width = 120; node.height = 100;
    computePortPositions(node);
    expect(node.outputs[0].cx).toBe(220); // right edge
  });

  it('positions ports from the top with consistent padding', () => {
    const node = makeNode('n', [makePort('a', 'INPUT'), makePort('b', 'INPUT')], []);
    node.x = 0; node.y = 0; node.width = 120; node.height = 100;
    computePortPositions(node);

    // First port should be at paddingTop + portSize/2 = 18 + 7 = 25
    expect(node.inputs[0].cy).toBe(25);
    // Second port at paddingTop + (size+gap) + portSize/2 = 18 + 22 + 7 = 47
    expect(node.inputs[1].cy).toBe(47);
  });

  it('uses correct port spacing', () => {
    const inputs = [makePort('a', 'INPUT'), makePort('b', 'INPUT'), makePort('c', 'INPUT')];
    const node = makeNode('n', inputs, []);
    node.x = 0; node.y = 0; node.width = 120; node.height = 200;
    computePortPositions(node);

    const spacing = node.inputs[1].cy - node.inputs[0].cy;
    expect(spacing).toBe(PORT_SIZE + PORT_GAP);
  });
});

describe('computeConnectionPath', () => {
  it('returns a valid SVG path with M, L, Q commands', () => {
    const path = computeConnectionPath(0, 0, 200, 100);
    expect(path).toContain('M ');
    expect(path).toContain('L ');
    expect(path).toContain('Q ');
  });

  it('produces different paths for different distances', () => {
    const nearPath = computeConnectionPath(0, 0, 100, 0);
    const farPath = computeConnectionPath(0, 0, 500, 0);
    expect(nearPath).not.toBe(farPath);
  });

  it('legacy computeBezierPath delegates to computeConnectionPath', () => {
    const legacyPath = computeBezierPath(0, 0, 200, 100);
    const newPath = computeConnectionPath(0, 0, 200, 100);
    expect(legacyPath).toBe(newPath);
  });
});

describe('buildDiagramGraph', () => {
  it('builds a graph from a simple workflow', () => {
    const ast = createSimpleWorkflow();
    const graph = buildDiagramGraph(ast);

    expect(graph.nodes.length).toBe(3); // Start, node1, Exit
    expect(graph.connections.length).toBeGreaterThan(0);
    expect(graph.workflowName).toBe('testWorkflow');
  });

  it('builds a graph from a parallel workflow', () => {
    const ast = createParallelWorkflow();
    const graph = buildDiagramGraph(ast);

    // Start + node1 + node2 + node3 + Exit = 5
    expect(graph.nodes.length).toBe(5);
  });

  it('computes positive bounds', () => {
    const ast = createSimpleWorkflow();
    const graph = buildDiagramGraph(ast);

    expect(graph.bounds.width).toBeGreaterThan(0);
    expect(graph.bounds.height).toBeGreaterThan(0);
  });

  it('all node coordinates are positive after normalization', () => {
    const ast = createSimpleWorkflow();
    const graph = buildDiagramGraph(ast);

    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('ensures mandatory STEP ports on Start and Exit', () => {
    const ast = createSimpleWorkflow(); // startPorts only has 'x', no 'execute'
    const graph = buildDiagramGraph(ast);

    const start = graph.nodes.find(n => n.id === 'Start')!;
    const exit = graph.nodes.find(n => n.id === 'Exit')!;

    expect(start.outputs.find(p => p.name === 'execute')).toBeDefined();
    expect(exit.inputs.find(p => p.name === 'onSuccess')).toBeDefined();
    expect(exit.inputs.find(p => p.name === 'onFailure')).toBeDefined();
  });

  it('uses node type label as fallback when instance has no label', () => {
    const ast = createSimpleWorkflow();
    // Add a label to the node type
    ast.nodeTypes[0].label = 'Data Processor';
    // Instance has no config.label set
    const graph = buildDiagramGraph(ast);

    const node1 = graph.nodes.find(n => n.id === 'node1')!;
    expect(node1.label).toBe('Data Processor');
  });

  it('prefers instance label over node type label', () => {
    const ast = createSimpleWorkflow();
    ast.nodeTypes[0].label = 'Data Processor';
    ast.instances[0].config = { label: 'My Custom Label' };
    const graph = buildDiagramGraph(ast);

    const node1 = graph.nodes.find(n => n.id === 'node1')!;
    expect(node1.label).toBe('My Custom Label');
  });

  it('falls back to instance ID when neither instance nor node type has label', () => {
    const ast = createSimpleWorkflow();
    // No label on node type, no config on instance
    const graph = buildDiagramGraph(ast);

    const node1 = graph.nodes.find(n => n.id === 'node1')!;
    expect(node1.label).toBe('node1');
  });

  it('uses port definition label for port display label', () => {
    const ast = createSimpleWorkflow();
    // Add labels to the port definitions
    ast.nodeTypes[0].inputs.input.label = 'Input Value';
    ast.nodeTypes[0].outputs.output.label = 'Output Result';
    const graph = buildDiagramGraph(ast);

    const node1 = graph.nodes.find(n => n.id === 'node1')!;
    const inputPort = node1.inputs.find(p => p.name === 'input')!;
    const outputPort = node1.outputs.find(p => p.name === 'output')!;

    expect(inputPort.label).toBe('Input Value');
    expect(outputPort.label).toBe('Output Result');
  });

  it('falls back to port name when no label is defined', () => {
    const ast = createSimpleWorkflow();
    // No labels on port definitions (default)
    const graph = buildDiagramGraph(ast);

    const node1 = graph.nodes.find(n => n.id === 'node1')!;
    const inputPort = node1.inputs.find(p => p.name === 'input')!;
    expect(inputPort.label).toBe('input');
  });
});

describe('buildDiagramGraph — scoped workflows', () => {
  it('expands scoped parent to contain children', () => {
    const ast = createScopedWorkflow();
    const graph = buildDiagramGraph(ast);

    const forEachNode = graph.nodes.find(n => n.id === 'forEach1')!;
    // Parent should be wider than NODE_MIN_WIDTH to fit scope children
    expect(forEachNode.width).toBeGreaterThan(NODE_MIN_WIDTH);
  });

  it('populates scopeChildren on the scoped parent', () => {
    const ast = createScopedWorkflow();
    const graph = buildDiagramGraph(ast);

    const forEachNode = graph.nodes.find(n => n.id === 'forEach1')!;
    expect(forEachNode.scopeChildren).toBeDefined();
    expect(forEachNode.scopeChildren!.length).toBe(1);
    expect(forEachNode.scopeChildren![0].id).toBe('child1');
  });

  it('positions scope children inside parent bounds', () => {
    const ast = createScopedWorkflow();
    const graph = buildDiagramGraph(ast);

    const parent = graph.nodes.find(n => n.id === 'forEach1')!;
    const child = parent.scopeChildren![0];

    expect(child.x).toBeGreaterThan(parent.x);
    expect(child.y).toBeGreaterThanOrEqual(parent.y);
    expect(child.x + child.width).toBeLessThan(parent.x + parent.width);
    expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height);
  });

  it('creates scopePorts for scoped inner-edge ports', () => {
    const ast = createScopedWorkflow();
    const graph = buildDiagramGraph(ast);

    const parent = graph.nodes.find(n => n.id === 'forEach1')!;
    expect(parent.scopePorts).toBeDefined();
    // Scoped outputs: start, item
    expect(parent.scopePorts!.outputs.length).toBeGreaterThan(0);
    // Scoped inputs: success, failure, processed
    expect(parent.scopePorts!.inputs.length).toBeGreaterThan(0);
  });

  it('builds scope connections between parent scoped ports and children', () => {
    const ast = createScopedWorkflow();
    const graph = buildDiagramGraph(ast);

    const parent = graph.nodes.find(n => n.id === 'forEach1')!;
    expect(parent.scopeConnections).toBeDefined();
    expect(parent.scopeConnections!.length).toBeGreaterThan(0);

    // Should have connections like forEach1.start → child1.execute
    const startConn = parent.scopeConnections!.find(
      c => c.fromPort === 'start' && c.toPort === 'execute',
    );
    expect(startConn).toBeDefined();
  });

  it('does not include scoped children in main graph nodes', () => {
    const ast = createScopedWorkflow();
    const graph = buildDiagramGraph(ast);

    const mainNodeIds = graph.nodes.map(n => n.id);
    expect(mainNodeIds).not.toContain('child1');
    // But child1 should be inside forEach1's scopeChildren
    expect(mainNodeIds).toContain('forEach1');
  });

  it('does not include scoped connections in main graph connections', () => {
    const ast = createScopedWorkflow();
    const graph = buildDiagramGraph(ast);

    // Main connections should not reference scoped ports
    for (const conn of graph.connections) {
      // No connection should be from/to child1 in the main graph
      expect(conn.fromNode).not.toBe('child1');
      expect(conn.toNode).not.toBe('child1');
    }
  });
});
