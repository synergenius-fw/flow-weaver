import { createHash } from "node:crypto";
import { VERSION } from "../generated-version.js";
import { parseStrictJson, StrictJsonError } from "./strict-json.js";

export const CONTINUATION_FORMAT_VERSION = 1 as const;
export const GENERATOR_ABI = "flow-weaver-generated-v2" as const;
export const MAX_CONTINUATION_BYTES = 1024 * 1024;
export const MAX_CONTINUATION_DEPTH = 32;
export const MAX_CONTINUATION_ENTRIES = 10_000;
export const MAX_CONTINUATION_STRING_BYTES = 256 * 1024;

export type DurableGateKind = "approval" | "input" | "agent";

export type WireValue =
  | null
  | boolean
  | number
  | string
  | readonly WireValue[]
  | { readonly [key: string]: WireValue };

export interface WorkflowFrameAddress {
  readonly workflowId: string;
  readonly invocation: number;
  readonly callerNodeId?: string;
  readonly callerExecutionIndex?: number;
}

export interface ScopeAddress {
  readonly parentNodeId: string;
  readonly parentExecutionIndex: number;
  readonly scopeName: string;
  readonly invocation: number;
  readonly loopIteration?: number;
  readonly branchArm?: string;
}

export interface BranchAddress {
  readonly workflowId: string;
  readonly frameDepth: number;
  readonly nodeId: string;
  readonly executionIndex: number;
  readonly arm: string;
}

export interface ExecutionAddress {
  readonly frames: readonly WorkflowFrameAddress[];
  readonly scopes: readonly ScopeAddress[];
  readonly branches: readonly BranchAddress[];
  readonly nodeId: string;
  readonly nodeType: string;
  readonly executionIndex: number;
}

export interface ContinuationVariable {
  readonly address: ExecutionAddress;
  readonly portName: string;
  readonly value: WireValue;
}

export interface EffectReceipt {
  readonly address: ExecutionAddress;
  readonly operationKey: string;
  readonly receipt: WireValue;
}

export interface ContinuationState {
  readonly completed: readonly ExecutionAddress[];
  readonly variables: readonly ContinuationVariable[];
  readonly nextBoundary: ExecutionAddress;
}

export interface DurableGate {
  readonly id: string;
  readonly kind: DurableGateKind;
  readonly address: ExecutionAddress;
  readonly payload: WireValue;
}

export interface ContinuationEnvelope {
  readonly formatVersion: typeof CONTINUATION_FORMAT_VERSION;
  readonly runId: string;
  readonly gateId: string;
  readonly gateKind: DurableGateKind;
  readonly workflowId: string;
  readonly bundleDigest: string;
  readonly graphFingerprint: string;
  readonly engineVersion: string;
  readonly generatorAbi: string;
  readonly location: ExecutionAddress;
  readonly state: ContinuationState;
  readonly receipts: readonly EffectReceipt[];
  readonly createdAt: string;
  readonly checksum: string;
}

declare const acceptedContinuationBrand: unique symbol;
export type AcceptedContinuationEnvelope = ContinuationEnvelope & {
  readonly [acceptedContinuationBrand]: true;
};

export interface ContinuationCompatibility {
  readonly runId: string;
  readonly workflowId: string;
  readonly bundleDigest: string;
  readonly graphFingerprint: string;
  readonly engineVersion?: string;
  readonly generatorAbi?: string;
  readonly gateId?: string;
  readonly graph: ContinuationGraphCompatibility;
}

export interface ContinuationGraphNode {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly executionOrder: number;
  readonly inputPorts: readonly string[];
  readonly outputPorts: readonly string[];
  readonly scopeNames: readonly string[];
  readonly invokedWorkflows: readonly string[];
  readonly parentScope?: {
    readonly parentNodeId: string;
    readonly scopeName: string;
  };
  readonly branchArms: readonly string[];
  readonly branchPath: readonly {
    readonly nodeId: string;
    readonly arm: string;
  }[];
  readonly predecessors: readonly ContinuationGraphPredecessor[];
  readonly durableGate?: DurableGateKind;
  readonly durableEffect?: true;
}

export interface ContinuationGraphPredecessor {
  readonly nodeId: string;
  readonly branchPath: readonly {
    readonly nodeId: string;
    readonly arm: string;
  }[];
}

export interface ContinuationGraphCompatibility {
  readonly nodes: readonly ContinuationGraphNode[];
}

