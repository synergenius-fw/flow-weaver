/**
 * Coverage for constants.ts:
 * - Line 108: isSpecialNode (calls isStartNode || isExitNode)
 * - Line 158: isScopedPort (FUNCTION type with scope attribute)
 */
import { describe, it, expect } from 'vitest';
import { isSpecialNode, isScopedPort } from '../../src/constants';

describe('isSpecialNode', () => {
  it('returns true for Start', () => {
    expect(isSpecialNode('Start')).toBe(true);
  });

  it('returns true for Exit', () => {
    expect(isSpecialNode('Exit')).toBe(true);
  });

  it('returns false for regular node names', () => {
    expect(isSpecialNode('myProcessor')).toBe(false);
  });

  it('returns false for similar names that are not exact matches', () => {
    expect(isSpecialNode('start')).toBe(false);
    expect(isSpecialNode('exit')).toBe(false);
  });
});

describe('isScopedPort', () => {
  it('returns true for FUNCTION type port with a scope', () => {
    expect(isScopedPort({ dataType: 'FUNCTION', scope: 'processItem' })).toBe(true);
  });

  it('returns false for FUNCTION type without scope', () => {
    expect(isScopedPort({ dataType: 'FUNCTION' })).toBe(false);
  });

  it('returns false for non-FUNCTION type with scope', () => {
    expect(isScopedPort({ dataType: 'STRING', scope: 'myScope' })).toBe(false);
  });

  it('returns false for non-FUNCTION type without scope', () => {
    expect(isScopedPort({ dataType: 'NUMBER' })).toBe(false);
  });
});
