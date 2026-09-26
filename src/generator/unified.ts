import type { TNodeTypeAST, TWorkflowAST, TNodeInstanceAST, TPortDefinition } from '../ast/types';
import { extractStartPorts } from '../ast/workflow-utils';
import { nodeResultVar, toValidIdentifier } from './code-utils';
import { buildNodeArgumentsWithContext } from './node-arguments';
import { emitDurableNodeCall, emitNodeInvocation, emitPlainNodeCall, emitResultOutputs } from './node-invocation';
import { isPerPortScopedChild } from './control-flow';
import {
  analyzeControlFlow,
  getPullExecutionConfig,
  type BranchRegion,
  type ControlFlowPlan,
} from './control-flow-plan';
import { emitExitAssembly } from './exit-assembly';
import {
  RESERVED_NODE_NAMES,
  EXECUTION_STRATEGIES,
  isStartNode,
  isExitNode,
  isExecutePort,
  isSuccessPort,
  isFailurePort,
} from '../constants';

/**
 * What a gated body declares to the engine before its first node: the
 * fingerprint of the graph it was compiled from (`graphIdentity`), so the
 * continuation it yields names the graph and a resume against another one
 * is refused.
 */
export interface GraphIdentityStamp {
  readonly graphFingerprint: string;
}

/** A Start value is materialized once before it enters durable state. */
function startPortValue(portName: string, port: TPortDefinition): string {
  const supplied = `params.${portName}`;
  if (port.default === undefined) return supplied;
  return `${supplied} === undefined ? ${JSON.stringify(port.default)} : ${supplied}`;
}

/**
 * Generates executable TypeScript code from a workflow AST using ExecutionContext for state management.
 *
 * This is the main code generation function that transforms a visual workflow into runnable code.
 *
 * ## Algorithm Overview:
 * 1. **Setup Phase**: Initialize ExecutionContext, set recursion depth protection
 * 2. **Start Node**: Store workflow parameters as Start node outputs
 * 3. **Control Flow Graph**: Build CFG from connections, perform topological sort
 * 4. **Branch Detection**: Identify branching nodes (with onSuccess/onFailure) and their regions
 * 5. **Parallel Detection**: For async workflows, compute parallel levels from the CFG
 *    and group independent nodes at the same topological depth into Promise.all() blocks
 * 6. **Code Generation**: For each node in execution order:
 *    - Regular nodes: Generate direct execution with variable storage
 *    - Parallel groups: Wrap 2+ independent nodes in `await Promise.all([...])`
 *    - Branching nodes: Generate if/else blocks for success/failure paths
 *    - Scoped children: Generate scope function closures (for forEach, etc.)
 *    - Pull nodes: Generate lazy executors registered with context
 * 7. **Exit Node**: Collect outputs and return result object
 *
 * Steps 3 to 5 are `analyzeControlFlow`, which returns a plan; step 6 is
 * `emitNodes` and step 7 is `emitExitAssembly`, which both only read it.
 *
 * ## Key Concepts:
 * - **Parallel Execution**: Independent async nodes at the same topological level run concurrently
 *   via Promise.all(). Sync workflows skip this since there's no event loop concurrency.
 * - **Branching Nodes**: Nodes with both onSuccess and onFailure ports create conditional branches
 * - **Per-Port Scoped Children**: Children of forEach-like nodes execute via closure functions
 * - **Pull Execution**: Nodes marked for lazy evaluation only run when outputs are consumed
 * - **Execution Index**: Each node execution gets a unique index for variable tracking
 *
 * ## Generated Code Structure:
 * ```typescript
 * const ctx = new GeneratedExecutionContext(isAsync, debugger?);
 * const startIdx = ctx.addExecution('Start');
 * ctx.setVariable({ id: 'Start', portName: 'param', ... }, value);
 * // ... node executions in topological order ...
 * const exitIdx = ctx.addExecution('Exit');
 * return { onSuccess: ..., onFailure: ..., ...outputs };
 * ```
 *
 * @param workflow - The workflow AST to generate code for
 * @param nodeTypes - Available node type definitions (includes workflow's nodeTypes + imports)
 * @param isAsync - Whether to generate async code (adds await, returns Promise)
 * @param production - If true, omits debug instrumentation for smaller output
 * @returns Generated TypeScript function body (without function signature)
 */
export function generateControlFlowWithExecutionContext(
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  isAsync: boolean,
  production: boolean = false,
  bundleMode: boolean = false,
  durableSequential: boolean = false,
  identity?: GraphIdentityStamp,
): string {
  // In dev mode, always treat as async so the debugger can pause execution
  // at breakpoints (sendStatusChangedEvent must be awaited for this to work).
  // Production mode respects the original isAsync to avoid overhead.
  const bodyAsync = isAsync || !production;

  const lines: string[] = [];
  emitContextSetup(lines, workflow, bodyAsync, production, identity);
  emitStartNode(lines, workflow, bodyAsync);
  const plan = analyzeControlFlow(workflow, nodeTypes, bodyAsync, durableSequential);
  emitExecutionIndexDeclarations(lines, plan);
  emitNodes({
    workflow,
    nodeTypes,
    isAsync: bodyAsync,
    production,
    bundleMode,
    plan,
    lines,
    generatedNodes: new Set<string>(),
  });
  emitExitAssembly(lines, workflow, nodeTypes, plan, bodyAsync, production);
  return lines.join('\n');
}

/**
 * Emits the body's preamble: recursion depth protection, the execution
 * context, a gated body's workflow and graph binding, and (outside
 * production) the debug controller.
 */
function emitContextSetup(
  lines: string[],
  workflow: TWorkflowAST,
  isAsync: boolean,
  production: boolean,
  identity: GraphIdentityStamp | undefined,
): void {
  // Recursion depth protection: prevent infinite recursion in workflows
  lines.push(`  // Recursion depth protection`);
  lines.push(`  const __rd__ = (params as { __rd__?: number }).__rd__ ?? 0;`);
  lines.push(`  if (__rd__ >= 1000) {`);
  lines.push(`    throw new Error('Max recursion depth exceeded (1000) in workflow "${workflow.functionName}"');`);
  lines.push(`  }`);
  lines.push('');

  // The runtime carries the debugger and the abort signal for cancellation.
  const asyncArg = isAsync ? 'true' : 'false';
  lines.push(`  const ctx = new GeneratedExecutionContext(${asyncArg}, __runtime__);`);
  // A gated body names its workflow and graph to the engine first, so a
  // continuation it yields carries them and a resume against another graph
  // is refused before a single node runs.
  if (identity !== undefined) {
    lines.push(`  ctx.bindWorkflow('${workflow.functionName}', '${identity.graphFingerprint}');`);
  }
  lines.push('');

  // Debug controller is an execution-scoped live developer tool. It is not a
  // continuation mechanism and cannot skip generated execution boundaries.
  if (!production) {
    lines.push(
      `  const __ctrl__: TDebugController = (__runtime__.services.debugController ?? { beforeNode: () => {}, afterNode: () => {} }) as TDebugController;`,
    );
    lines.push('');
  }
}

/** Emits the Start execution, which stores the workflow parameters as its outputs. */
function emitStartNode(lines: string[], workflow: TWorkflowAST, isAsync: boolean): void {
  lines.push(`  const startIdx = ctx.addExecution('${RESERVED_NODE_NAMES.START}');`);
  lines.push(`  if (ctx.shouldExecute('${RESERVED_NODE_NAMES.START}', '${RESERVED_NODE_NAMES.START}', startIdx)) {`);
  const awaitPrefix = isAsync ? 'await ' : '';
  Object.entries(extractStartPorts(workflow)).forEach(([portName, port]) => {
    const setCall = isAsync ? `await ctx.setVariable` : `ctx.setVariable`;
    // STEP Port Architecture: execute comes from workflow parameter, data from params object
    const valueSource = isExecutePort(portName) ? 'execute' : startPortValue(portName, port);
    lines.push(
      `    ${setCall}({ id: '${RESERVED_NODE_NAMES.START}', portName: '${portName}', executionIndex: startIdx, nodeTypeName: '${RESERVED_NODE_NAMES.START}' }, ${valueSource});`,
    );
  });
  lines.push(`    ${awaitPrefix}ctx.sendStatusChangedEvent({`);
  lines.push(`      nodeTypeName: '${RESERVED_NODE_NAMES.START}',`);
  lines.push(`      id: '${RESERVED_NODE_NAMES.START}',`);
  lines.push(`      executionIndex: startIdx,`);
  lines.push(`      status: 'SUCCEEDED',`);
  lines.push(`    });`);
  lines.push(`    ctx.commitNode('${RESERVED_NODE_NAMES.START}', '${RESERVED_NODE_NAMES.START}', startIdx);`);
  lines.push(`  }`);
  lines.push('');
}

