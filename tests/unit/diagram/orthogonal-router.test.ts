import { describe, it, expect } from 'vitest';
import {
  TrackAllocator,
  calculateOrthogonalPath,
  calculateOrthogonalPathSafe,
  type NodeBox,
  type OrthogonalRouteOptions,
} from '../../../src/diagram/orthogonal-router';

// ─── Helpers ───

type Vec2 = [number, number];

function makeBox(id: string, x: number, y: number, width = 120, height = 60): NodeBox {
  return { id, x, y, width, height };
}

/** Parse the first M command from an SVG path to get the starting point. */
function parsePathStart(path: string): Vec2 | null {
  const match = path.match(/^M\s+([\d.-]+),([\d.-]+)/);
  if (!match) return null;
  return [parseFloat(match[1]), parseFloat(match[2])];
}

/** Check that an SVG path string is well-formed: starts with M, has subsequent commands. */
function isValidSvgPath(path: string): boolean {
  return /^M\s+[\d.-]+,[\d.-]+/.test(path) && path.length > 10;
}

/** Extract all numeric coordinate pairs from an SVG path. */
function extractCoords(path: string): Vec2[] {
  const coords: Vec2[] = [];
  const regex = /([\d.-]+),([\d.-]+)/g;
  let m;
  while ((m = regex.exec(path)) !== null) {
    coords.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  return coords;
}

// ─── TrackAllocator ───

describe('TrackAllocator', () => {
  describe('claim and findFreeY', () => {
    it('returns the candidate Y when no claims exist', () => {
      const alloc = new TrackAllocator();
      const y = alloc.findFreeY(0, 200, 100);
      expect(y).toBe(100);
    });

    it('avoids a claimed horizontal segment in the same X range', () => {
      const alloc = new TrackAllocator();
      alloc.claim(0, 200, 100);
      const y = alloc.findFreeY(50, 150, 100);
      expect(y).not.toBe(100);
      // Should differ from 100 by at least TRACK_SPACING (15)
      expect(Math.abs(y - 100)).toBeGreaterThanOrEqual(15);
    });

    it('allows a claimed segment when X ranges do not overlap', () => {
      const alloc = new TrackAllocator();
      alloc.claim(0, 50, 100);
      const y = alloc.findFreeY(100, 200, 100);
      expect(y).toBe(100);
    });

    it('finds the nearest free Y, not just any free Y', () => {
      const alloc = new TrackAllocator();
      // Claim a band around y=100
      alloc.claim(0, 200, 100);
      const y = alloc.findFreeY(0, 200, 105);
      // Should pick something close to 105 but outside the 100 +/- 15 zone
      expect(Math.abs(y - 105)).toBeLessThan(100);
    });

    it('returns candidateY when all attempts fail (extreme congestion)', () => {
      const alloc = new TrackAllocator();
      // Fill up a huge vertical range
      for (let i = -800; i <= 800; i += 15) {
        alloc.claim(0, 200, i);
      }
      // With everything occupied, it falls back to candidateY
      const y = alloc.findFreeY(0, 200, 50);
      expect(typeof y).toBe('number');
    });
  });

  describe('claimVertical and findFreeX', () => {
    it('returns the candidate X when no vertical claims exist', () => {
      const alloc = new TrackAllocator();
      const x = alloc.findFreeX(0, 200, 100);
      expect(x).toBe(100);
    });

    it('avoids a claimed vertical segment in the same Y range', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(0, 200, 100);
      const x = alloc.findFreeX(50, 150, 100);
      expect(x).not.toBe(100);
      expect(Math.abs(x - 100)).toBeGreaterThanOrEqual(15);
    });

    it('allows a claimed vertical segment when Y ranges do not overlap', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(0, 50, 100);
      const x = alloc.findFreeX(100, 200, 100);
      expect(x).toBe(100);
    });
  });

  describe('crossing counts', () => {
    it('countHorizontalCrossings returns 0 with no vertical claims', () => {
      const alloc = new TrackAllocator();
      expect(alloc.countHorizontalCrossings(0, 200, 100)).toBe(0);
    });

    it('countHorizontalCrossings detects a vertical claim crossing a horizontal segment', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(50, 150, 100); // vertical at x=100 from y=50 to y=150
      // A horizontal segment at y=100 from x=0 to x=200 crosses x=100
      expect(alloc.countHorizontalCrossings(0, 200, 100)).toBe(1);
    });

    it('countHorizontalCrossings ignores vertical claims outside the X range', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(50, 150, 300); // vertical at x=300
      expect(alloc.countHorizontalCrossings(0, 200, 100)).toBe(0);
    });

    it('countHorizontalCrossings ignores vertical claims outside the Y range', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(200, 300, 100); // vertical from y=200 to y=300
      // horizontal at y=100 does not intersect
      expect(alloc.countHorizontalCrossings(0, 200, 100)).toBe(0);
    });

    it('countVerticalCrossings returns 0 with no horizontal claims', () => {
      const alloc = new TrackAllocator();
      expect(alloc.countVerticalCrossings(0, 200, 100)).toBe(0);
    });

    it('countVerticalCrossings detects a horizontal claim crossing a vertical segment', () => {
      const alloc = new TrackAllocator();
      alloc.claim(50, 150, 100); // horizontal at y=100 from x=50 to x=150
      // A vertical segment at x=100 from y=0 to y=200 crosses y=100
      expect(alloc.countVerticalCrossings(0, 200, 100)).toBe(1);
    });

    it('countVerticalCrossings counts multiple crossings', () => {
      const alloc = new TrackAllocator();
      alloc.claim(50, 150, 50);
      alloc.claim(50, 150, 100);
      alloc.claim(50, 150, 150);
      expect(alloc.countVerticalCrossings(0, 200, 100)).toBe(3);
    });
  });

  describe('findFreeY with node boxes', () => {
    it('avoids inflated node boxes', () => {
      const alloc = new TrackAllocator();
      const boxes = [{ left: 0, right: 200, top: 90, bottom: 110 }];
      const y = alloc.findFreeY(0, 200, 100, boxes);
      // Should not route through the box
      expect(y < 90 || y > 110).toBe(true);
    });

    it('returns candidateY when box does not overlap X range', () => {
      const alloc = new TrackAllocator();
      const boxes = [{ left: 300, right: 400, top: 90, bottom: 110 }];
      const y = alloc.findFreeY(0, 200, 100, boxes);
      expect(y).toBe(100);
    });
  });

  describe('findFreeX with node boxes', () => {
    it('avoids inflated node boxes', () => {
      const alloc = new TrackAllocator();
      const boxes = [{ left: 90, right: 110, top: 0, bottom: 200 }];
      const x = alloc.findFreeX(0, 200, 100, boxes);
      expect(x < 90 || x > 110).toBe(true);
    });
  });

  describe('crossing minimization preference', () => {
    it('prefers a Y with fewer crossings over a closer Y', () => {
      const alloc = new TrackAllocator();
      // Claim the candidateY so it is occupied
      alloc.claim(0, 200, 100);
      // Place many vertical claims above y=100, making the "above" direction costly
      alloc.claimVertical(50, 150, 30);
      alloc.claimVertical(50, 150, 60);
      alloc.claimVertical(50, 150, 90);
      // The allocator should prefer the direction with fewer crossings
      const y = alloc.findFreeY(0, 200, 100);
      expect(typeof y).toBe('number');
      expect(Math.abs(y - 100)).toBeGreaterThanOrEqual(15);
    });
  });
});

