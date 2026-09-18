import type { TWorkflowAST, TNodeTypeAST } from '../ast/types.js';
import {
  RESERVED_PORT_NAMES,
  isExecutePort,
  isStartNode,
} from '../constants.js';
import {
  findAllBranchingNodes,
  findNodesInBranch,
} from '../generator/control-flow.js';
import { getTopologicalOrder } from './query.js';

export interface DurableBranchRequirement {
  readonly nodeId: string;
  readonly arm: 'success' | 'failure';
}

export interface DurableClosureAnalysis {
  readonly hasDurableGate: boolean;
  readonly hasDurableEffect: boolean;
  readonly reachable: readonly TWorkflowAST[];
}

export function durableBranchPaths(
  workflow: TWorkflowAST,
): ReadonlyMap<string, readonly DurableBranchRequirement[]> {
  const branchingNodes = findAllBranchingNodes(workflow, workflow.nodeTypes);
  const allInstanceIds = new Set(workflow.instances.map((instance) => instance.id));
  const regions = new Map<
    string,
    { successNodes: Set<string>; failureNodes: Set<string> }
  >();
  for (const branchNodeId of branchingNodes) {
    regions.set(branchNodeId, {
      successNodes: findNodesInBranch(
        branchNodeId,
        RESERVED_PORT_NAMES.ON_SUCCESS,
        workflow,
        allInstanceIds,
        branchingNodes,
        workflow.nodeTypes,
      ),
      failureNodes: findNodesInBranch(
        branchNodeId,
        RESERVED_PORT_NAMES.ON_FAILURE,
        workflow,
        allInstanceIds,
        branchingNodes,
        workflow.nodeTypes,
      ),
    });
  }

  const nodesInMultipleRegions = new Set<string>();
  for (const instanceId of allInstanceIds) {
    let regionCount = 0;
    for (const region of regions.values()) {
      if (
        region.successNodes.has(instanceId) ||
        region.failureNodes.has(instanceId)
      ) {
        regionCount++;
      }
    }
    if (regionCount > 1) nodesInMultipleRegions.add(instanceId);
  }
  for (const region of regions.values()) {
    for (const instanceId of nodesInMultipleRegions) {
      region.successNodes.delete(instanceId);
      region.failureNodes.delete(instanceId);
    }
  }

  const promoted = new Set<string>();
  for (const region of regions.values()) {
    for (const nodeId of region.successNodes) {
      if (region.failureNodes.has(nodeId)) promoted.add(nodeId);
    }
  }
  for (const [branchNodeId, region] of regions) {
    const branchNodes = new Set([
      ...region.successNodes,
      ...region.failureNodes,
    ]);
    for (const nodeId of branchNodes) {
      const hasExternalDataDependency = workflow.connections.some((connection) => {
        if (
          connection.to.node !== nodeId ||
          connection.from.scope ||
          connection.to.scope ||
          connection.from.node === branchNodeId ||
          isStartNode(connection.from.node) ||
          isExecutePort(connection.to.port)
        ) {
          return false;
        }
        return !branchNodes.has(connection.from.node);
      });
      if (hasExternalDataDependency) promoted.add(nodeId);
    }
  }
  for (const region of regions.values()) {
    for (const nodeId of promoted) {
      region.successNodes.delete(nodeId);
      region.failureNodes.delete(nodeId);
    }
  }

  const result = new Map<string, DurableBranchRequirement[]>();
  for (const [branchNodeId, region] of regions) {
    for (const nodeId of region.successNodes) {
      const requirements = result.get(nodeId) ?? [];
      requirements.push({ nodeId: branchNodeId, arm: 'success' });
      result.set(nodeId, requirements);
    }
    for (const nodeId of region.failureNodes) {
      const requirements = result.get(nodeId) ?? [];
      requirements.push({ nodeId: branchNodeId, arm: 'failure' });
      result.set(nodeId, requirements);
    }
  }
  const executionOrder = getTopologicalOrder(workflow, {
    includeScopedChildren: true,
  });
  const orderByNode = new Map(
    executionOrder.map((nodeId, index) => [nodeId, index]),
  );
  const resolved = new Map<string, readonly DurableBranchRequirement[]>();
  const resolvePath = (
    nodeId: string,
    visiting = new Set<string>(),
  ): readonly DurableBranchRequirement[] => {
    const memoized = resolved.get(nodeId);
    if (memoized !== undefined) return memoized;
    if (visiting.has(nodeId) || visiting.size > workflow.instances.length) {
      throw new Error(
        `Durable branch ancestry for ${workflow.functionName}.${nodeId} is recursive`,
      );
    }
    visiting.add(nodeId);
    const transitive = (result.get(nodeId) ?? []).flatMap((requirement) => [
      ...resolvePath(requirement.nodeId, new Set(visiting)),
      requirement,
    ]);
    const unique = transitive.filter(
      (requirement, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.nodeId === requirement.nodeId &&
            candidate.arm === requirement.arm,
        ) === index,
    );
    unique.sort(
      (left, right) =>
        (orderByNode.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) -
        (orderByNode.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER),
    );
    resolved.set(nodeId, unique);
    return unique;
  };
  for (const instance of workflow.instances) resolvePath(instance.id);
  return resolved;
}