/**
 * Emits the top-level declarations the node code assigns later: a `let`
 * index for every node that may not run, a `_success` flag for every
 * branching node a guard outside its block may read, and a `let` index for
 * every parallel-group node (assigned inside its Promise.all arm).
 */
function emitExecutionIndexDeclarations(lines: string[], plan: ControlFlowPlan): void {
  plan.letIndexNodes.forEach((instanceId) => {
    lines.push(`  let ${toValidIdentifier(instanceId)}Idx: number | undefined;`);
  });
  plan.topLevelSuccessFlags.forEach((safeId) => {
    lines.push(`  let ${safeId}_success = false;`);
  });
  if (plan.letIndexNodes.length > 0 || plan.topLevelSuccessFlags.size > 0) {
    lines.push('');
  }

  if (plan.parallelGroupOf.size > 0) {
    plan.parallelGroupOf.forEach((_, instanceId) => {
      // Only declare if not already declared by earlier let declarations
      if (!plan.conditionalNodes.has(instanceId)) {
        lines.push(`  let ${toValidIdentifier(instanceId)}Idx: number | undefined;`);
      }
    });
    lines.push('');
  }
}

/** The body being generated, shared by the node emission functions. */
interface BodyEmission {
  readonly workflow: TWorkflowAST;
  readonly nodeTypes: TNodeTypeAST[];
  /** The effective async mode (dev bodies are always async). */
  readonly isAsync: boolean;
  readonly production: boolean;
  readonly bundleMode: boolean;
  readonly plan: ControlFlowPlan;
  readonly lines: string[];
  /** Nodes already emitted, by whichever function emitted them. */
  readonly generatedNodes: Set<string>;
}

/**
 * Emits every top-level node in execution order. Each node goes to one of
 * three emitters: its parallel group, the branching-node emitter, or the
 * plain-node emitter. Nodes inside a branch arm, a chain or a per-port scope
 * are left to whoever owns them.
 */
function emitNodes(body: BodyEmission): void {
  const { workflow, nodeTypes, plan, lines, generatedNodes } = body;
  for (const instanceId of plan.executionOrder) {
    if (isStartNode(instanceId) || isExitNode(instanceId) || generatedNodes.has(instanceId)) {
      continue;
    }
    // Find the instance and its node type
    const instance = workflow.instances.find((i) => i.id === instanceId);
    if (!instance) {
      lines.push(`  // Node '${instanceId}' skipped: instance not found in workflow`);
      continue;
    }
    // Skip per-port scoped children (they're in scope functions)
    // Include node-level scoped children (they're in scope blocks)
    if (isPerPortScopedChild(instance, workflow, nodeTypes)) {
      continue;
    }
    // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
    const nodeType = nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
    if (!nodeType) {
      lines.push(`  // Node '${instance.id}' skipped: type '${instance.nodeType}' not found`);
      continue;
    }
    // Handle parallel groups: emit Promise.all when hitting first node of a group
    const group = plan.parallelGroupOf.get(instanceId);
    if (group && emitParallelGroup(body, group)) {
      continue;
    }
    if (plan.branchingNodes.has(instanceId)) {
      emitTopLevelBranchingNode(body, instance, nodeType);
    } else {
      emitTopLevelNode(body, instance, nodeType);
    }
  }
}

/**
 * Emits the not-yet-emitted members of a parallel group as one Promise.all,
 * then each member's node-level scoped children.
 *
 * @returns false when fewer than two members are left; the caller then
 *   emits the node sequentially.
 */
function emitParallelGroup(body: BodyEmission, group: string[]): boolean {
  const { workflow, nodeTypes, isAsync, production, bundleMode, plan, lines, generatedNodes } = body;
  const ungeneratedGroup = group.filter((id) => !generatedNodes.has(id));
  if (ungeneratedGroup.length < 2) {
    return false;
  }
  generateParallelGroupWithContext(
    ungeneratedGroup,
    workflow,
    nodeTypes,
    lines,
    generatedNodes,
    '  ',
    isAsync,
    'ctx',
    bundleMode,
    plan.branchingNodes,
    production,
  );
  // Generate scoped children for each parallel node
  for (const parallelNodeId of ungeneratedGroup) {
    const inst = workflow.instances.find((i) => i.id === parallelNodeId);
    if (!inst) continue;
    const nt = nodeTypes.find((n) => n.name === inst.nodeType || n.functionName === inst.nodeType);
    if (!nt) continue;
    generateScopedChildrenExecution(
      inst,
      nt,
      workflow,
      nodeTypes,
      generatedNodes,
      lines,
      '  ',
      plan.branchingNodes,
      plan.branchRegions,
      isAsync,
      bundleMode,
      production,
    );
  }
  return true;
}

/**
 * The STEP guard a promoted node runs behind at top level: any of its
 * execute-port sources having fired. Undefined for a node that was not
 * promoted, or whose only execute source is Start.
 */
function promotedStepGuard(body: BodyEmission, instanceId: string): string | undefined {
  const { workflow, plan } = body;
  if (!plan.promotedNodes.has(instanceId)) {
    return undefined;
  }
  const stepSourceConditions: string[] = [];
  workflow.connections.forEach((conn) => {
    if (conn.to.node === instanceId && isExecutePort(conn.to.port)) {
      const src = conn.from.node;
      if (!isStartNode(src)) {
        stepSourceConditions.push(buildStepSourceCondition(src, conn.from.port, plan.branchingNodes));
      }
    }
  });
  return stepSourceConditions.length > 0 ? stepSourceConditions.join(' || ') : undefined;
}

/**
 * Emits a branching node that is not nested in another branch: a chain head
 * as a flat chain, any other branching node with its arms nested. A promoted
 * one is wrapped in its STEP guard. Chain members are left to their head.
 */
function emitTopLevelBranchingNode(body: BodyEmission, instance: TNodeInstanceAST, nodeType: TNodeTypeAST): void {
  const { workflow, nodeTypes, isAsync, production, bundleMode, plan, lines, generatedNodes } = body;
  const instanceId = instance.id;
  // Chain members are generated by their chain head, so skip them here
  if (plan.chainMembers.has(instanceId)) {
    return;
  }

  // For promoted branching nodes, wrap in STEP guard from execute port source
  const guard = promotedStepGuard(body, instanceId);
  const indent = guard === undefined ? '  ' : '    ';
  if (guard !== undefined) {
    lines.push(`  if (${guard}) {`);
  }

  // Chain heads: use flat chain generation
  const chain = plan.branchingChains.get(instanceId);
  if (chain) {
    generateBranchingChainCode(
      chain,
      workflow,
      nodeTypes,
      plan.branchingNodes,
      plan.branchRegions,
      generatedNodes,
      lines,
      indent,
      isAsync,
      'ctx',
      bundleMode,
      plan.branchingNodesNeedingSuccessFlag,
      production,
      plan.topLevelSuccessFlags,
    );
    if (guard !== undefined) {
      lines.push(`  }`);
    }
    return;
  }

  // Non-chain branching nodes. The _success flags pre-declared at the top of
  // the body stay visible to downstream guards that run after this block.
  const region = plan.branchRegions.get(instanceId)!;
  generateBranchingNodeCode(
    instance,
    nodeType,
    workflow,
    nodeTypes,
    region,
    generatedNodes,
    lines,
    indent,
    plan.branchingNodes,
    plan.branchRegions,
    isAsync,
    'ctx',
    bundleMode,
    new Set<string>(plan.topLevelSuccessFlags),
    plan.branchingNodesNeedingSuccessFlag.has(instanceId) ||
      plan.topLevelSuccessFlags.has(toValidIdentifier(instanceId)),
    production,
  );
  if (guard !== undefined) {
    lines.push(`  }`);
  }
  region.successNodes.forEach((n) => generatedNodes.add(n));
  region.failureNodes.forEach((n) => generatedNodes.add(n));

  // Check if this node creates a scope and generate scoped children
  generateScopedChildrenExecution(
    instance,
    nodeType,
    workflow,
    nodeTypes,
    generatedNodes,
    lines,
    '  ',
    plan.branchingNodes,
    plan.branchRegions,
    isAsync,
    bundleMode,
    production,
  );
}

