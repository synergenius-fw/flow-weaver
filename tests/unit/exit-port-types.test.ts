/**
 * Test Exit Port Type Parsing
 * Verifies that @return JSDoc annotations override inferred exit port types
 *
 * Uses in-memory parsing (parseFromString) for speed - no file I/O.
 */

import { parser } from "../../src/parser";
import { validator } from "../../src/validator";

describe("Exit Port Type Parsing", () => {
  it("should infer onSuccess/onFailure as STEP ports by default (backward compatibility)", () => {
    const sourceCode = `
/**
 * @flowWeaver workflow
 */
export async function testWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
    `.trim();

    const parsed = parser.parseFromString(sourceCode);
    const workflow = parsed.workflows[0];

    expect(workflow.exitPorts.onSuccess.dataType).toBe("STEP");
    expect(workflow.exitPorts.onFailure.dataType).toBe("STEP");
    expect(workflow.exitPorts.result.dataType).toBe("NUMBER");
  });

  it("should respect @return JSDoc annotations to override port types", () => {
    const sourceCode = `
/**
 * @flowWeaver workflow
 * @return {STEP} onSuccess - Success control flow
 * @return {STEP} onFailure - Failure control flow
 * @return {STRING} status - Status message
 * @return {NUMBER} count - Item count
 */
export async function testWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; status: string; count: number }> {
  throw new Error('Not implemented');
}
    `.trim();

    const parsed = parser.parseFromString(sourceCode);
    const workflow = parsed.workflows[0];

    expect(workflow.exitPorts.onSuccess.dataType).toBe("STEP");
    expect(workflow.exitPorts.onFailure.dataType).toBe("STEP");
    expect(workflow.exitPorts.status.dataType).toBe("STRING");
    expect(workflow.exitPorts.count.dataType).toBe("NUMBER");
  });

  it("should allow boolean data ports with explicit @return annotation", () => {
    const sourceCode = `
/**
 * @flowWeaver workflow
 * @return {STEP} onSuccess
 * @return {STEP} onFailure
 * @return {BOOLEAN} isValid - Validation result as data
 */
export async function testWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; isValid: boolean }> {
  throw new Error('Not implemented');
}
    `.trim();

    const parsed = parser.parseFromString(sourceCode);
    const workflow = parsed.workflows[0];

    expect(workflow.exitPorts.onSuccess.dataType).toBe("STEP");
    expect(workflow.exitPorts.onFailure.dataType).toBe("STEP");
    expect(workflow.exitPorts.isValid.dataType).toBe("BOOLEAN");
  });

  it("should preserve labels from @return annotations", () => {
    const sourceCode = `
/**
 * @flowWeaver workflow
 * @return {STEP} onSuccess - Custom Success Label
 * @return {STEP} onFailure - Custom Failure Label
 * @return {NUMBER} result - The final result
 */
export async function testWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
    `.trim();

    const parsed = parser.parseFromString(sourceCode);
    const workflow = parsed.workflows[0];

    expect(workflow.exitPorts.onSuccess.label).toBe("Custom Success Label");
    expect(workflow.exitPorts.onFailure.label).toBe("Custom Failure Label");
    expect(workflow.exitPorts.result.label).toBe("The final result");
  });

  it("should handle mixed explicit and inferred port types", () => {
    const sourceCode = `
/**
 * @flowWeaver workflow
 * @return {STEP} onSuccess
 * @return {STEP} onFailure
 */
export async function testWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number; message: string }> {
  throw new Error('Not implemented');
}
    `.trim();

    const parsed = parser.parseFromString(sourceCode);
    const workflow = parsed.workflows[0];

    // Explicit annotations
    expect(workflow.exitPorts.onSuccess.dataType).toBe("STEP");
    expect(workflow.exitPorts.onFailure.dataType).toBe("STEP");

    // Inferred from TypeScript
    expect(workflow.exitPorts.result.dataType).toBe("NUMBER");
    expect(workflow.exitPorts.message.dataType).toBe("STRING");
  });

  it("should auto-correct onSuccess to STEP even if annotated differently", () => {
    // Reserved ports (onSuccess, onFailure) are always STEP regardless of annotation
    const sourceCode = `
/**
 * @flowWeaver workflow
 * @return {BOOLEAN} onSuccess - Even with BOOLEAN, will be corrected to STEP
 * @return {STEP} onFailure
 */
export async function testWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
    `.trim();

    const parsed = parser.parseFromString(sourceCode);
    const workflow = parsed.workflows[0];

    // Parser auto-corrects reserved ports to STEP
    expect(workflow.exitPorts.onSuccess.dataType).toBe("STEP");
    expect(workflow.exitPorts.onFailure.dataType).toBe("STEP");

    // No INVALID_EXIT_PORT_TYPE error since types are auto-corrected
    const result = validator.validate(workflow);
    const exitTypeError = result.errors.find((e: any) => e.code === "INVALID_EXIT_PORT_TYPE");
    expect(exitTypeError).toBeUndefined();
  });

  it("should auto-correct onFailure to STEP even if annotated differently", () => {
    // Reserved ports (onSuccess, onFailure) are always STEP regardless of annotation
    const sourceCode = `
/**
 * @flowWeaver workflow
 * @return {STEP} onSuccess
 * @return {BOOLEAN} onFailure - Even with BOOLEAN, will be corrected to STEP
 */
export async function testWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
    `.trim();

    const parsed = parser.parseFromString(sourceCode);
    const workflow = parsed.workflows[0];

    // Parser auto-corrects reserved ports to STEP
    expect(workflow.exitPorts.onSuccess.dataType).toBe("STEP");
    expect(workflow.exitPorts.onFailure.dataType).toBe("STEP");

    // No INVALID_EXIT_PORT_TYPE error since types are auto-corrected
    const result = validator.validate(workflow);
    const exitTypeError = result.errors.find((e: any) => e.code === "INVALID_EXIT_PORT_TYPE");
    expect(exitTypeError).toBeUndefined();
  });
});
