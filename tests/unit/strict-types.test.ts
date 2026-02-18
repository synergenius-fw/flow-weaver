/**
 * Strict Types Tests
 * Tests for @strictTypes parsing and annotation generation
 */

import { parser } from "../../src/parser";
import { annotationGenerator } from "../../src/annotation-generator";
import { validator } from "../../src/validator";

describe("Strict Types", () => {
  describe("JSDoc Parsing", () => {
    it("should parse @strictTypes tag and set options.strictTypes to true", () => {
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
         * @flowWeaver workflow
         * @strictTypes
         * @node A double
         * @connect Start.input -> A.value
         * @connect A.result -> Exit.result
         */
        export async function strictWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === "strictWorkflow");

      expect(workflow).toBeDefined();
      expect(workflow?.options?.strictTypes).toBe(true);
    });

    it("should parse @strictTypes false and set options.strictTypes to false", () => {
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
         * @flowWeaver workflow
         * @strictTypes false
         * @node A double
         * @connect Start.input -> A.value
         * @connect A.result -> Exit.result
         */
        export async function nonStrictWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === "nonStrictWorkflow");

      expect(workflow).toBeDefined();
      expect(workflow?.options?.strictTypes).toBe(false);
    });

    it("should have options.strictTypes undefined when @strictTypes not present", () => {
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
         * @flowWeaver workflow
         * @node A double
         * @connect Start.input -> A.value
         * @connect A.result -> Exit.result
         */
        export async function normalWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === "normalWorkflow");

      expect(workflow).toBeDefined();
      expect(workflow?.options?.strictTypes).toBeUndefined();
    });
  });

  describe("Annotation Generation", () => {
    it("should emit @strictTypes when options.strictTypes is true", () => {
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
         * @flowWeaver workflow
         * @strictTypes
         * @node A double
         * @connect Start.input -> A.value
         * @connect A.result -> Exit.result
         */
        export async function strictWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === "strictWorkflow");

      expect(workflow).toBeDefined();

      const generated = annotationGenerator.generate(workflow!);

      expect(generated).toContain("@strictTypes");
    });

    it("should NOT emit @strictTypes when options.strictTypes is undefined", () => {
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
         * @flowWeaver workflow
         * @node A double
         * @connect Start.input -> A.value
         * @connect A.result -> Exit.result
         */
        export async function normalWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === "normalWorkflow");

      expect(workflow).toBeDefined();

      const generated = annotationGenerator.generate(workflow!);

      expect(generated).not.toContain("@strictTypes");
    });
  });

  describe("Validator Behavior", () => {
    it("should return errors for type incompatibilities in strict mode", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function produceString(execute: boolean, value: string) {
          if (!execute) return { onSuccess: false, onFailure: false, result: "" };
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
         * @strictTypes
         * @node A produceString
         * @node B consumeNumber
         * @connect Start.input -> A.value
         * @connect A.result -> B.num
         * @connect B.result -> Exit.result
         */
        export async function strictWorkflow(execute: boolean, params: { input: string }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === "strictWorkflow");

      expect(workflow).toBeDefined();
      expect(workflow?.options?.strictTypes).toBe(true);

      const validationResult = validator.validate(workflow!);

      // In strict mode, type incompatibilities should be ERRORS
      const typeErrors = validationResult.errors.filter(e =>
        e.code === 'TYPE_INCOMPATIBLE' ||
        e.code === 'LOSSY_TYPE_COERCION' ||
        e.message?.includes('type')
      );

      expect(typeErrors.length).toBeGreaterThan(0);
    });

    it("should return warnings (not errors) for type incompatibilities in permissive mode", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function produceString(execute: boolean, value: string) {
          if (!execute) return { onSuccess: false, onFailure: false, result: "" };
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
         * @node A produceString
         * @node B consumeNumber
         * @connect Start.input -> A.value
         * @connect A.result -> B.num
         * @connect B.result -> Exit.result
         */
        export async function permissiveWorkflow(execute: boolean, params: { input: string }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      const parseResult = parser.parseFromString(sourceCode);
      const workflow = parseResult.workflows.find(w => w.functionName === "permissiveWorkflow");

      expect(workflow).toBeDefined();
      expect(workflow?.options?.strictTypes).toBeUndefined();

      const validationResult = validator.validate(workflow!);

      // In permissive mode, type incompatibilities should be WARNINGS (existing behavior)
      const typeWarnings = validationResult.warnings.filter(w =>
        w.code === 'TYPE_MISMATCH' ||
        w.code === 'LOSSY_TYPE_COERCION' ||
        w.message?.includes('coercion')
      );

      expect(typeWarnings.length).toBeGreaterThan(0);

      // Should NOT have type-related errors (only warnings)
      const typeErrors = validationResult.errors.filter(e =>
        e.code === 'TYPE_INCOMPATIBLE'
      );

      expect(typeErrors.length).toBe(0);
    });
  });

  describe("Round-trip Preservation", () => {
    it("should preserve @strictTypes through parse -> generate -> parse", () => {
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
         * @flowWeaver workflow
         * @strictTypes
         * @node A double
         * @connect Start.input -> A.value
         * @connect A.result -> Exit.result
         */
        export async function strictWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      // Parse
      const parseResult1 = parser.parseFromString(sourceCode);
      const workflow1 = parseResult1.workflows.find(w => w.functionName === "strictWorkflow");
      expect(workflow1?.options?.strictTypes).toBe(true);

      // Generate
      const generated = annotationGenerator.generate(workflow1!);
      expect(generated).toContain("@strictTypes");

      // Re-parse the generated code
      const parseResult2 = parser.parseFromString(generated);
      const workflow2 = parseResult2.workflows.find(w => w.functionName === "strictWorkflow");

      // strictTypes should be preserved
      expect(workflow2?.options?.strictTypes).toBe(true);
    });
  });
});
