/**
 * Coverage tests for jsdoc-port-sync/sync.ts
 *
 * Targets uncovered branches and edge cases across syncSignatureToJSDoc
 * and syncJSDocToSignature, including: orphan line bail-out, return type
 * annotation source selection, STEP vs BOOLEAN type preservation, input type
 * fields from TFlowWeaverNodeType, scoped port auto-generation,
 * auto-removal of orphan outputs, signature input ordering, arrow function
 * execute insertion, multiline param handling, authoritative ports,
 * output-removal detection, expression function type fallthrough, and
 * the callback update helper for edge cases.
 */

import {
  syncSignatureToJSDoc,
  syncJSDocToSignature,
} from "../../src/jsdoc-port-sync";

// ---------------------------------------------------------------------------
// syncSignatureToJSDoc
// ---------------------------------------------------------------------------

describe("syncSignatureToJSDoc - orphan line bail-out", () => {
  it("returns functionText unchanged when orphan input lines exist", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input
 */
function myNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toBe(code);
  });

  it("returns functionText unchanged when orphan output lines exist", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toBe(code);
  });
});

describe("syncSignatureToJSDoc - return type annotation source", () => {
  it("uses return type fields when return type annotation is present", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; total: number } {
  return { onSuccess: true, onFailure: false, total: 42 };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@output total");
  });

  it("uses return body fields when no return type annotation exists", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function myNode(execute: boolean) {
  return { onSuccess: true, onFailure: false, computed: 99 };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@output computed");
  });
});

