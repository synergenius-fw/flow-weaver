/**
 * Integration tests for reserved names validation
 * Ensures workflows cannot use reserved node/port names
 *
 * Uses in-memory parsing (parseFromString) for speed - no file I/O.
 */

import { parser } from "../../src/parser";
import { validator } from "../../src/validator";
import { generateCode } from "../../src/api/generate";

// Helper to test validation errors (in-memory, no file I/O)
function testValidationError(
  sourceCode: string,
  workflowName: string,
  expectedError: RegExp,
) {
  const parseResult = parser.parseFromString(sourceCode);
  const workflow = parseResult.workflows.find(w => w.functionName === workflowName);

  if (!workflow) {
    throw new Error(`Workflow ${workflowName} not found in source`);
  }

  const validationResult = validator.validate(workflow);
  expect(validationResult.valid).toBe(false);

  const allErrors = validationResult.errors.map((e: any) => e.message).join('\n');
  expect(allErrors).toMatch(expectedError);
}

async function testValidWorkflow(
  sourceCode: string,
  workflowName: string,
) {
  const parseResult = parser.parseFromString(sourceCode);
  const workflow = parseResult.workflows.find(w => w.functionName === workflowName);

  if (!workflow) {
    throw new Error(`Workflow ${workflowName} not found in source`);
  }

  const validationResult = validator.validate(workflow);
  expect(validationResult.valid).toBe(true);

  // Also generate code to verify it works end-to-end
  await generateCode(workflow);
}

describe("Reserved Names Validation", () => {
  describe("Reserved Node Names", () => {
    it("should reject workflow with node instance ID 'Start'", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function process(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value };
        }

        /**
         * @flowWeaver workflow
         * @node Start process
         * @connect Start.input -> Start.value
         * @connect Start.result -> Exit.result
         */
        export async function invalidWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      testValidationError(
        sourceCode,
        "invalidWorkflow",
        /Instance ID "Start" is reserved/i
      );
    });

    it("should reject workflow with node instance ID 'Exit'", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function process(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value };
        }

        /**
         * @flowWeaver workflow
         * @node Exit process
         * @connect Start.input -> Exit.value
         * @connect Exit.result -> Exit.result
         */
        export async function invalidWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      testValidationError(
        sourceCode,
        "invalidWorkflow",
        /Instance ID "Exit" is reserved/i
      );
    });
  });

  describe("Reserved Port Names", () => {
    it("should allow user-defined 'execute' port and merge with mandatory properties", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input execute - Custom Execute Label
         * @input value
         * @output result
         */
        function process(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value * 2 };
        }
      `;

      const result = parser.parseFromString(sourceCode);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType?.inputs.execute).toBeDefined();
      expect(nodeType?.inputs.execute.dataType).toBe("STEP"); // Mandatory dataType
      expect(nodeType?.inputs.execute.label).toBe("Custom Execute Label"); // User's custom label
    });

    it("should allow user-defined 'onSuccess' port and preserve control flow properties", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output onSuccess - Custom Success Label
         * @output result
         */
        function process(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value };
        }
      `;

      const result = parser.parseFromString(sourceCode);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType?.outputs.onSuccess).toBeDefined();
      expect(nodeType?.outputs.onSuccess.dataType).toBe("STEP"); // Mandatory dataType
      expect(nodeType?.outputs.onSuccess.label).toBe("Custom Success Label"); // User's custom label
      expect(nodeType?.outputs.onSuccess.isControlFlow).toBe(true); // Mandatory control flow property
    });

    it("should allow user-defined 'onFailure' port and preserve failure properties", () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output onFailure - Custom Failure Label
         * @output error
         */
        function process(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, error: '' };
          return { onSuccess: true, onFailure: false, error: 'none' };
        }
      `;

      const result = parser.parseFromString(sourceCode);
      const nodeType = result.nodeTypes[0];

      expect(nodeType).toBeDefined();
      expect(nodeType?.outputs.onFailure).toBeDefined();
      expect(nodeType?.outputs.onFailure.dataType).toBe("STEP"); // Mandatory dataType
      expect(nodeType?.outputs.onFailure.label).toBe("Custom Failure Label"); // User's custom label
      expect(nodeType?.outputs.onFailure.isControlFlow).toBe(true); // Mandatory control flow property
      expect(nodeType?.outputs.onFailure.failure).toBe(true); // Mandatory failure property
    });
  });

  describe("Valid Workflows", () => {
    it("should accept workflow with non-reserved names", async () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function process(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value * 2 };
        }

        /**
         * @flowWeaver workflow
         * @node process process
         * @connect Start.input -> process.value
         * @connect process.result -> Exit.result
         */
        export async function validWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      await testValidWorkflow(sourceCode, "validWorkflow");
    });

    it("should accept workflow with control flow ports defined via hasSuccessPort/hasFailurePort", async () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function validate(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          if (value < 0) return { onSuccess: false, onFailure: true, result: 0 };
          return { onSuccess: true, onFailure: false, result: value };
        }

        /**
         * @flowWeaver workflow
         * @node validate validate
         * @connect Start.input -> validate.value
         * @connect validate.result -> Exit.result
         */
        export async function validWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      await testValidWorkflow(sourceCode, "validWorkflow");
    });
  });
});