/**
 * The one durable classification a node type carries, for the closure rule.
 *
 * Exactly one of gate / effect / pure must hold. An `@expression` node is a
 * pure input-to-output function by construction (no execute param, no
 * onSuccess/onFailure, no way to signal a side effect), so it counts as pure
 * without the `@durablePure` tag, matching how the code generator already
 * treats any non-gate, non-effect node. An explicit tag still applies, and a
 * node carrying two classifications is still a conflict.
 *
 * Both the closure validator and the compile-time check call this, so the
 * rule cannot drift between them.
 */
export function durableClassificationCount(
  nodeType: Pick<TNodeTypeAST, 'durableGate' | 'durableEffect' | 'durablePure' | 'expression'> | undefined,
): number {
  const isGate = nodeType?.durableGate !== undefined;
  const isEffect = nodeType?.durableEffect === true;
  const impliedPure = nodeType?.expression === true && !isGate && !isEffect;
  const isPure = nodeType?.durablePure === true || impliedPure;
  return [isGate, isEffect, isPure].filter(Boolean).length;
}

export function validateDurableClosure(
  root: TWorkflowAST,
  allWorkflows: readonly TWorkflowAST[] = [],
  options: { readonly enforce?: boolean } = {},
): DurableClosureAnalysis {
  const workflows = [...allWorkflows];
  if (!workflows.some((workflow) => workflow.functionName === root.functionName)) {
    workflows.push(root);
  }
  const workflowsByName = new Map(
    workflows.map((workflow) => [workflow.functionName, workflow]),
  );
  const reachableNames = new Set<string>();
  const collectReachable = (workflow: TWorkflowAST): void => {
    if (reachableNames.has(workflow.functionName)) return;
    reachableNames.add(workflow.functionName);
    for (const instance of workflow.instances) {
      if (instance.nodeType === 'invokeWorkflow') {
        for (const possibleTarget of workflows) collectReachable(possibleTarget);
      }
      const nested = workflowsByName.get(instance.nodeType);
      if (nested !== undefined) collectReachable(nested);
    }
  };
  collectReachable(root);
  const reachable = workflows.filter((workflow) =>
    reachableNames.has(workflow.functionName),
  );
  const nodeTypeFor = (
    workflow: TWorkflowAST,
    nodeTypeName: string,
  ) =>
    workflow.nodeTypes.find(
      (candidate) =>
        candidate.name === nodeTypeName ||
        candidate.functionName === nodeTypeName,
    );
  const hasDurableGate = reachable.some((workflow) =>
    workflow.instances.some(
      (instance) => nodeTypeFor(workflow, instance.nodeType)?.durableGate !== undefined,
    ),
  );
  const hasDurableEffect = reachable.some((workflow) =>
    workflow.instances.some(
      (instance) => nodeTypeFor(workflow, instance.nodeType)?.durableEffect === true,
    ),
  );
  if (options.enforce === false) {
    return { hasDurableGate, hasDurableEffect, reachable };
  }
  // Only source-parsed implementations carry contract analysis. External wire
  // descriptors intentionally do not pretend that their unavailable callable
  // was type-checked here.
  const invalidEffectContracts = [
    ...new Set(
      reachable.flatMap((workflow) =>
        workflow.nodeTypes.flatMap((nodeType) => {
          if (
            nodeType.durableEffect !== true ||
            nodeType.durableEffectContract === undefined ||
            nodeType.durableEffectContract.valid
          ) {
            return [];
          }
          const location =
            nodeType.sourceLocation === undefined
              ? ''
              : ` (${nodeType.sourceLocation.file}:${nodeType.sourceLocation.line})`;
          return nodeType.durableEffectContract.diagnostics.map(
            (diagnostic) => `${nodeType.functionName}${location}: ${diagnostic}`,
          );
        }),
      ),
    ),
  ].sort();
  if (!hasDurableGate) {
    if (invalidEffectContracts.length > 0) {
      throw new Error(
        `Durable effect contract errors:\n${invalidEffectContracts.join('\n')}`,
      );
    }
    return { hasDurableGate, hasDurableEffect, reachable };
  }

  const boundaryMemo = new Map<string, boolean>();
  const workflowHasDurableBoundary = (
    workflowName: string,
    visiting = new Set<string>(),
  ): boolean => {
    const memoized = boundaryMemo.get(workflowName);
    if (memoized !== undefined) return memoized;
    if (visiting.has(workflowName)) return false;
    visiting.add(workflowName);
    const workflow = workflowsByName.get(workflowName);
    if (workflow === undefined) return false;
    const result = workflow.instances.some((instance) => {
      const nodeType = nodeTypeFor(workflow, instance.nodeType);
      if (nodeType?.durableGate !== undefined || nodeType?.durableEffect === true) {
        return true;
      }
      if (instance.nodeType === 'invokeWorkflow') {
        return workflows.some((candidate) =>
          workflowHasDurableBoundary(candidate.functionName, new Set(visiting)),
        );
      }
      return workflowHasDurableBoundary(instance.nodeType, new Set(visiting));
    });
    boundaryMemo.set(workflowName, result);
    return result;
  };

  const unsafeScopedNodes: string[] = [];
  const invalidClassifications: string[] = [];
  const lazyNodes: string[] = [];
  const convergenceBoundaries: string[] = [];
  for (const workflow of reachable) {
    const executionOrder = getTopologicalOrder(workflow, {
      includeScopedChildren: true,
    });
    const branchPaths = durableBranchPaths(workflow);
    const branchingNodes = findAllBranchingNodes(workflow, workflow.nodeTypes);
    for (const instance of workflow.instances) {
      const nodeType = nodeTypeFor(workflow, instance.nodeType);
      const reachesBoundary =
        nodeType?.durableGate !== undefined ||
        nodeType?.durableEffect === true ||
        instance.nodeType === 'invokeWorkflow' ||
        workflowHasDurableBoundary(instance.nodeType);
      if (instance.parent !== undefined && instance.parent !== null) {
        unsafeScopedNodes.push(
          `${workflow.functionName}.${instance.id} (${instance.parent.id}.${instance.parent.scope})`,
        );
      }
      if (!workflowsByName.has(instance.nodeType)) {
        const classifications = durableClassificationCount(nodeType);
        if (classifications !== 1) {
          invalidClassifications.push(
            `${workflow.functionName}.${instance.id} (${instance.nodeType}): ${classifications === 0 ? 'unclassified' : 'conflicting classifications'}`,
          );
        }
      }
      if (
        instance.config?.pullExecution ||
        nodeType?.defaultConfig?.pullExecution
      ) {
        lazyNodes.push(`${workflow.functionName}.${instance.id}`);
      }
      const instanceOrder = executionOrder.indexOf(instance.id);
      if (
        reachesBoundary &&
        (branchPaths.get(instance.id)?.length ?? 0) === 0 &&
        [...branchingNodes].some(
          (branchNodeId) =>
            executionOrder.indexOf(branchNodeId) < instanceOrder,
        )
      ) {
        convergenceBoundaries.push(`${workflow.functionName}.${instance.id}`);
      }
    }
  }
  if (unsafeScopedNodes.length > 0) {
    throw new Error(
      `Scope callbacks are not supported in workflow closures containing durable gates because callback execution ordinals cannot yet be authenticated independently of a live process. Invalid: ${unsafeScopedNodes.sort().join(', ')}`,
    );
  }
  if (invalidClassifications.length > 0) {
    throw new Error(
      `Durable classification errors:\nEvery reachable node in a workflow with a durable gate must have exactly one compiler classification: @durablePure, @durableGate, or @durableEffect. Invalid: ${invalidClassifications.sort().join(', ')}`,
    );
  }
  if (invalidEffectContracts.length > 0) {
    throw new Error(
      `Durable effect contract errors:\n${invalidEffectContracts.join('\n')}`,
    );
  }
  if (lazyNodes.length > 0) {
    throw new Error(
      `Durable gate workflows do not support pull or lazy execution because a yielded continuation requires a complete compiled predecessor prefix. Invalid: ${lazyNodes.sort().join(', ')}`,
    );
  }
  if (convergenceBoundaries.length > 0) {
    throw new Error(
      `Durable boundaries after branch convergence are not supported because the continuation must retain an independently active branch path. Place the boundary inside the selected branch. Invalid: ${convergenceBoundaries.sort().join(', ')}`,
    );
  }
  return { hasDurableGate, hasDurableEffect, reachable };
}
