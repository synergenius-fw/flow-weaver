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

  let { width: vbWidth, height: vbHeight, originX: vbX, originY: vbY } = graph.bounds;
  vbX = vbX ?? 0;
  vbY = vbY ?? 0;

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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbWidth} ${vbHeight}" width="${svgWidth}" height="${svgHeight}">`,
  );

  // Styles
  parts.push(`<style>`);
  parts.push(`  text { font-family: Montserrat, 'Segoe UI', Roboto, sans-serif; }`);
  parts.push(`  .node-label { font-size: 13px; font-weight: 700; fill: ${theme.labelColor}; }`);
  parts.push(`  .port-label { font-size: 10px; font-weight: 600; fill: ${theme.labelColor}; }`);
  parts.push(`  .port-type-label { font-size: 10px; font-weight: 600; }`);
  parts.push(`</style>`);

  // Defs (dot grid pattern + connection gradients)
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

  // Connections
  parts.push(`<g class="connections">`);
  for (let i = 0; i < graph.connections.length; i++) {
    renderConnection(parts, graph.connections[i], i);
  }
  parts.push(`</g>`);

  // Nodes (bodies, icons, port dots — no labels)
  parts.push(`<g class="nodes">`);
  for (const node of graph.nodes) {
    parts.push(renderNode(node, theme, themeName, allConnections));
  }
  parts.push(`</g>`);

  // Labels rendered last so they appear on top of everything (single pass)
  parts.push(`<g class="labels">`);
  for (const node of graph.nodes) {
    renderNodeLabel(parts, node, theme);
    renderPortLabelsForNode(parts, node, theme, themeName, showPortLabels);

    if (node.scopeChildren) {
      for (const child of node.scopeChildren) {
        renderNodeLabel(parts, child, theme);
      }
      // Scope port labels + child port labels
      if (showPortLabels && node.scopePorts) {
        renderPortLabels(parts, node.id, node.scopePorts.inputs, node.scopePorts.outputs, theme, themeName);
      }
      for (const child of node.scopeChildren) {
        renderPortLabelsForNode(parts, child, theme, themeName, showPortLabels);
      }
    }
  }
  parts.push(`</g>`);

  // Watermark (logo + text)
  const wmX = vbX + vbWidth - 16;
  const wmY = vbY + vbHeight - 14;
  const wmBrand = themeName === 'dark' ? '#8e9eff' : '#5468ff';
  parts.push(`<g opacity="0.5">`);
  parts.push(`  <svg x="${wmX - 118}" y="${wmY - 18}" width="22" height="22" viewBox="0 0 256 256" fill="none"><path d="M80 128C134 128 122 49 176 49" stroke="${wmBrand}" stroke-width="14" stroke-linecap="round"/><path d="M80 128C134 128 122 207 176 207" stroke="${wmBrand}" stroke-width="14" stroke-linecap="round"/><rect x="28" y="102" width="52" height="52" rx="10" stroke="${wmBrand}" stroke-width="14"/><rect x="176" y="23" width="52" height="52" rx="10" stroke="${wmBrand}" stroke-width="14"/><rect x="176" y="181" width="52" height="52" rx="10" stroke="${wmBrand}" stroke-width="14"/></svg>`);
  parts.push(`  <text x="${wmX}" y="${wmY}" text-anchor="end" font-size="14" font-weight="700" fill="${wmBrand}" font-family="Montserrat, 'Segoe UI', Roboto, sans-serif">Flow Weaver</text>`);
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join('\n');
}

// ---- Connection rendering ----

function renderConnection(parts: string[], conn: DiagramConnection, gradIndex: number): void {
  const dashAttr = conn.isStepConnection ? '' : ' stroke-dasharray="8 4"';
  parts.push(
    `  <path d="${conn.path}" fill="none" stroke="url(#conn-grad-${gradIndex})" stroke-width="3"${dashAttr} stroke-linecap="round" data-source="${escapeXml(conn.fromNode)}.${escapeXml(conn.fromPort)}:output" data-target="${escapeXml(conn.toNode)}.${escapeXml(conn.toPort)}:input"/>`,
  );
}

function renderScopeConnection(parts: string[], conn: DiagramConnection, allConnections: DiagramConnection[], parentNodeId: string): void {
  const gradIndex = allConnections.indexOf(conn);
  if (gradIndex < 0) return;
  const dashAttr = conn.isStepConnection ? '' : ' stroke-dasharray="8 4"';
  parts.push(
    `    <path d="${conn.path}" fill="none" stroke="url(#conn-grad-${gradIndex})" stroke-width="2.5"${dashAttr} stroke-linecap="round" data-source="${escapeXml(conn.fromNode)}.${escapeXml(conn.fromPort)}:output" data-target="${escapeXml(conn.toNode)}.${escapeXml(conn.toPort)}:input" data-scope="${escapeXml(parentNodeId)}"/>`,
  );
}

