/**
 * Empty Branch Elimination Tests
 * Tests that the generator does not emit empty if/else blocks when a branching node
 * has no downstream nodes in its success/failure branches (only connects to Exit)
 */

import * as path from "path";
import { generator } from "../../src/generator";

describe("Empty Branch Elimination", () => {
  const testWorkflowFile = path.join(
    __dirname,
    "../../fixtures/validation-demo.ts",
  );

  it("should not generate empty if/else blocks when branching node only connects to Exit", async () => {
    const code = await generator.generate(testWorkflowFile, "calculate");

    // Should NOT contain empty if/else blocks like:
    // if (adder_success) {
    // } else {
    // }

    // Check that there are no empty conditional blocks
    // This regex matches: if (...) {\n  } else {\n  }
    const emptyIfElsePattern = /if\s*\([^)]+\)\s*\{\s*\}\s*else\s*\{\s*\}/g;
    const matches = code.match(emptyIfElsePattern);

    expect(matches).toBeNull();
  });

  it("should not generate unused success flag variable when branching node only connects to Exit", async () => {
    const code = await generator.generate(testWorkflowFile, "calculate");

    // Should NOT contain: let adder_success = false;
    // Since there are no downstream nodes, the success flag is not needed
    const successFlagPattern = /let\s+adder_success\s*=\s*false;/;
    const hasSuccessFlag = successFlagPattern.test(code);

    expect(hasSuccessFlag).toBe(false);
  });

  it("should not assign success flag in try/catch when no downstream nodes exist", async () => {
    const code = await generator.generate(testWorkflowFile, "calculate");

    // Should NOT contain: adder_success = adderResult.onSuccess;
    // Should NOT contain: adder_success = false; (in catch block)
    const successAssignmentPattern = /adder_success\s*=\s*adderResult\.onSuccess;/;
    const failureAssignmentPattern = /adder_success\s*=\s*false;/;

    expect(successAssignmentPattern.test(code)).toBe(false);
    expect(failureAssignmentPattern.test(code)).toBe(false);
  });

});
