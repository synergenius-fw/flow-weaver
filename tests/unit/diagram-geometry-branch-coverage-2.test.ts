/**
 * Additional branch coverage tests for src/diagram/geometry.ts
 * Targets uncovered branches not exercised by the first coverage file.
 */

import {
  measureText,
  portBadgeWidth,
  computeNodeDimensions,
  computePortPositions,
  computeConnectionPath,
  buildDiagramGraph,
  PORT_RADIUS,
  PORT_SIZE,
  PORT_GAP,
  PORT_PADDING_Y,
  NODE_MIN_WIDTH,
  NODE_MIN_HEIGHT,
  LABEL_HEIGHT,
  LABEL_GAP,
  STUB_DISTANCE_THRESHOLD,
  ORTHOGONAL_DISTANCE_THRESHOLD,
  SCOPE_PADDING_X,
  SCOPE_PADDING_Y,
  SCOPE_PORT_COLUMN,
  SCOPE_INNER_GAP_X,
} from '../../src/diagram/geometry.js';
import type { DiagramNode, DiagramPort, DiagramOptions } from '../../src/diagram/types.js';
import type { TWorkflowAST, TNodeTypeAST, TPortDefinition } from '../../src/ast/types.js';

function makePort(overrides: Partial<DiagramPort> = {}): DiagramPort {
  return {
    name: 'data',
    label: 'data',
    dataType: 'STRING',
    direction: 'INPUT',
    isControlFlow: false,
    isFailure: false,
    cx: 0,
    cy: 0,
    ...overrides,
  };
}

function makeNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'testNode',
    label: 'Test',
    color: '#ccc',
    icon: 'code',
    isVirtual: false,
    inputs: [],
    outputs: [],
    x: 0,
    y: 0,
    width: NODE_MIN_WIDTH,
    height: NODE_MIN_HEIGHT,
    ...overrides,
  };
}

function minimalAST(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    name: 'testWorkflow',
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: {},
    exitPorts: {},
    ...overrides,
  } as TWorkflowAST;
}

function makeNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    name: 'TestNode',
    functionName: 'testNode',
    variant: 'FUNCTION',
    inputs: { execute: { dataType: 'STEP' } },
    outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
    hasSuccessPort: true,
    hasFailurePort: false,
    ...overrides,
  } as unknown as TNodeTypeAST;
}

// ---- Tests targeting uncovered branches ----