/**
 * Emits a non-branching node at top level, then its node-level scoped
 * children. A node inside a branch arm is left to its branching node. Its
 * index is a `const` unless the plan pre-declared it with `let`.
 */
function emitTopLevelNode(body: BodyEmission, instance: TNodeInstanceAST, nodeType: TNodeTypeAST): void {
  const { workflow, nodeTypes, isAsync, production, bundleMode, plan, lines, generatedNodes } = body;
  const instanceId = instance.id;
  const belongsToBranch = Array.from(plan.branchRegions.values()).some(
    (region) => region.successNodes.has(instanceId) || region.failureNodes.has(instanceId),
  );
  if (belongsToBranch) {
    return;
  }
  const nodeUseConst = !plan.conditionalNodes.has(instanceId) && !plan.parallelGroupOf.has(instanceId);
  generateNodeCallWithContext(
    instance,
    nodeType,
    workflow,
    lines,
    nodeTypes,
    '  ',
    isAsync,
    nodeUseConst,
    undefined, // instanceParent
    'ctx', // ctxVar
    bundleMode,
    false, // skipExecuteGuard
    plan.branchingNodes, // for port-aware STEP guards
    production,
  );
  generatedNodes.add(instanceId);

  // Check if this node creates a scope and generate scoped children
  generateScopedChildrenExecution(
    instance,
    nodeType,
    workflow,
    nodeTypes,
    generatedNodes,
    lines,
    '  ',
    plan.branchingNodes,
    plan.branchRegions,
    isAsync,
    bundleMode,
    production,
  );
}

/**
 * Helper function to generate scoped children execution for nodes that create scopes
 */
function generateScopedChildrenExecution(
  parentInstance: { id: string; nodeType: string },
  parentNodeType: TNodeTypeAST,
  workflow: TWorkflowAST,
  allNodeTypes: TNodeTypeAST[],
  generatedNodes: Set<string>,
  lines: string[],
  indent: string,
  branchingNodes: Set<string>,
  branchRegions: Map<string, BranchRegion>,
  isAsync: boolean,
  bundleMode: boolean = false,
  production: boolean = false,
): void {
  // Check if this node creates a scope
  if (!parentNodeType.scope) return;

  // Check if this is a per-port scope (has scoped OUTPUT ports)
  // Per-port scopes have children handled inside the scope function closure generated by
  // buildNodeArgumentsWithContext -> generateScopeFunctionClosure, so we skip here
  const rawScopeName = parentNodeType.scope;
  const hasPerPortScope = Object.values(parentNodeType.outputs).some((portDef) => portDef.scope === rawScopeName);
  if (hasPerPortScope) {
    // Children are already generated inside the scope function closure
    return;
  }

  const scopeName = `${parentInstance.id}.${parentNodeType.scope}`;

  // Find children in this scope from workflow.scopes or instance.parentScope
  const childrenInScope: string[] = [];

  // Check workflow.scopes mapping
  if (workflow.scopes && workflow.scopes[scopeName]) {
    childrenInScope.push(...workflow.scopes[scopeName]);
  }

  // Also check instances with parent field
  workflow.instances.forEach((instance) => {
    const parentScopeName = instance.parent ? `${instance.parent.id}.${instance.parent.scope}` : null;
    if (parentScopeName === scopeName && !childrenInScope.includes(instance.id)) {
      childrenInScope.push(instance.id);
    }
  });

  if (childrenInScope.length === 0) return;

  // Generate scope creation
  const safeParentId = toValidIdentifier(parentInstance.id);
  lines.push(``);
  lines.push(`${indent}// Create scope for children of ${parentInstance.id}`);
  lines.push(
    `${indent}const ${safeParentId}_scopedCtx = ctx.createScope('${parentInstance.id}', ${safeParentId}Idx, '${parentNodeType.scope}');`,
  );
  lines.push(``);

  // Scoped context variable name for child generators
  const scopedCtxVar = `${safeParentId}_scopedCtx`;

  // Generate child nodes execution using scoped context
  childrenInScope.forEach((childInstanceId) => {
    if (generatedNodes.has(childInstanceId)) return;

    const childInstance = workflow.instances.find((i) => i.id === childInstanceId);
    if (!childInstance) return;

    // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
    const childNodeType = allNodeTypes.find(
      (nt) => nt.name === childInstance.nodeType || nt.functionName === childInstance.nodeType,
    );
    if (!childNodeType) return;

    // Check if this child is a branching node
    if (branchingNodes.has(childInstanceId)) {
      generateBranchingNodeCode(
        childInstance,
        childNodeType,
        workflow,
        allNodeTypes,
        branchRegions.get(childInstanceId)!,
        generatedNodes,
        lines,
        indent,
        branchingNodes,
        branchRegions,
        isAsync,
        scopedCtxVar, // Pass scoped context name
        bundleMode,
        new Set(),
        false,
        production,
      );
      const region = branchRegions.get(childInstanceId)!;
      region.successNodes.forEach((n) => generatedNodes.add(n));
      region.failureNodes.forEach((n) => generatedNodes.add(n));
    } else {
      generateNodeCallWithContext(
        childInstance,
        childNodeType,
        workflow,
        lines,
        allNodeTypes,
        indent,
        isAsync,
        false, // useConst = false - scoped children need let (referenced outside scope block)
        parentInstance.id, // instanceParent - parent node is const, no ! needed when referencing it
        scopedCtxVar, // Pass scoped context name
        bundleMode,
        false, // skipExecuteGuard
        new Set(), // branchingNodes
        production,
      );
    }

    generatedNodes.add(childInstanceId);
  });

  lines.push(``);
  lines.push(`${indent}// Merge scope back into parent context`);
  lines.push(`${indent}ctx.mergeScope(${parentInstance.id}_scopedCtx);`);
  lines.push(``);
}

/**
 * Generate a Promise.all block for 2+ parallel nodes in the unified generator.
 *
 * Each node's execution code is wrapped in an async IIFE inside Promise.all.
 * The outer `let` variables for execution indices are assigned inside the IIFEs.
 */
function generateParallelGroupWithContext(
  nodeIds: string[],
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  lines: string[],
  generatedNodes: Set<string>,
  indent: string,
  isAsync: boolean,
  ctxVar: string,
  bundleMode: boolean,
  branchingNodes: Set<string>,
  production: boolean = false,
): void {
  const parallelNodes: {
    id: string;
    instance: TWorkflowAST['instances'][number];
    nodeType: TNodeTypeAST;
  }[] = [];

  for (const nodeId of nodeIds) {
    const instance = workflow.instances.find((i) => i.id === nodeId);
    if (!instance) continue;
    const nodeType = nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
    if (!nodeType) continue;
    parallelNodes.push({ id: nodeId, instance, nodeType });
  }

  // Fallback: if only 0-1 nodes remain, emit directly without Promise.all
  if (parallelNodes.length < 2) {
    for (const node of parallelNodes) {
      generateNodeCallWithContext(
        node.instance,
        node.nodeType,
        workflow,
        lines,
        nodeTypes,
        indent,
        isAsync,
        false,
        undefined,
        ctxVar,
        bundleMode,
        false,
        branchingNodes,
        production,
      );
      generatedNodes.add(node.id);
    }
    return;
  }

  const nodeBuffers = parallelNodes.map((node, index) => {
    const parallelCtx = `${ctxVar}_parallel_${index}`;
    const nodeLines: string[] = [];
    generateNodeCallWithContext(
      node.instance,
      node.nodeType,
      workflow,
      nodeLines,
      nodeTypes,
      `${indent}    `,
      isAsync,
      false,
      undefined,
      parallelCtx,
      bundleMode,
      false,
      branchingNodes,
      production,
    );
    lines.push(`${indent}const ${parallelCtx} = ${ctxVar}.forkParallel();`);
    return { ...node, lines: nodeLines, parallelCtx };
  });

  lines.push(`${indent}await Promise.all([`);

  for (let i = 0; i < nodeBuffers.length; i++) {
    const buf = nodeBuffers[i];
    const comma = i < nodeBuffers.length - 1 ? ',' : '';

    lines.push(`${indent}  (async () => {`);
    for (const line of buf.lines) {
      lines.push(line);
    }
    lines.push(`${indent}  })()${comma}`);
    generatedNodes.add(buf.id);
  }

  lines.push(`${indent}]);`);
  for (const buffer of nodeBuffers) {
    lines.push(`${indent}${ctxVar}.mergeParallel(${buffer.parallelCtx});`);
  }
  lines.push('');
}

