/**
 * Orthogonal connection router for SVG diagram rendering.
 *
 * 1-1 port of the platform's orthogonalRouter.ts.
 * Only change: removed the gl-matrix dependency in favor of plain [number, number] tuples.
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
  cornerRadius?: number; // default 10
  padding?: number; // clearance around nodes, default 15
  stubLength?: number; // base horizontal exit/entry stub, default 20
  stubSpacing?: number; // extra stub per port index, default 12
  maxStubLength?: number; // maximum stub length cap, default 80
  fromPortIndex?: number; // source port index (0-based)
  toPortIndex?: number; // target port index (0-based)
  /** When true, treat same-node connections as forward (not self-loop). Used for scoped port connections. */
  scopedInternal?: boolean;
  /** Track allocator for preventing connections from overlapping on the same horizontal track. */
  allocator?: TrackAllocator;
}

type Vec2 = [number, number];

const TRACK_SPACING = 15;
const EDGE_OFFSET = 5;
// Nudge the initial candidate Y downward so paths prefer routing below obstacles.
const BELOW_BIAS = 40;

// ─── Track Allocator ───

/**
 * Prevents connections from running on the same horizontal track.
 * Create one instance per render batch and pass it to all routing calls.
 * Tracks are snapped to TRACK_SPACING grid. Only connections whose X corridors
 * overlap can conflict.
 */
export class TrackAllocator {
  private claims = new Map<number, Array<[number, number]>>();

  claim(xMin: number, xMax: number, candidateY: number): number {
    const snap = (y: number) => Math.round(y / TRACK_SPACING) * TRACK_SPACING;

    const overlaps = (slot: number): boolean => {
      const intervals = this.claims.get(slot);
      if (!intervals) return false;
      return intervals.some(([a, b]) => xMin < b && xMax > a);
    };

    const take = (slot: number): number => {
      if (!this.claims.has(slot)) this.claims.set(slot, []);
      const slotClaims = this.claims.get(slot);
      if (slotClaims) slotClaims.push([xMin, xMax]);
      return slot;
    };

    const base = snap(candidateY);
    // Search outward, preferring below (positive direction) on each step.
    for (let i = 0; i < 60; i++) {
      const below = base + i * TRACK_SPACING;
      if (!overlaps(below)) return take(below);
      if (i > 0) {
        const above = base - i * TRACK_SPACING;
        if (!overlaps(above)) return take(above);
      }
    }
    return candidateY;
  }
}

// ─── Node avoidance helpers ───

function inflateBox(
  box: NodeBox,
  padding: number,
): { left: number; right: number; top: number; bottom: number } {
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
  box: { left: number; right: number; top: number; bottom: number },
): boolean {
  return xMin < box.right && xMax > box.left && y >= box.top && y <= box.bottom;
}

/** Check if a vertical segment at a given X is clear of all inflated boxes. */
function verticalSegmentClear(
  x: number,
  yMin: number,
  yMax: number,
  boxes: Array<{ left: number; right: number; top: number; bottom: number }>,
): boolean {
  return !boxes.some(
    (box) => x >= box.left && x <= box.right && yMin < box.bottom && yMax > box.top,
  );
}

/**
 * Find a Y clear of node boxes for a horizontal segment spanning [xMin, xMax].
 */