// ---- Node rendering ----

/** Render node body rect + icon */
function renderNodeBody(parts: string[], node: DiagramNode, theme: ThemePalette, indent: string): void {
  const strokeColor = node.color !== '#334155' ? node.color : theme.nodeIconColor;
  parts.push(
    `${indent}<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${BORDER_RADIUS}" fill="${theme.nodeFill}" stroke="${strokeColor}" stroke-width="2"/>`,
  );

  const iconPath = NODE_ICON_PATHS[node.icon] ?? NODE_ICON_PATHS.code;
  const iconColor = node.color !== '#334155' ? node.color : theme.nodeIconColor;
  const iconSize = 40;
  const iconX = node.x + (node.width - iconSize) / 2;
  const iconY = node.y + (node.height - iconSize) / 2;
  parts.push(
    `${indent}<svg x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" viewBox="0 -960 960 960"><path d="${iconPath}" fill="${iconColor}"/></svg>`,
  );
}

function renderNode(
  node: DiagramNode,
  theme: ThemePalette,
  themeName: 'dark' | 'light',
  allConnections: DiagramConnection[],
): string {
  const parts: string[] = [];
  parts.push(`  <g data-node-id="${escapeXml(node.id)}">`);

  if (node.scopeChildren && node.scopeChildren.length > 0) {
    // Scoped node: body rect only (no icon), then scope internals
    const strokeColor = node.color !== '#334155' ? node.color : theme.nodeIconColor;
    parts.push(
      `    <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${BORDER_RADIUS}" fill="${theme.nodeFill}" stroke="${strokeColor}" stroke-width="2"/>`,
    );
    renderScopedContent(parts, node, theme, themeName, allConnections);
  } else {
    renderNodeBody(parts, node, theme, '    ');
  }

  // External port dots (labels rendered in top-level labels pass)
  renderPortDots(parts, node.id, node.inputs, node.outputs, themeName);
  parts.push(`  </g>`);

  return parts.join('\n');
}

function renderScopedContent(
  parts: string[],
  node: DiagramNode,
  theme: ThemePalette,
  themeName: 'dark' | 'light',
  allConnections: DiagramConnection[],
): void {
  const children = node.scopeChildren!;
  const scopePorts = node.scopePorts;

  // Scope area inner rectangle
  const scopeX = node.x + SCOPE_PORT_COLUMN;
  const scopeY = node.y + 4;
  const scopeW = node.width - SCOPE_PORT_COLUMN * 2;
  const scopeH = node.height - 8;
  parts.push(
    `    <rect x="${scopeX}" y="${scopeY}" width="${scopeW}" height="${scopeH}" rx="4" fill="none" stroke="${theme.scopeAreaStroke}" stroke-width="1" stroke-dasharray="4 2" opacity="0.5"/>`,
  );

  // Scope connections (before ports so ports appear on top)
  for (const conn of node.scopeConnections ?? []) {
    renderScopeConnection(parts, conn, allConnections, node.id);
  }

  // Scope port dots (before children so dots sit on top of connections)
  if (scopePorts) {
    renderPortDots(parts, node.id, scopePorts.inputs, scopePorts.outputs, themeName);
  }

  // Child nodes (all labels handled in top-level labels pass)
  for (const child of children) {
    parts.push(`    <g data-node-id="${escapeXml(child.id)}">`);
    renderNodeBody(parts, child, theme, '      ');
    renderPortDots(parts, child.id, child.inputs, child.outputs, themeName);
    parts.push(`    </g>`);
  }
}

// ---- Label rendering ----

/** Render a node name label badge */
function renderNodeLabel(parts: string[], node: DiagramNode, theme: ThemePalette): void {
  const isScoped = !!(node.scopeChildren && node.scopeChildren.length > 0);
  const labelText = escapeXml(node.label);
  const textWidth = labelText.length * 7;
  const labelBgWidth = textWidth + 16;
  const labelBgHeight = LABEL_HEIGHT;
  const labelBgX = isScoped ? node.x : node.x + node.width / 2 - labelBgWidth / 2;
  const labelBgY = node.y - LABEL_GAP - labelBgHeight;
  const labelTextX = isScoped ? node.x + 8 : node.x + node.width / 2;
  const labelAnchor = isScoped ? 'start' : 'middle';

  parts.push(`    <g data-label-for="${escapeXml(node.id)}">`);
  parts.push(`      <rect x="${labelBgX}" y="${labelBgY}" width="${labelBgWidth}" height="${labelBgHeight}" rx="6" fill="${theme.labelBadgeFill}" opacity="0.8"/>`);
  parts.push(`      <text class="node-label" x="${labelTextX}" y="${labelBgY + labelBgHeight / 2 + 6}" text-anchor="${labelAnchor}" fill="${node.color !== '#334155' ? node.color : theme.labelColor}">${labelText}</text>`);
  parts.push(`    </g>`);
}

