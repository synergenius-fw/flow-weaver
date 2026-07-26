import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const removalSignals = [
  ["executeWorkflow", "FromFile"],
  ["GeneratedExecution", "Context"],
  ["__flowWeaver", "Debugger__"],
  ["__abort", "Signal__"],
  ["__fw_", "(?:agent_channel|approval_provider|current_node_id)"],
  ["__fw_", "(?:debug_controller|debugger|llm_provider)"],
  ["__fw_", "(?:mocks|unserializable|workflow_registry)", "__"],
  ["Checkpoint", "Writer"],
  ["load", "Checkpoint"],
  ["findLatest", "Checkpoint"],
  ["Checkpoint", "Data"],
  ["@flow-weaver", "-body"],
  ["@end-flow-weaver", "-body"],
  ["BODY_", "(?:START|END)"],
].map((parts) => parts.join(""));

const removalPattern = new RegExp(removalSignals.join("|"));

type InventoryCategory =
  | "a0-evidence"
  | "contract-test"
  | "documentation"
  | "example"
  | "generated-artifact"
  | "generated-example"
  | "production-implementation";

function classify(file: string): InventoryCategory | undefined {
  if (file === "README.md" || file.startsWith("docs/")) return "documentation";
  if (file.startsWith("fixtures/")) return "generated-example";
  if (file.startsWith("src/")) return "production-implementation";
  if (file.startsWith("tests/continuation/")) return "a0-evidence";
  if (file.startsWith("tests/fixtures/") || file.includes("/__snapshots__/")) {
    return "generated-artifact";
  }
  if (file.startsWith("tests/")) return "contract-test";
  if (file.startsWith("use-cases/")) return "example";
  return undefined;
}

function buildInventory(): ReadonlyMap<string, InventoryCategory | undefined> {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
    cwd: repositoryRoot,
    encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);

  return new Map(
    tracked
      .filter((file) => {
        const content = fs.readFileSync(path.join(repositoryRoot, file));
        return !content.includes(0) && removalPattern.test(content.toString());
      })
      .map((file) => [file, classify(file)]),
  );
}

describe("one-major removal inventory after the A1 executor cutover", () => {
  it("classifies every tracked old-ABI, global, checkpoint, and generated-body match", () => {
    const inventory = buildInventory();
    const unclassified = [...inventory]
      .filter(([, category]) => category === undefined)
      .map(([file]) => file);
    const categoryCounts = Object.fromEntries(
      [...inventory.values()].map((category) => [
        category,
        [...inventory.values()].filter((value) => value === category).length,
      ]),
    );

    expect(unclassified).toEqual([]);
    expect(categoryCounts).toEqual({
      "a0-evidence": 4,
      "contract-test": 72,
      documentation: 5,
      example: 1,
      "generated-artifact": 7,
      "generated-example": 3,
      "production-implementation": 29,
    });
  });

  it("retains the independently reviewed omission cases in the scan", () => {
    const inventory = buildInventory();

    expect([...inventory.keys()]).toEqual(
      expect.arrayContaining([
        "tests/testing/mock-approval.test.ts",
        "tests/testing/mock-llm.test.ts",
        "tests/validation/template-regressions.test.ts",
        "tests/unit/built-in-nodes-mocks.test.ts",
        "tests/continuation/baseline-differential.test.ts",
        "tests/continuation/debug-checkpoint-crash-baseline.test.ts",
        "tests/continuation/fixtures/debug-checkpoint-child.mjs",
        "tests/continuation/cancellation-a1.test.ts",
      ]),
    );
  });
});
