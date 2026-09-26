import type { TNodeTypeAST, TWorkflowAST, TNodeInstanceAST } from '../ast/types';
import { toValidIdentifier } from './code-utils';
import {
  buildControlFlowGraph,
  computeParallelLevels,
  detectBranchingChains,
  findAllBranchingNodes,
  findNodesInBranch,
  performKahnsTopologicalSort,
  isPerPortScopedChild,
} from './control-flow';
import { RESERVED_PORT_NAMES, isStartNode, isExecutePort, isSuccessPort, isFailurePort } from '../constants';

/** The nodes a branching node runs on its success arm and on its failure arm. */
export interface BranchRegion {
  successNodes: Set<string>;
  failureNodes: Set<string>;
}

/**
 * Everything the body generator decides about a workflow's control flow
 * before it emits a single node. The emission and exit phases only read it.
 */
export interface ControlFlowPlan {
  /** Instance ids (plus Start and Exit) in topological order. */
  readonly executionOrder: string[];
  /** Nodes with both onSuccess and onFailure, which open an if/else. */
  readonly branchingNodes: Set<string>;
  /**
   * Each branching node's arms, after the promotions below: a node in two
   * regions, in both arms of one region, or with a data dependency outside
   * its arm has been removed from every region.
   */
  readonly branchRegions: Map<string, BranchRegion>;
  /**
   * Nodes whose execution index can stay undefined, so they are declared
   * with `let` and read behind an undefined check: nodes in a branch arm (as
   * found before promotion), branching nodes, pull nodes and node-level
   * scoped children.
   */
  readonly conditionalNodes: Set<string>;
  /**
   * The conditional nodes that get a top-level `let <id>Idx` declaration, in
   * instance order: all of them except per-port scoped children, whose
   * indices live inside their scope closure.
   */
  readonly letIndexNodes: string[];
  /** Children of per-port scopes; they are emitted inside scope closures. */
  readonly perPortScopedChildren: Set<string>;
  /**
   * Safe ids of branching nodes whose `_success` flag is declared at the top
   * of the body, because a guard outside their branch block may read it. In
   * declaration order.
   */
  readonly topLevelSuccessFlags: Set<string>;
  /** Nodes taken out of branch arms and emitted at top level behind a STEP guard. */
  readonly promotedNodes: Set<string>;
  /** Branching nodes whose `_success` flag a promoted node's STEP guard reads. */
  readonly branchingNodesNeedingSuccessFlag: Set<string>;
  /** Flattened sequential branching chains, keyed by chain head. */
  readonly branchingChains: Map<string, string[]>;
  /** Non-head chain nodes; their chain head emits them. */
  readonly chainMembers: Set<string>;
  /** For each node in a Promise.all group, the whole group. */
  readonly parallelGroupOf: Map<string, string[]>;
}

/**
 * Whether an instance runs lazily (pull execution), and which port triggers
 * it. The instance config wins over the node type's default config.
 */
export function getPullExecutionConfig(
  instance: TNodeInstanceAST,
  nodeType: TNodeTypeAST,
): { enabled: boolean; triggerPort: string } {
  // Check instance config first
  if (instance.config?.pullExecution) {
    const pullConfig = instance.config.pullExecution;
    if (typeof pullConfig === 'boolean') {
      return { enabled: pullConfig, triggerPort: 'execute' };
    }
    return {
      enabled: true,
      triggerPort: pullConfig.triggerPort || 'execute',
    };
  }

  // Fall back to node type default config
  if (nodeType.defaultConfig?.pullExecution) {
    const pullConfig = nodeType.defaultConfig.pullExecution;
    if (typeof pullConfig === 'boolean') {
      return { enabled: pullConfig, triggerPort: 'execute' };
    }
    return {
      enabled: true,
      triggerPort: pullConfig.triggerPort || 'execute',
    };
  }

  // No pull execution configured
  return { enabled: false, triggerPort: 'execute' };
}

/**
 * Analyzes a workflow's control flow: execution order, branch regions and
 * which nodes leave them, the nodes that need a `let` index, which
 * `_success` flags must be tracked, the branching chains to flatten and the
 * parallel groups. It emits nothing.
 *
 * Branching chains and parallel groups are both off for a durable workflow:
 * a durable execution address must keep every branch frame and run in order.
 * Parallel groups are also off for a sync body, which has no event loop to
 * overlap nodes on.
 */