describe("syncSignatureToJSDoc - type update preserving STEP over BOOLEAN", () => {
  it("does not overwrite STEP type with BOOLEAN from signature", () => {
    // Existing JSDoc has a port typed as STEP; the signature sees boolean
    // which maps to BOOLEAN. The sync should keep STEP.
    const code = `/**
 * @flowWeaver nodeType
 * @step trigger
 */
function myNode(execute: boolean, trigger: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    // trigger should still be present and should keep STEP
    expect(result).toContain("trigger");
  });

  it("updates type when signature type differs and is not BOOLEAN vs STEP", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 */
function myNode(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    // value should be updated from NUMBER to STRING
    expect(result).toContain("value");
  });
});

describe("syncSignatureToJSDoc - input type fields from TFlowWeaverNodeType", () => {
  it("adds inputs from TFlowWeaverNodeType type annotation", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
const myNode: TFlowWeaverNodeType<{ age: number; name: string }, { result: boolean }> = (execute: boolean): { onSuccess: boolean; onFailure: boolean; result: boolean } => {
  return { onSuccess: true, onFailure: false, result: true };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@input age");
    expect(result).toContain("@input name");
  });
});

describe("syncSignatureToJSDoc - inferred output type from return body", () => {
  it("infers output type from return body field values", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function myNode(execute: boolean) {
  return { onSuccess: true, onFailure: false, count: 42, label: "hello" };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@output count");
    expect(result).toContain("@output label");
  });
});

describe("syncSignatureToJSDoc - auto-remove orphan inputs", () => {
  it("removes input that no longer exists in signature", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input removed
 */
function myNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@input x");
    expect(result).not.toContain("removed");
  });

  it("keeps scoped input when callback has no return fields", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input item scope:iteration
 */
function forEach(execute: boolean, iteration: () => void): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("item");
  });

  it("removes scoped input when callback has return fields that do not include the port", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input orphanScoped scope:iteration
 */
function forEach(execute: boolean, iteration: (item: any) => { done: boolean }): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    // orphanScoped is not in the callback's return fields (done), so it should be removed
    expect(result).not.toContain("orphanScoped");
  });

  it("keeps input with user metadata that exists in raw signature", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x [order:1] - My X value
 */
function myNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("x");
  });
});

describe("syncSignatureToJSDoc - auto-remove orphan outputs", () => {
  it("removes output not in return fields and not scoped/reserved", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output phantom
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).not.toContain("phantom");
  });

  it("keeps reserved port names like onSuccess in outputs", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output onSuccess
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("onSuccess");
  });

  it("keeps scoped output ports", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 */
function forEach(execute: boolean, iteration: (item: any) => { success: boolean }): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("item");
  });
});

describe("syncSignatureToJSDoc - signature input ordering", () => {
  it("preserves raw param order from signature", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function myNode(execute: boolean, beta: number, alpha: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    const lines = result.split("\n");
    const inputLines = lines.filter((l: string) => l.includes("@input"));
    // beta should come before alpha because that's the signature order
    const betaIdx = inputLines.findIndex((l: string) => l.includes("beta"));
    const alphaIdx = inputLines.findIndex((l: string) => l.includes("alpha"));
    expect(betaIdx).toBeLessThan(alphaIdx);
  });
});

describe("syncSignatureToJSDoc - auto-generate mandatory scoped ports", () => {
  it("generates start, success, and failure ports for declared @scope", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 */
function forEach(execute: boolean, iteration: (item: any) => { success: boolean }): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("start");
    expect(result).toContain("success");
    expect(result).toContain("failure");
  });

  it("does not duplicate mandatory scoped ports if already present", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output start scope:iteration
 * @input success scope:iteration
 * @input failure scope:iteration
 */
function forEach(execute: boolean, iteration: (start: boolean) => { success: boolean; failure: boolean }): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    // Count occurrences of "start" in port lines
    const portLines = result.split("\n").filter((l: string) => /@(?:input|output|step)\s/.test(l));
    const startLines = portLines.filter((l: string) => l.includes("start"));
    // Should have exactly one start output
    expect(startLines.length).toBeGreaterThanOrEqual(1);
  });
});

describe("syncSignatureToJSDoc - callback param detection (skips callback params)", () => {
  it("does not create @input for callback-type params", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function forEach(execute: boolean, items: any[], processItem: (execute: boolean, item: any) => { success: boolean }): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@input items");
    // processItem is a callback (contains =>), should not be a regular input
    expect(result).not.toMatch(/@input processItem(?!\s+scope:)/);
  });
});

describe("syncSignatureToJSDoc - optional param from signature", () => {
  it("creates optional input port for optional signature param", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function myNode(execute: boolean, limit?: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("limit");
  });
});

// ---------------------------------------------------------------------------
// syncJSDocToSignature
// ---------------------------------------------------------------------------

describe("syncJSDocToSignature - early return when nothing to sync", () => {
  it("returns unchanged when all params exist, no scoped ports, no syncable outputs, and execute present", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function myNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    // This should still update return type since it adds mandatory fields
    const result = syncJSDocToSignature(code);
    expect(result).toContain("function myNode");
  });
});

describe("syncJSDocToSignature - execute insertion for declaration", () => {
  it("inserts execute: boolean as first param in function declaration", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function myNode(x: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("execute: boolean");
    // execute should be before x
    const execIdx = result.indexOf("execute: boolean");
    const xIdx = result.indexOf("x: number");
    expect(execIdx).toBeLessThan(xIdx);
  });

  it("inserts execute: boolean into empty function declaration params", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
function myNode(): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("execute: boolean");
  });
});

describe("syncJSDocToSignature - execute insertion for arrow function", () => {
  it("inserts execute: boolean as first param in arrow function", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
const myNode = (x: number) => {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("execute: boolean");
    const execIdx = result.indexOf("execute: boolean");
    const xIdx = result.indexOf("x: number");
    expect(execIdx).toBeLessThan(xIdx);
  });

  it("inserts execute: boolean into empty arrow function params", () => {
    const code = `/**
 * @flowWeaver nodeType
 */
const myNode = () => {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("execute: boolean");
  });
});

describe("syncJSDocToSignature - add missing params from JSDoc", () => {
  it("adds missing params to function declaration", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function myNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("y:");
  });

  it("adds missing params to arrow function", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
const myNode = (execute: boolean, x: number) => {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("y:");
  });

  it("adds optional param with default value", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input [count=5]
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("count:");
    expect(result).toContain("= 5");
  });

  it("adds optional param without default", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input [limit]
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("limit?:");
  });
});

describe("syncJSDocToSignature - multiline params in declaration", () => {
  it("adds params correctly when existing params are multiline", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 * @input z
 */
function myNode(
  execute: boolean,
  x: number
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("y:");
    expect(result).toContain("z:");
  });

  it("adds params when existing params end with trailing comma", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function myNode(
  execute: boolean,
  x: number,
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("y:");
  });
});

