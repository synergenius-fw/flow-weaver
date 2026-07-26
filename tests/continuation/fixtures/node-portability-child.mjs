import path from "node:path";
import { pathToFileURL } from "node:url";

const [executorPath, workflowFile, workflowName, mode] = process.argv.slice(2);

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
const controller = mode === "cancel" ? new AbortController() : undefined;

try {
  const result = await executorModule.executeWorkflow({
    filePath: workflowFile,
    params: { value: 4 },
    workflowName,
    includeTrace: true,
    production: false,
    abortSignal: controller?.signal,
    onEvent: (event) => {
      if (
        mode === "cancel" &&
        event.type === "STATUS_CHANGED" &&
        event.data?.id === "wait"
      ) {
        controller.abort();
      }
    },
  });

  process.send({
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    result: result.result,
    eventTypes: result.trace?.map((event) => event.type) ?? [],
  });
} catch (error) {
  process.send({
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    errorName: error instanceof Error ? error.name : typeof error,
  });
}
