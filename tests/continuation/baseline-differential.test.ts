import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeWorkflowFromFile as executeBaseline } from "@synergenius/flow-weaver-baseline/executor";
import { executeWorkflowFromFile as executeCandidate } from "../../src/mcp/workflow-executor.js";

interface CorpusCase {
  readonly name: string;
  readonly fixture: string;
  readonly workflowName: string;
  readonly params: Record<string, unknown>;
}

const fixtureDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

const corpus: readonly CorpusCase[] = [
  {
    name: "sequential data and control flow",
    fixture: "sequential.ts",
    workflowName: "sequential",
    params: { value: 4 },
  },
  {
    name: "successful branch",
    fixture: "branching.ts",
    workflowName: "branching",
    params: { value: 7 },
  },
  {
    name: "failure branch returned as data",
    fixture: "branching.ts",
    workflowName: "branching",
    params: { value: -1 },
  },
  {
    name: "parallel branches with a join",
    fixture: "parallel.ts",
    workflowName: "parallel",
    params: { value: 5 },
  },
  {
    name: "repeated scoped execution",
    fixture: "scoped-loop.ts",
    workflowName: "scopedLoop",
    params: { items: ["alpha", "beta", "gamma"] },
  },
  {
    name: "nested workflow invocation",
    fixture: "nested.ts",
    workflowName: "nested",
    params: { value: 10 },
  },
];

type Executor = typeof executeCandidate;

async function observe(execute: Executor, testCase: CorpusCase) {
  const observed = await execute(
    path.join(fixtureDirectory, testCase.fixture),
    testCase.params,
    {
      workflowName: testCase.workflowName,
      includeTrace: true,
      production: false,
    },
  );

  return {
    functionName: observed.functionName,
    result: observed.result,
    trace: observed.trace?.map(({ type, data }) => ({ type, data })),
    summary:
      observed.summary === undefined
        ? undefined
        : {
            totalNodes: observed.summary.totalNodes,
            succeeded: observed.summary.succeeded,
            failed: observed.summary.failed,
            cancelled: observed.summary.cancelled,
            nodeTimings: observed.summary.nodeTimings.map(({ nodeId }) => ({
              nodeId,
            })),
          },
  };
}

describe("Flow Weaver 0.34.10 differential continuation baseline", () => {
  it.each(corpus)(
    "$name is deterministic and candidate-equivalent",
    async (testCase) => {
      const firstBaseline = await observe(executeBaseline, testCase);
      const secondBaseline = await observe(executeBaseline, testCase);
      const candidate = await observe(executeCandidate, testCase);

      expect(secondBaseline).toEqual(firstBaseline);
      expect(candidate).toEqual(firstBaseline);
    },
  );
});
