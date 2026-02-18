/**
 * Orthogonal connection router for SVG diagram rendering.
 *
 * Ported from the original React-based editor's orthogonalRouter.ts.
 * Removed gl-matrix dependency — uses plain [number, number] tuples.
 *
 * Features:
 * - L-shape and S-shape routing with rounded corners
 * - Node collision avoidance via inflated bounding boxes
 * - Track allocator prevents parallel connections from overlapping
 * - Crossing minimization (evaluates up to 11 candidates per allocation)
 * - Per-port-index stub spacing
 * - Waypoint simplification (collinear removal, jog collapse)
 * - Backward/self connection escape routing
 */

// ─── Types ───

export interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrthogonalRouteOptions {
  cornerRadius?: number;   // default 10
  padding?: number;        // clearance around nodes, default 15
  stubLength?: number;     // base horizontal exit/entry stub, default 20
  stubSpacing?: number;    // extra stub per port index, default 12
  maxStubLength?: number;  // maximum stub length cap, default 80
  fromPortIndex?: number;  // source port index (0-based)
  toPortIndex?: number;    // target port index (0-based)
}

type Vec2 = [number, number];

// Minimum spacing between parallel horizontal segments (px)
const TRACK_SPACING = 15;

// Clearance from inflated box edges when routing around nodes (px).
const EDGE_OFFSET = 5;

// ─── Track allocator ───

// Maximum free candidates to evaluate in each direction for crossing minimization.
const MAX_CANDIDATES = 5;

type InflatedBox = { left: number; right: number; top: number; bottom: number };

export class TrackAllocator {
  private claims: Array<{ xMin: number; xMax: number; y: number }> = [];
  private verticalClaims: Array<{ yMin: number; yMax: number; x: number }> = [];

  /** Check if a Y value is too close to any claimed segment whose X range overlaps. */
  private isOccupied(xMin: number, xMax: number, y: number): boolean {
    for (const c of this.claims) {
      if (c.xMin < xMax && c.xMax > xMin && Math.abs(c.y - y) < TRACK_SPACING) {
        return true;
      }
    }
    return false;
  }

  /** Check if an X value is too close to any claimed vertical segment whose Y range overlaps. */
  private isOccupiedVertical(yMin: number, yMax: number, x: number): boolean {
    for (const c of this.verticalClaims) {
      if (c.yMin < yMax && c.yMax > yMin && Math.abs(c.x - x) < TRACK_SPACING) {
        return true;
      }
    }
    return false;
  }

  /** Check if a horizontal segment at Y passes through any inflated node box. */
  private isBlockedByNode(xMin: number, xMax: number, y: number, boxes: InflatedBox[]): boolean {
    for (const box of boxes) {
      if (xMin < box.right && xMax > box.left && y >= box.top && y <= box.bottom) {
        return true;
      }
    }
    return false;
  }

  /** Check if a vertical segment at X passes through any inflated node box. */
  private isBlockedByNodeVertical(yMin: number, yMax: number, x: number, boxes: InflatedBox[]): boolean {
    for (const box of boxes) {
      if (x >= box.left && x <= box.right && yMin < box.bottom && yMax > box.top) {
        return true;
      }
    }
    return false;
  }

  /** Count claimed vertical segments that a horizontal segment at Y would cross. */
  countHorizontalCrossings(xMin: number, xMax: number, y: number): number {
    let count = 0;
    for (const c of this.verticalClaims) {
      if (c.x > xMin && c.x < xMax && y >= c.yMin && y <= c.yMax) {
        count++;
      }
    }
    return count;
  }

  /** Count claimed horizontal segments that a vertical segment at X would cross. */
  countVerticalCrossings(yMin: number, yMax: number, x: number): number {
    let count = 0;
    for (const c of this.claims) {
      if (c.y > yMin && c.y < yMax && x >= c.xMin && x <= c.xMax) {
        count++;
      }
    }
    return count;
  }

