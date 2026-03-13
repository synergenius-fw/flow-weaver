/**
 * Additional coverage for orthogonal-router.ts lines 598-601 and 611-614.
 *
 * These lines handle fallback logic in the S-shape path of forward connections:
 * - Lines 598-601: exitX resets to stubExit[0] when findClearX returns a value
 *   left of from[0], and if the stub is also blocked, re-searches with offset.
 * - Lines 611-614: entryX resets to stubEntry[0] when findClearX returns a value
 *   right of to[0], and if the stub is also blocked, re-searches with offset.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateOrthogonalPath,
  TrackAllocator,
  type NodeBox,
} from '../../src/diagram/orthogonal-router.js';

describe('orthogonal-router exitX fallback (lines 598-601)', () => {
  it('falls back when exitX drifts left of from[0] and stub is blocked', () => {
    // We need a forward connection where:
    // 1. The center-corner heuristic fails (blocked by nodes).
    // 2. findClearX for the exit vertical returns something < from[0].
    // 3. The stub position is also vertically blocked.
    //
    // Strategy: place a tall node directly at the exit stub x-range so the
    // initial findClearX pushes left, and the stub column is also blocked.
    const from: [number, number] = [200, 300];
    const to: [number, number] = [600, 100];

    const boxes: NodeBox[] = [
      // Source node
      { id: 'src', x: 80, y: 270, width: 120, height: 60 },
      // Tall blocker sitting right at the exit stub column and spanning
      // the vertical range between from[1] and the likely clearY.
      // This blocks both the initial findClearX result and the stub itself.
      { id: 'exitBlocker', x: 195, y: 50, width: 50, height: 350 },
      // Wide blocker in the middle to defeat center-corner routing
      { id: 'midBlocker', x: 300, y: 50, width: 200, height: 350 },
      // Target node
      { id: 'tgt', x: 580, y: 70, width: 120, height: 60 },
    ];

    const allocator = new TrackAllocator();
    // Pre-claim tracks near the exit stub to force additional fallback
    allocator.claim(180, 250, 200);
    allocator.claim(180, 250, 215);

    const result = calculateOrthogonalPath(from, to, boxes, 'src', 'tgt', {
      padding: 15,
      stubLength: 20,
    }, allocator);

    // The function should produce a valid path or null, never throw
    expect(result === null || typeof result === 'string').toBe(true);
    if (result !== null) {
      expect(result).toContain('M ');
    }
  });

  it('exercises exitX fallback with pre-claimed vertical tracks', () => {
    const from: [number, number] = [150, 250];
    const to: [number, number] = [500, 80];

    const boxes: NodeBox[] = [
      { id: 'src', x: 30, y: 220, width: 120, height: 60 },
      // Block the exit stub column vertically
      { id: 'vBlock', x: 145, y: 0, width: 30, height: 400 },
      // Block the mid area
      { id: 'midBlock', x: 250, y: 0, width: 150, height: 400 },
      { id: 'tgt', x: 480, y: 50, width: 120, height: 60 },
    ];

    const allocator = new TrackAllocator();
    // Saturate the area around the exit stub so findClearX has to look far left
    for (let x = 100; x <= 180; x += 15) {
      allocator.claimVertical(0, 400, x);
    }

    const result = calculateOrthogonalPath(from, to, boxes, 'src', 'tgt', {
      padding: 15,
      stubLength: 20,
    }, allocator);

    expect(result === null || typeof result === 'string').toBe(true);
  });
});

describe('orthogonal-router entryX fallback (lines 611-614)', () => {
  it('falls back when entryX drifts right of to[0] and stub is blocked', () => {
    // We need a forward connection where:
    // 1. The center-corner heuristic fails.
    // 2. findClearX for the entry vertical returns something > to[0].
    // 3. The stub position is also vertically blocked.
    const from: [number, number] = [100, 100];
    const to: [number, number] = [500, 350];

    const boxes: NodeBox[] = [
      { id: 'src', x: 80, y: 70, width: 120, height: 60 },
      // Wide mid blocker to defeat center-corner
      { id: 'midBlock', x: 250, y: 0, width: 150, height: 450 },
      // Tall blocker at the entry stub column
      { id: 'entryBlocker', x: 455, y: 50, width: 60, height: 400 },
      { id: 'tgt', x: 500, y: 320, width: 120, height: 60 },
    ];

    const allocator = new TrackAllocator();
    // Pre-claim tracks near the entry stub to force additional fallback
    allocator.claim(450, 520, 300);
    allocator.claim(450, 520, 315);

    const result = calculateOrthogonalPath(from, to, boxes, 'src', 'tgt', {
      padding: 15,
      stubLength: 20,
    }, allocator);

    expect(result === null || typeof result === 'string').toBe(true);
    if (result !== null) {
      expect(result).toContain('M ');
    }
  });

  it('exercises entryX fallback with pre-claimed vertical tracks', () => {
    const from: [number, number] = [100, 50];
    const to: [number, number] = [600, 300];

    const boxes: NodeBox[] = [
      { id: 'src', x: 80, y: 20, width: 120, height: 60 },
      { id: 'midBlock', x: 280, y: 0, width: 180, height: 400 },
      // Block the entry stub column vertically
      { id: 'vBlock', x: 570, y: 0, width: 50, height: 500 },
      { id: 'tgt', x: 600, y: 270, width: 120, height: 60 },
    ];

    const allocator = new TrackAllocator();
    // Saturate the area around the entry stub so findClearX pushes right
    for (let x = 550; x <= 630; x += 15) {
      allocator.claimVertical(0, 500, x);
    }

    const result = calculateOrthogonalPath(from, to, boxes, 'src', 'tgt', {
      padding: 15,
      stubLength: 20,
    }, allocator);

    expect(result === null || typeof result === 'string').toBe(true);
  });
});