/**
 * Sort branch nodes topologically based on their dependencies
 *
 * This ensures nodes within a branch execute in the correct order:
 * dependencies before dependents.
 *
 * @param nodeIds - Set of node IDs within the branch
 * @param workflow - The workflow AST
 * @returns Array of node IDs in topologically sorted order
 */
function sortBranchNodesTopologically(nodeIds: Set<string>, workflow: TWorkflowAST): string[] {
  if (nodeIds.size === 0) {
    return [];
  }

  // Build a mini control flow graph for just these nodes
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  nodeIds.forEach((id) => {
    graph.set(id, []);
    inDegree.set(id, 0);
  });

  // Add edges based on data flow connections within the branch
  workflow.connections.forEach((conn) => {
    const fromNode = conn.from.node;
    const toNode = conn.to.node;

    // Only consider connections within this branch
    if (nodeIds.has(fromNode) && nodeIds.has(toNode)) {
      const successors = graph.get(fromNode) || [];
      if (!successors.includes(toNode)) {
        successors.push(toNode);
        graph.set(fromNode, successors);
        inDegree.set(toNode, (inDegree.get(toNode) || 0) + 1);
      }
    }
  });

  // Perform Kahn's topological sort
  const result: string[] = [];
  const queue: string[] = [];

  // Start with nodes that have no dependencies within the branch
  inDegree.forEach((degree, node) => {
    if (degree === 0) {
      queue.push(node);
    }
  });

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    const successors = graph.get(node) || [];
    successors.forEach((successor) => {
      const newDegree = (inDegree.get(successor) || 0) - 1;
      inDegree.set(successor, newDegree);
      if (newDegree === 0) {
        queue.push(successor);
      }
    });
  }

  // If we haven't processed all nodes, there's a cycle (shouldn't happen after validation)
  if (result.length !== nodeIds.size) {
    // Fallback: add remaining nodes in arbitrary order
    nodeIds.forEach((id) => {
      if (!result.includes(id)) {
        result.push(id);
      }
    });
  }

  return result;
}

/**
 * Generates CANCELLED status events for all nodes in a branch that won't be executed.
 * This is called when a branching node decides to take one path, marking nodes in
 * the non-taken path as CANCELLED. We must add an execution index first to have a
 * valid reference for the event.
 */
