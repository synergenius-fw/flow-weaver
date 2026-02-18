/**
 * Test scope detection utilities
 */

import { hasScopes, getScopeNames } from "../../src/jsdoc-port-sync";

describe("Scope Detection", () => {
  describe("hasScopes", () => {
    it("returns true when @scope is declared", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 */
function forEach(execute: boolean, items: any[]) {}`;

      expect(hasScopes(code)).toBe(true);
    });

    it("returns false when no @scope is declared", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function add(execute: boolean, x: number) {}`;

      expect(hasScopes(code)).toBe(false);
    });

    it("returns false when no JSDoc exists", () => {
      const code = `function add(x: number) { return x + 1; }`;

      expect(hasScopes(code)).toBe(false);
    });

    it("returns true with multiple @scope declarations", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @scope validation
 * @input items
 */
function complexNode(execute: boolean, items: any[]) {}`;

      expect(hasScopes(code)).toBe(true);
    });
  });

  describe("getScopeNames", () => {
    it("returns scope name when @scope is declared", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 */
function forEach(execute: boolean, items: any[]) {}`;

      expect(getScopeNames(code)).toEqual(["processItem"]);
    });

    it("returns empty array when no @scope is declared", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function add(execute: boolean, x: number) {}`;

      expect(getScopeNames(code)).toEqual([]);
    });

    it("returns multiple scope names", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @scope validation
 * @input items
 */
function complexNode(execute: boolean, items: any[]) {}`;

      expect(getScopeNames(code)).toEqual(["iteration", "validation"]);
    });

    it("returns empty array when no JSDoc exists", () => {
      const code = `function add(x: number) { return x + 1; }`;

      expect(getScopeNames(code)).toEqual([]);
    });
  });
});
