/**
 * Runtime-only executor for sealed, build-time compiled workflow modules.
 *
 * This module deliberately imports no parser, compiler, TypeScript, or source
 * transformation code. The signed module contains the executable body and the
 * graph facts required to validate durable continuations.
 */
import { pathToFileURL } from 'node:url';
import { CancellationError } from './CancellationError.js';
import {
  canonicalWireValue,
  createContinuationEnvelope,
  decodeContinuation,
  GENERATOR_ABI,
  type AcceptedContinuationEnvelope,
  type ContinuationEnvelope,
  type ContinuationGraphCompatibility,
  type ContinuationRefusal,
  type DurableGate,
} from './continuation.js';
import {
  acceptGateResolution,
  createWorkflowRuntime,
  isAmbiguousEffectError,
  isDurableGateYield,
  requireEffectRecovery,
  type EffectAdapter,
  type GateResolution,
  type WorkflowRuntimeServices,
} from './durable-execution.js';
import {
  EXECUTABLE_WORKFLOW_METADATA_EXPORT,
  EXECUTABLE_WORKFLOW_MODULE_FORMAT,
  type ExecutableWorkflowModuleMetadata,
} from './executable-module-contract.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { DebugController } from './debug-controller.js';

export interface ExecutionTraceEvent {
  readonly type: string;
  readonly timestamp: number;
  readonly data?: Record<string, unknown>;
}

export interface NodeTiming {
  readonly nodeId: string;
  readonly durationMs: number;
}

export interface TraceSummary {
  readonly totalNodes: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly nodeTimings: readonly NodeTiming[];
  readonly totalDurationMs: number;
}

export interface PrecompiledWorkflowExecutionRequest {
  readonly runId: string;
  readonly bundleDigest?: string;
  readonly filePath: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly workflowName: string;
  readonly includeTrace?: boolean;
  readonly mocks?: FwMockConfig;
  readonly debugController?: DebugController;
  readonly onEvent?: (event: ExecutionTraceEvent) => void;
  readonly continuation?: unknown;
  readonly resolution?: GateResolution;
  readonly effectAdapter?: EffectAdapter;
  readonly abortSignal?: AbortSignal;
}

export interface CompletedExecutionOutcome {
  readonly kind: 'completed';
  readonly result: unknown;
  readonly functionName: string;
  readonly executionTime: number;
  readonly trace?: readonly ExecutionTraceEvent[];
  readonly summary?: TraceSummary;
}

export interface YieldedExecutionOutcome {
  readonly kind: 'yielded';
  readonly gate: DurableGate;
  readonly continuation: ContinuationEnvelope;
  readonly functionName: string;
  readonly executionTime: number;
  readonly trace?: readonly ExecutionTraceEvent[];
  readonly summary?: TraceSummary;
}

export type PrecompiledWorkflowExecutionOutcome = CompletedExecutionOutcome | YieldedExecutionOutcome;

export class ContinuationRefusalError extends Error {
  readonly name = 'ContinuationRefusalError';

  constructor(readonly refusal: ContinuationRefusal) {
    super(refusal.message);
  }
}

