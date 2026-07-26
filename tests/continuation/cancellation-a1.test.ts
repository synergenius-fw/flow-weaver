import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeWorkflow } from "../../src/mcp/workflow-executor.js";
import * as executorModule from "../../src/mcp/workflow-executor.js";
import { CancellationError } from "../../src/runtime/CancellationError.js";
import { GeneratedExecutionContext } from "../../src/runtime/ExecutionContext.js";
import { DebugController } from "../../src/runtime/debug-controller.js";
import { AgentChannel } from "../../src/mcp/agent-channel.js";

const temporaryDirectories: string[] = [];

function writeWorkflow(source: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fw-a1-cancel-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "workflow.ts");
  fs.writeFileSync(filePath, source, "utf8");
  return filePath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  delete (globalThis as Record<string, unknown>).__a1_successor_ran__;
});

describe("A1 execution-scoped cancellation", () => {
  it("exposes only the replacement public executor", () => {
    expect(executorModule).not.toHaveProperty("executeWorkflowFromFile");
  });

  it("refuses a request whose parent-owned signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeWorkflow({
        filePath: path.join(import.meta.dirname, "fixtures", "sequential.ts"),
        params: { value: 4 },
        workflowName: "sequential",
        abortSignal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(CancellationError);
  });

  it("cancels an engine-owned delay inside a nested workflow", async () => {
    const filePath = writeWorkflow(`
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'10s'"]
 * @path Start -> wait -> Exit
 */
async function innerWait(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("generated");
}

/**
 * @flowWeaver workflow
 * @node inner innerWait
 * @path Start -> inner -> Exit
 */
export async function outerWait(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("generated");
}
`);
    const controller = new AbortController();
    const startedAt = Date.now();
    const execution = executeWorkflow({
      filePath,
      workflowName: "outerWait",
      abortSignal: controller.signal,
      includeTrace: true,
      production: false,
      onEvent: (event) => {
        if (event.type === "STATUS_CHANGED" && event.data?.id === "wait") {
          controller.abort();
        }
      },
    });

    await expect(execution).rejects.toSatisfy((error: unknown) =>
      CancellationError.isCancellationError(error),
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("retains the exact signal in nested execution scopes", () => {
    const controller = new AbortController();
    const root = new GeneratedExecutionContext(
      true,
      undefined,
      controller.signal,
    );
    const parentIndex = root.addExecution("container");
    const nested = root.createScope(
      "container",
      parentIndex,
      "iteration",
      true,
    );

    expect(nested.getAbortSignal()).toBe(controller.signal);
    controller.abort();
    expect(() => nested.checkAborted("child")).toThrow(CancellationError);
  });

  it("cancels an engine-owned agent wait", async () => {
    const filePath = writeWorkflow(`
/**
 * @flowWeaver workflow
 * @node agent waitForAgent [expr: agentId="'review'", context="{}"]
 * @path Start -> agent -> Exit
 */
export async function waitsForAgent(
  execute: boolean,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("generated");
}
`);
    const controller = new AbortController();
    const agentChannel = new AgentChannel();
    const execution = executeWorkflow({
      filePath,
      workflowName: "waitsForAgent",
      abortSignal: controller.signal,
      agentChannel,
    });

    await agentChannel.onPause();
    controller.abort();

    await expect(execution).rejects.toSatisfy((error: unknown) =>
      CancellationError.isCancellationError(error),
    );
  });

  it("cancels an engine-owned debug gate", async () => {
    const controller = new AbortController();
    const debugController = new DebugController({ debug: true });
    const execution = executeWorkflow({
      filePath: path.join(import.meta.dirname, "fixtures", "sequential.ts"),
      params: { value: 4 },
      workflowName: "sequential",
      abortSignal: controller.signal,
      debugController,
    });

    await debugController.onPause();
    controller.abort();

    await expect(execution).rejects.toSatisfy((error: unknown) =>
      CancellationError.isCancellationError(error),
    );
  });

  it("cancels debug gates after nodes and inside nested scopes", async () => {
    const afterController = new AbortController();
    const afterContext = new GeneratedExecutionContext(
      true,
      undefined,
      afterController.signal,
    );
    const afterDebugController = new DebugController({ debug: true });
    const beforePause = afterDebugController.onPause();
    const beforeGate = afterDebugController.beforeNode("node", afterContext);
    await beforePause;
    afterDebugController.resume({ type: "step" });
    await beforeGate;

    const afterPause = afterDebugController.onPause();
    const afterGate = afterDebugController.afterNode("node", afterContext);
    await afterPause;
    afterController.abort();
    await expect(afterGate).rejects.toSatisfy((error: unknown) =>
      CancellationError.isCancellationError(error),
    );

    const scopeController = new AbortController();
    const rootContext = new GeneratedExecutionContext(
      true,
      undefined,
      scopeController.signal,
    );
    const parentIndex = rootContext.addExecution("container");
    const scopedContext = rootContext.createScope(
      "container",
      parentIndex,
      "iteration",
      true,
    );
    const scopedDebugController = new DebugController({ debug: true });
    const scopedPause = scopedDebugController.onPause();
    const scopedGate = scopedDebugController.beforeNode("child", scopedContext);
    await scopedPause;
    scopeController.abort();

    await expect(scopedGate).rejects.toSatisfy((error: unknown) =>
      CancellationError.isCancellationError(error),
    );
  });

  it("observes cancellation racing a debug resume continuation", async () => {
    const controller = new AbortController();
    const context = new GeneratedExecutionContext(
      true,
      undefined,
      controller.signal,
    );
    const debugController = new DebugController({ debug: true });
    const pause = debugController.onPause();
    const gate = debugController.beforeNode("node", context);
    await pause;

    debugController.resume({ type: "step" });
    controller.abort();

    await expect(gate).rejects.toSatisfy((error: unknown) =>
      CancellationError.isCancellationError(error),
    );
  });

  it("waits for a non-cooperative node, then stops before its successor", async () => {
    const filePath = writeWorkflow(`
/**
 * @flowWeaver nodeType
 * @output value
 */
async function ignoresCancellation(execute: boolean) {
  if (!execute) return { onSuccess: false, onFailure: false, value: 0 };
  await new Promise((resolve) => setTimeout(resolve, 80));
  return { onSuccess: true, onFailure: false, value: 1 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output value
 */
function successor(execute: boolean, value: number) {
  (globalThis as Record<string, unknown>).__a1_successor_ran__ = true;
  return { onSuccess: execute, onFailure: false, value };
}

/**
 * @flowWeaver workflow
 * @node stubborn ignoresCancellation
 * @node next successor
 * @path Start -> stubborn -> next -> Exit
 * @connect stubborn.value -> next.value
 * @connect next.value -> Exit.value
 */
export async function nonCooperative(
  execute: boolean,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error("generated");
}
`);
    const controller = new AbortController();
    const startedAt = Date.now();
    const execution = executeWorkflow({
      filePath,
      workflowName: "nonCooperative",
      abortSignal: controller.signal,
      includeTrace: true,
      production: false,
      onEvent: (event) => {
        if (
          event.type === "STATUS_CHANGED" &&
          event.data?.id === "stubborn" &&
          event.data?.status === "RUNNING"
        ) {
          controller.abort();
        }
      },
    });

    await expect(execution).rejects.toSatisfy((error: unknown) =>
      CancellationError.isCancellationError(error),
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(70);
    expect(
      (globalThis as Record<string, unknown>).__a1_successor_ran__,
    ).toBeUndefined();
  });
});
