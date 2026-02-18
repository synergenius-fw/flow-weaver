/**
 * Test pull execution (lazy evaluation) with transformation nodes
 */

import * as fs from "fs";
import * as path from "path";
import { generator } from "../../src/generator";
import { parser } from "../../src/parser";
import { generateInPlace } from "../../src/api/generate-in-place";

describe("Pull Execution", () => {
  const inputFile = path.join(
    __dirname,
    "../../fixtures/advanced/example-pull.ts",
  );
  const outputFile = path.join(
    global.testHelpers.outputDir,
    "example-pull.generated.ts",
  );

  beforeAll(async () => {
    const generatedCode = await generator.generate(
      inputFile,
      "pullExecutionWorkflow",
    );
    fs.writeFileSync(outputFile, generatedCode, "utf8");
  }, 60000);

  afterAll(() => {
    global.testHelpers.cleanupOutput("example-pull.generated.ts");
  });

  it("should execute with pull semantics (input = 5 → result = 25)", async () => {
        const generatedModule = await import(outputFile);

    // Test case: input = 5
    // Expected: double executes immediately (push) -> 10
    //           triple and add only execute when needed (pull) -> 15
    //           result = 10 + 15 = 25
    const result = await generatedModule.pullExecutionWorkflow(true, { input: 5 });

    expect(result.result).toBe(25); // (5 * 2) + (5 * 3) = 10 + 15 = 25
  });

  it("should produce same result on second run with same input", async () => {
        const generatedModule = await import(outputFile);

    const result1 = await generatedModule.pullExecutionWorkflow(true, { input: 5 });
    const result2 = await generatedModule.pullExecutionWorkflow(true, { input: 5 });

    expect(result1.result).toBe(25);
    expect(result2.result).toBe(25);
  });

  it("should use instance ID (not node type name) in generated pull execution code", async () => {
    // This test verifies the fix for the bug where pull execution nodes
    // used the node type name instead of instance ID in generated code
    const generatedCode = fs.readFileSync(outputFile, "utf8");

    // The generated code should register pull executors with the instance ID
    // Example: ctx.registerPullExecutor('triple', triple_executor);
    // NOT: ctx.registerPullExecutor('Triple', Triple_executor);

    // Check that pull executor uses instance ID 'triple' (lowercase)
    expect(generatedCode).toContain("ctx.registerPullExecutor('triple', triple_executor)");
    expect(generatedCode).toContain("const triple_executor = async () => {");
    expect(generatedCode).toContain("if (tripleIdx !== undefined) {");
    expect(generatedCode).toContain("tripleIdx = ctx.addExecution('triple')");

    // Ensure it's NOT using the node type name 'Triple' (capitalized)
    expect(generatedCode).not.toContain("ctx.registerPullExecutor('Triple'");
    expect(generatedCode).not.toContain("TripleIdx = ctx.addExecution('Triple')");
  });

  it("should preserve @pullExecution annotation after in-place compilation", async () => {
    const sourceCode = fs.readFileSync(inputFile, "utf8");
    const parsed = parser.parse(inputFile);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.workflows.length).toBeGreaterThan(0);

    const workflow = parsed.workflows[0];
    const result = generateInPlace(sourceCode, workflow, { sourceFile: inputFile });

    // @pullExecution should survive the JSDoc rewrite
    const pullLines = result.code.match(/@pullExecution\s+\w+/g) || [];
    expect(pullLines.length).toBeGreaterThanOrEqual(2); // triple and add both have it
    expect(result.code).toContain("@pullExecution execute");
  });
});
