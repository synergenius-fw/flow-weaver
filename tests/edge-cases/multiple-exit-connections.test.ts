/**
 * Multiple Exit Connections Warning Tests
 * Tests that Flow Weaver warns when multiple nodes connect to the same Exit port
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseWorkflow } from "../../src/api/parse";
import { validateWorkflow } from "../../src/api/validate";

/** The validation warnings of one workflow, as one text. */
async function warningsOf(file: string, workflowName: string): Promise<string> {
  const parsed = await parseWorkflow(file, { workflowName });
  return validateWorkflow(parsed.ast).warnings.map((w) => w.message).join("\n");
}

const TEST_DIR = path.join(os.tmpdir(), `flow-weaver-multi-exit-${process.pid}`);

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  // Cleanup test files
  const files = fs.readdirSync(TEST_DIR).filter(f => f.startsWith("multi-exit"));
  files.forEach(f => fs.unlinkSync(path.join(TEST_DIR, f)));
});

describe("Multiple Exit Connections Warning", () => {
  it("should warn when multiple nodes connect to the same Exit port", async () => {
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function nodeA(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: true, onFailure: false, result: value };
      }

      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function nodeB(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: true, onFailure: false, result: value };
      }

      /**
       * @flowWeaver workflow
       * @node a nodeA
       * @node b nodeB
       * @connect Start.input -> a.value
       * @connect Start.input -> b.value
       * @connect a.result -> Exit.output
       * @connect b.result -> Exit.output
       * @param input - Input
       * @returns output - Output
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, "multi-exit-warning.ts");
    fs.writeFileSync(testFile, sourceCode);

    const warnings = await warningsOf(testFile, "testWorkflow");
    expect(warnings).toMatch(/has \d+ incoming connections/i);
    expect(warnings).toMatch(/output/);
    expect(warnings).toMatch(/a\.result/);
    expect(warnings).toMatch(/b\.result/);
  });

  it("should NOT warn when each Exit port has only one connection", async () => {
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function nodeA(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: true, onFailure: false, result: value };
      }

      /**
       * @flowWeaver workflow
       * @node a nodeA
       * @connect Start.input -> a.value
       * @connect a.result -> Exit.output
       * @param input - Input
       * @returns output - Output
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, "multi-exit-no-warning.ts");
    fs.writeFileSync(testFile, sourceCode);

    expect(await warningsOf(testFile, "testWorkflow")).not.toMatch(/has \d+ incoming connections/i);
  });
});