function generateCancelledEventsForBranch(
  nodeIds: Set<string>,
  workflow: TWorkflowAST,
  allNodeTypes: TNodeTypeAST[],
  lines: string[],
  indent: string,
  ctxVar: string = 'ctx', // Context variable name (for scoped contexts)
  isAsync: boolean = false,
): void {
  const awaitPrefix = isAsync ? 'await ' : '';
  nodeIds.forEach((instanceId) => {
    const instance = workflow.instances.find((i) => i.id === instanceId);
    if (!instance) return;

    const safeId = toValidIdentifier(instanceId);
    // Use const (block-scoped) intentionally — the outer `let ${safeId}Idx`
    // stays undefined, which signals to downstream guards that this node was
    // CANCELLED and its data ports should not be read.
    lines.push(`${indent}const ${safeId}Idx = ${ctxVar}.addExecution('${instanceId}');`);
    // Set STEP port variables so downstream nodes reading onSuccess/onFailure
    // from this cancelled node don't crash with "Variable not found".
    lines.push(
      `${indent}${awaitPrefix}${ctxVar}.setVariable({ id: '${instanceId}', portName: 'onSuccess', executionIndex: ${safeId}Idx, nodeTypeName: '${instance.nodeType}' }, false);`,
    );
    lines.push(
      `${indent}${awaitPrefix}${ctxVar}.setVariable({ id: '${instanceId}', portName: 'onFailure', executionIndex: ${safeId}Idx, nodeTypeName: '${instance.nodeType}' }, false);`,
    );
    lines.push(`${indent}${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
    lines.push(`${indent}  nodeTypeName: '${instance.nodeType}',`);
    lines.push(`${indent}  id: '${instanceId}',`);
    lines.push(`${indent}  executionIndex: ${safeId}Idx,`);
    lines.push(`${indent}  status: 'CANCELLED',`);
    lines.push(`${indent}});`);
  });
}

/**
 * Build a guard condition for a STEP connection source.
 * For branching nodes whose onSuccess/onFailure port is the source,
 * use the _success flag to guard the correct branch path.
 * For other sources, use Idx !== undefined.
 */
function buildStepSourceCondition(sourceNode: string, sourcePort: string, branchingNodes: Set<string>): string {
  const safeNode = toValidIdentifier(sourceNode);
  if (branchingNodes.has(sourceNode)) {
    if (isSuccessPort(sourcePort)) {
      return `${safeNode}_success`;
    }
    if (isFailurePort(sourcePort)) {
      return `${safeNode}_success === false`;
    }
  }
  return `${safeNode}Idx !== undefined`;
}

/**
 * Generate flat code for a sequential chain of branching nodes.
 *
 * Instead of nesting each subsequent branching node inside the previous one's
 * success/failure branch (O(N) depth), this generates them sequentially with
 * accumulated guard conditions (O(1) depth).
 *
 * For chain [A, B, C]:
 *   A code (no guard)
 *   if (A_success) { B code } else { CANCELLED for B,C and regions }
 *   if (A_success && B_success) { C code } else { CANCELLED for C and regions }
 */
function generateBranchingChainCode(
  chain: string[],
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  branchingNodes: Set<string>,
  branchRegions: Map<string, BranchRegion>,
  generatedNodes: Set<string>,
  lines: string[],
  indent: string,
  isAsync: boolean,
  ctxVar: string,
  bundleMode: boolean,
  forceTrackSuccessNodes: Set<string> = new Set(),
  production: boolean = false,
  alreadyDeclaredFlags: Set<string> = new Set(),
): void {
  // Pre-declare success flags for all non-last chain nodes so they're
  // accessible across guard blocks (avoiding let-in-block scoping issues).
  // Also pre-declare for the last node if promoted nodes depend on its _success flag.
  // Skip flags already declared at a higher scope (e.g. function top-level).
  const preDeclaredFlags = new Set<string>(alreadyDeclaredFlags);
  for (let i = 0; i < chain.length; i++) {
    const isLast = i === chain.length - 1;
    const safeId = toValidIdentifier(chain[i]);
    if (!isLast || forceTrackSuccessNodes.has(chain[i]) || alreadyDeclaredFlags.has(safeId)) {
      if (!alreadyDeclaredFlags.has(safeId)) {
        lines.push(`${indent}let ${safeId}_success = false;`);
      }
      preDeclaredFlags.add(safeId);
    }
  }
  if (chain.length > 1) {
    lines.push('');
  }

  const guardParts: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const nodeId = chain[i];
    const isLast = i === chain.length - 1;
    const instance = workflow.instances.find((inst) => inst.id === nodeId);
    if (!instance) continue;
    const nodeType = nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
    if (!nodeType) continue;
    const safeId = toValidIdentifier(nodeId);
    const originalRegion = branchRegions.get(nodeId)!;

    // For non-last nodes, create modified region with chain successor removed
    // so generateBranchingNodeCode won't recurse into the next chain node
    let effectiveRegion = originalRegion;
    if (!isLast) {
      const nextNodeId = chain[i + 1];
      effectiveRegion = {
        successNodes: new Set([...originalRegion.successNodes].filter((n) => n !== nextNodeId)),
        failureNodes: new Set([...originalRegion.failureNodes].filter((n) => n !== nextNodeId)),
      };
    }

    const hasGuard = guardParts.length > 0;
    const guardCondition = guardParts.join(' && ');

    if (hasGuard) {
      lines.push(`${indent}if (${guardCondition}) {`);
    }

    const nodeIndent = hasGuard ? indent + '  ' : indent;

    generateBranchingNodeCode(
      instance,
      nodeType,
      workflow,
      nodeTypes,
      effectiveRegion,
      generatedNodes,
      lines,
      nodeIndent,
      branchingNodes,
      branchRegions,
      isAsync,
      ctxVar,
      bundleMode,
      preDeclaredFlags,
      !isLast || forceTrackSuccessNodes.has(chain[i]) || alreadyDeclaredFlags.has(safeId), // forceTrackSuccess for non-last chain nodes, nodes with promoted dependents, or nodes with pre-declared flags
      production,
    );

    // Generate scoped children for this chain node
    generateScopedChildrenExecution(
      instance,
      nodeType,
      workflow,
      nodeTypes,
      generatedNodes,
      lines,
      nodeIndent,
      branchingNodes,
      branchRegions,
      isAsync,
      bundleMode,
      production,
    );

    if (hasGuard) {
      lines.push(`${indent}} else {`);
      // Emit CANCELLED for this node and all remaining chain nodes + their regions
      const remainingNodes = new Set<string>();
      for (let j = i; j < chain.length; j++) {
        const chainNodeId = chain[j];
        remainingNodes.add(chainNodeId);
        const region = branchRegions.get(chainNodeId)!;
        region.successNodes.forEach((n) => remainingNodes.add(n));
        region.failureNodes.forEach((n) => remainingNodes.add(n));
      }
      generateCancelledEventsForBranch(remainingNodes, workflow, nodeTypes, lines, indent + '  ', ctxVar, isAsync);
      lines.push(`${indent}}`);
    }

    // Add success condition for next iteration's guard
    if (!isLast) {
      guardParts.push(`${safeId}_success`);
    }

    // Mark node and its effective region as generated
    generatedNodes.add(nodeId);
    effectiveRegion.successNodes.forEach((n) => generatedNodes.add(n));
    effectiveRegion.failureNodes.forEach((n) => generatedNodes.add(n));
  }
}

/**
 * Emits one branching node: its guarded execution, which records whether it
 * succeeded, then (when either arm has nodes) the if/else that runs one arm
 * and reports the other as cancelled.
 *
 * @param region - The arms to emit; a chain passes a copy without its next link.
 * @param preDeclaredSuccessFlags - Safe ids whose `_success` flag an outer scope already declared.
 * @param forceTrackSuccess - Track `_success` even with empty arms (chain guards or promoted nodes read it).
 */
function generateBranchingNodeCode(
  instance: { id: string; nodeType: string },
  branchNode: TNodeTypeAST,
  workflow: TWorkflowAST,
  allNodeTypes: TNodeTypeAST[],
  region: BranchRegion,
  generatedNodes: Set<string>,
  lines: string[],
  indent: string,
  branchingNodes: Set<string>,
  branchRegions: Map<string, BranchRegion>,
  isAsync: boolean,
  ctxVar: string = 'ctx', // Context variable name (for scoped contexts)
  bundleMode: boolean = false,
  preDeclaredSuccessFlags: Set<string> = new Set(),
  forceTrackSuccess: boolean = false,
  production: boolean = false,
): void {
  const hasDownstream = region.successNodes.size > 0 || region.failureNodes.size > 0;
  const branching: BranchingNodeEmission = {
    instance,
    branchNode,
    workflow,
    allNodeTypes,
    region,
    generatedNodes,
    lines,
    indent,
    branchingNodes,
    branchRegions,
    isAsync,
    ctxVar,
    bundleMode,
    preDeclaredSuccessFlags,
    // Track success flag when there are downstream nodes OR when chain code needs it
    trackSuccess: hasDownstream || forceTrackSuccess,
    production,
  };
  emitBranchingNodeExecution(branching);
  // Only generate if/else if there are downstream nodes
  if (hasDownstream) {
    emitBranchArms(branching);
  }
  generatedNodes.add(instance.id);
}

/** One branching node being emitted, shared by the functions that emit its parts. */
interface BranchingNodeEmission {
  readonly instance: { id: string; nodeType: string };
  readonly branchNode: TNodeTypeAST;
  readonly workflow: TWorkflowAST;
  readonly allNodeTypes: TNodeTypeAST[];
  readonly region: BranchRegion;
  readonly generatedNodes: Set<string>;
  readonly lines: string[];
  /** The indent of the node's own statements. */
  readonly indent: string;
  readonly branchingNodes: Set<string>;
  readonly branchRegions: Map<string, BranchRegion>;
  readonly isAsync: boolean;
  readonly ctxVar: string;
  readonly bundleMode: boolean;
  readonly preDeclaredSuccessFlags: Set<string>;
  /** Whether the node's `_success` flag is kept (declared if needed, reset, assigned). */
  readonly trackSuccess: boolean;
  readonly production: boolean;
}

/**
 * Emits the branching node's own execution: the shouldExecute block that
 * runs it, reports it, and sets `_success` from its result. A throw reports
 * the node failed (or cancelled), cancels both arms and rethrows; a skipped
 * execution (resume) reads `_success` back from its stored onSuccess.
 */
function emitBranchingNodeExecution(branching: BranchingNodeEmission): void {
  const {
    instance,
    branchNode,
    workflow,
    allNodeTypes,
    region,
    lines,
    isAsync,
    ctxVar,
    bundleMode,
    preDeclaredSuccessFlags,
    trackSuccess,
    production,
  } = branching;
  const instanceId = instance.id;
  const safeId = toValidIdentifier(instanceId);
  const functionName = branchNode.functionName;
  // Must match the local emitted for this node (see nodeResultVar).
  const resultVar = nodeResultVar(safeId, functionName);

  // Live debugging is separate from durable boundary restoration.
  const emitDebugHooks = !production;
  const outerIndent = branching.indent;
  const indent = `${outerIndent}  `;

  if (trackSuccess && !preDeclaredSuccessFlags.has(safeId)) {
    lines.push(`${outerIndent}let ${safeId}_success = false;`);
  }
  if (emitDebugHooks) {
    const awaitHook = isAsync ? 'await ' : '';
    lines.push(`${outerIndent}${awaitHook}__ctrl__.beforeNode('${instanceId}', ${ctxVar});`);
  }
  const awaitPrefix = isAsync ? 'await ' : '';

  if (!production) {
    lines.push('');
    lines.push(`${outerIndent}// ── ${instanceId} (${functionName}) ──`);
  }
  lines.push(`${outerIndent}${ctxVar}.checkAborted('${instanceId}');`);
  lines.push(`${outerIndent}${safeId}Idx = ${ctxVar}.addExecution('${instanceId}');`);
  lines.push(`${outerIndent}if (${ctxVar}.shouldExecute('${instanceId}', '${functionName}', ${safeId}Idx)) {`);
  lines.push(`${indent}${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}  nodeTypeName: '${functionName}',`);
  lines.push(`${indent}  id: '${instanceId}',`);
  lines.push(`${indent}  executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}  status: 'RUNNING',`);
  lines.push(`${indent}});`);
  lines.push('');

  if (trackSuccess) {
    // The flag is always declared by now: above, or earlier by chain code or
    // a hoist for debug hooks. Only the reset is emitted here.
    lines.push(`${indent}${safeId}_success = false;`);
    lines.push('');
  }

  lines.push(`${indent}try {`);
  const getCall = isAsync ? `await ${ctxVar}.getVariable` : `${ctxVar}.getVariable`;
  const setCall = isAsync ? `await ${ctxVar}.setVariable` : `${ctxVar}.setVariable`;
  const argNames = buildNodeArgumentsWithContext({
    node: branchNode,
    workflow,
    id: instanceId,
    lines,
    indent: `${indent}  `,
    getCall,
    isAsync,
    emitInputEvents: true,
    setCall,
    nodeTypeName: functionName,
    bundleMode,
    production,
    abortSignalExpression: `${ctxVar}.getAbortSignal()`,
    runtimeContextExpression: ctxVar,
  });
  const awaitKeyword = branchNode.isAsync ? 'await ' : '';

  emitNodeInvocation(
    { nodeType: branchNode, instanceId, safeId, functionName, resultVar, args: argNames, ctxVar, indent: `${indent}  `, lines },
    { setCall, isAsync, awaitKeyword, gateResultType: 'any', inlineStubAndCoercion: false },
  );
  lines.push(`${indent}  ${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${functionName}',`);
  lines.push(`${indent}    id: '${instanceId}',`);
  lines.push(`${indent}    executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}    status: 'SUCCEEDED',`);
  lines.push(`${indent}  });`);
  lines.push(`${indent}  ${ctxVar}.commitNode('${instanceId}', '${functionName}', ${safeId}Idx);`);
  // Debug controller: afterNode hook for branching nodes
  if (emitDebugHooks) {
    const awaitHook = isAsync ? 'await ' : '';
    lines.push(`${indent}  ${awaitHook}__ctrl__.afterNode('${instanceId}', ${ctxVar});`);
  }
  // Use onSuccess from result to determine control flow
  // For expression nodes, onSuccess is always true here (catch handles failure)
  if (trackSuccess) {
    lines.push(`${indent}  ${safeId}_success = ${branchNode.expression ? 'true' : `${resultVar}.onSuccess`};`);
  }
  lines.push(`${indent}} catch (error: unknown) {`);
  lines.push(`${indent}  if ((error as { code?: unknown })?.code === 'FLOW_WEAVER_DURABLE_GATE_YIELD') throw error;`);
  lines.push(`${indent}  const isCancellation = CancellationError.isCancellationError(error);`);
  lines.push(`${indent}  ${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${functionName}',`);
  lines.push(`${indent}    id: '${instanceId}',`);
  lines.push(`${indent}    executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}    status: isCancellation ? 'CANCELLED' : 'FAILED',`);
  lines.push(`${indent}  });`);
  lines.push(`${indent}  if (!isCancellation) {`);
  lines.push(`${indent}    ${ctxVar}.sendLogErrorEvent({`);
  lines.push(`${indent}      nodeTypeName: '${functionName}',`);
  lines.push(`${indent}      id: '${instanceId}',`);
  lines.push(`${indent}      executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}      error: error instanceof Error ? error.message : String(error),`);
  lines.push(
    `${indent}      code: typeof (error as { code?: unknown }).code === 'string' ? ((error as { code?: unknown }).code as string) : undefined,`,
  );
  lines.push(`${indent}    });`);
  lines.push(
    `${indent}    ${setCall}({ id: '${instanceId}', portName: 'onSuccess', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, false);`,
  );
  lines.push(
    `${indent}    ${setCall}({ id: '${instanceId}', portName: 'onFailure', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, true);`,
  );
  if (trackSuccess) {
    lines.push(`${indent}    ${safeId}_success = false;`);
  }
  lines.push(`${indent}  }`);
  // Emit CANCELLED for all downstream nodes since branching node threw
  if (region.successNodes.size > 0) {
    generateCancelledEventsForBranch(
      region.successNodes,
      workflow,
      allNodeTypes,
      lines,
      `${indent}  `,
      ctxVar,
      isAsync,
    );
  }
  if (region.failureNodes.size > 0) {
    generateCancelledEventsForBranch(
      region.failureNodes,
      workflow,
      allNodeTypes,
      lines,
      `${indent}  `,
      ctxVar,
      isAsync,
    );
  }
  // Re-throw the error to propagate it up (important for recursive workflows)
  lines.push(`${indent}  throw error;`);
  lines.push(`${indent}}`);
  lines.push(`${outerIndent}} else {`);
  if (trackSuccess) {
    const getPrefix = isAsync ? 'await ' : '';
    lines.push(
      `${outerIndent}  ${safeId}_success = ${getPrefix}${ctxVar}.getVariable({ id: '${instanceId}', portName: 'onSuccess', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }) as boolean;`,
    );
  }
  lines.push(`${outerIndent}}`);
  lines.push('');
}

