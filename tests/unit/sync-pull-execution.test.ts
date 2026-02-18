/**
 * Test sync pull execution (lazy evaluation with sync functions)
 * Verifies that sync functions with @pullExecution can work without async
 */

import * as fs from "fs";
import * as path from "path";
import { generator } from "../../src/generator";

describe("Sync Pull Execution", () => {
  const inputFile = path.join(
    __dirname,
    "../../fixtures/advanced/example-sync-pull.ts",
  );
  const outputFile = path.join(
    global.testHelpers.outputDir,
    "example-sync-pull.generated.ts",
  );

  let generatedCode: string;

  beforeAll(async () => {
    generatedCode = await generator.generate(
      inputFile,
      "syncPullWorkflow",
    );
    fs.writeFileSync(outputFile, generatedCode, "utf8");
  });

  afterAll(() => {
    // Keep file for debugging
    // global.testHelpers.cleanupOutput("example-sync-pull.generated.ts");
  });

  describe("generated code structure", () => {
    it("should generate sync workflow function (not async)", () => {
      // The workflow should be sync since all nodes are sync
      expect(generatedCode).toContain("function syncPullWorkflow(");
      expect(generatedCode).not.toContain("async function syncPullWorkflow(");
    });

    it("should generate sync node execution (not async)", () => {
      // Node execution for sync nodes should use sync calls
      expect(generatedCode).toContain("syncDouble(");
      expect(generatedCode).toContain("syncAdd(");
      // Workflow function itself should not be async
      expect(generatedCode).not.toContain("async function syncPullWorkflow(");
    });

    it("should call sync functions without await", () => {
      // Function calls in sync executors should not use await
      expect(generatedCode).toContain("syncDouble(");
      expect(generatedCode).not.toContain("await syncDouble(");

      expect(generatedCode).toContain("syncAdd(");
      expect(generatedCode).not.toContain("await syncAdd(");
    });
  });

  describe("runtime execution", () => {
    it("should execute sync pull workflow without throwing async error", async () => {
      let generatedModule: any;
      try {
        generatedModule = await import(outputFile);
      } catch (loadError: any) {
        throw loadError;
      }

      // Should NOT throw "Pull execution node X cannot be executed in sync mode"
      try {
        const result = generatedModule.syncPullWorkflow(true, { input: 5 });

        // (5 * 2) + 5 = 10 + 5 = 15
        expect(result.result).toBe(15);
      } catch (error: any) {
        throw error;
      }
    });

    it("should produce correct result with different inputs", async () => {
      const generatedModule = await import(outputFile);

      const result1 = generatedModule.syncPullWorkflow(true, { input: 3 });
      const result2 = generatedModule.syncPullWorkflow(true, { input: 10 });

      // (3 * 2) + 3 = 9
      expect(result1.result).toBe(9);
      // (10 * 2) + 10 = 30
      expect(result2.result).toBe(30);
    });

    it("should handle multiple executions correctly", async () => {
      const generatedModule = await import(outputFile);

      // Multiple calls should all work correctly
      const results = [1, 2, 3, 4, 5].map(n =>
        generatedModule.syncPullWorkflow(true, { input: n }).result
      );

      // Each result should be (n * 2) + n = 3n
      expect(results).toEqual([3, 6, 9, 12, 15]);
    });
  });
});
