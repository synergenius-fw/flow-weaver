/**
 * Generated Code Standalone Tests
 *
 * Tests that generated code is completely standalone with zero runtime dependencies
 */

import { describe, expect, test } from "vitest";
import { parseWorkflow } from "../../src/api/parse";
import { generateCode } from "../../src/api/generate";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Generated Code - Standalone (Zero Dependencies)", () => {
  let tempDir: string;
  let testWorkflowFile: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-import-test-"));
    testWorkflowFile = path.join(tempDir, "test-workflow.ts");

    const testWorkflowContent = `
/**
 * @flowWeaver nodeType
 * @label Add
 * @input a
 * @input b
 * @output sum
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) {
    return { onSuccess: false, onFailure: false, sum: 0 };
  }
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @name calculateSum
 * @description Adds two numbers
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 */
export async function calculateSum(
  execute: boolean,
  params: { a: number; b: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; sum: number }> {
  throw new Error('Not implemented');
}
`;

    fs.writeFileSync(testWorkflowFile, testWorkflowContent, "utf-8");
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("should generate standalone code with inlined ExecutionContext", async () => {
    const parseResult = await parseWorkflow(testWorkflowFile, { workflowName: "calculateSum" });
    const generatedCode = await generateCode(parseResult.ast, { production: false });

    // Verify ExecutionContext is defined INLINE, not imported
    expect(generatedCode).toContain("class GeneratedExecutionContext");

    // Should NOT import from any external package
    expect(generatedCode).not.toContain("import { GeneratedExecutionContext }");
    expect(generatedCode).not.toContain("from '@synergenius/flow-weaver'");
    expect(generatedCode).not.toContain("from '../src/runtime/ExecutionContext'");
    expect(generatedCode).not.toContain("from \"../src/runtime/ExecutionContext\"");
  });

  test("should generate code with zero external dependencies", async () => {
    const parseResult = await parseWorkflow(testWorkflowFile, { workflowName: "calculateSum" });
    const generatedCode = await generateCode(parseResult.ast, { production: false });

    // Write generated code to a temp file
    const generatedFile = path.join(tempDir, "calculateSum.generated.ts");
    fs.writeFileSync(generatedFile, generatedCode, "utf-8");

    // Verify file was created
    expect(fs.existsSync(generatedFile)).toBe(true);

    // Check that the generated code has proper standalone structure
    expect(generatedCode).toContain("export async function calculateSum");
    expect(generatedCode).toContain("const ctx = new GeneratedExecutionContext(");

    // Verify all runtime types are inlined
    expect(generatedCode).toContain("type TStatusType");
    expect(generatedCode).toContain("interface ExecutionInfo");
  });

  test("should generate minimal production code without debug infrastructure", async () => {
    const parseResult = await parseWorkflow(testWorkflowFile, { workflowName: "calculateSum" });
    const generatedCode = await generateCode(parseResult.ast, { production: true });

    // Production mode should have inlined ExecutionContext
    expect(generatedCode).toContain("class GeneratedExecutionContext");

    // Should NOT have debug client code
    expect(generatedCode).not.toContain("createFlowWeaverDebugClient");
    expect(generatedCode).not.toContain("FLOW_WEAVER_DEBUG");
    expect(generatedCode).not.toContain("__flowWeaverDebugger__");

    // Should NOT have TDebugger type
    expect(generatedCode).not.toContain("type TDebugger");
  });

  test("should generate development code with debug infrastructure", async () => {
    const parseResult = await parseWorkflow(testWorkflowFile, { workflowName: "calculateSum" });
    const generatedCode = await generateCode(parseResult.ast, { production: false });

    // Development mode should have debug client
    expect(generatedCode).toContain("createFlowWeaverDebugClient");
    expect(generatedCode).toContain("FLOW_WEAVER_DEBUG");
    expect(generatedCode).toContain("__flowWeaverDebugger__");
  });

  test("should generate code with source maps and inline runtime", async () => {
    const parseResult = await parseWorkflow(testWorkflowFile, { workflowName: "calculateSum" });
    const result = await generateCode(parseResult.ast, { production: false, sourceMap: true });

    // Verify result has both code and sourceMap
    expect(result).toHaveProperty("code");
    expect(result).toHaveProperty("sourceMap");

    const { code, sourceMap } = result as { code: string; sourceMap: string };

    // Verify ExecutionContext is inlined, not imported
    expect(code).toContain("class GeneratedExecutionContext");
    expect(code).not.toContain("import { GeneratedExecutionContext }");

    // Verify source map is valid JSON
    expect(() => JSON.parse(sourceMap)).not.toThrow();
  });

  test("should not contain any external runtime imports", async () => {
    const parseResult = await parseWorkflow(testWorkflowFile, { workflowName: "calculateSum" });
    const generatedCode = await generateCode(parseResult.ast, { production: false });

    // Check for any potential imports - should be completely standalone
    const importPatterns = [
      /import\s+.*from\s+['"]@synergenius\/flow-weaver['"]/,
      /import\s+.*from\s+['"]\.\.\/.*runtime/,
      /import\s+.*from\s+['"]\.\/.*runtime/,
      /import\s+.*from\s+['"]\.\.\/src\//,
      /require\(['"]@synergenius\/flow-weaver['"]\)/,
      /require\(['"]\.\.\/.*runtime['"]\)/,
    ];

    for (const pattern of importPatterns) {
      expect(generatedCode).not.toMatch(pattern);
    }
  });
});
