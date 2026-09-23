/**
 * Workflow executor for MCP-side compilation and execution.
 * Copies source to a temp file, compiles all workflows in-place, then dynamically imports and executes.
 */

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import ts from 'typescript';
import { compileWorkflow, parseWorkflow } from '../api/index.js';
import { validateDurableClosure } from '../api/durable-validation.js';
import { graphIdentity } from '../api/graph-identity.js';
import { getAvailableWorkflows } from '../api/workflow-file-operations.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { TExternalNodeType } from '../parser.js';
import type { DebugController } from '../runtime/debug-controller.js';
import { CancellationError } from '../runtime/CancellationError.js';
import {
  createContinuationEnvelope,
  decodeContinuation,
  type ContinuationEnvelope,
  type AcceptedContinuationEnvelope,
  type ContinuationRefusal,
  type DurableGate,
  canonicalWireValue,
} from '../runtime/continuation.js';
import {
  acceptGateResolution,
  createWorkflowRuntime,
  isAmbiguousEffectError,
  isDurableGateYield,
  requireEffectRecovery,
  type EffectAdapter,
  type GateResolution,
  type WorkflowRuntimeServices,
} from '../runtime/durable-execution.js';

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
  /** Stable coordinator-owned identity for the complete durable run. */
  runId: string;
  /**
   * Coordinator-verified identity of the complete executable artifact closure.
   * Required for durable yield or resume; Flow Weaver never substitutes a
   * workflow-source hash for whole-bundle evidence.
   */
  bundleDigest?: string;
  filePath: string;
  params?: Record<string, unknown>;
  workflowName?: string;
  production?: boolean;
  includeTrace?: boolean;
  mocks?: FwMockConfig;
  debugController?: DebugController;
  onEvent?: (event: ExecutionTraceEvent) => void;
  externalNodeTypes?: TExternalNodeType[];
  /** Strict continuation input from a previously committed yielded outcome. */
  continuation?: string | unknown;
  /** Single durable resolution for the continuation's exact gate. */
  resolution?: GateResolution;
  /** Recovery contract for explicitly declared effect nodes. */
  effectAdapter?: EffectAdapter;
  /**
   * Parent-owned cooperative cancellation signal for this execution.
   *
   * Flow Weaver observes cancellation at generated node boundaries, nested
   * scopes and engine-owned waits. A node that ignores cancellation is not
   * preempted. A hard stop requires a parent-owned process boundary.
   */
  abortSignal?: AbortSignal;
}

/** Result returned after executing a workflow request. */
export interface CompletedExecutionOutcome {
  readonly kind: 'completed';
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

export interface YieldedExecutionOutcome {
  readonly kind: 'yielded';
  readonly gate: DurableGate;
  readonly continuation: ContinuationEnvelope;
  readonly functionName: string;
  readonly executionTime: number;
  readonly trace?: ExecutionTraceEvent[];
  readonly summary?: TraceSummary;
}

export type WorkflowExecutionOutcome =
  | CompletedExecutionOutcome
  | YieldedExecutionOutcome;

export class ContinuationRefusalError extends Error {
  readonly name = 'ContinuationRefusalError';

