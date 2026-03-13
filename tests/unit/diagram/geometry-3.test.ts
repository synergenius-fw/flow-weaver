/**
 * Coverage tests for src/diagram/geometry.ts
 * Targets lines 1370-1373 (findScopeParent) and 1396 (resolveNodeColor fallback
 * for non-variant color strings). Both are private functions exercised via
 * buildDiagramGraph.
 */

import { buildDiagramGraph } from '../../../src/diagram/geometry';
import type { TWorkflowAST, TNodeTypeAST } from '../../../src/ast/types';

function makeNodeType(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
    functionText: `function ${name}(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }`,
    ...overrides,
  };
}

describe('geometry - findScopeParent and resolveNodeColor', () => {
  it('resolves custom color string (non-variant) for nodes with ui.color', () => {
    // Uses a custom hex color that is NOT a known variant name,
    // hitting line 1396 (return color as-is).
    const nodeA = makeNodeType('nodeA', {
      visuals: { color: '#ff5500' },
    });

    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'colorWorkflow',
      functionName: 'colorWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [nodeA],
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    const graph = buildDiagramGraph(ast);
    const nodeADiagram = graph.nodes.find(n => n.id === 'a');
    expect(nodeADiagram).toBeDefined();
    // The color should be the custom hex string, not a variant color
    expect(nodeADiagram!.color).toBe('#ff5500');
  });

  it('exercises findScopeParent for scoped connections between parent and child', () => {
    // A scoped workflow where parent has a child in a scope.
    // Connections between parent and child hit the findScopeParent check
    // at lines 1020-1021 which calls findScopeParent (lines 1370-1373).
    const parentNode = makeNodeType('forEach', {
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        results: { dataType: 'ARRAY' },
      },
      scopes: {
        iteration: {
          inputs: { item: { dataType: 'ANY' } },
          outputs: { result: { dataType: 'ANY' } },
        },
      },
    });

    const childNode = makeNodeType('processItem', {
      inputs: {
        execute: { dataType: 'STEP' },
        item: { dataType: 'ANY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        result: { dataType: 'ANY' },
      },
      hasFailurePort: false,
    });

    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'scopeParentWorkflow',
      functionName: 'scopeParentWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [parentNode, childNode],
      instances: [
        { type: 'NodeInstance', id: 'parent', nodeType: 'forEach' },
        { type: 'NodeInstance', id: 'child', nodeType: 'processItem', parent: 'parent' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'parent', port: 'execute' } },
        { type: 'Connection', from: { node: 'parent', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        // Scoped connections (parent <-> child)
        { type: 'Connection', from: { node: 'parent', port: 'item' }, to: { node: 'child', port: 'item' } },
        { type: 'Connection', from: { node: 'child', port: 'result' }, to: { node: 'parent', port: 'result' } },
      ],
      scopes: {
        iteration: ['child'],
      },
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    const graph = buildDiagramGraph(ast);
    // The graph should build without errors and include both parent and child
    const parentDiagram = graph.nodes.find(n => n.id === 'parent');
    expect(parentDiagram).toBeDefined();
    // The child node should be part of the parent's scope children
    if (parentDiagram?.scopeChildren) {
      expect(parentDiagram.scopeChildren.some(c => c.id === 'child')).toBe(true);
    }
  });
});
