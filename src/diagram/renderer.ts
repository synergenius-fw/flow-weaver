import type { DiagramGraph, DiagramNode, DiagramConnection, DiagramStub, DiagramOptions, DiagramPort, ThemePalette } from './types';
import { getTheme, getPortColor, getPortRingColor, TYPE_ABBREVIATIONS, NODE_ICON_PATHS, NODE_DEFAULT_COLOR, NODE_VARIANT_COLORS } from './theme';
import { PORT_RADIUS, BORDER_RADIUS, LABEL_HEIGHT, LABEL_GAP, SCOPE_PORT_COLUMN, measureText } from './geometry';

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Resolve icon color from a node's resolved border hex back to the variant icon color */
function resolveIconColor(nodeColor: string, themeName: 'dark' | 'light', theme: ThemePalette): string {
  if (nodeColor === NODE_DEFAULT_COLOR) return theme.nodeIconColor;
  for (const v of Object.values(NODE_VARIANT_COLORS)) {
    if (v.darkBorder === nodeColor || v.border === nodeColor) {
      return themeName === 'dark' ? v.darkIcon : v.icon;
    }
  }
  return nodeColor; // custom hex — use as-is
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
  parts.push(`  text { font-family: Montserrat, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }`);
  parts.push(`  .node-label { font-size: 18px; font-weight: 600; fill: ${theme.labelColor}; }`);
  parts.push(`  .port-label { font-size: 10px; font-weight: 600; fill: ${theme.labelColor}; }`);
  parts.push(`  .port-type-label { font-size: 10px; font-weight: 600; }`);
  parts.push(`</style>`);

  // Defs (dot grid pattern + node shadow filter + connection gradients)
  parts.push(`<defs>`);
  parts.push(`  <pattern id="dot-grid" width="20" height="20" patternUnits="userSpaceOnUse">`);
  parts.push(`    <circle cx="10" cy="10" r="0.75" fill="${theme.dotColor}" opacity="${theme.dotOpacity}"/>`);
  parts.push(`  </pattern>`);
  // No drop shadow — matches platform (nodes use outline glow, not shadow)
  for (let i = 0; i < allConnections.length; i++) {
    const conn = allConnections[i];
    // Use userSpaceOnUse so gradients work on flat horizontal paths
    // (objectBoundingBox fails when bounding box height is zero)
    parts.push(`  <linearGradient id="conn-grad-${i}" gradientUnits="userSpaceOnUse" x1="${vbX}" y1="0" x2="${vbX + vbWidth}" y2="0">`);
    parts.push(`    <stop offset="0%" stop-color="${conn.sourceColor}"/>`);
    parts.push(`    <stop offset="100%" stop-color="${conn.targetColor}"/>`);
    parts.push(`  </linearGradient>`);
  }
  parts.push(`</defs>`);

  // Background
  parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbWidth}" height="${vbHeight}" fill="${theme.background}"/>`);
  parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbWidth}" height="${vbHeight}" fill="url(#dot-grid)"/>`);

  // Connections + stubs (below nodes and labels)
  parts.push(`<g class="connections">`);
  for (let i = 0; i < graph.connections.length; i++) {
    renderConnection(parts, graph.connections[i], i, !graph.connections[i].path);
  }
  parts.push(`  <g class="stubs">`);
  for (const conn of graph.connections) {
    const hideStubs = !!conn.path;
    if (conn.sourceStub) renderStub(parts, conn.sourceStub, conn, hideStubs);
    if (conn.targetStub) renderStub(parts, conn.targetStub, conn, hideStubs);
  }
  parts.push(`  </g>`);
  parts.push(`</g>`);

  // Nodes (bodies, icons, port dots)
  parts.push(`<g class="nodes">`);
  for (const node of graph.nodes) {
    parts.push(renderNode(node, theme, themeName, allConnections));
  }
  parts.push(`</g>`);

  // Labels rendered last so they appear on top of everything
  parts.push(`<g class="labels">`);
  for (const node of graph.nodes) {
    renderNodeLabel(parts, node, theme);
    renderPortLabelsForNode(parts, node, theme, themeName, showPortLabels);

    if (node.scopeChildren) {
      for (const child of node.scopeChildren) {
        renderNodeLabel(parts, child, theme);
      }
      if (showPortLabels && node.scopePorts) {
        renderPortLabels(parts, node.id, node.scopePorts.inputs, node.scopePorts.outputs, theme, themeName);
      }
      for (const child of node.scopeChildren) {
        renderPortLabelsForNode(parts, child, theme, themeName, showPortLabels);
      }
    }
  }
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join('\n');
}