export async function executePrecompiledWorkflow(
  request: PrecompiledWorkflowExecutionRequest,
): Promise<PrecompiledWorkflowExecutionOutcome> {
  const {
    runId,
    bundleDigest,
    filePath,
    params,
    workflowName,
    includeTrace: requestedIncludeTrace,
    mocks,
    debugController,
    onEvent,
    abortSignal,
    continuation,
    resolution,
    effectAdapter,
  } = request;
  if (runId.trim().length === 0) throw new Error('runId must be a non-empty coordinator-owned identity');
  if (workflowName.trim().length === 0) throw new Error('workflowName must be non-empty');
  if (bundleDigest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(bundleDigest)) {
    throw new Error('bundleDigest must use canonical sha256:<64hex> form');
  }
  const acceptedResolution = acceptGateResolution(resolution);
  if (abortSignal?.aborted) throw new CancellationError();

  const includeTrace = requestedIncludeTrace !== false;
  const module = await import(pathToFileURL(filePath).href);
  const metadata = acceptExecutableWorkflowMetadata(module[EXECUTABLE_WORKFLOW_METADATA_EXPORT]);
  if (metadata.workflowName !== workflowName || !metadata.workflowNames.includes(workflowName)) {
    throw new Error(`Executable artifact does not declare workflow ${JSON.stringify(workflowName)}`);
  }
  if (metadata.capabilities.gate && bundleDigest === undefined) {
    refuse('wrong-bundle', 'a workflow graph with durable gates requires coordinator-verified whole-bundle identity before execution');
  }
  if (metadata.capabilities.gate && metadata.capabilities.effect && effectAdapter === undefined) {
    refuse('ambiguous-effect', 'a durable-gate graph with effects requires an operation-key recovery adapter before execution');
  }

  let acceptedContinuation: AcceptedContinuationEnvelope | undefined;
  if (continuation !== undefined) {
    if (bundleDigest === undefined) {
      refuse('wrong-bundle', 'durable resume requires coordinator-verified whole-bundle identity');
    }
    const decoded = decodeContinuation(continuation, {
      runId,
      workflowId: workflowName,
      bundleDigest,
      graphFingerprint: metadata.graphFingerprint,
      gateId: acceptedResolution?.gateId,
      graph: metadata.continuationGraph,
    });
    if (!decoded.accepted) throw new ContinuationRefusalError(decoded);
    if (acceptedResolution === undefined) {
      refuse('stale-gate', 'a continuation resume requires its exact gate resolution');
    }
    acceptedContinuation = decoded.envelope;
    await reattestEffects(acceptedContinuation, metadata.continuationGraph, effectAdapter);
  } else if (acceptedResolution !== undefined) {
    refuse('stale-gate', 'a gate resolution cannot be supplied without a continuation');
  }

  const trace: ExecutionTraceEvent[] = [];
  const debugger_ = includeTrace ? {
    sendEvent: (event: Record<string, unknown>) => {
      const traceEvent: ExecutionTraceEvent = {
        type: typeof event.type === 'string' ? event.type : 'UNKNOWN',
        timestamp: Date.now(),
        data: event,
      };
      trace.push(traceEvent);
      onEvent?.(traceEvent);
    },
    innerFlowInvocation: false,
  } : undefined;
  const workflowRegistry: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of metadata.workflowNames) {
    const value = module[name];
    if (typeof value !== 'function') throw new Error(`Executable artifact export ${JSON.stringify(name)} is not a function`);
    workflowRegistry[name] = value as (...args: unknown[]) => unknown;
  }
  const target = workflowRegistry[workflowName];
  if (target === undefined) throw new Error(`Executable artifact does not export workflow ${JSON.stringify(workflowName)}`);
  const services: WorkflowRuntimeServices = {
    debugger: debugger_,
    debugController,
    mocks,
    effectAdapter,
    workflowRegistry,
  };
  const runtime = createWorkflowRuntime({
    runId,
    workflowId: workflowName,
    abortSignal,
    services,
    continuation: acceptedContinuation,
    resolution: acceptedResolution,
  });

  const startTime = Date.now();
  if (abortSignal?.aborted) throw new CancellationError();
  try {
    const result = await target(true, params ?? {}, runtime);
    runtime.durable.assertResumeResolutionConsumed();
    return completedOutcome(result, workflowName, Date.now() - startTime, includeTrace, trace);
  } catch (error) {
    if (isDurableGateYield(error)) {
      if (bundleDigest === undefined) refuse('wrong-bundle', 'durable yield requires coordinator-verified whole-bundle identity');
      runtime.durable.assertResumeResolutionConsumed();
      const executionTime = Date.now() - startTime;
      return {
        kind: 'yielded',
        gate: error.gate,
        continuation: createContinuationEnvelope({
          runId,
          gateId: error.gate.id,
          gateKind: error.gate.kind,
          workflowId: workflowName,
          bundleDigest,
          graphFingerprint: metadata.graphFingerprint,
          location: error.gate.address,
          state: error.state,
          receipts: error.receipts,
        }),
        functionName: workflowName,
        executionTime,
        ...(includeTrace && { trace, summary: computeTraceSummary(trace) }),
      };
    }
    if (isAmbiguousEffectError(error)) {
      refuse('ambiguous-effect', error.message);
    }
    throw error;
  }
}

function completedOutcome(
  result: unknown,
  functionName: string,
  executionTime: number,
  includeTrace: boolean,
  trace: ExecutionTraceEvent[],
): CompletedExecutionOutcome {
  return {
    kind: 'completed',
    result,
    functionName,
    executionTime,
    ...(includeTrace && { trace, summary: computeTraceSummary(trace) }),
  };
}

