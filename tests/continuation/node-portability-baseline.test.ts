import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const childPath = path.join(
  directory,
  "fixtures",
  "node-portability-child.mjs",
);
const candidateExecutor = path.resolve(
  directory,
  "..",
  "..",
  "src",
  "mcp",
  "workflow-executor.ts",
);
const workflowFile = path.join(directory, "fixtures", "sequential.ts");
const cancellationWorkflowFile = path.join(
  directory,
  "fixtures",
  "cancellation-portable.ts",
);

interface PortabilityObservation {
  readonly node: string;
  readonly electron: string | null;
  readonly result: unknown;
  readonly eventTypes?: readonly string[];
  readonly errorName?: string;
}

function executeInPlainNode(
  filePath = workflowFile,
  workflowName = "sequential",
  mode?: "cancel",
): Promise<PortabilityObservation> {
  return new Promise((resolve, reject) => {
    const child = fork(
      childPath,
      [
        candidateExecutor,
        filePath,
        workflowName,
        ...(mode === undefined ? [] : [mode]),
      ],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    let observation: PortabilityObservation | undefined;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("plain Node.js portability probe exceeded 15 seconds"));
    }, 15_000);
    timer.unref();

    child.once("message", (message: unknown) => {
      observation = message as PortabilityObservation;
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal !== null) {
        reject(
          new Error(
            `plain Node.js portability probe exited with code ${String(code)} and signal ${String(signal)}: ${stderr}`,
          ),
        );
        return;
      }
      if (observation === undefined) {
        reject(
          new Error(
            "plain Node.js portability probe exited without an observation",
          ),
        );
        return;
      }
      resolve(observation);
    });
  });
}

describe("standard Node.js executor portability", () => {
  it("executes the candidate engine without an Electron runtime", async () => {
    const observed = await executeInPlainNode();

    expect(
      Number.parseInt(observed.node.split(".")[0] ?? "", 10),
    ).toBeGreaterThanOrEqual(22);
    expect(observed.electron).toBeNull();
    expect(observed.result).toEqual({
      onSuccess: true,
      onFailure: false,
      result: 10,
    });
    expect(observed.eventTypes).toContain("WORKFLOW_COMPLETED");
  });

  it("cancels an engine-owned wait in a plain Node.js child process", async () => {
    const observed = await executeInPlainNode(
      cancellationWorkflowFile,
      "cancellationPortable",
      "cancel",
    );

    expect(observed.electron).toBeNull();
    expect(observed.errorName).toBe("CancellationError");
  });
});