// ---- Connection rendering ----

function renderConnection(parts: string[], conn: DiagramConnection, gradIndex: number, hidden = false): void {
  const dashAttr = conn.isStepConnection ? '' : ' stroke-dasharray="8 4"';
  const displayAttr = hidden ? ' display="none"' : '';
  const pathD = conn.path || 'M0,0';
  parts.push(
    `  <path d="${pathD}" fill="none" stroke="url(#conn-grad-${gradIndex})" stroke-width="1"${dashAttr} stroke-linecap="round" data-source="${escapeXml(conn.fromNode)}.${escapeXml(conn.fromPort)}:output" data-target="${escapeXml(conn.toNode)}.${escapeXml(conn.toPort)}:input"${displayAttr}/>`,
  );
}

function renderStub(parts: string[], stub: DiagramStub, conn: DiagramConnection, hidden = false): void {
  const dashAttr = stub.dashed ? ' stroke-dasharray="6 3"' : '';
  const displayAttr = hidden ? ' display="none"' : '';
  const dataAttrs = `data-source="${escapeXml(conn.fromNode)}.${escapeXml(conn.fromPort)}:output" data-target="${escapeXml(conn.toNode)}.${escapeXml(conn.toPort)}:input"`;
  const isSource = stub.endX > stub.x; // source stubs go right
  const stubDir = isSource ? 'source' : 'target';
  parts.push(`  <g class="stub" data-stub="${stubDir}" ${dataAttrs}${displayAttr}>`);
  const linecap = stub.dashed ? 'butt' : 'round';
  parts.push(`    <line x1="${stub.x}" y1="${stub.y}" x2="${stub.endX}" y2="${stub.y}" stroke="${stub.color}" stroke-width="2"${dashAttr} stroke-linecap="${linecap}"/>`);
  parts.push(`    <circle cx="${stub.endX}" cy="${stub.y}" r="3" fill="${stub.color}"/>`);
  parts.push(`  </g>`);
}

function renderScopeConnection(parts: string[], conn: DiagramConnection, allConnections: DiagramConnection[], parentNodeId: string): void {
  const gradIndex = allConnections.indexOf(conn);
  if (gradIndex < 0) return;
  const dashAttr = conn.isStepConnection ? '' : ' stroke-dasharray="8 4"';
  parts.push(
    `    <path d="${conn.path}" fill="none" stroke="url(#conn-grad-${gradIndex})" stroke-width="1"${dashAttr} stroke-linecap="round" data-source="${escapeXml(conn.fromNode)}.${escapeXml(conn.fromPort)}:output" data-target="${escapeXml(conn.toNode)}.${escapeXml(conn.toPort)}:input" data-scope="${escapeXml(parentNodeId)}"/>`,
  );
}

// ---- Node rendering ----