export type ContinuationRefusalReason =
  | "malformed"
  | "oversized"
  | "unsupported-format"
  | "incompatible-engine"
  | "incompatible-generator"
  | "wrong-workflow"
  | "wrong-bundle"
  | "wrong-graph"
  | "checksum-mismatch"
  | "stale-gate"
  | "wrong-run"
  | "ambiguous-effect";

export interface ContinuationRefusal {
  readonly accepted: false;
  readonly reason: ContinuationRefusalReason;
  readonly message: string;
}

export interface AcceptedContinuation {
  readonly accepted: true;
  readonly envelope: AcceptedContinuationEnvelope;
}

export type DecodedContinuation = AcceptedContinuation | ContinuationRefusal;

const ENVELOPE_KEYS = [
  "formatVersion",
  "runId",
  "gateId",
  "gateKind",
  "workflowId",
  "bundleDigest",
  "graphFingerprint",
  "engineVersion",
  "generatorAbi",
  "location",
  "state",
  "receipts",
  "createdAt",
  "checksum",
] as const;

const acceptedContinuations = new WeakSet<object>();

export function cloneAndFreezeWireValue<T extends WireValue>(value: T): T {
  const cloned = JSON.parse(canonicalize(value)) as T;
  const freeze = (entry: WireValue): void => {
    if (typeof entry !== "object" || entry === null) return;
    for (const child of Array.isArray(entry) ? entry : Object.values(entry)) {
      freeze(child);
    }
    Object.freeze(entry);
  };
  freeze(cloned);
  return cloned;
}

export function assertAcceptedContinuation(
  value: ContinuationEnvelope,
): asserts value is AcceptedContinuationEnvelope {
  if (!acceptedContinuations.has(value)) {
    throw new Error(
      "ContinuationEnvelope must come from a successful decodeContinuation result",
    );
  }
}

class WireValidationError extends Error {
  constructor(
    readonly reason: "malformed" | "oversized",
    message: string,
  ) {
    super(message);
  }
}

interface ValidationBudget {
  entries: number;
  bytes: number;
  readonly seen: Set<object>;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertWireValue(
  value: unknown,
  path: string,
  depth: number,
  budget: ValidationBudget,
): asserts value is WireValue {
  if (depth > MAX_CONTINUATION_DEPTH) {
    throw new WireValidationError("oversized", `${path} exceeds maximum depth`);
  }

  budget.entries++;
  if (budget.entries > MAX_CONTINUATION_ENTRIES) {
    throw new WireValidationError(
      "oversized",
      "continuation exceeds aggregate entry limit",
    );
  }

  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new WireValidationError(
        "malformed",
        `${path} contains a non-finite number`,
      );
    }
    return;
  }
  if (typeof value === "string") {
    const bytes = utf8Bytes(value);
    if (bytes > MAX_CONTINUATION_STRING_BYTES) {
      throw new WireValidationError(
        "oversized",
        `${path} exceeds maximum string size`,
      );
    }
    budget.bytes += bytes;
    if (budget.bytes > MAX_CONTINUATION_BYTES) {
      throw new WireValidationError(
        "oversized",
        "continuation exceeds maximum wire size",
      );
    }
    return;
  }
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    throw new WireValidationError(
      "malformed",
      `${path} is not a plain wire value`,
    );
  }
  if (budget.seen.has(value)) {
    throw new WireValidationError(
      "malformed",
      `${path} contains a cycle or repeated object`,
    );
  }
  budget.seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new WireValidationError(
        "malformed",
        `${path} contains a symbol property`,
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length") continue;
      if (
        !/^(0|[1-9]\d*)$/.test(key) ||
        descriptor.get ||
        descriptor.set ||
        !descriptor.enumerable
      ) {
        throw new WireValidationError(
          "malformed",
          `${path} contains an accessor or property`,
        );
      }
    }
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, String(index))) {
        throw new WireValidationError(
          "malformed",
          `${path} contains a sparse array`,
        );
      }
      assertWireValue(
        descriptors[String(index)].value,
        `${path}[${index}]`,
        depth + 1,
        budget,
      );
    }
    budget.seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WireValidationError(
      "malformed",
      `${path} contains a class or host object`,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new WireValidationError(
      "malformed",
      `${path} contains a symbol property`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new WireValidationError(
        "malformed",
        `${path}.${key} is an accessor or non-enumerable property`,
      );
    }
    const keyBytes = utf8Bytes(key);
    if (keyBytes > MAX_CONTINUATION_STRING_BYTES) {
      throw new WireValidationError(
        "oversized",
        `${path} contains an oversized key`,
      );
    }
    budget.bytes += keyBytes;
    assertWireValue(descriptor.value, `${path}.${key}`, depth + 1, budget);
  }
  budget.seen.delete(value);
}

