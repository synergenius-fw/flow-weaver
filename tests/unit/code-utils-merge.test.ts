/**
 * Tests for buildMergeExpression in code-utils
 */

import { buildMergeExpression } from "../../src/generator/code-utils";

describe("buildMergeExpression", () => {
  const sources = ["src1_value", "src2_value", "src3_value"];

  describe("COLLECT strategy", () => {
    it("should generate array literal", () => {
      const result = buildMergeExpression(sources, "COLLECT");
      expect(result).toBe("[src1_value, src2_value, src3_value]");
    });

    it("should handle single source", () => {
      const result = buildMergeExpression(["src1_value"], "COLLECT");
      expect(result).toBe("[src1_value]");
    });
  });

  describe("MERGE strategy", () => {
    it("should generate Object.assign", () => {
      const result = buildMergeExpression(sources, "MERGE");
      expect(result).toBe("Object.assign({}, src1_value, src2_value, src3_value)");
    });

    it("should handle single source", () => {
      const result = buildMergeExpression(["src1_value"], "MERGE");
      expect(result).toBe("Object.assign({}, src1_value)");
    });
  });

  describe("CONCAT strategy", () => {
    it("should generate flat array", () => {
      const result = buildMergeExpression(sources, "CONCAT");
      expect(result).toBe("[src1_value, src2_value, src3_value].flat()");
    });
  });

  describe("FIRST strategy", () => {
    it("should generate find for first non-undefined", () => {
      const result = buildMergeExpression(sources, "FIRST");
      expect(result).toContain("find");
      expect(result).toContain("v !== undefined");
    });
  });

  describe("LAST strategy", () => {
    it("should generate filter+pop for last non-undefined", () => {
      const result = buildMergeExpression(sources, "LAST");
      expect(result).toContain("filter");
      expect(result).toContain("pop");
    });
  });

  describe("fallback", () => {
    it("should return first source for unknown strategy", () => {
      const result = buildMergeExpression(sources, "UNKNOWN" as any);
      expect(result).toBe("src1_value");
    });

    it("should return undefined for empty sources with unknown strategy", () => {
      const result = buildMergeExpression([], "UNKNOWN" as any);
      expect(result).toBe("undefined");
    });
  });
});
