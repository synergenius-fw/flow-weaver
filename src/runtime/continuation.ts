/**
 * The continuation format, and the coordinator's decoder for it.
 *
 * The format itself, the hashing, wire validation and the host-side
 * `acceptContinuation` live in `continuation-core.ts`, which is inlined into
 * every compiled file. This module re-exports all of that and adds
 * `decodeContinuation`: the strict parse plus the checks that need the
 * compiled graph, which only the coordinator has.
 */
import { VERSION } from "../generated-version.js";
import { parseStrictJson, StrictJsonError } from "./strict-json.js";
import {
  CONTINUATION_FORMAT_VERSION,
  GENERATOR_ABI,
  MAX_CONTINUATION_BYTES,
  MAX_CONTINUATION_DEPTH,
  MAX_CONTINUATION_ENTRIES,
  MAX_CONTINUATION_STRING_BYTES,
  WireValidationError,
  acceptContinuation,
  canonicalWireValue,
  continuationChecksum,
  durableGateId,
  executionAddressKey,
  hasExactlyTheKeys,
  isPlainObjectRecord,
  operationKey,
  structurallyValidEnvelope,
  utf8ByteLength,
  validateWireValue,
  type ContinuationGraphNodeBranchPath,
  type ContinuationRefusal,
  type ContinuationRefusalReason,
  type DecodedContinuation,
  type DurableGateKind,
  type ExecutionAddress,
  type WorkflowFrameAddress,
} from "./continuation-core.js";

export * from "./continuation-core.js";

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
  readonly branchPath: ContinuationGraphNodeBranchPath;
  readonly predecessors: readonly ContinuationGraphPredecessor[];
  readonly durableGate?: DurableGateKind;
  readonly durableEffect?: true;
}

export interface ContinuationGraphPredecessor {
  readonly nodeId: string;
  readonly branchPath: ContinuationGraphNodeBranchPath;
}

export interface ContinuationGraphCompatibility {
  readonly nodes: readonly ContinuationGraphNode[];
}

function refusal(reason: ContinuationRefusalReason, message: string): ContinuationRefusal {
  return { accepted: false, reason, message };
}

function isGraphBranchPath(value: unknown): value is ContinuationGraphNode["branchPath"] {
  return (
    Array.isArray(value) &&
    value.every(
      (requirement) =>
        isPlainObjectRecord(requirement) &&
        hasExactlyTheKeys(requirement, ["nodeId", "arm"]) &&
        typeof requirement.nodeId === "string" &&
        requirement.nodeId.length > 0 &&
        typeof requirement.arm === "string" &&
        requirement.arm.length > 0,
    )
  );
}

function graphNodeFor(
  graph: ContinuationGraphCompatibility,
  workflowId: string,
  nodeId: string,
  nodeType: string,
): ContinuationGraphNode | undefined {
  return graph.nodes.find(
    (node) => node.workflowId === workflowId && node.nodeId === nodeId && node.nodeType === nodeType,
  );
}

function graphNodeForAddress(
  graph: ContinuationGraphCompatibility,
  address: ExecutionAddress,
): ContinuationGraphNode | undefined {
  const workflowId = address.frames[address.frames.length - 1]?.workflowId;
  return workflowId === undefined ? undefined : graphNodeFor(graph, workflowId, address.nodeId, address.nodeType);
}

function progressVector(
  graph: ContinuationGraphCompatibility,
  address: ExecutionAddress,
): readonly number[] | undefined {
  const progress: number[] = [];
  for (let index = 1; index < address.frames.length; index++) {
    const frame = address.frames[index];
    const parent = address.frames[index - 1];
    if (frame.callerNodeId === undefined || frame.callerExecutionIndex === undefined) {
      return undefined;
    }
    const caller = graph.nodes.find(
      (node) => node.workflowId === parent.workflowId && node.nodeId === frame.callerNodeId,
    );
    if (caller === undefined || !caller.invokedWorkflows.includes(frame.workflowId)) {
      return undefined;
    }
    progress.push(caller.executionOrder, frame.callerExecutionIndex, frame.invocation);
  }
  const node = graphNodeForAddress(graph, address);
  if (node === undefined) return undefined;
  progress.push(node.executionOrder, address.executionIndex);
  return progress;
}

