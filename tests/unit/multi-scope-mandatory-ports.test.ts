/**
 * Test mandatory scoped port generation for multi-scope nodes using per-port scope annotations.
 *
 * When scopes are declared via per-port `scope:name` annotations (not @scope tag),
 * syncSignatureToJSDoc should still auto-generate mandatory ports (start, success, failure)
 * for EACH scope.
 */

import { syncSignatureToJSDoc } from "../../src/jsdoc-port-sync";

// Multi-scope node with per-port annotations (no @scope tag)
const MULTI_SCOPE_PER_PORT = `/**
 * @flowWeaver nodeType
 * @label Execute String Function
 * @input success scope:b [order:-2] - Success
 * @input failure scope:b [order:-1] - Failure
 * @input aResult scope:a [order:0] - A Result
 * @input bResult scope:b [order:0] - B Result
 * @input execute [order:-1] - Execute
 * @output start scope:b [order:-1] - Start
 * @output a1 scope:a [order:0] - A1
 * @output b1 scope:b [order:0] - B1
 * @output result [order:0] - Result
 * @output onSuccess [order:-2] - On Success
 * @output onFailure [order:-1] - On Failure
 */
async function ExecuteStringFn(execute: boolean, a: (start: boolean, a1: string) => Promise<{ success: boolean; failure: boolean; aResult: string }>, b: (start: boolean, b1: number) => Promise<{ success: boolean; failure: boolean; bResult: string }>): Promise<{ onSuccess: boolean; onFailure: boolean; result: string | undefined }> {
  return { onSuccess: true, onFailure: false, result: undefined };
}`;

describe("Multi-scope mandatory ports (per-port scope annotations)", () => {
  it("generates start port for scope 'a' when missing", () => {
    const result = syncSignatureToJSDoc(MULTI_SCOPE_PER_PORT);
    expect(result).toContain("@output start scope:a");
  });

  it("generates success port for scope 'a' when missing", () => {
    const result = syncSignatureToJSDoc(MULTI_SCOPE_PER_PORT);
    expect(result).toContain("@input success scope:a");
  });

  it("generates failure port for scope 'a' when missing", () => {
    const result = syncSignatureToJSDoc(MULTI_SCOPE_PER_PORT);
    expect(result).toContain("@input failure scope:a");
  });

  it("preserves existing scope 'b' mandatory ports", () => {
    const result = syncSignatureToJSDoc(MULTI_SCOPE_PER_PORT);
    expect(result).toContain("@output start scope:b");
    expect(result).toContain("@input success scope:b");
    expect(result).toContain("@input failure scope:b");
  });

  it("preserves user-defined data ports for both scopes", () => {
    const result = syncSignatureToJSDoc(MULTI_SCOPE_PER_PORT);
    expect(result).toContain("@output a1 scope:a");
    expect(result).toContain("@output b1 scope:b");
    expect(result).toContain("@input aResult scope:a");
    expect(result).toContain("@input bResult scope:b");
  });

  it("does not duplicate mandatory ports for scope 'b'", () => {
    const result = syncSignatureToJSDoc(MULTI_SCOPE_PER_PORT);
    const startBMatches = result.match(/@output start scope:b/g);
    const successBMatches = result.match(/@input success scope:b/g);
    const failureBMatches = result.match(/@input failure scope:b/g);

    expect(startBMatches?.length).toBe(1);
    expect(successBMatches?.length).toBe(1);
    expect(failureBMatches?.length).toBe(1);
  });

  it("has exactly one of each mandatory port per scope", () => {
    const result = syncSignatureToJSDoc(MULTI_SCOPE_PER_PORT);

    for (const scope of ["a", "b"]) {
      const startMatches = result.match(new RegExp(`@output start scope:${scope}`, "g"));
      const successMatches = result.match(new RegExp(`@input success scope:${scope}`, "g"));
      const failureMatches = result.match(new RegExp(`@input failure scope:${scope}`, "g"));

      expect(startMatches?.length, `scope "${scope}" should have exactly 1 start`).toBe(1);
      expect(successMatches?.length, `scope "${scope}" should have exactly 1 success`).toBe(1);
      expect(failureMatches?.length, `scope "${scope}" should have exactly 1 failure`).toBe(1);
    }
  });

  it("works with a fresh node that has only data ports (no mandatory ports for any scope)", () => {
    const freshNode = `/**
 * @flowWeaver nodeType
 * @output a1 scope:a - A1
 * @output b1 scope:b - B1
 * @input aResult scope:a - A Result
 * @input bResult scope:b - B Result
 */
async function Fresh(execute: boolean, a: (start: boolean, a1: string) => Promise<{ success: boolean; failure: boolean; aResult: string }>, b: (start: boolean, b1: number) => Promise<{ success: boolean; failure: boolean; bResult: string }>): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncSignatureToJSDoc(freshNode);

    // Both scopes should get all 3 mandatory ports
    for (const scope of ["a", "b"]) {
      expect(result, `scope "${scope}" missing start`).toContain(`@output start scope:${scope}`);
      expect(result, `scope "${scope}" missing success`).toContain(`@input success scope:${scope}`);
      expect(result, `scope "${scope}" missing failure`).toContain(`@input failure scope:${scope}`);
    }
  });
});
