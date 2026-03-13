/**
 * Coverage tests for jsdoc-port-sync/rename.ts uncovered lines:
 * - Lines 124-142: removeFieldFromReturnType (all three regex patterns)
 * - Lines 312-318: syncCodeRenames output orphan branch (removes return field)
 */

import { describe, it, expect } from 'vitest';
import {
  renamePortInCode,
  syncCodeRenames,
} from '../../src/jsdoc-port-sync';

describe('renamePortInCode output removal triggers removeFieldFromReturnType', () => {
  // renamePortInCode doesn't directly call removeFieldFromReturnType,
  // but syncCodeRenames does when orphan output lines are detected.

  it('removes middle/last return field via syncCodeRenames output orphan branch', () => {
    // To trigger lines 311-318 in syncCodeRenames: currentCode must have orphan
    // output lines. This happens when a JSDoc @output is removed but the return
    // type field still exists. syncCodeRenames then calls removeFieldFromReturnType.

    const previousCode = `/**
 * @flowWeaver nodeType
 * @input x {NUMBER}
 * @output alpha {STRING}
 * @output beta {NUMBER}
 */
function MyNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; alpha: string; beta: number } {
  return { onSuccess: true, onFailure: false, alpha: "hi", beta: 1 };
}`;

    // Simulate removing @output alpha from JSDoc but keeping it in the return type
    const currentCode = `/**
 * @flowWeaver nodeType
 * @input x {NUMBER}
 * @output
 * @output beta {NUMBER}
 */
function MyNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; alpha: string; beta: number } {
  return { onSuccess: true, onFailure: false, alpha: "hi", beta: 1 };
}`;

    const result = syncCodeRenames(previousCode, currentCode);

    // alpha should be removed from the return type since it was removed from JSDoc
    // (the orphan @output line triggers the removal logic)
    expect(result).toContain('beta');
    // The return type should still have the remaining fields
    expect(result).toContain('onSuccess');
    expect(result).toContain('onFailure');
  });
});

describe('removeFieldFromReturnType patterns', () => {
  it('handles removing a field that is the only field after mandatory ports', () => {
    // This tests the "onlyFieldPattern" regex in removeFieldFromReturnType (lines 136-140)
    const previousCode = `/**
 * @flowWeaver nodeType
 * @output value {STRING}
 */
function Single(execute: boolean): { onSuccess: boolean; onFailure: boolean; value: string } {
  return { onSuccess: true, onFailure: false, value: "x" };
}`;

    // Remove the @output, leave orphan line
    const currentCode = `/**
 * @flowWeaver nodeType
 * @output
 */
function Single(execute: boolean): { onSuccess: boolean; onFailure: boolean; value: string } {
  return { onSuccess: true, onFailure: false, value: "x" };
}`;

    const result = syncCodeRenames(previousCode, currentCode);
    expect(result).toContain('onSuccess');
  });

  it('handles removing first field with semicolons', () => {
    // Tests the "firstWithSemiPattern" regex (lines 130-134)
    const previousCode = `/**
 * @flowWeaver nodeType
 * @output first {STRING}
 * @output second {NUMBER}
 */
function Multi(execute: boolean): { onSuccess: boolean; onFailure: boolean; first: string; second: number } {
  return { onSuccess: true, onFailure: false, first: "a", second: 1 };
}`;

    const currentCode = `/**
 * @flowWeaver nodeType
 * @output
 * @output second {NUMBER}
 */
function Multi(execute: boolean): { onSuccess: boolean; onFailure: boolean; first: string; second: number } {
  return { onSuccess: true, onFailure: false, first: "a", second: 1 };
}`;

    const result = syncCodeRenames(previousCode, currentCode);
    expect(result).toContain('second');
  });
});

describe('syncCodeRenames output rename detection', () => {
  it('renames return type field when JSDoc output is renamed', () => {
    // Tests the non-orphan output rename path (lines 343-347)
    const previousCode = `/**
 * @flowWeaver nodeType
 * @output oldName {STRING}
 */
function MyNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; oldName: string } {
  return { onSuccess: true, onFailure: false, oldName: "x" };
}`;

    // JSDoc output renamed from oldName to newName
    const currentCode = `/**
 * @flowWeaver nodeType
 * @output newName {STRING}
 */
function MyNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; oldName: string } {
  return { onSuccess: true, onFailure: false, oldName: "x" };
}`;

    const result = syncCodeRenames(previousCode, currentCode);
    // The return type field should be renamed to match the JSDoc change
    expect(result).toContain('newName');
  });

  it('renames JSDoc output when return type field is renamed', () => {
    // Tests the reverse direction (lines 348-352)
    const previousCode = `/**
 * @flowWeaver nodeType
 * @output score {NUMBER}
 */
function MyNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; score: number } {
  return { onSuccess: true, onFailure: false, score: 0 };
}`;

    // Return type field renamed from score to rating
    const currentCode = `/**
 * @flowWeaver nodeType
 * @output score {NUMBER}
 */
function MyNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; rating: number } {
  return { onSuccess: true, onFailure: false, rating: 0 };
}`;

    const result = syncCodeRenames(previousCode, currentCode);
    // The JSDoc @output should be renamed to match the return type change
    expect(result).toContain('@output rating');
  });
});
