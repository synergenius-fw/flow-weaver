/**
 * Expression Tests
 * Tests default values and optional inputs
 */

import * as path from "path";
import * as fs from "fs";
import { generator } from "../../src/generator";

describe("Expression-Based Values", () => {
  const exampleFile = path.join(
    __dirname,
    "../../fixtures/basic/example-expressions.ts",
  );
  const outputFile = path.join(
    global.testHelpers.outputDir,
    "expressions-test.generated.ts",
  );

  beforeAll(async () => {
    const code = await generator.generate(exampleFile, "expressionsWorkflow");
    fs.writeFileSync(outputFile, code, "utf-8");
  });

  afterAll(() => {
    global.testHelpers.cleanupOutput("expressions-test.generated.ts");
  });

  it("should execute with default values (input=10, multiplier=2, offset=0)", async () => {
        const { expressionsWorkflow } = await import(outputFile);

    const result = await expressionsWorkflow(true, { input: 10 });

    expect(result.output).toBe("Result: 20");
  });

  it("should use default values when inputs not connected (input=5)", async () => {
        const { expressionsWorkflow } = await import(outputFile);

    const result = await expressionsWorkflow(true, { input: 5 });

    expect(result.output).toBe("Result: 10");
  });

  it("should handle optional inputs (input=7)", async () => {
        const { expressionsWorkflow } = await import(outputFile);

    const result = await expressionsWorkflow(true, { input: 7 });

    expect(result.output).toBe("Result: 14");
  });
});