/** Render port labels for a node if showPortLabels is enabled */
function renderPortLabelsForNode(
  parts: string[],
  node: DiagramNode,
  theme: ThemePalette,
  themeName: 'dark' | 'light',
  showPortLabels: boolean,
): void {
  if (showPortLabels) {
    renderPortLabels(parts, node.id, node.inputs, node.outputs, theme, themeName);
  }
}

// ---- Port rendering ----

/** Render only port dot circles (no labels) */
function renderPortDots(
  parts: string[],
  nodeId: string,
  inputs: readonly DiagramPort[],
  outputs: readonly DiagramPort[],
  themeName: 'dark' | 'light',
): void {
  for (const port of [...inputs, ...outputs]) {
    const color = getPortColor(port.dataType, port.isFailure, themeName);
    const ringColor = getPortRingColor(port.dataType, port.isFailure, themeName);
    const dir = port.direction === 'INPUT' ? 'input' : 'output';
    parts.push(`    <circle cx="${port.cx}" cy="${port.cy}" r="${PORT_RADIUS}" fill="${color}" stroke="${ringColor}" stroke-width="2" data-port-id="${escapeXml(nodeId)}.${escapeXml(port.name)}:${dir}" data-direction="${dir}"/>`);
  }
}

/** Render only port label badges (no dots) */
function renderPortLabels(
  parts: string[],
  nodeId: string,
  inputs: readonly DiagramPort[],
  outputs: readonly DiagramPort[],
  theme: ThemePalette,
  themeName: 'dark' | 'light',
): void {
  for (const port of [...inputs, ...outputs]) {
    const color = getPortColor(port.dataType, port.isFailure, themeName);
    const isInput = port.direction === 'INPUT';
    const abbrev = TYPE_ABBREVIATIONS[port.dataType] ?? port.dataType;
    const dir = isInput ? 'input' : 'output';
    const portId = `${escapeXml(nodeId)}.${escapeXml(port.name)}:${dir}`;

    const portLabel = port.label;
    const typeWidth = measureText(abbrev);
    const labelWidth = measureText(portLabel);
    const pad = 7;
    const divGap = 4;
    const badgeWidth = pad + typeWidth + divGap + 1 + divGap + labelWidth + pad;
    const badgeHeight = 16;
    const badgeGap = 5;
    const rr = badgeHeight / 2;

    const badgeX = isInput
      ? port.cx - PORT_RADIUS - badgeGap - badgeWidth
      : port.cx + PORT_RADIUS + badgeGap;
    const badgeY = port.cy - badgeHeight / 2;

    parts.push(`    <g data-port-label="${portId}">`);
    parts.push(`      <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${rr}" fill="${theme.nodeFill}" stroke="${theme.labelBadgeBorder}" stroke-width="1"/>`);

    if (isInput) {
      const typeX = badgeX + badgeWidth - pad - typeWidth / 2;
      const divX = typeX - typeWidth / 2 - divGap;
      const nameX = divX - divGap;
      parts.push(`      <line x1="${divX}" y1="${badgeY + 3}" x2="${divX}" y2="${badgeY + badgeHeight - 3}" stroke="${theme.labelBadgeBorder}" stroke-width="1"/>`);
      parts.push(`      <text class="port-label" x="${nameX}" y="${port.cy + 3.5}" text-anchor="end">${escapeXml(portLabel)}</text>`);
      parts.push(`      <text class="port-type-label" x="${typeX}" y="${port.cy + 3.5}" text-anchor="middle" fill="${color}">${escapeXml(abbrev)}</text>`);
    } else {
      const typeX = badgeX + pad + typeWidth / 2;
      const divX = badgeX + pad + typeWidth + divGap;
      const nameX = divX + 1 + divGap;
      parts.push(`      <line x1="${divX}" y1="${badgeY + 3}" x2="${divX}" y2="${badgeY + badgeHeight - 3}" stroke="${theme.labelBadgeBorder}" stroke-width="1"/>`);
      parts.push(`      <text class="port-type-label" x="${typeX}" y="${port.cy + 3.5}" text-anchor="middle" fill="${color}">${escapeXml(abbrev)}</text>`);
      parts.push(`      <text class="port-label" x="${nameX}" y="${port.cy + 3.5}" text-anchor="start">${escapeXml(portLabel)}</text>`);
    }
    parts.push(`    </g>`);
  }
}
