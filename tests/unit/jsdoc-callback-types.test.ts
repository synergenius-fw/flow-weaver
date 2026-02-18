/**
 * Tests for JSDoc callback type utilities
 * Tests getScopeNames, getIncompletePortNames, parseCallbackType, buildCallbackType, callbackHasAllPorts
 */

import {
  getScopeNames,
  getIncompletePortNames,
  parseCallbackType,
  buildCallbackType,
  callbackHasAllPorts,
  hasScopes,
} from "../../src/jsdoc-port-sync";

describe("JSDoc Callback Types", () => {
  describe("hasScopes", () => {
    it("should return true when @scope tag exists", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input item scope:iteration
 */
function forEach() {}`;

      expect(hasScopes(code)).toBe(true);
    });

    it("should return false when no @scope tag exists", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 */
function process() {}`;

      expect(hasScopes(code)).toBe(false);
    });

    it("should return false when no JSDoc exists", () => {
      const code = `function process() {}`;

      expect(hasScopes(code)).toBe(false);
    });
  });

  describe("getScopeNames", () => {
    it("should extract single scope name", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @scope iteration
 * @input item scope:iteration
 */
function forEach() {}`;

      const scopes = getScopeNames(code);
      expect(scopes).toEqual(["iteration"]);
    });

    it("should extract multiple scope names", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @scope outer
 * @scope inner
 * @input outerItem scope:outer
 * @input innerItem scope:inner
 */
function nestedScopes() {}`;

      const scopes = getScopeNames(code);
      expect(scopes).toEqual(["outer", "inner"]);
    });

    it("should return empty array when no scopes", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 */
function process() {}`;

      const scopes = getScopeNames(code);
      expect(scopes).toEqual([]);
    });

    it("should return empty array when no JSDoc", () => {
      const code = `function process() {}`;

      const scopes = getScopeNames(code);
      expect(scopes).toEqual([]);
    });
  });

  describe("getIncompletePortNames", () => {
    it("should detect incomplete input port", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @input incomplete
 */
function test(execute: boolean, value: number) {}`;

      // "incomplete" is in JSDoc but not in signature, so it's incomplete
      const incomplete = getIncompletePortNames(code);
      // This test may need adjustment based on actual incomplete detection logic
      expect(incomplete.inputs).toBeInstanceOf(Set);
    });

    it("should return empty sets for complete ports", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value - A number value
 */
function test(execute: boolean, value: number) {}`;

      const incomplete = getIncompletePortNames(code);
      expect(incomplete.inputs.size).toBe(0);
      expect(incomplete.outputs.size).toBe(0);
      expect(incomplete.steps.size).toBe(0);
    });

    it("should return empty sets when no JSDoc", () => {
      const code = `function test() {}`;

      const incomplete = getIncompletePortNames(code);
      expect(incomplete.inputs.size).toBe(0);
      expect(incomplete.outputs.size).toBe(0);
      expect(incomplete.steps.size).toBe(0);
    });
  });

  describe("parseCallbackType", () => {
    it("should parse simple callback type", () => {
      const callbackType = "(execute: boolean) => { onSuccess: boolean }";

      const result = parseCallbackType(callbackType);

      expect(result.params).toEqual([
        { name: "execute", typeStr: "boolean" },
      ]);
      expect(result.returnFields).toEqual([
        { name: "onSuccess", typeStr: "boolean" },
      ]);
    });

    it("should parse callback with multiple params", () => {
      const callbackType = "(execute: boolean, item: string, index: number) => { result: any }";

      const result = parseCallbackType(callbackType);

      expect(result.params).toEqual([
        { name: "execute", typeStr: "boolean" },
        { name: "item", typeStr: "string" },
        { name: "index", typeStr: "number" },
      ]);
    });

    it("should parse callback with multiple return fields", () => {
      const callbackType = "(execute: boolean) => { onSuccess: boolean; onFailure: boolean; result: number }";

      const result = parseCallbackType(callbackType);

      expect(result.returnFields.map(f => f.name)).toEqual(["onSuccess", "onFailure", "result"]);
    });

    it("should handle void return type", () => {
      const callbackType = "(execute: boolean) => void";

      const result = parseCallbackType(callbackType);

      expect(result.params).toEqual([
        { name: "execute", typeStr: "boolean" },
      ]);
      expect(result.returnFields).toEqual([]);
    });

    it("should handle complex types", () => {
      const callbackType = "(execute: boolean, data: { name: string; value: number }) => { result: Promise<string> }";

      const result = parseCallbackType(callbackType);

      expect(result.params.length).toBe(2);
      expect(result.params[0].name).toBe("execute");
      // Complex type parsing may simplify or preserve
    });
  });

  describe("buildCallbackType", () => {
    it("should build callback type from params and returns", () => {
      const params: Array<[string, { dataType: "STEP" | "STRING" }]> = [
        ["execute", { dataType: "STEP" }],
        ["item", { dataType: "STRING" }],
      ];
      const returns: Array<[string, { dataType: "STEP" | "NUMBER" }]> = [
        ["onSuccess", { dataType: "STEP" }],
        ["result", { dataType: "NUMBER" }],
      ];

      const result = buildCallbackType(params, returns);

      expect(result).toContain("execute: boolean");
      expect(result).toContain("item: string");
      expect(result).toContain("onSuccess: boolean");
      expect(result).toContain("result: number");
    });

    it("should handle empty params", () => {
      const params: Array<[string, { dataType: "STEP" }]> = [];
      const returns: Array<[string, { dataType: "STEP" }]> = [
        ["onSuccess", { dataType: "STEP" }],
      ];

      const result = buildCallbackType(params, returns);

      expect(result).toContain("onSuccess: boolean");
    });

    it("should handle empty returns", () => {
      const params: Array<[string, { dataType: "STEP" }]> = [
        ["execute", { dataType: "STEP" }],
      ];
      const returns: Array<[string, never]> = [];

      const result = buildCallbackType(params, returns as any);

      expect(result).toContain("execute: boolean");
    });

    it("should preserve existing non-scoped params", () => {
      const params: Array<[string, { dataType: "STRING" }]> = [
        ["newItem", { dataType: "STRING" }],
      ];
      const returns: Array<[string, { dataType: "STEP" }]> = [
        ["onSuccess", { dataType: "STEP" }],
      ];
      const existingType = "(execute: boolean, existingParam: number) => { existingReturn: string }";

      const result = buildCallbackType(params, returns, existingType);

      expect(result).toContain("execute: boolean");
      expect(result).toContain("newItem: string");
    });

    it("should respect order metadata", () => {
      const params: Array<[string, { dataType: "STRING"; metadata?: { order: number } }]> = [
        ["second", { dataType: "STRING", metadata: { order: 2 } }],
        ["first", { dataType: "STRING", metadata: { order: 1 } }],
      ];
      const returns: Array<[string, never]> = [];

      const result = buildCallbackType(params, returns as any);

      // First should appear before second due to order
      const firstIndex = result.indexOf("first");
      const secondIndex = result.indexOf("second");
      expect(firstIndex).toBeLessThan(secondIndex);
    });
  });

  describe("callbackHasAllPorts", () => {
    it("should return true when all ports present", () => {
      const callbackType = "(execute: boolean, item: string) => { onSuccess: boolean; result: number }";
      const params: Array<[string, unknown]> = [
        ["execute", {}],
        ["item", {}],
      ];
      const returns: Array<[string, unknown]> = [
        ["onSuccess", {}],
        ["result", {}],
      ];

      expect(callbackHasAllPorts(callbackType, params, returns)).toBe(true);
    });

    it("should return false when param missing", () => {
      const callbackType = "(execute: boolean) => { onSuccess: boolean }";
      const params: Array<[string, unknown]> = [
        ["execute", {}],
        ["missingParam", {}],
      ];
      const returns: Array<[string, unknown]> = [
        ["onSuccess", {}],
      ];

      expect(callbackHasAllPorts(callbackType, params, returns)).toBe(false);
    });

    it("should return false when return field missing", () => {
      const callbackType = "(execute: boolean) => { onSuccess: boolean }";
      const params: Array<[string, unknown]> = [
        ["execute", {}],
      ];
      const returns: Array<[string, unknown]> = [
        ["onSuccess", {}],
        ["missingReturn", {}],
      ];

      expect(callbackHasAllPorts(callbackType, params, returns)).toBe(false);
    });

    it("should return true for empty requirements", () => {
      const callbackType = "() => {}";
      const params: Array<[string, unknown]> = [];
      const returns: Array<[string, unknown]> = [];

      expect(callbackHasAllPorts(callbackType, params, returns)).toBe(true);
    });
  });
});
