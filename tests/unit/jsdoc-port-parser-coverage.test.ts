/**
 * Coverage tests for src/jsdoc-port-sync/port-parser.ts
 * Targets lines 521-522 (orphan output line reuse with type mismatch),
 * line 609 (fallback insertIndex for new input), and line 661 (parseDefaultValue non-JSON).
 */

import {
  parsePortsFromFunctionText,
  updatePortsInFunctionText,
} from '../../src/jsdoc-port-sync';

describe('port-parser coverage', () => {
  it('reuses orphan output line when type does not match (fallback path)', () => {
    // JSDoc has an orphan @output line (tag without port name).
    // Updating with a new NUMBER output should reuse the orphan line
    // even though orphan.type is "ANY" and port.dataType is "NUMBER".
    const code = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output
 */
function myNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: x };
}
`;

    const result = updatePortsInFunctionText(
      code,
      { x: { dataType: 'NUMBER' } },
      { result: { dataType: 'NUMBER' } }
    );

    // The orphan @output line should be replaced with the actual output
    expect(result).toContain('@output result');
    // Should not have a bare @output line anymore
    const outputLines = result.split('\n').filter(l => l.includes('@output'));
    expect(outputLines).toHaveLength(1);
    expect(outputLines[0]).toContain('result');
  });

  it('falls back insertIndex when signatureInputOrder has no existing anchors', () => {
    // Provide signatureInputOrder with a name that's being added,
    // but no existing inputs in JSDoc to anchor against.
    // This forces the fallback at line 603-604.
    const code = `
/**
 * @flowWeaver nodeType
 */
function myNode(execute: boolean, alpha: number, beta: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;

    // No existing inputs in JSDoc, adding two new inputs with signatureInputOrder
    const result = updatePortsInFunctionText(
      code,
      {
        alpha: { dataType: 'NUMBER' },
        beta: { dataType: 'STRING' },
      },
      {},
      ['alpha', 'beta'] // signatureInputOrder
    );

    expect(result).toContain('@input alpha');
    expect(result).toContain('@input beta');
    // Inputs should be after @flowWeaver
    const lines = result.split('\n');
    const fwIndex = lines.findIndex(l => l.includes('@flowWeaver'));
    const alphaIndex = lines.findIndex(l => l.includes('@input alpha'));
    expect(alphaIndex).toBeGreaterThan(fwIndex);
  });

  it('parses non-JSON default value as string (parseDefaultValue fallback)', () => {
    // @input [mode=fast] where "fast" is not valid JSON
    const code = `
/**
 * @flowWeaver nodeType
 * @input [mode=fast]
 */
function myNode(execute: boolean, mode?: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;

    const result = parsePortsFromFunctionText(code);
    expect(result.inputs.mode).toBeDefined();
    expect(result.inputs.mode.optional).toBe(true);
    // "fast" is not valid JSON, so parseDefaultValue returns it as-is
    expect(result.inputs.mode.default).toBe('fast');
  });
});
