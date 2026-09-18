import { describe, it, expect } from 'vitest';
import { checkTypeCompatibilityFromStrings, isOpaqueObjectType } from '../../src/type-checker';

describe('opaque object types in string compatibility', () => {
  it('recognises the shapes that say nothing about structure', () => {
    for (const t of ['object', '{}', 'Record<string, unknown>', 'Record<string,any>', '{ [key: string]: unknown }']) {
      expect(isOpaqueObjectType(t)).toBe(true);
    }
    for (const t of ['AnalysisResult', 'Record<string, number>', 'string[]', 'unknown']) {
      expect(isOpaqueObjectType(t)).toBe(false);
    }
  });

  it('does not report a structural mismatch against an opaque object', () => {
    // The built-in waitForAgent declares `context: object`; a producer may be typed precisely
    expect(checkTypeCompatibilityFromStrings('{ path: string }', 'object').isCompatible).toBe(true);
    // ...and its `agentResult: object` feeds a consumer typed as a record
    expect(checkTypeCompatibilityFromStrings('object', 'Record<string, unknown>').isCompatible).toBe(true);
    expect(checkTypeCompatibilityFromStrings('Foo', 'unknown').isCompatible).toBe(true);
  });

  it('still reports a mismatch between two named shapes', () => {
    expect(checkTypeCompatibilityFromStrings('ValidationResult', 'RawLead').isCompatible).toBe(false);
    expect(checkTypeCompatibilityFromStrings('AnalysisResult | null', 'AnalysisResult').isCompatible).toBe(false);
  });
});