export function analyzeControlFlow(
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  isAsync: boolean,
  durableSequential: boolean,
): ControlFlowPlan {
  const cfg = buildControlFlowGraph(workflow, nodeTypes);
  const executionOrder = performKahnsTopologicalSort(cfg); // Now returns instance IDs
  const branchingNodes = findAllBranchingNodes(workflow, nodeTypes);
  const branchRegions = findBranchRegions(workflow, branchingNodes);

  // Determine which nodes are in conditional branches (need let declaration)
  // Nodes in branches may not execute, so we need undefined checks for them
  const nodesInBranches = new Set<string>();
  branchRegions.forEach((region) => {
    region.successNodes.forEach((n) => nodesInBranches.add(n));
    region.failureNodes.forEach((n) => nodesInBranches.add(n));
  });

  // Identify pull execution nodes (they also need let due to undefined check)
  const pullExecutionNodes = new Set<string>();
  workflow.instances.forEach((instance) => {
    // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
    const nodeType = nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
    if (nodeType) {
      const pullConfig = getPullExecutionConfig(instance, nodeType);
      if (pullConfig.enabled) {
        pullExecutionNodes.add(instance.id);
      }
    }
  });

  // Identify node-level scoped children (they need let because referenced outside scope block)
  const nodeLevelScopedChildren = new Set<string>();
  const perPortScopedChildren = new Set<string>();
  workflow.instances.forEach((instance) => {
    if (isPerPortScopedChild(instance, workflow, nodeTypes)) {
      perPortScopedChildren.add(instance.id);
    } else if (instance.parent) {
      nodeLevelScopedChildren.add(instance.id);
    }
  });

  const conditionalNodes = new Set<string>([
    ...nodesInBranches,
    ...branchingNodes,
    ...pullExecutionNodes,
    ...nodeLevelScopedChildren,
  ]);
  const letIndexNodes = workflow.instances
    .filter((instance) => !isPerPortScopedChild(instance, workflow, nodeTypes) && conditionalNodes.has(instance.id))
    .map((instance) => instance.id);

  // A branching node with any downstream node gets its _success flag at the
  // function's top level, because downstream guards (promoted nodes, chain
  // guards) may reference it outside the branch block where the branching
  // node is generated. Decided on the regions as found, before promotion.
  const topLevelSuccessFlags = new Set<string>();
  branchRegions.forEach((region, nodeId) => {
    if (region.successNodes.size > 0 || region.failureNodes.size > 0) {
      topLevelSuccessFlags.add(toValidIdentifier(nodeId));
    }
  });

  const promotedNodes = promoteNodesOutOfBranches(workflow, branchRegions);

  // Identify branching nodes whose _success flag must be tracked because
  // promoted nodes depend on their onSuccess/onFailure ports for STEP guards.
  const branchingNodesNeedingSuccessFlag = new Set<string>();
  promotedNodes.forEach((promotedNodeId) => {
    workflow.connections.forEach((conn) => {
      if (conn.to.node === promotedNodeId && isExecutePort(conn.to.port)) {
        const sourceNode = conn.from.node;
        const sourcePort = conn.from.port;
        if (branchingNodes.has(sourceNode) && (isSuccessPort(sourcePort) || isFailurePort(sourcePort))) {
          branchingNodesNeedingSuccessFlag.add(sourceNode);
        }
      }
    });
  });

  // Detect sequential branching chains for flattening
  // Durable execution addresses must retain every active branch frame. The
  // flattened chain optimization represents branches as boolean guards and
  // therefore cannot supply that exact runtime path.
  const branchingChains = durableSequential
    ? new Map<string, string[]>()
    : detectBranchingChains(branchingNodes, branchRegions);
  const chainMembers = new Set<string>();
  branchingChains.forEach((chain) => {
    // All non-head nodes are chain members (skip in main loop)
    for (let i = 1; i < chain.length; i++) {
      chainMembers.add(chain[i]);
    }
  });

  // Compute parallel levels for async workflows
  const parallelGroupOf = new Map<string, string[]>();
  if (isAsync && !durableSequential) {
    const parallelLevels = computeParallelLevels(cfg, branchingNodes, perPortScopedChildren);
    for (const group of parallelLevels) {
      if (group.length < 2) continue;
      // Filter out nodes that can't be parallelized
      const eligible = group.filter(
        (id) => !conditionalNodes.has(id) && !promotedNodes.has(id) && !chainMembers.has(id),
      );
      if (eligible.length >= 2) {
        for (const nodeId of eligible) {
          parallelGroupOf.set(nodeId, eligible);
        }
      }
    }
  }

  return {
    executionOrder,
    branchingNodes,
    branchRegions,
    conditionalNodes,
    letIndexNodes,
    perPortScopedChildren,
    topLevelSuccessFlags,
    promotedNodes,
    branchingNodesNeedingSuccessFlag,
    branchingChains,
    chainMembers,
    parallelGroupOf,
  };
}

