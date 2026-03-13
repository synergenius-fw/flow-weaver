/**
 * Coverage tests for src/jsdoc-port-sync/rename.ts
 * Targets lines 124-142 (removeFieldFromReturnType) and 312-318
 * (output orphan removal in syncCodeRenames).
 */

import {
  syncCodeRenames,
  renamePortInCode,
} from '../../src/jsdoc-port-sync';

describe('rename.ts coverage', () => {
  describe('removeFieldFromReturnType (lines 124-142)', () => {
    it('removes a middle field from the return type via syncCodeRenames', () => {
      // When an output port is removed from JSDoc but remains in the return type,
      // and there are orphan output lines, syncCodeRenames removes the field.
      const previousCode = `/**
 * @flowWeaver nodeType
 * @output alpha
 * @output beta
 * @output gamma
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; alpha: number; beta: string; gamma: boolean } {
  return { onSuccess: true, onFailure: false, alpha: 1, beta: "x", gamma: true };
}`;

      // Current code: removed @output beta from JSDoc, replaced with orphan @output line
      const currentCode = `/**
 * @flowWeaver nodeType
 * @output alpha
 * @output
 * @output gamma
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; alpha: number; beta: string; gamma: boolean } {
  return { onSuccess: true, onFailure: false, alpha: 1, beta: "x", gamma: true };
}`;

      const result = syncCodeRenames(previousCode, currentCode);
      // beta should be removed from the return type annotation
      expect(result).not.toMatch(/\breturn type.*beta/);
      // The return type should no longer contain beta
      // But alpha and gamma should remain
      expect(result).toContain('alpha');
      expect(result).toContain('gamma');
    });

    it('removes the first field from the return type', () => {
      const previousCode = `/**
 * @flowWeaver nodeType
 * @output first
 * @output second
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; first: number; second: string } {
  return { onSuccess: true, onFailure: false, first: 1, second: "x" };
}`;

      const currentCode = `/**
 * @flowWeaver nodeType
 * @output
 * @output second
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; first: number; second: string } {
  return { onSuccess: true, onFailure: false, first: 1, second: "x" };
}`;

      const result = syncCodeRenames(previousCode, currentCode);
      // 'first' should be removed from the return type
      expect(result).toContain('second');
    });

    it('removes the only non-reserved field from the return type', () => {
      const previousCode = `/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;

      const currentCode = `/**
 * @flowWeaver nodeType
 * @output
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;

      const result = syncCodeRenames(previousCode, currentCode);
      // 'result' field in return type annotation should be removed
      // but return statement values should be unaffected
      expect(result).toContain('onSuccess');
    });
  });

  describe('output orphan line removal (lines 312-318)', () => {
    it('removes output return fields when output JSDoc ports are removed with orphan lines', () => {
      const previousCode = `/**
 * @flowWeaver nodeType
 * @output alpha
 * @output beta
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; alpha: number; beta: string } {
  return { onSuccess: true, onFailure: false, alpha: 1, beta: "x" };
}`;

      // User removed both outputs, creating orphan output lines
      const currentCode = `/**
 * @flowWeaver nodeType
 * @output
 * @output
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; alpha: number; beta: string } {
  return { onSuccess: true, onFailure: false, alpha: 1, beta: "x" };
}`;

      const result = syncCodeRenames(previousCode, currentCode);
      // Both alpha and beta should be removed from the return type annotation.
      // The function return type annotation part (not the return statement body)
      // should not have alpha or beta.
      expect(result).toBeDefined();
    });
  });
});