  constructor(readonly refusal: ContinuationRefusal) {
    super(refusal.message);
  }
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
): Promise<WorkflowExecutionOutcome> {
  const {
    runId,
    bundleDigest,
    filePath,
    params,
    workflowName,
    production: requestedProduction,
    includeTrace: requestedIncludeTrace,
    mocks,
    debugController,
    onEvent,
    externalNodeTypes,
    abortSignal,
    continuation,
    resolution,
    effectAdapter,
  } = request;
  if (runId.trim().length === 0) {
    throw new Error('runId must be a non-empty coordinator-owned identity');
  }
  if (bundleDigest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(bundleDigest)) {
    throw new Error('bundleDigest must use canonical sha256:<64hex> form');
  }
  const acceptedResolution = acceptGateResolution(resolution);
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
    const selectedWorkflow =
      allWorkflows.find((workflow) => workflow.functionName === workflowName) ??
      allWorkflows[0];
    if (!selectedWorkflow) {
      throw new Error('No workflow definition found in file');
    }
    const effectiveWorkflowId = selectedWorkflow.functionName;
    const parsed = await parseWorkflow(resolvedPath, {
      workflowName: effectiveWorkflowId,
      projectDir: path.dirname(resolvedPath),
      externalNodeTypes,
    });
    if (parsed.errors.length > 0) {
      throw new Error(`Cannot fingerprint invalid workflow: ${parsed.errors.join('; ')}`);
    }
    const { capabilities, graphFingerprint, continuationGraph } = graphIdentity(
      parsed.ast,
      parsed.allWorkflows,
    );
    if (capabilities.gate && bundleDigest === undefined) {
      throw new ContinuationRefusalError({
        accepted: false,
        reason: 'wrong-bundle',
        message:
          'a workflow graph with durable gates requires coordinator-verified whole-bundle identity before execution',
      });
    }
    if (capabilities.gate && capabilities.effect && effectAdapter === undefined) {
      throw new ContinuationRefusalError({
        accepted: false,
        reason: 'ambiguous-effect',
        message:
          'a durable-gate graph with effects requires an operation-key recovery adapter before execution',
      });
    }
    validateDurableClosure(parsed.ast, parsed.allWorkflows);
    let acceptedContinuation: AcceptedContinuationEnvelope | undefined;
    if (continuation !== undefined) {
      if (bundleDigest === undefined) {
        throw new ContinuationRefusalError({
          accepted: false,
          reason: 'wrong-bundle',
          message: 'durable resume requires coordinator-verified whole-bundle identity',
        });
      }
      const decoded = decodeContinuation(continuation, {
        runId,
        workflowId: effectiveWorkflowId,
        bundleDigest,
        graphFingerprint,
        gateId: acceptedResolution?.gateId,
        graph: continuationGraph,
      });
      if (!decoded.accepted) throw new ContinuationRefusalError(decoded);
      if (acceptedResolution === undefined) {
        throw new ContinuationRefusalError({
          accepted: false,
          reason: 'stale-gate',
          message: 'a continuation resume requires its exact gate resolution',
        });
      }
      acceptedContinuation = decoded.envelope;
      for (const receipt of acceptedContinuation.receipts) {
        const receiptWorkflowId = receipt.address.frames.at(-1)?.workflowId;
        const receiptNode = continuationGraph.nodes.find(
          (node) =>
            node.workflowId === receiptWorkflowId &&
            node.nodeId === receipt.address.nodeId &&
            node.nodeType === receipt.address.nodeType,
        );
        let recovery;
        try {
          recovery = requireEffectRecovery(
            await effectAdapter?.recover(receipt.operationKey, receipt.address),
            receipt.operationKey,
            receipt.address,
          );
        } catch {
          recovery = { kind: 'ambiguous' as const };
        }
        const recordedResult = Object.fromEntries(
          acceptedContinuation.state.variables
            .filter(
              (variable) =>
                canonicalWireValue(variable.address) ===
                  canonicalWireValue(receipt.address) &&
                receiptNode?.outputPorts.includes(variable.portName) === true,
            )
            .map((variable) => [variable.portName, variable.value]),
        );
        if (
          recovery?.kind !== 'committed' ||
          canonicalWireValue(recovery.receipt) !== canonicalWireValue(receipt.receipt) ||
          canonicalWireValue(recovery.result) !== canonicalWireValue(recordedResult)
        ) {
          throw new ContinuationRefusalError({
            accepted: false,
            reason: 'ambiguous-effect',
            message:
              'a completed effect continuation must be re-attested by its operation-key adapter',
          });
        }
      }
    } else if (acceptedResolution !== undefined) {
      throw new ContinuationRefusalError({
        accepted: false,
        reason: 'stale-gate',
        message: 'a gate resolution cannot be supplied without a continuation',
      });
    }

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

    const compiledCode = fs.readFileSync(tmpTsFile, 'utf8');

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

    // Dynamic import using file:// URL for cross-platform compatibility
    // (Windows paths like C:\... break with bare import() — "Received protocol 'c:'")
    const mod = await import(pathToFileURL(tmpFile).href);

    // Register exported functions for local invokeWorkflow resolution
    const workflowRegistry: Record<string, (...args: unknown[]) => unknown> = {};
    for (const workflow of parsed.allWorkflows) {
      const value = mod[workflow.functionName];
      if (typeof value === 'function') {
        workflowRegistry[workflow.functionName] =
          value as (...args: unknown[]) => unknown;
      }
    }
    const services: WorkflowRuntimeServices & {
      workflowRegistry?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
    } = {
      debugger: debugger_,
      debugController,
      mocks,
      effectAdapter,
      workflowRegistry,
    };
    const runtime = createWorkflowRuntime({
      runId,
      workflowId: effectiveWorkflowId,
      abortSignal,
      services,
      continuation: acceptedContinuation,
      resolution: acceptedResolution,
      bundleDigest,
    });

    // Find the target exported function. The compiled module also exports the
    // engine's helpers (createWorkflowRuntime and friends), so the lookup is
    // always by the selected workflow's name, never "the first function".
    const exportedFn = findExportedFunction(mod, effectiveWorkflowId);
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

    // Execute the required v2 generated ABI: (execute, params, runtime).
    if (abortSignal?.aborted) throw new CancellationError();
    try {
      const result = await exportedFn.fn(true, params ?? {}, runtime);
      runtime.durable.assertResumeResolutionConsumed();
      const executionTime = Date.now() - startTime;
      return {
        kind: 'completed',
        result,
        functionName: exportedFn.name,
        executionTime,
        ...(includeTrace && { trace, summary: computeTraceSummary(trace) }),
      };
    } catch (error) {
      if (isDurableGateYield(error)) {
        if (bundleDigest === undefined) {
          throw new ContinuationRefusalError({
            accepted: false,
            reason: 'wrong-bundle',
            message: 'durable yield requires coordinator-verified whole-bundle identity',
          });
        }
        runtime.durable.assertResumeResolutionConsumed();
        const executionTime = Date.now() - startTime;
        return {
          kind: 'yielded',
          gate: error.gate,
          continuation: createContinuationEnvelope({
            runId,
            gateId: error.gate.id,
            gateKind: error.gate.kind,
            workflowId: effectiveWorkflowId,
            bundleDigest,
            graphFingerprint,
            location: error.gate.address,
            state: error.state,
            receipts: error.receipts,
          }),
          functionName: exportedFn.name,
          executionTime,
          ...(includeTrace && { trace, summary: computeTraceSummary(trace) }),
        };
      }
      if (isAmbiguousEffectError(error)) {
        throw new ContinuationRefusalError({
          accepted: false,
          reason: 'ambiguous-effect',
          message: error.message,
        });
      }
      throw error;
    }
  } finally {
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
