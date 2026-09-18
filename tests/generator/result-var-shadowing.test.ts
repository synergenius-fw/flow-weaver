/**
 * A node's result local must never shadow the function it calls.
 *
 * The generator names the local `<nodeId>Result`. When a node's id plus
 * "Result" happens to equal its node type name -- `@node rec recResult` --
 * that emits `const recResult = recResult(...)`, whose `const` puts the
 * callee in the temporal dead zone. The workflow then throws
 * "Cannot access 'recResult' before initialization" at run time, with nothing
 * wrong in the author's source.
 */

import { describe, it, expect } from 'vitest';
import { nodeResultVar } from '../../src/generator/code-utils';

describe('nodeResultVar', () => {
  it('uses the plain <nodeId>Result name when there is no collision', () => {
    expect(nodeResultVar('rec', 'recordOutcome')).toBe('recResult');
    expect(nodeResultVar('record', 'recordResult')).toBe('recordResult_');
  });

  it('avoids shadowing when <nodeId>Result equals the callee', () => {
    // `@node rec recResult` -> would emit `const recResult = recResult(...)`
    expect(nodeResultVar('rec', 'recResult')).toBe('recResult_');
    expect(nodeResultVar('rec', 'recResult')).not.toBe('recResult');
  });

  it('is stable for ordinary names', () => {
    for (const [id, fn] of [
      ['audit', 'frameAudit'],
      ['diff', 'diffAgainstLibrary'],
      ['a', 'b'],
    ] as const) {
      expect(nodeResultVar(id, fn)).toBe(`${id}Result`);
    }
  });
});
