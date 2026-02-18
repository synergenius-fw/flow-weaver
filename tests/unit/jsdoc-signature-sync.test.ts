/**
 * Test JSDoc Signature Sync utilities
 * Functions for syncing between JSDoc and function signatures
 */

import {
  parseFunctionSignature,
  parseReturnFields,
  parseInputTypeFields,
  tsTypeToPortType,
  syncSignatureToJSDoc,
  syncJSDocToSignature,
} from "../../src/jsdoc-port-sync";

describe("JSDoc Signature Sync", () => {
  describe("Function Signature Parsing", () => {
    describe("parseFunctionSignature", () => {
      it("parses function declaration params", () => {
        const code = `function add(execute: boolean, a: number, b: number) {}`;
        const result = parseFunctionSignature(code);
        expect(result.params).toHaveLength(3);
        expect(result.params[0]).toMatchObject({ name: "execute", tsType: "boolean" });
        expect(result.params[1]).toMatchObject({ name: "a", tsType: "number", optional: false, position: 1 });
        expect(result.params[2]).toMatchObject({ name: "b", tsType: "number", optional: false, position: 2 });
        expect(result.functionType).toBe("declaration");
      });

      it("parses arrow function params", () => {
        const code = `const add = (execute: boolean, a: number) => a`;
        const result = parseFunctionSignature(code);
        expect(result.functionType).toBe("arrow");
        expect(result.params).toHaveLength(2);
        expect(result.params[1].name).toBe("a");
      });

      it("parses async arrow function", () => {
        const code = `const add = async (execute: boolean, x: string) => x`;
        const result = parseFunctionSignature(code);
        expect(result.functionType).toBe("arrow");
        expect(result.params[1]).toMatchObject({ name: "x", tsType: "string" });
      });

      it("parses optional params with ?", () => {
        const code = `function add(x: number, y?: number) {}`;
        const result = parseFunctionSignature(code);
        expect(result.params[0].optional).toBe(false);
        expect(result.params[1].optional).toBe(true);
      });

      it("parses params with default values", () => {
        const code = `function add(x: number, y: number = 10) {}`;
        const result = parseFunctionSignature(code);
        expect(result.params[1].optional).toBe(true);
        expect(result.params[1].defaultValue).toBe("10");
      });

      it("parses params without type annotations", () => {
        const code = `function add(execute, x, y) {}`;
        const result = parseFunctionSignature(code);
        expect(result.params[1]).toMatchObject({ name: "x", tsType: undefined });
      });

      it("handles async function declaration", () => {
        const code = `async function fetchData(execute: boolean, url: string) {}`;
        const result = parseFunctionSignature(code);
        expect(result.functionType).toBe("declaration");
        expect(result.params[1]).toMatchObject({ name: "url", tsType: "string" });
      });

      it("handles empty params", () => {
        const code = `function noParams() {}`;
        const result = parseFunctionSignature(code);
        expect(result.params).toHaveLength(0);
      });

      it("parses params with nested callback type (forEach pattern)", () => {
        const code = `function forEach(
  execute: boolean,
  items: any[],
  processItem: (execute: boolean, item: any) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  }
) {}`;
        const result = parseFunctionSignature(code);
        // Should find all 3 params including the callback
        expect(result.params).toHaveLength(3);
        expect(result.params[0]).toMatchObject({ name: "execute" });
        expect(result.params[1]).toMatchObject({ name: "items" });
        expect(result.params[2]).toMatchObject({ name: "processItem" });
      });
    });

    describe("parseReturnFields", () => {
      it("extracts return object fields with shorthand", () => {
        const code = `function add() { return { sum, difference }; }`;
        const result = parseReturnFields(code);
        expect(result).toEqual(["sum", "difference"]);
      });

      it("extracts return object fields with explicit values", () => {
        const code = `function add() { return { sum: a + b, difference: a - b }; }`;
        const result = parseReturnFields(code);
        expect(result).toEqual(["sum", "difference"]);
      });

      it("handles mixed shorthand and explicit", () => {
        const code = `function add() { return { sum: a + b, difference }; }`;
        const result = parseReturnFields(code);
        expect(result).toEqual(["sum", "difference"]);
      });

      it("handles multiple return statements (union)", () => {
        const code = `function test() { if (x) { return { a, b }; } return { a, c }; }`;
        const result = parseReturnFields(code);
        expect(result).toContain("a");
        expect(result).toContain("b");
        expect(result).toContain("c");
      });

      it("returns empty array for no return statement", () => {
        const code = `function noReturn() { console.log("hi"); }`;
        const result = parseReturnFields(code);
        expect(result).toEqual([]);
      });

      it("returns empty array for non-object return", () => {
        const code = `function simple() { return 42; }`;
        const result = parseReturnFields(code);
        expect(result).toEqual([]);
      });

      it("skips reserved fields onSuccess and onFailure", () => {
        const code = `function test() { return { onSuccess: true, onFailure: false, result: 1 }; }`;
        const result = parseReturnFields(code);
        expect(result).toEqual(["result"]);
      });
    });

    describe("tsTypeToPortType", () => {
      it("maps number to NUMBER", () => {
        expect(tsTypeToPortType("number")).toBe("NUMBER");
      });

      it("maps string to STRING", () => {
        expect(tsTypeToPortType("string")).toBe("STRING");
      });

      it("maps boolean to BOOLEAN", () => {
        expect(tsTypeToPortType("boolean")).toBe("BOOLEAN");
      });

      it("maps any[] to ARRAY", () => {
        expect(tsTypeToPortType("any[]")).toBe("ARRAY");
      });

      it("maps unknown types to ANY", () => {
        expect(tsTypeToPortType("SomeCustomType")).toBe("ANY");
        expect(tsTypeToPortType("unknown")).toBe("ANY");
      });

      it("handles undefined input", () => {
        expect(tsTypeToPortType(undefined as any)).toBe("ANY");
      });
    });
  });

  describe("Bidirectional Sync", () => {
    describe("syncSignatureToJSDoc (Code → JSDoc)", () => {
      it("adds missing @input for new param", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input x
 */
function add(execute: boolean, x: number, y: number) {}`;
        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input x");
        expect(result).toContain("@input y");
      });

      it("infers type from TS annotation", () => {
        const code = `
/**
 * @flowWeaver nodeType
 */
function add(execute: boolean, name: string) {}`;
        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input name");
      });

      it("defaults to ANY when no type annotation", () => {
        const code = `
/**
 * @flowWeaver nodeType
 */
function add(execute, x) {}`;
        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input x");
      });

      it("skips execute parameter", () => {
        const code = `
/**
 * @flowWeaver nodeType
 */
function add(execute: boolean, x: number) {}`;
        const result = syncSignatureToJSDoc(code);
        expect(result).not.toContain("@input execute");
        expect(result).toContain("@input x");
      });

      it("adds @output for return fields", () => {
        const code = `
/**
 * @flowWeaver nodeType
 */
function add(execute: boolean) { return { sum: 1 }; }`;
        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@output sum");
      });

      it("preserves existing port labels", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input x - X coordinate
 */
function add(execute: boolean, x: number, y: number) {}`;
        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input x - X coordinate");
        expect(result).toContain("@input y");
      });
    });

    describe("syncJSDocToSignature (JSDoc → Code)", () => {
      it("preserves param order using [order:N]", () => {
        // Test that [order:N] metadata controls param ordering in signature
        const code = `
/**
 * @flowWeaver nodeType
 * @input b [order:1]
 * @input a [order:0]
 */
function add(execute: boolean, a: number, b: string) {}`;
        const result = syncJSDocToSignature(code);
        // a should come before b based on order metadata
        const aIndex = result.indexOf("a: number");
        const bIndex = result.indexOf("b: string");
        expect(aIndex).toBeLessThan(bIndex);
      });

      it("adds mandatory onSuccess and onFailure to return type", () => {
        // onSuccess and onFailure are MANDATORY - always added to return type
        const code = `
/**
 * @flowWeaver nodeType
 * @output results - All results
 */
function forEach(execute: boolean): { results: any[] } {}`;
        const result = syncJSDocToSignature(code);
        // Should include mandatory onSuccess and onFailure
        expect(result).toContain("onSuccess: boolean");
        expect(result).toContain("onFailure: boolean");
        expect(result).toContain("results: any[]");
      });

      it("updates main function return type when callback param exists", () => {
        // This tests that findBalancedClose finds the MAIN function's closing paren,
        // not the callback's closing paren
        const code = `
/**
 * @flowWeaver nodeType
 * @output results - All results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (execute: boolean, item: any) => { onSuccess: boolean; onFailure: boolean; processed: any }
): { results: any[] } {}`;
        const result = syncJSDocToSignature(code);
        // Main function return type should include mandatory fields
        expect(result).toContain("): { onSuccess: boolean; onFailure: boolean; results: any[] }");
      });

      it("updates main function return type when multiline callback param exists", () => {
        // Real-world forEach pattern with multiline callback
        const code = `
/**
 * @flowWeaver nodeType
 * @output results - All results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    execute: boolean,
    item: any,
  ) => {
    onSuccess: boolean;
    onFailure: boolean;
    processed: any;
  },
): { results: any[] } {}`;
        const result = syncJSDocToSignature(code);
        // Main function return type should include mandatory fields
        expect(result).toContain("): { onSuccess: boolean; onFailure: boolean; results: any[] }");
      });

      it("should not duplicate execute parameter", () => {
        // Test that execute is not duplicated when syncing JSDoc to signature
        const code = `
/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function add(execute: boolean, x: number, y: number) {}`;
        const result = syncJSDocToSignature(code);
        // Should have exactly one execute: boolean
        const executeCount = (result.match(/execute: boolean/g) || []).length;
        expect(executeCount).toBe(1);
        // x and y should be preserved
        expect(result).toContain("x: number");
        expect(result).toContain("y: number");
      });

      it("should be idempotent - calling twice gives same result", () => {
        // Test idempotency: syncing twice should give same result
        const code = `
/**
 * @flowWeaver nodeType
 * @input x
 */
function add(execute: boolean, x: number) {}`;
        const result1 = syncJSDocToSignature(code);
        const result2 = syncJSDocToSignature(result1);
        expect(result1).toBe(result2);
      });

      it("should NOT add scoped ports as direct main function params", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input items [order:1]
 * @input success scope:iteration [order:0]
 * @input processed scope:iteration [order:2]
 * @input execute [order:0]
 * @output start scope:iteration [order:0]
 * @output item scope:iteration [order:1]
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => { success: boolean; processed: any }) {}`;
        const result = syncJSDocToSignature(code);
        // Scoped ports should NOT appear as direct params (comma after them)
        // e.g., NOT: forEach(execute, items, success: boolean, processed: any)
        expect(result).not.toMatch(/forEach\([^)]*,\s*success:\s*boolean\s*,/);
        expect(result).not.toMatch(/forEach\([^)]*,\s*processed:\s*any\s*[,)]/);
        // Should have execute and items as direct params
        expect(result).toContain("execute: boolean");
        expect(result).toContain("items: any[]");
        // Scoped ports SHOULD appear in the callback signature
        expect(result).toContain("iteration:");
        expect(result).toMatch(/=>\s*\{[^}]*success:\s*boolean/);
      });

      it("should not parse params from nested callback signatures", () => {
        // Callback params (a, b) should not be added to main signature
        const code = `
/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number, callback: (a: number, b: string) => void) {}`;
        const result = syncJSDocToSignature(code);
        // x should be in signature, a and b should only be in callback
        expect(result).toContain("x: number");
        const aCount = (result.match(/\ba: number/g) || []).length;
        const bCount = (result.match(/\bb: string/g) || []).length;
        // a and b should only appear once (in the callback definition)
        expect(aCount).toBeLessThanOrEqual(1);
        expect(bCount).toBeLessThanOrEqual(1);
      });

      it("should sync scoped OUTPUT ports to callback parameters", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:iteration
 * @output item scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (a: boolean) => { x: boolean }) {}`;
        const result = syncJSDocToSignature(code);
        // Callback named 'iteration' should have start and item as parameters
        expect(result).toMatch(/iteration:\s*\([^)]*start:\s*boolean/);
        expect(result).toMatch(/iteration:\s*\([^)]*item:\s*any/);
      });

      it("should preserve multi-line signature format when syncing scoped ports", () => {
        // When callback already has all required ports, format is preserved
        const code = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @input success scope:processItem
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    start: boolean,
    item: any,
  ) => {
    success: boolean;
  },
): { onSuccess: boolean; onFailure: boolean } {}`;
        const result = syncJSDocToSignature(code);
        // When callback already has all ports, no modification happens - format is preserved
        expect(result).toContain("function forEach(\n");
        expect(result).toMatch(/execute: boolean,\n/);
      });

      it("should preserve multi-line signature format when ADDING new scoped port", () => {
        // User adds a new scoped INPUT port (Tafe) - format should be preserved
        // Note: Tafe gets `any` type since no type info in JSDoc (we removed {TYPE})
        const code = `
/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 * @output item scope:processItem
 * @input processed scope:processItem
 * @input Tafe scope:processItem [placement:TOP]
 * @output results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    start: boolean,
    item: any,
  ) => {
    success: boolean;
    failure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;
        const result = syncJSDocToSignature(code);
        // Multi-line format should be preserved
        expect(result).toContain("function forEach(\n");
        expect(result).toMatch(/execute: boolean,\n/);
        expect(result).toMatch(/items: any\[\],\n/);
        // Callback return type should include the new Tafe port (with any type)
        expect(result).toMatch(/Tafe:\s*any/);
      });

      it("should preserve multi-line callback return type format when adding scoped INPUT ports", () => {
        // Callback return type was multi-line, should stay multi-line after adding ports
        // Note: New ports get `any` type since no type info in JSDoc (we removed {TYPE})
        const code = `
/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 * @output item scope:processItem
 * @input processed scope:processItem
 * @input Bufi scope:processItem
 * @input Fuvo scope:processItem
 * @input Rokuto scope:processItem
 * @input Nila scope:processItem
 * @output results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    start: boolean,
    item: any,
  ) => {
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;
        const result = syncJSDocToSignature(code);
        // Multi-line callback return type should be preserved
        // Each field on its own line (new ports get `any` type)
        expect(result).toMatch(/=>\s*\{\n/); // Opening brace followed by newline
        expect(result).toMatch(/processed:\s*any;\n/);
        expect(result).toMatch(/Bufi:\s*any;\n/);
        expect(result).toMatch(/Fuvo:\s*any;\n/);
        expect(result).toMatch(/Rokuto:\s*any;\n/);
        expect(result).toMatch(/Nila:\s*any;\n/);
      });

      it("should preserve multi-line callback PARAMS format when adding scoped INPUT ports", () => {
        // Callback params were multi-line, should stay multi-line after adding ports
        // Note: New ports get `any` type since no type info in JSDoc (we removed {TYPE})
        const code = `
/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 * @output item scope:processItem
 * @input processed scope:processItem
 * @input Mife scope:processItem
 * @output results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (
    start: boolean,
    item: any,
  ) => {
    success: boolean;
    failure: boolean;
    processed: any;
  },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;
        const result = syncJSDocToSignature(code);
        // Multi-line callback params should be preserved
        expect(result).toMatch(/processItem:\s*\(\n/); // Opening paren followed by newline
        expect(result).toMatch(/start:\s*boolean,\n/);
        expect(result).toMatch(/item:\s*any,\n/);
        // Return type should include new port (with any type)
        expect(result).toMatch(/Mife:\s*any/);
      });

      it("should sync scoped INPUT ports to callback return type", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input items
 * @input success scope:iteration
 * @input processed scope:iteration
 * @output start scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (x: boolean) => { y: boolean }) {}`;
        const result = syncJSDocToSignature(code);
        // Callback return type should have success and processed
        expect(result).toMatch(/=>\s*\{[^}]*success:\s*boolean/);
        expect(result).toMatch(/=>\s*\{[^}]*processed:\s*any/);
      });

      it("should create callback parameter when scoped ports exist but no callback", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input items
 * @input success scope:iteration
 * @output start scope:iteration
 * @output item scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => { success: boolean; processed: any }) {}`;
        const result = syncJSDocToSignature(code);
        // Should add a callback parameter for the 'iteration' scope
        expect(result).toContain("iteration:");
        // Callback should have scoped output ports as params
        expect(result).toMatch(/iteration:\s*\([^)]*start:\s*boolean/);
        expect(result).toMatch(/iteration:\s*\([^)]*item:\s*any/);
        // Callback return should have scoped input ports
        expect(result).toMatch(/=>\s*\{[^}]*success:\s*boolean/);
      });

      it("should allow removing scoped INPUT port by deleting from callback return type", () => {
        // User deletes 'processed' from callback return type in signature
        // syncSignatureToJSDoc should remove @input processed from JSDoc
        const code = `
/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 * @output item scope:processItem
 * @input processed scope:processItem
 * @input success scope:processItem
 * @output results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => { success: boolean },
): { onSuccess: boolean; onFailure: boolean; results: any[] } {}`;
        // syncSignatureToJSDoc should remove @input processed (not in signature anymore)
        const result = syncSignatureToJSDoc(code);
        // processed was removed from signature, so @input processed should be removed
        expect(result).not.toContain("@input processed");
        // success should still be there
        expect(result).toContain("@input success scope:processItem");
      });
    });
  });

  describe("syncSignatureToJSDoc edge cases", () => {
    it("should add new @input AFTER @flowWeaver tag, not before", () => {
      // User manually adds a new param in signature
      // The @input should be added after @flowWeaver, not above it
      const code = `
/**
 * @flowWeaver nodeType
 * @input items
 */
function forEach(execute: boolean, items: any[], newParam: string) {}`;
      const result = syncSignatureToJSDoc(code);
      // @flowWeaver should come before @input
      const flowWeaverIndex = result.indexOf("@flowWeaver");
      const newInputIndex = result.indexOf("@input newParam");
      expect(newInputIndex).toBeGreaterThan(flowWeaverIndex);
      // Should contain the new input
      expect(result).toContain("@input newParam");
    });
  });

  describe("Port Addition Sync", () => {
    describe("JSDoc → Signature (syncJSDocToSignature)", () => {
      it("adds new non-scoped input param to signature", () => {
        // New ports without signature type get `any` (no type info in JSDoc)
        const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input newPort
 */
function test(execute: boolean, x: number) {}`;
        const result = syncJSDocToSignature(code);
        expect(result).toContain("newPort: any");
      });

      it("adds new non-scoped output to return type", () => {
        // New outputs without return type get `any` (no type info in JSDoc)
        const code = `/**
 * @flowWeaver nodeType
 * @output result
 * @output newOutput
 */
function test(execute: boolean): { result: number } {}`;
        const result = syncJSDocToSignature(code);
        expect(result).toContain("newOutput: any");
      });

      it("adds new scoped output to callback params", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:iteration
 * @output newItem scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean) => {}) {}`;
        const result = syncJSDocToSignature(code);
        expect(result).toMatch(/iteration:\s*\([^)]*newItem:\s*any/);
      });

      it("adds new scoped input to callback return type", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @input newProcessed scope:iteration
 * @output start scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean) => { success: boolean }) {}`;
        const result = syncJSDocToSignature(code);
        expect(result).toMatch(/=>\s*\{[^}]*newProcessed:\s*any/);
      });
    });

    describe("Signature → JSDoc (syncSignatureToJSDoc)", () => {
      it("adds new param as @input", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number, newParam: string) {}`;
        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input newParam");
      });

      it("adds new return field as @output", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function test(execute: boolean) { return { result: 1, newField: "test" }; }`;
        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@output newField");
      });
    });
  });

  describe("parseInputTypeFields", () => {
    it("parses simple fields", () => {
      const code = `const x: TFlowWeaverNodeType<{ name: string; age: number }, {}>`;
      const result = parseInputTypeFields(code);
      expect(result).toEqual([
        { name: "name", tsType: "string" },
        { name: "age", tsType: "number" },
      ]);
    });

    it("preserves generic types with commas (Record<string, unknown>)", () => {
      const code = `const x: TFlowWeaverNodeType<{ report: Record<string, unknown>; count: number }, {}>`;
      const result = parseInputTypeFields(code);
      expect(result).toEqual([
        { name: "report", tsType: "Record<string, unknown>" },
        { name: "count", tsType: "number" },
      ]);
    });

    it("preserves nested generics (Map<string, Array<number>>)", () => {
      const code = `const x: TFlowWeaverNodeType<{ data: Map<string, Array<number>>; label: string }, {}>`;
      const result = parseInputTypeFields(code);
      expect(result).toEqual([
        { name: "data", tsType: "Map<string, Array<number>>" },
        { name: "label", tsType: "string" },
      ]);
    });

    it("preserves tuple types with commas ([string, number])", () => {
      const code = `const x: TFlowWeaverNodeType<{ pair: [string, number]; flag: boolean }, {}>`;
      const result = parseInputTypeFields(code);
      expect(result).toEqual([
        { name: "pair", tsType: "[string, number]" },
        { name: "flag", tsType: "boolean" },
      ]);
    });

    it("handles comma-separated fields (not just semicolons)", () => {
      const code = `const x: TFlowWeaverNodeType<{ a: string, b: number }, {}>`;
      const result = parseInputTypeFields(code);
      expect(result).toEqual([
        { name: "a", tsType: "string" },
        { name: "b", tsType: "number" },
      ]);
    });
  });

});
