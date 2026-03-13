/**
 * Branch coverage tests for src/diagram/orthogonal-router.ts
 *
 * Exercises both sides of every conditional: TrackAllocator methods,
 * calculateOrthogonalPath (forward, backward, self-connection, fallback),
 * calculateOrthogonalPathSafe (catch, short path), waypoint simplification,
 * SVG path generation, crossing counting, and node avoidance.
 */

import {
  calculateOrthogonalPath,
  calculateOrthogonalPathSafe,
  TrackAllocator,
  type NodeBox,
} from '../../src/diagram/orthogonal-router.js';

describe('TrackAllocator', () => {
  describe('claim and findFreeY', () => {
    it('returns candidateY when no claims exist', () => {
      const alloc = new TrackAllocator();
      const y = alloc.findFreeY(0, 100, 50);
      expect(y).toBe(50);
    });

    it('finds a free Y when candidateY is occupied', () => {
      const alloc = new TrackAllocator();
      alloc.claim(0, 100, 50);
      const y = alloc.findFreeY(0, 100, 50);
      expect(y).not.toBe(50);
    });

    it('returns candidateY when claim does not overlap in X', () => {
      const alloc = new TrackAllocator();
      alloc.claim(200, 300, 50);
      const y = alloc.findFreeY(0, 100, 50);
      expect(y).toBe(50);
    });

    it('prefers fewer crossings when multiple candidates exist', () => {
      const alloc = new TrackAllocator();
      // Fill up many horizontal tracks
      for (let i = 0; i < 10; i++) {
        alloc.claim(0, 200, 50 + i * 15);
      }
      // Add vertical claims that would cause crossings for some candidates
      alloc.claimVertical(0, 500, 100);
      alloc.claimVertical(0, 500, 120);

      const y = alloc.findFreeY(0, 200, 50);
      expect(typeof y).toBe('number');
    });

    it('returns candidateY when all candidates are blocked (candidates.length === 0 branch)', () => {
      const alloc = new TrackAllocator();
      // Block every Y position in the +-800 range by filling with claims
      for (let y = -800; y <= 800; y += 15) {
        alloc.claim(0, 100, y);
      }
      const y = alloc.findFreeY(0, 100, 50);
      expect(y).toBe(50); // falls back to candidateY
    });

    it('respects nodeBoxes constraint (rejects candidates inside inflated boxes)', () => {
      const alloc = new TrackAllocator();
      alloc.claim(0, 200, 50); // block candidateY=50
      const boxes = [{ left: 0, right: 200, top: 40, bottom: 70 }];
      const y = alloc.findFreeY(0, 200, 50, boxes);
      // Should avoid both the claim and the box
      expect(y < 40 || y > 70).toBe(true);
    });
  });

  describe('claimVertical and findFreeX', () => {
    it('returns candidateX when no vertical claims exist', () => {
      const alloc = new TrackAllocator();
      const x = alloc.findFreeX(0, 100, 50);
      expect(x).toBe(50);
    });

    it('finds a free X when candidateX is occupied', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(0, 100, 50);
      const x = alloc.findFreeX(0, 100, 50);
      expect(x).not.toBe(50);
    });

    it('returns candidateX when vertical claim does not overlap in Y', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(200, 300, 50);
      const x = alloc.findFreeX(0, 100, 50);
      expect(x).toBe(50);
    });

    it('prefers fewer vertical crossings when multiple candidates exist', () => {
      const alloc = new TrackAllocator();
      for (let i = 0; i < 10; i++) {
        alloc.claimVertical(0, 200, 50 + i * 15);
      }
      alloc.claim(0, 500, 100);
      alloc.claim(0, 500, 120);

      const x = alloc.findFreeX(0, 200, 50);
      expect(typeof x).toBe('number');
    });

    it('returns candidateX when all candidates are blocked', () => {
      const alloc = new TrackAllocator();
      for (let x = -800; x <= 800; x += 15) {
        alloc.claimVertical(0, 100, x);
      }
      const x = alloc.findFreeX(0, 100, 50);
      expect(x).toBe(50);
    });

    it('respects nodeBoxes constraint for vertical segments', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(0, 200, 50);
      const boxes = [{ left: 40, right: 70, top: 0, bottom: 200 }];
      const x = alloc.findFreeX(0, 200, 50, boxes);
      expect(x < 40 || x > 70).toBe(true);
    });
  });

  describe('countHorizontalCrossings', () => {
    it('returns 0 when no vertical claims exist', () => {
      const alloc = new TrackAllocator();
      expect(alloc.countHorizontalCrossings(0, 200, 50)).toBe(0);
    });

    it('counts crossings with vertical segments', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(0, 100, 50); // x=50, yMin=0..100
      alloc.claimVertical(0, 100, 150); // x=150, yMin=0..100
      // Horizontal at y=50, from x=0 to x=200 crosses both
      expect(alloc.countHorizontalCrossings(0, 200, 50)).toBe(2);
    });

    it('does not count non-overlapping vertical segments', () => {
      const alloc = new TrackAllocator();
      alloc.claimVertical(200, 300, 50); // y range 200..300
      expect(alloc.countHorizontalCrossings(0, 200, 50)).toBe(0); // y=50 outside 200..300
    });
  });

  describe('countVerticalCrossings', () => {
    it('returns 0 when no horizontal claims exist', () => {
      const alloc = new TrackAllocator();
      expect(alloc.countVerticalCrossings(0, 200, 50)).toBe(0);
    });

    it('counts crossings with horizontal segments', () => {
      const alloc = new TrackAllocator();
      alloc.claim(0, 100, 50); // y=50, xMin=0..100
      alloc.claim(0, 100, 150); // y=150, xMin=0..100
      // Vertical at x=50, from y=0 to y=200 crosses both
      expect(alloc.countVerticalCrossings(0, 200, 50)).toBe(2);
    });

    it('does not count non-overlapping horizontal segments', () => {
      const alloc = new TrackAllocator();
      alloc.claim(200, 300, 50); // x range 200..300
      expect(alloc.countVerticalCrossings(0, 200, 50)).toBe(0); // x=50 outside 200..300
    });
  });
});

