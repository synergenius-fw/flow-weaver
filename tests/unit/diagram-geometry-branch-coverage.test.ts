/**
 * Branch coverage tests for src/diagram/geometry.ts
 *
 * Exercises both sides of every conditional in exported functions:
 * measureText, portBadgeWidth, computeNodeDimensions, computePortPositions,
 * computeConnectionPath, buildDiagramGraph (and many internal helpers).
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
} from '../../src/diagram/geometry.js';
import type { DiagramNode, DiagramPort, DiagramOptions } from '../../src/diagram/types.js';
import type { TWorkflowAST, TNodeTypeAST, TPortDefinition } from '../../src/ast/types.js';

// Helper to create a minimal DiagramPort
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

// Helper to create a minimal DiagramNode
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

// Minimal valid AST for buildDiagramGraph
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

describe('measureText', () => {
  it('returns 0 for empty string', () => {
    expect(measureText('')).toBe(0);
  });

  it('sums known character widths', () => {
    const width = measureText('AB');
    // A=7.23, B=7.23
    expect(width).toBeCloseTo(14.46, 2);
  });

  it('uses default width for unknown characters', () => {
    // Unicode char not in CHAR_WIDTHS map
    const width = measureText('\u00E9'); // e-acute
    expect(width).toBeCloseTo(5.56, 2); // DEFAULT_CHAR_WIDTH
  });

  it('mixes known and unknown characters', () => {
    const width = measureText('A\u00E9');
    expect(width).toBeCloseTo(7.23 + 5.56, 2);
  });
});

describe('portBadgeWidth', () => {
  it('computes badge width for a STRING port', () => {
    const port = makePort({ dataType: 'STRING', label: 'data' });
    const result = portBadgeWidth(port);
    // pad(7) + typeWidth + divGap(4) + 1 + divGap(4) + labelWidth + pad(7)
    expect(result).toBeGreaterThan(0);
  });

  it('computes badge width for an unknown/abbreviation-less type', () => {
    // When dataType is not in TYPE_ABBREVIATIONS, the full type string is used
    const port = makePort({ dataType: 'CUSTOM_TYPE' as any, label: 'x' });
    const result = portBadgeWidth(port);
    expect(result).toBeGreaterThan(0);
  });

  it('uses abbreviated name for STEP type', () => {
    const port = makePort({ dataType: 'STEP', label: 'execute' });
    const result = portBadgeWidth(port);
    expect(result).toBeGreaterThan(0);
  });
});

describe('computeNodeDimensions', () => {
  it('uses NODE_MIN_HEIGHT when there are no ports', () => {
    const node = makeNode({ inputs: [], outputs: [] });
    computeNodeDimensions(node);
    expect(node.width).toBe(NODE_MIN_WIDTH);
    expect(node.height).toBe(NODE_MIN_HEIGHT);
  });

  it('expands height based on port count (maxPorts > 0 branch)', () => {
    const inputs = [makePort(), makePort(), makePort(), makePort(), makePort()];
    const node = makeNode({ inputs, outputs: [] });
    computeNodeDimensions(node);
    const expectedPortsHeight = PORT_PADDING_Y + 5 * PORT_SIZE + 4 * PORT_GAP + PORT_PADDING_Y;
    expect(node.height).toBe(Math.max(NODE_MIN_HEIGHT, expectedPortsHeight));
  });

  it('uses the larger of inputs.length vs outputs.length', () => {
    const inputs = [makePort()];
    const outputs = [makePort(), makePort(), makePort()];
    const node = makeNode({ inputs, outputs });
    computeNodeDimensions(node);
    const expectedPortsHeight = PORT_PADDING_Y + 3 * PORT_SIZE + 2 * PORT_GAP + PORT_PADDING_Y;
    expect(node.height).toBe(Math.max(NODE_MIN_HEIGHT, expectedPortsHeight));
  });
});

describe('computePortPositions', () => {
  it('positions inputs on node left edge and outputs on right edge', () => {
    const inp = makePort({ name: 'in1', direction: 'INPUT' });
    const out = makePort({ name: 'out1', direction: 'OUTPUT' });
    const node = makeNode({
      inputs: [inp],
      outputs: [out],
      x: 100,
      y: 200,
      width: 90,
      height: 90,
    });
    computePortPositions(node);
    expect(inp.cx).toBe(100); // node.x
    expect(out.cx).toBe(190); // node.x + node.width
    expect(inp.cy).toBe(200 + PORT_PADDING_Y + PORT_SIZE / 2);
  });

  it('handles empty port lists (both branches of ports.length === 0)', () => {
    const node = makeNode({ inputs: [], outputs: [], x: 50, y: 50 });
    computePortPositions(node);
    // No ports to position, should not throw
    expect(node.inputs.length).toBe(0);
    expect(node.outputs.length).toBe(0);
  });

  it('positions multiple ports with correct vertical spacing', () => {
    const p1 = makePort({ name: 'p1' });
    const p2 = makePort({ name: 'p2' });
    const node = makeNode({ inputs: [p1, p2], x: 0, y: 0 });
    computePortPositions(node);
    expect(p1.cy).toBe(PORT_PADDING_Y + PORT_SIZE / 2);
    expect(p2.cy).toBe(PORT_PADDING_Y + 1 * (PORT_SIZE + PORT_GAP) + PORT_SIZE / 2);
  });
});

describe('computeConnectionPath', () => {
  it('returns a valid SVG path for a standard forward connection', () => {
    const path = computeConnectionPath(0, 0, 200, 100);
    expect(path).toMatch(/^M /);
    expect(path).toContain('Q');
    expect(path).toContain('L');
  });

  it('handles nearly horizontal connections (small dy)', () => {
    const path = computeConnectionPath(0, 50, 200, 50.001);
    expect(path).toBeTruthy();
    expect(typeof path).toBe('string');
  });

  it('handles backward connections (tx < sx)', () => {
    const path = computeConnectionPath(200, 100, 0, 0);
    expect(path).toBeTruthy();
  });

  it('handles very short connections', () => {
    const path = computeConnectionPath(0, 0, 1, 1);
    expect(path).toBeTruthy();
  });

  it('handles identical source and target', () => {
    const path = computeConnectionPath(50, 50, 50, 50);
    expect(path).toBeTruthy();
  });
});

describe('buildDiagramGraph', () => {
  it('builds a graph with Start and Exit nodes from empty AST', () => {
    const ast = minimalAST();
    const graph = buildDiagramGraph(ast);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    const ids = graph.nodes.map(n => n.id);
    expect(ids).toContain('Start');
    expect(ids).toContain('Exit');
    expect(graph.workflowName).toBe('testWorkflow');
  });

  it('respects theme option (light vs dark)', () => {
    const ast = minimalAST();
    const graphDark = buildDiagramGraph(ast, { theme: 'dark' });
    const graphLight = buildDiagramGraph(ast, { theme: 'light' });
    expect(graphDark.nodes.length).toBe(graphLight.nodes.length);
  });

  it('handles AST with instances and connections', () => {
    const nodeType: TNodeTypeAST = {
      name: 'MyNode',
      functionName: 'myNode',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, result: { dataType: 'NUMBER' } },
      hasSuccessPort: true,
      hasFailurePort: true,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [
        { id: 'node1', nodeType: 'MyNode' },
        { id: 'node2', nodeType: 'MyNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'node1', port: 'execute' } },
        { from: { node: 'node1', port: 'onSuccess' }, to: { node: 'node2', port: 'execute' } },
        { from: { node: 'node2', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    expect(graph.nodes.length).toBe(4); // Start, Exit, node1, node2
    expect(graph.connections.length).toBeGreaterThan(0);
  });

  it('handles nodeType with functionName different from name', () => {
    const nodeType: TNodeTypeAST = {
      name: 'MyCustom',
      functionName: 'myCustomFunc',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'inst1', nodeType: 'myCustomFunc' }] as any,
      connections: [],
    });
    const graph = buildDiagramGraph(ast);
    const instNode = graph.nodes.find(n => n.id === 'inst1');
    expect(instNode).toBeDefined();
  });

  it('handles expression node types (no execute port added)', () => {
    const nodeType: TNodeTypeAST = {
      name: 'ExprNode',
      functionName: 'exprNode',
      variant: 'FUNCTION',
      expression: true,
      inputs: { data: { dataType: 'STRING' } },
      outputs: { result: { dataType: 'STRING' } },
      hasSuccessPort: false,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'expr1', nodeType: 'ExprNode' }] as any,
      connections: [],
    });
    const graph = buildDiagramGraph(ast);
    const exprNode = graph.nodes.find(n => n.id === 'expr1');
    expect(exprNode).toBeDefined();
    // Expression nodes should not have an execute input
    expect(exprNode!.inputs.find(p => p.name === 'execute')).toBeUndefined();
  });

  it('handles hidden ports (filtered out)', () => {
    const nodeType: TNodeTypeAST = {
      name: 'HiddenNode',
      functionName: 'hiddenNode',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP', hidden: true }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true, hidden: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'h1', nodeType: 'HiddenNode' }] as any,
      connections: [],
    });
    const graph = buildDiagramGraph(ast);
    const hNode = graph.nodes.find(n => n.id === 'h1');
    expect(hNode).toBeDefined();
    // Hidden ports should not appear
    expect(hNode!.inputs.find(p => p.name === 'execute')).toBeUndefined();
    expect(hNode!.outputs.find(p => p.name === 'onSuccess')).toBeUndefined();
  });

  it('handles explicit positions for all nodes (allPositioned branch)', () => {
    const ast = minimalAST({
      instances: [],
      connections: [],
      ui: {
        startNode: { x: 10, y: 20 },
        exitNode: { x: 500, y: 20 },
      },
    } as any);
    const graph = buildDiagramGraph(ast);
    // Positions are applied (then normalized with offsets)
    expect(graph.nodes.length).toBe(2);
  });

  it('handles mixed positions (some explicit, some auto-layout)', () => {
    const nodeType: TNodeTypeAST = {
      name: 'Simple',
      functionName: 'simple',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [
        { id: 'pos1', nodeType: 'Simple', config: { x: 100, y: 200 } },
        { id: 'noPos', nodeType: 'Simple' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pos1', port: 'execute' } },
        { from: { node: 'pos1', port: 'onSuccess' }, to: { node: 'noPos', port: 'execute' } },
        { from: { node: 'noPos', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
      ui: {
        startNode: { x: 0, y: 0 },
      },
    } as any);
    const graph = buildDiagramGraph(ast);
    expect(graph.nodes.length).toBe(4);
  });

  it('handles node type with WORKFLOW variant for icon detection', () => {
    const nodeType: TNodeTypeAST = {
      name: 'SubWorkflow',
      functionName: 'subWorkflow',
      variant: 'WORKFLOW',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'wf1', nodeType: 'SubWorkflow' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const wfNode = graph.nodes.find(n => n.id === 'wf1');
    expect(wfNode!.icon).toBe('flow');
  });

  it('handles node type with IMPORTED_WORKFLOW variant for icon detection', () => {
    const nodeType: TNodeTypeAST = {
      name: 'ImportedWf',
      functionName: 'importedWf',
      variant: 'IMPORTED_WORKFLOW',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'imp1', nodeType: 'ImportedWf' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const impNode = graph.nodes.find(n => n.id === 'imp1');
    expect(impNode!.icon).toBe('flow');
  });

  it('resolves variant color for node with known color name', () => {
    const nodeType: TNodeTypeAST = {
      name: 'ColorNode',
      functionName: 'colorNode',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
      visuals: { color: 'blue' },
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'c1', nodeType: 'ColorNode' }] as any,
    });
    const graphDark = buildDiagramGraph(ast, { theme: 'dark' });
    const graphLight = buildDiagramGraph(ast, { theme: 'light' });
    const nodeDark = graphDark.nodes.find(n => n.id === 'c1');
    const nodeLight = graphLight.nodes.find(n => n.id === 'c1');
    expect(nodeDark!.color).toBeTruthy();
    expect(nodeLight!.color).toBeTruthy();
  });

  it('uses raw color string when not a known variant name', () => {
    const nodeType: TNodeTypeAST = {
      name: 'RawColor',
      functionName: 'rawColor',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {},
      hasSuccessPort: false,
      hasFailurePort: false,
      visuals: { color: '#ff00ff' },
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'rc1', nodeType: 'RawColor' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const rcNode = graph.nodes.find(n => n.id === 'rc1');
    expect(rcNode!.color).toBe('#ff00ff');
  });

  it('handles startPorts with hidden execute', () => {
    const ast = minimalAST({
      startPorts: { execute: { dataType: 'STEP', hidden: true }, data: { dataType: 'STRING' } } as any,
    });
    const graph = buildDiagramGraph(ast);
    const start = graph.nodes.find(n => n.id === 'Start');
    expect(start).toBeDefined();
    expect(start!.outputs.find(p => p.name === 'execute')).toBeUndefined();
  });

  it('handles exitPorts with existing onFailure port', () => {
    const ast = minimalAST({
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true },
      } as any,
    });
    const graph = buildDiagramGraph(ast);
    const exit = graph.nodes.find(n => n.id === 'Exit');
    expect(exit).toBeDefined();
    const failPort = exit!.inputs.find(p => p.name === 'onFailure');
    expect(failPort).toBeDefined();
    expect(failPort!.isFailure).toBe(true);
  });

  it('handles exitPorts with hidden onFailure', () => {
    const ast = minimalAST({
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true, hidden: true },
      } as any,
    });
    const graph = buildDiagramGraph(ast);
    const exit = graph.nodes.find(n => n.id === 'Exit');
    expect(exit!.inputs.find(p => p.name === 'onFailure')).toBeUndefined();
  });

  it('handles custom padding option', () => {
    const ast = minimalAST();
    const graph = buildDiagramGraph(ast, { padding: 100 });
    expect(graph.bounds.width).toBeGreaterThan(0);
    expect(graph.bounds.height).toBeGreaterThan(0);
  });

  it('builds connections with stubs for long-distance connections', () => {
    const nodeType: TNodeTypeAST = {
      name: 'LongNode',
      functionName: 'longNode',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, result: { dataType: 'NUMBER' } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    // Build enough nodes for long-distance connections
    const instances = [];
    const connections: any[] = [
      { from: { node: 'Start', port: 'execute' }, to: { node: 'n0', port: 'execute' } },
    ];
    for (let i = 0; i < 5; i++) {
      instances.push({ id: `n${i}`, nodeType: 'LongNode' });
      if (i > 0) {
        connections.push({
          from: { node: `n${i - 1}`, port: 'onSuccess' },
          to: { node: `n${i}`, port: 'execute' },
        });
      }
    }
    // Add a cross-graph data connection for stub coverage
    connections.push({
      from: { node: 'n0', port: 'result' },
      to: { node: 'n4', port: 'data' },
    });
    connections.push({
      from: { node: 'n4', port: 'onSuccess' },
      to: { node: 'Exit', port: 'onSuccess' },
    });

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: instances as any,
      connections,
    });
    const graph = buildDiagramGraph(ast);
    expect(graph.connections.length).toBeGreaterThan(0);
  });

  it('handles scope-qualified connections (from.scope / to.scope)', () => {
    const parentNt: TNodeTypeAST = {
      name: 'ScopeParent',
      functionName: 'scopeParent',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: true,
    } as unknown as TNodeTypeAST;

    const childNt: TNodeTypeAST = {
      name: 'ScopeChild',
      functionName: 'scopeChild',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, result: { dataType: 'STRING' } },
      hasSuccessPort: true,
      hasFailurePort: true,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [parentNt, childNt],
      instances: [
        { id: 'parent', nodeType: 'ScopeParent' },
        { id: 'child1', nodeType: 'ScopeChild' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'parent', port: 'execute' } },
        { from: { node: 'parent', port: 'execute', scope: 'iteration' }, to: { node: 'child1', port: 'execute' } },
        { from: { node: 'child1', port: 'onSuccess' }, to: { node: 'parent', port: 'onSuccess', scope: 'iteration' } },
        { from: { node: 'parent', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
      scopes: { 'parent.iteration': ['child1'] },
    } as any);

    const graph = buildDiagramGraph(ast);
    const parentNode = graph.nodes.find(n => n.id === 'parent');
    expect(parentNode).toBeDefined();
    expect(parentNode!.scopeChildren).toBeDefined();
    expect(parentNode!.scopeChildren!.length).toBe(1);
  });

  it('infers scope from scope-qualified port connections', () => {
    const parentNt: TNodeTypeAST = {
      name: 'InferScopeParent',
      functionName: 'inferScopeParent',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        item: { dataType: 'STRING', scope: 'loop' },
      },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const childNt: TNodeTypeAST = {
      name: 'InferChild',
      functionName: 'inferChild',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [parentNt, childNt],
      instances: [
        { id: 'loopNode', nodeType: 'InferScopeParent' },
        { id: 'innerNode', nodeType: 'InferChild' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'loopNode', port: 'execute' } },
        { from: { node: 'loopNode', port: 'item', scope: 'loop' }, to: { node: 'innerNode', port: 'data' } },
        { from: { node: 'loopNode', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    } as any);

    const graph = buildDiagramGraph(ast);
    const loopNode = graph.nodes.find(n => n.id === 'loopNode');
    expect(loopNode).toBeDefined();
    // Scope should be inferred from the connection with scope qualifier
    expect(loopNode!.scopeChildren).toBeDefined();
  });

  it('handles instance config with custom width/height override', () => {
    const nodeType: TNodeTypeAST = {
      name: 'SizedNode',
      functionName: 'sizedNode',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [
        { id: 'sized1', nodeType: 'SizedNode', config: { width: 200, height: 200 } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    const sizedNode = graph.nodes.find(n => n.id === 'sized1');
    expect(sizedNode!.width).toBe(200);
    expect(sizedNode!.height).toBe(200);
  });

  it('handles instance config with label, color, and icon overrides', () => {
    const nodeType: TNodeTypeAST = {
      name: 'ConfigNode',
      functionName: 'configNode',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {},
      hasSuccessPort: false,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [
        { id: 'cfg1', nodeType: 'ConfigNode', config: { label: 'Custom Label', color: '#abc', icon: 'star' } },
      ] as any,
    });
    const graph = buildDiagramGraph(ast);
    const cfgNode = graph.nodes.find(n => n.id === 'cfg1');
    expect(cfgNode!.label).toBe('Custom Label');
    expect(cfgNode!.icon).toBe('star');
  });

  it('resolves nodeType visuals icon when no instance icon set', () => {
    const nodeType: TNodeTypeAST = {
      name: 'IconNode',
      functionName: 'iconNode',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {},
      hasSuccessPort: false,
      hasFailurePort: false,
      visuals: { icon: 'bolt' },
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'icon1', nodeType: 'IconNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const iNode = graph.nodes.find(n => n.id === 'icon1');
    expect(iNode!.icon).toBe('bolt');
  });

  it('handles port metadata with order for sorting', () => {
    const nodeType: TNodeTypeAST = {
      name: 'OrderedNode',
      functionName: 'orderedNode',
      variant: 'FUNCTION',
      inputs: {
        execute: { dataType: 'STEP' },
        beta: { dataType: 'STRING', metadata: { order: 2 } },
        alpha: { dataType: 'NUMBER', metadata: { order: 1 } },
      },
      outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      hasSuccessPort: true,
      hasFailurePort: false,
    } as unknown as TNodeTypeAST;

    const ast = minimalAST({
      nodeTypes: [nodeType],
      instances: [{ id: 'ord1', nodeType: 'OrderedNode' }] as any,
    });
    const graph = buildDiagramGraph(ast);
    const ordNode = graph.nodes.find(n => n.id === 'ord1');
    expect(ordNode).toBeDefined();
    // Ports should be ordered: execute first (mandatory), then alpha, then beta
    const names = ordNode!.inputs.map(p => p.name);
    expect(names.indexOf('execute')).toBeLessThan(names.indexOf('alpha'));
    expect(names.indexOf('alpha')).toBeLessThan(names.indexOf('beta'));
  });
});
