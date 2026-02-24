/**
 * Workflow executor for MCP-side compilation and execution.
 * Copies source to a temp file, compiles all workflows in-place, then dynamically imports and executes.
 */

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import ts from 'typescript';
import { compileWorkflow } from '../api/index.js';
import { getAvailableWorkflows } from '../api/workflow-file-operations.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { AgentChannel } from './agent-channel.js';

/** A single trace event captured during workflow execution. */
export interface ExecutionTraceEvent {
  /** The event type (e.g. "NODE_STARTED", "NODE_COMPLETED"). */
  type: string;
  /** Unix timestamp in milliseconds when the event was recorded. */
  timestamp: number;
  /** Additional event data. */
  data?: Record<string, unknown>;
}

/** Per-node timing from a trace summary. */
export interface NodeTiming {
  /** The node instance ID. */
  nodeId: string;
  /** Duration from RUNNING to terminal status, in milliseconds. */
  durationMs: number;
}

/** Summary of workflow execution derived from trace events. */
export interface TraceSummary {
  /** Number of unique nodes that emitted STATUS_CHANGED events. */
  totalNodes: number;
  /** Nodes that reached SUCCEEDED status. */
  succeeded: number;
  /** Nodes that reached FAILED status. */
  failed: number;
  /** Nodes that reached CANCELLED status. */
  cancelled: number;
  /** Per-node timings (RUNNING → terminal status). */
  nodeTimings: NodeTiming[];
  /** Wall-clock duration from first to last trace event, in milliseconds. */
  totalDurationMs: number;
}

/** Result returned after executing a workflow from a file. */
export interface ExecuteWorkflowResult {
  /** The return value of the executed workflow function. */
  result: unknown;
  /** The name of the exported function that was executed. */
  functionName: string;
  /** Wall-clock execution time in milliseconds. */
  executionTime: number;
  /** Execution trace events, included when `includeTrace` is enabled. */
  trace?: ExecutionTraceEvent[];
  /** Summary of trace events, included when `includeTrace` is enabled. */
  summary?: TraceSummary;
}

/**
 * Compiles and executes a workflow from a TypeScript source file.
 * Copies the source to a temp file, compiles all workflows in-place (preserving sibling
 * functions for workflow composition), injects a trace-capturing debugger, and dynamically
 * imports and runs the target workflow function.
 * @param filePath - Path to the workflow `.ts` source file.
 * @param params - Parameters to pass to the workflow function.
 * @param options - Execution options.
 * @param options.workflowName - Name of a specific exported workflow function to execute.
 *   If omitted, the first exported function is used.
 * @param options.production - Enable production mode (no debug events). Defaults to `!includeTrace`.
 * @param options.includeTrace - Whether to capture and return execution trace events. Defaults to `true`.
 * @returns The workflow result, function name, execution time, and optional trace.
 * @throws If no exported workflow function is found in the compiled module.
 */
