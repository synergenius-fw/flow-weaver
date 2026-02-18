/**
 * Integration tests for pattern system
 * Tests end-to-end workflows: parse → validate, extract patterns
 * Uses pure functions directly for fast testing, with CLI smoke tests for wiring
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";
import { validator } from "../../src/validator";

// Pattern file with complete workflow fragment
const VALIDATION_PATTERN = `
/**
 * @flowWeaver pattern
 * @name validateAndProcess
 * @description Validates input and processes valid data
 * @node val inputValidator
 * @node proc dataProcessor
 * @connect IN.data -> val.input
 * @connect val.valid -> proc.input
 * @connect proc.output -> OUT.result
 * @connect val.invalid -> OUT.error
 * @port IN.data - Input data to validate
 * @port OUT.result - Processed result
 * @port OUT.error - Validation errors
 * @position val -90 0
 * @position proc 90 0
 */
function patternPlaceholder() {}

/**
 * @flowWeaver nodeType
 * @input input - Data to validate
 * @output valid - Valid data
 * @output invalid - Invalid data with errors
 */
function inputValidator(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, valid: null, invalid: null };
  if (input && typeof input === 'object') {
    return { onSuccess: true, onFailure: false, valid: input, invalid: null };
  }
  return { onSuccess: false, onFailure: true, valid: null, invalid: { error: "Invalid input" } };
}

/**
 * @flowWeaver nodeType
 * @input input - Data to process
 * @output output - Processed data
 */
function dataProcessor(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, output: null };
  return { onSuccess: true, onFailure: false, output: { processed: true, data: input } };
}
`;

// Target workflow for applying pattern
const TARGET_WORKFLOW = `
/**
 * @flowWeaver workflow
 * @param data - Input data
 * @returns result - Output result
 * @returns error - Error output
 */
export function myWorkflow(
  execute: boolean,
  params: { data: any }
): { onSuccess: boolean; onFailure: boolean; result: any; error: any } {
  return { onSuccess: true, onFailure: false, result: null, error: null };
}
`;

// Workflow with nodes to extract
const EXTRACTABLE_WORKFLOW = `
/**
 * @flowWeaver workflow
 * @node fetcher dataFetcher
 * @node parser dataParser
 * @node formatter resultFormatter
 * @connect Start.url -> fetcher.url
 * @connect fetcher.data -> parser.input
 * @connect parser.parsed -> formatter.input
 * @connect formatter.output -> Exit.result
 * @param url - URL to fetch
 * @returns result - Formatted result
 * @position fetcher -180 0
 * @position parser 0 0
 * @position formatter 180 0
 */
export function fetchAndFormat(
  execute: boolean,
  params: { url: string }
): { onSuccess: boolean; onFailure: boolean; result: any } {
  return { onSuccess: true, onFailure: false, result: null };
}

/**
 * @flowWeaver nodeType
 * @input url - URL to fetch
 * @output data - Fetched data
 */
function dataFetcher(execute: boolean, url: string) {
  if (!execute) return { onSuccess: false, onFailure: false, data: null };
  return { onSuccess: true, onFailure: false, data: { url, content: "fetched" } };
}

/**
 * @flowWeaver nodeType
 * @input input - Raw data
 * @output parsed - Parsed data
 */
function dataParser(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, parsed: null };
  return { onSuccess: true, onFailure: false, parsed: { ...input, parsed: true } };
}

/**
 * @flowWeaver nodeType
 * @input input - Data to format
 * @output output - Formatted output
 */
