/**
 * Workflow Execution Tests
 * Tests workflow execution behavior: state isolation and idempotency
 */

import { generator } from "../../src/generator";
import * as path from "path";
import * as fs from "fs";

describe("Workflow Execution", () => {
  const testExampleFile = path.join(__dirname, "../../fixtures/basic/example.ts");
  const outputFile = path.join(global.testHelpers.outputDir, "workflow-execution.generated.ts");

  beforeAll(async () => {
    const code = await generator.generate(testExampleFile, "calculate");
    fs.writeFileSync(outputFile, code, "utf-8");
  });

  afterAll(() => {
    global.testHelpers.cleanupOutput("workflow-execution.generated.ts");
  });

  describe("State Isolation", () => {
    it("should handle multiple sequential executions", async () => {
            const { calculate } = await import(outputFile);

      const result1 = await calculate(true, { a: 1, b: 2, factor: 3 });
      const result2 = await calculate(true, { a: 10, b: 20, factor: 2 });
      const result3 = await calculate(true, { a: 100, b: 200, factor: 1 });

      expect(result1.result).toBe(9);   // (1+2)*3
      expect(result2.result).toBe(60);  // (10+20)*2
      expect(result3.result).toBe(300); // (100+200)*1
    });
  });

  describe("Idempotency", () => {
    it("should produce consistent results for same inputs", async () => {
            const { calculate } = await import(outputFile);

      const params = { a: 7, b: 13, factor: 5 };
      const result1 = await calculate(true, params);
      const result2 = await calculate(true, params);
      const result3 = await calculate(true, params);

      expect(result1.result).toBe(100); // (7+13)*5
      expect(result2.result).toBe(100);
      expect(result3.result).toBe(100);
    });
  });
});