export async function executeWorkflowFromFile(
  filePath: string,
  params?: Record<string, unknown>,
  options?: { workflowName?: string; production?: boolean; includeTrace?: boolean; mocks?: FwMockConfig; agentChannel?: AgentChannel; onEvent?: (event: ExecutionTraceEvent) => void }
): Promise<ExecuteWorkflowResult> {
  const resolvedPath = path.resolve(filePath);
  const includeTrace = options?.includeTrace !== false;

  // Copy source to temp file and compile ALL workflows in-place there.
  // In-place compilation preserves all functions in the module (node types,
  // sibling workflows), which is required for workflow composition where one
  // workflow calls another as a node type.
  //
  // Temp files are written in the source file's directory (not os.tmpdir())
  // so that ESM module resolution can walk up to the project's node_modules.
  // On Windows, os.tmpdir() is disconnected from the project tree, causing
  // bare import specifiers (e.g. 'zod', 'openai') to fail with MODULE_NOT_FOUND.
  const tmpId = `fw-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpBase = path.join(path.dirname(resolvedPath), tmpId);
  const tmpTsFile = `${tmpBase}.ts`;
  const tmpFile = `${tmpBase}.mjs`;

  try {
    fs.copyFileSync(resolvedPath, tmpTsFile);

    // Discover all workflows in the file
    const source = fs.readFileSync(resolvedPath, 'utf8');
    const allWorkflows = getAvailableWorkflows(source);

    // Compile each workflow in-place so all function bodies are generated
    for (const wf of allWorkflows) {
      await compileWorkflow(tmpTsFile, {
        write: true,
        inPlace: true,
        parse: { workflowName: wf.functionName },
        generate: { production: options?.production ?? !includeTrace },
      });
    }

    // Inject debugger binding: replace the TypeScript-only `declare const`
    // with an actual assignment from globalThis so the executor can pass
    // a trace-capturing debugger at runtime.
    let compiledCode = fs.readFileSync(tmpTsFile, 'utf8');
    compiledCode = compiledCode.replace(
      'declare const __flowWeaverDebugger__: TDebugger | undefined;',
      'const __flowWeaverDebugger__ = (globalThis as any).__fw_debugger__;'
    );

    // Transpile TypeScript to JavaScript so Node.js can import it directly
    const jsOutput = ts.transpileModule(compiledCode, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        esModuleInterop: true,
      },
    });
    fs.writeFileSync(tmpFile, jsOutput.outputText, 'utf8');

    // Create debugger to capture trace events
    const trace: ExecutionTraceEvent[] = [];
    const debugger_ = includeTrace
      ? {
          sendEvent: (event: Record<string, unknown>) => {
            const traceEvent: ExecutionTraceEvent = {
              type: (event.type as string) || 'UNKNOWN',
              timestamp: Date.now(),
              data: event,
            };
            trace.push(traceEvent);
            options?.onEvent?.(traceEvent);
          },
          innerFlowInvocation: false,
        }
      : undefined;

    // Set global debugger before import so compiled code picks it up
    (globalThis as unknown as Record<string, unknown>).__fw_debugger__ = debugger_;

    // Set mock config for built-in nodes (delay, waitForEvent, invokeWorkflow)
    if (options?.mocks) {
      (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = options.mocks;
    }

    // Set agent channel for waitForAgent pause/resume
    if (options?.agentChannel) {
      (globalThis as unknown as Record<string, unknown>).__fw_agent_channel__ = options.agentChannel;
    }

    // Dynamic import using file:// URL for cross-platform compatibility
    // (Windows paths like C:\... break with bare import() — "Received protocol 'c:'")
    const mod = await import(pathToFileURL(tmpFile).href);

    // Register exported functions for local invokeWorkflow resolution
    const workflowRegistry: Record<string, (...args: unknown[]) => unknown> = {};
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value === 'function' && key !== '__esModule') {
        workflowRegistry[key] = value as (...args: unknown[]) => unknown;
      }
    }
    (globalThis as unknown as Record<string, unknown>).__fw_workflow_registry__ = workflowRegistry;

    // Find the target exported function
    const exportedFn = findExportedFunction(mod, options?.workflowName);
    if (!exportedFn) {
      throw new Error(
        `No exported workflow function found${options?.workflowName ? ` named "${options.workflowName}"` : ''}`
      );
    }

    const startTime = Date.now();

    // Execute the workflow function: (execute, params, abortSignal?)
    // In-place compiled functions use the module-level debugger, not a parameter.
    const result = await exportedFn.fn(true, params ?? {});

    const executionTime = Date.now() - startTime;

    return {
      result,
      functionName: exportedFn.name,
      executionTime,
      ...(includeTrace && { trace, summary: computeTraceSummary(trace) }),
    };
  } finally {
    // Clean up globals
    delete (globalThis as unknown as Record<string, unknown>).__fw_debugger__;
    delete (globalThis as unknown as Record<string, unknown>).__fw_mocks__;
    delete (globalThis as unknown as Record<string, unknown>).__fw_workflow_registry__;
    delete (globalThis as unknown as Record<string, unknown>).__fw_agent_channel__;
    // Clean up temp files
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpTsFile); } catch { /* ignore */ }
  }
}

/** Compute a concise summary from raw trace events. */
export function computeTraceSummary(trace: ExecutionTraceEvent[]): TraceSummary {
  if (trace.length === 0) {
    return { totalNodes: 0, succeeded: 0, failed: 0, cancelled: 0, nodeTimings: [], totalDurationMs: 0 };
  }

  const nodeStartTimes = new Map<string, number>();
  const nodeFinalStatus = new Map<string, string>();
  const nodeTimings: NodeTiming[] = [];

  for (const event of trace) {
    if (event.type !== 'STATUS_CHANGED' || !event.data) continue;

    const id = event.data.id as string | undefined;
    const status = event.data.status as string | undefined;
    if (!id || !status) continue;

    if (status === 'RUNNING') {
      nodeStartTimes.set(id, event.timestamp);
    }

    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED') {
      nodeFinalStatus.set(id, status);
      const startTime = nodeStartTimes.get(id);
      if (startTime !== undefined) {
        nodeTimings.push({ nodeId: id, durationMs: event.timestamp - startTime });
      }
    }
  }

  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;
  for (const status of nodeFinalStatus.values()) {
    if (status === 'SUCCEEDED') succeeded++;
    else if (status === 'FAILED') failed++;
    else if (status === 'CANCELLED') cancelled++;
  }

  const totalDurationMs = trace[trace.length - 1].timestamp - trace[0].timestamp;

  return {
    totalNodes: nodeFinalStatus.size,
    succeeded,
    failed,
    cancelled,
    nodeTimings,
    totalDurationMs,
  };
}

function findExportedFunction(
  mod: Record<string, unknown>,
  preferredName?: string
): { name: string; fn: (...args: unknown[]) => unknown } | null {
  // If a preferred name is specified, try it first
  if (preferredName && typeof mod[preferredName] === 'function') {
    return { name: preferredName, fn: mod[preferredName] as (...args: unknown[]) => unknown };
  }

  // Find first exported function (skip default if it's not a function)
  for (const [key, value] of Object.entries(mod)) {
    if (key === '__esModule') continue;
    if (typeof value === 'function') {
      return { name: key, fn: value as (...args: unknown[]) => unknown };
    }
  }

  return null;
}
