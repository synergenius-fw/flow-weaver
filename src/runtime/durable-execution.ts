import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { DebugController } from './debug-controller.js';
import type { TDebugger } from './events.js';
import {
  operationKey,
  durableGateId,
  canonicalWireValue,
  cloneAndFreezeWireValue,
  executionAddressKey,
  assertAcceptedContinuation,
  type AcceptedContinuationEnvelope,
  validateWireValue,
  type ContinuationEnvelope,
  type ContinuationState,
  type ContinuationVariable,
  type BranchAddress,
  type DurableGate,
  type DurableGateKind,
  type EffectReceipt,
  type ExecutionAddress,
  type ScopeAddress,
  type WireValue,
  type WorkflowFrameAddress,
} from './continuation.js';

export interface GateResolution {
  readonly gateId: string;
  readonly value: WireValue;
}

export function acceptGateResolution(resolution: GateResolution | undefined): GateResolution | undefined {
  if (resolution === undefined) return undefined;
  validateWireValue(resolution);
  const keys = Object.keys(resolution).sort();
  if (keys.length !== 2 || keys[0] !== 'gateId' || keys[1] !== 'value' || !/^[0-9a-f]{64}$/.test(resolution.gateId)) {
    throw new Error('resolution must contain exactly a canonical gateId and wire value');
  }
  return cloneAndFreezeWireValue(resolution as unknown as WireValue) as unknown as GateResolution;
}

export type EffectRecovery =
  | { readonly kind: 'not-committed' }
  | {
      readonly kind: 'committed';
      readonly receipt: WireValue;
      readonly result: WireValue;
    }
  | { readonly kind: 'repeatable' }
  | { readonly kind: 'ambiguous' };

export interface EffectAdapter {
  recover(operationKey: string, address: ExecutionAddress): Promise<EffectRecovery>;
  /** Persist the exact successful effect result before it enters a continuation. */
  commit?(
    operationKey: string,
    address: ExecutionAddress,
    execution: EffectExecution<WireValue>,
  ): Promise<void>;
}

export interface WorkflowRuntimeServices {
  readonly debugger?: TDebugger;
  readonly debugController?: DebugController;
  readonly mocks?: FwMockConfig;
  readonly workflowRegistry?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
  readonly effectAdapter?: EffectAdapter;
}

export interface WorkflowRuntime {
  readonly runId: string;
  readonly abortSignal?: AbortSignal;
  readonly services: WorkflowRuntimeServices;
  readonly durable: DurableExecution;
  readonly frames: readonly WorkflowFrameAddress[];
  readonly scopes: readonly ScopeAddress[];
  readonly branches: readonly BranchAddress[];
}

export interface NodeExecutionRuntime {
  readonly nodeId: string;
  readonly runtime: WorkflowRuntime;
  readonly recursionDepth: number;
  createNestedRuntime(workflowId: string): WorkflowRuntime;
}

export interface CreateWorkflowRuntimeOptions {
  readonly runId: string;
  readonly workflowId: string;
  readonly abortSignal?: AbortSignal;
  readonly services?: WorkflowRuntimeServices;
  readonly continuation?: AcceptedContinuationEnvelope;
  readonly resolution?: GateResolution;
}

export interface GateBoundary {
  readonly kind: DurableGateKind;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly executionIndex: number;
  readonly payload: WireValue;
}

export interface EffectBoundary {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly executionIndex: number;
}

export interface EffectExecution<T extends WireValue> {
  readonly result: T;
  readonly receipt: WireValue;
}

export class DurableGateYield extends Error {
  readonly code = 'FLOW_WEAVER_DURABLE_GATE_YIELD';

  constructor(
    readonly gate: DurableGate,
    readonly state: ContinuationState,
    readonly receipts: readonly EffectReceipt[],
  ) {
    super(`Workflow yielded at ${gate.kind} gate "${gate.id}"`);
    this.name = 'DurableGateYield';
  }
}

export class AmbiguousEffectError extends Error {
  readonly code = 'FLOW_WEAVER_AMBIGUOUS_EFFECT';

  constructor(
    readonly operationKey: string,
    readonly address: ExecutionAddress,
  ) {
    super(`Effect "${operationKey}" has an ambiguous commit state`);
    this.name = 'AmbiguousEffectError';
  }
}

function addressKey(address: ExecutionAddress): string {
  return executionAddressKey(address);
}

function variableKey(address: ExecutionAddress, portName: string): string {
  return `${executionAddressKey(address)}\0${portName}`;
}

