/**
 * ASCII-based renderers for workflow diagrams.
 *
 * Three formats:
 * - renderASCII: port-level detail with box-drawing, connections drawn between ports
 * - renderASCIICompact: single-row compact node boxes
 * - renderText: structured text listing (most LLM-parseable)
 */

import type { DiagramGraph, DiagramNode, DiagramPort, DiagramConnection } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByLayer(nodes: DiagramNode[]): DiagramNode[][] {
  if (nodes.length === 0) return [];
  const sorted = [...nodes].sort((a, b) => a.x - b.x);
  const layers: DiagramNode[][] = [];
  let currentX = sorted[0].x;
  let currentLayer: DiagramNode[] = [];
  for (const node of sorted) {
    if (Math.abs(node.x - currentX) > 10) {
      layers.push(currentLayer);
      currentLayer = [];
      currentX = node.x;
    }
    currentLayer.push(node);
  }
  if (currentLayer.length > 0) layers.push(currentLayer);
  return layers;
}

function buildConnectedPorts(connections: DiagramConnection[]): Set<string> {
  const s = new Set<string>();
  for (const c of connections) {
    s.add(`${c.fromNode}.${c.fromPort}`);
    s.add(`${c.toNode}.${c.toPort}`);
  }
  return s;
}

function portSymbol(nodeId: string, port: DiagramPort, connected: Set<string>): string {
  return connected.has(`${nodeId}.${port.name}`) ? '\u25CF' : '\u25CB';
}

// ── Corner characters ────────────────────────────────────────────────────────

/**
 * Pick the right corner box-drawing character.
 * hDir: which side of the corner the horizontal segment extends to.
 * vDir: which side of the corner the vertical segment extends to.
 */
function cornerChar(isStep: boolean, hDir: 'left' | 'right', vDir: 'up' | 'down'): string {
  if (hDir === 'right' && vDir === 'down') return isStep ? '\u2554' : '\u250C'; // ╔ ┌
  if (hDir === 'left'  && vDir === 'down') return isStep ? '\u2557' : '\u2510'; // ╗ ┐
  if (hDir === 'right' && vDir === 'up')   return isStep ? '\u255A' : '\u2514'; // ╚ └
  if (hDir === 'left'  && vDir === 'up')   return isStep ? '\u255D' : '\u2518'; // ╝ ┘
  return '\u253C'; // ┼ fallback
}

// ── 2D character grid ────────────────────────────────────────────────────────

const H_CHARS = new Set('\u2500\u2550'); // ─ ═
const V_CHARS = new Set('\u2502\u2551'); // │ ║

class CharGrid {
  private cells: string[];
  width: number;
  height: number;

  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.cells = new Array(w * h).fill(' ');
  }

  set(x: number, y: number, ch: string): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const existing = this.cells[y * this.width + x];
    if (existing !== ' ') {
      // Handle crossings: horizontal meets vertical
      if ((H_CHARS.has(ch) && V_CHARS.has(existing)) || (V_CHARS.has(ch) && H_CHARS.has(existing))) {
        this.cells[y * this.width + x] = '\u253C'; // ┼
        return;
      }
      // Same direction: keep existing (shared path)
      if ((H_CHARS.has(ch) && H_CHARS.has(existing)) || (V_CHARS.has(ch) && V_CHARS.has(existing))) {
        return;
      }
    }
    this.cells[y * this.width + x] = ch;
  }

  get(x: number, y: number): string {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      return this.cells[y * this.width + x];
    }
    return ' ';
  }

  /** Force-write, ignoring collision logic (for boxes and text). */
  forceSet(x: number, y: number, ch: string): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.cells[y * this.width + x] = ch;
    }
  }

  writeStr(x: number, y: number, s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.forceSet(x + i, y, s[i]);
    }
  }

  toLines(): string[] {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let line = '';
      for (let x = 0; x < this.width; x++) {
        line += this.cells[y * this.width + x];
      }
      lines.push(line.trimEnd());
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
}

// ── Box building ─────────────────────────────────────────────────────────────

interface PortRow { input: DiagramPort | null; output: DiagramPort | null; }

