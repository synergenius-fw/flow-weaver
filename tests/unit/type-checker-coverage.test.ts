/**
 * Additional type-checker coverage tests.
 *
 * Targets uncovered lines in src/type-checker.ts, focusing on:
 * - checkTypeCompatibilityFromStrings (string-based fallback path)
 * - checkTypeCompatibility without a typeChecker argument
 * - checkTypeCompatibility with a typeChecker that lacks isTypeAssignableTo
 * - isRuntimeCoercible case-insensitivity
 * - isSubtypeViaBaseTypes error handling (getBaseTypes throwing)
 */

import { getParserProject } from "../../src/parser";
import {
  checkTypeCompatibility,
  checkTypeCompatibilityFromStrings,
  isRuntimeCoercible,
} from "../../src/type-checker";

describe("type-checker coverage", () => {
  const project = getParserProject();

  function getTypes(sourceTypeStr: string, targetTypeStr: string) {
    const sourceFile = project.createSourceFile(
      `__test-coverage-types__.ts`,
      `
        declare const source: ${sourceTypeStr};
        declare const target: ${targetTypeStr};
      `,
      { overwrite: true },
    );

    const sourceVar = sourceFile.getVariableDeclaration("source")!;
    const targetVar = sourceFile.getVariableDeclaration("target")!;

    return {
      sourceType: sourceVar.getType(),
      targetType: targetVar.getType(),
      typeChecker: project.getTypeChecker(),
    };
  }

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
  });

  // ── checkTypeCompatibility without typeChecker ──────────────────

  describe("checkTypeCompatibility without typeChecker", () => {
    it("returns exact for same types without typeChecker", () => {
      const { sourceType, targetType } = getTypes("number", "number");
      const result = checkTypeCompatibility(sourceType, targetType);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("exact");
    });

    it("returns coercible for number->string without typeChecker", () => {
      const { sourceType, targetType } = getTypes("number", "string");
      const result = checkTypeCompatibility(sourceType, targetType);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("coercible");
    });

    it("returns incompatible for string->number without typeChecker", () => {
      const { sourceType, targetType } = getTypes("string", "number");
      const result = checkTypeCompatibility(sourceType, targetType);

      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
      expect(result.errorMessage).toBeDefined();
    });
  });

  // ── checkTypeCompatibility with inheritance (isSubtypeViaBaseTypes) ──

  describe("isSubtypeViaBaseTypes via checkTypeCompatibility", () => {
    it("detects subtype via base types without typeChecker", () => {
      const sourceFile = project.createSourceFile(
        `__test-basetype-coverage__.ts`,
        `
          interface Animal { name: string; }
          interface Dog extends Animal { breed: string; }
          declare const source: Dog;
          declare const target: Animal;
        `,
        { overwrite: true },
      );

      const sourceType = sourceFile.getVariableDeclaration("source")!.getType();
      const targetType = sourceFile.getVariableDeclaration("target")!.getType();

      // Without typeChecker, falls through to isSubtypeViaBaseTypes
      const result = checkTypeCompatibility(sourceType, targetType);
      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("assignable");
    });

    it("handles deep inheritance chains without typeChecker", () => {
      const sourceFile = project.createSourceFile(
        `__test-deep-inherit__.ts`,
        `
          interface Base { id: string; }
          interface Mid extends Base { level: number; }
          interface Leaf extends Mid { detail: boolean; }
          declare const source: Leaf;
          declare const target: Base;
        `,
        { overwrite: true },
      );

      const sourceType = sourceFile.getVariableDeclaration("source")!.getType();
      const targetType = sourceFile.getVariableDeclaration("target")!.getType();

      const result = checkTypeCompatibility(sourceType, targetType);
      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("assignable");
    });

    it("returns incompatible for unrelated interfaces without typeChecker", () => {
      const sourceFile = project.createSourceFile(
        `__test-unrelated__.ts`,
        `
          interface Foo { x: number; }
          interface Bar { y: string; }
          declare const source: Foo;
          declare const target: Bar;
        `,
        { overwrite: true },
      );

      const sourceType = sourceFile.getVariableDeclaration("source")!.getType();
      const targetType = sourceFile.getVariableDeclaration("target")!.getType();

      const result = checkTypeCompatibility(sourceType, targetType);
      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
    });
  });

  // ── checkTypeCompatibility with primitive types that have no base types ──

  describe("primitive types through base-type path", () => {
    it("handles primitives that have no getBaseTypes without crashing", () => {
      const { sourceType, targetType } = getTypes("null", "undefined");
      // These primitives won't have base types; the catch blocks should handle them
      const result = checkTypeCompatibility(sourceType, targetType);
      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
    });

    it("handles void vs never", () => {
      const { sourceType, targetType } = getTypes("void", "never");
      const result = checkTypeCompatibility(sourceType, targetType);
      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
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

    it("checkTypeCompatibility incompatible result has correct errorMessage", () => {
      const { sourceType, targetType } = getTypes("string", "boolean");
      const result = checkTypeCompatibility(sourceType, targetType);

      expect(result.isCompatible).toBe(false);
      expect(result.errorMessage).toContain("not assignable");
      expect(result.sourceType).toBe("string");
      expect(result.targetType).toBe("boolean");
    });
  });
});