  /**
   * Find the nearest free Y to candidateY in the given X range, preferring fewer crossings.
   * When nodeBoxes is provided, candidates inside inflated node boxes are rejected (hard constraint).
   */
  findFreeY(xMin: number, xMax: number, candidateY: number, nodeBoxes?: InflatedBox[]): number {
    const isFree = (y: number) =>
      !this.isOccupied(xMin, xMax, y) &&
      (!nodeBoxes || !this.isBlockedByNode(xMin, xMax, y, nodeBoxes));

    if (isFree(candidateY)) return candidateY;

    const candidates: Array<{ y: number; dist: number }> = [];

    for (let offset = TRACK_SPACING; offset < 800 && candidates.length < MAX_CANDIDATES * 2; offset += TRACK_SPACING) {
      const above = candidateY - offset;
      if (isFree(above)) {
        candidates.push({ y: above, dist: offset });
      }
      const below = candidateY + offset;
      if (isFree(below)) {
        candidates.push({ y: below, dist: offset });
      }
    }

    if (candidates.length === 0) return candidateY;

    let bestY = candidates[0].y;
    let bestCrossings = this.countHorizontalCrossings(xMin, xMax, candidates[0].y);
    let bestDist = candidates[0].dist;

    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      const crossings = this.countHorizontalCrossings(xMin, xMax, c.y);
      if (crossings < bestCrossings || (crossings === bestCrossings && c.dist < bestDist)) {
        bestY = c.y;
        bestCrossings = crossings;
        bestDist = c.dist;
      }
    }

    return bestY;
  }

  /**
   * Find the nearest free X to candidateX in the given Y range, preferring fewer crossings.
   * When nodeBoxes is provided, candidates inside inflated node boxes are rejected (hard constraint).
   */
  findFreeX(yMin: number, yMax: number, candidateX: number, nodeBoxes?: InflatedBox[]): number {
    const isFree = (x: number) =>
      !this.isOccupiedVertical(yMin, yMax, x) &&
      (!nodeBoxes || !this.isBlockedByNodeVertical(yMin, yMax, x, nodeBoxes));

    if (isFree(candidateX)) return candidateX;

    const candidates: Array<{ x: number; dist: number }> = [];

    for (let offset = TRACK_SPACING; offset < 800 && candidates.length < MAX_CANDIDATES * 2; offset += TRACK_SPACING) {
      const left = candidateX - offset;
      if (isFree(left)) {
        candidates.push({ x: left, dist: offset });
      }
      const right = candidateX + offset;
      if (isFree(right)) {
        candidates.push({ x: right, dist: offset });
      }
    }

    if (candidates.length === 0) return candidateX;

    let bestX = candidates[0].x;
    let bestCrossings = this.countVerticalCrossings(yMin, yMax, candidates[0].x);
    let bestDist = candidates[0].dist;

    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      const crossings = this.countVerticalCrossings(yMin, yMax, c.x);
      if (crossings < bestCrossings || (crossings === bestCrossings && c.dist < bestDist)) {
        bestX = c.x;
        bestCrossings = crossings;
        bestDist = c.dist;
      }
    }

    return bestX;
  }

  /** Claim a horizontal segment so later connections avoid it. */
  claim(xMin: number, xMax: number, y: number): void {
    this.claims.push({ xMin, xMax, y });
  }

  /** Claim a vertical segment so later connections avoid it. */
  claimVertical(yMin: number, yMax: number, x: number): void {
    this.verticalClaims.push({ yMin, yMax, x });
  }
}

// ─── Node avoidance helpers ───

function inflateBox(
  box: NodeBox,
  padding: number,
): InflatedBox {
  return {
    left: box.x - padding,
    right: box.x + box.width + padding,
    top: box.y - padding,
    bottom: box.y + box.height + padding,
  };
}

function segmentOverlapsBox(
  xMin: number,
  xMax: number,
  y: number,
  box: InflatedBox,
): boolean {
  return xMin < box.right && xMax > box.left && y >= box.top && y <= box.bottom;
}