function mergePortRows(inputs: DiagramPort[], outputs: DiagramPort[]): PortRow[] {
  const rows: PortRow[] = [];
  const maxLen = Math.max(inputs.length, outputs.length);
  for (let i = 0; i < maxLen; i++) {
    rows.push({
      input: i < inputs.length ? inputs[i] : null,
      output: i < outputs.length ? outputs[i] : null,
    });
  }
  return rows;
}

interface BoxInfo {
  node: DiagramNode;
  innerWidth: number;
  boxWidth: number;
  portRows: PortRow[];
  boxHeight: number;
  portRowOffsets: Map<string, number>;
}

function measureBox(node: DiagramNode): BoxInfo {
  const portRows = mergePortRows(node.inputs, node.outputs);
  const maxInputPortLen = node.inputs.length > 0 ? Math.max(...node.inputs.map(p => p.name.length)) : 0;
  const maxOutputPortLen = node.outputs.length > 0 ? Math.max(...node.outputs.map(p => p.name.length)) : 0;
  const portsContentWidth = (maxInputPortLen > 0 ? maxInputPortLen + 2 : 0)
    + 2
    + (maxOutputPortLen > 0 ? maxOutputPortLen + 2 : 0);
  const innerWidth = Math.max(node.label.length + 2, portsContentWidth, 10);
  const boxWidth = innerWidth + 2;
  const headerRows = 3;
  const portRowCount = Math.max(portRows.length, 1);
  const boxHeight = headerRows + portRowCount + 1;

  const portRowOffsets = new Map<string, number>();
  for (let i = 0; i < portRows.length; i++) {
    if (portRows[i].input) portRowOffsets.set(portRows[i].input!.name, headerRows + i);
    if (portRows[i].output) portRowOffsets.set(portRows[i].output!.name, headerRows + i);
  }

  return { node, innerWidth, boxWidth, portRows, boxHeight, portRowOffsets };
}

function drawBox(grid: CharGrid, box: BoxInfo, bx: number, by: number, connected: Set<string>): void {
  const { innerWidth, portRows, node } = box;
  grid.forceSet(bx, by, '\u250C');
  for (let i = 0; i < innerWidth; i++) grid.forceSet(bx + 1 + i, by, '\u2500');
  grid.forceSet(bx + innerWidth + 1, by, '\u2510');

  const labelPad = innerWidth - node.label.length;
  const padL = Math.floor(labelPad / 2);
  grid.forceSet(bx, by + 1, '\u2502');
  grid.writeStr(bx + 1 + padL, by + 1, node.label);
  grid.forceSet(bx + innerWidth + 1, by + 1, '\u2502');

  grid.forceSet(bx, by + 2, '\u251C');
  for (let i = 0; i < innerWidth; i++) grid.forceSet(bx + 1 + i, by + 2, '\u2500');
  grid.forceSet(bx + innerWidth + 1, by + 2, '\u2524');

  for (let i = 0; i < Math.max(portRows.length, 1); i++) {
    const ry = by + 3 + i;
    grid.forceSet(bx, ry, '\u2502');
    grid.forceSet(bx + innerWidth + 1, ry, '\u2502');
    if (i < portRows.length) {
      const row = portRows[i];
      if (row.input) {
        grid.writeStr(bx + 1, ry, `${portSymbol(node.id, row.input, connected)} ${row.input.name}`);
      }
      if (row.output) {
        const txt = `${row.output.name} ${portSymbol(node.id, row.output, connected)}`;
        grid.writeStr(bx + innerWidth + 1 - txt.length, ry, txt);
      }
    }
  }

  const bottomY = by + box.boxHeight - 1;
  grid.forceSet(bx, bottomY, '\u2514');
  for (let i = 0; i < innerWidth; i++) grid.forceSet(bx + 1 + i, bottomY, '\u2500');
  grid.forceSet(bx + innerWidth + 1, bottomY, '\u2518');
}

// ── renderASCII ──────────────────────────────────────────────────────────────

type BoxPos = { col: number; bx: number; by: number; box: BoxInfo };

