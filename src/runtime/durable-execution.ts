/**
 * The durable engine: what a generated body talks to through its execution
 * context, and what a coordinator or a host of its own constructs around a
 * run. Node completion, variables, gates and effects are recorded by exact
 * execution address, so a run can stop at a gate and be replayed later by
 * any process from a continuation.
 *
 * This module is written to be inlined: `fw compile` copies its text into
 * every compiled file after `continuation-core.ts` (see
 * `src/api/inline-runtime.ts`). It imports values only from that module,
 * and its type imports are aliased by the inliner. No Node API, nothing
 * past ES2020.
 */
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { DebugController } from './debug-controller.js';
import type { TDebugger } from './events.js';
import {
  ENGINE_VERSION,
  operationKey,
  durableGateId,
  canonicalWireValue,
  cloneAndFreezeWireValue,
  createContinuationEnvelope,
  executionAddressKey,
  assertAcceptedContinuation,
  sha256Hex,
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
} from './continuation-core.js';

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

/**
 * The engine as a generated body sees it. It is an interface, not the class,
 * so a runtime built by the package and one built by a compiled file's own
 * copy of the engine are interchangeable to the type checker: two classes
 * with private members never are.
 */
export interface DurableEngine {
  address(
    runtime: Pick<WorkflowRuntime, 'frames' | 'scopes' | 'branches'>,
    nodeId: string,
    nodeType: string,
    executionIndex: number,
  ): ExecutionAddress;
  /** Called once at the top of a root body: the workflow's name and graph identity. */
  bind(runtime: Pick<WorkflowRuntime, 'frames'>, workflowId: string, graphFingerprint: string): void;
  shouldExecute(address: ExecutionAddress): boolean;
  commitNode(address: ExecutionAddress): void;
  setVariable(address: ExecutionAddress, portName: string, value: unknown): void;
  getVariable(address: ExecutionAddress, portName: string, allowAncestorLookup?: boolean): unknown;
  resolveGate(runtime: WorkflowRuntime, boundary: GateBoundary): WireValue;
  executeEffect<T extends WireValue>(
    runtime: WorkflowRuntime,
    boundary: EffectBoundary,
    execute: (operationKey: string) => Promise<EffectExecution<T>>,
  ): Promise<T>;
  assertResumeResolutionConsumed(): void;
}

export interface WorkflowRuntime {
  readonly runId: string;
  readonly abortSignal?: AbortSignal;
  readonly services: WorkflowRuntimeServices;
  readonly durable: DurableEngine;
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
  /**
   * The identity of the compiled artifact this run executes, `sha256:<hex>`.
   * A coordinator that hashes the artifact passes it; a continuation is
   * refused on resume when it names another. Left out, the engine derives one
   * from the workflow's own graph identity, so a host that keeps a
   * continuation and brings it back to the same compiled file needs nothing
   * more.
   */
  readonly bundleDigest?: string;
}

export interface GateBoundary {
  readonly kind: DurableGateKind;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly executionIndex: number;
  readonly payload: WireValue;
}

/**
 * A gate answered from the mocks, or undefined to yield for real.
 *
 * Any gate is answered by its node id through `gates`, with its data outputs
 * as the object. The built-in agent and event gates are also answered from
 * their own sections, keyed by what the node was given as its first input
 * (the agent id, the event name), by `node:key`, or by `node:*`. The answer
 * becomes the gate's whole output envelope, control ports filled in, which
 * is exactly what a person's answer becomes in `buildGateResolution`.
 */