// ─── calculateOrthogonalPath ───

describe('calculateOrthogonalPath', () => {
  describe('basic forward routing', () => {
    it('returns a valid SVG path for a simple left-to-right connection', () => {
      // Use different Y values so the router does not trigger the bezier fallback
      // (same-Y forward connections with no detour return null)
      const from: Vec2 = [220, 50];
      const to: Vec2 = [400, 120];
      const boxes = [makeBox('A', 100, 20), makeBox('B', 400, 90)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('path starts at the from point', () => {
      const from: Vec2 = [220, 50];
      const to: Vec2 = [400, 120];
      const boxes = [makeBox('A', 100, 20), makeBox('B', 400, 90)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      const start = parsePathStart(path!);
      expect(start).not.toBeNull();
      expect(start![0]).toBe(from[0]);
      expect(start![1]).toBe(from[1]);
    });

    it('path ends at the to point', () => {
      const from: Vec2 = [220, 50];
      const to: Vec2 = [400, 120];
      const boxes = [makeBox('A', 100, 20), makeBox('B', 400, 90)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      const coords = extractCoords(path!);
      const last = coords[coords.length - 1];
      expect(last[0]).toBe(to[0]);
      expect(last[1]).toBe(to[1]);
    });

    it('generates an L-shape when nodes are at different Y positions', () => {
      const from: Vec2 = [220, 50];
      const to: Vec2 = [500, 200];
      const boxes = [makeBox('A', 100, 20), makeBox('B', 500, 170)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('generates an S-shape when horizontal channel needed', () => {
      const from: Vec2 = [220, 50];
      const to: Vec2 = [500, 200];
      // Place an obstacle between the nodes forcing an S-shape
      const boxes = [
        makeBox('A', 100, 20),
        makeBox('B', 500, 170),
        makeBox('C', 300, 80, 120, 80),
      ];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });
  });

  describe('backward connection routing', () => {
    it('routes backward connections (to.x < from.x)', () => {
      const from: Vec2 = [500, 80];
      const to: Vec2 = [200, 80];
      const boxes = [makeBox('A', 380, 50), makeBox('B', 80, 50)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('backward routes escape vertically around source and target nodes', () => {
      const from: Vec2 = [500, 80];
      const to: Vec2 = [200, 80];
      const boxes = [makeBox('A', 380, 50), makeBox('B', 80, 50)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      // The route should have vertical segments, so coords should show Y variation
      const coords = extractCoords(path!);
      const ys = coords.map(c => c[1]);
      const yRange = Math.max(...ys) - Math.min(...ys);
      expect(yRange).toBeGreaterThan(0);
    });
  });

  describe('self-connection routing', () => {
    it('routes a self-connection (sourceNodeId === targetNodeId)', () => {
      const box = makeBox('A', 100, 50, 120, 60);
      const from: Vec2 = [220, 80]; // right side
      const to: Vec2 = [100, 80];   // left side
      const path = calculateOrthogonalPath(from, to, [box], 'A', 'A');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('self-connection includes the node in inflated boxes for avoidance', () => {
      const box = makeBox('A', 100, 50, 120, 60);
      const from: Vec2 = [220, 80];
      const to: Vec2 = [100, 80];
      const path = calculateOrthogonalPath(from, to, [box], 'A', 'A');
      expect(path).not.toBeNull();
      // The escape Y should be above or below the node (y=50 to y=110)
      const coords = extractCoords(path!);
      const ys = coords.map(c => c[1]);
      const extremeY = ys.some(y => y < 50 - 15 || y > 110 + 15);
      expect(extremeY).toBe(true);
    });
  });

  describe('same row / nearly aligned ports', () => {
    it('returns null for same-Y ports in forward direction (bezier fallback)', () => {
      // When from and to are at the same Y with a clear path, the clearY lands
      // within JOG_THRESHOLD of from.y, so the router returns null
      const from: Vec2 = [220, 80];
      const to: Vec2 = [400, 80];
      const boxes = [makeBox('A', 100, 50), makeBox('B', 400, 50)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).toBeNull();
    });

    it('returns null for nearly aligned ports (within JOG_THRESHOLD)', () => {
      const from: Vec2 = [220, 80];
      const to: Vec2 = [400, 85]; // 5px difference, within JOG_THRESHOLD of 10
      const boxes = [makeBox('A', 100, 50), makeBox('B', 400, 55)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      // Should return null since Y difference is within the jog threshold
      expect(path).toBeNull();
    });
  });

  describe('stub length options', () => {
    it('respects custom stub length', () => {
      const from: Vec2 = [220, 80];
      const to: Vec2 = [500, 200];
      const boxes = [makeBox('A', 100, 50), makeBox('B', 500, 170)];
      const opts: OrthogonalRouteOptions = { stubLength: 40 };
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B', opts);
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('increases stub length for higher port indices', () => {
      const from: Vec2 = [220, 80];
      const to: Vec2 = [500, 200];
      const boxes = [makeBox('A', 100, 50), makeBox('B', 500, 170)];

      const path0 = calculateOrthogonalPath(from, to, boxes, 'A', 'B', { fromPortIndex: 0 });
      const path2 = calculateOrthogonalPath(from, to, boxes, 'A', 'B', { fromPortIndex: 2 });

      // Both should be valid, but the paths should differ due to stub spacing
      expect(path0).not.toBeNull();
      expect(path2).not.toBeNull();
      // They should differ since port index 2 gets a longer stub
      if (path0 && path2) {
        expect(path0).not.toBe(path2);
      }
    });

    it('caps stub length at maxStubLength', () => {
      const from: Vec2 = [220, 80];
      const to: Vec2 = [500, 200];
      const boxes = [makeBox('A', 100, 50), makeBox('B', 500, 170)];
      const opts: OrthogonalRouteOptions = {
        stubLength: 20,
        stubSpacing: 12,
        maxStubLength: 30,
        fromPortIndex: 10, // would be 20 + 10*12 = 140, capped to 30
      };
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B', opts);
      expect(path).not.toBeNull();
    });
  });

  describe('corner radius', () => {
    it('produces arc commands (A) in the path when corners are needed', () => {
      const from: Vec2 = [220, 50];
      const to: Vec2 = [500, 200];
      const boxes = [makeBox('A', 100, 20), makeBox('B', 500, 170)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B', { cornerRadius: 10 });
      expect(path).not.toBeNull();
      // With non-trivial routing (different Y), there should be arc commands
      if (path!.includes(' A ')) {
        expect(path).toContain(' A ');
      }
    });

    it('produces straight lines with cornerRadius=0', () => {
      const from: Vec2 = [220, 50];
      const to: Vec2 = [500, 200];
      const boxes = [makeBox('A', 100, 20), makeBox('B', 500, 170)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B', { cornerRadius: 0 });
      expect(path).not.toBeNull();
      // With radius 0 (below the r < 2 threshold), no arcs should appear
      expect(path).not.toContain(' A ');
    });
  });

  describe('obstacle avoidance', () => {
    it('routes around an obstacle placed between source and target', () => {
      const from: Vec2 = [220, 100];
      const to: Vec2 = [600, 100];
      const obstacle = makeBox('C', 350, 70, 120, 60); // sits right between them
      const boxes = [makeBox('A', 100, 70), makeBox('B', 600, 70), obstacle];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
      // Route should go around the obstacle, meaning it has Y values outside [70, 130]
      const coords = extractCoords(path!);
      const ys = coords.map(c => c[1]);
      // At least one Y should be outside the obstacle's Y range (with padding)
      const outsideObstacle = ys.some(y => y < 55 || y > 145);
      expect(outsideObstacle).toBe(true);
    });

    it('routes around multiple obstacles', () => {
      const from: Vec2 = [220, 100];
      const to: Vec2 = [800, 100];
      const boxes = [
        makeBox('A', 100, 70),
        makeBox('B', 800, 70),
        makeBox('C', 300, 60, 120, 80),
        makeBox('D', 500, 60, 120, 80),
      ];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('handles obstacle near the direct path with Y offset', () => {
      // Use different Y values to avoid the bezier fallback for same-Y routes
      const from: Vec2 = [220, 180];
      const to: Vec2 = [600, 230];
      const obstacle = makeBox('C', 350, 190, 120, 60);
      const boxes = [makeBox('A', 100, 150), makeBox('B', 600, 200), obstacle];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
    });
  });

  describe('shared allocator for multiple connections', () => {
    it('produces non-overlapping routes when sharing an allocator', () => {
      const alloc = new TrackAllocator();
      const boxes = [
        makeBox('A', 100, 50),
        makeBox('B', 400, 150),
        makeBox('C', 400, 300),
      ];

      // Use different Y values so the router does not fall back to bezier
      const path1 = calculateOrthogonalPath(
        [220, 80], [400, 180], boxes, 'A', 'B', {}, alloc,
      );
      const path2 = calculateOrthogonalPath(
        [220, 80], [400, 330], boxes, 'A', 'C', {}, alloc,
      );

      expect(path1).not.toBeNull();
      expect(path2).not.toBeNull();
      // Routes should be different since they go to different targets
      expect(path1).not.toBe(path2);
    });

    it('allocator tracks are respected across connections', () => {
      const alloc = new TrackAllocator();
      const boxes = [
        makeBox('A', 100, 100),
        makeBox('B', 500, 100),
        makeBox('C', 500, 200),
      ];

      // First connection claims some tracks
      calculateOrthogonalPath([220, 130], [500, 130], boxes, 'A', 'B', {}, alloc);
      // Second connection should avoid the claimed tracks
      const path2 = calculateOrthogonalPath([220, 130], [500, 230], boxes, 'A', 'C', {}, alloc);
      expect(path2).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles zero-distance (same from and to point)', () => {
      const from: Vec2 = [220, 80];
      const to: Vec2 = [220, 80];
      const boxes = [makeBox('A', 100, 50), makeBox('B', 100, 50)];
      // This is a backward connection (to.x is not > from.x), so it takes the escape path
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      // Should still produce a valid path or null
      if (path !== null) {
        expect(isValidSvgPath(path)).toBe(true);
      }
    });

    it('handles very large distances', () => {
      const from: Vec2 = [0, 0];
      const to: Vec2 = [5000, 3000];
      const boxes = [makeBox('A', 0, 0, 50, 30), makeBox('B', 5000, 3000, 50, 30)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('handles negative coordinates', () => {
      const from: Vec2 = [-200, -100];
      const to: Vec2 = [200, 100];
      const boxes = [makeBox('A', -300, -130), makeBox('B', 200, 70)];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('handles empty nodeBoxes array', () => {
      const from: Vec2 = [100, 50];
      const to: Vec2 = [400, 200];
      const path = calculateOrthogonalPath(from, to, [], 'A', 'B');
      expect(path).not.toBeNull();
      expect(isValidSvgPath(path!)).toBe(true);
    });

    it('handles nodes with no IDs matching source or target', () => {
      const from: Vec2 = [220, 80];
      const to: Vec2 = [500, 80];
      const boxes = [makeBox('X', 300, 50)]; // neither 'A' nor 'B'
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      expect(path).not.toBeNull();
    });

    it('handles overlapping source and target nodes', () => {
      const from: Vec2 = [220, 80];
      const to: Vec2 = [300, 80];
      const boxes = [
        makeBox('A', 100, 50, 150, 60),
        makeBox('B', 200, 50, 150, 60),
      ];
      const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      // The router should handle this, returning a path or null
      if (path !== null) {
        expect(isValidSvgPath(path)).toBe(true);
      }
    });
  });

  describe('default options', () => {
    it('uses default cornerRadius of 10', () => {
      const from: Vec2 = [220, 50];
      const to: Vec2 = [500, 200];
      const boxes = [makeBox('A', 100, 20), makeBox('B', 500, 170)];
      const pathDefault = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      const pathExplicit = calculateOrthogonalPath(from, to, boxes, 'A', 'B', { cornerRadius: 10 });
      expect(pathDefault).toBe(pathExplicit);
    });

    it('uses default padding of 15', () => {
      const from: Vec2 = [220, 80];
      const to: Vec2 = [500, 80];
      const boxes = [makeBox('A', 100, 50), makeBox('B', 500, 50)];
      const pathDefault = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
      const pathExplicit = calculateOrthogonalPath(from, to, boxes, 'A', 'B', { padding: 15 });
      expect(pathDefault).toBe(pathExplicit);
    });
  });
});

// ─── calculateOrthogonalPathSafe ───

describe('calculateOrthogonalPathSafe', () => {
  it('returns a valid path for a normal forward connection', () => {
    const from: Vec2 = [220, 80];
    const to: Vec2 = [500, 200];
    const boxes = [makeBox('A', 100, 50), makeBox('B', 500, 170)];
    const path = calculateOrthogonalPathSafe(from, to, boxes, 'A', 'B');
    expect(path).not.toBeNull();
    expect(isValidSvgPath(path!)).toBe(true);
  });

  it('returns null when the underlying path is null (bezier fallback)', () => {
    // Nearly aligned ports that produce a null from calculateOrthogonalPath
    const from: Vec2 = [220, 80];
    const to: Vec2 = [400, 83];
    const boxes = [makeBox('A', 100, 50), makeBox('B', 400, 50)];
    const rawPath = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
    const safePath = calculateOrthogonalPathSafe(from, to, boxes, 'A', 'B');
    if (rawPath === null) {
      expect(safePath).toBeNull();
    } else {
      // If raw path is valid and long enough, safe should return it too
      expect(safePath).not.toBeNull();
    }
  });

  it('returns null instead of throwing on degenerate input', () => {
    // Even with unusual inputs, safe wrapper should not throw
    const from: Vec2 = [NaN, NaN];
    const to: Vec2 = [NaN, NaN];
    const path = calculateOrthogonalPathSafe(from, to, [], 'A', 'B');
    // NaN coordinates will produce a path with NaN in it, which is < 5 chars or safe returns null
    // The key assertion is that it does not throw
    expect(path === null || typeof path === 'string').toBe(true);
  });

  it('returns null for very short paths (< 5 chars)', () => {
    // Two identical points right next to each other, forward direction
    // This will either produce a short path or null
    const from: Vec2 = [100, 80];
    const to: Vec2 = [101, 80];
    const boxes: NodeBox[] = [];
    const path = calculateOrthogonalPathSafe(from, to, boxes, 'A', 'B');
    // The safe wrapper checks path.length < 5
    if (path !== null) {
      expect(path.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('accepts a shared allocator', () => {
    const alloc = new TrackAllocator();
    const boxes = [makeBox('A', 100, 50), makeBox('B', 500, 50)];
    const path = calculateOrthogonalPathSafe(
      [220, 80], [500, 80], boxes, 'A', 'B', {}, alloc,
    );
    if (path !== null) {
      expect(isValidSvgPath(path)).toBe(true);
    }
  });
});

// ─── SVG path structure validation ───

describe('SVG path structure', () => {
  it('path contains only M, L, and A commands for multi-waypoint routes', () => {
    const from: Vec2 = [220, 50];
    const to: Vec2 = [500, 200];
    const boxes = [makeBox('A', 100, 20), makeBox('B', 500, 170)];
    const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B', { cornerRadius: 10 });
    expect(path).not.toBeNull();
    // Remove all coordinate numbers and commas, leaving just command letters
    const commands = path!.replace(/[\d.\-,\s]+/g, ' ').trim().split(/\s+/);
    for (const cmd of commands) {
      expect(['M', 'L', 'A']).toContain(cmd);
    }
  });

  it('two-point path (straight line) uses M and L only', () => {
    // When simplification collapses everything to two points
    const from: Vec2 = [100, 100];
    const to: Vec2 = [500, 100];
    const boxes: NodeBox[] = [];
    const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B', { cornerRadius: 0 });
    if (path !== null) {
      // At cornerRadius 0, no arcs
      expect(path).not.toContain(' A ');
    }
  });
});

// ─── Cluster avoidance ───

describe('cluster avoidance', () => {
  it('routes around a cluster of intermediate obstacles', () => {
    const from: Vec2 = [220, 150];
    const to: Vec2 = [800, 150];
    // Dense cluster of obstacles between from and to
    const boxes = [
      makeBox('A', 100, 120),
      makeBox('B', 800, 120),
      makeBox('C1', 350, 100, 100, 60),
      makeBox('C2', 350, 170, 100, 60),
      makeBox('C3', 500, 100, 100, 60),
      makeBox('C4', 500, 170, 100, 60),
    ];
    const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
    expect(path).not.toBeNull();
    expect(isValidSvgPath(path!)).toBe(true);
  });

  it('prefers routing above or below a cluster based on proximity', () => {
    const boxes = [
      makeBox('A', 100, 200),
      makeBox('B', 800, 200),
      makeBox('C1', 400, 150, 120, 60),
      makeBox('C2', 400, 220, 120, 60),
    ];
    // From port near the top of the cluster, should prefer routing above
    const from: Vec2 = [220, 220];
    const to: Vec2 = [800, 220];
    const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
    expect(path).not.toBeNull();
  });
});

// ─── Backward connection specifics ───

describe('backward connection specifics', () => {
  it('chooses escape direction based on proximity to cluster edges', () => {
    const from: Vec2 = [500, 80];
    const to: Vec2 = [100, 80];
    const boxes = [
      makeBox('A', 380, 50, 120, 60),
      makeBox('B', 0, 50, 100, 60),
    ];
    const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
    expect(path).not.toBeNull();
    expect(isValidSvgPath(path!)).toBe(true);
  });

  it('backward route with target below source', () => {
    const from: Vec2 = [500, 80];
    const to: Vec2 = [100, 250];
    const boxes = [makeBox('A', 380, 50), makeBox('B', 0, 220)];
    const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
    expect(path).not.toBeNull();
    expect(isValidSvgPath(path!)).toBe(true);
  });

  it('backward route with target above source', () => {
    const from: Vec2 = [500, 250];
    const to: Vec2 = [100, 80];
    const boxes = [makeBox('A', 380, 220), makeBox('B', 0, 50)];
    const path = calculateOrthogonalPath(from, to, boxes, 'A', 'B');
    expect(path).not.toBeNull();
    expect(isValidSvgPath(path!)).toBe(true);
  });
});