export function renderASCII(graph: DiagramGraph): string {
  const layers = groupByLayer(graph.nodes);
  if (layers.length === 0) return `${graph.workflowName}\n(empty workflow)`;

  const layerBoxes: BoxInfo[][] = layers.map(layer => layer.map(measureBox));
  const colWidths = layerBoxes.map(boxes => Math.max(...boxes.map(b => b.boxWidth)));
  const wireGap = 14;

  // Column x-offsets
  const colX: number[] = [];
  let cx = 1;
  for (let c = 0; c < layerBoxes.length; c++) {
    colX.push(cx);
    cx += colWidths[c] + wireGap;
  }
  const gridWidth = cx + 1;

  // Count spanning connections to reserve highway margin rows
  const nodeColMap = new Map<string, number>();
  for (let c = 0; c < layerBoxes.length; c++) {
    for (const box of layerBoxes[c]) nodeColMap.set(box.node.id, c);
  }
  let spanCount = 0;
  for (const conn of graph.connections) {
    const fc = nodeColMap.get(conn.fromNode);
    const tc = nodeColMap.get(conn.toNode);
    if (fc !== undefined && tc !== undefined && Math.abs(tc - fc) > 1) spanCount++;
  }
  const highwayMargin = spanCount > 0 ? spanCount + 1 : 0;

  // Position boxes, shifted down to leave room for above-highways
  const nodeGapY = 2;
  const boxPositions = new Map<string, BoxPos>();
  const boxStartY = 3 + highwayMargin;
  let maxGridHeight = 0;

  for (let c = 0; c < layerBoxes.length; c++) {
    let y = boxStartY;
    for (const box of layerBoxes[c]) {
      boxPositions.set(box.node.id, { col: c, bx: colX[c], by: y, box });
      y += box.boxHeight + nodeGapY;
    }
    if (y > maxGridHeight) maxGridHeight = y;
  }
  maxGridHeight += highwayMargin + 3;

  const connected = buildConnectedPorts(graph.connections);
  const grid = new CharGrid(gridWidth, maxGridHeight);

  // Title (centered, above the highway margin)
  const titleX = Math.max(0, Math.floor((gridWidth - graph.workflowName.length) / 2));
  grid.writeStr(titleX, 1, graph.workflowName);

  // Draw boxes
  for (const pos of boxPositions.values()) {
    drawBox(grid, pos.box, pos.bx, pos.by, connected);
  }

  // Draw connections
  drawConnections(grid, graph.connections, boxPositions, boxStartY, maxGridHeight);

  // Scope sub-diagrams
  const scopeLines: string[] = [];
  for (const node of graph.nodes) {
    if (node.scopeChildren && node.scopeChildren.length > 0) {
      scopeLines.push('');
      scopeLines.push(` Scope [${node.label}]:`);
      if (node.scopeConnections) {
        for (const sc of node.scopeConnections) {
          const arrow = sc.isStepConnection ? '\u2550\u2550\u25B6' : '\u2500\u2500\u25B6';
          scopeLines.push(`   ${sc.fromNode}.${sc.fromPort} ${arrow} ${sc.toNode}.${sc.toPort}${sc.isStepConnection ? '  STEP' : ''}`);
        }
      }
    }
  }

  const lines = grid.toLines();
  lines.push(...scopeLines);
  lines.push('');
  lines.push(' \u25CF connected  \u25CB not connected  \u2550\u2550\u25B6 STEP  \u2500\u2500\u25B6 DATA');
  return lines.join('\n');
}

// ── Connection drawing ───────────────────────────────────────────────────────