function mockedGateAnswer(mocks: FwMockConfig | undefined, boundary: GateBoundary): WireValue | undefined {
  if (!mocks) return undefined;
  const { nodeId, nodeType } = boundary;
  const pick = (section: Record<string, object> | undefined, key: string | undefined): object | undefined => {
    if (!section) return undefined;
    if (key !== undefined && section[`${nodeId}:${key}`] !== undefined) return section[`${nodeId}:${key}`];
    if (section[`${nodeId}:*`] !== undefined) return section[`${nodeId}:*`];
    return key !== undefined ? section[key] : undefined;
  };
  const firstInput = (): string | undefined => {
    const p = boundary.payload as { arguments?: Array<{ value?: unknown; absent?: boolean }> } | null;
    const v = p?.arguments?.[0]?.value;
    return v === undefined || v === null ? undefined : String(v);
  };
  let data: object | undefined = mocks.gates?.[nodeId];
  if (data === undefined && nodeType === 'waitForAgent') {
    const v = pick(mocks.agents, firstInput());
    if (v !== undefined) data = { agentResult: v };
  }
  if (data === undefined && nodeType === 'waitForEvent') {
    const v = pick(mocks.events, firstInput());
    if (v !== undefined) data = { eventData: v };
  }
  // `fast` skips waits: a sleeping run wakes at once, as `delay` returns at once.
  if (data === undefined && nodeType === 'sleep' && mocks.fast === true) {
    data = { wokeAt: new Date().toISOString() };
  }
  if (data === undefined || typeof data !== 'object') return undefined;
  const value = { onSuccess: true, onFailure: false, ...(data as Record<string, unknown>) };
  validateWireValue(value);
  return value as WireValue;
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

/**
 * Thrown out of a generated body when a gate has to wait for the outside.
 * It carries everything a host needs to keep: the gate to answer, and the
 * continuation to bring back with the answer. `continuation` is present when
 * the body declared its identity (every body compiled by this version does);
 * a coordinator may also build its own from `state` and `receipts`.
 */
export class DurableGateYield extends Error {
  readonly code = 'FLOW_WEAVER_DURABLE_GATE_YIELD';

  constructor(
    readonly gate: DurableGate,
    readonly state: ContinuationState,
    readonly receipts: readonly EffectReceipt[],
    readonly continuation?: ContinuationEnvelope,
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

function durableAddressKey(address: ExecutionAddress): string {
  return executionAddressKey(address);
}

function durableVariableKey(address: ExecutionAddress, portName: string): string {
  return `${executionAddressKey(address)}\0${portName}`;
}

function cloneExecutionAddress(address: ExecutionAddress): ExecutionAddress {
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
    Object.prototype.hasOwnProperty.call(record, 'receipt') &&
    Object.prototype.hasOwnProperty.call(record, 'result')
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
  if (
    Object.keys(record).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(record, 'result') ||
    !Object.prototype.hasOwnProperty.call(record, 'receipt')
  ) {
    throw new AmbiguousEffectError(key, address);
  }
  return {
    result: record.result as T,
    receipt: record.receipt as WireValue,
  };
}

export class DurableExecution implements DurableEngine {
  private readonly completed = new Map<string, ExecutionAddress>();
  private readonly variables = new Map<string, Omit<ContinuationVariable, 'value'> & { readonly value: unknown }>();
  private readonly receipts = new Map<string, EffectReceipt>();
  private readonly resumeEnvelope?: ContinuationEnvelope;
  private readonly resolution?: GateResolution;
  private readonly givenBundleDigest?: string;
  private graphFingerprint?: string;
  private resolutionConsumed = false;

  constructor(
    readonly runId: string,
    readonly workflowId: string,
    continuation?: AcceptedContinuationEnvelope,
    resolution?: GateResolution,
    bundleDigest?: string,
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
    if (bundleDigest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(bundleDigest)) {
      throw new Error('bundleDigest must use canonical sha256:<64hex> form');
    }
    this.givenBundleDigest = bundleDigest;
    this.resumeEnvelope = continuation;
    this.resolution = acceptGateResolution(resolution);

    for (const address of continuation?.state.completed ?? []) {
      this.completed.set(durableAddressKey(address), cloneExecutionAddress(address));
    }
    for (const variable of continuation?.state.variables ?? []) {
      this.variables.set(durableVariableKey(variable.address, variable.portName), {
        address: cloneExecutionAddress(variable.address),
        portName: variable.portName,
        value: variable.value,
      });
    }
    for (const receipt of continuation?.receipts ?? []) {
      this.receipts.set(durableAddressKey(receipt.address), {
        address: cloneExecutionAddress(receipt.address),
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

  /**
   * The artifact identity this run executes under: the one the coordinator
   * gave, or one derived from the graph identity the body declared. Known
   * only after `bind`.
   */
  bundleDigest(): string | undefined {
    if (this.givenBundleDigest !== undefined) return this.givenBundleDigest;
    if (this.graphFingerprint === undefined) return undefined;
    return `sha256:${sha256Hex(`flow-weaver-inline\0${this.workflowId}\0${this.graphFingerprint}\0${ENGINE_VERSION}`)}`;
  }

  bind(runtime: Pick<WorkflowRuntime, 'frames'>, workflowId: string, graphFingerprint: string): void {
    // Nested bodies (a workflow used as a node, `invokeWorkflow`) bind too;
    // only the root frame names the run's graph.
    if (runtime.frames.length !== 1) return;
    if (workflowId !== this.workflowId) {
      throw new Error(`runtime was created for workflow "${this.workflowId}" but "${workflowId}" is running on it`);
    }
    this.graphFingerprint = graphFingerprint;
    if (this.resumeEnvelope === undefined) return;
    if (this.resumeEnvelope.graphFingerprint !== graphFingerprint) {
      const error = new Error('continuation belongs to another workflow graph');
      error.name = 'ContinuationMismatchError';
      throw error;
    }
    const bundleDigest = this.bundleDigest();
    if (bundleDigest !== undefined && this.resumeEnvelope.bundleDigest !== bundleDigest) {
      const error = new Error('continuation belongs to another bundle');
      error.name = 'ContinuationMismatchError';
      throw error;
    }
  }

  shouldExecute(address: ExecutionAddress): boolean {
    return !this.completed.has(durableAddressKey(address));
  }

  commitNode(address: ExecutionAddress): void {
    this.completed.set(durableAddressKey(address), cloneExecutionAddress(address));
  }

  setVariable(address: ExecutionAddress, portName: string, value: unknown): void {
    this.variables.set(durableVariableKey(address, portName), {
      address: cloneExecutionAddress(address),
      portName,
      value,
    });
  }

  getVariable(address: ExecutionAddress, portName: string, allowAncestorLookup = true): unknown {
    const exact = this.variables.get(durableVariableKey(address, portName));
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
    // A mocked gate is answered here, on the first run and on every replay
    // alike, so it never pauses and never enters the resume bookkeeping below.
    const mocked = mockedGateAnswer(runtime.services.mocks, boundary);
    if (mocked !== undefined) return mocked;
    const address = this.address(runtime, boundary.nodeId, boundary.nodeType, boundary.executionIndex);
    const id = durableGateId(this.runId, boundary.kind, address);

    if (this.resumeEnvelope !== undefined && !this.resolutionConsumed) {
      if (
        durableAddressKey(this.resumeEnvelope.location) !== durableAddressKey(address) ||
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

    if (this.resumeEnvelope !== undefined && durableAddressKey(this.resumeEnvelope.location) === durableAddressKey(address)) {
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
    const state = this.snapshot(address);
    const receipts = [...this.receipts.values()];
    const bundleDigest = this.bundleDigest();
    const continuation =
      this.graphFingerprint === undefined || bundleDigest === undefined
        ? undefined
        : createContinuationEnvelope({
            runId: this.runId,
            gateId: id,
            gateKind: boundary.kind,
            workflowId: this.workflowId,
            bundleDigest,
            graphFingerprint: this.graphFingerprint,
            location: address,
            state,
            receipts,
          });
    throw new DurableGateYield(gate, state, receipts, continuation);
  }

  async executeEffect<T extends WireValue>(
    runtime: WorkflowRuntime,
    boundary: EffectBoundary,
    execute: (operationKey: string) => Promise<EffectExecution<T>>,
  ): Promise<T> {
    const address = this.address(runtime, boundary.nodeId, boundary.nodeType, boundary.executionIndex);
    const key = operationKey(this.runId, address);
    const committed = this.receipts.get(durableAddressKey(address));
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
      this.receipts.set(durableAddressKey(address), {
        address: cloneExecutionAddress(address),
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
        this.receipts.set(durableAddressKey(address), {
          address: cloneExecutionAddress(address),
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
        this.receipts.set(durableAddressKey(address), {
          address: cloneExecutionAddress(address),
          operationKey: key,
          receipt: committed.receipt,
        });
        return committed.result as T;
      }
    }
    this.receipts.set(durableAddressKey(address), {
      address: cloneExecutionAddress(address),
      operationKey: key,
      receipt: executed.receipt,
    });
    return executed.result;
  }

  snapshot(nextBoundary: ExecutionAddress): ContinuationState {
    const completedKeys = new Set(this.completed.keys());
    return {
      completed: [...this.completed.values()].map(cloneExecutionAddress),
      variables: [...this.variables.values()]
        .filter((variable) => completedKeys.has(durableAddressKey(variable.address)))
        .map((variable) => {
          try {
            validateWireValue(variable.value);
          } catch (error) {
            throw new Error(
              `Continuation variable ${variable.address.nodeId}.${variable.portName} is not a wire value: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return {
            address: cloneExecutionAddress(variable.address),
            portName: variable.portName,
            value: variable.value,
          };
        }),
      nextBoundary: cloneExecutionAddress(nextBoundary),
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
    durable: new DurableExecution(
      options.runId,
      options.workflowId,
      options.continuation,
      options.resolution,
      options.bundleDigest,
    ),
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