/**
 * Emits `if (<id>_success) { success arm } else { failure arm }`. Each arm
 * enters and exits its branch frame and reports the other arm's nodes as
 * cancelled. With an empty failure arm the else only reports the success
 * arm cancelled; with both arms empty nothing is emitted by the caller.
 */
function emitBranchArms(branching: BranchingNodeEmission): void {
  const { instance, workflow, allNodeTypes, region, lines, indent, isAsync, ctxVar } = branching;
  const instanceId = instance.id;
  const safeId = toValidIdentifier(instanceId);
  const hasSuccessDownstream = region.successNodes.size > 0;
  const hasFailureDownstream = region.failureNodes.size > 0;

  lines.push(`${indent}if (${safeId}_success) {`);
  lines.push(`${indent}  ${ctxVar}.enterBranch('${instanceId}', ${safeId}Idx, 'success');`);
  // Emit CANCELLED for failure branch nodes since success path was taken
  if (hasFailureDownstream) {
    generateCancelledEventsForBranch(region.failureNodes, workflow, allNodeTypes, lines, `${indent}  `, ctxVar, isAsync);
  }
  emitBranchArmBody(branching, region.successNodes);

  // Only generate else block if there are failure nodes to execute
  if (hasFailureDownstream) {
    lines.push(`${indent}  ${ctxVar}.exitBranch();`);
    lines.push(`${indent}} else {`);
    lines.push(`${indent}  ${ctxVar}.enterBranch('${instanceId}', ${safeId}Idx, 'failure');`);
    // Emit CANCELLED for success branch nodes since failure path was taken
    if (hasSuccessDownstream) {
      generateCancelledEventsForBranch(region.successNodes, workflow, allNodeTypes, lines, `${indent}  `, ctxVar, isAsync);
    }
    emitBranchArmBody(branching, region.failureNodes);
    lines.push(`${indent}  ${ctxVar}.exitBranch();`);
    lines.push(`${indent}}`);
  } else if (hasSuccessDownstream) {
    // No failure branch - emit CANCELLED for success nodes and close
    lines.push(`${indent}  ${ctxVar}.exitBranch();`);
    lines.push(`${indent}} else {`);
    lines.push(`${indent}  ${ctxVar}.enterBranch('${instanceId}', ${safeId}Idx, 'failure');`);
    generateCancelledEventsForBranch(region.successNodes, workflow, allNodeTypes, lines, `${indent}  `, ctxVar, isAsync);
    lines.push(`${indent}  ${ctxVar}.exitBranch();`);
    lines.push(`${indent}}`);
  } else {
    lines.push(`${indent}  ${ctxVar}.exitBranch();`);
    lines.push(`${indent}}`);
  }
}

/**
 * Emits the nodes of one arm in topological order, one level deeper than
 * the branching node. A nested branching node recurses into
 * generateBranchingNodeCode, with its `_success` flag declared at this level
 * first so guards outside the nested block can still read it; any other node
 * runs without its execute guard, since the arm's if/else already decided it.
 */
function emitBranchArmBody(branching: BranchingNodeEmission, armNodes: Set<string>): void {
  const {
    workflow,
    allNodeTypes,
    generatedNodes,
    lines,
    indent,
    branchingNodes,
    branchRegions,
    isAsync,
    ctxVar,
    bundleMode,
    preDeclaredSuccessFlags,
    production,
  } = branching;
  // Sort branch nodes topologically to ensure correct execution order
  const armInstanceIds = sortBranchNodesTopologically(armNodes, workflow);

  armInstanceIds.forEach((instanceId) => {
    const inst = workflow.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
    const nodeType = allNodeTypes.find((nt) => nt.name === inst.nodeType || nt.functionName === inst.nodeType);
    if (!nodeType) return;

    if (branchingNodes.has(instanceId)) {
      const nestedRegion = branchRegions.get(instanceId)!;
      // Pre-declare nested branching node's _success flag at the current
      // scope so it remains accessible to downstream guards that may run
      // outside this branch block. (Fixes scoping bug where the flag was
      // declared inside a nested conditional but referenced at a higher scope.)
      const nestedSafeId = toValidIdentifier(instanceId);
      const nestedHasDownstream = nestedRegion.successNodes.size > 0 || nestedRegion.failureNodes.size > 0;
      const nestedPreDeclared = new Set(preDeclaredSuccessFlags);
      if (nestedHasDownstream && !nestedPreDeclared.has(nestedSafeId)) {
        lines.push(`${indent}  let ${nestedSafeId}_success = false;`);
        nestedPreDeclared.add(nestedSafeId);
      }
      generateBranchingNodeCode(
        inst,
        nodeType,
        workflow,
        allNodeTypes,
        nestedRegion,
        generatedNodes,
        lines,
        `${indent}  `,
        branchingNodes,
        branchRegions,
        isAsync,
        ctxVar,
        bundleMode,
        nestedPreDeclared,
        nestedPreDeclared.has(nestedSafeId), // force tracking if flag was pre-declared at higher scope
        production,
      );
    } else {
      generateNodeCallWithContext(
        inst,
        nodeType,
        workflow,
        lines,
        allNodeTypes,
        `${indent}  `,
        isAsync,
        false, // useConst
        undefined, // instanceParent
        ctxVar,
        bundleMode,
        true, // skipExecuteGuard — inside branch, execute is guaranteed by if/else
        branchingNodes,
        production,
      );
      generatedNodes.add(instanceId);
    }
  });
}

