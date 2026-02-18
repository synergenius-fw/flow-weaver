/**
 * Test Port Diff System
 * Functions for computing and applying port diffs
 */

import {
  computePortsDiff,
  applyPortsDiffToCode,
  parsePortsFromFunctionText,
  syncJSDocToSignature,
} from "../../src/jsdoc-port-sync";

describe("Port Diff System", () => {
  describe("computePortsDiff", () => {
    it("returns empty diff when no changes", () => {
      const ports = [{ name: "x", type: "NUMBER", direction: "INPUT" }];
      const diff = computePortsDiff(ports, ports);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.renamed).toEqual([]);
      expect(diff.labelChanged).toEqual([]);
    });

    it("detects added port", () => {
      const before = [{ name: "x", type: "NUMBER", direction: "INPUT" }];
      const after = [...before, { name: "y", type: "STRING", direction: "INPUT" }];
      const diff = computePortsDiff(before, after);
      expect(diff.added).toEqual([{ name: "y", type: "STRING", direction: "INPUT", label: undefined }]);
      expect(diff.removed).toEqual([]);
    });

    it("detects removed port", () => {
      const before = [
        { name: "x", type: "NUMBER", direction: "INPUT" },
        { name: "y", type: "STRING", direction: "INPUT" }
      ];
      const after = [{ name: "x", type: "NUMBER", direction: "INPUT" }];
      const diff = computePortsDiff(before, after);
      expect(diff.removed).toEqual([{ name: "y", direction: "INPUT" }]);
      expect(diff.added).toEqual([]);
    });

    it("detects renamed port (same type, different name)", () => {
      const before = [{ name: "oldName", type: "NUMBER", direction: "INPUT" }];
      const after = [{ name: "newName", type: "NUMBER", direction: "INPUT" }];
      const diff = computePortsDiff(before, after);
      expect(diff.renamed).toEqual([{ from: "oldName", to: "newName", direction: "INPUT" }]);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
    });

    it("detects label change (not a rename)", () => {
      const before = [{ name: "x", type: "NUMBER", direction: "INPUT", label: "Old" }];
      const after = [{ name: "x", type: "NUMBER", direction: "INPUT", label: "New" }];
      const diff = computePortsDiff(before, after);
      expect(diff.labelChanged).toEqual([{ name: "x", label: "New", direction: "INPUT", type: "NUMBER", scope: undefined }]);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
    });

    it("detects multiple changes at once", () => {
      const before = [
        { name: "a", type: "NUMBER", direction: "INPUT" },
        { name: "b", type: "STRING", direction: "INPUT" }
      ];
      const after = [
        { name: "a", type: "NUMBER", direction: "INPUT", label: "A Label" },
        { name: "c", type: "BOOLEAN", direction: "INPUT" }
      ];
      const diff = computePortsDiff(before, after);
      expect(diff.labelChanged).toEqual([{ name: "a", label: "A Label", direction: "INPUT", type: "NUMBER", scope: undefined }]);
      expect(diff.removed).toEqual([{ name: "b", direction: "INPUT" }]);
      expect(diff.added).toEqual([{ name: "c", type: "BOOLEAN", direction: "INPUT", label: undefined }]);
    });

    it("handles output ports", () => {
      const before = [{ name: "result", type: "NUMBER", direction: "OUTPUT" }];
      const after = [{ name: "result", type: "NUMBER", direction: "OUTPUT" }, { name: "count", type: "NUMBER", direction: "OUTPUT" }];
      const diff = computePortsDiff(before, after);
      expect(diff.added).toEqual([{ name: "count", type: "NUMBER", direction: "OUTPUT", label: undefined }]);
    });

    it("does not treat type change as rename", () => {
      const before = [{ name: "x", type: "NUMBER", direction: "INPUT" }];
      const after = [{ name: "x", type: "STRING", direction: "INPUT" }];
      const diff = computePortsDiff(before, after);
      // Type change keeps same name, so no added/removed/renamed
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.renamed).toEqual([]);
    });

    it("detects type change for INPUT port", () => {
      const before = [{ name: "x", type: "NUMBER", direction: "INPUT" }];
      const after = [{ name: "x", type: "STRING", direction: "INPUT" }];
      const diff = computePortsDiff(before, after);
      expect(diff.typeChanged).toEqual([{ name: "x", type: "STRING", direction: "INPUT" }]);
    });

    it("detects type change for OUTPUT port", () => {
      const before = [{ name: "result", type: "NUMBER", direction: "OUTPUT" }];
      const after = [{ name: "result", type: "BOOLEAN", direction: "OUTPUT" }];
      const diff = computePortsDiff(before, after);
      expect(diff.typeChanged).toEqual([{ name: "result", type: "BOOLEAN", direction: "OUTPUT" }]);
    });
  });

  describe("applyPortsDiffToCode", () => {
    it("adds new port tag at end of ports section", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`;
      const diff = { added: [{ name: "y", type: "STRING", direction: "INPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input x");
      expect(result).toContain("@input y");
    });

    it("removes port tag without touching other lines", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean) {}`;
      const diff = { added: [], removed: [{ name: "y", direction: "INPUT" as const }], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input x");
      expect(result).not.toContain("@input y");
    });

    it("removes external input without affecting scoped ports that follow", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @input extra
 * @output start scope:iteration
 * @output item scope:iteration
 * @input success scope:iteration
 * @output onSuccess
 */
function forEach(execute: boolean, items: any[], extra: string, iteration: (start: boolean, item: any) => { success: boolean }) {}`;

      const diff = { added: [], removed: [{ name: "extra", direction: "INPUT" as const }], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);

      // Expected exact result - only 'extra' line removed
      const expected = `/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:iteration
 * @output item scope:iteration
 * @input success scope:iteration
 * @output onSuccess
 */
function forEach(execute: boolean, items: any[], extra: string, iteration: (start: boolean, item: any) => { success: boolean }) {}`;

      expect(result).toBe(expected);
    });

    it("preserves incomplete lines when applying diff", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input test [
 */
function test(execute: boolean) {}`;
      const diff = { added: [{ name: "y", type: "NUMBER", direction: "INPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input test ["); // Preserved!
      expect(result).toContain("@input y");
    });

    it("updates label in existing port tag without regenerating", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x - Old Label
 */
function test(execute: boolean, x: number) {}`;
      const diff = { added: [], removed: [], renamed: [], labelChanged: [{ name: "x", label: "New Label", direction: "INPUT" as const, type: "NUMBER" }], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input x - New Label");
      expect(result).not.toContain("Old Label");
    });

    it("renames port in JSDoc", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input oldName - My Label
 */
function test(execute: boolean, oldName: number) {}`;
      const diff = { added: [], removed: [], renamed: [{ from: "oldName", to: "newName", direction: "INPUT" as const }], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input newName - My Label");
      expect(result).not.toContain("@input oldName");
    });

    it("handles output port operations", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function test(execute: boolean): { result: number } {}`;
      const diff = { added: [{ name: "count", type: "NUMBER", direction: "OUTPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@output result");
      expect(result).toContain("@output count");
    });

    it("adds label to port without existing label", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`;
      const diff = { added: [], removed: [], renamed: [], labelChanged: [{ name: "x", label: "X Value", direction: "INPUT" as const, type: "NUMBER" }], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input x - X Value");
    });

    it("handles empty diff (no changes)", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`;
      const diff = { added: [], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toBe(code);
    });

    it("updates INPUT port type in function signature", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x - X Value
 */
function test(execute: boolean, x: number) {}`;
      const diff = { added: [], removed: [], renamed: [], labelChanged: [], typeChanged: [{ name: "x", type: "STRING", direction: "INPUT" as const }] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("x: string)");
      expect(result).not.toContain("x: number");
    });

    it("updates OUTPUT port type in return type", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function test(execute: boolean): { result: number } {}`;
      const diff = { added: [], removed: [], renamed: [], labelChanged: [], typeChanged: [{ name: "result", type: "STRING", direction: "OUTPUT" as const }] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("result: string");
      expect(result).not.toContain("result: number");
    });

    it("updates INPUT port type from ANY to NUMBER", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input value
 */
function test(execute: boolean, value: any) {}`;
      const diff = { added: [], removed: [], renamed: [], labelChanged: [], typeChanged: [{ name: "value", type: "NUMBER", direction: "INPUT" as const }] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("value: number)");
    });

    it("updates multiple INPUT port types", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 */
function test(execute: boolean, a: any, b: any) {}`;
      const diff = {
        added: [], removed: [], renamed: [], labelChanged: [],
        typeChanged: [
          { name: "a", type: "NUMBER", direction: "INPUT" as const },
          { name: "b", type: "STRING", direction: "INPUT" as const }
        ]
      };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("a: number,");
      expect(result).toContain("b: string)");
    });

    it("can change standard FUNCTION type to other types", () => {
      // The standard function type we generate is: (...args: any[]) => any
      // This should be changeable to other types
      const code = `/**
 * @flowWeaver nodeType
 * @input callback
 */
function test(execute: boolean, callback: (...args: any[]) => any) {}`;

      // Change from FUNCTION to STRING
      const diff = {
        added: [], removed: [], renamed: [], labelChanged: [],
        typeChanged: [{ name: "callback", type: "STRING", direction: "INPUT" as const }]
      };
      const result = applyPortsDiffToCode(code, diff);

      // Should successfully change to string
      expect(result).toContain("callback: string)");
      expect(result).not.toContain("(...args: any[]) => any");
    });

    it("does NOT corrupt complex function types when changing type", () => {
      // Complex function types with specific params should be preserved
      // (user defined these manually, don't mess with them)
      const code = `/**
 * @flowWeaver nodeType
 * @input callback
 */
function test(execute: boolean, callback: (a: string, b: number) => boolean) {}`;

      // Try to change callback type from FUNCTION to STRING
      const diff = {
        added: [], removed: [], renamed: [], labelChanged: [],
        typeChanged: [{ name: "callback", type: "STRING", direction: "INPUT" as const }]
      };
      const result = applyPortsDiffToCode(code, diff);

      // Should NOT corrupt the code - complex function type should remain unchanged
      expect(result).toContain("callback: (a: string, b: number) => boolean)");
      expect(result).not.toContain("callback: string");
    });

    it("adds new port then changes its type (full flow)", () => {
      // Step 1: Start with code that has no custom ports
      const initialCode = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`;

      // Step 2: Add a new port
      const addDiff = {
        added: [{ name: "value", type: "ANY", direction: "INPUT" as const }],
        removed: [], renamed: [], labelChanged: [], typeChanged: []
      };
      let code = applyPortsDiffToCode(initialCode, addDiff);
      code = syncJSDocToSignature(code);

      // Verify port was added (syncJSDocToSignature adds return type too)
      expect(code).toContain("@input value");
      expect(code).toContain("value: any");

      // Step 3: Change the port type
      const typeDiff = {
        added: [], removed: [], renamed: [], labelChanged: [],
        typeChanged: [{ name: "value", type: "STRING", direction: "INPUT" as const }]
      };
      code = applyPortsDiffToCode(code, typeDiff);

      // Verify type was changed
      expect(code).toContain("value: string");
      expect(code).not.toContain("value: any");
    });

    it("preserves trailing incomplete bracket syntax", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input name [
 */
function test(execute: boolean) {}`;
      // User is typing optional syntax - should not be touched
      const diff = { added: [], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input name [");
    });

    it("adds port with label", () => {
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`;
      const diff = { added: [{ name: "x", type: "NUMBER", direction: "INPUT" as const, label: "X Value" }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input x - X Value");
    });

    it("adds port with placement metadata", () => {
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`;
      const diff = { added: [{ name: "x", type: "NUMBER", direction: "INPUT" as const, placement: "TOP" }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input x [placement:TOP]");
    });

    it("adds port with both placement and label", () => {
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean) {}`;
      const diff = { added: [{ name: "y", type: "BOOLEAN", direction: "OUTPUT" as const, placement: "BOTTOM", label: "Result" }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@output y [placement:BOTTOM] - Result");
    });

    it("adds scoped INPUT with placement metadata", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @scope inner
 */
function test(execute: boolean, inner: (item: any) => { success: boolean }) {}`;
      const diff = { added: [{ name: "customSuccess", type: "STEP", direction: "INPUT" as const, scope: "inner", placement: "TOP" }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@input customSuccess scope:inner [placement:TOP]");
    });

    it("adds scoped OUTPUT with placement metadata", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @scope inner
 */
function test(execute: boolean, inner: (item: any) => { success: boolean }) {}`;
      const diff = { added: [{ name: "customStart", type: "STEP", direction: "OUTPUT" as const, scope: "inner", placement: "BOTTOM" }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);
      expect(result).toContain("@output customStart scope:inner [placement:BOTTOM]");
    });

    it("does NOT add duplicate port when incomplete line exists", () => {
      // User is typing: @input test [
      // Parser sees 'test' port, diff says "add test"
      // But we should NOT add it because it already exists (incomplete)
      const code = `/**
 * @flowWeaver nodeType
 * @input test [
 */
function test(execute: boolean) {}`;
      const diff = { added: [{ name: "test", type: "ANY", direction: "INPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);

      // Should preserve the incomplete line
      expect(result).toContain("@input test [");

      // Should NOT have a duplicate test port
      const testMatches = result.match(/@input.*test/g) || [];
      expect(testMatches.length).toBe(1);
    });

    it("does NOT add duplicate port when complete line exists", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x - X Value
 */
function test(execute: boolean, x: number) {}`;
      const diff = { added: [{ name: "x", type: "NUMBER", direction: "INPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);

      // Should NOT have a duplicate x port
      const xMatches = result.match(/@input.*\bx\b/g) || [];
      expect(xMatches.length).toBe(1);
    });

    it("USER BUG: adds new port on its own line, not concatenated to previous line", () => {
      // This was a bug where the new @input tag was being concatenated to the
      // end of the previous @output line instead of being on its own line
      // NOTE: The test data has scoped input before scoped output (wrong order).
      // The external input correctly goes BEFORE first scoped output.
      const code = `/**
 * @flowWeaver nodeType
 * @label For Each
 * @input test
 * @input items [order:1] - Array to iterate
 * @input processed scope:iteration [order:2] - Processed value from scope
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - All processed results
 */
function forEach() {}`;
      const diff = { added: [{ name: "newPort", type: "STEP", direction: "INPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
      const result = applyPortsDiffToCode(code, diff);

      // Should NOT have @output and @input on same line
      expect(result).not.toContain("results * @input");
      expect(result).not.toContain("results *\n@input");

      // Order: External Inputs → Scoped Outputs → Scoped Inputs → External Outputs
      // newPort is external input, goes BEFORE first scoped output (item scope:iteration)
      // Since test data has scoped input before scoped output, newPort goes after scoped input
      expect(result).toContain(" * @input newPort\n * @output item scope:iteration");

      // No extra blank lines before */
      expect(result).not.toContain("\n\n */");
    });

    describe("applyPortsDiffToCode ordering: external inputs → scoped outputs → scoped inputs → external outputs", () => {
      const baseCode = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input items
 * @output item scope:iteration
 * @input processed scope:iteration
 * @output results
 */
function forEach() {}`;

      it("adds scoped OUTPUT before scoped inputs", () => {
        const diff = { added: [{ name: "newScopedOut", type: "STEP", direction: "OUTPUT" as const, scope: "iteration" }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
        const result = applyPortsDiffToCode(baseCode, diff);

        // newScopedOut should be BEFORE processed (scoped input)
        const lines = result.split("\n").filter(l => /@(input|output)/.test(l));
        const newScopedOutIdx = lines.findIndex(l => l.includes("newScopedOut"));
        const processedIdx = lines.findIndex(l => l.includes("processed"));
        expect(newScopedOutIdx).toBeLessThan(processedIdx);
      });

      it("adds scoped OUTPUT before external outputs", () => {
        const diff = { added: [{ name: "newScopedOut", type: "STEP", direction: "OUTPUT" as const, scope: "iteration" }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
        const result = applyPortsDiffToCode(baseCode, diff);

        // newScopedOut should be BEFORE results (external output)
        const lines = result.split("\n").filter(l => /@(input|output)/.test(l));
        const newScopedOutIdx = lines.findIndex(l => l.includes("newScopedOut"));
        const resultsIdx = lines.findIndex(l => l.includes("results"));
        expect(newScopedOutIdx).toBeLessThan(resultsIdx);
      });

      it("adds scoped INPUT before external outputs", () => {
        const diff = { added: [{ name: "newScopedIn", type: "STEP", direction: "INPUT" as const, scope: "iteration" }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
        const result = applyPortsDiffToCode(baseCode, diff);

        // newScopedIn should be BEFORE results (external output)
        const lines = result.split("\n").filter(l => /@(input|output)/.test(l));
        const newScopedInIdx = lines.findIndex(l => l.includes("newScopedIn"));
        const resultsIdx = lines.findIndex(l => l.includes("results"));
        expect(newScopedInIdx).toBeLessThan(resultsIdx);
      });

      it("adds external OUTPUT at end", () => {
        const diff = { added: [{ name: "newExtOut", type: "NUMBER", direction: "OUTPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
        const result = applyPortsDiffToCode(baseCode, diff);

        // newExtOut should be at the end (last port line before */)
        const lines = result.split("\n").filter(l => /@(input|output)/.test(l));
        expect(lines[lines.length - 1]).toContain("newExtOut");
      });

      it("adds external INPUT before scoped inputs", () => {
        const diff = { added: [{ name: "newExtIn", type: "NUMBER", direction: "INPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
        const result = applyPortsDiffToCode(baseCode, diff);

        // newExtIn should be BEFORE processed (scoped input)
        const lines = result.split("\n").filter(l => /@(input|output)/.test(l));
        const newExtInIdx = lines.findIndex(l => l.includes("newExtIn"));
        const processedIdx = lines.findIndex(l => l.includes("processed"));
        expect(newExtInIdx).toBeLessThan(processedIdx);
      });

      it("adds external INPUT before scoped OUTPUTS (full ordering)", () => {
        // This tests the full expected order:
        // External Inputs → Scoped Outputs → Scoped Inputs → External Outputs
        const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:iteration
 * @output item scope:iteration
 * @input success scope:iteration
 * @output onSuccess
 */
function forEach() {}`;

        const diff = { added: [{ name: "newExtInput", type: "STRING", direction: "INPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
        const result = applyPortsDiffToCode(code, diff);

        // Expected exact result:
        const expected = `/**
 * @flowWeaver nodeType
 * @input items
 * @input newExtInput
 * @output start scope:iteration
 * @output item scope:iteration
 * @input success scope:iteration
 * @output onSuccess
 */
function forEach() {}`;

        expect(result).toBe(expected);
      });

      it("adds external INPUT with correct spacing (single space before asterisk)", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test() {}`;

        const diff = { added: [{ name: "y", type: "STRING", direction: "INPUT" as const }], removed: [], renamed: [], labelChanged: [], typeChanged: [] };
        const result = applyPortsDiffToCode(code, diff);

        // Expected exact result with correct spacing:
        const expected = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test() {}`;

        expect(result).toBe(expected);
      });
    });

    it("scoped port uses callback param name as scope (e.g., processItem not inner)", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @input processed scope:processItem - Processed value
 * @output item scope:processItem - Current item
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { processed: any }) {}`;

      // Adding a new scoped OUTPUT port should use the existing scope name "processItem"
      const diff = {
        added: [{ name: "newPort", type: "STEP", direction: "OUTPUT" as const, scope: "processItem" }],
        removed: [],
        renamed: [],
        labelChanged: [],
        typeChanged: []
      };
      const result = applyPortsDiffToCode(code, diff);

      // Should have scope:processItem, NOT scope:inner
      expect(result).toContain("@output newPort scope:processItem");
      expect(result).not.toContain("scope:inner");
    });
  });

  describe("scope validation", () => {
    it("scope is accepted when callback creates scope context (even with different name)", () => {
      // scope:iteration is accepted because there IS a callback (processItem) creating scope context
      // The system is lenient - users can use different naming conventions
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @output item scope:iteration - Current item
 */
function forEach(execute: boolean, items: any[], processItem: (execute: boolean, item: any) => { processed: any }) {}`;

      const { outputs } = parsePortsFromFunctionText(code);

      // The port should be parsed WITH its scope attribute preserved
      // because there's a callback parameter creating scope context
      const itemPort = outputs["item"];
      expect(itemPort).toBeDefined();
      expect(itemPort?.scope).toBe("iteration");
    });

    it("scope name matching callback parameter is preserved", () => {
      // scope:processItem is VALID because it matches the callback param name
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @output item scope:processItem - Current item
 */
function forEach(execute: boolean, items: any[], processItem: (execute: boolean, item: any) => { processed: any }) {}`;

      const { outputs } = parsePortsFromFunctionText(code);

      const itemPort = outputs["item"];
      expect(itemPort).toBeDefined();
      expect(itemPort?.scope).toBe("processItem");
    });

    it("FUNCTION port should not be added as callback parameter", () => {
      // The FUNCTION port defines the callback itself, not a parameter to it
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @output processItem scope:processItem
 * @input success scope:processItem
 * @input failure scope:processItem
 * @input processed scope:processItem
 * @output results
 */
function forEach(execute: boolean, items: any[], processItem: (start: boolean, item: any) => { success: boolean; failure: boolean; processed: any }) {}`;

      const result = syncJSDocToSignature(code);

      // processItem should NOT appear inside its own callback parameters
      // Correct: processItem: (start: boolean, item: any) => ...
      // Wrong: processItem: (start: boolean, item: any, processItem: ...) => ...
      expect(result).not.toMatch(/processItem:\s*\([^)]*processItem:/);

      // The callback should only have start and item as parameters
      expect(result).toMatch(/processItem:\s*\(start:\s*boolean,\s*item:\s*any\)\s*=>/);
    });
  });

  describe("@scope tag declaration", () => {
    it("should parse @scope tag and use it for valid scope names", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @input success scope:processItem
 * @input processed scope:processItem
 * @output results
 */
function forEach(execute: boolean, items: any[], processItem: (start: boolean, item: any) => { success: boolean; processed: any }) {}`;

      const { inputs, outputs } = parsePortsFromFunctionText(code);

      // Scoped ports should be recognized via @scope declaration
      expect(outputs["start"]?.scope).toBe("processItem");
      expect(outputs["item"]?.scope).toBe("processItem");
      expect(inputs["success"]?.scope).toBe("processItem");
      expect(inputs["processed"]?.scope).toBe("processItem");
    });

    it("should accept scope:X when callback creates scope context (no @scope tag needed)", () => {
      // Even without @scope declaration, scope is accepted because callback parameter creates context
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:iteration
 * @output item scope:iteration
 * @output results
 */
function forEach(execute: boolean, items: any[], callback: (start: boolean, item: any) => any) {}`;

      const { outputs } = parsePortsFromFunctionText(code);

      // With callback parameter, scope is accepted - lenient behavior
      expect(outputs["start"]?.scope).toBe("iteration");
      expect(outputs["item"]?.scope).toBe("iteration");
    });

    it("should reject scope:X when NO scope context exists at all", () => {
      // Without @scope declaration AND without callback, scope should be rejected
      const code = `/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:undeclared
 * @output item scope:undeclared
 * @output results
 */
function test(execute: boolean, items: any[]) {}`;

      const { outputs } = parsePortsFromFunctionText(code);

      // Without any scope context, scope:undeclared should be rejected
      expect(outputs["start"]?.scope).toBeUndefined();
      expect(outputs["item"]?.scope).toBeUndefined();
    });

    it("should accept scope when @scope is declared even without matching callback param", () => {
      // @scope declaration is the source of truth, not callback param inference
      const code = `/**
 * @flowWeaver nodeType
 * @scope myScope
 * @output start scope:myScope
 */
function test(execute: boolean) {}`;

      const { outputs } = parsePortsFromFunctionText(code);

      // With @scope declaration, scope should be accepted
      expect(outputs["start"]?.scope).toBe("myScope");
    });
  });
});
