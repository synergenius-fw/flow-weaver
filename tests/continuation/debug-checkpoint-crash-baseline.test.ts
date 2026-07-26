import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { loadCheckpoint } from "@synergenius/flow-weaver-baseline/runtime";

const childPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "debug-checkpoint-child.mjs",
);

interface ChildMessage {
  readonly type: "ready" | "written";
  readonly checkpointPath?: string;
}

function spawnProbe(workflowFile: string, runId: string): ChildProcess {
  return fork(childPath, [workflowFile, runId], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
}

async function nextMessage(child: ChildProcess): Promise<ChildMessage> {
  return await new Promise<ChildMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("message", onMessage);
      child.off("exit", onExit);
      reject(new Error("checkpoint probe did not answer within 10 seconds"));
    }, 10_000);
    timer.unref();

    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    const onMessage = (message: unknown) => {
      cleanup();
      resolve(message as ChildMessage);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `checkpoint probe exited before answering with code ${String(code)} and signal ${String(signal)}`,
        ),
      );
    };

    child.once("message", onMessage);
    child.once("exit", onExit);
  });
}

async function killAndWait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

describe("0.34.10 debugger checkpoint crash characterization", () => {
  let directory: string;
  let workflowFile: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "fw-a0-crash-"));
    workflowFile = path.join(directory, "workflow.ts");
    fs.writeFileSync(workflowFile, "export const baseline = true;\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("leaves no checkpoint when the process dies before the write boundary", async () => {
    const child = spawnProbe(workflowFile, "before-write");
    expect(await nextMessage(child)).toEqual({ type: "ready" });

    await killAndWait(child);

    expect(
      fs.existsSync(
        path.join(
          directory,
          ".fw-checkpoints",
          "checkpointProbe-before-write.json",
        ),
      ),
    ).toBe(false);
  });

  it("retains a readable checkpoint when the process dies after the write boundary", async () => {
    const child = spawnProbe(workflowFile, "after-write");
    expect(await nextMessage(child)).toEqual({ type: "ready" });
    const writtenMessage = nextMessage(child);
    child.send("write");
    const written = await writtenMessage;
    expect(written.type).toBe("written");
    expect(typeof written.checkpointPath).toBe("string");

    await killAndWait(child);

    const loaded = loadCheckpoint(
      written.checkpointPath as string,
      workflowFile,
    );
    expect(loaded.stale).toBe(false);
    expect(loaded.data.completedNodes).toEqual(["completed"]);
    expect(loaded.data.variables["completed:receipt:0"]).toBe("receipt-001");
  });

  it("refuses a deliberately incompatible checkpoint format version", async () => {
    const child = spawnProbe(workflowFile, "incompatible");
    expect(await nextMessage(child)).toEqual({ type: "ready" });
    const writtenMessage = nextMessage(child);
    child.send("write");
    const written = await writtenMessage;
    await killAndWait(child);

    const checkpointPath = written.checkpointPath as string;
    const value = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as Record<
      string,
      unknown
    >;
    value.version = 2;
    fs.writeFileSync(checkpointPath, `${JSON.stringify(value)}\n`, "utf8");

    expect(() => loadCheckpoint(checkpointPath, workflowFile)).toThrow(
      "Unsupported checkpoint version: 2",
    );
  });
});