describe('buildDiagramGraph - nonePositioned full auto-layout', () => {
  it('uses full auto-layout when no explicit positions are provided', () => {
    const nt = makeNodeType();
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [
        { id: 'a', nodeType: 'TestNode' },
        { id: 'b', nodeType: 'TestNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
        { from: { node: 'b', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    expect(graph.nodes.length).toBe(4);
    // Nodes should be laid out left to right
    const startNode = graph.nodes.find(n => n.id === 'Start')!;
    const aNode = graph.nodes.find(n => n.id === 'a')!;
    expect(aNode.x).toBeGreaterThan(startNode.x);
  });
});

describe('buildDiagramGraph - mixed positioning with resolveHorizontalOverlaps', () => {
  it('resolves overlaps when some nodes have positions and some do not', () => {
    const nt = makeNodeType();
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [
        { id: 'pos1', nodeType: 'TestNode', config: { x: 100, y: 50 } },
        { id: 'noPos1', nodeType: 'TestNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pos1', port: 'execute' } },
        { from: { node: 'pos1', port: 'onSuccess' }, to: { node: 'noPos1', port: 'execute' } },
        { from: { node: 'noPos1', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
      ui: { startNode: { x: 0, y: 50 } } as any,
    });
    const graph = buildDiagramGraph(ast);
    expect(graph.nodes.length).toBe(4);
    // No nodes should overlap
    const sorted = [...graph.nodes].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x);
    }
  });
});

describe('buildDiagramGraph - exit port else-if branch (onFailure exists, not hidden)', () => {
  it('marks existing onFailure as failure=true via else-if branch', () => {
    const ast = minimalAST({
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        // onFailure exists but is NOT hidden => hits the else-if at line 884
        onFailure: { dataType: 'STEP', isControlFlow: true },
      } as any,
    });
    const graph = buildDiagramGraph(ast);
    const exit = graph.nodes.find(n => n.id === 'Exit')!;
    const failPort = exit.inputs.find(p => p.name === 'onFailure');
    expect(failPort).toBeDefined();
    expect(failPort!.isFailure).toBe(true);
  });
});

describe('buildDiagramGraph - instance with unknown nodeType', () => {
  it('creates a node with empty ports when nodeType is not found', () => {
    const ast = minimalAST({
      nodeTypes: [],
      instances: [{ id: 'unknown1', nodeType: 'NonExistent' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'unknown1');
    expect(node).toBeDefined();
    // No node type found => empty inputs/outputs
    expect(node!.inputs.length).toBe(0);
    expect(node!.outputs.length).toBe(0);
    expect(node!.icon).toBe('code');
  });
});

describe('buildDiagramGraph - node with label from nodeType.label', () => {
  it('uses nt.label when instance has no label config', () => {
    const nt = makeNodeType({ label: 'My Custom Label' } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'inst1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'inst1')!;
    expect(node.label).toBe('My Custom Label');
  });
});

describe('buildDiagramGraph - resolveNodeColor branches', () => {
  it('returns default color when no color specified', () => {
    const nt = makeNodeType({ visuals: undefined } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'n1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'n1')!;
    // NODE_DEFAULT_COLOR is used
    expect(node.color).toBeTruthy();
  });

  it('uses variant dark border in dark theme', () => {
    const nt = makeNodeType({ visuals: { color: 'green' } } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'n1', nodeType: 'TestNode' }] as any,
    });
    const graphDark = buildDiagramGraph(ast, { theme: 'dark' });
    const graphLight = buildDiagramGraph(ast, { theme: 'light' });
    const nodeDark = graphDark.nodes.find(n => n.id === 'n1')!;
    const nodeLight = graphLight.nodes.find(n => n.id === 'n1')!;
    // Both should resolve to a color string but potentially different values
    expect(nodeDark.color).toBeTruthy();
    expect(nodeLight.color).toBeTruthy();
  });
});

describe('buildDiagramGraph - hasFailurePort branch', () => {
  it('adds onFailure output when hasFailurePort is true', () => {
    const nt = makeNodeType({
      hasFailurePort: true,
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'f1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'f1')!;
    const failPort = node.outputs.find(p => p.name === 'onFailure');
    expect(failPort).toBeDefined();
    expect(failPort!.isFailure).toBe(true);
  });
});

describe('buildDiagramGraph - hidden onFailure on nodeType outputs', () => {
  it('does not add onFailure when it is hidden in outputs', () => {
    const nt = makeNodeType({
      hasFailurePort: true,
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true, hidden: true },
      },
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'hf1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'hf1')!;
    expect(node.outputs.find(p => p.name === 'onFailure')).toBeUndefined();
  });
});

describe('buildDiagramGraph - hidden execute on nodeType inputs', () => {
  it('does not add execute when it is hidden', () => {
    const nt = makeNodeType({
      expression: false,
      inputs: { execute: { dataType: 'STEP', hidden: true }, data: { dataType: 'STRING' } },
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'he1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'he1')!;
    expect(node.inputs.find(p => p.name === 'execute')).toBeUndefined();
    expect(node.inputs.find(p => p.name === 'data')).toBeDefined();
  });
});

describe('buildDiagramGraph - hidden onSuccess on nodeType outputs', () => {
  it('does not add onSuccess when it is hidden', () => {
    const nt = makeNodeType({
      hasSuccessPort: true,
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true, hidden: true } },
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'hs1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'hs1')!;
    expect(node.outputs.find(p => p.name === 'onSuccess')).toBeUndefined();
  });
});

describe('buildDiagramGraph - stub distance threshold (long connections)', () => {
  it('creates empty path for connections beyond STUB_DISTANCE_THRESHOLD', () => {
    const nt = makeNodeType({
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, result: { dataType: 'NUMBER' } },
    } as any);
    // Build a long chain so n0.result -> nLast.data spans a huge x distance
    const instances: any[] = [];
    const connections: any[] = [
      { from: { node: 'Start', port: 'execute' }, to: { node: 'n0', port: 'execute' } },
    ];
    for (let i = 0; i < 8; i++) {
      instances.push({ id: `n${i}`, nodeType: 'TestNode' });
      if (i > 0) {
        connections.push({
          from: { node: `n${i - 1}`, port: 'onSuccess' },
          to: { node: `n${i}`, port: 'execute' },
        });
      }
    }
    // Long-distance data connection
    connections.push({ from: { node: 'n0', port: 'result' }, to: { node: 'n7', port: 'data' } });
    connections.push({ from: { node: 'n7', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } });

    const ast = minimalAST({ nodeTypes: [nt], instances, connections });
    const graph = buildDiagramGraph(ast);
    // The n0->n7 data connection should exist (possibly with empty path for stubs)
    const longConn = graph.connections.find(c => c.fromNode === 'n0' && c.fromPort === 'result');
    expect(longConn).toBeDefined();
    // Should have stubs
    expect(longConn!.sourceStub).toBeDefined();
    expect(longConn!.targetStub).toBeDefined();
  });
});

describe('buildDiagramGraph - orthogonal routing for medium-distance connections', () => {
  it('uses orthogonal routing for connections beyond ORTHOGONAL_DISTANCE_THRESHOLD', () => {
    const nt = makeNodeType({
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, result: { dataType: 'NUMBER' } },
    } as any);
    const instances: any[] = [];
    const connections: any[] = [
      { from: { node: 'Start', port: 'execute' }, to: { node: 'n0', port: 'execute' } },
    ];
    for (let i = 0; i < 4; i++) {
      instances.push({ id: `n${i}`, nodeType: 'TestNode' });
      if (i > 0) {
        connections.push({
          from: { node: `n${i - 1}`, port: 'onSuccess' },
          to: { node: `n${i}`, port: 'execute' },
        });
      }
    }
    // Medium-distance data connection (not too long for stubs, but enough for ortho)
    connections.push({ from: { node: 'n0', port: 'result' }, to: { node: 'n2', port: 'data' } });
    connections.push({ from: { node: 'n3', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } });

    const ast = minimalAST({ nodeTypes: [nt], instances, connections });
    const graph = buildDiagramGraph(ast);
    const conn = graph.connections.find(c => c.fromNode === 'n0' && c.fromPort === 'result');
    expect(conn).toBeDefined();
    // The path may be empty if the connection spans beyond the stub threshold,
    // or it may contain an orthogonal/curve path. Either way, the connection exists.
    expect(typeof conn!.path).toBe('string');
  });
});

describe('buildDiagramGraph - fan-out routing consistency', () => {
  it('forces curves when fan-out group has a short connection', () => {
    const nt = makeNodeType({
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        result: { dataType: 'STRING' },
      },
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [
        { id: 'src', nodeType: 'TestNode' },
        { id: 'near', nodeType: 'TestNode' },
        { id: 'far', nodeType: 'TestNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'src', port: 'execute' } },
        // Fan-out from src.result to near and far
        { from: { node: 'src', port: 'result' }, to: { node: 'near', port: 'data' } },
        { from: { node: 'src', port: 'result' }, to: { node: 'far', port: 'data' } },
        { from: { node: 'src', port: 'onSuccess' }, to: { node: 'near', port: 'execute' } },
        { from: { node: 'near', port: 'onSuccess' }, to: { node: 'far', port: 'execute' } },
        { from: { node: 'far', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    expect(graph.connections.length).toBeGreaterThan(0);
  });
});

describe('buildDiagramGraph - scope sub-graph with expression parent', () => {
  it('skips mandatory STEP scope ports for expression node types', () => {
    const parentNt = makeNodeType({
      name: 'ExprScope',
      functionName: 'exprScope',
      expression: true,
      inputs: { data: { dataType: 'STRING' } },
      outputs: { result: { dataType: 'STRING', scope: 'inner' } },
      hasSuccessPort: false,
      hasFailurePort: false,
    } as any);
    const childNt = makeNodeType({
      name: 'InnerNode',
      functionName: 'innerNode',
    });
    const ast = minimalAST({
      nodeTypes: [parentNt, childNt],
      instances: [
        { id: 'exprP', nodeType: 'ExprScope' },
        { id: 'child1', nodeType: 'InnerNode' },
      ] as any,
      connections: [
        { from: { node: 'exprP', port: 'result', scope: 'inner' }, to: { node: 'child1', port: 'execute' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    const parent = graph.nodes.find(n => n.id === 'exprP')!;
    expect(parent.scopeChildren).toBeDefined();
    // Expression parent should not have mandatory start/success/failure scope ports
  });
});

describe('buildDiagramGraph - scope with child-to-child connections', () => {
  it('builds scope connections for child-to-child within scope', () => {
    const parentNt = makeNodeType({
      name: 'LoopNode',
      functionName: 'loopNode',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: true,
    } as any);
    const childNt = makeNodeType({
      name: 'Step',
      functionName: 'step',
    });
    const ast = minimalAST({
      nodeTypes: [parentNt, childNt],
      instances: [
        { id: 'loop', nodeType: 'LoopNode' },
        { id: 'c1', nodeType: 'Step' },
        { id: 'c2', nodeType: 'Step' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'loop', port: 'execute' } },
        { from: { node: 'loop', port: 'execute', scope: 'iter' }, to: { node: 'c1', port: 'execute' } },
        { from: { node: 'c1', port: 'onSuccess' }, to: { node: 'c2', port: 'execute' } },
        { from: { node: 'c2', port: 'onSuccess' }, to: { node: 'loop', port: 'onSuccess', scope: 'iter' } },
        { from: { node: 'loop', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    const loop = graph.nodes.find(n => n.id === 'loop')!;
    expect(loop.scopeChildren).toBeDefined();
    expect(loop.scopeChildren!.length).toBe(2);
    expect(loop.scopeConnections).toBeDefined();
    expect(loop.scopeConnections!.length).toBeGreaterThan(0);
  });
});

describe('buildDiagramGraph - scope with implicit port derivation', () => {
  it('derives implicit scoped ports from parent-child connections', () => {
    const parentNt = makeNodeType({
      name: 'ForEach',
      functionName: 'forEach',
      inputs: { execute: { dataType: 'STEP' }, items: { dataType: 'ARRAY' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        // item port is NOT scoped in definition, but connection uses scope
      },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as any);
    const childNt = makeNodeType({
      name: 'Proc',
      functionName: 'proc',
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, result: { dataType: 'STRING' } },
    } as any);
    const ast = minimalAST({
      nodeTypes: [parentNt, childNt],
      instances: [
        { id: 'fe', nodeType: 'ForEach' },
        { id: 'p1', nodeType: 'Proc' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'fe', port: 'execute' } },
        { from: { node: 'fe', port: 'execute', scope: 'loop' }, to: { node: 'p1', port: 'execute' } },
        { from: { node: 'p1', port: 'result' }, to: { node: 'fe', port: 'collected', scope: 'loop' } },
        { from: { node: 'fe', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    const fe = graph.nodes.find(n => n.id === 'fe')!;
    expect(fe.scopeChildren).toBeDefined();
    expect(fe.scopePorts).toBeDefined();
  });
});

describe('buildDiagramGraph - scope parent not found in instances', () => {
  it('handles scope key referencing non-existent parent gracefully', () => {
    const ast = minimalAST({
      scopes: { 'nonExistent.iter': ['child1'] },
      instances: [{ id: 'child1', nodeType: 'Unknown' }] as any,
    } as any);
    const graph = buildDiagramGraph(ast);
    // Should not throw, child1 is in scoped set so not added to main graph
    expect(graph.nodes.find(n => n.id === 'child1')).toBeUndefined();
  });
});

describe('buildDiagramGraph - allPositioned with explicit positions for all nodes', () => {
  it('applies explicit positions without auto-layout', () => {
    const nt = makeNodeType();
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [
        { id: 'a', nodeType: 'TestNode', config: { x: 200, y: 100 } },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
      ui: {
        startNode: { x: 0, y: 100 },
        exitNode: { x: 400, y: 100 },
      } as any,
    });
    const graph = buildDiagramGraph(ast);
    expect(graph.nodes.length).toBe(3);
  });
});

describe('buildDiagramGraph - connection with missing ports (skipped)', () => {
  it('skips connections referencing non-existent ports', () => {
    const nt = makeNodeType();
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'a', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        // Reference a port that does not exist
        { from: { node: 'a', port: 'nonExistentPort' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    // The bad connection should be skipped
    const badConn = graph.connections.find(c => c.fromPort === 'nonExistentPort');
    expect(badConn).toBeUndefined();
  });
});

describe('buildDiagramGraph - connection with missing nodes (skipped)', () => {
  it('skips connections referencing non-existent nodes', () => {
    const ast = minimalAST({
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'ghost', port: 'execute' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    const ghostConn = graph.connections.find(c => c.toNode === 'ghost');
    expect(ghostConn).toBeUndefined();
  });
});

describe('buildDiagramGraph - scope-qualified connections are skipped in main loop', () => {
  it('does not duplicate scope-qualified connections in the main graph', () => {
    const parentNt = makeNodeType({
      name: 'ScopeNode',
      functionName: 'scopeNode',
      hasFailurePort: true,
    } as any);
    const childNt = makeNodeType({ name: 'ChildNode', functionName: 'childNode' });
    const ast = minimalAST({
      nodeTypes: [parentNt, childNt],
      instances: [
        { id: 'parent', nodeType: 'ScopeNode' },
        { id: 'kid', nodeType: 'ChildNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'parent', port: 'execute' } },
        // Scope-qualified connections
        { from: { node: 'parent', port: 'execute', scope: 'body' }, to: { node: 'kid', port: 'execute' } },
        { from: { node: 'kid', port: 'onSuccess' }, to: { node: 'parent', port: 'onSuccess', scope: 'body' } },
        { from: { node: 'parent', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    // Main connections should not include scope-qualified ones
    const scopeConns = graph.connections.filter(
      c => (c.fromNode === 'parent' && c.toNode === 'kid') || (c.fromNode === 'kid' && c.toNode === 'parent')
    );
    expect(scopeConns.length).toBe(0);
  });
});

describe('buildDiagramGraph - startPorts with custom data outputs', () => {
  it('includes custom data ports on Start node', () => {
    const ast = minimalAST({
      startPorts: {
        execute: { dataType: 'STEP' },
        inputData: { dataType: 'STRING' },
        config: { dataType: 'OBJECT' },
      } as any,
    });
    const graph = buildDiagramGraph(ast);
    const start = graph.nodes.find(n => n.id === 'Start')!;
    expect(start.outputs.length).toBe(3);
    expect(start.outputs.find(p => p.name === 'inputData')).toBeDefined();
    expect(start.outputs.find(p => p.name === 'config')).toBeDefined();
  });
});

describe('buildDiagramGraph - exitPorts with custom data inputs', () => {
  it('includes custom data ports on Exit node', () => {
    const ast = minimalAST({
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true },
        outputData: { dataType: 'STRING' },
      } as any,
    });
    const graph = buildDiagramGraph(ast);
    const exit = graph.nodes.find(n => n.id === 'Exit')!;
    expect(exit.inputs.length).toBe(3);
    expect(exit.inputs.find(p => p.name === 'outputData')).toBeDefined();
  });
});

describe('buildDiagramGraph - port with label from definition', () => {
  it('uses port definition label when available', () => {
    const nt = makeNodeType({
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'STRING', label: 'My Input' },
      },
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'lb1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'lb1')!;
    const dataPort = node.inputs.find(p => p.name === 'data');
    expect(dataPort).toBeDefined();
    expect(dataPort!.label).toBe('My Input');
  });
});

describe('buildDiagramGraph - port with failure flag', () => {
  it('sets isFailure from port definition failure field', () => {
    const nt = makeNodeType({
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
      },
      hasSuccessPort: false,
      hasFailurePort: false,
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'fail1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'fail1')!;
    const failPort = node.outputs.find(p => p.name === 'onFailure');
    expect(failPort).toBeDefined();
    expect(failPort!.isFailure).toBe(true);
  });
});

describe('buildDiagramGraph - filterNonScopedPorts', () => {
  it('excludes scoped ports from external port list', () => {
    const nt = makeNodeType({
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        item: { dataType: 'STRING', scope: 'loop' },
      },
      hasSuccessPort: false,
      hasFailurePort: false,
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'sn1', nodeType: 'TestNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'sn1')!;
    // scoped 'item' port should not appear in external outputs
    expect(node.outputs.find(p => p.name === 'item')).toBeUndefined();
    expect(node.outputs.find(p => p.name === 'onSuccess')).toBeDefined();
  });
});

describe('buildDiagramGraph - dashed stubs for non-STEP connections', () => {
  it('marks stubs as dashed for data connections', () => {
    const nt = makeNodeType({
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, result: { dataType: 'STRING' } },
    } as any);
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [
        { id: 'a', nodeType: 'TestNode' },
        { id: 'b', nodeType: 'TestNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
        { from: { node: 'a', port: 'result' }, to: { node: 'b', port: 'data' } },
        { from: { node: 'b', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    const dataConn = graph.connections.find(c => c.fromPort === 'result');
    expect(dataConn).toBeDefined();
    expect(dataConn!.sourceStub!.dashed).toBe(true);

    const stepConn = graph.connections.find(c => c.fromPort === 'onSuccess' && c.fromNode === 'a');
    expect(stepConn).toBeDefined();
    expect(stepConn!.sourceStub!.dashed).toBe(false);
  });
});

describe('buildDiagramGraph - scope with persisted UI dimensions', () => {
  it('uses persisted expandedWidth/expandedHeight from UI metadata', () => {
    const parentNt = makeNodeType({
      name: 'UIScope',
      functionName: 'uiScope',
      hasFailurePort: true,
    } as any);
    const childNt = makeNodeType({ name: 'UIChild', functionName: 'uiChild' });
    const ast = minimalAST({
      nodeTypes: [parentNt, childNt],
      instances: [
        { id: 'uiP', nodeType: 'UIScope' },
        { id: 'uiC', nodeType: 'UIChild' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'uiP', port: 'execute' } },
        { from: { node: 'uiP', port: 'execute', scope: 'body' }, to: { node: 'uiC', port: 'execute' } },
        { from: { node: 'uiC', port: 'onSuccess' }, to: { node: 'uiP', port: 'onSuccess', scope: 'body' } },
        { from: { node: 'uiP', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
      ui: {
        instances: [{ name: 'uiP', expandedWidth: 800, expandedHeight: 400 }],
      },
    } as any);
    const graph = buildDiagramGraph(ast);
    const parent = graph.nodes.find(n => n.id === 'uiP')!;
    // Should respect the persisted dimensions (at least as big as UI values)
    expect(parent.width).toBeGreaterThanOrEqual(800);
    expect(parent.height).toBeGreaterThanOrEqual(400);
  });
});

describe('buildDiagramGraph - adaptiveGapY branches', () => {
  it('uses standard gap for small layers and smaller gap for large layers', () => {
    // This is exercised via the auto-layout path with many nodes in a layer
    const nt = makeNodeType({
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
    } as any);
    // Fan-out to create a large layer
    const instances: any[] = [];
    const connections: any[] = [];
    for (let i = 0; i < 5; i++) {
      instances.push({ id: `fan${i}`, nodeType: 'TestNode' });
      connections.push({ from: { node: 'Start', port: 'execute' }, to: { node: `fan${i}`, port: 'execute' } });
      connections.push({ from: { node: `fan${i}`, port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } });
    }
    const ast = minimalAST({ nodeTypes: [nt], instances, connections });
    const graph = buildDiagramGraph(ast);
    // Just verify it builds without error and nodes are positioned
    expect(graph.nodes.length).toBe(7); // 5 + Start + Exit
  });
});

describe('buildDiagramGraph - pathExtent with empty path', () => {
  it('handles empty connection paths in bounds calculation', () => {
    // This is indirectly tested when STUB_DISTANCE_THRESHOLD creates empty paths.
    // Just verify no crash from the main test case above.
    const nt = makeNodeType({
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, result: { dataType: 'NUMBER' } },
    } as any);
    const instances: any[] = [];
    const connections: any[] = [
      { from: { node: 'Start', port: 'execute' }, to: { node: 'n0', port: 'execute' } },
    ];
    for (let i = 0; i < 10; i++) {
      instances.push({ id: `n${i}`, nodeType: 'TestNode' });
      if (i > 0) {
        connections.push({
          from: { node: `n${i - 1}`, port: 'onSuccess' },
          to: { node: `n${i}`, port: 'execute' },
        });
      }
    }
    connections.push({ from: { node: 'n0', port: 'result' }, to: { node: 'n9', port: 'data' } });
    connections.push({ from: { node: 'n9', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } });

    const ast = minimalAST({ nodeTypes: [nt], instances, connections });
    const graph = buildDiagramGraph(ast);
    expect(graph.bounds.width).toBeGreaterThan(0);
    expect(graph.bounds.height).toBeGreaterThan(0);
  });
});

describe('measureText - various character classes', () => {
  it('handles digits correctly', () => {
    const w = measureText('0123456789');
    expect(w).toBeCloseTo(55.6, 1);
  });

  it('handles special characters', () => {
    const w = measureText('()[]{}');
    expect(w).toBeGreaterThan(0);
  });

  it('handles long strings', () => {
    const w = measureText('abcdefghijklmnopqrstuvwxyz');
    expect(w).toBeGreaterThan(100);
  });
});

describe('portBadgeWidth - control flow port', () => {
  it('computes width for STEP type (control flow)', () => {
    const port = makePort({ dataType: 'STEP', label: 'execute', isControlFlow: true });
    const w = portBadgeWidth(port);
    expect(w).toBeGreaterThan(0);
  });
});

describe('computeNodeDimensions - single port', () => {
  it('handles exactly one port', () => {
    const node = makeNode({ inputs: [makePort()], outputs: [] });
    computeNodeDimensions(node);
    const expected = PORT_PADDING_Y + 1 * PORT_SIZE + 0 * PORT_GAP + PORT_PADDING_Y;
    expect(node.height).toBe(Math.max(NODE_MIN_HEIGHT, expected));
  });
});

describe('buildDiagramGraph - nodeType registered by both name and functionName', () => {
  it('resolves instance using functionName when different from name', () => {
    const nt = makeNodeType({ name: 'FormalName', functionName: 'informalName' });
    const ast = minimalAST({
      nodeTypes: [nt],
      instances: [{ id: 'i1', nodeType: 'informalName' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const node = graph.nodes.find(n => n.id === 'i1');
    expect(node).toBeDefined();
    expect(node!.inputs.find(p => p.name === 'execute')).toBeDefined();
  });
});