function cloneAddress(address: ExecutionAddress): ExecutionAddress {
  return {
    frames: address.frames.map((frame) => ({ ...frame })),
    scopes: address.scopes.map((scope) => ({ ...scope })),
    branches: address.branches.map((branch) => ({ ...branch })),
    nodeId: address.nodeId,
    nodeType: address.nodeType,
    executionIndex: address.executionIndex,
  };
}

function isCanonicalPrefix(candidate: readonly unknown[], current: readonly unknown[]): boolean {
  return (
    candidate.length <= current.length &&
    canonicalWireValue(candidate) === canonicalWireValue(current.slice(0, candidate.length))
  );
}

function isCanonicalEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && canonicalWireValue(left) === canonicalWireValue(right);
}

export function requireEffectRecovery(value: unknown, key: string, address: ExecutionAddress): EffectRecovery {
  try {
    validateWireValue(value);
  } catch {
    throw new AmbiguousEffectError(key, address);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AmbiguousEffectError(key, address);
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if ((kind === 'not-committed' || kind === 'repeatable' || kind === 'ambiguous') && Object.keys(record).length === 1) {
    return { kind };
  }
  if (
    kind === 'committed' &&
    Object.keys(record).length === 3 &&
    Object.hasOwn(record, 'receipt') &&
    Object.hasOwn(record, 'result')
  ) {
    return {
      kind,
      receipt: record.receipt as WireValue,
      result: record.result as WireValue,
    };
  }
  throw new AmbiguousEffectError(key, address);
}

function requireEffectExecution<T extends WireValue>(
  value: unknown,
  key: string,
  address: ExecutionAddress,
): EffectExecution<T> {
  try {
    validateWireValue(value);
  } catch {
    throw new AmbiguousEffectError(key, address);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AmbiguousEffectError(key, address);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'result') || !Object.hasOwn(record, 'receipt')) {
    throw new AmbiguousEffectError(key, address);
  }
  return {
    result: record.result as T,
    receipt: record.receipt as WireValue,
  };
}

export class DurableExecution {
  private readonly completed = new Map<string, ExecutionAddress>();
  private readonly variables = new Map<string, Omit<ContinuationVariable, 'value'> & { readonly value: unknown }>();
  private readonly receipts = new Map<string, EffectReceipt>();
  private readonly resumeEnvelope?: ContinuationEnvelope;
  private readonly resolution?: GateResolution;
  private resolutionConsumed = false;

  constructor(
    readonly runId: string,
    readonly workflowId: string,
    continuation?: AcceptedContinuationEnvelope,
    resolution?: GateResolution,
  ) {
    if (continuation !== undefined) {
      assertAcceptedContinuation(continuation);
      if (continuation.runId !== runId) {
        throw new Error('accepted continuation belongs to another run');
      }
      if (continuation.workflowId !== workflowId) {
        throw new Error('accepted continuation belongs to another workflow');
      }
    }
    this.resumeEnvelope = continuation;
    this.resolution = acceptGateResolution(resolution);

    for (const address of continuation?.state.completed ?? []) {
      this.completed.set(addressKey(address), cloneAddress(address));
    }
    for (const variable of continuation?.state.variables ?? []) {
      this.variables.set(variableKey(variable.address, variable.portName), {
        address: cloneAddress(variable.address),
        portName: variable.portName,
        value: variable.value,
      });
    }
    for (const receipt of continuation?.receipts ?? []) {
      this.receipts.set(addressKey(receipt.address), {
        address: cloneAddress(receipt.address),
        operationKey: receipt.operationKey,
        receipt: receipt.receipt,
      });
    }
  }

  address(
    runtime: Pick<WorkflowRuntime, 'frames' | 'scopes' | 'branches'>,
    nodeId: string,
    nodeType: string,
    executionIndex: number,
  ): ExecutionAddress {
    return {
      frames: runtime.frames.map((frame) => ({ ...frame })),
      scopes: runtime.scopes.map((scope) => ({ ...scope })),
      branches: runtime.branches.map((branch) => ({ ...branch })),
      nodeId,
      nodeType,
      executionIndex,
    };
  }

  shouldExecute(address: ExecutionAddress): boolean {
    return !this.completed.has(addressKey(address));
  }

  commitNode(address: ExecutionAddress): void {
    this.completed.set(addressKey(address), cloneAddress(address));
  }

  setVariable(address: ExecutionAddress, portName: string, value: unknown): void {
    this.variables.set(variableKey(address, portName), {
      address: cloneAddress(address),
      portName,
      value,
    });
  }

