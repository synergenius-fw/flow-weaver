import path from "node:path";
import { pathToFileURL } from "node:url";

const [executorPath, workflowFile, workflowName] = process.argv.slice(2);

if (
  executorPath === undefined ||
  workflowFile === undefined ||
  workflowName === undefined ||
  process.send === undefined
) {
  throw new Error(
    "portability child needs executor, workflow, workflow name, and IPC",
  );
}

const executorModule = await import(pathToFileURL(executorPath).href);
const result = await executorModule.executeWorkflowFromFile(
  workflowFile,
  { value: 4 },
  {
    workflowName,
    includeTrace: true,
    production: false,
  },
);

process.send({
  node: process.versions.node,
  electron: process.versions.electron ?? null,
  result: result.result,
  eventTypes: result.trace?.map((event) => event.type) ?? [],
});
