import { describe, it, expect } from 'vitest';
import { renderASCII, renderASCIICompact, renderText } from '../../../src/diagram/ascii-renderer';
import { buildDiagramGraph } from '../../../src/diagram/geometry';
import { createSimpleWorkflow, createParallelWorkflow, createChainWorkflow, createScopedWorkflow } from '../../helpers/test-fixtures';

describe('renderASCII', () => {
  it('contains workflow name and node labels', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('testWorkflow');
    expect(result).toContain('Start');
    expect(result).toContain('node1');
    expect(result).toContain('Exit');
  });

  it('contains port names for nodes', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('execute');
    expect(result).toContain('onSuccess');
  });

  it('uses box-drawing characters', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('\u250C'); // ┌
    expect(result).toContain('\u2510'); // ┐
    expect(result).toContain('\u2514'); // └
    expect(result).toContain('\u2518'); // ┘
    expect(result).toContain('\u2502'); // │
  });

  it('shows connected/not-connected symbols and legend', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('\u25CF'); // ● connected
    expect(result).toContain('\u25CB'); // ○ not connected
    expect(result).toContain('connected');
  });

  it('draws connection lines between ports', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    // Connection lines use ─ (DATA) or ═ (STEP) and ▶ arrowheads
    expect(result).toContain('\u2500'); // ─
    expect(result).toContain('\u25B6'); // ▶
  });

  it('handles parallel branches', () => {
    const graph = buildDiagramGraph(createParallelWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('node1');
    expect(result).toContain('node2');
    expect(result).toContain('node3');
  });

  it('handles chain workflows', () => {
    const graph = buildDiagramGraph(createChainWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('node1');
    expect(result).toContain('node2');
    expect(result).toContain('node3');
  });

  it('handles scoped workflows', () => {
    const graph = buildDiagramGraph(createScopedWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('forEach1');
  });
});

describe('renderASCIICompact', () => {
  it('contains workflow name', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('testWorkflow');
  });

  it('renders node labels in boxes', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('Start');
    expect(result).toContain('node1');
    expect(result).toContain('Exit');
  });

  it('uses compact box-drawing characters', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('\u250C'); // ┌
    expect(result).toContain('\u2518'); // ┘
  });

  it('uses arrow connectors between boxes', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('\u2501\u2501\u2501\u25B6'); // ━━━▶
  });

  it('shows parallel nodes', () => {
    const graph = buildDiagramGraph(createParallelWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('Parallel:');
  });

  it('shows scoped children', () => {
    const graph = buildDiagramGraph(createScopedWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('Scope');
    expect(result).toContain('child1');
  });
});

describe('renderText', () => {
  it('contains workflow name with underline', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderText(graph);
    expect(result).toContain('testWorkflow');
    expect(result).toContain('\u2550'.repeat('testWorkflow'.length));
  });

  it('lists all nodes', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderText(graph);
    expect(result).toContain('Nodes:');
    expect(result).toContain('Start');
    expect(result).toContain('node1');
    expect(result).toContain('Exit');
  });

  it('shows connected/not-connected port symbols', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderText(graph);
    // x on Start is connected (Start.x -> node1.input), so ●
    expect(result).toContain('x\u25CF');
    // execute on Start is not connected, so ○
    expect(result).toContain('execute\u25CB');
    // input on node1 is connected (receives from Start.x), so ●
    expect(result).toContain('input\u25CF');
  });

  it('lists connections with arrows', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderText(graph);
    expect(result).toContain('Connections:');
    expect(result).toContain('Start.');
    expect(result).toContain('node1.');
  });

  it('marks STEP connections', () => {
    // Scoped workflow has STEP connections (execute ports are connected)
    const graph = buildDiagramGraph(createScopedWorkflow());
    const result = renderText(graph);
    expect(result).toContain('STEP');
  });

  it('handles parallel workflows', () => {
    const graph = buildDiagramGraph(createParallelWorkflow());
    const result = renderText(graph);
    expect(result).toContain('node1');
    expect(result).toContain('node2');
    expect(result).toContain('node3');
  });

  it('handles scoped workflows', () => {
    const graph = buildDiagramGraph(createScopedWorkflow());
    const result = renderText(graph);
    expect(result).toContain('forEach1');
    expect(result).toContain('scope:');
    expect(result).toContain('child1');
  });
});
