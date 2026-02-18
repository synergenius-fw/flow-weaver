/**
 * Test Port Renaming utilities
 * Functions for renaming ports in JSDoc and signature
 */

import {
  renamePortInCode,
  syncCodeRenames,
} from "../../src/jsdoc-port-sync";

describe("JSDoc Port Rename", () => {
  describe("renamePortInCode", () => {
    it("should rename input port in JSDoc and parameter", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input oldName
 */
function test(execute: boolean, oldName: number) {}`;

      const result = renamePortInCode(code, "oldName", "newName", "input");
      expect(result).toContain("@input newName");
      expect(result).toContain("newName: number");
      expect(result).not.toContain("oldName");
    });

    it("should rename output port in JSDoc and return type", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output oldResult
 */
function test(execute: boolean): { oldResult: number } {}`;

      const result = renamePortInCode(code, "oldResult", "newResult", "output");
      expect(result).toContain("@output newResult");
      expect(result).toContain("newResult: number");
      expect(result).not.toContain("oldResult");
    });

    it("should preserve port label and metadata during rename", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input oldName [order:1] - My description
 */
function test(execute: boolean, oldName: number) {}`;

      const result = renamePortInCode(code, "oldName", "newName", "input");
      expect(result).toContain("@input newName [order:1] - My description");
      expect(result).toContain("newName: number");
    });

    it("should rename scoped output port in callback signature", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output oldItem scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, oldItem: any) => {}) {}`;

      const result = renamePortInCode(code, "oldItem", "newItem", "output");
      expect(result).toContain("@output newItem scope:iteration");
      expect(result).toContain("newItem: any");
    });

    it("should rename scoped input port in callback return type", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input oldProcessed scope:iteration
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean) => { oldProcessed: any }) {}`;

      const result = renamePortInCode(code, "oldProcessed", "newProcessed", "input");
      expect(result).toContain("@input newProcessed scope:iteration");
      expect(result).toContain("newProcessed: any");
    });

    it("should not allow renaming reserved names", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input execute
 */
function test(execute: boolean) {}`;

      const result = renamePortInCode(code, "execute", "run", "input");
      expect(result).toBe(code); // No change
    });

    it("should not rename if new name already exists", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input portA
 * @input portB
 */
function test(execute: boolean, portA: number, portB: string) {}`;

      const result = renamePortInCode(code, "portA", "portB", "input");
      expect(result).toBe(code); // No change - conflict
    });

    it("should not rename if old port does not exist", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input existingPort
 */
function test(execute: boolean, existingPort: number) {}`;

      const result = renamePortInCode(code, "nonExistent", "newName", "input");
      expect(result).toBe(code); // No change
    });

    it("should handle renaming with multiple ports", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @input oldName
 * @input flag
 */
function test(execute: boolean, x: number, oldName: string, flag: boolean) {}`;

      const result = renamePortInCode(code, "oldName", "newName", "input");
      expect(result).toContain("@input x");
      expect(result).toContain("@input newName");
      expect(result).toContain("@input flag");
      expect(result).toContain("x: number");
      expect(result).toContain("newName: string");
      expect(result).toContain("flag: boolean");
    });
  });

  describe("syncCodeRenames (before/after approach)", () => {
    describe("JSDoc renamed → update signature", () => {
      it("should update signature when JSDoc port renamed", () => {
        const previousCode = `/**
 * @flowWeaver nodeType
 * @input oldName
 */
function test(execute: boolean, oldName: number) {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @input newName
 */
function test(execute: boolean, oldName: number) {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        expect(result).toContain("@input newName");
        expect(result).toContain("newName: number");
        expect(result).not.toContain("oldName");
      });

      it("should handle output port renamed in JSDoc", () => {
        const previousCode = `/**
 * @flowWeaver nodeType
 * @output oldResult
 */
function test(execute: boolean): { oldResult: number } {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @output newResult
 */
function test(execute: boolean): { oldResult: number } {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        expect(result).toContain("@output newResult");
        expect(result).toContain("newResult: number");
        expect(result).not.toContain("oldResult");
      });
    });

    describe("Signature renamed → update JSDoc", () => {
      it("should update JSDoc when signature param renamed", () => {
        const previousCode = `/**
 * @flowWeaver nodeType
 * @input oldName
 */
function test(execute: boolean, oldName: number) {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @input oldName
 */
function test(execute: boolean, newName: number) {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        expect(result).toContain("@input newName");
        expect(result).toContain("newName: number");
        expect(result).not.toContain("oldName");
      });

      it("should update JSDoc when signature param renamed (with metadata)", () => {
        // USER BUG: Renaming "value" → "banana" in signature should update JSDoc
        const previousCode = `/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value [order:1] - ggdg
 * @input execute [order:0] - Execute
 * @output result [order:2] - gdsgs
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function myNode(
  execute: boolean,
  value: number,
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value [order:1] - ggdg
 * @input execute [order:0] - Execute
 * @output result [order:2] - gdsgs
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function myNode(
  execute: boolean,
  banana: number,
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}`;

        const result = syncCodeRenames(previousCode, currentCode);
        // JSDoc should update: @input value → @input banana (preserving metadata)
        expect(result).toContain("@input banana");
        expect(result).toContain("banana: number");
        expect(result).not.toContain("@input value");
      });

      it("should handle return type field renamed in signature", () => {
        const previousCode = `/**
 * @flowWeaver nodeType
 * @output oldResult
 */
function test(execute: boolean): { oldResult: number } {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @output oldResult
 */
function test(execute: boolean): { newResult: number } {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        expect(result).toContain("@output newResult");
        expect(result).toContain("newResult: number");
        expect(result).not.toContain("oldResult");
      });
    });

    describe("Conflict handling (both changed)", () => {
      it("should not sync when both JSDoc and signature changed", () => {
        const previousCode = `/**
 * @flowWeaver nodeType
 * @input original
 */
function test(execute: boolean, original: number) {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @input jsDocName
 */
function test(execute: boolean, signatureName: number) {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        // No sync - conflict, leave as-is
        expect(result).toBe(currentCode);
      });
    });

    describe("No previous code (initial load)", () => {
      it("should return current code unchanged when no previous code", () => {
        const currentCode = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, y: number) {}`;

        const result = syncCodeRenames("", currentCode);
        expect(result).toBe(currentCode);
      });
    });

    describe("Param insertion (not rename)", () => {
      it("should not treat param insertion as rename when existing param still exists", () => {
        // User added "test: string" BEFORE existing "items" param
        const previousCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; processed: any }) {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array to iterate
 */
function forEach(execute: boolean, test: string, items: any[]) {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        // Should NOT rename items → test because items still exists in signature
        // JSDoc should remain unchanged - items keeps its metadata
        expect(result).toContain("@input items [order:1] - Array to iterate");
        expect(result).not.toContain("@input test"); // Should NOT rename
      });
    });

    describe("No change scenarios", () => {
      it("should return unchanged when names already match", () => {
        const previousCode = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        expect(result).toBe(currentCode);
      });
    });

    describe("Scoped ports handling", () => {
      it("should filter scoped ports and only sync main function params", () => {
        const previousCode = `/**
 * @flowWeaver nodeType
 * @input items
 * @input item scope:inner
 * @input oldName
 */
function forEach(execute: boolean, items: any[], inner: (execute: boolean, item: string) => void, oldName: boolean) {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @input items
 * @input item scope:inner
 * @input newName
 */
function forEach(execute: boolean, items: any[], inner: (execute: boolean, item: string) => void, oldName: boolean) {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        // JSDoc renamed oldName → newName, signature should update
        expect(result).toContain("newName: boolean");
        expect(result).not.toContain("oldName: boolean");
      });
    });

    describe("Multiple ports", () => {
      it("should handle multiple port renames in one sync", () => {
        const previousCode = `/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 */
function test(execute: boolean, a: number, b: string) {}`;

        const currentCode = `/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function test(execute: boolean, a: number, b: string) {}`;

        const result = syncCodeRenames(previousCode, currentCode);
        expect(result).toContain("x: number");
        expect(result).toContain("y: string");
        expect(result).not.toContain("a: number");
        expect(result).not.toContain("b: string");
      });
    });
  });

});
