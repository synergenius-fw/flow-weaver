/**
 * Type Coercion Tests
 * Tests that Flow Weaver correctly handles type coercion with appropriate warnings
 *
 * Uses in-memory parsing (parseFromString) and validator for speed - no file I/O.
 */

import { parser } from "../../src/parser";
import { validator } from "../../src/validator";

// Helper to test type coercion warnings (in-memory, no file I/O)
function testTypeCoercion(
  sourceCode: string,
  workflowName: string,
  expectedWarningPattern: RegExp | null,
  testDescription: string,
) {
  const parseResult = parser.parseFromString(sourceCode);
  const workflow = parseResult.workflows.find(w => w.functionName === workflowName);

  if (!workflow) {
    throw new Error(`${testDescription}: Workflow ${workflowName} not found in source`);
  }

  const validationResult = validator.validate(workflow);

  // Get all warnings (not errors)
  const warnings = validationResult.warnings || [];
  const warningMessages = warnings.map((w: any) => w.message).join('\n');

  if (expectedWarningPattern) {
    // Should have warning matching pattern
    if (!expectedWarningPattern.test(warningMessages)) {
      throw new Error(`${testDescription}: Expected warning matching ${expectedWarningPattern} but got: ${warningMessages}`);
    }
  } else {
    // Should NOT have type coercion warning
    const typeWarnings = warnings.filter((w: any) =>
      w.message && (
        w.message.includes("coercion") ||
        w.message.includes("type mismatch") ||
        w.code === "TYPE_MISMATCH"
      )
    );
    if (typeWarnings.length > 0) {
      const msgs = typeWarnings.map((w: any) => w.message).join('\n');
      throw new Error(`${testDescription}: Expected no type warnings but got: ${msgs}`);
    }
  }
}

