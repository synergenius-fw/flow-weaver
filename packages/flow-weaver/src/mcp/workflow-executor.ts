/**
 * Workflow executor for MCP-side compilation and execution.
 * Copies source to a temp file, compiles all workflows in-place, then dynamically imports and executes.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import ts from 'typescript';
import { compileWorkflow } from '../api/index.js';
import { getAvailableWorkflows } from '../api/workflow-file-operations.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';

/** A single trace event captured during workflow execution. */
export interface ExecutionTraceEvent {
  /** The event type (e.g. "NODE_STARTED", "NODE_COMPLETED"). */
  type: string;
  /** Unix timestamp in milliseconds when the event was recorded. */
  timestamp: number;
  /** Additional event data. */
  data?: Record<string, unknown>;
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
  options?: { workflowName?: string; production?: boolean; includeTrace?: boolean; mocks?: FwMockConfig }
): Promise<ExecuteWorkflowResult> {
  const resolvedPath = path.resolve(filePath);
  const includeTrace = options?.includeTrace !== false;

  // Copy source to temp file and compile ALL workflows in-place there.
  // In-place compilation preserves all functions in the module (node types,
  // sibling workflows), which is required for workflow composition where one
  // workflow calls another as a node type.
  const tmpBase = path.join(
    os.tmpdir(),
    `fw-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
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
            trace.push({
              type: (event.type as string) || 'UNKNOWN',
              timestamp: Date.now(),
              data: event,
            });
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

    // Dynamic import (tsx runtime supports .ts imports)
    const mod = await import(tmpFile);

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
      ...(includeTrace && { trace }),
    };
  } finally {
    // Clean up globals
    delete (globalThis as unknown as Record<string, unknown>).__fw_debugger__;
    delete (globalThis as unknown as Record<string, unknown>).__fw_mocks__;
    // Clean up temp files
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpTsFile); } catch { /* ignore */ }
  }
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
