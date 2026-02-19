import type { DiagramGraph, DiagramNode, DiagramConnection, DiagramOptions, DiagramPort, ThemePalette } from './types';
import { getTheme, getPortColor, getPortRingColor, TYPE_ABBREVIATIONS, NODE_ICON_PATHS } from './theme';
import { PORT_RADIUS, BORDER_RADIUS, LABEL_HEIGHT, LABEL_GAP, SCOPE_PORT_COLUMN, measureText } from './geometry';

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Collect all connections (main + scope) for gradient def generation */
function collectAllConnections(graph: DiagramGraph): DiagramConnection[] {
  const all = [...graph.connections];
  for (const node of graph.nodes) {
    if (node.scopeConnections) {
      all.push(...node.scopeConnections);
    }
  }
  return all;
}

export function renderSVG(graph: DiagramGraph, options: DiagramOptions = {}): string {
  const themeName = options.theme ?? 'dark';
  const theme = getTheme(themeName);
  const showPortLabels = options.showPortLabels ?? true;

  let { width: vbWidth, height: vbHeight } = graph.bounds;

  // Ensure minimum bounds
  vbWidth = Math.max(vbWidth, 200);
  vbHeight = Math.max(vbHeight, 100);

  const svgWidth = options.width || vbWidth;
  const svgHeight = options.width ? (vbHeight / vbWidth) * options.width : vbHeight;

  // Collect all connections for gradient generation
  const allConnections = collectAllConnections(graph);

  const parts: string[] = [];

  // SVG open
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbWidth} ${vbHeight}" width="${svgWidth}" height="${svgHeight}">`,
  );

  // Styles — matching React component fonts and sizes
  parts.push(`<style>`);
  parts.push(`  text { font-family: Montserrat, 'Segoe UI', Roboto, sans-serif; }`);
  parts.push(`  .node-label { font-size: 13px; font-weight: 700; fill: ${theme.labelColor}; }`);
  parts.push(`  .port-label { font-size: 10px; font-weight: 600; fill: ${theme.labelColor}; }`);
  parts.push(`  .port-type-label { font-size: 10px; font-weight: 600; }`);
  parts.push(`</style>`);

  // Defs (dot grid pattern + connection gradients for ALL connections)
  parts.push(`<defs>`);

  parts.push(`  <pattern id="dot-grid" width="20" height="20" patternUnits="userSpaceOnUse">`);
  parts.push(`    <circle cx="10" cy="10" r="1.5" fill="${theme.dotColor}" opacity="0.6"/>`);
  parts.push(`  </pattern>`);

  for (let i = 0; i < allConnections.length; i++) {
    const conn = allConnections[i];
    parts.push(`  <linearGradient id="conn-grad-${i}" x1="0%" y1="0%" x2="100%" y2="0%">`);
    parts.push(`    <stop offset="0%" stop-color="${conn.sourceColor}"/>`);
    parts.push(`    <stop offset="100%" stop-color="${conn.targetColor}"/>`);
    parts.push(`  </linearGradient>`);
  }
  parts.push(`</defs>`);

  // Background
  parts.push(`<rect width="${vbWidth}" height="${vbHeight}" fill="${theme.background}"/>`);
  parts.push(`<rect width="${vbWidth}" height="${vbHeight}" fill="url(#dot-grid)"/>`);

  // Main connections
  parts.push(`<g class="connections">`);
  for (let i = 0; i < graph.connections.length; i++) {
    const conn = graph.connections[i];
    const dashAttr = conn.isStepConnection ? '' : ' stroke-dasharray="8 4"';
    parts.push(
      `  <path d="${conn.path}" fill="none" stroke="url(#conn-grad-${i})" stroke-width="3"${dashAttr} stroke-linecap="round"/>`,
    );
  }
  parts.push(`</g>`);

  // Nodes
  parts.push(`<g class="nodes">`);
  for (const node of graph.nodes) {
    parts.push(renderNode(node, theme, themeName, showPortLabels, allConnections));
  }
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join('\n');
}