function drawConnections(
  grid: CharGrid,
  connections: DiagramConnection[],
  positions: Map<string, BoxPos>,
  boxAreaTop: number,
  _gridHeight: number,
): void {
  // Compute global box y-bounds
  let globalMinY = Infinity;
  let globalMaxY = 0;
  for (const pos of positions.values()) {
    globalMinY = Math.min(globalMinY, pos.by);
    globalMaxY = Math.max(globalMaxY, pos.by + pos.box.boxHeight);
  }

  // Sort: adjacent connections first, then spanning. Within each group, sort by source y.
  const sorted = [...connections].sort((a, b) => {
    const fa = positions.get(a.fromNode);
    const ta = positions.get(a.toNode);
    const fb = positions.get(b.fromNode);
    const tb = positions.get(b.toNode);
    if (!fa || !ta || !fb || !tb) return 0;
    const spanA = Math.abs(ta.col - fa.col);
    const spanB = Math.abs(tb.col - fb.col);
    if (spanA !== spanB) return spanA - spanB;
    const ya = fa.by + (fa.box.portRowOffsets.get(a.fromPort) ?? 0);
    const yb = fb.by + (fb.box.portRowOffsets.get(b.fromPort) ?? 0);
    return ya - yb;
  });

  const usedTracks = new Map<number, Set<number>>();
  let nextAboveHighway = globalMinY - 2;
  let nextBelowHighway = globalMaxY + 1;

  for (const conn of sorted) {
    const fromPos = positions.get(conn.fromNode);
    const toPos = positions.get(conn.toNode);
    if (!fromPos || !toPos) continue;

    const fromRowOff = fromPos.box.portRowOffsets.get(conn.fromPort);
    const toRowOff = toPos.box.portRowOffsets.get(conn.toPort);
    if (fromRowOff === undefined || toRowOff === undefined) continue;

    const y1 = fromPos.by + fromRowOff;
    const y2 = toPos.by + toRowOff;
    const x1 = fromPos.bx + fromPos.box.boxWidth; // first cell after source box right border
    const x2 = toPos.bx - 1; // cell for arrowhead (just before target box left border)

    const isStep = conn.isStepConnection;
    const hCh = isStep ? '\u2550' : '\u2500';
    const vCh = isStep ? '\u2551' : '\u2502';
    const isAdjacent = toPos.col === fromPos.col + 1;

    if (isAdjacent) {
      drawAdjacentRoute(grid, x1, y1, x2, y2, hCh, vCh, isStep, usedTracks, fromPos, toPos);
    } else {
      // Spanning: route via highway lane above or below all boxes
      const avgY = (y1 + y2) / 2;
      const midBoxY = (globalMinY + globalMaxY) / 2;
      let highwayY: number;
      if (avgY <= midBoxY) {
        highwayY = nextAboveHighway;
        nextAboveHighway--;
      } else {
        highwayY = nextBelowHighway;
        nextBelowHighway++;
      }
      drawSpanningRoute(grid, x1, y1, x2, y2, highwayY, hCh, vCh, isStep, usedTracks, fromPos, toPos);
    }
  }
}

/** Route a connection between adjacent columns (1 gap to cross). */
function drawAdjacentRoute(
  grid: CharGrid,
  x1: number, y1: number,
  x2: number, y2: number,
  hCh: string, vCh: string,
  isStep: boolean,
  usedTracks: Map<number, Set<number>>,
  fromPos: BoxPos, toPos: BoxPos,
): void {
  if (y1 === y2) {
    // Straight horizontal
    for (let x = x1; x < x2; x++) grid.set(x, y1, hCh);
    grid.set(x2, y1, '\u25B6');
    return;
  }

  // L-route: horizontal -> corner -> vertical -> corner -> horizontal
  const gapStart = fromPos.bx + fromPos.box.boxWidth + 1;
  const gapEnd = toPos.bx - 2;
  const midX = findTrack(usedTracks, gapStart, gapEnd, y1, y2);
  markTrack(usedTracks, midX, y1, y2);

  // Source horizontal
  for (let x = x1; x < midX; x++) grid.set(x, y1, hCh);
  // Corner at source end
  grid.set(midX, y1, cornerChar(isStep, 'left', y2 > y1 ? 'down' : 'up'));
  // Vertical
  drawVerticalSegment(grid, midX, y1, y2, vCh);
  // Corner at target end
  grid.set(midX, y2, cornerChar(isStep, 'right', y2 > y1 ? 'up' : 'down'));
  // Target horizontal
  for (let x = midX + 1; x < x2; x++) grid.set(x, y2, hCh);
  grid.set(x2, y2, '\u25B6');
}

/**
 * Route a connection spanning multiple columns via a highway lane.
 * Shape: horizontal out -> vertical to highway -> horizontal at highway -> vertical to target -> horizontal in
 */