function resultFormatter(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, output: null };
  return { onSuccess: true, onFailure: false, output: JSON.stringify(input) };
}
`;

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-weaver-integration-"));
});

afterAll(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
});

describe("Pattern Integration - Pure Function Tests", () => {
  describe("Pattern parsing and validation", () => {
    it("should parse pattern with all required fields", () => {
      const testFile = path.join(tempDir, "pattern-parse.ts");
      fs.writeFileSync(testFile, VALIDATION_PATTERN);

      const result = parser.parse(testFile);

      expect(result.patterns).toHaveLength(1);
      const pattern = result.patterns[0];
      expect(pattern.name).toBe("validateAndProcess");
      expect(pattern.description).toBe("Validates input and processes valid data");
      expect(pattern.instances).toHaveLength(2);
      expect(pattern.inputPorts["data"]).toBeDefined();
      expect(pattern.outputPorts["result"]).toBeDefined();
      expect(pattern.outputPorts["error"]).toBeDefined();
    });

    it("should parse pattern node types", () => {
      const testFile = path.join(tempDir, "pattern-types.ts");
      fs.writeFileSync(testFile, VALIDATION_PATTERN);

      const result = parser.parse(testFile);

      expect(result.nodeTypes).toHaveLength(2);
      expect(result.nodeTypes.find(nt => nt.name === "inputValidator")).toBeDefined();
      expect(result.nodeTypes.find(nt => nt.name === "dataProcessor")).toBeDefined();
    });

    it("should parse pattern connections including IN/OUT", () => {
      const testFile = path.join(tempDir, "pattern-conns.ts");
      fs.writeFileSync(testFile, VALIDATION_PATTERN);

      const result = parser.parse(testFile);
      const pattern = result.patterns[0];

      // IN connections
      expect(pattern.connections.some(c => c.from.node === "IN")).toBe(true);
      // OUT connections
      expect(pattern.connections.some(c => c.to.node === "OUT")).toBe(true);
      // Internal connections
      expect(pattern.connections.some(c => c.from.node === "val" && c.to.node === "proc")).toBe(true);
    });

    it("should parse pattern positions", () => {
      const testFile = path.join(tempDir, "pattern-pos.ts");
      fs.writeFileSync(testFile, VALIDATION_PATTERN);

      const result = parser.parse(testFile);
      const pattern = result.patterns[0];

      const val = pattern.instances.find(i => i.id === "val");
      const proc = pattern.instances.find(i => i.id === "proc");

      expect(val?.config?.x).toBe(-90);
      expect(val?.config?.y).toBe(0);
      expect(proc?.config?.x).toBe(90);
      expect(proc?.config?.y).toBe(0);
    });
  });

  describe("Workflow parsing for extraction", () => {
    it("should parse workflow with extractable nodes", () => {
      const testFile = path.join(tempDir, "extract-wf.ts");
      fs.writeFileSync(testFile, EXTRACTABLE_WORKFLOW);

      const result = parser.parse(testFile);

      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].instances).toHaveLength(3);
      // Node types include the 3 defined node types
      expect(result.nodeTypes.length).toBeGreaterThanOrEqual(3);
      expect(result.nodeTypes.find(nt => nt.name === "dataFetcher")).toBeDefined();
      expect(result.nodeTypes.find(nt => nt.name === "dataParser")).toBeDefined();
      expect(result.nodeTypes.find(nt => nt.name === "resultFormatter")).toBeDefined();
    });

    it("should have internal connections between nodes", () => {
      const testFile = path.join(tempDir, "extract-conns.ts");
      fs.writeFileSync(testFile, EXTRACTABLE_WORKFLOW);

      const result = parser.parse(testFile);
      const workflow = result.workflows[0];

      // fetcher -> parser
      expect(workflow.connections.some(c =>
        c.from.node === "fetcher" && c.to.node === "parser"
      )).toBe(true);

      // parser -> formatter
      expect(workflow.connections.some(c =>
        c.from.node === "parser" && c.to.node === "formatter"
      )).toBe(true);
    });

    it("should have boundary connections to Start/Exit", () => {
      const testFile = path.join(tempDir, "extract-boundary.ts");
      fs.writeFileSync(testFile, EXTRACTABLE_WORKFLOW);

      const result = parser.parse(testFile);
      const workflow = result.workflows[0];

      // Start -> fetcher
      expect(workflow.connections.some(c =>
        c.from.node === "Start" && c.to.node === "fetcher"
      )).toBe(true);

      // formatter -> Exit
      expect(workflow.connections.some(c =>
        c.from.node === "formatter" && c.to.node === "Exit"
      )).toBe(true);
    });

    it("should validate extractable workflow", () => {
      const testFile = path.join(tempDir, "extract-validate.ts");
      fs.writeFileSync(testFile, EXTRACTABLE_WORKFLOW);

      const result = parser.parse(testFile);
      const workflow = result.workflows[0];

      const validation = validator.validate(workflow);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe("Target workflow parsing", () => {
    it("should parse target workflow", () => {
      const testFile = path.join(tempDir, "target-wf.ts");
      fs.writeFileSync(testFile, TARGET_WORKFLOW);

      const result = parser.parse(testFile);

      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].functionName).toBe("myWorkflow");
    });

    it("should have workflow start and exit ports", () => {
      const testFile = path.join(tempDir, "target-ports.ts");
      fs.writeFileSync(testFile, TARGET_WORKFLOW);

      const result = parser.parse(testFile);
      const workflow = result.workflows[0];

      // Check Start node ports (workflow params)
      expect(workflow.startPorts["data"]).toBeDefined();
      // Check Exit node ports (workflow returns)
      expect(workflow.exitPorts["result"]).toBeDefined();
      expect(workflow.exitPorts["error"]).toBeDefined();
    });
  });
});