/** Render node body rect + icon */
function renderNodeBody(parts: string[], node: DiagramNode, theme: ThemePalette, themeName: 'dark' | 'light', indent: string): void {
  const strokeColor = node.color !== NODE_DEFAULT_COLOR ? node.color : theme.nodeIconColor;
  parts.push(
    `${indent}<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${BORDER_RADIUS}" fill="${theme.background}" stroke="${strokeColor}" stroke-width="2"/>`,
  );

  const iconPath = NODE_ICON_PATHS[node.icon] ?? NODE_ICON_PATHS.code;
  // node.color is a resolved hex (e.g. "#5e9eff"), find matching variant by border value
  const iconColor = resolveIconColor(node.color, themeName, theme);
  const iconSize = 50;
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
    // Scoped node: body rect only (icon omitted — children occupy the inner area)
    const strokeColor = node.color !== NODE_DEFAULT_COLOR ? node.color : theme.nodeIconColor;
    parts.push(
      `    <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${BORDER_RADIUS}" fill="${theme.background}" stroke="${strokeColor}" stroke-width="2"/>`,
    );
    renderScopedContent(parts, node, theme, themeName, allConnections);
  } else {
    renderNodeBody(parts, node, theme, themeName, '    ');
  }

  // External port dots (labels rendered in top-level labels pass)
  renderPortDots(parts, node.id, node.inputs, node.outputs, themeName, theme);
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

  // Scope area dividers — matches platform scopeContainerStyle (2px solid outline columns)
  // Vertical lines at left/right scope port columns + horizontal top/bottom dividers
  const scopeX = node.x + SCOPE_PORT_COLUMN;
  const scopeW = node.width - SCOPE_PORT_COLUMN * 2;
  const scopeRightX = node.x + node.width - SCOPE_PORT_COLUMN;
  const lineY1 = node.y;
  const lineY2 = node.y + node.height;
  const strokeColor = node.color !== NODE_DEFAULT_COLOR ? node.color : theme.nodeIconColor;
  // Vertical column dividers (left and right scope port columns)
  parts.push(
    `    <line x1="${scopeX}" y1="${lineY1}" x2="${scopeX}" y2="${lineY2}" stroke="${strokeColor}" stroke-width="2" opacity="0.5"/>`,
  );
  parts.push(
    `    <line x1="${scopeRightX}" y1="${lineY1}" x2="${scopeRightX}" y2="${lineY2}" stroke="${strokeColor}" stroke-width="2" opacity="0.5"/>`,
  );
  // Horizontal top/bottom area dividers
  parts.push(
    `    <line x1="${scopeX}" y1="${lineY1 + 2}" x2="${scopeRightX}" y2="${lineY1 + 2}" stroke="${theme.scopeAreaStroke}" stroke-width="1" opacity="0.3"/>`,
  );
  parts.push(
    `    <line x1="${scopeX}" y1="${lineY2 - 2}" x2="${scopeRightX}" y2="${lineY2 - 2}" stroke="${theme.scopeAreaStroke}" stroke-width="1" opacity="0.3"/>`,
  );

  // Scope connections (before ports so ports appear on top)
  for (const conn of node.scopeConnections ?? []) {
    renderScopeConnection(parts, conn, allConnections, node.id);
  }

  // Scope port dots (before children so dots sit on top of connections)
  if (scopePorts) {
    renderPortDots(parts, node.id, scopePorts.inputs, scopePorts.outputs, themeName, theme);
  }

  // Child nodes (all labels handled in top-level labels pass)
  for (const child of children) {
    parts.push(`    <g data-node-id="${escapeXml(child.id)}">`);
    renderNodeBody(parts, child, theme, themeName, '      ');
    renderPortDots(parts, child.id, child.inputs, child.outputs, themeName, theme);
    parts.push(`    </g>`);
  }
}

// ---- Label rendering ----