function generatePullNodeWithContext(
  instance: { id: string; nodeType: string },
  nodeType: TNodeTypeAST,
  workflow: TWorkflowAST,
  lines: string[],
  indent: string,
  isAsync: boolean,
  ctxVar: string = 'ctx', // Context variable name (for scoped contexts)
  bundleMode: boolean = false,
  production: boolean = false,
): void {
  const instanceId = instance.id;
  const safeId = toValidIdentifier(instanceId);
  const functionName = nodeType.functionName;

  // Executor must be async if:
  // 1. The workflow is async (context returns Promises)
  // 2. OR the node function is async (function returns Promise)
  // Sync executors only work when BOTH workflow and node are sync
  const executorIsAsync = isAsync || nodeType.isAsync;
  const asyncKeyword = executorIsAsync ? 'async ' : '';
  const awaitKeyword = nodeType.isAsync ? 'await ' : '';
  const awaitPrefix = executorIsAsync ? 'await ' : '';

  // Create a lazy execution function for this pull node
  // The function will only execute when its outputs are accessed
  lines.push(`${indent}// Pull execution node: ${instanceId}`);
  lines.push(`${indent}const ${safeId}_executor = ${asyncKeyword}() => {`);
  lines.push(`${indent}  if (${safeId}Idx !== undefined) {`);
  lines.push(`${indent}    return; // Already executed`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  ${ctxVar}.checkAborted('${instanceId}');`);
  lines.push(`${indent}  ${safeId}Idx = ${ctxVar}.addExecution('${instanceId}');`);
  lines.push(`${indent}  if (!${ctxVar}.shouldExecute('${instanceId}', '${functionName}', ${safeId}Idx)) return;`);
  lines.push(`${indent}  ${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${functionName}',`);
  lines.push(`${indent}    id: '${instanceId}',`);
  lines.push(`${indent}    executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}    status: 'RUNNING',`);
  lines.push(`${indent}  });`);
  lines.push(`${indent}  try {`);

  // Use executor's async status for get/set calls within the executor
  const getCall = executorIsAsync ? `await ${ctxVar}.getVariable` : `${ctxVar}.getVariable`;
  const setCall = executorIsAsync ? `await ${ctxVar}.setVariable` : `${ctxVar}.setVariable`;
  const args = buildNodeArgumentsWithContext({
    node: nodeType,
    workflow,
    id: instanceId,
    lines,
    indent: `${indent}    `,
    getCall,
    isAsync: executorIsAsync,
    emitInputEvents: true,
    setCall,
    nodeTypeName: functionName,
    bundleMode,
    production,
    abortSignalExpression: `${ctxVar}.getAbortSignal()`,
    runtimeContextExpression: ctxVar,
  });

  const resultVar = nodeResultVar(safeId, functionName);
  const call = { nodeType, instanceId, safeId, functionName, resultVar, args, ctxVar, indent: `${indent}    `, lines };
  // A pull executor has no expression case: every node is called for its
  // result object. onSuccess and onFailure are not stored here.
  if (!emitDurableNodeCall(call, 'any')) {
    emitPlainNodeCall(call, executorIsAsync, awaitKeyword);
  }
  emitResultOutputs(call, setCall, (portName) => isSuccessPort(portName) || isFailurePort(portName));

  lines.push(`${indent}    ${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}      nodeTypeName: '${functionName}',`);
  lines.push(`${indent}      id: '${instanceId}',`);
  lines.push(`${indent}      executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}      status: 'SUCCEEDED',`);
  lines.push(`${indent}    });`);
  lines.push(`${indent}    ${ctxVar}.commitNode('${instanceId}', '${functionName}', ${safeId}Idx);`);
  lines.push(`${indent}  } catch (error: unknown) {`);
  lines.push(`${indent}    if ((error as { code?: unknown })?.code === 'FLOW_WEAVER_DURABLE_GATE_YIELD') throw error;`);
  lines.push(`${indent}    const isCancellation = CancellationError.isCancellationError(error);`);
  lines.push(`${indent}    ${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}      nodeTypeName: '${functionName}',`);
  lines.push(`${indent}      id: '${instanceId}',`);
  lines.push(`${indent}      executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}      status: isCancellation ? 'CANCELLED' : 'FAILED',`);
  lines.push(`${indent}    });`);
  lines.push(`${indent}    if (!isCancellation) {`);
  lines.push(`${indent}      ${ctxVar}.sendLogErrorEvent({`);
  lines.push(`${indent}        nodeTypeName: '${functionName}',`);
  lines.push(`${indent}        id: '${instanceId}',`);
  lines.push(`${indent}        executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}        error: error instanceof Error ? error.message : String(error),`);
  lines.push(
    `${indent}        code: typeof (error as { code?: unknown }).code === 'string' ? ((error as { code?: unknown }).code as string) : undefined,`,
  );
  lines.push(`${indent}      });`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    throw error;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}};`);
  lines.push(`${indent}// Register lazy executor for pull node`);
  lines.push(`${indent}${ctxVar}.registerPullExecutor('${instanceId}', ${safeId}_executor);`);
  lines.push(``);
}

function generateNodeCallWithContext(
  instance: { id: string; nodeType: string },
  nodeType: TNodeTypeAST,
  workflow: TWorkflowAST,
  lines: string[],
  _allNodeTypes: TNodeTypeAST[],
  indent: string,
  isAsync: boolean,
  useConst: boolean = false, // Use const for nodes that always execute (not in branches)
  instanceParent?: string, // Parent node ID for scope children (parent is const, no ! needed)
  ctxVar: string = 'ctx', // Context variable name (for scoped contexts)
  bundleMode: boolean = false, // Bundle mode uses params object pattern for wrapper functions
  skipExecuteGuard: boolean = false, // Skip execute port STEP guard (for nodes inside branch blocks)
  branchingNodes: Set<string> = new Set(), // Branching nodes set for port-aware STEP guards
  production: boolean = false, // When false, emit debug controller hooks (beforeNode/afterNode)
): void {
  const instanceId = instance.id;
  const safeId = toValidIdentifier(instanceId);
  const functionName = nodeType.functionName;

  // Check if this instance has pull execution enabled
  const fullInstance = workflow.instances.find((i) => i.id === instanceId);
  const pullConfig = fullInstance
    ? getPullExecutionConfig(fullInstance, nodeType)
    : { enabled: false, triggerPort: 'execute' };

  // If this is a pull execution node, wrap it in a lazy function
  if (pullConfig.enabled) {
    generatePullNodeWithContext(instance, nodeType, workflow, lines, indent, isAsync, ctxVar, bundleMode, production);
    return;
  }
  const stepInputs: [string, { dataType: string }][] = Object.entries(nodeType.inputs).filter(
    ([portName, portConfig]) => {
      // Include the primary execute port for promoted nodes (useConst=false at top level)
      // so they get a STEP guard from their conditional source.
      // Skip execute guard for nodes inside branch blocks (execute is guaranteed by if/else).
      if (isExecutePort(portName) && !useConst && !skipExecuteGuard) {
        return portConfig.dataType === 'STEP';
      }
      return portConfig.dataType === 'STEP' && !isExecutePort(portName);
    },
  );
  // Expression nodes don't declare 'execute' in their inputs, but the workflow
  // connects STEP signals to their execute port. Include it for promoted expression
  // nodes so they get a proper branch-aware STEP guard.
  if (nodeType.expression && !useConst && !skipExecuteGuard && !stepInputs.some(([p]) => isExecutePort(p))) {
    const hasExecuteConnection = workflow.connections.some(
      (conn) => conn.to.node === instanceId && isExecutePort(conn.to.port),
    );
    if (hasExecuteConnection) {
      stepInputs.push(['execute', { dataType: 'STEP' }]);
    }
  }
  const stepSignalSources: string[] = [];
  if (stepInputs.length > 0) {
    workflow.connections.forEach((conn) => {
      const toNode = conn.to.node;
      const toPort = conn.to.port;
      if (toNode === instanceId && stepInputs.some(([port]) => port === toPort)) {
        const sourceNode = conn.from.node;
        // Skip per-port scoped children - they don't have Idx in main scope
        const sourceInstance = workflow.instances.find((i) => i.id === sourceNode);
        if (sourceInstance && isPerPortScopedChild(sourceInstance, workflow, _allNodeTypes)) {
          return;
        }
        if (!isStartNode(sourceNode) && !stepSignalSources.includes(sourceNode)) {
          stepSignalSources.push(sourceNode);
        }
      }
    });
  }
  let shouldIndent = false;
  if (stepSignalSources.length > 0) {
    const conditions: string[] = [];
    const portToSources = new Map<string, { node: string; port: string }[]>();
    stepInputs.forEach(([portName]) => {
      const sources: { node: string; port: string }[] = [];
      workflow.connections.forEach((conn) => {
        const toNode = conn.to.node;
        const toPort = conn.to.port;
        if (toNode === instanceId && toPort === portName) {
          const sourceNode = conn.from.node;
          if (!isStartNode(sourceNode)) {
            // Skip per-port scoped children - they don't have Idx in main scope
            const sourceInstance = workflow.instances.find((i) => i.id === sourceNode);
            if (sourceInstance && isPerPortScopedChild(sourceInstance, workflow, _allNodeTypes)) {
              return;
            }
            sources.push({ node: sourceNode, port: conn.from.port });
          }
        }
      });
      if (sources.length > 0) {
        portToSources.set(portName, sources);
      }
    });

    if (nodeType.executeWhen === EXECUTION_STRATEGIES.CONJUNCTION) {
      // CONJUNCTION: Execute when ALL input ports have data (AND logic)
      portToSources.forEach((sources, _portName) => {
        if (sources.length === 1) {
          conditions.push(buildStepSourceCondition(sources[0].node, sources[0].port, branchingNodes));
        } else {
          const orCondition = sources.map((s) => buildStepSourceCondition(s.node, s.port, branchingNodes)).join(' || ');
          conditions.push(`(${orCondition})`);
        }
      });
      if (conditions.length > 0) {
        const fullCondition = conditions.join(' && ');
        lines.push(`${indent}if (${fullCondition}) {`);
        indent = `${indent}  `;
        shouldIndent = true;
      }
    } else if (nodeType.executeWhen === EXECUTION_STRATEGIES.DISJUNCTION) {
      // DISJUNCTION: Execute when ANY input port has data (OR logic)
      const allSources: { node: string; port: string }[] = [];
      portToSources.forEach((sources) => {
        sources.forEach((source) => {
          if (!allSources.some((s) => s.node === source.node && s.port === source.port)) {
            allSources.push(source);
          }
        });
      });
      if (allSources.length > 0) {
        const fullCondition = allSources
          .map((s) => buildStepSourceCondition(s.node, s.port, branchingNodes))
          .join(' || ');
        lines.push(`${indent}if (${fullCondition}) {`);
        indent = `${indent}  `;
        shouldIndent = true;
      }
    } else if (nodeType.executeWhen === EXECUTION_STRATEGIES.CUSTOM) {
      // CUSTOM: User-provided execution condition
      // Custom condition should be in nodeType.metadata.customExecuteCondition
      const customCondition = nodeType.metadata?.customExecuteCondition;
      if (customCondition && typeof customCondition === 'string') {
        lines.push(`${indent}if (${customCondition}) {`);
        indent = `${indent}  `;
        shouldIndent = true;
      } else {
        // Fallback to CONJUNCTION if no custom condition provided
        portToSources.forEach((sources, _portName) => {
          if (sources.length === 1) {
            conditions.push(buildStepSourceCondition(sources[0].node, sources[0].port, branchingNodes));
          } else {
            const orCondition = sources
              .map((s) => buildStepSourceCondition(s.node, s.port, branchingNodes))
              .join(' || ');
            conditions.push(`(${orCondition})`);
          }
        });
        if (conditions.length > 0) {
          const fullCondition = conditions.join(' && ');
          lines.push(`${indent}if (${fullCondition}) {`);
          indent = `${indent}  `;
          shouldIndent = true;
        }
      }
    }
  }
  // Live debugging may pause, but cannot skip a durable execution boundary.
  const emitDebugHooks = !production;
  if (emitDebugHooks) {
    const awaitHook = isAsync ? 'await ' : '';
    lines.push(`${indent}${awaitHook}__ctrl__.beforeNode('${instanceId}', ${ctxVar});`);
  }

  const outerIndent = indent;
  const varDecl = useConst ? 'const ' : '';
  const awaitPrefix = isAsync ? 'await ' : '';
  lines.push(`${indent}${ctxVar}.checkAborted('${instanceId}');`);
  lines.push(`${indent}${varDecl}${safeId}Idx = ${ctxVar}.addExecution('${instanceId}');`);
  lines.push(`${indent}if (${ctxVar}.shouldExecute('${instanceId}', '${functionName}', ${safeId}Idx)) {`);
  indent = `${indent}  `;
  lines.push(`${indent}${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}  nodeTypeName: '${functionName}',`);
  lines.push(`${indent}  id: '${instanceId}',`);
  lines.push(`${indent}  executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}  status: 'RUNNING',`);
  lines.push(`${indent}});`);
  lines.push(`${indent}try {`);
  const getCall = isAsync ? `await ${ctxVar}.getVariable` : `${ctxVar}.getVariable`;
  const setCall = isAsync ? `await ${ctxVar}.setVariable` : `${ctxVar}.setVariable`;
  const args = buildNodeArgumentsWithContext({
    node: nodeType,
    workflow,
    id: instanceId,
    lines,
    indent: `${indent}  `,
    getCall,
    isAsync,
    instanceParent,
    emitInputEvents: true,
    setCall,
    nodeTypeName: functionName,
    bundleMode,
    production,
    abortSignalExpression: `${ctxVar}.getAbortSignal()`,
  });
  const resultVar = nodeResultVar(safeId, functionName);
  const awaitKeyword = nodeType.isAsync ? 'await ' : '';

  emitNodeInvocation(
    { nodeType, instanceId, safeId, functionName, resultVar, args, ctxVar, indent: `${indent}  `, lines },
    { setCall, isAsync, awaitKeyword, gateResultType: 'Record<string, unknown>', inlineStubAndCoercion: true },
  );
  lines.push(`${indent}  ${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${functionName}',`);
  lines.push(`${indent}    id: '${instanceId}',`);
  lines.push(`${indent}    executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}    status: 'SUCCEEDED',`);
  lines.push(`${indent}  });`);
  lines.push(`${indent}  ${ctxVar}.commitNode('${instanceId}', '${functionName}', ${safeId}Idx);`);
  // Debug controller: live step pause.
  if (emitDebugHooks) {
    const awaitHook = isAsync ? 'await ' : '';
    lines.push(`${indent}  ${awaitHook}__ctrl__.afterNode('${instanceId}', ${ctxVar});`);
  }
  lines.push(`${indent}} catch (error: unknown) {`);
  lines.push(`${indent}  if ((error as { code?: unknown })?.code === 'FLOW_WEAVER_DURABLE_GATE_YIELD') throw error;`);
  lines.push(`${indent}  const isCancellation = CancellationError.isCancellationError(error);`);
  lines.push(`${indent}  ${awaitPrefix}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${functionName}',`);
  lines.push(`${indent}    id: '${instanceId}',`);
  lines.push(`${indent}    executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}    status: isCancellation ? 'CANCELLED' : 'FAILED',`);
  lines.push(`${indent}  });`);
  lines.push(`${indent}  if (!isCancellation) {`);
  lines.push(`${indent}    ${ctxVar}.sendLogErrorEvent({`);
  lines.push(`${indent}      nodeTypeName: '${functionName}',`);
  lines.push(`${indent}      id: '${instanceId}',`);
  lines.push(`${indent}      executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}      error: error instanceof Error ? error.message : String(error),`);
  lines.push(
    `${indent}      code: typeof (error as { code?: unknown }).code === 'string' ? ((error as { code?: unknown }).code as string) : undefined,`,
  );
  lines.push(`${indent}    });`);
  if (nodeType.expression) {
    // Expression node: auto-set failure flags in catch block
    lines.push(
      `${indent}    ${setCall}({ id: '${instanceId}', portName: 'onSuccess', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, false);`,
    );
    lines.push(
      `${indent}    ${setCall}({ id: '${instanceId}', portName: 'onFailure', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, true);`,
    );
  }
  lines.push(`${indent}  }`);
  lines.push(`${indent}  throw error;`);
  lines.push(`${indent}}`);
  lines.push(`${outerIndent}}`);
  if (shouldIndent) {
    const originalIndent = outerIndent.slice(0, -2);
    lines.push(`${originalIndent}}`);
  }
}
