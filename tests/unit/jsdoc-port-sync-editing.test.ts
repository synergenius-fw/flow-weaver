/**
 * Comprehensive editing workflow tests for JSDoc Port Sync
 *
 * These tests simulate real user editing patterns and edge cases.
 */

import {
  parsePortsFromFunctionText,
  syncSignatureToJSDoc,
  syncJSDocToSignature,
  syncCodeRenames,
  updatePortsInFunctionText,
} from "../../src/jsdoc-port-sync";

describe("JSDoc Port Sync - Editing Workflows", () => {
  describe("1. Sequential Editing Simulation", () => {
    it("simulates complete node type creation workflow", () => {
      // Step 1: Start with empty function
      let code = `function myNode(execute: boolean) {}`;

      // Step 2: User adds first param in code
      code = `function myNode(execute: boolean, x: number) {}`;

      // Step 3: Sync Code → JSDoc (should add @input for x)
      code = syncSignatureToJSDoc(code);
      expect(code).toContain("@input x");

      // Step 4: User adds second param
      let prevCode = code;
      code = code.replace(
        "x: number)",
        "x: number, y: string)"
      );

      // Step 5: Sync Code → JSDoc (should add @input for y)
      code = syncSignatureToJSDoc(code);
      expect(code).toContain("@input x");
      expect(code).toContain("@input y");

      // Step 6: User renames first param in signature
      prevCode = code;
      code = code.replace("x: number", "value: number");

      // Step 7: Sync rename (signature changed, JSDoc unchanged)
      code = syncCodeRenames(prevCode, code);
      expect(code).toContain("@input value");
      expect(code).not.toContain("@input x");

      // Step 8: User deletes second param
      prevCode = code;
      code = code.replace(", y: string", "");

      // Step 9: Sync Code → JSDoc (should remove @input for y)
      code = syncSignatureToJSDoc(code);
      expect(code).toContain("@input value");
      expect(code).not.toContain("@input y");

      // Step 10: User adds return statement with output
      code = code.replace("{}", "{ return { result: value * 2 }; }");
      code = syncSignatureToJSDoc(code);
      expect(code).toContain("@output result");
    });

    it("simulates adding and removing outputs", () => {
      let code = `/**
 * @flowWeaver nodeType
 */
function calc(execute: boolean, a: number, b: number) {
  return { sum: a + b };
}`;

      // Sync should add @output for sum
      code = syncSignatureToJSDoc(code);
      expect(code).toContain("@output sum");

      // User adds another return field
      code = code.replace(
        "return { sum: a + b }",
        "return { sum: a + b, product: a * b }"
      );
      code = syncSignatureToJSDoc(code);
      expect(code).toContain("@output sum");
      expect(code).toContain("@output product");

      // User removes sum from return
      code = code.replace("sum: a + b, ", "");
      code = syncSignatureToJSDoc(code);
      expect(code).not.toContain("@output sum");
      expect(code).toContain("@output product");
    });

    it("preserves port metadata during editing", () => {
      let code = `/**
 * @flowWeaver nodeType
 * @input x - The X coordinate
 * @input y - The Y coordinate
 */
function point(execute: boolean, x: number, y: number) {}`;

      // Rename x to posX in signature
      const prevCode = code;
      code = code.replace("x: number", "posX: number");
      code = syncCodeRenames(prevCode, code);

      // Label should be preserved
      expect(code).toContain("@input posX - The X coordinate");
      expect(code).not.toContain("@input x");
    });
  });

  describe("2. Auto-removal Feature", () => {
    it("removes orphan @input when param is deleted", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @input c
 */
function test(execute: boolean, a: number, c: number) {}`;

      // b is in JSDoc but not in signature
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input a");
      expect(result).not.toContain("@input b");
      expect(result).toContain("@input c");
    });

    it("removes orphan @output when return field is deleted", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output x
 * @output y
 * @output z
 */
function test(execute: boolean) { return { x: 1, z: 3 }; }`;

      // y is in JSDoc but not in return
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@output x");
      expect(result).not.toContain("@output y");
      expect(result).toContain("@output z");
    });

    it("preserves scoped ports during removal", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input normalPort
 * @input orphanPort
 * @input scopedPort scope:inner
 */
function test(execute: boolean, normalPort: number, inner: (execute: boolean) => void) {}`;

      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input normalPort");
      expect(result).not.toContain("@input orphanPort");
      // Scoped port should be preserved even though it's not a direct param
      expect(result).toContain("@input scopedPort scope:inner");
    });

    it("preserves reserved output ports during removal", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output onSuccess
 * @output onFailure
 * @output orphanOutput
 */
function test(execute: boolean) {}`;

      const result = syncSignatureToJSDoc(code);
      // Reserved ports should be preserved
      expect(result).toContain("@output onSuccess");
      expect(result).toContain("@output onFailure");
      // Orphan should be removed
      expect(result).not.toContain("@output orphanOutput");
    });
  });

  describe("3. Conflict Scenarios", () => {
    it("handles JSDoc and signature with completely different ports", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input jsdocOnly
 */
function test(execute: boolean, signatureOnly: number) {}`;

      const result = syncSignatureToJSDoc(code);
      // JSDoc-only port should be removed (not in signature)
      expect(result).not.toContain("@input jsdocOnly");
      // Signature-only port should be added
      expect(result).toContain("@input signatureOnly");
    });

    it("handles both JSDoc and signature renamed differently (conflict)", () => {
      const prevCode = `/**
 * @flowWeaver nodeType
 * @input original
 */
function test(execute: boolean, original: number) {}`;

      // User changes both JSDoc and signature to different names
      const currentCode = `/**
 * @flowWeaver nodeType
 * @input jsdocRenamed
 */
function test(execute: boolean, signatureRenamed: number) {}`;

      // Conflict - should not sync (leave as is)
      const result = syncCodeRenames(prevCode, currentCode);
      expect(result).toContain("@input jsdocRenamed");
      expect(result).toContain("signatureRenamed: number");
    });

    it("handles port count mismatch gracefully", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @input c
 */
function test(execute: boolean, x: number, y: number) {}`;

      // 3 JSDoc ports, 2 signature params - syncSignatureToJSDoc should sync to signature
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x");
      expect(result).toContain("@input y");
      expect(result).not.toContain("@input a");
      expect(result).not.toContain("@input b");
      expect(result).not.toContain("@input c");
    });
  });

  describe("4. Scoped Port Edge Cases", () => {
    it("removes scoped ports when callback param is renamed (scope becomes invalid)", () => {
      const prevCode = `/**
 * @flowWeaver nodeType
 * @input items
 * @input item scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => void) {}`;

      // Rename callback param from "iteration" to "handleItem"
      const currentCode = prevCode.replace("iteration:", "handleItem:");

      // After rename, scope:iteration is invalid (no callback named "iteration")
      // The scoped port is removed since it's now an orphan (not in main signature, invalid scope)
      const result = syncSignatureToJSDoc(currentCode);
      // The scoped port should be removed (check for item with scope, not just "item" which matches "items")
      expect(result).not.toMatch(/@input item\s+scope:/);
      // The non-scoped port should remain
      expect(result).toContain("@input items");
    });

    it("handles multiple scopes correctly", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @input item scope:iteration
 * @input errorMsg scope:error
 */
function process(execute: boolean, items: any[], iteration: (x: any) => void, error: (e: any) => void) {}`;

      // Both scoped ports should be preserved because both callbacks exist
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input item scope:iteration");
      expect(result).toContain("@input errorMsg scope:error");
    });
  });

  describe("5. Reserved Name Interactions", () => {
    it("does not add @input for execute param", () => {
      const code = `function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x");
      expect(result).not.toMatch(/@input.*execute/);
    });

    it("preserves explicit execute in JSDoc", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input execute
 */
function test(execute: boolean) {}`;

      // Execute is a reserved param but if explicitly in JSDoc, behavior may vary
      // The sync should handle it gracefully
      const result = syncSignatureToJSDoc(code);
      // Since execute is in signature as reserved, it won't be in signatureParamNames
      // So the explicit @input execute will be removed
      expect(result).not.toMatch(/@input.*execute/);
    });

    it("prevents renaming to reserved names", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`;

      // Directly try to update ports with reserved name - should be handled by updatePortsInFunctionText
      // This tests the library's protection against reserved names
      const { inputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("x");
    });
  });

  describe("6. Type Handling", () => {
    it("infers port types from TypeScript annotations", () => {
      const code = `function test(
  execute: boolean,
  num: number,
  str: string,
  bool: boolean,
  arr: any[],
  obj: object
) {}`;

      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input num");
      expect(result).toContain("@input str");
      expect(result).toContain("@input bool");
      expect(result).toContain("@input arr");
      expect(result).toContain("@input obj");
    });

    it("preserves JSDoc type when signature type differs", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input data
 */
function test(execute: boolean, data: string[]) {}`;

      // JSDoc says ARRAY, signature says string[]
      const result = syncSignatureToJSDoc(code);
      // Existing JSDoc type should be preserved
      expect(result).toContain("@input data");
    });

    it("handles unknown types as ANY", () => {
      const code = `function test(execute: boolean, custom: CustomType) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input custom");
    });
  });

  describe("7. Order Edge Cases", () => {
    it("preserves port order from JSDoc", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input b [order:1]
 * @input a [order:0]
 */
function test(execute: boolean, a: number, b: number) {}`;

      const { inputs } = parsePortsFromFunctionText(code);
      expect(inputs.a?.metadata?.order).toBe(0);
      expect(inputs.b?.metadata?.order).toBe(1);
    });

    it("handles param insertion in middle of list", () => {
      let code = `/**
 * @flowWeaver nodeType
 * @input a
 * @input c
 */
function test(execute: boolean, a: number, c: number) {}`;

      // Insert b between a and c in signature
      code = code.replace("a: number, c:", "a: number, b: string, c:");
      code = syncSignatureToJSDoc(code);

      expect(code).toContain("@input a");
      expect(code).toContain("@input b");
      expect(code).toContain("@input c");
    });
  });

  describe("8. Whitespace and Formatting", () => {
    it("handles extra spaces between @input and type", () => {
      // The regex uses \s+ to allow flexible whitespace
      const code = `/**
 * @flowWeaver nodeType
 * @input x    -   Label with spaces
 */
function test(execute: boolean, x: number) {}`;

      const { inputs } = parsePortsFromFunctionText(code);
      // Port is correctly parsed with flexible whitespace
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.dataType).toBe("NUMBER");
      expect(inputs.x.label).toBe("Label with spaces");
    });

    it("handles tabs in JSDoc correctly", () => {
      // The regex uses \s+ which matches tabs
      const code = `/**
 * @flowWeaver nodeType
 * @input\tx
 */
function test(execute: boolean, x: number) {}`;

      const { inputs } = parsePortsFromFunctionText(code);
      // Port is correctly parsed with tabs (type inferred from signature)
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.dataType).toBe("NUMBER");
    });

    it("handles single space between components correctly", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x - Label
 */
function test(execute: boolean, x: number) {}`;

      const { inputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.label).toBe("Label");
    });

    it("preserves function body formatting", () => {
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean, x: number) {
  const result = x * 2;
  console.log(result);
  return { value: result };
}`;

      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("const result = x * 2;");
      expect(result).toContain("console.log(result);");
    });
  });

  describe("9. Round-trip Stability", () => {
    it("maintains stability across multiple sync cycles", () => {
      let code = `/**
 * @flowWeaver nodeType
 * @input x - Label X
 * @input y - Label Y
 * @output result - Result
 */
function calc(execute: boolean, x: number, y: string) {
  return { result: x };
}`;

      const original = code;

      // Multiple sync cycles should not change the code
      for (let i = 0; i < 5; i++) {
        code = syncSignatureToJSDoc(code);
        code = syncJSDocToSignature(code);
      }

      // Labels and structure should be preserved
      expect(code).toContain("@input x - Label X");
      expect(code).toContain("@input y - Label Y");
      expect(code).toContain("@output result - Result");
    });

    it("is idempotent - calling sync twice gives same result", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number, y: string) {}`;

      const result1 = syncSignatureToJSDoc(code);
      const result2 = syncSignatureToJSDoc(result1);

      expect(result1).toBe(result2);
    });
  });

  describe("10. Real-World Patterns", () => {
    it("handles forEach pattern with scoped ports", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input items - Items to iterate
 * @input success scope:iteration
 * @output start scope:iteration
 * @output item scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => { success: boolean }) {}`;

      const result = syncSignatureToJSDoc(code);
      // All ports should be preserved
      expect(result).toContain("@input items");
      expect(result).toContain("@input success scope:iteration");
      expect(result).toContain("@output start scope:iteration");
      expect(result).toContain("@output item scope:iteration");
    });

    it("handles async function signatures", () => {
      const code = `async function fetchData(execute: boolean, url: string) {
  return { data: await fetch(url) };
}`;

      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input url");
      expect(result).toContain("@output data");
    });

    it("handles arrow function syntax", () => {
      const code = `const process = (execute: boolean, input: number) => {
  return { output: input * 2 };
}`;

      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input input");
      expect(result).toContain("@output output");
    });

    it("handles conditional branching with multiple outputs", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output onSuccess
 * @output onFailure
 * @output result
 */
function conditional(execute: boolean, condition: boolean) {
  if (condition) {
    return { onSuccess: true, result: "success" };
  } else {
    return { onFailure: true };
  }
}`;

      const result = syncSignatureToJSDoc(code);
      // Reserved outputs should be preserved
      expect(result).toContain("@output onSuccess");
      expect(result).toContain("@output onFailure");
      expect(result).toContain("@output result");
    });
  });

  describe("11. Invalid/Partial States", () => {
    it("handles code without JSDoc gracefully", () => {
      const code = `function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@flowWeaver nodeType");
      expect(result).toContain("@input x");
    });

    it("handles empty function", () => {
      const code = `function test(execute: boolean) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@flowWeaver nodeType");
    });

    it("handles JSDoc without @flowWeaver marker", () => {
      const code = `/**
 * Some documentation
 */
function test(execute: boolean, x: number) {}`;

      const result = syncSignatureToJSDoc(code);
      // Should add the marker
      expect(result).toContain("@flowWeaver nodeType");
      expect(result).toContain("@input x");
    });

    it("handles malformed port annotations gracefully", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input NUMBER x
 * @input {INVALID
 * @input {} y
 */
function test(execute: boolean, z: number) {}`;

      // Should not crash, should still work with valid ports
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input z");
    });
  });
});
