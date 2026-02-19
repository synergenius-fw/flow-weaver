/**
 * End-to-end tests for cross-file workflows
 * Tests the complete pipeline: parse -> validate -> generate -> execute
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { AnnotationParser } from "../../src/parser";
import { generateCode } from "../../src/api/generate";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/cross-file");
const TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-cross-file-${process.pid}`);

describe("Cross-File E2E", () => {
  let parser: AnnotationParser;

  beforeAll(() => {
    // Ensure temp directory exists
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up temp directory
    if (fs.existsSync(TEMP_DIR)) {
      const files = fs.readdirSync(TEMP_DIR);
      files.forEach((file) => {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      });
      fs.rmdirSync(TEMP_DIR);
    }
  });

  beforeEach(() => {
    parser = new AnnotationParser();
    parser.clearCache();
  });

  describe("Code generation with imported node types", () => {
    it("should generate valid code for workflow with imported node types", () => {
      const mainFile = path.join(FIXTURES_DIR, "main-workflow.ts");
      const result = parser.parse(mainFile);

      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(1);

      const workflow = result.workflows[0];
      const code = generateCode(workflow, { production: true });

      // Should contain import from generated file
      expect(code).toContain("import {");
      // Should contain the workflow function
      expect(code).toContain(`function ${workflow.name}`);
    });

    it("should generate valid code for workflow with imported workflows", () => {
      const usesWorkflow = path.join(FIXTURES_DIR, "uses-workflow.ts");
      const result = parser.parse(usesWorkflow);

      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(1);

      const workflow = result.workflows[0];
      const code = generateCode(workflow, { production: true });

      // Should import from generated file for IMPORTED_WORKFLOW
      expect(code).toContain("import {");
      expect(code).toContain(".generated");
      // Should contain the main workflow function
      expect(code).toContain(`function ${workflow.name}`);
    });
  });

  describe("Full compilation of workflow files", () => {
    it("should compile a workflow that uses node types from another file", () => {
      // Copy node-utils.ts to temp so relative imports work
      const nodeUtilsSrc = path.join(FIXTURES_DIR, "node-utils.ts");
      const nodeUtilsDest = path.join(TEMP_DIR, "node-utils.ts");
      fs.copyFileSync(nodeUtilsSrc, nodeUtilsDest);

      // Create a simple workflow that uses an imported node type
      const testCode = `
import { doubleValue } from './node-utils';

/**
 * @flowWeaver workflow
 * @node d doubleValue
 * @connect Start.execute -> d.execute
 * @connect Start.num -> d.value
 * @connect d.result -> Exit.doubled
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param num - Number to double
 * @returns doubled - The doubled number
 */
export function simpleDoubleWorkflow(
  execute: boolean,
  params: { num: number }
): { onSuccess: boolean; onFailure: boolean; doubled: number } {
  return { onSuccess: true, onFailure: false, doubled: 0 };
}
`;
      const tempFile = path.join(TEMP_DIR, "simple-double.ts");
      fs.writeFileSync(tempFile, testCode);

      const result = parser.parse(tempFile);
      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(1);

      const workflow = result.workflows[0];

      // Verify the imported node type is available
      const doubleValue = result.nodeTypes.find(
        (nt) => nt.name === "doubleValue"
      );
      expect(doubleValue).toBeDefined();
      expect(doubleValue?.variant).toBe("FUNCTION");

      // Generate code
      const code = generateCode(workflow, { production: true });
      expect(code).toContain("function simpleDoubleWorkflow");
      expect(code).toContain("import {");
    });

    it("should compile a multi-level workflow chain", () => {
      // First, ensure workflow-utils.ts is parsed (it contains workflows we'll import)
      const workflowUtils = path.join(FIXTURES_DIR, "workflow-utils.ts");
      const utilsResult = parser.parse(workflowUtils);
      expect(utilsResult.workflows.length).toBe(2);

      // Now compile uses-workflow.ts which imports from workflow-utils.ts
      const usesWorkflow = path.join(FIXTURES_DIR, "uses-workflow.ts");
      const result = parser.parse(usesWorkflow);

      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(1);

      const workflow = result.workflows[0];

      // Verify imported workflows are available as node types
      const validateAndTransform = result.nodeTypes.find(
        (nt) => nt.name === "validateAndTransform"
      );
      const formatValue = result.nodeTypes.find(
        (nt) => nt.name === "formatValue"
      );

      expect(validateAndTransform).toBeDefined();
      expect(validateAndTransform?.variant).toBe("IMPORTED_WORKFLOW");
      expect(formatValue).toBeDefined();
      expect(formatValue?.variant).toBe("IMPORTED_WORKFLOW");

      // Generate code
      const code = generateCode(workflow, { production: true });
      expect(code).toContain("function processData");

      // Should import from .generated file for workflows
      expect(code).toMatch(/import.*\.generated/);
    });
  });

  describe("Error propagation", () => {
    it("should propagate import errors to parse result", () => {
      const testCode = `
import { nonexistent } from '../node-utils';

/**
 * @flowWeaver workflow
 * @node n nonexistent
 * @param input - Input
 * @returns output - Output
 */
export function badImportWorkflow(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; output: any } {
  return { onSuccess: true, onFailure: false, output: null };
}
`;
      const tempFile = path.join(TEMP_DIR, "bad-import.ts");
      fs.writeFileSync(tempFile, testCode);

      expect(() => parser.parse(tempFile)).toThrow(/nonexistent|not found/i);
    });
  });
});
