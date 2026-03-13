/**
 * Coverage tests for jsdoc-port-sync/port-parser.ts uncovered lines:
 * - Lines 521-522: orphan output lines reused when type doesn't match
 * - Line 609: existingInputLineIndices update in else branch
 * - Line 661: parseDefaultValue catch (non-JSON string)
 */

import { describe, it, expect } from 'vitest';
import {
  updatePortsInFunctionText,
  parsePortsFromFunctionText,
} from '../../src/jsdoc-port-sync';

describe('updatePortsInFunctionText orphan output reuse', () => {
  it('reuses orphan output line when type does not match (falls through to shift)', () => {
    // To hit lines 521-522: we need an orphan @output line (just the tag, no name)
    // plus an output port to add whose type doesn't match the orphan's type (which is 'ANY').
    // Since orphans have type 'ANY' and we look for o.type === port.dataType,
    // and dataType would be e.g. 'NUMBER', the findIndex returns -1 but orphanOutputLines
    // is non-empty, so it falls through to the shift() branch (lines 521-522).
    const code = `/**
 * @flowWeaver nodeType
 * @output
 */
function MyNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;

    const result = updatePortsInFunctionText(
      code,
      {},
      { result: { dataType: 'NUMBER' } },
    );

    // The orphan @output line should be replaced with the actual port tag
    expect(result).toContain('@output result');
    expect(result).toContain('NUMBER');
  });

  it('adds output to remainingOutputsToAdd when no orphans exist', () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function MyNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; total: number } {
  return { onSuccess: true, onFailure: false, total: 0 };
}`;

    const result = updatePortsInFunctionText(
      code,
      {},
      { total: { dataType: 'NUMBER' } },
    );

    expect(result).toContain('@output total');
  });
});

describe('updatePortsInFunctionText input insertion with signatureInputOrder', () => {
  it('inserts new input at correct position using else branch of signature ordering', () => {
    // To hit line 609: we need signatureInputOrder, a new non-scoped input to add,
    // where the "look forward" for a successor fails (insertIndex === -1 from the
    // first loop) so it falls into the else branch (line 596) that looks backwards
    // for a predecessor. The predecessor exists, so insertIndex !== -1 and we
    // do the splice + update existingInputLineIndices (line 609).
    const code = `/**
 * @flowWeaver nodeType
 * @input alpha {STRING}
 * @input gamma {STRING}
 */
function MyNode(execute: boolean, alpha: string, beta: string, gamma: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = updatePortsInFunctionText(
      code,
      {
        alpha: { dataType: 'STRING' },
        beta: { dataType: 'STRING' },
        gamma: { dataType: 'STRING' },
      },
      {},
      ['alpha', 'beta', 'gamma'],
    );

    // beta should be inserted between alpha and gamma
    expect(result).toContain('@input beta');
    const lines = result.split('\n');
    const alphaIdx = lines.findIndex(l => l.includes('@input alpha'));
    const betaIdx = lines.findIndex(l => l.includes('@input beta'));
    const gammaIdx = lines.findIndex(l => l.includes('@input gamma'));
    expect(alphaIdx).toBeLessThan(betaIdx);
    expect(betaIdx).toBeLessThan(gammaIdx);
  });
});

describe('parsePortsFromFunctionText parseDefaultValue fallback', () => {
  it('returns non-JSON default value as string', () => {
    // The parseDefaultValue function at line 657-663 has a catch branch
    // for non-JSON values. A default like "hello world" is not valid JSON.
    const code = `/**
 * @flowWeaver nodeType
 * @input [name="hello world"] {STRING}
 */
function Greeter(execute: boolean, name: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = parsePortsFromFunctionText(code);
    expect(result.inputs.name).toBeDefined();
    expect(result.inputs.name.defaultValue).toBe('hello world');
  });

  it('parses valid JSON default value', () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input [count=42] {NUMBER}
 */
function Counter(execute: boolean, count: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = parsePortsFromFunctionText(code);
    expect(result.inputs.count).toBeDefined();
    expect(result.inputs.count.defaultValue).toBe(42);
  });
});
