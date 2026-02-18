import { describe, it, expect } from 'vitest';
import { renderSVG } from '../../../src/diagram/renderer';
import { buildDiagramGraph } from '../../../src/diagram/geometry';
import { createSimpleWorkflow, createParallelWorkflow, createScopedWorkflow } from '../../helpers/test-fixtures';
import { getTheme } from '../../../src/diagram/theme';

describe('renderSVG', () => {
  const simpleGraph = () => buildDiagramGraph(createSimpleWorkflow());
  const parallelGraph = () => buildDiagramGraph(createParallelWorkflow());

  it('produces valid SVG with opening and closing tags', () => {
    const svg = renderSVG(simpleGraph());
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('uses dark theme background color by default', () => {
    const theme = getTheme('dark');
    const svg = renderSVG(simpleGraph());
    expect(svg).toContain(`fill="${theme.background}"`);
  });

  it('uses light theme background when specified', () => {
    const theme = getTheme('light');
    const svg = renderSVG(simpleGraph(), { theme: 'light' });
    expect(svg).toContain(`fill="${theme.background}"`);
  });

  it('includes dot grid pattern in defs', () => {
    const svg = renderSVG(simpleGraph());
    expect(svg).toContain('id="dot-grid"');
    expect(svg).toContain('fill="url(#dot-grid)"');
  });

  it('includes gradient defs for connections', () => {
    const svg = renderSVG(simpleGraph());
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('conn-grad-');
  });

  it('renders STEP connections as solid (no dash-array)', () => {
    const graph = simpleGraph();
    const stepConn = graph.connections.find(c => c.isStepConnection);
    if (stepConn) {
      const svg = renderSVG(graph);
      const pathLines = svg.split('\n').filter(l => l.includes('conn-grad-'));
      const stepIndex = graph.connections.indexOf(stepConn);
      const stepLine = pathLines.find(l => l.includes(`conn-grad-${stepIndex}`));
      if (stepLine) {
        expect(stepLine).not.toContain('stroke-dasharray');
      }
    }
  });

  it('renders DATA connections with dashed stroke', () => {
    const graph = simpleGraph();
    const dataConn = graph.connections.find(c => !c.isStepConnection);
    if (dataConn) {
      const svg = renderSVG(graph);
      const dataIndex = graph.connections.indexOf(dataConn);
      const pathLines = svg.split('\n').filter(l => l.includes('<path') && l.includes(`conn-grad-${dataIndex}`));
      expect(pathLines.length).toBeGreaterThan(0);
      expect(pathLines[0]).toContain('stroke-dasharray="8 4"');
    }
  });

  it('renders port circles with stroke ring (one circle per port)', () => {
    const svg = renderSVG(simpleGraph());
    const circleCount = (svg.match(/<circle/g) || []).length;
    // Dot grid has 1 circle in the pattern def, + 1 circle per port (fill + stroke ring)
    // With at least a few ports, we should have several circles
    expect(circleCount).toBeGreaterThan(2);
  });

  it('renders port labels by default', () => {
    const svg = renderSVG(simpleGraph());
    expect(svg).toContain('class="port-label"');
    expect(svg).toContain('class="port-type-label"');
  });

  it('hides port labels when showPortLabels is false', () => {
    const svg = renderSVG(simpleGraph(), { showPortLabels: false });
    expect(svg).not.toContain('class="port-label"');
  });

  it('renders node labels with subtle background', () => {
    const svg = renderSVG(simpleGraph());
    // Label background: a rect element with rx="6" and opacity 0.8
    expect(svg).toContain('rx="6"');
    expect(svg).toContain('opacity="0.8"');
    expect(svg).toContain('class="node-label"');
    expect(svg).toContain('Start');
    expect(svg).toContain('Exit');
    expect(svg).toContain('node1');
  });

  it('renders all nodes as rectangles (including virtual Start/Exit)', () => {
    const svg = renderSVG(simpleGraph());
    // All nodes should be rendered with <rect> elements for the body
    // There should be NO <circle> elements with filter (old virtual node rendering)
    expect(svg).not.toContain('filter="url(#shadow)"');
    // Count rect elements (background + dot grid + label pills + node bodies)
    const rectCount = (svg.match(/<rect/g) || []).length;
    // At least: 2 background rects + 3 label pill rects + 3 node body rects = 8
    expect(rectCount).toBeGreaterThanOrEqual(8);
  });

  it('renders node icons as SVG paths with per-node fill color', () => {
    const svg = renderSVG(simpleGraph());
    expect(svg).toContain('viewBox="0 -960 960 960"');
    // Icons use per-node fill color on the path element
    expect(svg).toContain('<path d=');
  });

  it('scales SVG when width option is set', () => {
    const svg = renderSVG(simpleGraph(), { width: 800 });
    expect(svg).toContain('width="800"');
  });

  it('does not include watermark or drop shadow', () => {
    const svg = renderSVG(simpleGraph());
    expect(svg).not.toContain('class="watermark"');
    expect(svg).not.toContain('filter id="shadow"');
  });
});

describe('renderSVG — scoped workflows', () => {
  const scopedGraph = () => buildDiagramGraph(createScopedWorkflow());

  it('renders scope area with dashed inner rectangle', () => {
    const svg = renderSVG(scopedGraph());
    expect(svg).toContain('stroke-dasharray="4 2"');
  });

  it('renders child nodes inside scoped parent', () => {
    const svg = renderSVG(scopedGraph());
    expect(svg).toContain('child1');
  });

  it('renders scope connections inside parent', () => {
    const graph = scopedGraph();
    const parent = graph.nodes.find(n => n.id === 'forEach1')!;
    expect(parent.scopeConnections!.length).toBeGreaterThan(0);

    const svg = renderSVG(graph);
    // Scope connections use gradient refs — should have more gradients than main connections
    const gradCount = (svg.match(/conn-grad-/g) || []).length;
    expect(gradCount).toBeGreaterThan(graph.connections.length);
  });

  it('renders scoped ports on inner edges', () => {
    const graph = scopedGraph();
    const svg = renderSVG(graph);

    const parent = graph.nodes.find(n => n.id === 'forEach1')!;
    // Scoped output ports (start, item) should be rendered as circles
    expect(parent.scopePorts!.outputs.length).toBeGreaterThan(0);
    // The SVG should have circles for these ports
    const circleCount = (svg.match(/<circle/g) || []).length;
    // More circles than a non-scoped graph would have
    expect(circleCount).toBeGreaterThan(5);
  });

  it('includes gradient defs for scope connections', () => {
    const graph = scopedGraph();
    const svg = renderSVG(graph);

    const totalConns = graph.connections.length +
      graph.nodes.reduce((sum, n) => sum + (n.scopeConnections?.length ?? 0), 0);

    const gradDefs = (svg.match(/<linearGradient/g) || []).length;
    expect(gradDefs).toBe(totalConns);
  });
});
