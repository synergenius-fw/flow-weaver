/**
 * Basic Workflow Tests
 * Tests the core annotation system with simple workflows
 */

import * as path from "path";
import * as fs from "fs";
import { generator } from "../../src/generator";

describe("Basic Workflow Generation", () => {
  const exampleFile = path.join(
    __dirname,
    "../../fixtures/basic/example.ts",
  );

  it("should parse workflow annotations correctly", async () => {
    const code = await generator.generate(exampleFile, "calculate");

    expect(code).toContain("export async function calculate");
    expect(code).toContain("function add");
    expect(code).toContain("function multiply");
  });

  it("should generate executable workflow", async () => {
    const code = await generator.generate(exampleFile, "calculate");
    const outputFile = path.join(
      global.testHelpers.outputDir,
      "basic-test.generated.ts",
    );

    fs.writeFileSync(outputFile, code, "utf-8");

    const { calculate } = await import(outputFile);

    const result = await calculate(true, { a: 5, b: 3, factor: 2 });
    expect(result.result).toBe(16);
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });

  it("should handle multiple test cases", async () => {
    const code = await generator.generate(exampleFile, "calculate");
    const outputFile = path.join(
      global.testHelpers.outputDir,
      "basic-multi-test.generated.ts",
    );

    fs.writeFileSync(outputFile, code, "utf-8");

    const { calculate } = await import(outputFile);

    const testCases = [
      { input: { a: 5, b: 3, factor: 2 }, expected: 16 },
      { input: { a: 10, b: 5, factor: 3 }, expected: 45 },
      { input: { a: 0, b: 0, factor: 100 }, expected: 0 },
    ];

    for (const { input, expected } of testCases) {
      const result = await calculate(true, input);
      expect(result.result).toBe(expected);
      expect(result.onSuccess).toBe(true);
      expect(result.onFailure).toBe(false);
    }
  });

  afterAll(() => {
    global.testHelpers.cleanupOutput("basic-test.generated.ts");
    global.testHelpers.cleanupOutput("basic-multi-test.generated.ts");
  });
});
