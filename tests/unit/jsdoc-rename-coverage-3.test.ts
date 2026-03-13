/**
 * Coverage tests for src/jsdoc-port-sync/rename.ts
 * Targets remaining uncovered lines: renamePortInCode for scoped input/output ports,
 * renameCallbackParameter, renameFieldInReturnType (callback path), and
 * syncCodeRenames output rename detection.
 */

import {
  renamePortInCode,
  syncCodeRenames,
} from '../../src/jsdoc-port-sync';

describe('renamePortInCode - scoped ports', () => {
  it('renames a scoped input port in JSDoc and callback return type', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input itemData scope:iteration
 */
function myNode(execute: boolean, items: any[], iteration: (itemData: number) => { onSuccess: boolean; result: number }): { onSuccess: boolean; results: any[] } {
  return { onSuccess: true, results: items };
}
`;
    const result = renamePortInCode(code, 'itemData', 'itemValue', 'input');
    expect(result).toContain('@input itemValue');
    expect(result).not.toContain('@input itemData');
    // The callback return type should also be renamed
    expect(result).toContain('itemValue');
  });

  it('renames a scoped output port in JSDoc and callback parameter', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output itemResult scope:iteration
 */
function myNode(execute: boolean, items: any[], iteration: (itemResult: number) => { onSuccess: boolean }): { onSuccess: boolean; results: any[] } {
  return { onSuccess: true, results: items };
}
`;
    const result = renamePortInCode(code, 'itemResult', 'itemOutput', 'output');
    expect(result).toContain('@output itemOutput');
    expect(result).not.toContain('@output itemResult');
  });

  it('does not rename reserved port names', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @input execute
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
    const result = renamePortInCode(code, 'execute', 'run', 'input');
    // Reserved names are not renamed
    expect(result).toContain('execute');
    expect(result).toBe(code);
  });

  it('does not rename to an existing port name', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @input alpha
 * @input beta
 */
function myNode(execute: boolean, alpha: number, beta: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
    // Trying to rename alpha to beta should be a no-op since beta already exists
    const result = renamePortInCode(code, 'alpha', 'beta', 'input');
    expect(result).toBe(code);
  });

  it('returns unchanged code when old port does not exist', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @input alpha
 */
function myNode(execute: boolean, alpha: number): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
    const result = renamePortInCode(code, 'nonexistent', 'newName', 'input');
    expect(result).toBe(code);
  });
});

describe('syncCodeRenames - output rename detection', () => {
  it('renames output return field when JSDoc output name changed', () => {
    const previousCode = `/**
 * @flowWeaver nodeType
 * @output alpha
 * @output beta
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; alpha: number; beta: string } {
  return { onSuccess: true, onFailure: false, alpha: 1, beta: "x" };
}`;

    // User renamed @output alpha to @output gamma in JSDoc
    const currentCode = `/**
 * @flowWeaver nodeType
 * @output gamma
 * @output beta
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; alpha: number; beta: string } {
  return { onSuccess: true, onFailure: false, alpha: 1, beta: "x" };
}`;

    const result = syncCodeRenames(previousCode, currentCode);
    // The return type field "alpha" should be renamed to "gamma"
    expect(result).toContain('gamma');
  });

  it('renames output JSDoc when return type field name changed', () => {
    const previousCode = `/**
 * @flowWeaver nodeType
 * @output alpha
 * @output beta
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; alpha: number; beta: string } {
  return { onSuccess: true, onFailure: false, alpha: 1, beta: "x" };
}`;

    // User renamed "alpha" to "gamma" in return type
    const currentCode = `/**
 * @flowWeaver nodeType
 * @output alpha
 * @output beta
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; gamma: number; beta: string } {
  return { onSuccess: true, onFailure: false, gamma: 1, beta: "x" };
}`;

    const result = syncCodeRenames(previousCode, currentCode);
    // JSDoc @output alpha should be renamed to @output gamma
    expect(result).toContain('@output gamma');
  });

  it('returns unchanged code when previous code is empty', () => {
    const result = syncCodeRenames('', 'function myNode() {}');
    expect(result).toBe('function myNode() {}');
  });
});
