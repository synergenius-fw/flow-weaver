/**
 * Tests for friendly error handler coverage.
 *
 * Ensures that the 8 new error codes have proper friendly error handlers,
 * and that existing handlers are not broken.
 */
import { describe, it, expect } from 'vitest';
import { getFriendlyError, type TFriendlyError } from '../../src/friendly-errors';

/** Helper: assert a friendly error has all required fields and is non-empty */
function expectValidFriendlyError(result: TFriendlyError | null, code: string) {
  expect(result).not.toBeNull();
  expect(result!.title).toBeTruthy();
  expect(result!.explanation).toBeTruthy();
  expect(result!.fix).toBeTruthy();
  expect(result!.code).toBe(code);
}

describe('friendly error handlers — new codes', () => {
  it('MUTABLE_NODE_TYPE_BINDING: explains let/var vs const', () => {
    const result = getFriendlyError({
      code: 'MUTABLE_NODE_TYPE_BINDING',
      message: 'Node type "processData" is declared with "let" instead of "const". Use "const" to prevent accidental reassignment.',
      node: 'processData',
    });
    expectValidFriendlyError(result, 'MUTABLE_NODE_TYPE_BINDING');
    expect(result!.explanation).toContain('processData');
    expect(result!.fix).toMatch(/const|function/i);
  });

  it('UNUSED_OUTPUT_PORT: shows port and node name', () => {
    const result = getFriendlyError({
      code: 'UNUSED_OUTPUT_PORT',
      message: 'Output port "debugInfo" of node "transformer" is never connected. Data will be discarded.',
      node: 'transformer',
    });
    expectValidFriendlyError(result, 'UNUSED_OUTPUT_PORT');
    expect(result!.explanation).toContain('debugInfo');
    expect(result!.explanation).toContain('transformer');
  });

  it('UNREACHABLE_EXIT_PORT: identifies the port', () => {
    const result = getFriendlyError({
      code: 'UNREACHABLE_EXIT_PORT',
      message: 'Exit port "errorMessage" has no incoming connection. Return value will be undefined.',
    });
    expectValidFriendlyError(result, 'UNREACHABLE_EXIT_PORT');
    expect(result!.explanation).toContain('errorMessage');
    expect(result!.fix).toMatch(/connect/i);
  });

  it('MULTIPLE_EXIT_CONNECTIONS: shows port and count', () => {
    const result = getFriendlyError({
      code: 'MULTIPLE_EXIT_CONNECTIONS',
      message: 'Exit port "result" has 3 incoming connections (a.out, b.out, c.out). Only one value will be used - consider using separate Exit ports.',
    });
    expectValidFriendlyError(result, 'MULTIPLE_EXIT_CONNECTIONS');
    expect(result!.explanation).toContain('result');
  });

  it('ANNOTATION_SIGNATURE_MISMATCH: explains optional mismatch', () => {
    const result = getFriendlyError({
      code: 'ANNOTATION_SIGNATURE_MISMATCH',
      message: 'Port "timeout" in node type "fetchData" is optional in signature but required in annotation. Consider using @input [timeout] to mark it optional.',
      node: 'fetchData',
    });
    expectValidFriendlyError(result, 'ANNOTATION_SIGNATURE_MISMATCH');
    expect(result!.explanation).toContain('timeout');
    expect(result!.explanation).toContain('fetchData');
    expect(result!.fix).toContain('@input [');
  });

  it('ANNOTATION_SIGNATURE_TYPE_MISMATCH: shows both types', () => {
    const result = getFriendlyError({
      code: 'ANNOTATION_SIGNATURE_TYPE_MISMATCH',
      message: 'Port "count" in node type "paginator" has type "STRING" in annotation but "NUMBER" in function signature.',
      node: 'paginator',
    });
    expectValidFriendlyError(result, 'ANNOTATION_SIGNATURE_TYPE_MISMATCH');
    expect(result!.explanation).toContain('count');
    expect(result!.explanation).toContain('paginator');
  });

  it('LOSSY_TYPE_COERCION: explains the conversion risk', () => {
    const result = getFriendlyError({
      code: 'LOSSY_TYPE_COERCION',
      message: 'Lossy type coercion from STRING to NUMBER in connection parser.text → calc.value. May result in NaN if string is not a valid number. Add @strictTypes to your workflow annotation to enforce type safety.',
    });
    expectValidFriendlyError(result, 'LOSSY_TYPE_COERCION');
    expect(result!.explanation).toMatch(/STRING|NUMBER/);
  });

  it('INVALID_EXIT_PORT_TYPE: explains STEP requirement', () => {
    const result = getFriendlyError({
      code: 'INVALID_EXIT_PORT_TYPE',
      message: "Exit port 'onSuccess' must be of type STEP (control flow), found: BOOLEAN",
    });
    expectValidFriendlyError(result, 'INVALID_EXIT_PORT_TYPE');
    expect(result!.explanation).toMatch(/STEP|control flow/i);
  });
});

describe('friendly error handlers — existing codes still work', () => {
  const existingCodes = [
    { code: 'MISSING_REQUIRED_INPUT', message: 'Node "adder" is missing required input "b"', node: 'adder' },
    { code: 'UNKNOWN_NODE_TYPE', message: 'Node "calc" references unknown type "calculator"', node: 'calc' },
    { code: 'UNKNOWN_SOURCE_NODE', message: 'Connection references node "missing" which does not exist' },
    { code: 'UNKNOWN_TARGET_NODE', message: 'Connection references node "missing" which does not exist' },
    { code: 'CYCLE_DETECTED', message: 'Circular dependency detected: a -> b -> a', node: 'a' },
    { code: 'UNUSED_NODE', message: 'Node "helper" is defined but never referenced', node: 'helper' },
    { code: 'NO_START_CONNECTIONS', message: 'No connections from Start node' },
    { code: 'NO_EXIT_CONNECTIONS', message: 'No connections to Exit node' },
    { code: 'DUPLICATE_NODE_NAME', message: 'Duplicate node type name "transform"', node: 'transform' },
  ];

  for (const error of existingCodes) {
    it(`${error.code} still produces a friendly error`, () => {
      const result = getFriendlyError(error);
      expectValidFriendlyError(result, error.code);
    });
  }
});

describe('friendly error handlers — edge cases', () => {
  it('unknown error code returns null (no crash)', () => {
    const result = getFriendlyError({
      code: 'TOTALLY_UNKNOWN_CODE',
      message: 'Something went wrong',
    });
    expect(result).toBeNull();
  });

  it('friendly error extracts quoted values from messages', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_NODE_TYPE',
      message: 'Node "myInstance" references unknown type "myNodeType"',
      node: 'myInstance',
    });
    expect(result).not.toBeNull();
    // Should extract "myNodeType" from the message
    expect(result!.explanation).toContain('myNodeType');
  });
});