  getVariable(address: ExecutionAddress, portName: string, allowAncestorLookup = true): unknown {
    const exact = this.variables.get(variableKey(address, portName));
    if (exact !== undefined) return exact.value;
    if (!allowAncestorLookup) return undefined;

    const candidates = [...this.variables.values()]
      .filter(
        (variable) =>
          variable.portName === portName &&
          variable.address.nodeId === address.nodeId &&
          variable.address.nodeType === address.nodeType &&
          variable.address.executionIndex === address.executionIndex &&
          isCanonicalPrefix(variable.address.frames, address.frames) &&
          isCanonicalPrefix(variable.address.scopes, address.scopes) &&
          isCanonicalPrefix(variable.address.branches, address.branches),
      )
      .sort(
        (left, right) =>
          right.address.frames.length +
          right.address.scopes.length +
          right.address.branches.length -
          (left.address.frames.length + left.address.scopes.length + left.address.branches.length),
      );
    const specificity = (candidate: (typeof candidates)[number]): number =>
      candidate.address.frames.length + candidate.address.scopes.length + candidate.address.branches.length;
    if (candidates.length > 1 && specificity(candidates[0]) === specificity(candidates[1])) {
      throw new Error(`Ambiguous durable variable address for ${address.nodeId}.${portName}`);
    }
    if (candidates[0] !== undefined) return candidates[0].value;

    // Generated workflows leave a selected control-flow branch before
    // projecting its outputs through Exit. A fresh continuation resume has no
    // process-local variable cache, so that projection must recover the one
    // value committed by the branch that actually ran. This is deliberately
    // narrower than ancestor lookup: it cannot cross workflow frames or
    // scopes, and more than one compatible descendant fails closed.
    const converged = [...this.variables.values()].filter(
      (variable) =>
        variable.portName === portName &&
        variable.address.nodeId === address.nodeId &&
        variable.address.nodeType === address.nodeType &&
        variable.address.executionIndex === address.executionIndex &&
        isCanonicalEqual(variable.address.frames, address.frames) &&
        isCanonicalEqual(variable.address.scopes, address.scopes) &&
        isCanonicalPrefix(address.branches, variable.address.branches),
    );
    if (converged.length > 1) {
      throw new Error(`Ambiguous durable variable address for ${address.nodeId}.${portName}`);
    }
    return converged[0]?.value;
  }

  resolveGate(runtime: WorkflowRuntime, boundary: GateBoundary): WireValue {
    validateWireValue(boundary.payload);
    const address = this.address(runtime, boundary.nodeId, boundary.nodeType, boundary.executionIndex);
    const id = durableGateId(this.runId, boundary.kind, address);

    if (this.resumeEnvelope !== undefined && !this.resolutionConsumed) {
      if (
        addressKey(this.resumeEnvelope.location) !== addressKey(address) ||
        this.resumeEnvelope.gateId !== id ||
        this.resumeEnvelope.gateKind !== boundary.kind ||
        this.resolution === undefined ||
        this.resolution.gateId !== id
      ) {
        const error = new Error('Gate resolution is stale, reordered, or does not match the resume boundary');
        error.name = 'StaleGateError';
        throw error;
      }
      validateWireValue(this.resolution.value);
      this.resolutionConsumed = true;
      return this.resolution.value;
    }

    if (this.resumeEnvelope !== undefined && addressKey(this.resumeEnvelope.location) === addressKey(address)) {
      const error = new Error('The consumed resume gate was re-entered');
      error.name = 'StaleGateError';
      throw error;
    }

    const gate: DurableGate = {
      id,
      kind: boundary.kind,
      address,
      payload: boundary.payload,
    };
    throw new DurableGateYield(gate, this.snapshot(address), [...this.receipts.values()]);
  }