describe("Type Coercion", () => {
  describe("Safe Coercions (No Warning)", () => {
    it("should allow NUMBER → STRING coercion without warning", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function produceNumber(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value * 2 };
        }

        /**
         * @flowWeaver nodeType
         * @input text
         * @output result
         */
        function consumeString(execute: boolean, text: string) {
          if (!execute) return { onSuccess: false, onFailure: false, result: "" };
          return { onSuccess: true, onFailure: false, result: text.toUpperCase() };
        }

        /**
         * @flowWeaver workflow
         * @node A produceNumber
         * @node B consumeString
         * @connect Start.input -> A.value
         * @connect A.result -> B.text
         * @connect B.result -> Exit.result
         */
        export async function numberToString(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
          throw new Error('Not implemented');
        }
      `;

      testTypeCoercion(
        sourceCode,
        "numberToString",
        null, // No warning expected
        "NUMBER → STRING"
      );
    });

    it("should allow BOOLEAN → STRING coercion without warning", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function produceBoolean(execute: boolean, value: boolean) {
          if (!execute) return { onSuccess: false, onFailure: false, result: false };
          return { onSuccess: true, onFailure: false, result: !value };
        }

        /**
         * @flowWeaver nodeType
         * @input text
         * @output result
         */
        function consumeString(execute: boolean, text: string) {
          if (!execute) return { onSuccess: false, onFailure: false, result: "" };
          return { onSuccess: true, onFailure: false, result: text.toUpperCase() };
        }

        /**
         * @flowWeaver workflow
         * @node A produceBoolean
         * @node B consumeString
         * @connect Start.input -> A.value
         * @connect A.result -> B.text
         * @connect B.result -> Exit.result
         */
        export async function booleanToString(execute: boolean, params: { input: boolean }): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
          throw new Error('Not implemented');
        }
      `;

      testTypeCoercion(
        sourceCode,
        "booleanToString",
        null, // No warning expected
        "BOOLEAN → STRING"
      );
    });
  });

  describe("Lossy Coercions (Warning)", () => {
    it("should warn on STRING → NUMBER coercion", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function produceString(execute: boolean, value: string) {
          if (!execute) return { onSuccess: false, onFailure: false, result: "" };
          return { onSuccess: true, onFailure: false, result: value + "123" };
        }

        /**
         * @flowWeaver nodeType
         * @input num
         * @output result
         */
        function consumeNumber(execute: boolean, num: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: num * 2 };
        }

        /**
         * @flowWeaver workflow
         * @node A produceString
         * @node B consumeNumber
         * @connect Start.input -> A.value
         * @connect A.result -> B.num
         * @connect B.result -> Exit.result
         */
        export async function stringToNumber(execute: boolean, params: { input: string }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      testTypeCoercion(
        sourceCode,
        "stringToNumber",
        /lossy.*coercion.*string.*number.*nan/i,
        "STRING → NUMBER (lossy)"
      );
    });

    it("should warn on STRING → BOOLEAN coercion", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function produceString(execute: boolean, value: string) {
          if (!execute) return { onSuccess: false, onFailure: false, result: "" };
          return { onSuccess: true, onFailure: false, result: value + "test" };
        }

        /**
         * @flowWeaver nodeType
         * @input flag
         * @output result
         */
        function consumeBoolean(execute: boolean, flag: boolean) {
          if (!execute) return { onSuccess: false, onFailure: false, result: false };
          return { onSuccess: true, onFailure: false, result: !flag };
        }

        /**
         * @flowWeaver workflow
         * @node A produceString
         * @node B consumeBoolean
         * @connect Start.input -> A.value
         * @connect A.result -> B.flag
         * @connect B.result -> Exit.result
         */
        export async function stringToBoolean(execute: boolean, params: { input: string }): Promise<{ onSuccess: boolean; onFailure: boolean; result: boolean }> {
          throw new Error('Not implemented');
        }
      `;

      testTypeCoercion(
        sourceCode,
        "stringToBoolean",
        /lossy.*coercion.*string.*boolean.*truthy/i,
        "STRING → BOOLEAN (lossy)"
      );
    });
  });

  describe("Unusual Coercions (Warning)", () => {
    it("should warn on NUMBER → BOOLEAN coercion", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function produceNumber(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value * 2 };
        }

        /**
         * @flowWeaver nodeType
         * @input flag
         * @output result
         */
        function consumeBoolean(execute: boolean, flag: boolean) {
          if (!execute) return { onSuccess: false, onFailure: false, result: false };
          return { onSuccess: true, onFailure: false, result: !flag };
        }

        /**
         * @flowWeaver workflow
         * @node A produceNumber
         * @node B consumeBoolean
         * @connect Start.input -> A.value
         * @connect A.result -> B.flag
         * @connect B.result -> Exit.result
         */
        export async function numberToBoolean(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: boolean }> {
          throw new Error('Not implemented');
        }
      `;

      testTypeCoercion(
        sourceCode,
        "numberToBoolean",
        /unusual.*coercion.*number.*boolean/i,
        "NUMBER → BOOLEAN (unusual)"
      );
    });
  });

  describe("ANY Type (No Warning)", () => {
    it("should allow ANY → specific type without warning", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function produceAny(execute: boolean, value: any) {
          if (!execute) return { onSuccess: false, onFailure: false, result: null };
          return { onSuccess: true, onFailure: false, result: value };
        }

        /**
         * @flowWeaver nodeType
         * @input num
         * @output result
         */
        function consumeNumber(execute: boolean, num: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: num * 2 };
        }

        /**
         * @flowWeaver workflow
         * @node A produceAny
         * @node B consumeNumber
         * @connect Start.input -> A.value
         * @connect A.result -> B.num
         * @connect B.result -> Exit.result
         */
        export async function anyToNumber(execute: boolean, params: { input: any }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      testTypeCoercion(
        sourceCode,
        "anyToNumber",
        null, // No warning expected
        "ANY → NUMBER"
      );
    });
  });

  describe("Same Type (No Warning)", () => {
    it("should allow same type connections without warning", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function double(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value * 2 };
        }

        /**
         * @flowWeaver nodeType
         * @input num
         * @output result
         */
        function triple(execute: boolean, num: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: num * 3 };
        }

        /**
         * @flowWeaver workflow
         * @node A double
         * @node B triple
         * @connect Start.input -> A.value
         * @connect A.result -> B.num
         * @connect B.result -> Exit.result
         */
        export async function sameType(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      testTypeCoercion(
        sourceCode,
        "sameType",
        null, // No warning expected
        "NUMBER → NUMBER"
      );
    });
  });
});
