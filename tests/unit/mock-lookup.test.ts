/**
 * Mock lookup: a node's own answer wins over a shared one, and a node can be
 * given an answer for whatever key it asks with (`node:*`) -- the console
 * mocks by node, since event names and agent ids are often computed at run
 * time.
 */
import { describe, it, expect } from 'vitest';
import { lookupMock } from '../../src/built-in-nodes/mock-types';
import type { NodeExecutionRuntime } from '../../src/runtime/durable-execution';

const rt = (nodeId: string) => ({ nodeId } as unknown as NodeExecutionRuntime);

describe('lookupMock', () => {
  const section = { 'link:figma/ready': 'own', 'link:*': 'any-for-link', 'figma/ready': 'shared' };

  it('prefers the node-qualified key, then the node wildcard, then the plain key', () => {
    expect(lookupMock(section, 'figma/ready', rt('link'))).toBe('own');
    expect(lookupMock(section, 'something/else', rt('link'))).toBe('any-for-link');
    expect(lookupMock(section, 'figma/ready', rt('other'))).toBe('shared');
    expect(lookupMock(section, 'nothing', rt('other'))).toBeUndefined();
  });

  it('ignores node keys without a runtime, and is quiet without a section', () => {
    expect(lookupMock(section, 'figma/ready')).toBe('shared');
    expect(lookupMock(section, 'anything')).toBeUndefined();
    expect(lookupMock(undefined, 'x', rt('link'))).toBeUndefined();
  });
});
