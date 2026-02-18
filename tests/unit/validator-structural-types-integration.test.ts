/**
 * Integration test for structural type mismatch detection with real workflow parsing
 */

import { parseWorkflow } from "../../src/api";
import { validator } from "../../src/validator";
import * as path from "path";

describe("Validator Structural Type Mismatch Integration", () => {
  it("should populate tsType for node type ports", async () => {
    const workflowPath = path.resolve(__dirname, "../fixtures/lead-processing.ts");

    const result = await parseWorkflow(workflowPath, { workflowName: "processLead" });

    const validatorNode = result.ast.nodeTypes.find(n => n.functionName === "validateLead");
    const enricherNode = result.ast.nodeTypes.find(n => n.functionName === "enrichLead");

    // tsType should be populated from TypeScript signatures
    expect(validatorNode?.outputs?.validationResult?.tsType).toBe("ValidationResult");
    expect(enricherNode?.inputs?.lead?.tsType).toBe("RawLead");
  });

  it("should warn about structural type mismatch when connecting incompatible OBJECT types", async () => {
    // This test uses a modified version of lead-processing with wrong connection
    // Since the actual file has correct connection, we test the validator directly
    const workflowPath = path.resolve(__dirname, "../fixtures/lead-processing.ts");

    const result = await parseWorkflow(workflowPath, { workflowName: "processLead" });

    // Manually add a bad connection to test the validator
    const modifiedAst = {
      ...result.ast,
      connections: [
        ...result.ast.connections,
        {
          type: "Connection" as const,
          from: { node: "validator", port: "validationResult" },
          to: { node: "enricher", port: "lead" }
        }
      ]
    };

    const validation = validator.validate(modifiedAst);

    const hasMismatchWarning = validation.warnings.some(w =>
      w.code === "OBJECT_TYPE_MISMATCH" &&
      w.message.includes("ValidationResult") &&
      w.message.includes("RawLead")
    );

    expect(hasMismatchWarning).toBe(true);
  });
});
