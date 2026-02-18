/**
 * Test that signature params are preserved when JSDoc doesn't have @input tags
 * USER BUG: Adding comma to param removes the entire param line
 */

import { syncJSDocToSignature } from "../../src/jsdoc-port-sync";

describe("Signature Parameter Preservation", () => {
  describe("USER BUG: Adding comma to param should not remove it", () => {
    it("should NOT remove param from signature when @input tag is missing in JSDoc", () => {
      // User has a param in signature but no @input tag in JSDoc
      // Adding comma should NOT remove the param
      const code = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @output result
 */
function forEach(
  execute: boolean,
  items: string,
  processItem: (start: boolean) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }): { onSuccess: boolean; onFailure: boolean; result: string[] } {
  return { onSuccess: true, onFailure: false, results: [] };
}`;

      const result = syncJSDocToSignature(code);

      // items param should be preserved even without @input items in JSDoc
      expect(result).toContain("items: string");
    });

    it("should preserve param without @input when user is typing", () => {
      // User is typing a new param in signature without JSDoc yet
      const code = `/**
 * @flowWeaver nodeType
 */
function test(execute: boolean, x: number, y: string) {}`;

      const result = syncJSDocToSignature(code);

      // All params should be preserved even without @input tags
      expect(result).toContain("x: number");
      expect(result).toContain("y: string");
    });

    it("should preserve multiline param when completing with comma", () => {
      // Specific reproduction case from user
      const before = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @output result
 */
function forEach(
  execute: boolean,
  items: string
  processItem: (start: boolean) => {
    success: boolean;
    failure: boolean;
  }): { onSuccess: boolean; onFailure: boolean; result: string[] } {
  return { onSuccess: true, onFailure: false };
}`;

      const after = `/**
 * @flowWeaver nodeType
 * @scope processItem
 * @output result
 */
function forEach(
  execute: boolean,
  items: string,
  processItem: (start: boolean) => {
    success: boolean;
    failure: boolean;
  }): { onSuccess: boolean; onFailure: boolean; result: string[] } {
  return { onSuccess: true, onFailure: false };
}`;

      // Before comma - items might not be parsed as valid param
      const resultBefore = syncJSDocToSignature(before);

      // After comma - items is now valid param but has no @input
      const resultAfter = syncJSDocToSignature(after);

      // CRITICAL: items should NOT be removed after adding comma
      expect(resultAfter).toContain("items: string,");
    });
  });
});
