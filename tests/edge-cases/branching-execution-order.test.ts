/**
 * Branching Execution Order Tests
 * Tests that nodes within branches execute in correct topological order
 */

import { generator } from "../../src/generator";
import * as path from "path";
import * as fs from "fs";

describe("Branching Execution Order", () => {
  const branchingFile = path.join(
    __dirname,
    "../../fixtures/basic/example-branching.ts"
  );
  const outputFile = path.join(
    global.testHelpers.outputDir,
    "branching-execution-order.generated.ts"
  );

  beforeAll(async () => {
    const code = await generator.generate(branchingFile, "validateAndProcess");
    fs.writeFileSync(outputFile, code, "utf-8");
  });

  afterAll(() => {
    global.testHelpers.cleanupOutput("branching-execution-order.generated.ts");
  });

  describe("Success Branch", () => {
    it("should execute processValid when validation succeeds", async () => {
            const { validateAndProcess } = await import(outputFile);

      // Valid input triggers success branch: validate → processValid → Exit.result
      const result = await validateAndProcess(true, { input: { name: "John Doe" } });

      expect(result.onSuccess).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result.name).toBe("John Doe");
      expect(result.result.processed).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("Failure Branch", () => {
    it("should execute buildError when validation fails", async () => {
            const { validateAndProcess } = await import(outputFile);

      // Invalid input triggers failure branch: validate → buildError → Exit.error
      // processValid is skipped so Exit.onSuccess (from processValid.onSuccess) is false
      // buildError runs and Exit.onFailure (from buildError.onSuccess) is true
      const result = await validateAndProcess(true, { input: { name: "AB" } });

      expect(result.onSuccess).toBe(false);
      expect(result.onFailure).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("at least 3 characters");
      expect(result.result).toBeUndefined();
    });

    it("should handle missing name field", async () => {
            const { validateAndProcess } = await import(outputFile);

      const result = await validateAndProcess(true, { input: {} });

      expect(result.onSuccess).toBe(false);
      expect(result.onFailure).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("at least 3 characters");
    });
  });

  describe("Execution Order Verification", () => {
    it("should verify generated code has branching structure", async () => {
      const generatedCode = fs.readFileSync(outputFile, "utf-8");

      // Should have validate node
      expect(generatedCode).toContain("const validateResult");

      // Should have processValid node (success branch)
      expect(generatedCode).toContain("const processValidResult");

      // Should have buildError node (failure branch)
      expect(generatedCode).toContain("const buildErrorResult");

      // Should have branching logic
      expect(generatedCode).toMatch(/if.*validate.*success/i);
    });
  });
});