function renderNode(
  node: DiagramNode,
  theme: ThemePalette,
  themeName: 'dark' | 'light',
  showPortLabels: boolean,
  allConnections: DiagramConnection[],
): string {
  const parts: string[] = [];
  parts.push(`  <g>`);

  // Label above node — scoped nodes use left-aligned label (center={false} in React)
  const isScoped = !!(node.scopeChildren && node.scopeChildren.length > 0);
  const labelText = escapeXml(node.label);
  const textWidth = labelText.length * 7;
  const labelBgWidth = textWidth + 16;
  const labelBgHeight = LABEL_HEIGHT;
  const labelBgX = isScoped ? node.x : node.x + node.width / 2 - labelBgWidth / 2;
  const labelBgY = node.y - LABEL_GAP - labelBgHeight;
  const labelTextX = isScoped ? node.x + 8 : node.x + node.width / 2;
  const labelAnchor = isScoped ? 'start' : 'middle';

  parts.push(
    `    <rect x="${labelBgX}" y="${labelBgY}" width="${labelBgWidth}" height="${labelBgHeight}" rx="6" fill="${theme.labelBadgeFill}" opacity="0.8"/>`,
  );
  parts.push(
    `    <text class="node-label" x="${labelTextX}" y="${labelBgY + labelBgHeight / 2 + 6}" text-anchor="${labelAnchor}" fill="${node.color !== '#334155' ? node.color : theme.labelColor}">${labelText}</text>`,
  );

  // Node body — default nodes use icon color for border to match
  const strokeColor = node.color !== '#334155' ? node.color : theme.nodeIconColor;
  parts.push(
    `    <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${BORDER_RADIUS}" fill="${theme.nodeFill}" stroke="${strokeColor}" stroke-width="2"/>`,
  );

  // Scoped node rendering
  if (node.scopeChildren && node.scopeChildren.length > 0) {
    renderScopedContent(parts, node, theme, themeName, showPortLabels, allConnections);
  } else {
    // Regular node: icon centered in body, colored to match node
    const iconPath = getNodeIconPath(node);
    const iconColor = getNodeIconColor(node, theme);
    const iconSize = 40;
    const iconX = node.x + (node.width - iconSize) / 2;
    const iconY = node.y + (node.height - iconSize) / 2;
    parts.push(
      `    <svg x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" viewBox="0 -960 960 960"><path d="${iconPath}" fill="${iconColor}"/></svg>`,
    );
  }

  // External ports (on outer edges)
  renderPorts(parts, node.inputs, node.outputs, theme, themeName, showPortLabels);
  parts.push(`  </g>`);

  return parts.join('\n');
}

function renderScopedContent(
  parts: string[],
  node: DiagramNode,
  theme: ThemePalette,
  themeName: 'dark' | 'light',
  showPortLabels: boolean,
  allConnections: DiagramConnection[],
): void {
  const children = node.scopeChildren!;
  const scopePorts = node.scopePorts;
  const scopeConns = node.scopeConnections ?? [];

  // Draw scope area inner rectangle
  const scopeX = node.x + SCOPE_PORT_COLUMN;
  const scopeY = node.y + 4;
  const scopeW = node.width - SCOPE_PORT_COLUMN * 2;
  const scopeH = node.height - 8;

  parts.push(
    `    <rect x="${scopeX}" y="${scopeY}" width="${scopeW}" height="${scopeH}" rx="4" fill="none" stroke="${theme.scopeAreaStroke}" stroke-width="1" stroke-dasharray="4 2" opacity="0.5"/>`,
  );

  // Render scope ports on inner edges first (so children render on top)
  if (scopePorts) {
    renderPorts(parts, scopePorts.inputs, scopePorts.outputs, theme, themeName, showPortLabels);
  }

  // Render scope connections inside the parent
  for (const conn of scopeConns) {
    const gradIndex = allConnections.indexOf(conn);
    if (gradIndex < 0) continue;
    const dashAttr = conn.isStepConnection ? '' : ' stroke-dasharray="8 4"';
    parts.push(
      `    <path d="${conn.path}" fill="none" stroke="url(#conn-grad-${gradIndex})" stroke-width="2.5"${dashAttr} stroke-linecap="round"/>`,
    );
  }

  // Render child nodes inside the scope (topmost layer)
  for (const child of children) {
    // Child label
    const childLabelX = child.x + child.width / 2;
    const childLabelText = escapeXml(child.label);
    const childTextWidth = childLabelText.length * 7;
    const childLabelBgW = childTextWidth + 16;
    const childLabelBgH = LABEL_HEIGHT;
    const childLabelBgX = childLabelX - childLabelBgW / 2;
    const childLabelBgY = child.y - LABEL_GAP - childLabelBgH;

    parts.push(
      `    <rect x="${childLabelBgX}" y="${childLabelBgY}" width="${childLabelBgW}" height="${childLabelBgH}" rx="6" fill="${theme.labelBadgeFill}" opacity="0.8"/>`,
    );
    parts.push(
      `    <text class="node-label" x="${childLabelX}" y="${childLabelBgY + childLabelBgH / 2 + 6}" text-anchor="middle" fill="${child.color !== '#334155' ? child.color : theme.labelColor}">${childLabelText}</text>`,
    );

    // Child body
    const childStroke = child.color !== '#334155' ? child.color : theme.nodeIconColor;
    parts.push(
      `    <rect x="${child.x}" y="${child.y}" width="${child.width}" height="${child.height}" rx="${BORDER_RADIUS}" fill="${theme.nodeFill}" stroke="${childStroke}" stroke-width="2"/>`,
    );

    // Child icon — colored to match child node
    const iconPath = getNodeIconPath(child);
    const iconColor = getNodeIconColor(child, theme);
    const iconSize = 40;
    const iconX = child.x + (child.width - iconSize) / 2;
    const iconY = child.y + (child.height - iconSize) / 2;
    parts.push(
      `    <svg x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" viewBox="0 -960 960 960"><path d="${iconPath}" fill="${iconColor}"/></svg>`,
    );

    renderPorts(parts, child.inputs, child.outputs, theme, themeName, showPortLabels);
  }
}