/** Check if a vertical segment at a given X is clear of all inflated boxes. */
function verticalSegmentClear(
  x: number,
  yMin: number,
  yMax: number,
  boxes: InflatedBox[],
): boolean {
  return !boxes.some((box) => x >= box.left && x <= box.right && yMin < box.bottom && yMax > box.top);
}

/**
 * Find a Y clear of node boxes for a horizontal segment spanning [xMin, xMax].
 */
function findClearY(
  xMin: number,
  xMax: number,
  candidateY: number,
  boxes: InflatedBox[],
): number {
  const isBlocked = (y: number) => boxes.some((box) => segmentOverlapsBox(xMin, xMax, y, box));

  if (!isBlocked(candidateY)) return candidateY;

  const edges: number[] = [];
  for (const box of boxes) {
    if (xMin < box.right && xMax > box.left) {
      edges.push(box.top);
      edges.push(box.bottom);
    }
  }
  if (edges.length === 0) return candidateY;

  edges.sort((a, b) => a - b);

  let bestY = candidateY;
  let bestDist = Infinity;
  for (const edge of edges) {
    for (const y of [edge - EDGE_OFFSET, edge + EDGE_OFFSET]) {
      if (!isBlocked(y)) {
        const dist = Math.abs(y - candidateY);
        if (dist < bestDist) {
          bestDist = dist;
          bestY = y;
        }
      }
    }
  }
  if (bestDist === Infinity) {
    const allMin = Math.min(...edges) - EDGE_OFFSET * 2;
    const allMax = Math.max(...edges) + EDGE_OFFSET * 2;
    bestY = Math.abs(allMin - candidateY) <= Math.abs(allMax - candidateY) ? allMin : allMax;
    if (isBlocked(bestY)) {
      for (let offset = TRACK_SPACING; offset < 800; offset += TRACK_SPACING) {
        if (!isBlocked(bestY - offset)) {
          bestY -= offset;
          break;
        }
        if (!isBlocked(bestY + offset)) {
          bestY += offset;
          break;
        }
      }
    }
  }
  return bestY;
}

/**
 * Find an X clear of node boxes for a vertical segment spanning [yMin, yMax].
 */
function findClearX(
  yMin: number,
  yMax: number,
  candidateX: number,
  boxes: InflatedBox[],
): number {
  const isBlocked = (x: number) =>
    boxes.some((box) => x >= box.left && x <= box.right && yMin < box.bottom && yMax > box.top);

  if (!isBlocked(candidateX)) return candidateX;

  const edges: number[] = [];
  for (const box of boxes) {
    if (yMin < box.bottom && yMax > box.top) {
      edges.push(box.left);
      edges.push(box.right);
    }
  }
  if (edges.length === 0) return candidateX;

  edges.sort((a, b) => a - b);

  let bestX = candidateX;
  let bestDist = Infinity;
  for (const edge of edges) {
    for (const x of [edge - EDGE_OFFSET, edge + EDGE_OFFSET]) {
      if (!isBlocked(x)) {
        const dist = Math.abs(x - candidateX);
        if (dist < bestDist) {
          bestDist = dist;
          bestX = x;
        }
      }
    }
  }
  if (bestDist === Infinity) {
    const allMin = Math.min(...edges) - EDGE_OFFSET * 2;
    const allMax = Math.max(...edges) + EDGE_OFFSET * 2;
    bestX = Math.abs(allMin - candidateX) <= Math.abs(allMax - candidateX) ? allMin : allMax;
    if (isBlocked(bestX)) {
      for (let offset = TRACK_SPACING; offset < 800; offset += TRACK_SPACING) {
        if (!isBlocked(bestX - offset)) {
          bestX -= offset;
          break;
        }
        if (!isBlocked(bestX + offset)) {
          bestX += offset;
          break;
        }
      }
    }
  }
  return bestX;
}

// ─── Waypoint utilities ───

const MIN_SEGMENT_LENGTH = 3;
const JOG_THRESHOLD = 10;

