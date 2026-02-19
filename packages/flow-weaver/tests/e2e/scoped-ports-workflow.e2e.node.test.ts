/**
 * E2E test for scoped ports workflow
 * Tests the example-scoped-ports.ts workflow generation and execution
 * Optimized: Generate once, reuse module
 */

import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";
import * as fs from "fs";
import type { TNodeTypeAST, TPortDefinition } from "../../src/ast";

describe("Scoped Ports Workflow E2E", () => {
  const workflowPath = path.join(
    __dirname,
    "../../fixtures/advanced/example-scoped-ports.ts"
  );
  const outputPath = path.join(
    os.tmpdir(),
    `flow-weaver-scoped-ports-workflow-${process.pid}.generated.ts`
  );

  type WorkflowFn = (execute: boolean, params: Record<string, unknown>) => Record<string, unknown>;
  let module: Record<string, WorkflowFn>;
  let code: string;

  beforeAll(async () => {
    code = await testHelpers.generateFast(workflowPath, "scopedPortsWorkflow");
    fs.writeFileSync(outputPath, code, "utf-8");
    module = await import(outputPath);
  });

  afterAll(() => {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it("should generate valid code for scoped ports workflow", () => {
    expect(code).toBeDefined();
    expect(code).toContain("export function scopedPortsWorkflow");
    expect(code).toContain("forEach");
    expect(code).toContain("processItem");
  });

  it("should handle single item", () => {
    const result = module.scopedPortsWorkflow(true, { items: [5] });

    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
    expect(result.results).toEqual([10]);
  });

  it("should respect execute=false", () => {
    const result = module.scopedPortsWorkflow(false, { items: [1, 2, 3] });

    expect(result.onSuccess).toBe(false);
    expect(result.onFailure).toBe(false);
  });

  it("should have correct port ordering (mandatory ports first)", () => {
    const parseResult = parser.parse(workflowPath);

    const forEach = parseResult.nodeTypes.find(
      (nt: TNodeTypeAST) => nt.functionName === "forEach"
    );

    expect(forEach).toBeDefined();

    // Check scoped OUTPUT ports: start (mandatory) should be first
    const scopedOutputs = Object.entries(forEach!.outputs)
      .filter(([_, port]: [string, TPortDefinition]) => port.scope === "processItem")
      .map(([name, port]: [string, TPortDefinition]) => ({
        name,
        order: port.metadata?.order ?? Infinity,
      }))
      .sort((a, b) => a.order - b.order);

    expect(scopedOutputs[0].name).toBe("start"); // mandatory first
    expect(scopedOutputs[1].name).toBe("item"); // regular second

    // Check scoped INPUT ports: success, failure (mandatory) should be first
    const scopedInputs = Object.entries(forEach!.inputs)
      .filter(([_, port]: [string, TPortDefinition]) => port.scope === "processItem")
      .map(([name, port]: [string, TPortDefinition]) => ({
        name,
        order: port.metadata?.order ?? Infinity,
      }))
      .sort((a, b) => a.order - b.order);

    expect(scopedInputs[0].name).toBe("success"); // mandatory first
    expect(scopedInputs[1].name).toBe("failure"); // mandatory second
    expect(scopedInputs[2].name).toBe("processed"); // regular third
  });
});
