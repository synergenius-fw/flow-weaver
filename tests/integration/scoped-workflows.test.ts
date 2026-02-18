/**
 * Integration tests for scoped workflow execution
 * Tests that nodes can execute within isolated scopes
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";

describe("Scoped Workflows", () => {
  const outputDir = path.join(os.tmpdir(), `flow-weaver-scoped-workflows-${process.pid}`);

  beforeAll(async () => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    // Note: Using import() instead of require() - cache handled by unique file names
  });

  it("should execute scoped workflow correctly", async () => {
    const testFile = path.join(
      __dirname,
      "../../fixtures/advanced/example-scoped.ts",
    );

    // Generate the code
    const code = await generator.generate(testFile, "scopedWorkflow");
    expect(code).toBeDefined();
    expect(code).toContain("createScope");
    expect(code).toContain("mergeScope");
    expect(code).toContain("container_scopedCtx");

    // Write and execute
    const outputFile = path.join(outputDir, "scoped-workflow.generated.ts");
    fs.writeFileSync(outputFile, code);

    // Import generated module
    const module = await import(outputFile);

    // Test execution
    const result = await module.scopedWorkflow(true, { value: 5 });

    // Expected: 5 -> addTen (+10) -> 15 -> multiplyTwo (*2) -> 30
    expect(result.result).toBe(30);
  });

  it("should handle multiple scoped children", async () => {
    // Create a test workflow with multiple children in scope
    const lines: string[] = [];
    lines.push(``);

    lines.push(`/**`);
    lines.push(` * @flowWeaver nodeType`);
    lines.push(` * @scope scope`);
    lines.push(` * @input x`);
    lines.push(` * @output x`);
    lines.push(` */`);
    lines.push(`function scopeNode(execute: boolean, x: number) { if (!execute) return { onSuccess: false, onFailure: false, x: 0 }; return { onSuccess: true, onFailure: false, x }; }`);
    lines.push(``);

    lines.push(`/**`);
    lines.push(` * @flowWeaver nodeType`);
    lines.push(` * @input val`);
    lines.push(` * @output val`);
    lines.push(` */`);
    lines.push(`function child1(execute: boolean, val: number) { if (!execute) return { onSuccess: false, onFailure: false, val: 0 }; return { onSuccess: true, onFailure: false, val: val + 1 }; }`);
    lines.push(``);

    lines.push(`/**`);
    lines.push(` * @flowWeaver nodeType`);
    lines.push(` * @input val`);
    lines.push(` * @output val`);
    lines.push(` */`);
    lines.push(`function child2(execute: boolean, val: number) { if (!execute) return { onSuccess: false, onFailure: false, val: 0 }; return { onSuccess: true, onFailure: false, val: val * 2 }; }`);
    lines.push(``);

    lines.push(`/**`);
    lines.push(` * @flowWeaver nodeType`);
    lines.push(` * @input val`);
    lines.push(` * @output val`);
    lines.push(` */`);
    lines.push(`function child3(execute: boolean, val: number) { if (!execute) return { onSuccess: false, onFailure: false, val: 0 }; return { onSuccess: true, onFailure: false, val: val + 10 }; }`);
    lines.push(``);

    lines.push(`/**`);
    lines.push(` * @flowWeaver workflow`);
    lines.push(` * @node scope scopeNode`);
    lines.push(` * @node c1 child1 scope.scope`);
    lines.push(` * @node c2 child2 scope.scope`);
    lines.push(` * @node c3 child3 scope.scope`);
    lines.push(` * @connect Start.x -> scope.x`);
    lines.push(` * @connect scope.x -> c1.val`);
    lines.push(` * @connect c1.val -> c2.val`);
    lines.push(` * @connect c2.val -> c3.val`);
    lines.push(` * @connect c3.val -> Exit.result`);
    lines.push(` * @scope scope.scope [c1, c2, c3]`);
    lines.push(` */`);
    lines.push(`export async function multiChildScope(execute: boolean, params: { x: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {`);
    lines.push(`  throw new Error('Not implemented');`);
    lines.push(`}`);

    const testFile = path.join(outputDir, "multi-child-scope.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, lines.join("\n"));

    try {
      const code = await generator.generate(testFile, "multiChildScope");
      expect(code).toContain("createScope");
      expect(code).toContain("mergeScope");

      const outputFile = path.join(outputDir, "multi-child-scope.generated.ts");
      fs.writeFileSync(outputFile, code);

            const module = await import(outputFile);

      // Test: 10 -> +1 -> 11 -> *2 -> 22 -> +10 -> 32
      const result = await module.multiChildScope(true, { x: 10 });
      expect(result.result).toBe(32);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it("should isolate scope variables from parent", async () => {
    // Test that variables in scope don't leak to parent until merged
    const testFile = path.join(
      __dirname,
      "../../fixtures/advanced/example-scoped.ts",
    );

    const code = await generator.generate(testFile, "scopedWorkflow");

    // Verify scope creation and merge are present
    expect(code).toMatch(/const \w+_scopedCtx = ctx\.createScope/);
    expect(code).toMatch(/ctx\.mergeScope\(/);

    // Verify scoped context is used directly for children (no ctx shadowing)
    expect(code).toMatch(/\w+_scopedCtx\.checkAborted\(/);
  });
});