/** Remove collinear, duplicate, tiny-jog, and very-short-segment waypoints. */
function simplifyWaypoints(waypoints: Vec2[]): Vec2[] {
  if (waypoints.length <= 2) return waypoints;

  // Pass 1: Collapse small rectangular jogs.
  let pts = waypoints;
  let jogFound = true;
  while (jogFound) {
    jogFound = false;
    for (let i = 0; i < pts.length - 3; i++) {
      const a = pts[i], b = pts[i + 1], c = pts[i + 2], d = pts[i + 3];
      // Small vertical jog
      const jogH = Math.abs(b[1] - c[1]);
      if (
        Math.abs(a[1] - b[1]) < 0.5 &&
        Math.abs(b[0] - c[0]) < 0.5 &&
        Math.abs(c[1] - d[1]) < 0.5 &&
        jogH > 0.5 && jogH < JOG_THRESHOLD
      ) {
        const jogMid = (b[1] + c[1]) / 2;
        const snapY = Math.abs(a[1] - jogMid) <= Math.abs(d[1] - jogMid) ? a[1] : d[1];
        const newPts = pts.slice();
        newPts[i + 1] = [b[0], snapY];
        newPts[i + 2] = [c[0], snapY];
        pts = newPts;
        jogFound = true;
        break;
      }
      // Small horizontal jog
      const jogW = Math.abs(b[0] - c[0]);
      if (
        Math.abs(a[0] - b[0]) < 0.5 &&
        Math.abs(b[1] - c[1]) < 0.5 &&
        Math.abs(c[0] - d[0]) < 0.5 &&
        jogW > 0.5 && jogW < JOG_THRESHOLD
      ) {
        const jogMid = (b[0] + c[0]) / 2;
        const snapX = Math.abs(a[0] - jogMid) <= Math.abs(d[0] - jogMid) ? a[0] : d[0];
        const newPts = pts.slice();
        newPts[i + 1] = [snapX, b[1]];
        newPts[i + 2] = [snapX, c[1]];
        pts = newPts;
        jogFound = true;
        break;
      }
    }
  }

  // Pass 2: Remove near-duplicates and collinear points
  const result: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    const distToPrev = Math.abs(prev[0] - curr[0]) + Math.abs(prev[1] - curr[1]);
    if (distToPrev < MIN_SEGMENT_LENGTH) continue;

    const sameX = Math.abs(prev[0] - curr[0]) < 0.01 && Math.abs(curr[0] - next[0]) < 0.01;
    const sameY = Math.abs(prev[1] - curr[1]) < 0.01 && Math.abs(curr[1] - next[1]) < 0.01;

    if (!sameX && !sameY) {
      result.push(curr);
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}

/** Convert waypoints to an SVG path with rounded corners. */
function waypointsToSvgPath(waypoints: Vec2[], cornerRadius: number): string {
  if (waypoints.length < 2) return '';
  if (waypoints.length === 2) {
    return `M ${waypoints[0][0]},${waypoints[0][1]} L ${waypoints[1][0]},${waypoints[1][1]}`;
  }

  // Pre-compute arc radii so adjacent corners sharing a segment never overlap
  const radii: number[] = new Array(waypoints.length).fill(0);
  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const next = waypoints[i + 1];
    const lenPrev = Math.sqrt((prev[0] - curr[0]) ** 2 + (prev[1] - curr[1]) ** 2);
    const lenNext = Math.sqrt((next[0] - curr[0]) ** 2 + (next[1] - curr[1]) ** 2);
    radii[i] =
      lenPrev < 0.01 || lenNext < 0.01 ? 0 : Math.min(cornerRadius, lenPrev / 2, lenNext / 2);
  }
  // Shrink radii so two corners sharing a segment together consume at most the full segment length
  for (let i = 1; i < waypoints.length - 2; i++) {
    const curr = waypoints[i];
    const next = waypoints[i + 1];
    const segLen = Math.sqrt((next[0] - curr[0]) ** 2 + (next[1] - curr[1]) ** 2);
    const total = radii[i] + radii[i + 1];
    if (total > segLen && total > 0) {
      const scale = segLen / total;
      radii[i] *= scale;
      radii[i + 1] *= scale;
    }
  }

  let path = `M ${waypoints[0][0]},${waypoints[0][1]}`;

  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const next = waypoints[i + 1];

    const r = radii[i];
    if (r < 2) {
      path += ` L ${curr[0]},${curr[1]}`;
      continue;
    }

    const dPrev: Vec2 = [prev[0] - curr[0], prev[1] - curr[1]];
    const dNext: Vec2 = [next[0] - curr[0], next[1] - curr[1]];

    const lenPrev = Math.sqrt(dPrev[0] * dPrev[0] + dPrev[1] * dPrev[1]);
    const lenNext = Math.sqrt(dNext[0] * dNext[0] + dNext[1] * dNext[1]);

    const uPrev: Vec2 = [dPrev[0] / lenPrev, dPrev[1] / lenPrev];
    const uNext: Vec2 = [dNext[0] / lenNext, dNext[1] / lenNext];

    const arcStart: Vec2 = [curr[0] + uPrev[0] * r, curr[1] + uPrev[1] * r];
    const arcEnd: Vec2 = [curr[0] + uNext[0] * r, curr[1] + uNext[1] * r];

    const cross = dPrev[0] * dNext[1] - dPrev[1] * dNext[0];
    const sweep = cross > 0 ? 0 : 1;

    path += ` L ${arcStart[0]},${arcStart[1]}`;
    path += ` A ${r} ${r} 0 0 ${sweep} ${arcEnd[0]},${arcEnd[1]}`;
  }

  const last = waypoints[waypoints.length - 1];
  path += ` L ${last[0]},${last[1]}`;
  return path;
}