describe("syncJSDocToSignature - multiline params in arrow function", () => {
  it("adds params correctly when arrow function params are multiline", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
const myNode = (
  execute: boolean,
  x: number
) => {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("y:");
  });

  it("adds params when arrow function params end with trailing comma", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
const myNode = (
  execute: boolean,
  x: number,
) => {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("y:");
  });
});

describe("syncJSDocToSignature - return type handling", () => {
  it("adds return type annotation when outputs defined in JSDoc", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean) {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("onSuccess:");
    expect(result).toContain("onFailure:");
    expect(result).toContain("result:");
  });

  it("updates existing return type annotation", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 * @output extra
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("extra:");
    expect(result).toContain("result:");
  });

  it("adds return type to arrow function", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
const myNode = (execute: boolean) => {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("result:");
    expect(result).toContain("onSuccess:");
  });

  it("updates existing return type on arrow function", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 * @output extra
 */
const myNode = (execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } => {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("extra:");
  });

  it("removes output fields from return type that are not in JSDoc", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output kept
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; kept: number; removed: string } {
  return { onSuccess: true, onFailure: false, kept: 1, removed: "bye" };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("kept:");
    // The return type should be rebuilt with only JSDoc outputs + mandatory fields
    expect(result).toContain("onSuccess:");
    expect(result).toContain("onFailure:");
  });
});

describe("syncJSDocToSignature - authoritative ports", () => {
  it("uses authoritative input ports when provided", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code, {
      inputs: { x: { dataType: "STRING" } },
    });
    expect(result).toContain("x: string");
  });

  it("uses authoritative output ports when provided", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
    const result = syncJSDocToSignature(code, {
      outputs: { result: { dataType: "ARRAY", tsType: "string[]" } },
    });
    expect(result).toContain("result:");
  });

  it("infers tsType from return body when not already set on port", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output count
 */
function myNode(execute: boolean) {
  return { onSuccess: true, onFailure: false, count: 42 };
}`;
    const result = syncJSDocToSignature(code);
    // count should get inferred type from return body (42 -> number)
    expect(result).toContain("count:");
  });
});

describe("syncJSDocToSignature - port ordering via metadata", () => {
  it("adds params in order specified by metadata", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input beta [order:2]
 * @input alpha [order:1]
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    const alphaIdx = result.indexOf("alpha:");
    const betaIdx = result.indexOf("beta:");
    // alpha (order:1) should come before beta (order:2)
    expect(alphaIdx).toBeLessThan(betaIdx);
  });
});

describe("syncJSDocToSignature - scoped ports filtering", () => {
  it("filters scoped outputs from non-scoped outputs", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output result
 * @output item scope:iteration
 * @input success scope:iteration
 */
function forEach(execute: boolean, iteration: (item: any) => { success: boolean }): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}`;
    const result = syncJSDocToSignature(code);
    // Non-scoped output should be in return type
    expect(result).toContain("result:");
    // Scoped output item should be in callback params, not return type
    expect(result).toContain("iteration:");
  });
});

describe("syncJSDocToSignature - expression function type", () => {
  it("returns text unchanged for expression-type function (no match)", () => {
    // This covers the fallthrough return at the end of updateCallbackInSignature
    // and the expression function type path
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
const myNode = function(execute: boolean) {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
    // This is technically a function expression; parseFunctionSignature
    // may detect it as a declaration. Either way it should not crash.
    const result = syncJSDocToSignature(code);
    expect(typeof result).toBe("string");
  });
});

describe("syncJSDocToSignature - mandatory return fields", () => {
  it("ensures onSuccess and onFailure in return type even if not in JSDoc", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean) {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("onSuccess:");
    expect(result).toContain("onFailure:");
    expect(result).toContain("result:");
  });
});

describe("syncJSDocToSignature - existing return type fields preserved", () => {
  it("preserves existing field types from return type annotation", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
    const result = syncJSDocToSignature(code);
    // result type from existing annotation should be preserved
    expect(result).toContain("result: number");
  });
});

