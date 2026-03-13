/**
 * Additional coverage tests for jsdoc-port-sync/sync.ts
 * Targets uncovered lines: 664-665 (declaration callback push),
 * 681-735 (arrow callback branch), 745-750 (parseDefaultValue).
 */

import {
  syncSignatureToJSDoc,
  syncJSDocToSignature,
} from "../../src/jsdoc-port-sync";

describe("syncJSDocToSignature - callback in declaration without existing callback param", () => {
  it("adds a new callback parameter when none exists in a function declaration", () => {
    // This triggers the else branch at line 664-665: callbackIndex < 0 for declaration type
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 * @input success scope:iteration
 */
function forEach(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncJSDocToSignature(code);
    // Should have added the "iteration" callback parameter
    expect(result).toContain("iteration:");
    expect(result).toContain("=>");
  });

  it("adds callback with multiple scoped params and returns in declaration", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope loop
 * @output value scope:loop
 * @output index scope:loop
 * @input done scope:loop
 */
function mapItems(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncJSDocToSignature(code);
    expect(result).toContain("loop:");
    expect(result).toContain("value");
    expect(result).toContain("index");
    expect(result).toContain("=>");
  });
});

describe("syncJSDocToSignature - arrow function callback handling", () => {
  it("adds a new callback parameter to an arrow function with no existing callback", () => {
    // Triggers the arrow branch (line 681+) with callbackIndex < 0 (lines 718-720)
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 * @input success scope:iteration
 */
const forEach = (execute: boolean) => {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncJSDocToSignature(code);
    expect(result).toContain("iteration:");
    expect(result).toContain("=>");
    expect(result).toContain("const forEach");
  });

  it("updates an existing callback parameter in an arrow function", () => {
    // Triggers arrow branch (line 681+) with callbackIndex >= 0 (lines 711-717)
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 * @output index scope:iteration
 * @input success scope:iteration
 */
const forEach = (execute: boolean, iteration: (item: any) => { success: boolean }) => {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncJSDocToSignature(code);
    expect(result).toContain("iteration:");
    expect(result).toContain("index");
    expect(result).toContain("=>");
    expect(result).toContain("const forEach");
  });

  it("returns arrow function unchanged when callback already has all ports", () => {
    // Triggers the early return at line 698-700
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 * @input success scope:iteration
 */
const forEach = (execute: boolean, iteration: (item: any) => { success: boolean }) => {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncJSDocToSignature(code);
    expect(result).toContain("const forEach");
    expect(result).toContain("iteration:");
  });

  it("handles arrow function with multiline params and callback update", () => {
    // Triggers lines 723-731 (multiline branch in arrow)
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 * @output index scope:iteration
 * @input success scope:iteration
 */
const forEach = (
  execute: boolean,
  iteration: (item: any) => { success: boolean }
) => {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncJSDocToSignature(code);
    expect(result).toContain("const forEach");
    expect(result).toContain("iteration:");
  });
});

describe("syncSignatureToJSDoc - parseDefaultValue coverage", () => {
  it("parses a JSON-parseable default value (number)", () => {
    // parseDefaultValue is called when a param exists in signature but NOT in JSDoc.
    // No @input tag for "count", so syncSignatureToJSDoc creates one from the signature.
    const code = `/**
 * @flowWeaver nodeType
 */
function process(execute: boolean, count: number = 42): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("[count=42]");
  });

  it("parses a JSON-parseable default value (string)", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function process(execute: boolean, name: string = "hello"): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("name=");
    expect(result).toContain("hello");
  });

  it("falls through to raw string for non-JSON default", () => {
    // parseDefaultValue catches JSON.parse error and returns the raw string.
    const code = `/**
 * @flowWeaver nodeType
 */
function process(execute: boolean, mode: string = SomeEnum.Value): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncSignatureToJSDoc(code);
    // parseDefaultValue returns the raw string since JSON.parse fails,
    // but updatePortsInFunctionText serializes it with quotes around the string value.
    expect(result).toContain("mode=");
    expect(result).toContain("SomeEnum.Value");
  });

  it("parses a boolean default value", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function process(execute: boolean, enabled: boolean = false): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;

    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("[enabled=false]");
  });
});
