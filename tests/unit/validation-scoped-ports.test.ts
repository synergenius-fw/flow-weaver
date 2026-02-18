/**
 * Test Scoped Ports Validation
 * Verifies that scoped ports follow architectural rules:
 * - Scope names must be valid JavaScript identifiers
 * - Scoped ports must be FUNCTION type (they represent scope functions)
 */

import * as fs from "fs";
import * as path from "path";
import { parser } from "../../src/parser";
import { validator } from "../../src/validator";

describe("Scoped Ports Validation", () => {
  describe("Scope name validation", () => {
    it("should accept valid scope names with letters, numbers, underscore, and dollar sign", () => {
      const testContent = `
/**
 * @flowWeaver nodeType
 * @output processValue scope:validScope123 - Valid scope name
 * @output anotherScope scope:_privateScope - Valid with underscore
 * @output dollarScope scope:$scope - Valid with dollar sign
 */
function validScopeName(execute: boolean) {
  return { onSuccess: true, onFailure: false };
}
      `.trim();

      const testFile = path.join(global.testHelpers.outputDir, "valid-scope-names.ts");
      fs.writeFileSync(testFile, testContent);

      try {
        const parsed = parser.parse(testFile);
        const nodeType = parsed.nodeTypes[0];

        const errors = validator.validateNodeType(nodeType);

        // Should have no errors - all scope names are valid
        expect(errors.filter(e => e.includes("scope") && e.includes("identifier")).length).toBe(0);
      } finally {
        global.testHelpers.cleanupOutput("valid-scope-names.ts");
      }
    });

    it("should reject scope names starting with numbers", () => {
      const testContent = `
/**
 * @flowWeaver nodeType
 * @output processValue scope:123invalid - Invalid: starts with number
 */
function invalidScopeName(execute: boolean) {
  return { onSuccess: true, onFailure: false };
}
      `.trim();

      const testFile = path.join(global.testHelpers.outputDir, "invalid-scope-number.ts");
      fs.writeFileSync(testFile, testContent);

      try {
        const parsed = parser.parse(testFile);
        const nodeType = parsed.nodeTypes[0];

        // Chevrotain parser rejects invalid scope names (not valid identifiers)
        // so the port is not added - this is fail-fast behavior
        expect(nodeType.outputs.processValue).toBeUndefined();
      } finally {
        global.testHelpers.cleanupOutput("invalid-scope-number.ts");
      }
    });
  });

  describe("Scoped port data type validation (per-port scope architecture)", () => {
    it("should accept any data type for scoped ports (they become callback params/returns)", () => {
      // Per-port scope architecture:
      // - Scoped OUTPUT ports become callback PARAMETERS (can be any type)
      // - Scoped INPUT ports become callback RETURN VALUES (can be any type)
      const testContent = `
/**
 * @flowWeaver nodeType
 * @scope container
 * @output item scope:container - Scoped OUTPUT becomes callback param
 * @input result scope:container - Scoped INPUT becomes callback return
 */
function validScopedPorts(
  execute: boolean,
  items: number[],
  container: (item: number) => { result: number }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  return { onSuccess: true, onFailure: false, results: [] };
}
      `.trim();

      const testFile = path.join(global.testHelpers.outputDir, "valid-scoped-any-type.ts");
      fs.writeFileSync(testFile, testContent);

      try {
        const parsed = parser.parse(testFile);
        const nodeType = parsed.nodeTypes[0];

        const errors = validator.validateNodeType(nodeType);

        // Should have no errors - any data type is valid for scoped ports
        expect(errors.length).toBe(0);
      } finally {
        global.testHelpers.cleanupOutput("valid-scoped-any-type.ts");
      }
    });

    it("should accept NUMBER type for scoped OUTPUT ports (callback params)", () => {
      const testContent = `
/**
 * @flowWeaver nodeType
 * @scope processor
 * @output value scope:processor - NUMBER is valid for scoped OUTPUT
 */
function numberScopedOutput(
  execute: boolean,
  processor: (value: number) => void
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
      `.trim();

      const testFile = path.join(global.testHelpers.outputDir, "number-scoped-output.ts");
      fs.writeFileSync(testFile, testContent);

      try {
        const parsed = parser.parse(testFile);
        const nodeType = parsed.nodeTypes[0];

        const errors = validator.validateNodeType(nodeType);

        // Should have no errors - NUMBER is valid for scoped ports
        expect(errors.length).toBe(0);
      } finally {
        global.testHelpers.cleanupOutput("number-scoped-output.ts");
      }
    });

    it("should accept STRING type for scoped INPUT ports (callback returns)", () => {
      const testContent = `
/**
 * @flowWeaver nodeType
 * @scope processor
 * @input result scope:processor - STRING is valid for scoped INPUT
 */
function stringScopedInput(
  execute: boolean,
  processor: () => { result: string }
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
      `.trim();

      const testFile = path.join(global.testHelpers.outputDir, "string-scoped-input.ts");
      fs.writeFileSync(testFile, testContent);

      try {
        const parsed = parser.parse(testFile);
        const nodeType = parsed.nodeTypes[0];

        const errors = validator.validateNodeType(nodeType);

        // Should have no errors - STRING is valid for scoped ports
        expect(errors.length).toBe(0);
      } finally {
        global.testHelpers.cleanupOutput("string-scoped-input.ts");
      }
    });
  });

  describe("Multiple scoped ports", () => {
    it("should validate node with multiple valid scoped ports of any type", () => {
      // Per-port scope architecture allows any data type for scoped ports
      const testContent = `
/**
 * @flowWeaver nodeType
 * @scope scope1
 * @output item1 scope:scope1 - First scope output (NUMBER)
 * @output item2 scope:scope1 - Second scope output (STRING)
 * @input result1 scope:scope1 - First scope input (NUMBER)
 * @input result2 scope:scope1 - Second scope input (STRING)
 */
function multiScopedPorts(
  execute: boolean,
  scope1: (item1: number, item2: string) => { result1: number; result2: string }
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
      `.trim();

      const testFile = path.join(global.testHelpers.outputDir, "multi-scoped-ports.ts");
      fs.writeFileSync(testFile, testContent);

      try {
        const parsed = parser.parse(testFile);
        const nodeType = parsed.nodeTypes[0];

        const errors = validator.validateNodeType(nodeType);

        // Should have no errors - all scoped ports are valid (any type allowed)
        expect(errors.length).toBe(0);
      } finally {
        global.testHelpers.cleanupOutput("multi-scoped-ports.ts");
      }
    });

    it("should allow multiple scopes with different data types", () => {
      // Multiple scopes can have different data types
      const testContent = `
/**
 * @flowWeaver nodeType
 * @scope scope1
 * @scope scope2
 * @output value1 scope:scope1 - NUMBER in scope1
 * @output value2 scope:scope2 - STRING in scope2
 */
function multiScopeTypes(
  execute: boolean,
  scope1: (value1: number) => void,
  scope2: (value2: string) => void
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
      `.trim();

      const testFile = path.join(global.testHelpers.outputDir, "multi-scope-types.ts");
      fs.writeFileSync(testFile, testContent);

      try {
        const parsed = parser.parse(testFile);
        const nodeType = parsed.nodeTypes[0];

        const errors = validator.validateNodeType(nodeType);

        // Should have no errors - different types in different scopes is valid
        expect(errors.length).toBe(0);
      } finally {
        global.testHelpers.cleanupOutput("multi-scope-types.ts");
      }
    });
  });

  describe("Non-scoped ports", () => {
    it("should allow non-FUNCTION types for ports without scope attribute", () => {
      const testContent = `
/**
 * @flowWeaver nodeType
 * @input value - No scope, NUMBER is fine
 * @output result - No scope, STRING is fine
 */
function nonScopedPorts(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: "test" };
}
      `.trim();

      const testFile = path.join(global.testHelpers.outputDir, "non-scoped-ports.ts");
      fs.writeFileSync(testFile, testContent);

      try {
        const parsed = parser.parse(testFile);
        const nodeType = parsed.nodeTypes[0];

        const errors = validator.validateNodeType(nodeType);

        // Should have no errors - non-scoped ports can be any type
        expect(errors.length).toBe(0);
      } finally {
        global.testHelpers.cleanupOutput("non-scoped-ports.ts");
      }
    });
  });
});