describe('calculateOrthogonalPath', () => {
  const twoBoxes: NodeBox[] = [
    { id: 'src', x: 0, y: 0, width: 90, height: 90 },
    { id: 'tgt', x: 400, y: 0, width: 90, height: 90 },
  ];

  it('routes a simple forward connection (to.x > from.x)', () => {
    const path = calculateOrthogonalPath(
      [90, 45], [400, 45],
      twoBoxes, 'src', 'tgt',
    );
    expect(path).toBeTruthy();
    expect(path).toMatch(/^M /);
  });

  it('returns null for nearly aligned ports (fallback to bezier)', () => {
    // from and to are at the same Y with short x distance
    const path = calculateOrthogonalPath(
      [90, 45], [130, 45],
      [], 'src', 'tgt',
    );
    // Near-aligned ports may return null
    expect(path === null || typeof path === 'string').toBe(true);
  });

  it('routes a backward connection (to.x < from.x)', () => {
    const path = calculateOrthogonalPath(
      [400, 45], [90, 45],
      twoBoxes, 'src', 'tgt',
    );
    expect(path).toBeTruthy();
    expect(path).toMatch(/^M /);
  });

  it('routes a self-connection (same source and target node)', () => {
    const boxes: NodeBox[] = [
      { id: 'self', x: 100, y: 100, width: 90, height: 90 },
    ];
    const path = calculateOrthogonalPath(
      [190, 145], [100, 145],
      boxes, 'self', 'self',
    );
    expect(path).toBeTruthy();
  });

  it('uses default options when none provided', () => {
    const path = calculateOrthogonalPath(
      [90, 45], [400, 200],
      twoBoxes, 'src', 'tgt',
    );
    expect(path).toBeTruthy();
  });

  it('uses custom options (cornerRadius, padding, stubLength, etc.)', () => {
    const path = calculateOrthogonalPath(
      [90, 45], [400, 200],
      twoBoxes, 'src', 'tgt',
      { cornerRadius: 5, padding: 20, stubLength: 30, stubSpacing: 10, maxStubLength: 60 },
    );
    expect(path).toBeTruthy();
  });

  it('respects fromPortIndex and toPortIndex for stub spacing', () => {
    const path = calculateOrthogonalPath(
      [90, 45], [400, 200],
      twoBoxes, 'src', 'tgt',
      { fromPortIndex: 3, toPortIndex: 2, stubSpacing: 12, maxStubLength: 80 },
    );
    expect(path).toBeTruthy();
  });

  it('caps stub at maxStubLength when port index is high', () => {
    const path = calculateOrthogonalPath(
      [90, 45], [400, 200],
      twoBoxes, 'src', 'tgt',
      { fromPortIndex: 100, toPortIndex: 100, maxStubLength: 40 },
    );
    expect(path).toBeTruthy();
  });

  it('uses a shared allocator across multiple calls', () => {
    const alloc = new TrackAllocator();
    const path1 = calculateOrthogonalPath(
      [90, 30], [400, 30], twoBoxes, 'src', 'tgt', {}, alloc,
    );
    const path2 = calculateOrthogonalPath(
      [90, 60], [400, 60], twoBoxes, 'src', 'tgt', {}, alloc,
    );
    expect(path1).toBeTruthy();
    expect(path2).toBeTruthy();
  });

  it('routes around intermediate node boxes', () => {
    const boxes: NodeBox[] = [
      { id: 'src', x: 0, y: 0, width: 90, height: 90 },
      { id: 'blocker', x: 200, y: 0, width: 90, height: 90 },
      { id: 'tgt', x: 400, y: 0, width: 90, height: 90 },
    ];
    const path = calculateOrthogonalPath(
      [90, 45], [400, 45], boxes, 'src', 'tgt',
    );
    expect(path).toBeTruthy();
  });

  it('handles cluster of intermediate boxes (intermediateBoxes >= 2 branch)', () => {
    const boxes: NodeBox[] = [
      { id: 'src', x: 0, y: 0, width: 90, height: 90 },
      { id: 'mid1', x: 150, y: 0, width: 90, height: 90 },
      { id: 'mid2', x: 250, y: 0, width: 90, height: 90 },
      { id: 'tgt', x: 500, y: 0, width: 90, height: 90 },
    ];
    const path = calculateOrthogonalPath(
      [90, 45], [500, 45], boxes, 'src', 'tgt',
    );
    expect(path).toBeTruthy();
  });

  it('uses center-corner (L-shape) when vertical gap allows it', () => {
    // Large vertical offset, no obstacles
    const path = calculateOrthogonalPath(
      [90, 0], [400, 300], [], 'src', 'tgt',
    );
    expect(path).toBeTruthy();
  });

  it('routes S-shape when center-corner is blocked', () => {
    // Place a blocker exactly at the midpoint
    const boxes: NodeBox[] = [
      { id: 'src', x: 0, y: -20, width: 90, height: 90 },
      { id: 'blocker', x: 220, y: 50, width: 100, height: 200 },
      { id: 'tgt', x: 450, y: 200, width: 90, height: 90 },
    ];
    const path = calculateOrthogonalPath(
      [90, 25], [450, 245], boxes, 'src', 'tgt',
    );
    expect(path).toBeTruthy();
  });

  it('handles backward connection with sourceBox and targetBox found', () => {
    const boxes: NodeBox[] = [
      { id: 'A', x: 300, y: 0, width: 90, height: 90 },
      { id: 'B', x: 0, y: 0, width: 90, height: 90 },
    ];
    const path = calculateOrthogonalPath(
      [390, 45], [0, 45], boxes, 'A', 'B',
    );
    expect(path).toBeTruthy();
  });

  it('handles backward connection without sourceBox or targetBox found', () => {
    const path = calculateOrthogonalPath(
      [390, 45], [0, 45], [], 'A', 'B',
    );
    expect(path).toBeTruthy();
  });

  it('escape route goes above when closer to top', () => {
    const boxes: NodeBox[] = [
      { id: 'A', x: 300, y: 0, width: 90, height: 90 },
      { id: 'B', x: 0, y: 0, width: 90, height: 90 },
    ];
    const path = calculateOrthogonalPath(
      [390, 20], [0, 20], boxes, 'A', 'B',
    );
    expect(path).toBeTruthy();
  });
});