/** Finds every branching node's success and failure arms, as the graph draws them. */
function findBranchRegions(workflow: TWorkflowAST, branchingNodes: Set<string>): Map<string, BranchRegion> {
  const allInstanceIds = new Set(workflow.instances.map((i) => i.id));
  const branchRegions = new Map<string, BranchRegion>();
  branchingNodes.forEach((branchInstanceId) => {
    const successNodes = findNodesInBranch(
      branchInstanceId,
      RESERVED_PORT_NAMES.ON_SUCCESS,
      workflow,
      allInstanceIds,
      branchingNodes,
    );
    const failureNodes = findNodesInBranch(
      branchInstanceId,
      RESERVED_PORT_NAMES.ON_FAILURE,
      workflow,
      allInstanceIds,
      branchingNodes,
    );
    branchRegions.set(branchInstanceId, { successNodes, failureNodes });
  });
  return branchRegions;
}

/**
 * Decides which nodes cannot be nested inside a branch arm and removes them
 * from every region, in place:
 * - a node in the regions of two branching nodes belongs to neither;
 * - a node in both arms of one branching node runs either way, so it is
 *   promoted (nesting it would declare it twice and cancel a node that runs);
 * - a node with a data dependency outside its arm is promoted, or STEP
 *   nesting would place it before its data providers.
 *
 * @returns The promoted nodes, which run at top level behind a STEP guard.
 *   Nodes that sat in two regions are dropped without being promoted.
 */
function promoteNodesOutOfBranches(workflow: TWorkflowAST, branchRegions: Map<string, BranchRegion>): Set<string> {
  const instancesInMultipleBranches = new Set<string>();
  workflow.instances.forEach(({ id: instanceId }) => {
    let branchCount = 0;
    branchRegions.forEach((region) => {
      if (region.successNodes.has(instanceId) || region.failureNodes.has(instanceId)) {
        branchCount++;
      }
    });
    if (branchCount > 1) {
      instancesInMultipleBranches.add(instanceId);
    }
  });
  removeFromRegions(branchRegions, instancesInMultipleBranches);

  // Promote nodes that appear in BOTH success and failure regions of the same
  // branching node. These nodes execute regardless of which branch is taken,
  // so they must not be nested inside either branch (which would cause duplicate
  // variable declarations and cancelled events for nodes that actually run).
  const nodesInBothBranches = new Set<string>();
  branchRegions.forEach((region) => {
    region.successNodes.forEach((nodeId) => {
      if (region.failureNodes.has(nodeId)) {
        nodesInBothBranches.add(nodeId);
      }
    });
  });
  removeFromRegions(branchRegions, nodesInBothBranches);

  // Promote nodes that have DATA dependencies on nodes outside their branch.
  // Without this, STEP-nesting places the node before its data providers are generated.
  const promotedNodes = new Set<string>(nodesInBothBranches);
  branchRegions.forEach((region, branchNodeId) => {
    const allBranchNodes = new Set([...region.successNodes, ...region.failureNodes]);

    allBranchNodes.forEach((nodeId) => {
      const hasExternalDataDep = workflow.connections.some((conn) => {
        if (conn.to.node !== nodeId) return false;
        if (conn.from.scope || conn.to.scope) return false;
        const fromNode = conn.from.node;
        // Dependencies on branch parent or Start are fine (already generated)
        if (fromNode === branchNodeId || isStartNode(fromNode)) return false;
        // STEP connections (execute port) are handled by the guard, not data flow
        if (isExecutePort(conn.to.port)) return false;
        // External dep: source is NOT in the same branch
        return !allBranchNodes.has(fromNode);
      });

      if (hasExternalDataDep) {
        promotedNodes.add(nodeId);
      }
    });
  });

  // Remove promoted nodes from branch regions (they'll generate at top level)
  removeFromRegions(branchRegions, promotedNodes);
  return promotedNodes;
}

function removeFromRegions(branchRegions: Map<string, BranchRegion>, nodeIds: Set<string>): void {
  branchRegions.forEach((region) => {
    nodeIds.forEach((nodeId) => {
      region.successNodes.delete(nodeId);
      region.failureNodes.delete(nodeId);
    });
  });
}