export function validateWireValue(value: unknown): asserts value is WireValue {
  assertWireValue(value, "$", 0, { entries: 0, bytes: 0, seen: new Set() });
}

export function durableGateId(
  runId: string,
  kind: DurableGateKind,
  address: ExecutionAddress,
): string {
  return createHash("sha256")
    .update(runId)
    .update("\0")
    .update(kind)
    .update("\0")
    .update(executionAddressKey(address))
    .digest("hex");
}

function canonicalize(value: WireValue): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as { readonly [key: string]: WireValue };
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function canonicalWireValue(value: unknown): string {
  validateWireValue(value);
  return canonicalize(value);
}

export function executionAddressKey(address: ExecutionAddress): string {
  return canonicalWireValue(address);
}

function withoutChecksum(envelope: ContinuationEnvelope): WireValue {
  const { checksum: _checksum, ...unsigned } = envelope;
  return unsigned as unknown as WireValue;
}

export function continuationChecksum(envelope: ContinuationEnvelope): string {
  validateWireValue(withoutChecksum(envelope));
  return createHash("sha256")
    .update(canonicalize(withoutChecksum(envelope)))
    .digest("hex");
}

export function createContinuationEnvelope(
  fields: Omit<
    ContinuationEnvelope,
    | "formatVersion"
    | "engineVersion"
    | "generatorAbi"
    | "createdAt"
    | "checksum"
  > & {
    readonly engineVersion?: string;
    readonly generatorAbi?: string;
    readonly createdAt?: string;
  },
): ContinuationEnvelope {
  const unsigned = {
    formatVersion: CONTINUATION_FORMAT_VERSION,
    runId: fields.runId,
    gateId: fields.gateId,
    gateKind: fields.gateKind,
    workflowId: fields.workflowId,
    bundleDigest: fields.bundleDigest,
    graphFingerprint: fields.graphFingerprint,
    engineVersion: fields.engineVersion ?? VERSION,
    generatorAbi: fields.generatorAbi ?? GENERATOR_ABI,
    location: fields.location,
    state: fields.state,
    receipts: fields.receipts,
    createdAt: fields.createdAt ?? new Date().toISOString(),
  } satisfies Omit<ContinuationEnvelope, "checksum">;
  validateWireValue(unsigned);
  const envelope = Object.assign({}, unsigned, {
    checksum: "",
  }) as ContinuationEnvelope;
  return { ...envelope, checksum: continuationChecksum(envelope) };
}

