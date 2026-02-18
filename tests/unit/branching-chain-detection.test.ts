import { describe, it, expect } from 'vitest';
import { detectBranchingChains } from '../../src/generator/control-flow';

/**
 * Tests for chain detection logic — written before implementation.
 * detectBranchingChains identifies sequential chains of branching nodes
 * where each node's success region has exactly one branching child
 * and the failure region has zero (or vice versa).
 */

describe('detectBranchingChains', () => {
  it('should detect a linear success chain A→B→C', () => {
    const branchingNodes = new Set(['A', 'B', 'C']);
    const branchRegions = new Map([
      ['A', { successNodes: new Set(['B']), failureNodes: new Set(['errA']) }],
      ['B', { successNodes: new Set(['C']), failureNodes: new Set(['errB']) }],
      ['C', { successNodes: new Set(['done']), failureNodes: new Set(['errC']) }],
    ]);

    const chains = detectBranchingChains(branchingNodes, branchRegions);
    expect(chains.size).toBe(1);

    // Chain should start at A and include A, B, C in order
    const chain = chains.get('A');
    expect(chain).toBeDefined();
    expect(chain).toEqual(['A', 'B', 'C']);
  });

  it('should return empty map for a single branching node (no chain)', () => {
    const branchingNodes = new Set(['A']);
    const branchRegions = new Map([
      ['A', { successNodes: new Set(['ok']), failureNodes: new Set(['err']) }],
    ]);

    const chains = detectBranchingChains(branchingNodes, branchRegions);
    expect(chains.size).toBe(0);
  });

  it('should not detect a chain when both branches have branching children (true tree)', () => {
    const branchingNodes = new Set(['A', 'B', 'C']);
    const branchRegions = new Map([
      ['A', { successNodes: new Set(['B']), failureNodes: new Set(['C']) }],
      ['B', { successNodes: new Set(['done1']), failureNodes: new Set(['err1']) }],
      ['C', { successNodes: new Set(['done2']), failureNodes: new Set(['err2']) }],
    ]);

    const chains = detectBranchingChains(branchingNodes, branchRegions);
    expect(chains.size).toBe(0);
  });

  it('should detect chain of 2 in a mixed topology', () => {
    // A→B is a chain (success), C is standalone
    const branchingNodes = new Set(['A', 'B', 'C']);
    const branchRegions = new Map([
      ['A', { successNodes: new Set(['B']), failureNodes: new Set(['err']) }],
      ['B', { successNodes: new Set(['done']), failureNodes: new Set(['err2']) }],
      ['C', { successNodes: new Set(['ok']), failureNodes: new Set(['fail']) }],
    ]);

    const chains = detectBranchingChains(branchingNodes, branchRegions);
    expect(chains.size).toBe(1);
    expect(chains.get('A')).toEqual(['A', 'B']);
    // C should not be in any chain
    expect(chains.has('C')).toBe(false);
  });

  it('should detect a failure-direction chain', () => {
    // A's failure leads to B, success has no branching child
    const branchingNodes = new Set(['A', 'B']);
    const branchRegions = new Map([
      ['A', { successNodes: new Set(['ok']), failureNodes: new Set(['B']) }],
      ['B', { successNodes: new Set(['done']), failureNodes: new Set(['err']) }],
    ]);

    const chains = detectBranchingChains(branchingNodes, branchRegions);
    expect(chains.size).toBe(1);
    expect(chains.get('A')).toEqual(['A', 'B']);
  });

  it('should not include a node as chain head if it is already a chain member', () => {
    // A→B→C: B and C are members, not heads
    const branchingNodes = new Set(['A', 'B', 'C']);
    const branchRegions = new Map([
      ['A', { successNodes: new Set(['B']), failureNodes: new Set(['errA']) }],
      ['B', { successNodes: new Set(['C']), failureNodes: new Set(['errB']) }],
      ['C', { successNodes: new Set(['done']), failureNodes: new Set(['errC']) }],
    ]);

    const chains = detectBranchingChains(branchingNodes, branchRegions);
    // Only one chain starting at A
    expect(chains.size).toBe(1);
    expect(chains.has('A')).toBe(true);
    expect(chains.has('B')).toBe(false);
    expect(chains.has('C')).toBe(false);
  });
});