  async executeEffect<T extends WireValue>(
    runtime: WorkflowRuntime,
    boundary: EffectBoundary,
    execute: (operationKey: string) => Promise<EffectExecution<T>>,
  ): Promise<T> {
    const address = this.address(runtime, boundary.nodeId, boundary.nodeType, boundary.executionIndex);
    const key = operationKey(this.runId, address);
    const committed = this.receipts.get(addressKey(address));
    if (committed !== undefined) {
      throw new Error(`Committed effect "${key}" reached its execution body`);
    }

    let recovery: EffectRecovery | undefined;
    try {
      recovery = await runtime.services.effectAdapter?.recover(key, address);
    } catch {
      throw new AmbiguousEffectError(key, address);
    }
    if (recovery === undefined) {
      throw new AmbiguousEffectError(key, address);
    }
    recovery = requireEffectRecovery(recovery, key, address);
    if (recovery.kind === 'ambiguous') throw new AmbiguousEffectError(key, address);
    if (recovery.kind === 'committed') {
      this.receipts.set(addressKey(address), {
        address: cloneAddress(address),
        operationKey: key,
        receipt: recovery.receipt,
      });
      return recovery.result as T;
    }

    let executed: EffectExecution<T>;
    try {
      executed = requireEffectExecution<T>(await execute(key), key, address);
    } catch (error) {
      let afterFailure: EffectRecovery;
      try {
        afterFailure =
          (await runtime.services.effectAdapter?.recover(key, address)) ?? ({ kind: 'ambiguous' } as const);
      } catch {
        throw new AmbiguousEffectError(key, address);
      }
      afterFailure = requireEffectRecovery(afterFailure, key, address);
      if (afterFailure.kind === 'committed') {
        this.receipts.set(addressKey(address), {
          address: cloneAddress(address),
          operationKey: key,
          receipt: afterFailure.receipt,
        });
        return afterFailure.result as T;
      }
      if (afterFailure.kind === 'ambiguous') {
        throw new AmbiguousEffectError(key, address);
      }
      throw error;
    }
    if (runtime.services.effectAdapter?.commit !== undefined) {
      try {
        await runtime.services.effectAdapter.commit(key, address, executed);
      } catch {
        let committed: EffectRecovery;
        try {
          committed = requireEffectRecovery(
            await runtime.services.effectAdapter.recover(key, address),
            key,
            address,
          );
        } catch {
          throw new AmbiguousEffectError(key, address);
        }
        if (
          committed.kind !== 'committed' ||
          canonicalWireValue(committed.receipt) !== canonicalWireValue(executed.receipt) ||
          canonicalWireValue(committed.result) !== canonicalWireValue(executed.result)
        ) throw new AmbiguousEffectError(key, address);
        this.receipts.set(addressKey(address), {
          address: cloneAddress(address),
          operationKey: key,
          receipt: committed.receipt,
        });
        return committed.result as T;
      }
    }
    this.receipts.set(addressKey(address), {
      address: cloneAddress(address),
      operationKey: key,
      receipt: executed.receipt,
    });
    return executed.result;
  }

  snapshot(nextBoundary: ExecutionAddress): ContinuationState {
    const completedKeys = new Set(this.completed.keys());
    return {
      completed: [...this.completed.values()].map(cloneAddress),
      variables: [...this.variables.values()]
        .filter((variable) => completedKeys.has(addressKey(variable.address)))
        .map((variable) => {
          try {
            validateWireValue(variable.value);
          } catch (error) {
            throw new Error(
              `Continuation variable ${variable.address.nodeId}.${variable.portName} is not a wire value: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return {
            address: cloneAddress(variable.address),
            portName: variable.portName,
            value: variable.value,
          };
        }),
      nextBoundary: cloneAddress(nextBoundary),
    };
  }

  assertResumeResolutionConsumed(): void {
    if (this.resumeEnvelope !== undefined && !this.resolutionConsumed) {
      const error = new Error('Resumed execution completed or yielded without consuming its exact gate resolution');
      error.name = 'UnconsumedGateResolutionError';
      throw error;
    }
  }
}

export function createWorkflowRuntime(options: CreateWorkflowRuntimeOptions): WorkflowRuntime {
  if (options.runId.trim().length === 0) {
    throw new Error('runId must be a non-empty coordinator-owned identity');
  }
  const rootFrame: WorkflowFrameAddress = {
    workflowId: options.workflowId,
    invocation: 0,
  };
  return {
    runId: options.runId,
    abortSignal: options.abortSignal,
    services: options.services ?? {},
    durable: new DurableExecution(options.runId, options.workflowId, options.continuation, options.resolution),
    frames: [rootFrame],
    scopes: [],
    branches: [],
  };
}

export function createNestedWorkflowRuntime(
  runtime: WorkflowRuntime,
  workflowId: string,
  callerNodeId: string,
  callerExecutionIndex: number,
  invocation: number,
): WorkflowRuntime {
  return {
    ...runtime,
    frames: [
      ...runtime.frames,
      {
        workflowId,
        invocation,
        callerNodeId,
        callerExecutionIndex,
      },
    ],
    scopes: runtime.scopes,
    branches: runtime.branches,
  };
}

export function createScopedWorkflowRuntime(runtime: WorkflowRuntime, scope: ScopeAddress): WorkflowRuntime {
  return {
    ...runtime,
    scopes: [...runtime.scopes, scope],
    branches: runtime.branches,
  };
}

export function isDurableGateYield(error: unknown): error is DurableGateYield {
  return (
    error instanceof DurableGateYield ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'FLOW_WEAVER_DURABLE_GATE_YIELD')
  );
}

export function isAmbiguousEffectError(error: unknown): error is AmbiguousEffectError {
  return (
    error instanceof AmbiguousEffectError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'FLOW_WEAVER_AMBIGUOUS_EFFECT')
  );
}