// ─── Waypoint computation ───

function computeWaypoints(
  from: Vec2,
  to: Vec2,
  nodeBoxes: NodeBox[],
  sourceNodeId: string,
  targetNodeId: string,
  padding: number,
  exitStub: number,
  entryStub: number,
  allocator: TrackAllocator,
): Vec2[] | null {
  const isSelfConnection = sourceNodeId === targetNodeId;

  const inflatedBoxes = nodeBoxes
    .filter((box) => (isSelfConnection ? true : box.id !== sourceNodeId && box.id !== targetNodeId))
    .map((box) => inflateBox(box, padding));

  const stubExit: Vec2 = [from[0] + exitStub, from[1]];
  const stubEntry: Vec2 = [to[0] - entryStub, to[1]];

  const xMin = Math.min(stubExit[0], stubEntry[0]);
  const xMax = Math.max(stubExit[0], stubEntry[0]);

  if (!isSelfConnection && to[0] > from[0]) {
    // Forward connection
    let candidateY = (from[1] + to[1]) / 2;
    const intermediateBoxes = inflatedBoxes.filter(
      (box) => box.left < xMax && box.right > xMin,
    );
    if (intermediateBoxes.length >= 2) {
      const clusterTop = Math.min(...intermediateBoxes.map((b) => b.top));
      const clusterBottom = Math.max(...intermediateBoxes.map((b) => b.bottom));
      if (candidateY > clusterTop && candidateY < clusterBottom) {
        const distToTop = candidateY - clusterTop;
        const distToBottom = clusterBottom - candidateY;
        candidateY = distToTop <= distToBottom
          ? clusterTop - padding
          : clusterBottom + padding;
      }
    }
    let clearY = findClearY(xMin, xMax, candidateY, inflatedBoxes);

    if (Math.abs(from[1] - to[1]) < JOG_THRESHOLD && Math.abs(clearY - from[1]) < JOG_THRESHOLD) {
      return null; // Fall back to bezier
    }

    // Try center-corner: single vertical turn at the midpoint
    const midX = (stubExit[0] + stubEntry[0]) / 2;
    const yMin = Math.min(from[1], to[1]);
    const yMax = Math.max(from[1], to[1]);

    const clearMidX = findClearX(yMin, yMax, midX, inflatedBoxes);
    const freeMidX = allocator.findFreeX(yMin, yMax, clearMidX, inflatedBoxes);

    if (
      yMax - yMin >= JOG_THRESHOLD &&
      freeMidX > stubExit[0] &&
      freeMidX < stubEntry[0] &&
      verticalSegmentClear(freeMidX, yMin, yMax, inflatedBoxes) &&
      allocator.findFreeY(from[0], freeMidX, from[1], inflatedBoxes) === from[1] &&
      allocator.findFreeY(freeMidX, to[0], to[1], inflatedBoxes) === to[1]
    ) {
      allocator.claim(from[0], freeMidX, from[1]);
      allocator.claim(freeMidX, to[0], to[1]);
      allocator.claimVertical(yMin, yMax, freeMidX);
      return simplifyWaypoints([from, [freeMidX, from[1]], [freeMidX, to[1]], to]);
    }

    // S-shape with horizontal channel
    clearY = allocator.findFreeY(xMin, xMax, clearY, inflatedBoxes);

    if (
      Math.abs(clearY - from[1]) < JOG_THRESHOLD &&
      !inflatedBoxes.some((box) => segmentOverlapsBox(xMin, xMax, from[1], box))
    ) {
      clearY = from[1];
    } else if (
      Math.abs(clearY - to[1]) < JOG_THRESHOLD &&
      !inflatedBoxes.some((box) => segmentOverlapsBox(xMin, xMax, to[1], box))
    ) {
      clearY = to[1];
    }

    allocator.claim(xMin, xMax, clearY);

    // Validate vertical segments
    const exitYMin = Math.min(from[1], clearY);
    const exitYMax = Math.max(from[1], clearY);
    let exitX = findClearX(exitYMin, exitYMax, stubExit[0], inflatedBoxes);
    exitX = allocator.findFreeX(exitYMin, exitYMax, exitX, inflatedBoxes);
    if (exitX < from[0]) {
      exitX = stubExit[0];
      if (!verticalSegmentClear(exitX, exitYMin, exitYMax, inflatedBoxes)) {
        exitX = findClearX(exitYMin, exitYMax, stubExit[0] + TRACK_SPACING, inflatedBoxes);
        exitX = allocator.findFreeX(exitYMin, exitYMax, exitX, inflatedBoxes);
      }
    }
    allocator.claimVertical(exitYMin, exitYMax, exitX);

    const entryYMin = Math.min(to[1], clearY);
    const entryYMax = Math.max(to[1], clearY);
    let entryX = findClearX(entryYMin, entryYMax, stubEntry[0], inflatedBoxes);
    entryX = allocator.findFreeX(entryYMin, entryYMax, entryX, inflatedBoxes);
    if (entryX > to[0]) {
      entryX = stubEntry[0];
      if (!verticalSegmentClear(entryX, entryYMin, entryYMax, inflatedBoxes)) {
        entryX = findClearX(entryYMin, entryYMax, stubEntry[0] - TRACK_SPACING, inflatedBoxes);
        entryX = allocator.findFreeX(entryYMin, entryYMax, entryX, inflatedBoxes);
      }
    }
    allocator.claimVertical(entryYMin, entryYMax, entryX);

    return simplifyWaypoints([
      from,
      [exitX, from[1]],
      [exitX, clearY],
      [entryX, clearY],
      [entryX, to[1]],
      to,
    ]);
  } else {
    // Backward connection or self-connection — escape vertically, loop around
    const sourceBox = nodeBoxes.find((b) => b.id === sourceNodeId);
    const targetBox = nodeBoxes.find((b) => b.id === targetNodeId);

    const corridorBoxes = inflatedBoxes.filter((box) => box.left < xMax && box.right > xMin);
    const bottoms: number[] = corridorBoxes.map((b) => b.bottom);
    const tops: number[] = corridorBoxes.map((b) => b.top);
    if (sourceBox) {
      bottoms.push(sourceBox.y + sourceBox.height + padding);
      tops.push(sourceBox.y - padding);
    }
    if (targetBox) {
      bottoms.push(targetBox.y + targetBox.height + padding);
      tops.push(targetBox.y - padding);
    }
    const maxBottom = Math.max(...bottoms, from[1] + 50, to[1] + 50);
    const minTop = Math.min(...tops, from[1] - 50, to[1] - 50);
    const avgY = (from[1] + to[1]) / 2;
    const escapeBelow = maxBottom + padding;
    const escapeAbove = minTop - padding;
    let escapeY =
      Math.abs(escapeAbove - avgY) <= Math.abs(escapeBelow - avgY) ? escapeAbove : escapeBelow;

    escapeY = findClearY(xMin, xMax, escapeY, inflatedBoxes);
    escapeY = allocator.findFreeY(xMin, xMax, escapeY, inflatedBoxes);
    allocator.claim(xMin, xMax, escapeY);

    const bwExitYMin = Math.min(from[1], escapeY);
    const bwExitYMax = Math.max(from[1], escapeY);
    let bwExitX = findClearX(bwExitYMin, bwExitYMax, stubExit[0], inflatedBoxes);
    bwExitX = allocator.findFreeX(bwExitYMin, bwExitYMax, bwExitX, inflatedBoxes);
    allocator.claimVertical(bwExitYMin, bwExitYMax, bwExitX);

    const bwEntryYMin = Math.min(to[1], escapeY);
    const bwEntryYMax = Math.max(to[1], escapeY);
    let bwEntryX = findClearX(bwEntryYMin, bwEntryYMax, stubEntry[0], inflatedBoxes);
    bwEntryX = allocator.findFreeX(bwEntryYMin, bwEntryYMax, bwEntryX, inflatedBoxes);
    allocator.claimVertical(bwEntryYMin, bwEntryYMax, bwEntryX);

    return simplifyWaypoints([
      from,
      [bwExitX, from[1]],
      [bwExitX, escapeY],
      [bwEntryX, escapeY],
      [bwEntryX, to[1]],
      to,
    ]);
  }
}

