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
const continuation =
  mode === "durable-resume" && process.env.FW_TEST_CONTINUATION
    ? JSON.parse(process.env.FW_TEST_CONTINUATION)
    : undefined;
const gateId =
  mode === "durable-resume" ? process.env.FW_TEST_GATE_ID : undefined;

try {
  const result = await executorModule.executeWorkflow({
    runId: `node-portability:${workflowName}`,
    bundleDigest:
      mode === "durable-yield" || mode === "durable-resume"
        ? `sha256:${"a".repeat(64)}`
        : undefined,
    filePath: workflowFile,
    params: { value: mode === "durable-resume" ? 999 : 4 },
    workflowName,
    includeTrace: true,
    production: false,
    abortSignal: controller?.signal,
    continuation,
    resolution:
      gateId === undefined
        ? undefined
        : {
            gateId,
            value: { onSuccess: true, onFailure: false, value: 8 },
          },
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
    outcome: result,
    eventTypes: result.trace?.map((event) => event.type) ?? [],
  });
} catch (error) {
  process.send({
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    errorName: error instanceof Error ? error.name : typeof error,
  });
}
