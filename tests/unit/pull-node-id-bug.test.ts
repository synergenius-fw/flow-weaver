/**
 * Regression test for pull execution node ID bug
 * Bug: Generator used node type name instead of instance ID for pull nodes
 * Fix: Use instance.id instead of nodeType.functionName
 */

import * as fs from "fs";
import * as path from "path";
import { generator } from "../../src/generator";

describe("Pull Execution Node ID Bug", () => {
  const inputFile = path.join(__dirname, "../fixtures/pull-node-id-bug.ts");
  const outputFile = path.join(
    global.testHelpers.outputDir,
    "pull-node-id-bug.generated.ts"
  );

  beforeAll(async () => {
    const generatedCode = await generator.generate(inputFile, "testPullNodeId");
    fs.writeFileSync(outputFile, generatedCode, "utf8");
  }, 60_000);

  afterAll(() => {
    global.testHelpers.cleanupOutput("pull-node-id-bug.generated.ts");
  });

  it("should execute correctly when instance ID differs from node type name", async () => {
    // This test verifies that pull execution works when:
    // - Instance ID: "doubler" (lowercase)
    // - Node type: "Double" (capitalized)
    // The generated code must use "doubler" everywhere, not "Double"

    const generatedModule = await import(outputFile);

    // Test: a=5, b=10
    // Expected: doubler pulls 5*2=10, adder computes 10+10=20
    const result = await generatedModule.testPullNodeId(true, { a: 5, b: 10 });

    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
    expect(result.result).toBe(20); // (5 * 2) + 10 = 20
  });

  it("should execute correctly with different inputs", async () => {
    const generatedModule = await import(outputFile);

    // Test: a=3, b=7
    // Expected: doubler pulls 3*2=6, adder computes 7+6=13
    const result = await generatedModule.testPullNodeId(true, { a: 3, b: 7 });

    expect(result.result).toBe(13); // (3 * 2) + 7 = 13
  });
});
