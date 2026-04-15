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

  it('renders port indicators as vertical bars (one rect per port)', () => {
    const svg = renderSVG(simpleGraph());
    // Port bars are 2px wide, 14px tall rects with rx="1"
    const portBars = (svg.match(/data-port-id=/g) || []).length;
    expect(portBars).toBeGreaterThan(2);
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

  it('renders node labels as plain text (no badge background)', () => {
    const svg = renderSVG(simpleGraph());
    // Labels are plain text elements with no background rect
    expect(svg).toContain('class="node-label"');
    expect(svg).toContain('Start');
    expect(svg).toContain('Exit');
    expect(svg).toContain('node1');
    // No label badge background
    expect(svg).not.toContain('opacity="0.95"');
  });

  it('renders all nodes as rectangles (including virtual Start/Exit)', () => {
    const svg = renderSVG(simpleGraph());
    // All nodes should be rendered with <rect> elements for the body
    expect(svg).not.toContain('filter="url(#shadow)"');
    // Count rect elements (background + dot grid + node bodies + port bars + port labels)
    const rectCount = (svg.match(/<rect/g) || []).length;
    // At least: 2 background rects + 3 node body rects + port bars + port label badges
    expect(rectCount).toBeGreaterThanOrEqual(5);
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

  it('does not include watermark (matches platform)', () => {
    const svg = renderSVG(simpleGraph());
    expect(svg).not.toContain('Flow Weaver</text>');
  });

  it('does not include node-shadow filter (matches platform outline style)', () => {
    const svg = renderSVG(simpleGraph());
    expect(svg).not.toContain('filter id="node-shadow"');
    expect(svg).not.toContain('<feDropShadow');
    expect(svg).not.toContain('filter="url(#node-shadow)"');
  });

  it('uses themed dotOpacity for dot grid pattern', () => {
    const darkTheme = getTheme('dark');
    const darkSvg = renderSVG(simpleGraph());
    const darkCircleLine = darkSvg.split('\n').find(l => l.includes('r="0.75"') && l.includes('opacity='));
    expect(darkCircleLine).toBeTruthy();
    expect(darkCircleLine).toContain(`opacity="${darkTheme.dotOpacity}"`);

    const lightTheme = getTheme('light');
    const lightSvg = renderSVG(simpleGraph(), { theme: 'light' });
    const lightCircleLine = lightSvg.split('\n').find(l => l.includes('r="0.75"') && l.includes('opacity='));
    expect(lightCircleLine).toBeTruthy();
    expect(lightCircleLine).toContain(`opacity="${lightTheme.dotOpacity}"`);
  });

  it('renders Exit onFailure port in failure color (red), not STEP color (green)', () => {
    const ast = createSimpleWorkflow();
    ast.exitPorts.onSuccess = { dataType: 'STEP', isControlFlow: true };
    ast.exitPorts.onFailure = { dataType: 'STEP', isControlFlow: true, failure: true };
    const graph = buildDiagramGraph(ast);
    const svg = renderSVG(graph);

    // Find the rect for Exit.onFailure port (ports are vertical bars now)
    const failurePortMatch = svg.match(/<rect[^>]*data-port-id="Exit\.onFailure:input"[^>]*>/);
    expect(failurePortMatch).toBeTruthy();

    // The failure color should be red (#ff4f4f for dark theme), not green (#10e15a)
    const failureRect = failurePortMatch![0];
    expect(failureRect).toContain('#ff4f4f'); // dark failure color
    expect(failureRect).not.toContain('#10e15a'); // dark STEP color
  });
});

describe('renderSVG — scoped workflows', () => {
  const scopedGraph = () => buildDiagramGraph(createScopedWorkflow());

  it('does not apply shadow filter to scoped parent rect', () => {
    const svg = renderSVG(scopedGraph());
    expect(svg).not.toContain('filter="url(#node-shadow)"');
  });

  it('renders scope area with subtle horizontal divider lines', () => {
    const svg = renderSVG(scopedGraph());
    // Scope area uses top/bottom lines instead of a dashed rect
    expect(svg).not.toContain('stroke-dasharray="4 2"');
    expect(svg).toContain('opacity="0.3"');
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
    // Scoped output ports (start, item) should be rendered as port bars
    expect(parent.scopePorts!.outputs.length).toBeGreaterThan(0);
    // The SVG should have port bars (rects with data-port-id) for these ports
    const portCount = (svg.match(/data-port-id=/g) || []).length;
    expect(portCount).toBeGreaterThan(5);
  });

  it('marks scope connections with data-scope attribute', () => {
    const graph = scopedGraph();
    const svg = renderSVG(graph);
    const parent = graph.nodes.find(n => n.id === 'forEach1')!;
    expect(parent.scopeConnections!.length).toBeGreaterThan(0);
    expect(svg).toContain(`data-scope="${parent.id}"`);
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
