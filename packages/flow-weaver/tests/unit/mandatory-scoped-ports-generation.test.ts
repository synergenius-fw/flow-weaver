/**
 * Test mandatory scoped ports auto-generation
 * When @scope is declared, mandatory ports (start, success, failure) should be auto-generated
 */

import { parsePortsFromFunctionText, syncSignatureToJSDoc } from "../../src/jsdoc-port-sync";

describe("Mandatory Scoped Ports Generation", () => {
  describe("parsePortsFromFunctionText", () => {
    it("should NOT auto-generate mandatory scoped ports when parsing (parsing only extracts what exists)", () => {
      // Parser should only extract what's explicitly declared
      const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input items
 * @output item scope:iteration
 * @output results
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => { success: boolean; failure: boolean; processed: any }) {}`;

      const { inputs, outputs } = parsePortsFromFunctionText(code);

      // Parser extracts what's there - it does NOT generate missing mandatory ports
      expect(outputs["item"]).toBeDefined();
      expect(outputs["item"]?.scope).toBe("iteration");
      expect(outputs["results"]).toBeDefined();

      // These are NOT in the JSDoc, so parser should NOT find them
      expect(outputs["start"]).toBeUndefined();
      expect(inputs["success"]).toBeUndefined();
      expect(inputs["failure"]).toBeUndefined();
    });
  });

  describe("syncSignatureToJSDoc", () => {
    it("should generate mandatory scoped OUTPUT port (start) when @scope is declared", () => {
      // User declares @scope iteration, but only has @output item
      // The mandatory 'start' port should be auto-generated
      const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input items
 * @output item scope:iteration - Current item
 * @output results
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => { success: boolean; failure: boolean; processed: any }) {}`;

      const result = syncSignatureToJSDoc(code);

      // The mandatory 'start' port should be added to JSDoc
      expect(result).toContain("@output start scope:iteration");
    });

    it("should generate mandatory scoped INPUT ports (success, failure) when @scope is declared", () => {
      // User declares @scope iteration but doesn't have success/failure
      const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input items
 * @input processed scope:iteration - Processed value
 * @output start scope:iteration
 * @output item scope:iteration
 * @output results
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => { success: boolean; failure: boolean; processed: any }) {}`;

      const result = syncSignatureToJSDoc(code);

      // The mandatory 'success' and 'failure' ports should be added to JSDoc
      expect(result).toContain("@input success scope:iteration");
      expect(result).toContain("@input failure scope:iteration");
    });

    it("should generate ALL mandatory scoped ports when only @scope is declared", () => {
      // User only declares @scope but no scoped ports at all
      const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input items
 * @output results
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => { success: boolean; failure: boolean }) {}`;

      const result = syncSignatureToJSDoc(code);

      // ALL mandatory scoped ports should be auto-generated
      expect(result).toContain("@output start scope:iteration");
      expect(result).toContain("@input success scope:iteration");
      expect(result).toContain("@input failure scope:iteration");
    });

    it("should NOT duplicate mandatory scoped ports if they already exist", () => {
      // User already has all mandatory ports declared
      const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input items
 * @output start scope:iteration - Start control
 * @output item scope:iteration - Current item
 * @input success scope:iteration - Success signal
 * @input failure scope:iteration - Failure signal
 * @input processed scope:iteration - Processed value
 * @output results
 */
function forEach(execute: boolean, items: any[], iteration: (start: boolean, item: any) => { success: boolean; failure: boolean; processed: any }) {}`;

      const result = syncSignatureToJSDoc(code);

      // Count occurrences - should be exactly 1 of each
      const startMatches = result.match(/@output start scope:iteration/g);
      const successMatches = result.match(/@input success scope:iteration/g);
      const failureMatches = result.match(/@input failure scope:iteration/g);

      expect(startMatches?.length).toBe(1);
      expect(successMatches?.length).toBe(1);
      expect(failureMatches?.length).toBe(1);
    });

    it("should only generate mandatory ports for the last declared scope (port names must be unique)", () => {
      // Multiple scopes declared - but port names are unique, so only the last scope's mandatory ports are generated
      // This is a design limitation: start/success/failure can only exist once per node
      const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 * @scope validation
 * @input items
 * @output item scope:iteration
 * @output data scope:validation
 * @output results
 */
function complexNode(
  execute: boolean,
  items: any[],
  iteration: (start: boolean, item: any) => { success: boolean; failure: boolean; processed: any },
  validation: (start: boolean, data: any) => { success: boolean; failure: boolean; valid: boolean }
) {}`;

      const result = syncSignatureToJSDoc(code);

      // Since port names must be unique, only the last declared scope's mandatory ports are generated
      // The 'validation' scope was declared last, so its mandatory ports take precedence
      expect(result).toContain("@output start scope:validation");
      expect(result).toContain("@input success scope:validation");
      expect(result).toContain("@input failure scope:validation");

      // The 'iteration' scope's mandatory ports are NOT generated because port names would conflict
      // Nodes with multiple scopes should manually declare their scoped mandatory ports
    });
  });
});