function refusal(
  reason: ContinuationRefusalReason,
  message: string,
): ContinuationRefusal {
  return { accepted: false, reason, message };
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isGraphBranchPath(
  value: unknown,
): value is ContinuationGraphNode["branchPath"] {
  return (
    Array.isArray(value) &&
    value.every(
      (requirement) =>
        isRecord(requirement) &&
        hasExactKeys(requirement, ["nodeId", "arm"]) &&
        typeof requirement.nodeId === "string" &&
        requirement.nodeId.length > 0 &&
        typeof requirement.arm === "string" &&
        requirement.arm.length > 0,
    )
  );
}

function hasRequiredAndOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFrame(value: unknown): value is WorkflowFrameAddress {
  return (
    isRecord(value) &&
    hasRequiredAndOptionalKeys(
      value,
      ["workflowId", "invocation"],
      ["callerNodeId", "callerExecutionIndex"],
    ) &&
    typeof value.workflowId === "string" &&
    value.workflowId.length > 0 &&
    isNonNegativeInteger(value.invocation) &&
    (value.callerNodeId === undefined ||
      typeof value.callerNodeId === "string") &&
    (value.callerExecutionIndex === undefined ||
      isNonNegativeInteger(value.callerExecutionIndex)) &&
    ((value.callerNodeId === undefined &&
      value.callerExecutionIndex === undefined) ||
      (typeof value.callerNodeId === "string" &&
        isNonNegativeInteger(value.callerExecutionIndex)))
  );
}

function isScope(value: unknown): value is ScopeAddress {
  return (
    isRecord(value) &&
    hasRequiredAndOptionalKeys(
      value,
      ["parentNodeId", "parentExecutionIndex", "scopeName", "invocation"],
      ["loopIteration", "branchArm"],
    ) &&
    typeof value.parentNodeId === "string" &&
    value.parentNodeId.length > 0 &&
    isNonNegativeInteger(value.parentExecutionIndex) &&
    typeof value.scopeName === "string" &&
    value.scopeName.length > 0 &&
    isNonNegativeInteger(value.invocation) &&
    (value.loopIteration === undefined ||
      isNonNegativeInteger(value.loopIteration)) &&
    (value.branchArm === undefined || typeof value.branchArm === "string")
  );
}

function isAddress(value: unknown): value is ExecutionAddress {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "frames",
      "scopes",
      "branches",
      "nodeId",
      "nodeType",
      "executionIndex",
    ]) &&
    Array.isArray(value.frames) &&
    value.frames.length > 0 &&
    value.frames.every(isFrame) &&
    Array.isArray(value.scopes) &&
    value.scopes.every(isScope) &&
    Array.isArray(value.branches) &&
    value.branches.every(
      (branch) =>
        isRecord(branch) &&
        hasExactKeys(branch, [
          "workflowId",
          "frameDepth",
          "nodeId",
          "executionIndex",
          "arm",
        ]) &&
        typeof branch.workflowId === "string" &&
        branch.workflowId.length > 0 &&
        isNonNegativeInteger(branch.frameDepth) &&
        typeof branch.nodeId === "string" &&
        branch.nodeId.length > 0 &&
        isNonNegativeInteger(branch.executionIndex) &&
        typeof branch.arm === "string" &&
        branch.arm.length > 0,
    ) &&
    typeof value.nodeId === "string" &&
    value.nodeId.length > 0 &&
    typeof value.nodeType === "string" &&
    value.nodeType.length > 0 &&
    isNonNegativeInteger(value.executionIndex)
  );
}

function isVariable(value: unknown): value is ContinuationVariable {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["address", "portName", "value"]) &&
    isAddress(value.address) &&
    typeof value.portName === "string" &&
    value.portName.length > 0
  );
}

function isReceipt(value: unknown): value is EffectReceipt {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["address", "operationKey", "receipt"]) &&
    isAddress(value.address) &&
    typeof value.operationKey === "string" &&
    /^[0-9a-f]{64}$/.test(value.operationKey)
  );
}

function isState(value: unknown): value is ContinuationState {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["completed", "variables", "nextBoundary"]) &&
    Array.isArray(value.completed) &&
    value.completed.every(isAddress) &&
    Array.isArray(value.variables) &&
    value.variables.every(isVariable) &&
    isAddress(value.nextBoundary)
  );
}

function structurallyValidEnvelope(
  value: unknown,
): value is ContinuationEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, ENVELOPE_KEYS)) return false;
  if (
    typeof value.formatVersion !== "number" ||
    typeof value.runId !== "string" ||
    typeof value.gateId !== "string" ||
    !["approval", "input", "agent"].includes(value.gateKind as string) ||
    typeof value.workflowId !== "string" ||
    typeof value.bundleDigest !== "string" ||
    typeof value.graphFingerprint !== "string" ||
    typeof value.engineVersion !== "string" ||
    typeof value.generatorAbi !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.checksum !== "string" ||
    value.runId.length === 0 ||
    !/^[0-9a-f]{64}$/.test(value.gateId) ||
    value.workflowId.length === 0 ||
    value.engineVersion.length === 0 ||
    value.generatorAbi.length === 0 ||
    !isAddress(value.location) ||
    !isState(value.state) ||
    !Array.isArray(value.receipts) ||
    !value.receipts.every(isReceipt) ||
    !/^sha256:[0-9a-f]{64}$/.test(value.bundleDigest) ||
    !/^[0-9a-f]{64}$/.test(value.graphFingerprint) ||
    !/^[0-9a-f]{64}$/.test(value.checksum) ||
    !isExactIsoUtc(value.createdAt) ||
    executionAddressKey(value.location) !==
      executionAddressKey(value.state.nextBoundary)
  ) {
    return false;
  }
  return true;
}

