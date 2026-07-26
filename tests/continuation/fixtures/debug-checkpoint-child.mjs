import {
  CheckpointWriter,
  GeneratedExecutionContext,
} from "@synergenius/flow-weaver-baseline/runtime";

const [workflowFile, runId] = process.argv.slice(2);

if (
  workflowFile === undefined ||
  runId === undefined ||
  process.send === undefined
) {
  throw new Error(
    "debug checkpoint child needs a workflow path, run id, and IPC channel",
  );
}

const writer = new CheckpointWriter(workflowFile, "checkpointProbe", runId, {
  input: "fixed",
});
const context = new GeneratedExecutionContext(false);
const executionIndex = context.addExecution("completed");
context.setVariable(
  { id: "completed", portName: "receipt", executionIndex },
  "receipt-001",
);

process.on("message", async (message) => {
  if (message !== "write") return;
  await writer.write(
    ["completed"],
    ["completed", "not-yet-started"],
    1,
    context,
  );
  process.send?.({
    type: "written",
    checkpointPath: writer.getCheckpointPath(),
  });
});

process.send({ type: "ready" });
