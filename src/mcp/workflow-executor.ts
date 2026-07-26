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
import type { TExternalNodeType } from '../parser.js';
import type { AgentChannel } from './agent-channel.js';
import type { DebugController } from '../runtime/debug-controller.js';
import { CancellationError } from '../runtime/CancellationError.js';

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

/** One execution-scoped request accepted by the public workflow executor. */
export interface WorkflowExecutionRequest {
  filePath: string;
  params?: Record<string, unknown>;
  workflowName?: string;
  production?: boolean;
  includeTrace?: boolean;
  mocks?: FwMockConfig;
  agentChannel?: AgentChannel;
  debugController?: DebugController;
  onEvent?: (event: ExecutionTraceEvent) => void;
  externalNodeTypes?: TExternalNodeType[];
  /**
   * Parent-owned cooperative cancellation signal for this execution.
   *
   * Flow Weaver observes cancellation at generated node boundaries, nested
   * scopes and engine-owned waits. A node that ignores cancellation is not
   * preempted; a hard stop requires a parent-owned process boundary.
   */
  abortSignal?: AbortSignal;
}

/** Result returned after executing a workflow request. */
export interface WorkflowExecutionResult {
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
 * @param request - File, parameters, execution options, and parent-owned signal.
 * @returns The workflow result, function name, execution time, and optional trace.
 * @throws If no exported workflow function is found in the compiled module.
 */
export async function executeWorkflow(
  request: WorkflowExecutionRequest
): Promise<WorkflowExecutionResult> {
  const {
    filePath,
    params,
    workflowName,
    production: requestedProduction,
    includeTrace: requestedIncludeTrace,
    mocks,
    agentChannel,
    debugController,
    onEvent,
    externalNodeTypes,
    abortSignal,
  } = request;
  if (abortSignal?.aborted) throw new CancellationError();

  const resolvedPath = path.resolve(filePath);
  const includeTrace = requestedIncludeTrace !== false;

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

    // Compile each workflow in-place so all function bodies are generated.
    // Debug controller requires dev mode (production: false) so that
    // __ctrl__.beforeNode/afterNode hooks are emitted in generated code.
    const production = debugController
      ? false
      : (requestedProduction ?? !includeTrace);
    for (const wf of allWorkflows) {
      await compileWorkflow(tmpTsFile, {
        write: true,
        inPlace: true,
        // Forward caller-supplied foreign nodeType definitions so a
        // workflow that references a node from another package (an
        // `@node <id> <foreignType>` the file doesn't declare, e.g.
        // pack-core's `waitForApproval`) resolves its real ports during
        // the executor's own compile. Without this the internal parse
        // can't see those nodeTypes and falls back to a stub, failing
        // validation. Callers that resolve foreign defs from a wire
        // manifest (no node_modules to read a .d.ts) pass them here.
        parse: { workflowName: wf.functionName, externalNodeTypes },
        generate: { production },
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

    // When source lives under src/, rewrite relative imports to point to
    // dist/ equivalents so Node.js ESM resolver finds the compiled JS files.
    // This happens with marketplace packs that ship TS source for parsing
    // but only have compiled JS in dist/.
    let transpiledOutput = jsOutput.outputText;
    const srcDir = path.dirname(tmpTsFile);
    if (srcDir.includes(`${path.sep}src${path.sep}`)) {
      const distDir = srcDir.replace(`${path.sep}src${path.sep}`, `${path.sep}dist${path.sep}`);
      transpiledOutput = transpiledOutput.replace(
        /from\s+['"](\.[^'"]+)['"]/g,
        (_match, specifier: string) => {
          const resolvedSrc = path.resolve(srcDir, specifier);
          // Only rewrite if the source .js file doesn't exist but the dist equivalent does
          if (!fs.existsSync(resolvedSrc)) {
            const distEquivalent = resolvedSrc.replace(
              `${path.sep}src${path.sep}`,
              `${path.sep}dist${path.sep}`,
            );
            if (fs.existsSync(distEquivalent)) {
              const relative = path.relative(srcDir, distEquivalent);
              const posixRelative = relative.replace(/\\/g, '/');
              const normalized = posixRelative.startsWith('.') ? posixRelative : `./${posixRelative}`;
              return `from '${normalized}'`;
            }
          }
          return _match;
        },
      );
    }

    fs.writeFileSync(tmpFile, transpiledOutput, 'utf8');

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
            onEvent?.(traceEvent);
          },
          innerFlowInvocation: false,
        }
      : undefined;

    // Set global debugger before import so compiled code picks it up
    (globalThis as unknown as Record<string, unknown>).__fw_debugger__ = debugger_;

    // Set mock config for built-in nodes (delay, waitForEvent, invokeWorkflow)
    if (mocks) {
      (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = mocks;
    }

    // Set agent channel for waitForAgent pause/resume
    if (agentChannel) {
      (globalThis as unknown as Record<string, unknown>).__fw_agent_channel__ = agentChannel;
    }

    // Set debug controller for step-through debugging and checkpoint/resume
    if (debugController) {
      (globalThis as unknown as Record<string, unknown>).__fw_debug_controller__ = debugController;
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
    const exportedFn = findExportedFunction(mod, workflowName);
    if (!exportedFn) {
      const available = Object.entries(mod)
        .filter(([k, v]) => k !== '__esModule' && typeof v === 'function')
        .map(([k]) => k);
      const availStr = available.length > 0 ? `. Available: ${available.join(', ')}` : '';
      throw new Error(
        workflowName
          ? `Workflow "${workflowName}" not found in file${availStr}`
          : `No exported workflow function found in file${availStr}`
      );
    }

    const startTime = Date.now();

    // Execute the workflow function: (execute, params, abortSignal?)
    // In-place compiled functions use the module-level debugger, not a parameter.
    if (abortSignal?.aborted) throw new CancellationError();
    const result = await exportedFn.fn(true, params ?? {}, abortSignal);

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
    delete (globalThis as unknown as Record<string, unknown>).__fw_debug_controller__;
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
