/**
 * Tests for src/validation/type-checker.ts:
 * - checkTypeCompatibilityFromStrings (the string-based check the validator uses)
 * - isRuntimeCoercible case-insensitivity and the shared SAFE_COERCIONS table
 */

import {
  checkTypeCompatibilityFromStrings,
  isRuntimeCoercible,
  SAFE_COERCIONS,
} from "../../src/validation/type-checker";

describe("type-checker coverage", () => {
  // ── checkTypeCompatibilityFromStrings ───────────────────────────

  describe("checkTypeCompatibilityFromStrings", () => {
    it("returns exact for identical types", () => {
      const result = checkTypeCompatibilityFromStrings("string", "string");
      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("exact");
      expect(result.sourceType).toBe("string");
      expect(result.targetType).toBe("string");
    });

    it("returns exact for complex identical type strings", () => {
      const result = checkTypeCompatibilityFromStrings(
        "{ name: string; age: number }",
        "{ name: string; age: number }",
      );
      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("exact");
    });

    it("returns assignable when source is any", () => {
      const result = checkTypeCompatibilityFromStrings("any", "number");
      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("assignable");
      expect(result.sourceType).toBe("any");
      expect(result.targetType).toBe("number");
    });

    it("returns assignable when target is any", () => {
      const result = checkTypeCompatibilityFromStrings("string", "any");
      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("assignable");
    });

    it("returns coercible for number to string", () => {
      const result = checkTypeCompatibilityFromStrings("number", "string");
      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("coercible");
    });

    it("returns coercible for boolean to string", () => {
      const result = checkTypeCompatibilityFromStrings("boolean", "string");
      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("coercible");
    });

    it("returns incompatible for string to number", () => {
      const result = checkTypeCompatibilityFromStrings("string", "number");
      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
      expect(result.errorMessage).toContain("not assignable");
      expect(result.errorMessage).toContain("string");
      expect(result.errorMessage).toContain("number");
    });

    it("returns incompatible for unrelated object types", () => {
      const result = checkTypeCompatibilityFromStrings(
        "{ x: number }",
        "{ y: string }",
      );
      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
    });

    it("returns incompatible for boolean to number", () => {
      const result = checkTypeCompatibilityFromStrings("boolean", "number");
      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
    });
  });

  // ── isRuntimeCoercible case handling ────────────────────────────

  describe("isRuntimeCoercible case-insensitivity", () => {
    it("handles uppercase source and target", () => {
      expect(isRuntimeCoercible("NUMBER", "STRING")).toBe(true);
    });

    it("handles mixed case", () => {
      expect(isRuntimeCoercible("Number", "String")).toBe(true);
      expect(isRuntimeCoercible("Boolean", "String")).toBe(true);
    });

    it("rejects coercions not in the safe list", () => {
      expect(isRuntimeCoercible("string", "boolean")).toBe(false);
      expect(isRuntimeCoercible("number", "boolean")).toBe(false);
      expect(isRuntimeCoercible("object", "string")).toBe(false);
    });

    it("agrees with the SAFE_COERCIONS table the validator shares", () => {
      expect(SAFE_COERCIONS).toEqual([
        ["NUMBER", "STRING"],
        ["BOOLEAN", "STRING"],
      ]);
      for (const [from, to] of SAFE_COERCIONS) {
        expect(isRuntimeCoercible(from, to)).toBe(true);
      }
    });
  });

  // ── Result shape verification ──────────────────────────────────

  describe("result object shapes", () => {
    it("incompatible result includes errorMessage with type names", () => {
      const result = checkTypeCompatibilityFromStrings(
        "Date",
        "RegExp",
      );
      expect(result.isCompatible).toBe(false);
      expect(result.errorMessage).toBe(
        "Type 'Date' is not assignable to type 'RegExp'",
      );
    });

    it("compatible results do not include errorMessage", () => {
      const result = checkTypeCompatibilityFromStrings("any", "number");
      expect(result.errorMessage).toBeUndefined();
    });
  });
});