// ─── Public API ───

/**
 * Calculate an orthogonal SVG path between two ports.
 * Returns null if the path should fall back to bezier (e.g. nearly aligned ports).
 */
export function calculateOrthogonalPath(
  from: Vec2,
  to: Vec2,
  nodeBoxes: NodeBox[],
  sourceNodeId: string,
  targetNodeId: string,
  options?: OrthogonalRouteOptions,
  allocator?: TrackAllocator,
): string | null {
  const cornerRadius = options?.cornerRadius ?? 10;
  const padding = options?.padding ?? 15;
  const stubLength = options?.stubLength ?? 20;
  const stubSpacing = options?.stubSpacing ?? 12;
  const maxStubLength = options?.maxStubLength ?? 80;
  const fromPortIndex = options?.fromPortIndex ?? 0;
  const toPortIndex = options?.toPortIndex ?? 0;

  const exitStub = Math.min(stubLength + fromPortIndex * stubSpacing, maxStubLength);
  const entryStub = Math.min(stubLength + toPortIndex * stubSpacing, maxStubLength);

  const alloc = allocator ?? new TrackAllocator();

  const waypoints = computeWaypoints(
    from,
    to,
    nodeBoxes,
    sourceNodeId,
    targetNodeId,
    padding,
    exitStub,
    entryStub,
    alloc,
  );

  if (!waypoints) return null;

  return waypointsToSvgPath(waypoints, cornerRadius);
}

/**
 * Safe wrapper — returns null if routing fails, caller falls back to bezier.
 */
export function calculateOrthogonalPathSafe(
  from: Vec2,
  to: Vec2,
  nodeBoxes: NodeBox[],
  sourceNodeId: string,
  targetNodeId: string,
  options?: OrthogonalRouteOptions,
  allocator?: TrackAllocator,
): string | null {
  try {
    const path = calculateOrthogonalPath(
      from, to, nodeBoxes, sourceNodeId, targetNodeId, options, allocator,
    );
    if (!path || path.length < 5) return null;
    return path;
  } catch {
    return null;
  }
}