function findClearY(
  xMin: number,
  xMax: number,
  candidateY: number,
  boxes: Array<{ left: number; right: number; top: number; bottom: number }>,
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
    bestY = Math.abs(allMin - candidateY) < Math.abs(allMax - candidateY) ? allMin : allMax;
    // Verify the extreme fallback is actually clear. Search outward if not.
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
 * Mirror of findClearY for the vertical axis.
 */
function findClearX(
  yMin: number,
  yMax: number,
  candidateX: number,
  boxes: Array<{ left: number; right: number; top: number; bottom: number }>,
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
    // Verify the extreme fallback is actually clear. Search outward if not.
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

// Minimum segment length: segments shorter than this are collapsed.
const MIN_SEGMENT_LENGTH = 3;

// Minimum acceptable vertical/horizontal jog height/width.
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
      const a = pts[i],
        b = pts[i + 1],
        c = pts[i + 2],
        d = pts[i + 3];
      // Small vertical jog: A→B horizontal, B→C vertical (short), C→D horizontal
      const jogH = Math.abs(b[1] - c[1]);
      if (
        Math.abs(a[1] - b[1]) < 0.5 &&
        Math.abs(b[0] - c[0]) < 0.5 &&
        Math.abs(c[1] - d[1]) < 0.5 &&
        jogH > 0.5 &&
        jogH < JOG_THRESHOLD
      ) {
        // Only collapse if A and D share the same Y (internal jog).
        if (Math.abs(a[1] - d[1]) < 0.5) {
          const snapY = a[1];
          const newPts = pts.slice();
          newPts[i + 1] = [b[0], snapY];
          newPts[i + 2] = [c[0], snapY];
          pts = newPts;
          jogFound = true;
          break;
        }
      }
      // Small horizontal jog: A→B vertical, B→C horizontal (short), C→D vertical
      const jogW = Math.abs(b[0] - c[0]);
      if (
        Math.abs(a[0] - b[0]) < 0.5 &&
        Math.abs(b[1] - c[1]) < 0.5 &&
        Math.abs(c[0] - d[0]) < 0.5 &&
        jogW > 0.5 &&
        jogW < JOG_THRESHOLD
      ) {
        if (Math.abs(a[0] - d[0]) < 0.5) {
          const snapX = a[0];
          const newPts = pts.slice();
          newPts[i + 1] = [snapX, b[1]];
          newPts[i + 2] = [snapX, c[1]];
          pts = newPts;
          jogFound = true;
          break;
        }
      }
    }
  }

  // Pass 2: Remove near-duplicates and collinear points
  const result: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    // Skip near-duplicate points, but only if removing won't create a diagonal
    const distToPrev = Math.abs(prev[0] - curr[0]) + Math.abs(prev[1] - curr[1]);
    if (distToPrev < MIN_SEGMENT_LENGTH) {
      const wouldDiag = Math.abs(prev[0] - next[0]) > 0.5 && Math.abs(prev[1] - next[1]) > 0.5;
      if (!wouldDiag) continue;
    }

    // Skip collinear points (three points on the same axis)
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

  // Pre-compute arc radii so that two adjacent corners sharing a segment
  // never consume more than the segment length combined.
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
    if (r < 0.01) {
      path += ` L ${curr[0]},${curr[1]}`;
      continue;
    }

    const dPrev: Vec2 = [prev[0] - curr[0], prev[1] - curr[1]];
    const dNext: Vec2 = [next[0] - curr[0], next[1] - curr[1]];

    const lenPrev = Math.sqrt(dPrev[0] * dPrev[0] + dPrev[1] * dPrev[1]);
    const lenNext = Math.sqrt(dNext[0] * dNext[0] + dNext[1] * dNext[1]);

    const uPrev: Vec2 = [dPrev[0] / lenPrev, dPrev[1] / lenPrev];
    const uNext: Vec2 = [dNext[0] / lenNext, dNext[1] / lenNext];

    const cross = uPrev[0] * uNext[1] - uPrev[1] * uNext[0];
    const deflection = Math.abs(cross);
    const scaledR = r * deflection;

    if (scaledR < 0.5) {
      path += ` L ${curr[0]},${curr[1]}`;
      continue;
    }

    const arcStart: Vec2 = [curr[0] + uPrev[0] * scaledR, curr[1] + uPrev[1] * scaledR];
    const arcEnd: Vec2 = [curr[0] + uNext[0] * scaledR, curr[1] + uNext[1] * scaledR];

    const sweep = cross > 0 ? 0 : 1;

    path += ` L ${arcStart[0]},${arcStart[1]}`;
    path += ` A ${scaledR} ${scaledR} 0 0 ${sweep} ${arcEnd[0]},${arcEnd[1]}`;
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
  scopedInternal?: boolean,
  allocator?: TrackAllocator,
): Vec2[] | null {
  const isSelfConnection = sourceNodeId === targetNodeId && !scopedInternal;
  const inflatedBoxes = nodeBoxes.map((box) => inflateBox(box, padding));

  const stubExit: Vec2 = [from[0] + exitStub, from[1]];
  const stubEntry: Vec2 = [to[0] - entryStub, to[1]];

  const xMin = Math.min(stubExit[0], stubEntry[0]);
  const xMax = Math.max(stubExit[0], stubEntry[0]);

  if (!isSelfConnection && to[0] >= from[0] - exitStub) {
    // Straight connection: if ports share the same Y and the direct path is clear
    // of non-source/target obstacles, return a direct 2-point line.
    // Static SVG: skip the straight-line early return. Opaque port labels cover
    // flat connections. All paths go through BELOW_BIAS routing so they stay visible.
    // (Platform uses [from, to] here because labels are interactive/hideable.)

    let candidateY = (from[1] + to[1]) / 2 + BELOW_BIAS;
    const intermediateBoxes = inflatedBoxes.filter((box) => box.left < xMax && box.right > xMin);
    if (intermediateBoxes.length >= 2) {
      const clusterTop = Math.min(...intermediateBoxes.map((b) => b.top));
      const clusterBottom = Math.max(...intermediateBoxes.map((b) => b.bottom));
      if (candidateY > clusterTop && candidateY < clusterBottom) {
        const distToTop = candidateY - clusterTop;
        const distToBottom = clusterBottom - candidateY;
        candidateY = distToTop < distToBottom ? clusterTop - padding : clusterBottom + padding;
      }
    }
    const clearY = allocator
      ? allocator.claim(xMin, xMax, findClearY(xMin, xMax, candidateY, inflatedBoxes))
      : findClearY(xMin, xMax, candidateY, inflatedBoxes);

    const yMin = Math.min(from[1], to[1]);
    const yMax = Math.max(from[1], to[1]);

    const stubsCross = stubExit[0] >= stubEntry[0];
    const midX = stubsCross
      ? (from[0] + to[0]) / 2
      : stubExit[0] + (stubEntry[0] - stubExit[0]) * 0.75;

    const freeMidX = findClearX(yMin, yMax || yMin + 1, midX, inflatedBoxes);

    const lShapeXValid = stubsCross
      ? freeMidX >= Math.min(from[0], to[0]) && freeMidX <= Math.max(from[0], to[0])
      : freeMidX > stubExit[0] && freeMidX < stubEntry[0];

    if (
      lShapeXValid &&
      verticalSegmentClear(freeMidX, yMin, yMax, inflatedBoxes) &&
      !inflatedBoxes.some((box) => segmentOverlapsBox(stubExit[0], freeMidX, from[1], box)) &&
      !inflatedBoxes.some((box) => segmentOverlapsBox(freeMidX, stubEntry[0], to[1], box))
    ) {
      return simplifyWaypoints([from, [freeMidX, from[1]], [freeMidX, to[1]], to]);
    }

    if (
      Math.abs(clearY - from[1]) < JOG_THRESHOLD &&
      !inflatedBoxes.some((box) => segmentOverlapsBox(xMin, xMax, from[1], box))
    ) {
      candidateY = from[1];
    } else if (
      Math.abs(clearY - to[1]) < JOG_THRESHOLD &&
      !inflatedBoxes.some((box) => segmentOverlapsBox(xMin, xMax, to[1], box))
    ) {
      candidateY = to[1];
    } else {
      candidateY = clearY;
    }

    const exitYMin = Math.min(from[1], candidateY);
    const exitYMax = Math.max(from[1], candidateY);
    let exitX = findClearX(exitYMin, exitYMax, stubExit[0], inflatedBoxes);
    if (exitX < from[0]) {
      exitX = stubExit[0];
      if (!verticalSegmentClear(exitX, exitYMin, exitYMax, inflatedBoxes)) {
        exitX = findClearX(exitYMin, exitYMax, stubExit[0] + TRACK_SPACING, inflatedBoxes);
      }
    }

    const entryYMin = Math.min(to[1], candidateY);
    const entryYMax = Math.max(to[1], candidateY);
    let entryX = findClearX(entryYMin, entryYMax, stubEntry[0], inflatedBoxes);
    if (entryX > to[0]) {
      entryX = stubEntry[0];
      if (!verticalSegmentClear(entryX, entryYMin, entryYMax, inflatedBoxes)) {
        entryX = findClearX(entryYMin, entryYMax, stubEntry[0] - TRACK_SPACING, inflatedBoxes);
      }
    }

    return simplifyWaypoints([
      from,
      [exitX, from[1]],
      [exitX, candidateY],
      [entryX, candidateY],
      [entryX, to[1]],
      to,
    ]);
  } else {
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
    const avgY = (from[1] + to[1]) / 2 + BELOW_BIAS;
    const escapeBelow = maxBottom + padding;
    const escapeAbove = minTop - padding;
    let escapeY =
      Math.abs(escapeAbove - avgY) < Math.abs(escapeBelow - avgY) ? escapeAbove : escapeBelow;

    escapeY = allocator
      ? allocator.claim(xMin, xMax, findClearY(xMin, xMax, escapeY, inflatedBoxes))
      : findClearY(xMin, xMax, escapeY, inflatedBoxes);

    const bwExitYMin = Math.min(from[1], escapeY);
    const bwExitYMax = Math.max(from[1], escapeY);
    const bwExitX = findClearX(bwExitYMin, bwExitYMax, stubExit[0], inflatedBoxes);

    const bwEntryYMin = Math.min(to[1], escapeY);
    const bwEntryYMax = Math.max(to[1], escapeY);
    const bwEntryX = findClearX(bwEntryYMin, bwEntryYMax, stubEntry[0], inflatedBoxes);

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

export function calculateOrthogonalPath(
  from: Vec2,
  to: Vec2,
  nodeBoxes: NodeBox[],
  sourceNodeId: string,
  targetNodeId: string,
  options?: OrthogonalRouteOptions,
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

  const waypoints = computeWaypoints(
    from,
    to,
    nodeBoxes,
    sourceNodeId,
    targetNodeId,
    padding,
    exitStub,
    entryStub,
    options?.scopedInternal,
    options?.allocator,
  );

  if (!waypoints) return null;

  return waypointsToSvgPath(waypoints, cornerRadius);
}

/**
 * Safe wrapper: returns null if routing fails, caller falls back to straight line.
 */
export function calculateOrthogonalPathSafe(
  from: Vec2,
  to: Vec2,
  nodeBoxes: NodeBox[],
  sourceNodeId: string,
  targetNodeId: string,
  options?: OrthogonalRouteOptions,
): string | null {
  try {
    const path = calculateOrthogonalPath(from, to, nodeBoxes, sourceNodeId, targetNodeId, options);
    if (!path || path.length < 5) return null;
    return path;
  } catch {
    return null;
  }
}
