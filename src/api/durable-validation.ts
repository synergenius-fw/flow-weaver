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
      ),
      failureNodes: findNodesInBranch(
        branchNodeId,
        RESERVED_PORT_NAMES.ON_FAILURE,
        workflow,
        allInstanceIds,
        branchingNodes,
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
function durableClassificationCount(
  nodeType: Pick<TNodeTypeAST, 'durableGate' | 'durableEffect' | 'durablePure' | 'expression'> | undefined,
): number {
  const isGate = nodeType?.durableGate !== undefined;
  const isEffect = nodeType?.durableEffect === true;
  const impliedPure = nodeType?.expression === true && !isGate && !isEffect;
  const isPure = nodeType?.durablePure === true || impliedPure;
  return [isGate, isEffect, isPure].filter(Boolean).length;
}

/**
 * Whether a scope owner invokes its iteration callback concurrently, so
 * durable gates inside the scope cannot be authenticated on resume.
 *
 * A sequential owner awaits the callback once per iteration in a loop, so each
 * gate yield carries a distinct, ordered iteration ordinal. A concurrent owner
 * (`Promise.all(items.map(cb))`, `Promise.allSettled`) fans the callback out in
 * parallel: several iterations reach their gate at once and their ordinals race,
 * which a resumed process cannot reconstruct deterministically. The owner's
 * body is inspected through its retained `functionText`; a runtime-provided
 * external descriptor has no source, so it is treated conservatively as unsafe.
 * The check is deliberately narrow — it looks for the parallel combinators that
 * are the actual footgun — and errs toward refusal, so a false positive only
 * asks the author to sequence the loop, never lets a racing gate through.
 */
function scopeOwnerInvokesConcurrently(
  parentNodeType: Pick<TNodeTypeAST, 'functionText' | 'functionTextProduction'> | undefined,
): boolean {
  const body = parentNodeType?.functionTextProduction ?? parentNodeType?.functionText;
  if (body === undefined) return true;
  // Scan code, not prose: a comment or string mentioning `Promise.all` must not
  // trip the guard. Strip block and line comments and the contents of string,
  // template, and regex-ish literals before testing, so only real calls count.
  const codeOnly = body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  return /\bPromise\s*\.\s*(all|allSettled|race|any)\b/.test(codeOnly);
}

/**
 * Whether a scope's parent node exposes a visible attempt limit, so a durable
 * resume cannot re-run the loop forever.
 *
 * A durable loop is numbered by an iteration ordinal that a resume reaches
 * again by replaying the body from its first node, skipping what the
 * continuation already holds. That makes each iteration
 * addressable and idempotent, but it does not by itself stop a loop whose
 * termination the engine cannot see from diverging on replay. Requiring a
 * declared bound (a `max`/`limit`/`attempts`/`retries`/`count`/`iterations`
 * input on the scope node) keeps the iteration space finite and inspectable,
 * matching the shape every shipped agent loop already has (`maxSteps`,
 * `maxIterations`). This is the durable counterpart of the softer
 * `DESIGN_UNBOUNDED_RETRY` design warning, promoted to a hard requirement for
 * a scope that reaches a durable boundary.
 */
function scopeHasVisibleAttemptLimit(
  workflow: TWorkflowAST,
  parentNodeType: Pick<TNodeTypeAST, 'inputs'> | undefined,
): boolean {
  if (parentNodeType === undefined) return false;
  const limitPattern = /max|limit|attempts|retries|count|iterations/i;
  return Object.keys(parentNodeType.inputs).some((port) => limitPattern.test(port));
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

  const unboundedDurableScopes: string[] = [];
  const concurrentDurableScopes: string[] = [];
  const invalidClassifications: string[] = [];
  const lazyNodes: string[] = [];
  const convergenceBoundaries: string[] = [];
  for (const workflow of reachable) {
    const executionOrder = getTopologicalOrder(workflow, {
      includeScopedChildren: true,
    });
    const branchPaths = durableBranchPaths(workflow);
    const branchingNodes = findAllBranchingNodes(workflow, workflow.nodeTypes);
    const allInstanceIds = new Set(workflow.instances.map((instance) => instance.id));
    // The raw reach of each branching node: the nodes on either of its arms,
    // before the convergence promotions durableBranchPaths applies. A boundary
    // is "after" a branch only if it actually sits in that branch's reach; a
    // node merely later in topological order is not downstream of the branch.
    // In particular a scope owner sorts before its scoped children yet its
    // success/failure arms fire only after the whole scope completes, so an
    // in-scope gate is upstream of the owner's branch, not after it.
    const branchReach = new Map<string, Set<string>>();
    for (const branchNodeId of branchingNodes) {
      const reach = new Set<string>([
        ...findNodesInBranch(branchNodeId, RESERVED_PORT_NAMES.ON_SUCCESS, workflow, allInstanceIds, branchingNodes),
        ...findNodesInBranch(branchNodeId, RESERVED_PORT_NAMES.ON_FAILURE, workflow, allInstanceIds, branchingNodes),
      ]);
      branchReach.set(branchNodeId, reach);
    }
    const nodeReachesBoundary = (nodeTypeName: string): boolean => {
      const nodeType = nodeTypeFor(workflow, nodeTypeName);
      return (
        nodeType?.durableGate !== undefined ||
        nodeType?.durableEffect === true ||
        nodeTypeName === 'invokeWorkflow' ||
        workflowHasDurableBoundary(nodeTypeName)
      );
    };
    // A scoped child under a durable boundary is allowed once its owning loop
    // is both bounded and sequential: the iteration ordinal is reconstructed
    // from committed state on resume, a visible attempt limit keeps the replay
    // finite, and sequential invocation keeps the ordinals ordered. Each such
    // scope is judged once, by its owner, and named — not each child, and not
    // every scope. A boundary-free scope never yields, so it is left alone.
    const durableScopes = new Map<string, { ownerId: string; scopeName: string }>();
    for (const instance of workflow.instances) {
      if (instance.parent === undefined || instance.parent === null) continue;
      if (!nodeReachesBoundary(instance.nodeType)) continue;
      const scopeKey = `${instance.parent.id}::${instance.parent.scope}`;
      if (!durableScopes.has(scopeKey)) {
        durableScopes.set(scopeKey, { ownerId: instance.parent.id, scopeName: instance.parent.scope });
      }
    }
    for (const { ownerId, scopeName } of durableScopes.values()) {
      const ownerInstance = workflow.instances.find((candidate) => candidate.id === ownerId);
      const ownerNodeType =
        ownerInstance === undefined ? undefined : nodeTypeFor(workflow, ownerInstance.nodeType);
      const where = `${workflow.functionName}.${ownerId} (scope '${scopeName}')`;
      if (!scopeHasVisibleAttemptLimit(workflow, ownerNodeType)) {
        unboundedDurableScopes.push(where);
      }
      if (scopeOwnerInvokesConcurrently(ownerNodeType)) {
        concurrentDurableScopes.push(where);
      }
    }
    for (const instance of workflow.instances) {
      const nodeType = nodeTypeFor(workflow, instance.nodeType);
      const reachesBoundary = nodeReachesBoundary(instance.nodeType);
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
            executionOrder.indexOf(branchNodeId) < instanceOrder &&
            branchReach.get(branchNodeId)?.has(instance.id) === true,
        )
      ) {
        convergenceBoundaries.push(`${workflow.functionName}.${instance.id}`);
      }
    }
  }
  if (concurrentDurableScopes.length > 0) {
    const invalid = [...new Set(concurrentDurableScopes)].sort();
    throw new Error(
      `A loop that reaches a durable gate must iterate sequentially so each gate keeps a distinct, ordered iteration ordinal; this scope owner invokes its iterations concurrently (Promise.all/allSettled/race/any). Await the callback once per iteration instead. Invalid: ${invalid.join(', ')}`,
    );
  }
  if (unboundedDurableScopes.length > 0) {
    const invalid = [...new Set(unboundedDurableScopes)].sort();
    throw new Error(
      `A loop that reaches a durable gate needs a visible attempt limit so a resumed run cannot diverge on replay. Add a max/limit/attempts/iterations input to the scope node. Invalid: ${invalid.join(', ')}`,
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
