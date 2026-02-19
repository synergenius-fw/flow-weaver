import type { TNodeTypeAST, TWorkflowAST, TNodeInstanceAST } from '../ast/types';
import { extractStartPorts } from '../ast/workflow-utils';
import { mapToTypeScript } from '../type-mappings';
import { buildNodeArgumentsWithContext, toValidIdentifier } from './code-utils';
import {
  buildControlFlowGraph,
  detectBranchingChains,
  findAllBranchingNodes,
  findNodesInBranch,
  performKahnsTopologicalSort,
  isPerPortScopedChild,
} from './control-flow';
import {
  RESERVED_NODE_NAMES,
  RESERVED_PORT_NAMES,
  EXECUTION_STRATEGIES,
  isStartNode,
  isExitNode,
  isExecutePort,
  isSuccessPort,
  isFailurePort,
} from '../constants';

/**
 * Helper: Determine if an instance has pull execution enabled
 * Checks instance config first, then falls back to node type default config
 * Returns { enabled: boolean, triggerPort: string }
 */
function getPullExecutionConfig(
  instance: TNodeInstanceAST,
  nodeType: TNodeTypeAST
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
 * Generates executable TypeScript code from a workflow AST using ExecutionContext for state management.
 *
 * This is the main code generation function that transforms a visual workflow into runnable code.
 *
 * ## Algorithm Overview:
 * 1. **Setup Phase**: Initialize ExecutionContext, set recursion depth protection
 * 2. **Start Node**: Store workflow parameters as Start node outputs
 * 3. **Control Flow Graph**: Build CFG from connections, perform topological sort
 * 4. **Branch Detection**: Identify branching nodes (with onSuccess/onFailure) and their regions
 * 5. **Code Generation**: For each node in execution order:
 *    - Regular nodes: Generate direct execution with variable storage
 *    - Branching nodes: Generate if/else blocks for success/failure paths
 *    - Scoped children: Generate scope function closures (for forEach, etc.)
 *    - Pull nodes: Generate lazy executors registered with context
 * 6. **Exit Node**: Collect outputs and return result object
 *
 * ## Key Concepts:
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
  bundleMode: boolean = false
): string {
  const lines: string[] = [];

  // In development mode, determine effective debugger (from parameter or environment)
  if (!production) {
    lines.push(`  // Use passed debugger or auto-detect from environment variable`);
    lines.push(`  const __effectiveDebugger__ = (`);
    lines.push(`    typeof __flowWeaverDebugger__ !== 'undefined' ? __flowWeaverDebugger__ :`);
    lines.push(`    typeof process !== 'undefined' && process.env.FLOW_WEAVER_DEBUG`);
    lines.push(
      `      ? createFlowWeaverDebugClient(process.env.FLOW_WEAVER_DEBUG, '${workflow.functionName}')`
    );
    lines.push(`      : undefined`);
    lines.push(`  );`);
    lines.push('');
  }

  // Recursion depth protection: prevent infinite recursion in workflows
  lines.push(`  // Recursion depth protection`);
  lines.push(`  const __rd__ = (params as { __rd__?: number }).__rd__ ?? 0;`);
  lines.push(`  if (__rd__ >= 1000) {`);
  lines.push(
    `    throw new Error('Max recursion depth exceeded (1000) in workflow "${workflow.functionName}"');`
  );
  lines.push(`  }`);
  lines.push('');

  // In development mode, pass the effective debugger (from parameter or environment)
  // In production mode, omit the debugger parameter
  // Always pass abort signal for cancellation support
  const asyncArg = isAsync ? 'true' : 'false';
  if (production) {
    lines.push(`  const ctx = new GeneratedExecutionContext(${asyncArg}, __abortSignal__);`);
  } else {
    lines.push(
      `  const ctx = new GeneratedExecutionContext(${asyncArg}, __effectiveDebugger__, __abortSignal__);`
    );
  }
  lines.push('');
  lines.push(`  const startIdx = ctx.addExecution('${RESERVED_NODE_NAMES.START}');`);
  Object.keys(extractStartPorts(workflow)).forEach((portName) => {
    const setCall = isAsync ? `await ctx.setVariable` : `ctx.setVariable`;
    // STEP Port Architecture: execute comes from workflow parameter, data from params object
    const valueSource = isExecutePort(portName) ? 'execute' : `params.${portName}`;
    lines.push(
      `  ${setCall}({ id: '${RESERVED_NODE_NAMES.START}', portName: '${portName}', executionIndex: startIdx, nodeTypeName: '${RESERVED_NODE_NAMES.START}' }, ${valueSource});`
    );
  });
  lines.push(`  ctx.sendStatusChangedEvent({`);
  lines.push(`    nodeTypeName: '${RESERVED_NODE_NAMES.START}',`);
  lines.push(`    id: '${RESERVED_NODE_NAMES.START}',`);
  lines.push(`    executionIndex: startIdx,`);
  lines.push(`    status: 'SUCCEEDED',`);
  lines.push(`  });`);
  lines.push('');
  const cfg = buildControlFlowGraph(workflow, nodeTypes);
  const executionOrder = performKahnsTopologicalSort(cfg); // Now returns instance IDs
  const branchingNodes = findAllBranchingNodes(workflow, nodeTypes);
  const allInstanceIds = new Set(workflow.instances.map((i) => i.id));
  const branchRegions = new Map<string, { successNodes: Set<string>; failureNodes: Set<string> }>();
  branchingNodes.forEach((branchInstanceId) => {
    const successNodes = findNodesInBranch(
      branchInstanceId,
      RESERVED_PORT_NAMES.ON_SUCCESS,
      workflow,
      allInstanceIds,
      branchingNodes,
      nodeTypes
    );
    const failureNodes = findNodesInBranch(
      branchInstanceId,
      RESERVED_PORT_NAMES.ON_FAILURE,
      workflow,
      allInstanceIds,
      branchingNodes,
      nodeTypes
    );
    branchRegions.set(branchInstanceId, { successNodes, failureNodes });
  });

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
  workflow.instances.forEach((instance) => {
    if (instance.parent && !isPerPortScopedChild(instance, workflow, nodeTypes)) {
      nodeLevelScopedChildren.add(instance.id);
    }
  });

  // Create execution index variables only for nodes that need undefined checking
  // Skip per-port scoped children (they're in scope functions)
  let hasLetDeclarations = false;
  workflow.instances.forEach((instance) => {
    if (!isPerPortScopedChild(instance, workflow, nodeTypes)) {
      // Nodes in branches, branching nodes, pull nodes, or scoped children need let
      if (
        nodesInBranches.has(instance.id) ||
        branchingNodes.has(instance.id) ||
        pullExecutionNodes.has(instance.id) ||
        nodeLevelScopedChildren.has(instance.id)
      ) {
        lines.push(`  let ${toValidIdentifier(instance.id)}Idx: number | undefined;`);
        hasLetDeclarations = true;
      }
    }
  });
  if (hasLetDeclarations) {
    lines.push('');
  }
  const instancesInMultipleBranches = new Set<string>();
  allInstanceIds.forEach((instanceId) => {
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
  branchRegions.forEach((region, _branchNode) => {
    instancesInMultipleBranches.forEach((instanceId) => {
      region.successNodes.delete(instanceId);
      region.failureNodes.delete(instanceId);
    });
  });

  // Promote nodes that have DATA dependencies on nodes outside their branch.
  // Without this, STEP-nesting places the node before its data providers are generated.
  const nodesPromotedFromBranches = new Set<string>();
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
        nodesPromotedFromBranches.add(nodeId);
      }
    });
  });

  // Remove promoted nodes from branch regions (they'll generate at top level)
  branchRegions.forEach((region) => {
    nodesPromotedFromBranches.forEach((nodeId) => {
      region.successNodes.delete(nodeId);
      region.failureNodes.delete(nodeId);
    });
  });

  // Identify branching nodes whose _success flag must be tracked because
  // promoted nodes depend on their onSuccess/onFailure ports for STEP guards.
  const branchingNodesNeedingSuccessFlag = new Set<string>();
  nodesPromotedFromBranches.forEach((promotedNodeId) => {
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
  const branchingChains = detectBranchingChains(branchingNodes, branchRegions);
  const chainMembers = new Set<string>();
  branchingChains.forEach((chain) => {
    // All non-head nodes are chain members (skip in main loop)
    for (let i = 1; i < chain.length; i++) {
      chainMembers.add(chain[i]);
    }
  });

  const generatedNodes = new Set<string>();
  const availableVars = new Map<string, string>();
  Object.keys(extractStartPorts(workflow)).forEach((portName) => {
    availableVars.set(`${RESERVED_NODE_NAMES.START}.${portName}`, `params.${portName}`);
  });
  executionOrder.forEach((instanceId) => {
    if (isStartNode(instanceId) || isExitNode(instanceId) || generatedNodes.has(instanceId)) {
      return;
    }
    // Find the instance and its node type
    const instance = workflow.instances.find((i) => i.id === instanceId);
    if (!instance) {
      lines.push(`  // Node '${instanceId}' skipped: instance not found in workflow`);
      return;
    }
    // Skip per-port scoped children (they're in scope functions)
    // Include node-level scoped children (they're in scope blocks)
    if (isPerPortScopedChild(instance, workflow, nodeTypes)) {
      return;
    }
    // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
    const nodeType = nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
    if (!nodeType) {
      lines.push(`  // Node '${instance.id}' skipped: type '${instance.nodeType}' not found`);
      return;
    }
    if (branchingNodes.has(instanceId)) {
      // Chain members are generated by their chain head — skip
      if (chainMembers.has(instanceId)) {
        return;
      }

      // Chain heads: use flat chain generation
      if (branchingChains.has(instanceId)) {
        // For promoted chain heads, wrap in STEP guard
        let chainIndent = '  ';
        let chainNeedsClose = false;
        if (nodesPromotedFromBranches.has(instanceId)) {
          const stepSourceConditions: string[] = [];
          workflow.connections.forEach((conn) => {
            if (conn.to.node === instanceId && isExecutePort(conn.to.port)) {
              const src = conn.from.node;
              if (!isStartNode(src)) {
                stepSourceConditions.push(buildStepSourceCondition(src, conn.from.port, branchingNodes));
              }
            }
          });
          if (stepSourceConditions.length > 0) {
            const condition = stepSourceConditions.join(' && ');
            lines.push(`  if (${condition}) {`);
            chainIndent = '    ';
            chainNeedsClose = true;
          }
        }
        generateBranchingChainCode(
          branchingChains.get(instanceId)!,
          workflow,
          nodeTypes,
          branchingNodes,
          branchRegions,
          availableVars,
          generatedNodes,
          lines,
          chainIndent,
          isAsync,
          'ctx',
          bundleMode,
          branchingNodesNeedingSuccessFlag
        );
        if (chainNeedsClose) {
          lines.push(`  }`);
        }
        return;
      }

      // Non-chain branching nodes: existing path
      // For promoted branching nodes, wrap in STEP guard from execute port source
      let branchIndent = '  ';
      let branchNeedsClose = false;
      if (nodesPromotedFromBranches.has(instanceId)) {
        const stepSourceConditions: string[] = [];
        workflow.connections.forEach((conn) => {
          if (conn.to.node === instanceId && isExecutePort(conn.to.port)) {
            const src = conn.from.node;
            if (!isStartNode(src)) {
              stepSourceConditions.push(buildStepSourceCondition(src, conn.from.port, branchingNodes));
            }
          }
        });
        if (stepSourceConditions.length > 0) {
          const condition = stepSourceConditions.join(' && ');
          lines.push(`  if (${condition}) {`);
          branchIndent = '    ';
          branchNeedsClose = true;
        }
      }
      generateBranchingNodeCode(
        instance,
        nodeType,
        workflow,
        nodeTypes,
        branchRegions.get(instanceId)!,
        availableVars,
        generatedNodes,
        lines,
        branchIndent,
        false,
        branchingNodes,
        branchRegions,
        isAsync,
        'ctx',
        bundleMode,
        new Set(),
        branchingNodesNeedingSuccessFlag.has(instanceId)
      );
      if (branchNeedsClose) {
        lines.push(`  }`);
      }
      const region = branchRegions.get(instanceId)!;
      region.successNodes.forEach((n) => generatedNodes.add(n));
      region.failureNodes.forEach((n) => generatedNodes.add(n));

      // Check if this node creates a scope and generate scoped children
      generateScopedChildrenExecution(
        instance,
        nodeType,
        workflow,
        nodeTypes,
        generatedNodes,
        availableVars,
        lines,
        '  ',
        branchingNodes,
        branchRegions,
        isAsync,
        bundleMode
      );
    } else {
      const belongsToBranch = Array.from(branchRegions.values()).some(
        (region) => region.successNodes.has(instanceId) || region.failureNodes.has(instanceId)
      );
      if (!belongsToBranch) {
        const nodeUseConst =
          !nodesInBranches.has(instanceId) &&
          !branchingNodes.has(instanceId) &&
          !pullExecutionNodes.has(instanceId) &&
          !nodeLevelScopedChildren.has(instanceId);
        generateNodeCallWithContext(
          instance,
          nodeType,
          workflow,
          availableVars,
          lines,
          nodeTypes,
          '  ',
          isAsync,
          nodeUseConst,
          undefined, // instanceParent
          'ctx', // ctxVar
          bundleMode,
          false, // skipExecuteGuard
          branchingNodes // for port-aware STEP guards
        );
        generatedNodes.add(instanceId);

        // Check if this node creates a scope and generate scoped children
        generateScopedChildrenExecution(
          instance,
          nodeType,
          workflow,
          nodeTypes,
          generatedNodes,
          availableVars,
          lines,
          '  ',
          branchingNodes,
          branchRegions,
          isAsync,
          bundleMode
        );
      }
    }
  });
  lines.push(`  const exitIdx = ctx.addExecution('${RESERVED_NODE_NAMES.EXIT}');`);
  const exitConnections = workflow.connections.filter((conn) => isExitNode(conn.to.node));
  // Group exit connections by port (multiple connections to the same port are coalesced)
  const exitConnectionsByPort = new Map<string, (typeof exitConnections)[0][]>();
  exitConnections.forEach((conn) => {
    const existing = exitConnectionsByPort.get(conn.to.port) || [];
    existing.push(conn);
    exitConnectionsByPort.set(conn.to.port, existing);
  });
  const returnProps: string[] = [];
  const awaitKeyword = isAsync ? 'await ' : '';
  const setCall = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';

  exitConnectionsByPort.forEach((conns, exitPort) => {
    // Get exit port type for type casting - check if exit port is declared
    const exitPortDef = workflow.exitPorts[exitPort];

    // Skip connections to undeclared exit ports (typos like Exit.resultx when only @returns result exists)
    if (!exitPortDef) {
      lines.push(`  // Exit connection skipped: '${exitPort}' is not a declared @returns port`);
      return;
    }

    const varName = `exit_${exitPort}`;
    const exitPortType =
      exitPortDef?.tsType || (exitPortDef ? mapToTypeScript(exitPortDef.dataType) : 'unknown');

    // Filter to valid connections (skip undeclared nodes, missing types)
    const validConns = conns.filter((conn) => {
      const sourceNode = conn.from.node;
      const sourceInstance = workflow.instances.find((i) => i.id === sourceNode);
      const sourceNodeType = nodeTypes.find((n) => n.name === sourceInstance?.nodeType || n.functionName === sourceInstance?.nodeType);

      if (!isStartNode(sourceNode) && !sourceInstance) {
        lines.push(`  // Exit connection skipped: source node '${sourceNode}' is not declared`);
        return false;
      }
      if (!isStartNode(sourceNode) && sourceInstance && !sourceNodeType) {
        lines.push(`  // Exit connection skipped: source node '${sourceNode}' has missing type '${sourceInstance.nodeType}'`);
        return false;
      }
      return true;
    });

    if (validConns.length === 0) {
      lines.push(`  const ${varName} = undefined as unknown;`);
      returnProps.push(`${exitPort}: ${varName} as ${exitPortType}`);
      return;
    }

    // Helper to build a value expression for a single connection
    const buildSourceExpr = (conn: (typeof exitConnections)[0], defaultValue: string): string => {
      const sourceNode = conn.from.node;
      const sourcePort = conn.from.port;
      const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
      const sourceInstance = workflow.instances.find((i) => i.id === sourceNode);
      const sourceNodeType = nodeTypes.find((n) => n.name === sourceInstance?.nodeType || n.functionName === sourceInstance?.nodeType);
      const pullConfig =
        sourceInstance && sourceNodeType
          ? getPullExecutionConfig(sourceInstance, sourceNodeType)
          : { enabled: false, triggerPort: 'execute' };
      const isPullNode = pullConfig.enabled;

      const needsUndefinedCheck =
        !isStartNode(sourceNode) &&
        (nodesInBranches.has(sourceNode) ||
          branchingNodes.has(sourceNode) ||
          pullExecutionNodes.has(sourceNode) ||
          nodeLevelScopedChildren.has(sourceNode));

      if (isPullNode) {
        return `${awaitKeyword}ctx.getVariable({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}!, nodeTypeName: '${sourceNode}' })`;
      } else if (needsUndefinedCheck) {
        return `${sourceIdx} !== undefined ? ${awaitKeyword}ctx.getVariable({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx} }) : ${defaultValue}`;
      } else {
        return `${awaitKeyword}ctx.getVariable({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx} })`;
      }
    };

    const isControlFlowPort = exitPort === 'onSuccess' || exitPort === 'onFailure';
    const defaultValue = isControlFlowPort ? 'false' : 'undefined';

    if (validConns.length === 1) {
      // Single connection - straightforward assignment
      lines.push(`  const ${varName} = ${buildSourceExpr(validConns[0], defaultValue)};`);
    } else {
      // Multiple connections - coalesce with || (STEP ports) or ?? (data ports)
      const operator = isControlFlowPort ? ' || ' : ' ?? ';
      const parts = validConns.map((conn) => `(${buildSourceExpr(conn, defaultValue)})`);
      lines.push(`  const ${varName} = ${parts.join(operator)};`);
    }

    // Emit VARIABLE_SET for Exit node INPUT ports
    if (!production) {
      lines.push(
        `  ${setCall}({ id: '${RESERVED_NODE_NAMES.EXIT}', portName: '${exitPort}', executionIndex: exitIdx, nodeTypeName: '${RESERVED_NODE_NAMES.EXIT}' }, ${varName});`
      );
    }
    // Cast to the exit port's declared type for type safety
    returnProps.push(`${exitPort}: ${varName} as ${exitPortType}`);
  });

  // Add default undefined for declared exit ports that weren't connected
  // (e.g., when connection had typo like Exit.resultx instead of Exit.result)
  const connectedExitPorts = new Set(returnProps.map((prop) => prop.split(':')[0]));
  Object.entries(workflow.exitPorts).forEach(([portName, portDef]) => {
    if (!connectedExitPorts.has(portName) && portName !== 'onSuccess' && portName !== 'onFailure') {
      const portType = portDef?.tsType || (portDef ? mapToTypeScript(portDef.dataType) : 'unknown');
      lines.push(`  // Exit port '${portName}' has no valid connection - using undefined`);
      returnProps.push(`${portName}: undefined as unknown as ${portType}`);
    }
  });

  lines.push('');
  // Check if onSuccess/onFailure are explicitly connected
  const hasOnSuccess = returnProps.some((prop) => prop.startsWith('onSuccess:'));
  const hasOnFailure = returnProps.some((prop) => prop.startsWith('onFailure:'));

  // Only add defaults if not explicitly connected
  const defaults = [];
  const setCallForDefaults = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';
  if (!hasOnSuccess) {
    defaults.push('onSuccess: true');
    // Emit VARIABLE_SET for default onSuccess
    if (!production) {
      lines.push(
        `  ${setCallForDefaults}({ id: '${RESERVED_NODE_NAMES.EXIT}', portName: 'onSuccess', executionIndex: exitIdx, nodeTypeName: '${RESERVED_NODE_NAMES.EXIT}' }, true);`
      );
    }
  }
  if (!hasOnFailure) {
    defaults.push('onFailure: false');
    // Emit VARIABLE_SET for default onFailure
    if (!production) {
      lines.push(
        `  ${setCallForDefaults}({ id: '${RESERVED_NODE_NAMES.EXIT}', portName: 'onFailure', executionIndex: exitIdx, nodeTypeName: '${RESERVED_NODE_NAMES.EXIT}' }, false);`
      );
    }
  }

  const allProps =
    defaults.length > 0
      ? `${defaults.join(', ')}${returnProps.length > 0 ? ', ' : ''}${returnProps.join(', ')}`
      : returnProps.join(', ');

  lines.push(`  const finalResult = { ${allProps} };`);
  lines.push('');
  lines.push(`  ctx.sendStatusChangedEvent({`);
  lines.push(`    nodeTypeName: '${RESERVED_NODE_NAMES.EXIT}',`);
  lines.push(`    id: '${RESERVED_NODE_NAMES.EXIT}',`);
  lines.push(`    executionIndex: exitIdx,`);
  lines.push(`    status: 'SUCCEEDED',`);
  lines.push(`  });`);
  lines.push(`  ctx.sendWorkflowCompletedEvent({`);
  lines.push(`    executionIndex: exitIdx,`);
  lines.push(`    status: 'SUCCEEDED',`);
  lines.push(`    result: finalResult,`);
  lines.push(`  });`);
  lines.push('');
  lines.push(`  return finalResult;`);
  return lines.join('\n');
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
  availableVars: Map<string, string>,
  lines: string[],
  indent: string,
  branchingNodes: Set<string>,
  branchRegions: Map<string, { successNodes: Set<string>; failureNodes: Set<string> }>,
  isAsync: boolean,
  bundleMode: boolean = false
): void {
  // Check if this node creates a scope
  if (!parentNodeType.scope) return;

  // Check if this is a per-port scope (has scoped OUTPUT ports)
  // Per-port scopes have children handled inside the scope function closure generated by
  // buildNodeArgumentsWithContext -> generateScopeFunctionClosure, so we skip here
  const rawScopeName = parentNodeType.scope;
  const hasPerPortScope = Object.values(parentNodeType.outputs).some(
    (portDef) => portDef.scope === rawScopeName
  );
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
    const parentScopeName = instance.parent
      ? `${instance.parent.id}.${instance.parent.scope}`
      : null;
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
    `${indent}const ${safeParentId}_scopedCtx = ctx.createScope('${parentInstance.id}', ${safeParentId}Idx, '${parentNodeType.scope}');`
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
    const childNodeType = allNodeTypes.find((nt) => nt.name === childInstance.nodeType || nt.functionName === childInstance.nodeType);
    if (!childNodeType) return;

    // Check if this child is a branching node
    if (branchingNodes.has(childInstanceId)) {
      generateBranchingNodeCode(
        childInstance,
        childNodeType,
        workflow,
        allNodeTypes,
        branchRegions.get(childInstanceId)!,
        availableVars,
        generatedNodes,
        lines,
        indent,
        false,
        branchingNodes,
        branchRegions,
        isAsync,
        scopedCtxVar, // Pass scoped context name
        bundleMode
      );
      const region = branchRegions.get(childInstanceId)!;
      region.successNodes.forEach((n) => generatedNodes.add(n));
      region.failureNodes.forEach((n) => generatedNodes.add(n));
    } else {
      generateNodeCallWithContext(
        childInstance,
        childNodeType,
        workflow,
        availableVars,
        lines,
        allNodeTypes,
        indent,
        isAsync,
        false, // useConst = false - scoped children need let (referenced outside scope block)
        parentInstance.id, // instanceParent - parent node is const, no ! needed when referencing it
        scopedCtxVar, // Pass scoped context name
        bundleMode
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
  ctxVar: string = 'ctx' // Context variable name (for scoped contexts)
): void {
  nodeIds.forEach((instanceId) => {
    const instance = workflow.instances.find((i) => i.id === instanceId);
    if (!instance) return;

    const safeId = toValidIdentifier(instanceId);
    // Add execution index for this skipped node so the event has a valid reference
    lines.push(`${indent}const ${safeId}Idx = ${ctxVar}.addExecution('${instanceId}');`);
    lines.push(`${indent}${ctxVar}.sendStatusChangedEvent({`);
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
function buildStepSourceCondition(
  sourceNode: string,
  sourcePort: string,
  branchingNodes: Set<string>
): string {
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
  branchRegions: Map<string, { successNodes: Set<string>; failureNodes: Set<string> }>,
  availableVars: Map<string, string>,
  generatedNodes: Set<string>,
  lines: string[],
  indent: string,
  isAsync: boolean,
  ctxVar: string,
  bundleMode: boolean,
  forceTrackSuccessNodes: Set<string> = new Set()
): void {
  // Pre-declare success flags for all non-last chain nodes so they're
  // accessible across guard blocks (avoiding let-in-block scoping issues).
  // Also pre-declare for the last node if promoted nodes depend on its _success flag.
  const preDeclaredFlags = new Set<string>();
  for (let i = 0; i < chain.length; i++) {
    const isLast = i === chain.length - 1;
    if (!isLast || forceTrackSuccessNodes.has(chain[i])) {
      const safeId = toValidIdentifier(chain[i]);
      lines.push(`${indent}let ${safeId}_success = false;`);
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
    const nodeType = nodeTypes.find(
      (nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType
    );
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
      availableVars,
      generatedNodes,
      lines,
      nodeIndent,
      false,
      branchingNodes,
      branchRegions,
      isAsync,
      ctxVar,
      bundleMode,
      preDeclaredFlags,
      !isLast || forceTrackSuccessNodes.has(chain[i]) // forceTrackSuccess for non-last chain nodes or nodes with promoted dependents
    );

    // Generate scoped children for this chain node
    generateScopedChildrenExecution(
      instance,
      nodeType,
      workflow,
      nodeTypes,
      generatedNodes,
      availableVars,
      lines,
      nodeIndent,
      branchingNodes,
      branchRegions,
      isAsync,
      bundleMode
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
      generateCancelledEventsForBranch(
        remainingNodes,
        workflow,
        nodeTypes,
        lines,
        indent + '  ',
        ctxVar
      );
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

function generateBranchingNodeCode(
  instance: { id: string; nodeType: string },
  branchNode: TNodeTypeAST,
  workflow: TWorkflowAST,
  allNodeTypes: TNodeTypeAST[],
  region: { successNodes: Set<string>; failureNodes: Set<string> },
  availableVars: Map<string, string>,
  generatedNodes: Set<string>,
  lines: string[],
  indent: string,
  _generateReturns: boolean = true, // DEPRECATED: always false, kept for signature compat
  branchingNodes: Set<string>,
  branchRegions: Map<string, { successNodes: Set<string>; failureNodes: Set<string> }>,
  isAsync: boolean,
  ctxVar: string = 'ctx', // Context variable name (for scoped contexts)
  bundleMode: boolean = false,
  preDeclaredSuccessFlags: Set<string> = new Set(),
  forceTrackSuccess: boolean = false
): void {
  const instanceId = instance.id;
  const safeId = toValidIdentifier(instanceId);
  const functionName = branchNode.functionName;

  lines.push(`${indent}${ctxVar}.checkAborted('${instanceId}');`);
  lines.push(`${indent}${safeId}Idx = ${ctxVar}.addExecution('${instanceId}');`);
  lines.push(`${indent}${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}  nodeTypeName: '${functionName}',`);
  lines.push(`${indent}  id: '${instanceId}',`);
  lines.push(`${indent}  executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}  status: 'RUNNING',`);
  lines.push(`${indent}});`);
  lines.push('');

  // Only declare success flag if there are downstream nodes
  const hasSuccessDownstream = region.successNodes.size > 0;
  const hasFailureDownstream = region.failureNodes.size > 0;
  const hasDownstream = hasSuccessDownstream || hasFailureDownstream;
  // Track success flag when there are downstream nodes OR when chain code needs it
  const trackSuccess = hasDownstream || forceTrackSuccess;

  if (trackSuccess) {
    if (preDeclaredSuccessFlags.has(safeId)) {
      // Flag was pre-declared by chain code — use assignment, not declaration
      lines.push(`${indent}${safeId}_success = false;`);
    } else {
      lines.push(`${indent}let ${safeId}_success = false;`);
    }
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
  });
  const awaitKeyword = branchNode.isAsync ? 'await ' : '';

  if (branchNode.expression) {
    // Expression branching node: call without execute, auto-set onSuccess/onFailure
    lines.push(
      `${indent}  const ${safeId}Result = ${awaitKeyword}${functionName}(${argNames.join(', ')});`
    );

    // Determine data output ports (exclude control flow and scoped ports)
    const dataOutputPorts = Object.keys(branchNode.outputs).filter((portName) => {
      const portConfig = branchNode.outputs[portName];
      if (portConfig.scope) return false;
      if (isSuccessPort(portName) || isFailurePort(portName)) return false;
      if (portConfig.isControlFlow || portConfig.failure) return false;
      return true;
    });

    if (dataOutputPorts.length === 1) {
      // Single data output: destructure if result is an object with the port key, else use raw value
      // Extract to unknown-typed variable to prevent TypeScript from narrowing
      // specific return types (e.g. boolean) to `never` in the typeof check
      const portName = dataOutputPorts[0];
      const rawVar = `${safeId}Result_raw`;
      lines.push(
        `${indent}  const ${rawVar}: unknown = ${safeId}Result;`
      );
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, typeof ${rawVar} === 'object' && ${rawVar} !== null && '${portName}' in ${rawVar} ? ${rawVar}.${portName} : ${rawVar});`
      );
    } else {
      // Multiple data outputs: destructure from object return
      dataOutputPorts.forEach((portName) => {
        lines.push(
          `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${safeId}Result.${portName});`
        );
      });
    }

    // Auto-set onSuccess/onFailure
    lines.push(
      `${indent}  ${setCall}({ id: '${instanceId}', portName: 'onSuccess', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, true);`
    );
    lines.push(
      `${indent}  ${setCall}({ id: '${instanceId}', portName: 'onFailure', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, false);`
    );
  } else if (branchNode.variant === 'MAP_ITERATOR') {
    // MAP_ITERATOR: inline iteration — no user function to call
    // argNames: [execute, items, scopeFn]
    const executeArg = argNames[0];
    const itemsArg = argNames[1];
    const scopeFnArg = argNames[2];
    lines.push(`${indent}  let ${safeId}Result: { onSuccess: boolean; onFailure: boolean; results: unknown[] };`);
    lines.push(`${indent}  if (!${executeArg}) {`);
    lines.push(`${indent}    ${safeId}Result = { onSuccess: false, onFailure: false, results: [] };`);
    lines.push(`${indent}  } else {`);
    lines.push(`${indent}    const __results: unknown[] = [];`);
    lines.push(`${indent}    for (const __item of ${itemsArg}) {`);
    lines.push(`${indent}      __results.push((${isAsync ? 'await ' : ''}${scopeFnArg}(true, __item)).processed);`);
    lines.push(`${indent}    }`);
    lines.push(`${indent}    ${safeId}Result = { onSuccess: true, onFailure: false, results: __results };`);
    lines.push(`${indent}  }`);

    // Set output ports from result
    Object.keys(branchNode.outputs).forEach((portName) => {
      const portConfig = branchNode.outputs[portName];
      if (portConfig.scope) return;
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${safeId}Result.${portName});`
      );
    });
  } else if (branchNode.variant === 'IMPORTED_WORKFLOW' || branchNode.variant === 'WORKFLOW') {
    // Check if this is a workflow call (IMPORTED_WORKFLOW or WORKFLOW variant)
    // Workflows use (execute, params) signature where params is an object
    // Regular nodes use (execute, arg1, arg2, ...) positional signature
    // For workflow calls, wrap data args in an object and include recursion depth
    const executeArg = argNames[0]; // First arg is always execute
    const dataArgs = argNames.slice(1); // Rest are data inputs
    const inputPortNames = Object.keys(branchNode.inputs).filter((p) => !isExecutePort(p));

    // Build params object: { portName1: value1, portName2: value2, ..., __rd__: __rd__ + 1 }
    // Assign to variable first to avoid TypeScript excess property checking on object literals
    const paramsEntries = inputPortNames.map((portName, i) => `${portName}: ${dataArgs[i]}`);
    paramsEntries.push('__rd__: __rd__ + 1');
    const paramsObj = `{ ${paramsEntries.join(', ')} }`;
    const paramsVar = `__${safeId}Params__`;

    lines.push(`${indent}  const ${paramsVar} = ${paramsObj};`);
    lines.push(
      `${indent}  const ${safeId}Result = ${awaitKeyword}${functionName}(${executeArg}, ${paramsVar});`
    );

    // STEP Port Architecture: Extract ALL outputs from result, including onSuccess/onFailure
    // Skip scoped OUTPUT ports - they're parameters to scope functions, not return values
    Object.keys(branchNode.outputs).forEach((portName) => {
      const portConfig = branchNode.outputs[portName];
      if (portConfig.scope) return;
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${safeId}Result.${portName});`
      );
    });
  } else if (branchNode.scope || (branchNode.scopes && branchNode.scopes.length > 0)) {
    // Scoped node call with positional arguments (uses _impl signature)
    // Scoped nodes have callback parameters that can't be passed via params object
    lines.push(
      `${indent}  const ${safeId}Result = ${awaitKeyword}${functionName}(${argNames.join(', ')});`
    );

    // STEP Port Architecture: Extract ALL outputs from result, including onSuccess/onFailure
    // Skip scoped OUTPUT ports - they're parameters to scope functions, not return values
    Object.keys(branchNode.outputs).forEach((portName) => {
      const portConfig = branchNode.outputs[portName];
      if (portConfig.scope) return;
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${safeId}Result.${portName});`
      );
    });
  } else {
    // Regular node call - always use positional args
    // In bundle mode we import _impl which takes (execute, ...positional_args)
    lines.push(
      `${indent}  const ${safeId}Result = ${awaitKeyword}${functionName}(${argNames.join(', ')});`
    );

    // STEP Port Architecture: Extract ALL outputs from result, including onSuccess/onFailure
    // Skip scoped OUTPUT ports - they're parameters to scope functions, not return values
    Object.keys(branchNode.outputs).forEach((portName) => {
      const portConfig = branchNode.outputs[portName];
      if (portConfig.scope) return;
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${safeId}Result.${portName});`
      );
    });
  }
  lines.push(`${indent}  ${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${functionName}',`);
  lines.push(`${indent}    id: '${instanceId}',`);
  lines.push(`${indent}    executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}    status: 'SUCCEEDED',`);
  lines.push(`${indent}  });`);
  // Use onSuccess from result to determine control flow
  // For expression nodes, onSuccess is always true here (catch handles failure)
  if (trackSuccess) {
    lines.push(
      `${indent}  ${safeId}_success = ${branchNode.expression ? 'true' : `${safeId}Result.onSuccess`};`
    );
  }
  lines.push(`${indent}} catch (error: unknown) {`);
  lines.push(`${indent}  const isCancellation = CancellationError.isCancellationError(error);`);
  lines.push(`${indent}  ${ctxVar}.sendStatusChangedEvent({`);
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
  lines.push(`${indent}    });`);
  lines.push(
    `${indent}    ${setCall}({ id: '${instanceId}', portName: 'onSuccess', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, false);`
  );
  lines.push(
    `${indent}    ${setCall}({ id: '${instanceId}', portName: 'onFailure', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, true);`
  );
  if (trackSuccess) {
    lines.push(`${indent}    ${safeId}_success = false;`);
  }
  lines.push(`${indent}  }`);
  // Emit CANCELLED for all downstream nodes since branching node threw
  if (hasSuccessDownstream) {
    generateCancelledEventsForBranch(
      region.successNodes,
      workflow,
      allNodeTypes,
      lines,
      `${indent}  `,
      ctxVar
    );
  }
  if (hasFailureDownstream) {
    generateCancelledEventsForBranch(
      region.failureNodes,
      workflow,
      allNodeTypes,
      lines,
      `${indent}  `,
      ctxVar
    );
  }
  // Re-throw the error to propagate it up (important for recursive workflows)
  lines.push(`${indent}  throw error;`);
  lines.push(`${indent}}`);
  lines.push('');

  // Only generate if/else if there are downstream nodes
  if (hasDownstream) {
    lines.push(`${indent}if (${safeId}_success) {`);
    // Emit CANCELLED for failure branch nodes since success path was taken
    if (hasFailureDownstream) {
      generateCancelledEventsForBranch(
        region.failureNodes,
        workflow,
        allNodeTypes,
        lines,
        `${indent}  `,
        ctxVar
      );
    }
    const successVars = new Map(availableVars);
    Object.keys(branchNode.outputs).forEach((portName) => {
      successVars.set(`${instanceId}.${portName}`, `${safeId}Result.${portName}`);
    });
    // Sort success branch nodes topologically to ensure correct execution order
    const successInstanceIds = sortBranchNodesTopologically(region.successNodes, workflow);
    const successExecutedNodes = [instance.id];

    successInstanceIds.forEach((instanceId) => {
      const inst = workflow.instances.find((i) => i.id === instanceId);
      if (!inst) return;
      // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
      const nodeType = allNodeTypes.find((nt) => nt.name === inst.nodeType || nt.functionName === inst.nodeType);
      if (!nodeType) return;

      if (branchingNodes.has(instanceId)) {
        const nestedRegion = branchRegions.get(instanceId)!;
        generateBranchingNodeCode(
          inst,
          nodeType,
          workflow,
          allNodeTypes,
          nestedRegion,
          successVars,
          generatedNodes,
          lines,
          `${indent}  `,
          false,
          branchingNodes,
          branchRegions,
          isAsync,
          ctxVar,
          bundleMode
        );
        successExecutedNodes.push(instanceId);
        nestedRegion.successNodes.forEach((n) => successExecutedNodes.push(n));
        nestedRegion.failureNodes.forEach((n) => successExecutedNodes.push(n));
      } else {
        generateNodeCallWithContext(
          inst,
          nodeType,
          workflow,
          successVars,
          lines,
          allNodeTypes,
          `${indent}  `,
          isAsync,
          false, // useConst
          undefined, // instanceParent
          ctxVar,
          bundleMode,
          true // skipExecuteGuard — inside branch, execute is guaranteed by if/else
        );
        Object.keys(nodeType.outputs).forEach((portName) => {
          successVars.set(`${instanceId}.${portName}`, `${toValidIdentifier(instanceId)}Result.${portName}`);
        });
        successExecutedNodes.push(instanceId);
        generatedNodes.add(instanceId);
      }
    });

    // Only generate else block if there are failure nodes to execute
    if (hasFailureDownstream) {
      lines.push(`${indent}} else {`);
      // Emit CANCELLED for success branch nodes since failure path was taken
      if (hasSuccessDownstream) {
        generateCancelledEventsForBranch(
          region.successNodes,
          workflow,
          allNodeTypes,
          lines,
          `${indent}  `,
          ctxVar
        );
      }
      const failureVars = new Map(availableVars);
      Object.keys(branchNode.outputs).forEach((portName) => {
        failureVars.set(`${instanceId}.${portName}`, `${safeId}Result.${portName}`);
      });
      // Sort failure branch nodes topologically to ensure correct execution order
      const failureInstanceIds = sortBranchNodesTopologically(region.failureNodes, workflow);
      const failureExecutedNodes = [instance.id];

      failureInstanceIds.forEach((instanceId) => {
        const inst = workflow.instances.find((i) => i.id === instanceId);
        if (!inst) return;
        // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
        const nodeType = allNodeTypes.find((nt) => nt.name === inst.nodeType || nt.functionName === inst.nodeType);
        if (!nodeType) return;

        if (branchingNodes.has(instanceId)) {
          const nestedRegion = branchRegions.get(instanceId)!;
          generateBranchingNodeCode(
            inst,
            nodeType,
            workflow,
            allNodeTypes,
            nestedRegion,
            failureVars,
            generatedNodes,
            lines,
            `${indent}  `,
            false,
            branchingNodes,
            branchRegions,
            isAsync,
            ctxVar,
            bundleMode
          );
          failureExecutedNodes.push(instanceId);
          nestedRegion.successNodes.forEach((n) => failureExecutedNodes.push(n));
          nestedRegion.failureNodes.forEach((n) => failureExecutedNodes.push(n));
        } else {
          generateNodeCallWithContext(
            inst,
            nodeType,
            workflow,
            failureVars,
            lines,
            allNodeTypes,
            `${indent}  `,
            isAsync,
            false, // useConst
            undefined, // instanceParent
            ctxVar,
            bundleMode,
            true // skipExecuteGuard — inside branch, execute is guaranteed by if/else
          );
          Object.keys(nodeType.outputs).forEach((portName) => {
            failureVars.set(`${instanceId}.${portName}`, `${toValidIdentifier(instanceId)}Result.${portName}`);
          });
          failureExecutedNodes.push(instanceId);
          generatedNodes.add(instanceId);
        }
      });
      lines.push(`${indent}}`);
    } else {
      // No failure branch - emit CANCELLED for success nodes and close
      if (hasSuccessDownstream) {
        lines.push(`${indent}} else {`);
        generateCancelledEventsForBranch(
          region.successNodes,
          workflow,
          allNodeTypes,
          lines,
          `${indent}  `,
          ctxVar
        );
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}}`);
      }
    }
  }
  generatedNodes.add(instanceId);
}

function generatePullNodeWithContext(
  instance: { id: string; nodeType: string },
  nodeType: TNodeTypeAST,
  workflow: TWorkflowAST,
  lines: string[],
  indent: string,
  isAsync: boolean,
  ctxVar: string = 'ctx', // Context variable name (for scoped contexts)
  bundleMode: boolean = false
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

  // Create a lazy execution function for this pull node
  // The function will only execute when its outputs are accessed
  lines.push(`${indent}// Pull execution node: ${instanceId}`);
  lines.push(`${indent}const ${safeId}_executor = ${asyncKeyword}() => {`);
  lines.push(`${indent}  if (${safeId}Idx !== undefined) {`);
  lines.push(`${indent}    return; // Already executed`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  ${ctxVar}.checkAborted('${instanceId}');`);
  lines.push(`${indent}  ${safeId}Idx = ${ctxVar}.addExecution('${instanceId}');`);
  lines.push(`${indent}  ${ctxVar}.sendStatusChangedEvent({`);
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
  });

  const resultVar = `${safeId}Result`;

  // Check if this is a workflow call (IMPORTED_WORKFLOW or WORKFLOW variant)
  // Workflows use (execute, params) signature where params is an object
  // Regular nodes use (execute, arg1, arg2, ...) positional signature
  if (nodeType.variant === 'MAP_ITERATOR') {
    // MAP_ITERATOR: inline iteration in pull executor
    const executeArg = args[0];
    const itemsArg = args[1];
    const scopeFnArg = args[2];
    lines.push(`${indent}    let ${resultVar}: { onSuccess: boolean; onFailure: boolean; results: unknown[] };`);
    lines.push(`${indent}    if (!${executeArg}) {`);
    lines.push(`${indent}      ${resultVar} = { onSuccess: false, onFailure: false, results: [] };`);
    lines.push(`${indent}    } else {`);
    lines.push(`${indent}      const __results: unknown[] = [];`);
    lines.push(`${indent}      for (const __item of ${itemsArg}) {`);
    lines.push(`${indent}        __results.push((${executorIsAsync ? 'await ' : ''}${scopeFnArg}(true, __item)).processed);`);
    lines.push(`${indent}      }`);
    lines.push(`${indent}      ${resultVar} = { onSuccess: true, onFailure: false, results: __results };`);
    lines.push(`${indent}    }`);
  } else if (nodeType.variant === 'IMPORTED_WORKFLOW' || nodeType.variant === 'WORKFLOW') {
    // For workflow calls, wrap data args in an object and include recursion depth
    const executeArg = args[0]; // First arg is always execute
    const dataArgs = args.slice(1); // Rest are data inputs
    const inputPortNames = Object.keys(nodeType.inputs).filter((p) => !isExecutePort(p));

    // Build params object: { portName1: value1, portName2: value2, ..., __rd__: __rd__ + 1 }
    // Assign to variable first to avoid TypeScript excess property checking on object literals
    const paramsEntries = inputPortNames.map((portName, i) => `${portName}: ${dataArgs[i]}`);
    paramsEntries.push('__rd__: __rd__ + 1');
    const paramsObj = `{ ${paramsEntries.join(', ')} }`;
    const paramsVar = `__${safeId}Params__`;

    lines.push(`${indent}    const ${paramsVar} = ${paramsObj};`);
    lines.push(
      `${indent}    const ${resultVar} = ${awaitKeyword}${functionName}(${executeArg}, ${paramsVar});`
    );
  } else if (nodeType.scope || (nodeType.scopes && nodeType.scopes.length > 0)) {
    // Scoped node call with positional arguments (uses _impl signature)
    // Scoped nodes have callback parameters that can't be passed via params object
    lines.push(
      `${indent}    const ${resultVar} = ${awaitKeyword}${functionName}(${args.join(', ')});`
    );
  } else {
    // Regular node call - always use positional args
    // In bundle mode we import _impl which takes (execute, ...positional_args)
    lines.push(
      `${indent}    const ${resultVar} = ${awaitKeyword}${functionName}(${args.join(', ')});`
    );
  }

  Object.keys(nodeType.outputs).forEach((portName) => {
    if (isSuccessPort(portName) || isFailurePort(portName)) return;
    // Skip scoped OUTPUT ports - they don't exist in the function return value
    const portConfig = nodeType.outputs[portName];
    if (portConfig.scope) return;
    lines.push(
      `${indent}    ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${resultVar}.${portName});`
    );
  });

  lines.push(`${indent}    ${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}      nodeTypeName: '${functionName}',`);
  lines.push(`${indent}      id: '${instanceId}',`);
  lines.push(`${indent}      executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}      status: 'SUCCEEDED',`);
  lines.push(`${indent}    });`);
  lines.push(`${indent}  } catch (error: unknown) {`);
  lines.push(`${indent}    const isCancellation = CancellationError.isCancellationError(error);`);
  lines.push(`${indent}    ${ctxVar}.sendStatusChangedEvent({`);
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
  _availableVars: Map<string, string>,
  lines: string[],
  _allNodeTypes: TNodeTypeAST[],
  indent: string,
  isAsync: boolean,
  useConst: boolean = false, // Use const for nodes that always execute (not in branches)
  instanceParent?: string, // Parent node ID for scope children (parent is const, no ! needed)
  ctxVar: string = 'ctx', // Context variable name (for scoped contexts)
  bundleMode: boolean = false, // Bundle mode uses params object pattern for wrapper functions
  skipExecuteGuard: boolean = false, // Skip execute port STEP guard (for nodes inside branch blocks)
  branchingNodes: Set<string> = new Set() // Branching nodes set for port-aware STEP guards
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
    generatePullNodeWithContext(instance, nodeType, workflow, lines, indent, isAsync, ctxVar, bundleMode);
    return;
  }
  const stepInputs: [string, { dataType: string }][] = Object.entries(nodeType.inputs).filter(([portName, portConfig]) => {
    // Include the primary execute port for promoted nodes (useConst=false at top level)
    // so they get a STEP guard from their conditional source.
    // Skip execute guard for nodes inside branch blocks (execute is guaranteed by if/else).
    if (isExecutePort(portName) && !useConst && !skipExecuteGuard) {
      return portConfig.dataType === 'STEP';
    }
    return portConfig.dataType === 'STEP' && !isExecutePort(portName);
  });
  // Expression nodes don't declare 'execute' in their inputs, but the workflow
  // connects STEP signals to their execute port. Include it for promoted expression
  // nodes so they get a proper branch-aware STEP guard.
  if (nodeType.expression && !useConst && !skipExecuteGuard && !stepInputs.some(([p]) => isExecutePort(p))) {
    const hasExecuteConnection = workflow.connections.some(
      (conn) => conn.to.node === instanceId && isExecutePort(conn.to.port)
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
        const fullCondition = allSources.map((s) => buildStepSourceCondition(s.node, s.port, branchingNodes)).join(' || ');
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
      }
    }
  }
  const varDecl = useConst ? 'const ' : '';
  lines.push(`${indent}${ctxVar}.checkAborted('${instanceId}');`);
  lines.push(`${indent}${varDecl}${safeId}Idx = ${ctxVar}.addExecution('${instanceId}');`);
  lines.push(`${indent}${ctxVar}.sendStatusChangedEvent({`);
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
  });
  const resultVar = `${safeId}Result`;
  const awaitKeyword = nodeType.isAsync ? 'await ' : '';

  if (nodeType.expression) {
    // Expression node: call without execute, map raw return to output ports
    // _impl returns data only; onSuccess/onFailure are auto-set in the workflow body
    lines.push(
      `${indent}  const ${resultVar} = ${awaitKeyword}${functionName}(${args.join(', ')});`
    );

    // Determine data output ports (exclude control flow and scoped ports)
    const dataOutputPorts = Object.keys(nodeType.outputs).filter((portName) => {
      const portConfig = nodeType.outputs[portName];
      if (portConfig.scope) return false;
      if (isSuccessPort(portName) || isFailurePort(portName)) return false;
      if (portConfig.isControlFlow || portConfig.failure) return false;
      return true;
    });

    if (dataOutputPorts.length === 1) {
      // Single data output: destructure if result is an object with the port key, else use raw value
      // Extract to unknown-typed variable to prevent TypeScript from narrowing
      // specific return types (e.g. boolean) to `never` in the typeof check
      const portName = dataOutputPorts[0];
      const rawVar = `${resultVar}_raw`;
      lines.push(
        `${indent}  const ${rawVar}: unknown = ${resultVar};`
      );
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, typeof ${rawVar} === 'object' && ${rawVar} !== null && '${portName}' in ${rawVar} ? ${rawVar}.${portName} : ${rawVar});`
      );
    } else {
      // Multiple data outputs: destructure from object return
      dataOutputPorts.forEach((portName) => {
        lines.push(
          `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${resultVar}.${portName});`
        );
      });
    }

    // Auto-set onSuccess/onFailure
    lines.push(
      `${indent}  ${setCall}({ id: '${instanceId}', portName: 'onSuccess', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, true);`
    );
    lines.push(
      `${indent}  ${setCall}({ id: '${instanceId}', portName: 'onFailure', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, false);`
    );
  } else if (nodeType.variant === 'MAP_ITERATOR') {
    // MAP_ITERATOR: inline iteration — no user function to call
    // args: [execute, items, scopeFn]
    const executeArg = args[0];
    const itemsArg = args[1];
    const scopeFnArg = args[2];
    lines.push(`${indent}  let ${resultVar}: { onSuccess: boolean; onFailure: boolean; results: unknown[] };`);
    lines.push(`${indent}  if (!${executeArg}) {`);
    lines.push(`${indent}    ${resultVar} = { onSuccess: false, onFailure: false, results: [] };`);
    lines.push(`${indent}  } else {`);
    lines.push(`${indent}    const __results: unknown[] = [];`);
    lines.push(`${indent}    for (const __item of ${itemsArg}) {`);
    lines.push(`${indent}      __results.push((${isAsync ? 'await ' : ''}${scopeFnArg}(true, __item)).processed);`);
    lines.push(`${indent}    }`);
    lines.push(`${indent}    ${resultVar} = { onSuccess: true, onFailure: false, results: __results };`);
    lines.push(`${indent}  }`);

    // Set output ports from result
    Object.keys(nodeType.outputs).forEach((portName) => {
      const portConfig = nodeType.outputs[portName];
      if (portConfig.scope) return;
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${resultVar}.${portName});`
      );
    });
  } else if (nodeType.variant === 'IMPORTED_WORKFLOW' || nodeType.variant === 'WORKFLOW') {
    // Check if this is a workflow call (IMPORTED_WORKFLOW or WORKFLOW variant)
    // Workflows use (execute, params) signature where params is an object
    // Regular nodes use (execute, arg1, arg2, ...) positional signature
    // For workflow calls, wrap data args in an object and include recursion depth
    const executeArg = args[0]; // First arg is always execute
    const dataArgs = args.slice(1); // Rest are data inputs
    const inputPortNames = Object.keys(nodeType.inputs).filter((p) => !isExecutePort(p));

    // Build params object: { portName1: value1, portName2: value2, ..., __rd__: __rd__ + 1 }
    // Assign to variable first to avoid TypeScript excess property checking on object literals
    const paramsEntries = inputPortNames.map((portName, i) => `${portName}: ${dataArgs[i]}`);
    paramsEntries.push('__rd__: __rd__ + 1');
    const paramsObj = `{ ${paramsEntries.join(', ')} }`;
    const paramsVar = `__${safeId}Params__`;

    lines.push(`${indent}  const ${paramsVar} = ${paramsObj};`);
    lines.push(
      `${indent}  const ${resultVar} = ${awaitKeyword}${functionName}(${executeArg}, ${paramsVar});`
    );

    // STEP Port Architecture: Extract ALL outputs from result, including onSuccess/onFailure
    // Skip scoped OUTPUT ports - they're parameters to scope functions, not return values
    Object.keys(nodeType.outputs).forEach((portName) => {
      const portConfig = nodeType.outputs[portName];
      // Skip scoped OUTPUT ports - they don't exist in the function return value
      if (portConfig.scope) return;
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${resultVar}.${portName});`
      );
    });
  } else if (nodeType.scope || (nodeType.scopes && nodeType.scopes.length > 0)) {
    // Scoped node call with positional arguments (uses _impl signature)
    // Scoped nodes have callback parameters that can't be passed via params object
    lines.push(
      `${indent}  const ${resultVar} = ${awaitKeyword}${functionName}(${args.join(', ')});`
    );

    // STEP Port Architecture: Extract ALL outputs from result, including onSuccess/onFailure
    // Skip scoped OUTPUT ports - they're parameters to scope functions, not return values
    Object.keys(nodeType.outputs).forEach((portName) => {
      const portConfig = nodeType.outputs[portName];
      // Skip scoped OUTPUT ports - they don't exist in the function return value
      if (portConfig.scope) return;
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${resultVar}.${portName});`
      );
    });
  } else {
    // Regular node call - always use positional args
    // In bundle mode we import _impl which takes (execute, ...positional_args)
    lines.push(
      `${indent}  const ${resultVar} = ${awaitKeyword}${functionName}(${args.join(', ')});`
    );

    // STEP Port Architecture: Extract ALL outputs from result, including onSuccess/onFailure
    // Skip scoped OUTPUT ports - they're parameters to scope functions, not return values
    Object.keys(nodeType.outputs).forEach((portName) => {
      const portConfig = nodeType.outputs[portName];
      // Skip scoped OUTPUT ports - they don't exist in the function return value
      if (portConfig.scope) return;
      lines.push(
        `${indent}  ${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${resultVar}.${portName});`
      );
    });
  }
  lines.push(`${indent}  ${ctxVar}.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${functionName}',`);
  lines.push(`${indent}    id: '${instanceId}',`);
  lines.push(`${indent}    executionIndex: ${safeId}Idx,`);
  lines.push(`${indent}    status: 'SUCCEEDED',`);
  lines.push(`${indent}  });`);
  lines.push(`${indent}} catch (error: unknown) {`);
  lines.push(`${indent}  const isCancellation = CancellationError.isCancellationError(error);`);
  lines.push(`${indent}  ${ctxVar}.sendStatusChangedEvent({`);
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
  lines.push(`${indent}    });`);
  if (nodeType.expression) {
    // Expression node: auto-set failure flags in catch block
    lines.push(
      `${indent}    ${setCall}({ id: '${instanceId}', portName: 'onSuccess', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, false);`
    );
    lines.push(
      `${indent}    ${setCall}({ id: '${instanceId}', portName: 'onFailure', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, true);`
    );
  }
  lines.push(`${indent}  }`);
  lines.push(`${indent}  throw error;`);
  lines.push(`${indent}}`);
  if (shouldIndent) {
    const originalIndent = indent.slice(0, -2);
    lines.push(`${originalIndent}}`);
  }
}