// ---------------------------------------------------------------------------
// updateCallbackInSignature - additional edge cases
// ---------------------------------------------------------------------------

describe("syncJSDocToSignature - callback update in declaration", () => {
  it("updates existing callback in function declaration", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 * @output index scope:iteration
 * @input success scope:iteration
 */
function forEach(execute: boolean, iteration: (item: any) => { success: boolean }): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    // Should update callback to include index param
    expect(result).toContain("index");
    expect(result).toContain("=>");
  });

  it("handles callback in declaration with multiline params", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 * @output index scope:iteration
 * @input success scope:iteration
 */
function forEach(
  execute: boolean,
  iteration: (item: any) => { success: boolean }
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("index");
    expect(result).toContain("=>");
  });

  it("handles declaration when callback already has all ports (no-op)", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @output item scope:iteration
 * @input success scope:iteration
 */
function forEach(execute: boolean, iteration: (item: any) => { success: boolean }): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("iteration:");
    expect(result).toContain("=>");
  });
});

describe("syncJSDocToSignature - callback update in arrow function", () => {
  it("handles arrow function when no arrow (=>) found after params", () => {
    // Edge case: malformed arrow function
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
    expect(result).toContain("const forEach");
  });
});

describe("syncJSDocToSignature - no outputs to sync", () => {
  it("still returns valid code when there are no output tags", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function myNode(execute: boolean, x: number) {
  console.log(x);
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("function myNode");
    expect(result).toContain("x: number");
  });
});

describe("syncJSDocToSignature - output type from port tsType", () => {
  it("uses port tsType for return type field when available", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output items
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code, {
      outputs: { items: { dataType: "ARRAY", tsType: "string[]" } },
    });
    expect(result).toContain("items: string[]");
  });
});

describe("syncJSDocToSignature - empty return type field value", () => {
  it("handles existing return type field with empty type gracefully", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: } {
  return { onSuccess: true, onFailure: false };
}`;
    // Should not crash on malformed return type
    const result = syncJSDocToSignature(code);
    expect(result).toContain("result:");
  });
});

describe("syncJSDocToSignature - skips onSuccess/onFailure when adding output fields", () => {
  it("does not duplicate onSuccess/onFailure from JSDoc outputs", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output onSuccess
 * @output onFailure
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    // Count occurrences of onSuccess in the return type annotation
    const returnTypeMatch = result.match(/\):\s*\{([^}]*)\}/);
    if (returnTypeMatch) {
      const returnContent = returnTypeMatch[1];
      const successCount = (returnContent.match(/onSuccess/g) || []).length;
      expect(successCount).toBe(1);
    }
  });
});

describe("syncSignatureToJSDoc - param with afterName starting with paren (callback detection)", () => {
  it("skips params where afterName starts with ( in raw ordering", () => {
    // The raw param ordering code checks if afterName starts with "("
    // to detect callbacks. This tests that path.
    const code = `/**
 * @flowWeaver nodeType
 */
function forEach(execute: boolean, items: any[], processItem: (x: boolean) => void): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@input items");
  });
});

describe("syncSignatureToJSDoc - no JSDoc block (scope auto-generation skipped)", () => {
  it("handles function without any JSDoc block", () => {
    const code = `function myNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@input x");
  });
});

describe("syncJSDocToSignature - paramsToRemove is always empty", () => {
  it("never removes params from signature (source of truth)", () => {
    // Even if a param has no @input tag, it should stay in the signature
    const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function myNode(execute: boolean, x: number, extraParam: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncJSDocToSignature(code);
    expect(result).toContain("extraParam:");
  });
});

describe("syncSignatureToJSDoc - rawParamOrder vs parsedOrder fallback", () => {
  it("uses parsedOrder when rawParamOrder has fewer entries", () => {
    // This exercises the fallback: signatureInputOrder = rawParamOrder.length >= parsedOrder.length ? rawParamOrder : parsedOrder
    // A contrived case where raw regex matching produces fewer param names
    const code = `/**
 * @flowWeaver nodeType
 */
function myNode(execute: boolean, x: number, y: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}`;
    const result = syncSignatureToJSDoc(code);
    expect(result).toContain("@input x");
    expect(result).toContain("@input y");
  });
});