function drawSpanningRoute(
  grid: CharGrid,
  x1: number, y1: number,
  x2: number, y2: number,
  highwayY: number,
  hCh: string, vCh: string,
  isStep: boolean,
  usedTracks: Map<number, Set<number>>,
  fromPos: BoxPos, toPos: BoxPos,
): void {
  // Find vertical track positions in the source gap and target gap
  const srcGapStart = fromPos.bx + fromPos.box.boxWidth + 1;
  const srcGapEnd = srcGapStart + 10;
  const srcMidX = findTrack(usedTracks, srcGapStart, srcGapEnd, y1, highwayY);
  markTrack(usedTracks, srcMidX, y1, highwayY);

  const tgtGapEnd = toPos.bx - 2;
  const tgtGapStart = tgtGapEnd - 10;
  const tgtMidX = findTrack(usedTracks, tgtGapStart, tgtGapEnd, highwayY, y2);
  markTrack(usedTracks, tgtMidX, highwayY, y2);

  const goingDown = highwayY > y1; // source to highway direction
  const goingUp = y2 < highwayY;   // highway to target direction

  // 1. Horizontal from source to srcMidX
  for (let x = x1; x < srcMidX; x++) grid.set(x, y1, hCh);

  // 2. Corner: horizontal ends, vertical begins toward highway
  grid.set(srcMidX, y1, cornerChar(isStep, 'left', goingDown ? 'down' : 'up'));

  // 3. Vertical from y1 toward highwayY
  drawVerticalSegment(grid, srcMidX, y1, highwayY, vCh);

  // 4. Corner: vertical ends, horizontal begins at highway level
  grid.set(srcMidX, highwayY, cornerChar(isStep, 'right', goingDown ? 'up' : 'down'));

  // 5. Horizontal at highwayY from srcMidX to tgtMidX
  for (let x = srcMidX + 1; x < tgtMidX; x++) grid.set(x, highwayY, hCh);

  // 6. Corner: horizontal ends, vertical begins toward target
  grid.set(tgtMidX, highwayY, cornerChar(isStep, 'left', goingUp ? 'up' : 'down'));

  // 7. Vertical from highwayY toward y2
  drawVerticalSegment(grid, tgtMidX, highwayY, y2, vCh);

  // 8. Corner: vertical ends, horizontal begins to target
  grid.set(tgtMidX, y2, cornerChar(isStep, 'right', goingUp ? 'down' : 'up'));

  // 9. Horizontal from tgtMidX to target
  for (let x = tgtMidX + 1; x < x2; x++) grid.set(x, y2, hCh);

  // 10. Arrowhead
  grid.set(x2, y2, '\u25B6');
}

/** Draw a vertical segment between two y values (exclusive of endpoints). */
function drawVerticalSegment(grid: CharGrid, x: number, y1: number, y2: number, vCh: string): void {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  for (let y = minY + 1; y < maxY; y++) {
    grid.set(x, y, vCh);
  }
}

function findTrack(
  usedTracks: Map<number, Set<number>>,
  gapStart: number, gapEnd: number,
  y1: number, y2: number,
): number {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const actualStart = Math.min(gapStart, gapEnd);
  const actualEnd = Math.max(gapStart, gapEnd);
  const mid = Math.floor((actualStart + actualEnd) / 2);
  for (let offset = 0; offset <= (actualEnd - actualStart); offset++) {
    for (const candidate of [mid + offset, mid - offset]) {
      if (candidate < actualStart || candidate > actualEnd) continue;
      const existing = usedTracks.get(candidate);
      if (!existing) return candidate;
      let conflict = false;
      for (let y = minY; y <= maxY; y++) {
        if (existing.has(y)) { conflict = true; break; }
      }
      if (!conflict) return candidate;
    }
  }
  return mid;
}

function markTrack(usedTracks: Map<number, Set<number>>, x: number, y1: number, y2: number): void {
  if (!usedTracks.has(x)) usedTracks.set(x, new Set());
  const s = usedTracks.get(x)!;
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  for (let y = minY; y <= maxY; y++) s.add(y);
}

// ── renderASCIICompact ───────────────────────────────────────────────────────