function compareProgress(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function sameFrames(left: readonly WorkflowFrameAddress[], right: readonly WorkflowFrameAddress[]): boolean {
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
      (node) => node.workflowId === frame.workflowId && node.nodeId === boundaryNodeId,
    );
    if (boundaryNode === undefined) return false;

    for (const predecessor of boundaryNode.predecessors) {
      const predecessorNode = graph.nodes.find(
        (node) => node.workflowId === frame.workflowId && node.nodeId === predecessor.nodeId,
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
                (branch) => branch.nodeId === requirement.nodeId && branch.arm === requirement.arm,
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
      (frame, index) => frame.invocation !== 0 || (index > 0 && frame.callerExecutionIndex !== 0),
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
            (node) => node.workflowId === parent.workflowId && node.nodeId === frame.callerNodeId,
          );
    if (
      caller === undefined ||
      frame.callerExecutionIndex === undefined ||
      !caller.invokedWorkflows.includes(frame.workflowId)
    ) {
      return false;
    }
  }
  const workflowId = address.frames[address.frames.length - 1]?.workflowId;
  const node = graphNodeForAddress(graph, address);
  const graphNodeInFrames = (nodeId: string): ContinuationGraphNode | undefined =>
    address.frames
      .map((frame) =>
        graph.nodes.find((candidate) => candidate.workflowId === frame.workflowId && candidate.nodeId === nodeId),
      )
      .find((candidate) => candidate !== undefined);
  if (
    workflowId === undefined ||
    node === undefined ||
    address.scopes.some((scope) => {
      const parent = graphNodeInFrames(scope.parentNodeId);
      return parent === undefined || !parent.scopeNames.includes(scope.scopeName);
    }) ||
    address.branches.some((branch) => {
      const frame = address.frames[branch.frameDepth];
      const owner = graph.nodes.find(
        (candidate) => candidate.workflowId === branch.workflowId && candidate.nodeId === branch.nodeId,
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
      frameDepth === address.frames.length - 1 ? address.nodeId : address.frames[frameDepth + 1].callerNodeId;
    const boundaryNode = graph.nodes.find(
      (candidate) => candidate.workflowId === frame.workflowId && candidate.nodeId === boundaryNodeId,
    );
    const observedBranchPath = address.branches
      .filter((branch) => branch.frameDepth === frameDepth && branch.workflowId === frame.workflowId)
      .map((branch) => ({ nodeId: branch.nodeId, arm: branch.arm }));
    if (
      boundaryNode === undefined ||
      canonicalWireValue(observedBranchPath) !== canonicalWireValue(boundaryNode.branchPath)
    ) {
      return false;
    }
  }
  if (node.parentScope !== undefined) {
    const localScope = address.scopes[address.scopes.length - 1];
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

/**
 * The coordinator's decoder: a strict, bounded parse of untrusted text, then
 * every check `acceptContinuation` makes, then the ones that need the
 * compiled graph: the boundary and every completed address belong to it, the
 * completed set is a valid prefix before the boundary, variables are outputs
 * of completed nodes, receipts match their effects, and the bundle and graph
 * identities are the ones the coordinator vouches for.
 */
export function decodeContinuation(
  input: string | unknown,
  compatibility: ContinuationCompatibility,
): DecodedContinuation {
  let value: unknown = input;
  try {
    if (typeof input === "string") {
      if (utf8ByteLength(input) > MAX_CONTINUATION_BYTES) {
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
    return refusal("malformed", "continuation has missing, unknown, or invalid fields");
  }
  if (value.formatVersion !== CONTINUATION_FORMAT_VERSION) {
    return refusal("unsupported-format", `unsupported continuation format ${value.formatVersion}`);
  }
  if (continuationChecksum(value) !== value.checksum) {
    return refusal("checksum-mismatch", "continuation checksum does not match");
  }
  if (value.gateId !== durableGateId(value.runId, value.gateKind, value.location)) {
    return refusal("malformed", "continuation gate identity does not match its execution address");
  }
  const graphNodes = compatibility.graph.nodes;
  const graphNodeKeys = new Set(graphNodes.map((node) => `${node.workflowId}\0${node.nodeId}\0${node.nodeType}`));
  const graphOrderKeys = new Set(graphNodes.map((node) => `${node.workflowId}\0${node.executionOrder}`));
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
        new Set(node.branchPath.map((requirement) => `${requirement.nodeId}\0${requirement.arm}`)).size !==
          node.branchPath.length ||
        node.branchPath.some((requirement) => {
          const owner = graphNodes.find(
            (candidate) => candidate.workflowId === node.workflowId && candidate.nodeId === requirement.nodeId,
          );
          return owner === undefined || !owner.branchArms.includes(requirement.arm);
        }) ||
        !Array.isArray(node.predecessors) ||
        new Set(node.predecessors.map((predecessor) => predecessor.nodeId)).size !== node.predecessors.length ||
        node.predecessors.some(
          (predecessor) =>
            typeof predecessor.nodeId !== "string" ||
            predecessor.nodeId.length === 0 ||
            predecessor.nodeId === node.nodeId ||
            !isGraphBranchPath(predecessor.branchPath) ||
            (() => {
              const predecessorNode = graphNodes.find(
                (candidate) => candidate.workflowId === node.workflowId && candidate.nodeId === predecessor.nodeId,
              );
              return (
                predecessorNode === undefined ||
                predecessorNode.executionOrder >= node.executionOrder ||
                canonicalWireValue(predecessor.branchPath) !== canonicalWireValue(predecessorNode.branchPath) ||
                predecessor.branchPath.some(
                  (requirement: ContinuationGraphNodeBranchPath[number]) =>
                    !node.branchPath.some(
                      (active) => active.nodeId === requirement.nodeId && active.arm === requirement.arm,
                    ),
                )
              );
            })() ||
            new Set(
              predecessor.branchPath.map(
                (requirement: ContinuationGraphNodeBranchPath[number]) => `${requirement.nodeId}\0${requirement.arm}`,
              ),
            ).size !== predecessor.branchPath.length ||
            predecessor.branchPath.some((requirement: ContinuationGraphNodeBranchPath[number]) => {
              const owner = graphNodes.find(
                (candidate) => candidate.workflowId === node.workflowId && candidate.nodeId === requirement.nodeId,
              );
              return (
                typeof requirement.nodeId !== "string" ||
                typeof requirement.arm !== "string" ||
                owner === undefined ||
                !owner.branchArms.includes(requirement.arm)
              );
            }),
        ),
    ) ||
    !addressBelongsToGraph(compatibility.graph, compatibility.workflowId, value.location) ||
    graphNodeForAddress(compatibility.graph, value.location)?.durableGate !== value.gateKind
  ) {
    return refusal("wrong-graph", "continuation boundary is not owned by the compiled graph");
  }
  const completed = new Set(value.state.completed.map(executionAddressKey));
  if (completed.size !== value.state.completed.length) {
    return refusal("malformed", "continuation contains duplicate completed addresses");
  }
  if (
    value.state.completed.some(
      (address) => !addressBelongsToGraph(compatibility.graph, compatibility.workflowId, address),
    )
  ) {
    return refusal("wrong-graph", "continuation contains an address outside the compiled graph");
  }
  const boundaryProgress = progressVector(compatibility.graph, value.location);
  if (
    boundaryProgress === undefined ||
    value.state.completed.some((address) => {
      const completedProgress = progressVector(compatibility.graph, address);
      return completedProgress === undefined || compareProgress(completedProgress, boundaryProgress) >= 0;
    }) ||
    hasConflictingBranchHistory([...value.state.completed, value.location])
  ) {
    return refusal(
      "wrong-graph",
      "continuation completed state is not a valid execution prefix before its boundary",
    );
  }
  if (!hasCompleteRequiredPrefix(compatibility.graph, value.location, value.state.completed)) {
    return refusal("wrong-graph", "continuation is missing a required compiled predecessor before its boundary");
  }
  const variableKeys = new Set<string>();
  for (const variable of value.state.variables) {
    const address = executionAddressKey(variable.address);
    const key = `${address}\0${variable.portName}`;
    const graphNode = graphNodeForAddress(compatibility.graph, variable.address);
    if (
      !completed.has(address) ||
      variableKeys.has(key) ||
      graphNode === undefined ||
      !graphNode.outputPorts.includes(variable.portName)
    ) {
      return refusal(
        "wrong-graph",
        `continuation variable ${variable.address.frames[variable.address.frames.length - 1]?.workflowId}.${variable.address.nodeId}.${variable.portName} is not a unique graph-owned output of a completed address`,
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
      graphNodeForAddress(compatibility.graph, receipt.address)?.durableEffect !== true ||
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
        graphNodeForAddress(compatibility.graph, address)?.durableEffect === true &&
        !receiptAddresses.has(executionAddressKey(address)),
    )
  ) {
    return refusal("malformed", "every completed effect requires its exact durable receipt");
  }
  if (value.engineVersion !== (compatibility.engineVersion ?? VERSION)) {
    return refusal("incompatible-engine", "continuation engine version does not match");
  }
  if (value.generatorAbi !== (compatibility.generatorAbi ?? GENERATOR_ABI)) {
    return refusal("incompatible-generator", "continuation generator ABI does not match");
  }
  if (value.runId !== compatibility.runId) {
    return refusal("wrong-run", "continuation belongs to another run");
  }
  if (value.workflowId !== compatibility.workflowId) {
    return refusal("wrong-workflow", "continuation belongs to another workflow");
  }
  if (value.bundleDigest !== compatibility.bundleDigest) {
    return refusal("wrong-bundle", "continuation belongs to another bundle");
  }
  if (value.graphFingerprint !== compatibility.graphFingerprint) {
    return refusal("wrong-graph", "continuation belongs to another workflow graph");
  }
  if (compatibility.gateId !== undefined && value.gateId !== compatibility.gateId) {
    return refusal("stale-gate", "continuation gate is stale or reordered");
  }
  // Everything above passed against the coordinator's own expectations; the
  // core acceptance repeats the version and identity checks against the
  // engine's, freezes the copy, and brands it for the runtime factory.
  return acceptContinuation(value, {
    runId: compatibility.runId,
    workflowId: compatibility.workflowId,
    ...(compatibility.gateId === undefined ? {} : { gateId: compatibility.gateId }),
  });
}
