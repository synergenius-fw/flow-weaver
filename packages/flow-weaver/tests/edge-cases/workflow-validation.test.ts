/**
 * Workflow Validation Tests
 * Tests that Flow Weaver correctly rejects invalid workflows
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";

const TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-validation-${process.pid}`);

// Helper to test validation errors
async function testValidationError(
  sourceCode: string,
  workflowName: string,
  expectedError: RegExp,
  fileName: string,
) {
  const testFile = path.join(TEMP_DIR, `${fileName}.ts`);
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, sourceCode);

  // Capture console.error to get validation messages
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => {
    errors.push(args.join(" "));
  };

  try {
    await generator.generate(testFile, workflowName);
    console.error = originalError;
    throw new Error(`Should have thrown validation error for ${fileName}`);
  } catch (error: any) {
    console.error = originalError;
    // Check both the error message and captured console errors
    const allErrors = errors.join("\n") + "\n" + error.message;
    expect(allErrors).toMatch(expectedError);
  } finally {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
}

describe("Workflow Validation Errors", () => {
  describe("Duplicate Node Names", () => {
    it("should reject workflow with duplicate node type names", async () => {
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
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function process(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: value * 3 };
        }

        /**
         * @flowWeaver workflow
         * @node A process
         * @node B process
         * @connect Start.input -> A.value
         * @connect A.result -> B.value
         * @connect B.result -> Exit.result
         */
        export async function duplicateTypes(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      await testValidationError(
        sourceCode,
        "duplicateTypes",
        /Duplicate node type name.*process/i,
        "duplicate-node-types"
      );
    });
  });

  describe("Unknown Node References", () => {
    it("should reject connection from unknown source node", async () => {
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
         * @node A process
         * @connect Start.input -> A.value
         * @connect NonExistent.result -> Exit.result
         */
        export async function unknownSource(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      await testValidationError(
        sourceCode,
        "unknownSource",
        /unknown source node.*NonExistent/i,
        "unknown-source-node"
      );
    });

    it("should reject connection to unknown target node", async () => {
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
         * @node A process
         * @connect Start.input -> A.value
         * @connect A.result -> NonExistent.value
         */
        export async function unknownTarget(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      await testValidationError(
        sourceCode,
        "unknownTarget",
        /unknown target node.*NonExistent/i,
        "unknown-target-node"
      );
    });
  });

  describe("Unknown Port References", () => {
    it("should reject connection from non-existent output port", async () => {
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
         * @node A process
         * @connect Start.input -> A.value
         * @connect A.nonExistentPort -> Exit.result
         */
        export async function unknownSourcePort(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      await testValidationError(
        sourceCode,
        "unknownSourcePort",
        /does not have output port.*nonExistentPort/i,
        "unknown-source-port"
      );
    });

    it("should reject connection to non-existent input port", async () => {
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
         * @node A process
         * @connect Start.input -> A.nonExistentInput
         * @connect A.result -> Exit.result
         */
        export async function unknownTargetPort(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      await testValidationError(
        sourceCode,
        "unknownTargetPort",
        /does not have input port.*nonExistentInput/i,
        "unknown-target-port"
      );
    });
  });

  describe("Missing Exit Connection", () => {
    it("should warn but still generate code for workflow with no connections to Exit node", async () => {
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
         * @node A process
         * @connect Start.input -> A.value
         */
        export async function noExitConnection(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean }> {
          throw new Error('Not implemented');
        }
      `;

      // This should generate with warning, not error
      const testFile = path.join(TEMP_DIR, `no-exit-connection.ts`);
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, sourceCode);

      const warnings: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        warnings.push(args.join(" "));
      };

      try {
        const code = await generator.generate(testFile, "noExitConnection");
        console.log = originalLog;

        // Should have warning about no Exit connections
        const allWarnings = warnings.join("\\n");
        expect(allWarnings).toMatch(/no connections to Exit node/i);

        // Code should still be generated and include default return values
        expect(code).toContain("onSuccess: true");
        expect(code).toContain("onFailure: false");
      } finally {
        console.log = originalLog;
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });
  });

  describe("Data Flow Validation", () => {
    it("should warn on unused output ports", async () => {
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         * @output unused
         */
        function process(execute: boolean, value: number) {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0, unused: 0 };
          return { onSuccess: true, onFailure: false, result: value * 2, unused: value * 3 };
        }

        /**
         * @flowWeaver workflow
         * @node A process
         * @connect Start.input -> A.value
         * @connect A.result -> Exit.result
         */
        export async function unusedOutput(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
          throw new Error('Not implemented');
        }
      `;

      // This should generate with warning, not error
      const testFile = path.join(TEMP_DIR, `unused-output.ts`);
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, sourceCode);

      const warnings: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        warnings.push(args.join(" "));
      };

      try {
        await generator.generate(testFile, "unusedOutput");
        console.log = originalLog;
        const allWarnings = warnings.join("\\n");
        expect(allWarnings).toMatch(/output.*port.*"unused".*never.*connected/i);
      } finally {
        console.log = originalLog;
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });

    it("should warn on unreachable Exit ports", async () => {
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
         * @node A process
         * @connect Start.input -> A.value
         * @connect A.result -> Exit.result
         */
        export async function unreachableExit(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number; extraData: string }> {
          throw new Error('Not implemented');
        }
      `;

      // This should generate with warning, not error
      const testFile = path.join(TEMP_DIR, `unreachable-exit.ts`);
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, sourceCode);

      const warnings: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        warnings.push(args.join(" "));
      };

      try {
        await generator.generate(testFile, "unreachableExit");
        console.log = originalLog;
        const allWarnings = warnings.join("\\n");
        expect(allWarnings).toMatch(/unreachable.*exit.*port|exit.*port.*no.*connection/i);
      } finally {
        console.log = originalLog;
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });
  });
});