export function renderASCIICompact(graph: DiagramGraph): string {
  const layers = groupByLayer(graph.nodes);
  if (layers.length === 0) return `${graph.workflowName}\n(empty workflow)`;

  const outputLines: string[] = [];
  outputLines.push(graph.workflowName);
  outputLines.push('');

  const mainChain: DiagramNode[] = [];
  const parallelNodes: DiagramNode[] = [];
  for (const layer of layers) {
    mainChain.push(layer[0]);
    for (let i = 1; i < layer.length; i++) parallelNodes.push(layer[i]);
  }

  const topParts: string[] = [];
  const midParts: string[] = [];
  const botParts: string[] = [];
  for (let i = 0; i < mainChain.length; i++) {
    const node = mainChain[i];
    const innerWidth = Math.max(node.label.length + 2, 5);
    const padLeft = Math.floor((innerWidth - node.label.length) / 2);
    const padRight = innerWidth - node.label.length - padLeft;
    topParts.push('\u250C' + '\u2500'.repeat(innerWidth) + '\u2510');
    midParts.push('\u2502' + ' '.repeat(padLeft) + node.label + ' '.repeat(padRight) + '\u2502');
    botParts.push('\u2514' + '\u2500'.repeat(innerWidth) + '\u2518');
    if (i < mainChain.length - 1) {
      topParts.push('    ');
      midParts.push('\u2501\u2501\u2501\u25B6');
      botParts.push('    ');
    }
  }
  outputLines.push(' ' + topParts.join(''));
  outputLines.push(' ' + midParts.join(''));
  outputLines.push(' ' + botParts.join(''));

  if (parallelNodes.length > 0) {
    outputLines.push('');
    outputLines.push(' Parallel: ' + parallelNodes.map(n => n.label).join(', '));
  }
  for (const node of graph.nodes) {
    if (node.scopeChildren && node.scopeChildren.length > 0) {
      outputLines.push('');
      outputLines.push(` Scope [${node.label}]: ` + node.scopeChildren.map(c => c.label).join(' \u2501\u25B6 '));
    }
  }
  return outputLines.join('\n');
}

// ── renderText ───────────────────────────────────────────────────────────────

export function renderText(graph: DiagramGraph): string {
  const lines: string[] = [];
  const connected = buildConnectedPorts(graph.connections);

  lines.push(graph.workflowName);
  lines.push('\u2550'.repeat(graph.workflowName.length));
  lines.push('');

  lines.push('Nodes:');
  const maxLabelLen = Math.max(...graph.nodes.map(n => n.label.length), 5);

  for (const node of graph.nodes) {
    const label = node.label.padEnd(maxLabelLen);
    const inputPorts = node.inputs.map(p => `${p.name}${portSymbol(node.id, p, connected)}`);
    const outputPorts = node.outputs.map(p => `${p.name}${portSymbol(node.id, p, connected)}`);
    const inputStr = inputPorts.length > 0 ? `[${inputPorts.join(', ')}]` : '';
    const outputStr = outputPorts.length > 0 ? `[${outputPorts.join(', ')}]` : '';

    if (inputStr && outputStr) {
      lines.push(`  ${label}  ${inputStr} \u2192 ${outputStr}`);
    } else if (outputStr) {
      lines.push(`  ${label}  ${outputStr}`);
    } else if (inputStr) {
      lines.push(`  ${label}  ${inputStr}`);
    } else {
      lines.push(`  ${label}`);
    }

    if (node.scopeChildren && node.scopeChildren.length > 0) {
      lines.push(`  ${' '.repeat(maxLabelLen)}    scope: ${node.scopeChildren.map(c => c.label).join(', ')}`);
    }
  }

  if (graph.connections.length > 0) {
    lines.push('');
    lines.push('Connections:');
    const maxFromLen = Math.max(...graph.connections.map(c => `${c.fromNode}.${c.fromPort}`.length));
    for (const conn of graph.connections) {
      const from = `${conn.fromNode}.${conn.fromPort}`.padEnd(maxFromLen);
      const arrow = conn.isStepConnection ? '\u2501\u2501\u25B6' : '\u2500\u2500\u25B6';
      const to = `${conn.toNode}.${conn.toPort}`;
      const type = conn.isStepConnection ? 'STEP' : '';
      lines.push(`  ${from}  ${arrow} ${to}${type ? '  ' + type : ''}`);
    }
  }

  return lines.join('\n');
}