function isExactIsoUtc(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function graphNodeFor(
  graph: ContinuationGraphCompatibility,
  workflowId: string,
  nodeId: string,
  nodeType: string,
): ContinuationGraphNode | undefined {
  return graph.nodes.find(
    (node) =>
      node.workflowId === workflowId &&
      node.nodeId === nodeId &&
      node.nodeType === nodeType,
  );
}

function graphNodeForAddress(
  graph: ContinuationGraphCompatibility,
  address: ExecutionAddress,
): ContinuationGraphNode | undefined {
  const workflowId = address.frames.at(-1)?.workflowId;
  return workflowId === undefined
    ? undefined
    : graphNodeFor(graph, workflowId, address.nodeId, address.nodeType);
}

function progressVector(
  graph: ContinuationGraphCompatibility,
  address: ExecutionAddress,
): readonly number[] | undefined {
  const progress: number[] = [];
  for (let index = 1; index < address.frames.length; index++) {
    const frame = address.frames[index];
    const parent = address.frames[index - 1];
    if (
      frame.callerNodeId === undefined ||
      frame.callerExecutionIndex === undefined
    ) {
      return undefined;
    }
    const caller = graph.nodes.find(
      (node) =>
        node.workflowId === parent.workflowId &&
        node.nodeId === frame.callerNodeId,
    );
    if (
      caller === undefined ||
      !caller.invokedWorkflows.includes(frame.workflowId)
    ) {
      return undefined;
    }
    progress.push(
      caller.executionOrder,
      frame.callerExecutionIndex,
      frame.invocation,
    );
  }
  const node = graphNodeForAddress(graph, address);
  if (node === undefined) return undefined;
  progress.push(node.executionOrder, address.executionIndex);
  return progress;
}

function compareProgress(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function sameFrames(
  left: readonly WorkflowFrameAddress[],
  right: readonly WorkflowFrameAddress[],
): boolean {
  return canonicalWireValue(left) === canonicalWireValue(right);
}

function hasCompleteRequiredPrefix(
  graph: ContinuationGraphCompatibility,
  location: ExecutionAddress,
  completed: readonly ExecutionAddress[],
): boolean {
  for (let frameIndex = 0; frameIndex < location.frames.length; frameIndex++) {
    const frame = location.frames[frameIndex];
    const frameAddress = location.frames.slice(0, frameIndex + 1);
    const boundaryNodeId =
      frameIndex === location.frames.length - 1
        ? location.nodeId
        : location.frames[frameIndex + 1].callerNodeId;
    if (boundaryNodeId === undefined) return false;
    const boundaryNode = graph.nodes.find(
      (node) =>
        node.workflowId === frame.workflowId && node.nodeId === boundaryNodeId,
    );
    if (boundaryNode === undefined) return false;

    for (const predecessor of boundaryNode.predecessors) {
      const predecessorNode = graph.nodes.find(
        (node) =>
          node.workflowId === frame.workflowId &&
          node.nodeId === predecessor.nodeId,
      );
      if (
        predecessorNode === undefined ||
        !completed.some(
          (address) =>
            sameFrames(address.frames, frameAddress) &&
            address.nodeId === predecessorNode.nodeId &&
            address.nodeType === predecessorNode.nodeType &&
            predecessor.branchPath.every((requirement) =>
              address.branches.some(
                (branch) =>
                  branch.nodeId === requirement.nodeId &&
                  branch.arm === requirement.arm,
              ),
            ),
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function addressBelongsToGraph(
  graph: ContinuationGraphCompatibility,
  rootWorkflowId: string,
  address: ExecutionAddress,
): boolean {
  if (
    address.frames[0]?.workflowId !== rootWorkflowId ||
    address.frames[0]?.invocation !== 0 ||
    address.frames[0]?.callerNodeId !== undefined ||
    address.executionIndex !== 0 ||
    address.scopes.length > 0 ||
    address.branches.some((branch) => branch.executionIndex !== 0) ||
    address.frames.some(
      (frame, index) =>
        frame.invocation !== 0 ||
        (index > 0 && frame.callerExecutionIndex !== 0),
    )
  ) {
    return false;
  }
  for (let index = 1; index < address.frames.length; index++) {
    const frame = address.frames[index];
    const parent = address.frames[index - 1];
    const caller =
      frame.callerNodeId === undefined
        ? undefined
        : graph.nodes.find(
            (node) =>
              node.workflowId === parent.workflowId &&
              node.nodeId === frame.callerNodeId,
          );
    if (
      caller === undefined ||
      frame.callerExecutionIndex === undefined ||
      !caller.invokedWorkflows.includes(frame.workflowId)
    ) {
      return false;
    }
  }
  const workflowId = address.frames.at(-1)?.workflowId;
  const node = graphNodeForAddress(graph, address);
  const graphNodeInFrames = (
    nodeId: string,
  ): ContinuationGraphNode | undefined =>
    address.frames
      .map((frame) =>
        graph.nodes.find(
          (candidate) =>
            candidate.workflowId === frame.workflowId &&
            candidate.nodeId === nodeId,
        ),
      )
      .find((candidate) => candidate !== undefined);
  if (
    workflowId === undefined ||
    node === undefined ||
    address.scopes.some((scope) => {
      const parent = graphNodeInFrames(scope.parentNodeId);
      return (
        parent === undefined || !parent.scopeNames.includes(scope.scopeName)
      );
    }) ||
    address.branches.some((branch) => {
      const frame = address.frames[branch.frameDepth];
      const owner = graph.nodes.find(
        (candidate) =>
          candidate.workflowId === branch.workflowId &&
          candidate.nodeId === branch.nodeId,
      );
      return (
        frame === undefined ||
        frame.workflowId !== branch.workflowId ||
        owner === undefined ||
        !owner.branchArms.includes(branch.arm)
      );
    })
  ) {
    return false;
  }
  for (let frameDepth = 0; frameDepth < address.frames.length; frameDepth++) {
    const frame = address.frames[frameDepth];
    const boundaryNodeId =
      frameDepth === address.frames.length - 1
        ? address.nodeId
        : address.frames[frameDepth + 1].callerNodeId;
    const boundaryNode = graph.nodes.find(
      (candidate) =>
        candidate.workflowId === frame.workflowId &&
        candidate.nodeId === boundaryNodeId,
    );
    const observedBranchPath = address.branches
      .filter(
        (branch) =>
          branch.frameDepth === frameDepth &&
          branch.workflowId === frame.workflowId,
      )
      .map((branch) => ({ nodeId: branch.nodeId, arm: branch.arm }));
    if (
      boundaryNode === undefined ||
      canonicalWireValue(observedBranchPath) !==
        canonicalWireValue(boundaryNode.branchPath)
    ) {
      return false;
    }
  }
  if (node.parentScope !== undefined) {
    const localScope = address.scopes.at(-1);
    if (
      localScope === undefined ||
      localScope.parentNodeId !== node.parentScope.parentNodeId ||
      localScope.scopeName !== node.parentScope.scopeName
    ) {
      return false;
    }
  }
  return true;
}

export function decodeContinuation(
  input: string | unknown,
  compatibility: ContinuationCompatibility,
): DecodedContinuation {
  let value: unknown = input;
  try {
    if (typeof input === "string") {
      if (utf8Bytes(input) > MAX_CONTINUATION_BYTES) {
        return refusal("oversized", "continuation exceeds maximum wire size");
      }
      value = parseStrictJson(input, {
        maxDepth: MAX_CONTINUATION_DEPTH,
        maxStringBytes: MAX_CONTINUATION_STRING_BYTES,
        maxObjectKeys: MAX_CONTINUATION_ENTRIES,
        maxArrayItems: MAX_CONTINUATION_ENTRIES,
        maxAggregateEntries: MAX_CONTINUATION_ENTRIES,
      });
    }
    validateWireValue(value);
  } catch (error) {
    if (error instanceof WireValidationError) {
      return refusal(error.reason, error.message);
    }
    if (error instanceof StrictJsonError) {
      return refusal(error.code, error.message);
    }
    return refusal("malformed", "continuation is not valid JSON");
  }

  if (!structurallyValidEnvelope(value)) {
    return refusal(
      "malformed",
      "continuation has missing, unknown, or invalid fields",
    );
  }
  if (value.formatVersion !== CONTINUATION_FORMAT_VERSION) {
    return refusal(
      "unsupported-format",
      `unsupported continuation format ${value.formatVersion}`,
    );
  }
  if (continuationChecksum(value) !== value.checksum) {
    return refusal("checksum-mismatch", "continuation checksum does not match");
  }
  if (
    value.gateId !== durableGateId(value.runId, value.gateKind, value.location)
  ) {
    return refusal(
      "malformed",
      "continuation gate identity does not match its execution address",
    );
  }
  const graphNodes = compatibility.graph.nodes;
  const graphNodeKeys = new Set(
    graphNodes.map(
      (node) => `${node.workflowId}\0${node.nodeId}\0${node.nodeType}`,
    ),
  );
  const graphOrderKeys = new Set(
    graphNodes.map((node) => `${node.workflowId}\0${node.executionOrder}`),
  );
  if (
    graphNodeKeys.size !== graphNodes.length ||
    graphOrderKeys.size !== graphNodes.length ||
    graphNodes.some(
      (node) =>
        !Number.isSafeInteger(node.executionOrder) ||
        node.executionOrder < -1 ||
        new Set(node.inputPorts).size !== node.inputPorts.length ||
        new Set(node.outputPorts).size !== node.outputPorts.length ||
        new Set(node.scopeNames).size !== node.scopeNames.length ||
        new Set(node.invokedWorkflows).size !== node.invokedWorkflows.length ||
        new Set(node.branchArms).size !== node.branchArms.length ||
        !isGraphBranchPath(node.branchPath) ||
        new Set(
          node.branchPath.map(
            (requirement) => `${requirement.nodeId}\0${requirement.arm}`,
          ),
        ).size !== node.branchPath.length ||
        node.branchPath.some(
          (requirement: ContinuationGraphNode["branchPath"][number]) => {
            const owner = graphNodes.find(
              (candidate) =>
                candidate.workflowId === node.workflowId &&
                candidate.nodeId === requirement.nodeId,
            );
            return (
              owner === undefined || !owner.branchArms.includes(requirement.arm)
            );
          },
        ) ||
        !Array.isArray(node.predecessors) ||
        new Set(node.predecessors.map((predecessor) => predecessor.nodeId))
          .size !== node.predecessors.length ||
        node.predecessors.some(
          (predecessor) =>
            typeof predecessor.nodeId !== "string" ||
            predecessor.nodeId.length === 0 ||
            predecessor.nodeId === node.nodeId ||
            !isGraphBranchPath(predecessor.branchPath) ||
            (() => {
              const predecessorNode = graphNodes.find(
                (candidate) =>
                  candidate.workflowId === node.workflowId &&
                  candidate.nodeId === predecessor.nodeId,
              );
              return (
                predecessorNode === undefined ||
                predecessorNode.executionOrder >= node.executionOrder ||
                canonicalWireValue(predecessor.branchPath) !==
                  canonicalWireValue(predecessorNode.branchPath) ||
                predecessor.branchPath.some(
                  (
                    requirement: ContinuationGraphPredecessor["branchPath"][number],
                  ) =>
                    !node.branchPath.some(
                      (active: ContinuationGraphNode["branchPath"][number]) =>
                        active.nodeId === requirement.nodeId &&
                        active.arm === requirement.arm,
                    ),
                )
              );
            })() ||
            new Set(
              predecessor.branchPath.map(
                (
                  requirement: ContinuationGraphPredecessor["branchPath"][number],
                ) => `${requirement.nodeId}\0${requirement.arm}`,
              ),
            ).size !== predecessor.branchPath.length ||
            predecessor.branchPath.some(
              (
                requirement: ContinuationGraphPredecessor["branchPath"][number],
              ) => {
                const owner = graphNodes.find(
                  (candidate) =>
                    candidate.workflowId === node.workflowId &&
                    candidate.nodeId === requirement.nodeId,
                );
                return (
                  typeof requirement.nodeId !== "string" ||
                  typeof requirement.arm !== "string" ||
                  owner === undefined ||
                  !owner.branchArms.includes(requirement.arm)
                );
              },
            ),
        ),
    ) ||
    !addressBelongsToGraph(
      compatibility.graph,
      compatibility.workflowId,
      value.location,
    ) ||
    graphNodeForAddress(compatibility.graph, value.location)?.durableGate !==
      value.gateKind
  ) {
    return refusal(
      "wrong-graph",
      "continuation boundary is not owned by the compiled graph",
    );
  }
  const completed = new Set(value.state.completed.map(executionAddressKey));
  if (completed.size !== value.state.completed.length) {
    return refusal(
      "malformed",
      "continuation contains duplicate completed addresses",
    );
  }
  if (
    value.state.completed.some(
      (address) =>
        !addressBelongsToGraph(
          compatibility.graph,
          compatibility.workflowId,
          address,
        ),
    )
  ) {
    return refusal(
      "wrong-graph",
      "continuation contains an address outside the compiled graph",
    );
  }
  const boundaryProgress = progressVector(compatibility.graph, value.location);
  if (
    boundaryProgress === undefined ||
    value.state.completed.some((address) => {
      const completedProgress = progressVector(compatibility.graph, address);
      if (
        completedProgress === undefined ||
        compareProgress(completedProgress, boundaryProgress) >= 0
      ) {
        return true;
      }
      return false;
    }) ||
    hasConflictingBranchHistory([...value.state.completed, value.location])
  ) {
    return refusal(
      "wrong-graph",
      "continuation completed state is not a valid execution prefix before its boundary",
    );
  }
  if (
    !hasCompleteRequiredPrefix(
      compatibility.graph,
      value.location,
      value.state.completed,
    )
  ) {
    return refusal(
      "wrong-graph",
      "continuation is missing a required compiled predecessor before its boundary",
    );
  }
  const variableKeys = new Set<string>();
  for (const variable of value.state.variables) {
    const address = executionAddressKey(variable.address);
    const key = `${address}\0${variable.portName}`;
    const graphNode = graphNodeForAddress(
      compatibility.graph,
      variable.address,
    );
    if (
      !completed.has(address) ||
      variableKeys.has(key) ||
      graphNode === undefined ||
      !graphNode.outputPorts.includes(variable.portName)
    ) {
      return refusal(
        "wrong-graph",
        `continuation variable ${variable.address.frames.at(-1)?.workflowId}.${variable.address.nodeId}.${variable.portName} is not a unique graph-owned output of a completed address`,
      );
    }
    variableKeys.add(key);
  }
  const receiptAddresses = new Set<string>();
  for (const receipt of value.receipts) {
    const address = executionAddressKey(receipt.address);
    if (
      receiptAddresses.has(address) ||
      !completed.has(address) ||
      graphNodeForAddress(compatibility.graph, receipt.address)
        ?.durableEffect !== true ||
      receipt.operationKey !== operationKey(value.runId, receipt.address)
    ) {
      return refusal(
        "malformed",
        "continuation effect receipts must be unique, completed, and match their operation identity",
      );
    }
    receiptAddresses.add(address);
  }
  if (
    value.state.completed.some(
      (address) =>
        graphNodeForAddress(compatibility.graph, address)?.durableEffect ===
          true && !receiptAddresses.has(executionAddressKey(address)),
    )
  ) {
    return refusal(
      "malformed",
      "every completed effect requires its exact durable receipt",
    );
  }
  if (value.engineVersion !== (compatibility.engineVersion ?? VERSION)) {
    return refusal(
      "incompatible-engine",
      "continuation engine version does not match",
    );
  }
  if (value.generatorAbi !== (compatibility.generatorAbi ?? GENERATOR_ABI)) {
    return refusal(
      "incompatible-generator",
      "continuation generator ABI does not match",
    );
  }
  if (value.runId !== compatibility.runId) {
    return refusal("wrong-run", "continuation belongs to another run");
  }
  if (value.workflowId !== compatibility.workflowId) {
    return refusal(
      "wrong-workflow",
      "continuation belongs to another workflow",
    );
  }
  if (value.bundleDigest !== compatibility.bundleDigest) {
    return refusal("wrong-bundle", "continuation belongs to another bundle");
  }
  if (value.graphFingerprint !== compatibility.graphFingerprint) {
    return refusal(
      "wrong-graph",
      "continuation belongs to another workflow graph",
    );
  }
  if (
    compatibility.gateId !== undefined &&
    value.gateId !== compatibility.gateId
  ) {
    return refusal("stale-gate", "continuation gate is stale or reordered");
  }
  const accepted = cloneAndFreezeWireValue(
    value as unknown as WireValue,
  ) as unknown as AcceptedContinuationEnvelope;
  acceptedContinuations.add(accepted);
  return {
    accepted: true,
    envelope: accepted,
  };
}

function hasConflictingBranchHistory(addresses: readonly ExecutionAddress[]): boolean {
  const selected = new Map<string, string>();
  for (const address of addresses) {
    for (const branch of address.branches) {
      const key = `${branch.frameDepth}\0${branch.workflowId}\0${branch.nodeId}\0${branch.executionIndex}`;
      const prior = selected.get(key);
      if (prior !== undefined && prior !== branch.arm) return true;
      selected.set(key, branch.arm);
    }
  }
  return false;
}

export function operationKey(runId: string, address: ExecutionAddress): string {
  validateWireValue(address);
  return createHash("sha256")
    .update(runId)
    .update("\0")
    .update(canonicalize(address as unknown as WireValue))
    .digest("hex");
}
