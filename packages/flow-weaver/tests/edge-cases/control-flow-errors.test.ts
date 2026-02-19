/**
 * Edge Cases: Control Flow and Error Handling
 * Tests error handling and control flow edge cases
 */

import { generator } from "../../src/generator";
import * as path from "path";
import * as fs from "fs";

describe("Edge Cases: Control Flow and Error Handling", () => {
  const errorExampleFile = path.join(__dirname, "../../fixtures/basic/example-error.ts");
  const outputFile = path.join(global.testHelpers.outputDir, "control-flow-errors.generated.ts");

  beforeAll(async () => {
    const code = await generator.generate(errorExampleFile, "validateAndDouble");
    fs.writeFileSync(outputFile, code, "utf-8");
  });

  afterAll(() => {
    global.testHelpers.cleanupOutput("control-flow-errors.generated.ts");
  });

  describe("Error Propagation", () => {
    it("should throw error for negative input", async () => {
            const { validateAndDouble } = await import(outputFile);

      await expect(
        validateAndDouble(true, { input: -5 })
      ).rejects.toThrow(/non-negative/i);
    });

    it("should throw error for input exceeding 100", async () => {
            const { validateAndDouble } = await import(outputFile);

      await expect(
        validateAndDouble(true, { input: 101 })
      ).rejects.toThrow(/not exceed 100/i);
    });

    it("should succeed at boundary value (100)", async () => {
            const { validateAndDouble } = await import(outputFile);

      const result = await validateAndDouble(true, { input: 100 });

      expect(result.onSuccess).toBe(true);
      expect(result.result).toBe(200); // input * 2
    });

    it("should succeed at boundary value (0)", async () => {
            const { validateAndDouble } = await import(outputFile);

      const result = await validateAndDouble(true, { input: 0 });

      expect(result.onSuccess).toBe(true);
      expect(result.result).toBe(0);
    });
  });
});
