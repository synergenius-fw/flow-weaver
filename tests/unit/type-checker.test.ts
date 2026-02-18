/**
 * Type Checker Tests
 * Tests for TypeScript-level type compatibility checking using ts-morph
 */

import { getParserProject } from "../../src/parser";
import { checkTypeCompatibility, isRuntimeCoercible } from "../../src/type-checker";

describe("Type Checker", () => {
  // Reuse the shared parser Project for performance
  const project = getParserProject();

  // Helper to get Type objects from type strings — reuses a single filename
  // to avoid accumulating source files in the project
  function getTypes(sourceTypeStr: string, targetTypeStr: string) {
    const sourceFile = project.createSourceFile(
      `__test-types__.ts`,
      `
        declare const source: ${sourceTypeStr};
        declare const target: ${targetTypeStr};
      `,
      { overwrite: true }
    );

    const sourceVar = sourceFile.getVariableDeclaration("source")!;
    const targetVar = sourceFile.getVariableDeclaration("target")!;

    return {
      sourceType: sourceVar.getType(),
      targetType: targetVar.getType(),
      typeChecker: project.getTypeChecker(),
    };
  }

  describe("Exact Match", () => {
    it("should return 'exact' for identical primitive types", () => {
      const { sourceType, targetType, typeChecker } = getTypes("string", "string");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("exact");
    });

    it("should return 'exact' for identical object types", () => {
      const { sourceType, targetType, typeChecker } = getTypes(
        "{ name: string; age: number }",
        "{ name: string; age: number }"
      );
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("exact");
    });

    it("should return 'exact' for identical array types", () => {
      const { sourceType, targetType, typeChecker } = getTypes("number[]", "number[]");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("exact");
    });
  });

  describe("TypeScript Assignability", () => {
    it("should return 'assignable' for subtype to supertype (Admin extends User)", () => {
      const sourceFile = project.createSourceFile(
        `__test-assignable__.ts`,
        `
          interface User { name: string; }
          interface Admin extends User { permissions: string[]; }
          declare const source: Admin;
          declare const target: User;
        `,
        { overwrite: true }
      );

      const sourceVar = sourceFile.getVariableDeclaration("source")!;
      const targetVar = sourceFile.getVariableDeclaration("target")!;
      const sourceType = sourceVar.getType();
      const targetType = targetVar.getType();
      const typeChecker = project.getTypeChecker();

      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("assignable");
    });

    it("should return 'assignable' for Admin[] to User[]", () => {
      const sourceFile = project.createSourceFile(
        `__test-array-assignable__.ts`,
        `
          interface User { name: string; }
          interface Admin extends User { permissions: string[]; }
          declare const source: Admin[];
          declare const target: User[];
        `,
        { overwrite: true }
      );

      const sourceVar = sourceFile.getVariableDeclaration("source")!;
      const targetVar = sourceFile.getVariableDeclaration("target")!;
      const sourceType = sourceVar.getType();
      const targetType = targetVar.getType();
      const typeChecker = project.getTypeChecker();

      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("assignable");
    });

    it("should return 'assignable' for union narrowing (string to string | number)", () => {
      const { sourceType, targetType, typeChecker } = getTypes("string", "string | number");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("assignable");
    });

    it("should return 'assignable' for literal to base type", () => {
      const { sourceType, targetType, typeChecker } = getTypes('"hello"', "string");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("assignable");
    });
  });

  describe("Runtime Coercible", () => {
    it("should return 'coercible' for number to string", () => {
      const { sourceType, targetType, typeChecker } = getTypes("number", "string");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("coercible");
    });

    it("should return 'coercible' for boolean to string", () => {
      const { sourceType, targetType, typeChecker } = getTypes("boolean", "string");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("coercible");
    });
  });

  describe("Incompatible Types", () => {
    it("should return 'incompatible' for string to number", () => {
      const { sourceType, targetType, typeChecker } = getTypes("string", "number");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
      expect(result.errorMessage).toContain("not assignable");
    });

    it("should return 'incompatible' for mismatched object structures", () => {
      const { sourceType, targetType, typeChecker } = getTypes(
        "{ name: string }",
        "{ id: number }"
      );
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
    });

    it("should return 'incompatible' for User[] to Admin[]", () => {
      const sourceFile = project.createSourceFile(
        `__test-incompatible-array__.ts`,
        `
          interface User { name: string; }
          interface Admin extends User { permissions: string[]; }
          declare const source: User[];
          declare const target: Admin[];
        `,
        { overwrite: true }
      );

      const sourceVar = sourceFile.getVariableDeclaration("source")!;
      const targetVar = sourceFile.getVariableDeclaration("target")!;
      const sourceType = sourceVar.getType();
      const targetType = targetVar.getType();
      const typeChecker = project.getTypeChecker();

      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
    });
  });

  describe("Any Type", () => {
    it("should return 'assignable' when source is any", () => {
      const { sourceType, targetType, typeChecker } = getTypes("any", "number");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      // any is assignable to everything
    });

    it("should return 'assignable' when target is any", () => {
      const { sourceType, targetType, typeChecker } = getTypes("number", "any");
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
    });
  });

  describe("Generics", () => {
    it("should handle Promise types correctly", () => {
      const { sourceType, targetType, typeChecker } = getTypes(
        "Promise<string>",
        "Promise<string>"
      );
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("exact");
    });

    it("should detect incompatible Promise type parameters", () => {
      const { sourceType, targetType, typeChecker } = getTypes(
        "Promise<string>",
        "Promise<number>"
      );
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(false);
      expect(result.reason).toBe("incompatible");
    });

    it("should handle Array generic syntax", () => {
      const { sourceType, targetType, typeChecker } = getTypes(
        "Array<string>",
        "Array<string>"
      );
      const result = checkTypeCompatibility(sourceType, targetType, typeChecker);

      expect(result.isCompatible).toBe(true);
      expect(result.reason).toBe("exact");
    });
  });

  describe("isRuntimeCoercible helper", () => {
    it("should return true for NUMBER to STRING", () => {
      expect(isRuntimeCoercible("number", "string")).toBe(true);
    });

    it("should return true for BOOLEAN to STRING", () => {
      expect(isRuntimeCoercible("boolean", "string")).toBe(true);
    });

    it("should return false for STRING to NUMBER", () => {
      expect(isRuntimeCoercible("string", "number")).toBe(false);
    });

    it("should return false for same types", () => {
      expect(isRuntimeCoercible("string", "string")).toBe(false);
    });
  });
});