function acceptExecutableWorkflowMetadata(value: unknown): ExecutableWorkflowModuleMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Executable artifact metadata is missing');
  }
  const metadata = value as Partial<ExecutableWorkflowModuleMetadata>;
  if (metadata.formatVersion !== EXECUTABLE_WORKFLOW_MODULE_FORMAT) {
    throw new Error('Executable artifact metadata format is unsupported');
  }
  if (metadata.generatorAbi !== GENERATOR_ABI) {
    throw new Error('Executable artifact generator ABI is unsupported');
  }
  if (typeof metadata.workflowName !== 'string' || metadata.workflowName.length === 0) {
    throw new Error('Executable artifact workflowName is malformed');
  }
  if (!Array.isArray(metadata.workflowNames) || metadata.workflowNames.length === 0 ||
      metadata.workflowNames.some((name) => typeof name !== 'string' || name.length === 0) ||
      new Set(metadata.workflowNames).size !== metadata.workflowNames.length) {
    throw new Error('Executable artifact workflowNames are malformed');
  }
  if (typeof metadata.graphFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.graphFingerprint)) {
    throw new Error('Executable artifact graphFingerprint is malformed');
  }
  if (metadata.continuationGraph === null || typeof metadata.continuationGraph !== 'object' ||
      !Array.isArray(metadata.continuationGraph.nodes)) {
    throw new Error('Executable artifact continuationGraph is malformed');
  }
  if (metadata.capabilities === null || typeof metadata.capabilities !== 'object' ||
      typeof metadata.capabilities.gate !== 'boolean' || typeof metadata.capabilities.effect !== 'boolean') {
    throw new Error('Executable artifact capabilities are malformed');
  }
  return metadata as ExecutableWorkflowModuleMetadata;
}

async function reattestEffects(
  continuation: AcceptedContinuationEnvelope,
  graph: ContinuationGraphCompatibility,
  effectAdapter: EffectAdapter | undefined,
): Promise<void> {
  for (const receipt of continuation.receipts) {
    const receiptWorkflowId = receipt.address.frames.at(-1)?.workflowId;
    const receiptNode = graph.nodes.find((node) =>
      node.workflowId === receiptWorkflowId && node.nodeId === receipt.address.nodeId && node.nodeType === receipt.address.nodeType);
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
    const recordedResult = Object.fromEntries(continuation.state.variables
      .filter((variable) => canonicalWireValue(variable.address) === canonicalWireValue(receipt.address) &&
        receiptNode?.outputPorts.includes(variable.portName) === true)
      .map((variable) => [variable.portName, variable.value]));
    if (recovery.kind !== 'committed' ||
        canonicalWireValue(recovery.receipt) !== canonicalWireValue(receipt.receipt) ||
        canonicalWireValue(recovery.result) !== canonicalWireValue(recordedResult)) {
      refuse('ambiguous-effect', 'a completed effect continuation must be re-attested by its operation-key adapter');
    }
  }
}

function refuse(reason: ContinuationRefusal['reason'], message: string): never {
  throw new ContinuationRefusalError({ accepted: false, reason, message });
}

export function computeTraceSummary(trace: readonly ExecutionTraceEvent[]): TraceSummary {
  if (trace.length === 0) {
    return { totalNodes: 0, succeeded: 0, failed: 0, cancelled: 0, nodeTimings: [], totalDurationMs: 0 };
  }
  const nodeStartTimes = new Map<string, number>();
  const nodeFinalStatus = new Map<string, string>();
  const nodeTimings: NodeTiming[] = [];
  for (const event of trace) {
    if (event.type !== 'STATUS_CHANGED' || event.data === undefined) continue;
    const id = event.data.id;
    const status = event.data.status;
    if (typeof id !== 'string' || typeof status !== 'string') continue;
    if (status === 'RUNNING') nodeStartTimes.set(id, event.timestamp);
    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED') {
      nodeFinalStatus.set(id, status);
      const startTime = nodeStartTimes.get(id);
      if (startTime !== undefined) nodeTimings.push({ nodeId: id, durationMs: event.timestamp - startTime });
    }
  }
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;
  for (const status of nodeFinalStatus.values()) {
    if (status === 'SUCCEEDED') succeeded += 1;
    else if (status === 'FAILED') failed += 1;
    else if (status === 'CANCELLED') cancelled += 1;
  }
  return {
    totalNodes: nodeFinalStatus.size,
    succeeded,
    failed,
    cancelled,
    nodeTimings,
    totalDurationMs: trace.at(-1)!.timestamp - trace[0]!.timestamp,
  };
}