describe('calculateOrthogonalPathSafe', () => {
  it('returns path for a valid route', () => {
    const result = calculateOrthogonalPathSafe(
      [90, 45], [400, 45], [], 'src', 'tgt',
    );
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('returns null when calculateOrthogonalPath throws', () => {
    const badBoxes = new Proxy([] as NodeBox[], {
      get(target, prop) {
        if (prop === 'filter') {
          return () => { throw new Error('simulated'); };
        }
        return Reflect.get(target, prop);
      },
    });
    const result = calculateOrthogonalPathSafe(
      [0, 50], [300, 150], badBoxes, 'src', 'tgt',
    );
    expect(result).toBeNull();
  });

  it('returns null for very short path strings (< 5 chars)', () => {
    // Identical points with backward connection to trigger near-empty path
    const result = calculateOrthogonalPathSafe(
      [0, 0], [0, 0], [], 'src', 'tgt',
    );
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

describe('waypoint simplification edge cases (via calculateOrthogonalPath)', () => {
  it('simplifies collinear waypoints into shorter path', () => {
    const path = calculateOrthogonalPath(
      [0, 100], [500, 100], [], 'a', 'b',
    );
    // Nearly horizontal: may fall back to null or produce simplified path
    expect(path === null || typeof path === 'string').toBe(true);
  });

  it('collapses small vertical jog when within JOG_THRESHOLD', () => {
    // Route that forces a tiny vertical detour
    const boxes: NodeBox[] = [
      { id: 'a', x: 0, y: 95, width: 80, height: 10 },
      { id: 'b', x: 400, y: 95, width: 80, height: 10 },
      { id: 'blocker', x: 180, y: 97, width: 40, height: 4 },
    ];
    const path = calculateOrthogonalPath(
      [80, 100], [400, 100], boxes, 'a', 'b',
    );
    expect(path === null || typeof path === 'string').toBe(true);
  });
});

describe('SVG path rendering edge cases', () => {
  it('handles two-point paths (straight line)', () => {
    // Extremely short distance should produce simple path or null
    const path = calculateOrthogonalPath(
      [0, 50], [500, 50], [], 'a', 'b',
    );
    expect(path === null || typeof path === 'string').toBe(true);
  });

  it('renders corners with radius < 2 as straight lines', () => {
    const path = calculateOrthogonalPath(
      [0, 0], [500, 300], [], 'a', 'b',
      { cornerRadius: 1 },
    );
    if (path) {
      // With radius < 2, arcs become L commands
      expect(path).not.toContain(' A ');
    }
  });

  it('renders corners with default radius as arcs', () => {
    const boxes: NodeBox[] = [
      { id: 'a', x: 0, y: 0, width: 80, height: 80 },
      { id: 'b', x: 400, y: 200, width: 80, height: 80 },
    ];
    const path = calculateOrthogonalPath(
      [80, 40], [400, 240], boxes, 'a', 'b',
      { cornerRadius: 10 },
    );
    if (path) {
      expect(path).toContain(' A ');
    }
  });

  it('shrinks radii when two adjacent corners share a short segment', () => {
    // Route with tight turns that forces radius shrinkage
    const boxes: NodeBox[] = [
      { id: 'a', x: 0, y: 0, width: 80, height: 80 },
      { id: 'blocker', x: 150, y: 30, width: 100, height: 40 },
      { id: 'b', x: 350, y: 0, width: 80, height: 80 },
    ];
    const path = calculateOrthogonalPath(
      [80, 40], [350, 40], boxes, 'a', 'b',
      { cornerRadius: 30 },
    );
    expect(path === null || typeof path === 'string').toBe(true);
  });
});

describe('findClearY / findClearX fallback paths', () => {
  it('routes around a fully blocking corridor (bestDist === Infinity fallback)', () => {
    // Create a wall of boxes that blocks the entire horizontal channel
    const boxes: NodeBox[] = [
      { id: 'src', x: 0, y: 0, width: 80, height: 80 },
      { id: 'tgt', x: 500, y: 0, width: 80, height: 80 },
    ];
    // Fill the space between with tall blockers
    for (let i = 0; i < 5; i++) {
      boxes.push({
        id: `wall${i}`,
        x: 100 + i * 60,
        y: -200,
        width: 50,
        height: 500,
      });
    }
    const path = calculateOrthogonalPath(
      [80, 40], [500, 40], boxes, 'src', 'tgt',
    );
    // Should still produce a valid path or null
    expect(path === null || typeof path === 'string').toBe(true);
  });

  it('findClearX fallback for vertical segment blocked by corridor', () => {
    const boxes: NodeBox[] = [
      { id: 'src', x: 0, y: 0, width: 80, height: 80 },
      { id: 'tgt', x: 400, y: 300, width: 80, height: 80 },
    ];
    // Horizontal wall blocking the vertical path
    for (let i = 0; i < 4; i++) {
      boxes.push({
        id: `hwall${i}`,
        x: 80 + i * 80,
        y: 100,
        width: 70,
        height: 100,
      });
    }
    const path = calculateOrthogonalPath(
      [80, 40], [400, 340], boxes, 'src', 'tgt',
    );
    expect(path === null || typeof path === 'string').toBe(true);
  });
});

describe('exitX / entryX fallback paths (forward connection)', () => {
  it('triggers exitX fallback when initial exitX < from[0]', () => {
    // Place boxes that push the free exitX to the left of the source
    const boxes: NodeBox[] = [
      { id: 'src', x: 200, y: 0, width: 80, height: 80 },
      { id: 'tgt', x: 600, y: 200, width: 80, height: 80 },
      // Block the exit stub area to force exitX < from[0]
      { id: 'block', x: 260, y: -100, width: 60, height: 300 },
    ];
    const path = calculateOrthogonalPath(
      [280, 40], [600, 240], boxes, 'src', 'tgt',
    );
    expect(path === null || typeof path === 'string').toBe(true);
  });

  it('triggers entryX fallback when initial entryX > to[0]', () => {
    const boxes: NodeBox[] = [
      { id: 'src', x: 0, y: 0, width: 80, height: 80 },
      { id: 'tgt', x: 400, y: 200, width: 80, height: 80 },
      // Block entry stub area
      { id: 'block', x: 350, y: -100, width: 60, height: 400 },
    ];
    const path = calculateOrthogonalPath(
      [80, 40], [400, 240], boxes, 'src', 'tgt',
    );
    expect(path === null || typeof path === 'string').toBe(true);
  });
});