/** Render a node name label (plain text, no badge background — matches platform) */
function renderNodeLabel(parts: string[], node: DiagramNode, theme: ThemePalette): void {
  const isScoped = !!(node.scopeChildren && node.scopeChildren.length > 0);
  const labelText = escapeXml(node.label);
  const labelTextX = isScoped ? node.x + 6 : node.x + node.width / 2;
  const labelTextY = node.y - LABEL_GAP;
  const labelAnchor = isScoped ? 'start' : 'middle';
  const labelColor = node.color !== NODE_DEFAULT_COLOR ? node.color : theme.labelColor;

  parts.push(`    <g data-label-for="${escapeXml(node.id)}">`);
  parts.push(`      <text class="node-label" x="${labelTextX}" y="${labelTextY}" text-anchor="${labelAnchor}" fill="${labelColor}">${labelText}</text>`);
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

/** Render port indicators: outer ring (port color) + inner bar (bg) matching platform portStyle */
function renderPortDots(
  parts: string[],
  nodeId: string,
  inputs: readonly DiagramPort[],
  outputs: readonly DiagramPort[],
  themeName: 'dark' | 'light',
  theme: ThemePalette,
): void {
  // 2px bar with 2px colored ring (boxShadow) — matches platform portStyle
  // SVG equivalent: inner rect (subtle bg) + outer rect (port color, slightly larger)
  const barWidth = 2;
  const barHeight = 14;
  const ringWidth = 2; // boxShadow spread
  const outerW = barWidth + ringWidth * 2; // 6px total
  const outerH = barHeight + ringWidth * 2; // 18px total
  for (const port of [...inputs, ...outputs]) {
    const color = getPortColor(port.dataType, port.isFailure, themeName);
    const dir = port.direction === 'INPUT' ? 'input' : 'output';
    const ox = port.cx - outerW / 2;
    const oy = port.cy - outerH / 2;
    const ix = port.cx - barWidth / 2;
    const iy = port.cy - barHeight / 2;
    // Outer ring (port-type color)
    parts.push(`    <rect x="${ox}" y="${oy}" width="${outerW}" height="${outerH}" rx="4" fill="${color}" data-port-id="${escapeXml(nodeId)}.${escapeXml(port.name)}:${dir}" data-direction="${dir}"/>`);
    // Inner bar (subtle bg)
    parts.push(`    <rect x="${ix}" y="${iy}" width="${barWidth}" height="${barHeight}" rx="2" fill="${theme.background}" pointer-events="none"/>`);
  }
}

/** Render only port label badges (no dots) — rectangular with port-type border */
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
    const dir = isInput ? 'input' : 'output';
    const portId = `${escapeXml(nodeId)}.${escapeXml(port.name)}:${dir}`;

    const portLabel = port.label;
    const labelWidth = measureText(portLabel);
    const pad = 6;
    const gap = 4;
    const abbrev = TYPE_ABBREVIATIONS[port.dataType] ?? port.dataType;
    const typeWidth = measureText(abbrev);
    const badgeWidth = pad + typeWidth + gap + labelWidth + pad;
    const badgeHeight = 16;
    const badgeGap = 5;

    const badgeX = isInput
      ? port.cx - PORT_RADIUS - badgeGap - badgeWidth
      : port.cx + PORT_RADIUS + badgeGap;
    const badgeY = port.cy - badgeHeight / 2;

    parts.push(`    <g data-port-label="${portId}">`);
    parts.push(`      <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="3" fill="${theme.background}" stroke="${color}" stroke-width="1"/>`);

    if (isInput) {
      const typeX = badgeX + badgeWidth - pad - typeWidth / 2;
      const nameX = typeX - typeWidth / 2 - gap;
      parts.push(`      <text class="port-label" x="${nameX}" y="${port.cy + 3.5}" text-anchor="end">${escapeXml(portLabel)}</text>`);
      parts.push(`      <text class="port-type-label" x="${typeX}" y="${port.cy + 3.5}" text-anchor="middle" fill="${color}">${escapeXml(abbrev)}</text>`);
    } else {
      const typeX = badgeX + pad + typeWidth / 2;
      const nameX = typeX + typeWidth / 2 + gap;
      parts.push(`      <text class="port-type-label" x="${typeX}" y="${port.cy + 3.5}" text-anchor="middle" fill="${color}">${escapeXml(abbrev)}</text>`);
      parts.push(`      <text class="port-label" x="${nameX}" y="${port.cy + 3.5}" text-anchor="start">${escapeXml(portLabel)}</text>`);
    }
    parts.push(`    </g>`);
  }
}
