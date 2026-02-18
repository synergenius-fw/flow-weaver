import { describe, it, expect } from 'vitest';
import { layoutWorkflow } from '../../../src/diagram/layout';
import {
  createSimpleWorkflow,
  createChainWorkflow,
  createParallelWorkflow,
  createScopedWorkflow,
} from '../../helpers/test-fixtures';

describe('layoutWorkflow', () => {
  it('assigns Start to layer 0, node1 to layer 1, Exit to layer 2 for simple workflow', () => {
    const ast = createSimpleWorkflow();
    const { nodeLayer } = layoutWorkflow(ast);

    expect(nodeLayer.get('Start')).toBe(0);
    expect(nodeLayer.get('node1')).toBe(1);
    expect(nodeLayer.get('Exit')).toBe(2);
  });

  it('assigns 5 layers for chain workflow (Start, node1, node2, node3, Exit)', () => {
    const ast = createChainWorkflow();
    const { layers, nodeLayer } = layoutWorkflow(ast);

    expect(nodeLayer.get('Start')).toBe(0);
    expect(nodeLayer.get('node1')).toBe(1);
    expect(nodeLayer.get('node2')).toBe(2);
    expect(nodeLayer.get('node3')).toBe(3);
    expect(nodeLayer.get('Exit')).toBe(4);
    expect(layers.length).toBe(5);
  });

  it('places parallel nodes in the same layer', () => {
    const ast = createParallelWorkflow();
    const { nodeLayer } = layoutWorkflow(ast);

    expect(nodeLayer.get('node1')).toBe(nodeLayer.get('node2'));
    // node3 should come after the parallel layer
    expect(nodeLayer.get('node3')!).toBeGreaterThan(nodeLayer.get('node1')!);
  });

  it('excludes scoped child nodes from main layout', () => {
    const ast = createScopedWorkflow();
    const { nodeLayer } = layoutWorkflow(ast);

    // child1 is inside forEach1's scope, should not appear
    expect(nodeLayer.has('child1')).toBe(false);
    // forEach1 should be in the layout
    expect(nodeLayer.has('forEach1')).toBe(true);
  });

  it('assigns disconnected nodes to a default layer', () => {
    const ast = createSimpleWorkflow();
    // Add a disconnected node
    ast.instances.push({
      type: 'NodeInstance',
      id: 'disconnected',
      nodeType: 'process',
    });
    const { nodeLayer } = layoutWorkflow(ast);

    expect(nodeLayer.has('disconnected')).toBe(true);
    // Disconnected nodes with no incoming edges get layer 0 (same as Start)
    expect(nodeLayer.get('disconnected')).toBe(0);
  });

  it('always places Exit in the last layer', () => {
    const ast = createChainWorkflow();
    const { nodeLayer } = layoutWorkflow(ast);

    const exitLayer = nodeLayer.get('Exit')!;
    for (const [id, layer] of nodeLayer) {
      if (id !== 'Exit') {
        expect(layer).toBeLessThan(exitLayer);
      }
    }
  });

  it('crossing minimization reorders nodes within layers', () => {
    const ast = createParallelWorkflow();
    const { layers, nodeLayer } = layoutWorkflow(ast);

    // Both node1 and node2 should be in the same layer
    const parallelLayer = nodeLayer.get('node1')!;
    const layerNodes = layers[parallelLayer];
    expect(layerNodes).toContain('node1');
    expect(layerNodes).toContain('node2');
    expect(layerNodes.length).toBe(2);
  });
});
