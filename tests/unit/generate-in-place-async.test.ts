/**
 * Test generateInPlace respects sync/async function signatures
 *
 * BUG: Generator always produces async code (with await) even for sync functions.
 * This causes TS1308: 'await' expressions are only allowed within async functions
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";
import { generateInPlace } from "../../src/api/generate-in-place";

describe("generateInPlace async/sync handling", () => {
  const testDir = path.join(os.tmpdir(), `flow-weaver-async-sync-${process.pid}`);
  const testFile = path.join(testDir, "async-sync-test.ts");

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it("should generate sync code for sync function (no await)", () => {
    // Sync workflow function - should NOT have await in generated code
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function double(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x * 2 };
}

/**
 * @flowWeaver workflow
 * @name syncWorkflow
 * @node double1 double
 * @connect Start.x -> double1.x
 * @connect double1.result -> Exit.result
 */
export function syncWorkflow(execute: boolean, params: { x: number }) {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const parsed = parser.parse(testFile);
    const workflow = parsed.workflows.find(w => w.name === "syncWorkflow");
    expect(workflow).toBeDefined();

    const result = generateInPlace(content, workflow!);

    // Sync function should NOT have await in generated body
    expect(result.code).not.toContain("await ctx.setVariable");
    expect(result.code).not.toContain("await ctx.getVariable");

    // Should use sync calls instead
    expect(result.code).toContain("ctx.setVariable");
    expect(result.code).toContain("ctx.getVariable");
  });

  it("should generate async code for async function (with await)", () => {
    // Async workflow function - should have await in generated code
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function double(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, result: x * 2 };
}

/**
 * @flowWeaver workflow
 * @name asyncWorkflow
 * @node double1 double
 * @connect Start.x -> double1.x
 * @connect double1.result -> Exit.result
 */
export async function asyncWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const parsed = parser.parse(testFile);
    const workflow = parsed.workflows.find(w => w.name === "asyncWorkflow");
    expect(workflow).toBeDefined();

    const result = generateInPlace(content, workflow!);

    // Async function should have await in generated body
    expect(result.code).toContain("await ctx.setVariable");
    expect(result.code).toContain("await ctx.getVariable");
  });
});