function getNodeIconPath(node: DiagramNode): string {
  return NODE_ICON_PATHS[node.icon] ?? NODE_ICON_PATHS.code;
}

/** Resolve icon fill color: use node's border color if set, otherwise theme default */
function getNodeIconColor(node: DiagramNode, theme: ThemePalette): string {
  if (node.color !== '#334155') return node.color;
  return theme.nodeIconColor;
}

function renderPorts(
  parts: string[],
  inputs: readonly DiagramPort[],
  outputs: readonly DiagramPort[],
  theme: ThemePalette,
  themeName: 'dark' | 'light',
  showPortLabels: boolean,
): void {
  for (const port of [...inputs, ...outputs]) {
    const color = getPortColor(port.dataType, port.isFailure, themeName);
    const ringColor = getPortRingColor(port.dataType, port.isFailure, themeName);

    parts.push(`    <circle cx="${port.cx}" cy="${port.cy}" r="${PORT_RADIUS}" fill="${color}" stroke="${ringColor}" stroke-width="2"/>`);

    if (showPortLabels) {
      const isInput = port.direction === 'INPUT';
      const abbrev = TYPE_ABBREVIATIONS[port.dataType] ?? port.dataType;

      const portLabel = port.label;
      const typeWidth = measureText(abbrev);
      const labelWidth = measureText(portLabel);
      const pad = 7;
      const divGap = 4; // space on each side of divider
      const badgeWidth = pad + typeWidth + divGap + 1 + divGap + labelWidth + pad;
      const badgeHeight = 16;
      const badgeGap = 5;
      const rr = badgeHeight / 2; // full pill radius

      if (isInput) {
        // Right-aligned: [label | TYPE] ● — content hugs the port dot
        const badgeX = port.cx - PORT_RADIUS - badgeGap - badgeWidth;
        const badgeY = port.cy - badgeHeight / 2;
        parts.push(`    <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${rr}" fill="${theme.nodeFill}" stroke="${theme.labelBadgeBorder}" stroke-width="1"/>`);
        const typeX = badgeX + badgeWidth - pad - typeWidth / 2;
        const divX = typeX - typeWidth / 2 - divGap;
        const nameX = divX - divGap;
        parts.push(`    <line x1="${divX}" y1="${badgeY + 3}" x2="${divX}" y2="${badgeY + badgeHeight - 3}" stroke="${theme.labelBadgeBorder}" stroke-width="1"/>`);
        parts.push(`    <text class="port-label" x="${nameX}" y="${port.cy + 3.5}" text-anchor="end">${escapeXml(portLabel)}</text>`);
        parts.push(`    <text class="port-type-label" x="${typeX}" y="${port.cy + 3.5}" text-anchor="middle" fill="${color}">${escapeXml(abbrev)}</text>`);
      } else {
        // Left-aligned: ● [TYPE | label] — content hugs the port dot
        const badgeX = port.cx + PORT_RADIUS + badgeGap;
        const badgeY = port.cy - badgeHeight / 2;
        parts.push(`    <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${rr}" fill="${theme.nodeFill}" stroke="${theme.labelBadgeBorder}" stroke-width="1"/>`);
        const typeX = badgeX + pad + typeWidth / 2;
        const divX = badgeX + pad + typeWidth + divGap;
        const nameX = divX + 1 + divGap;
        parts.push(`    <line x1="${divX}" y1="${badgeY + 3}" x2="${divX}" y2="${badgeY + badgeHeight - 3}" stroke="${theme.labelBadgeBorder}" stroke-width="1"/>`);
        parts.push(`    <text class="port-type-label" x="${typeX}" y="${port.cy + 3.5}" text-anchor="middle" fill="${color}">${escapeXml(abbrev)}</text>`);
        parts.push(`    <text class="port-label" x="${nameX}" y="${port.cy + 3.5}" text-anchor="start">${escapeXml(portLabel)}</text>`);
      }
    }
  }
}
