import type { TNodeTypeAST, TWorkflowAST, TMergeStrategy } from '../ast';
import {
  RESERVED_PORT_NAMES,
  isStartNode,
  isExitNode,
  isExecutePort,
  isSuccessPort,
  isFailurePort,
} from '../constants';
import { generateScopeFunctionClosure } from './scope-function-generator';
import { mapToTypeScript } from '../type-mappings';

/**
 * Sanitize a node ID to be a valid JavaScript identifier.
 * Replaces non-alphanumeric characters (except _ and $) with underscores.
 *
 * @param nodeId - The node ID (may contain slashes, etc.)
 * @returns A valid JavaScript identifier
 */
export function toValidIdentifier(nodeId: string): string {
  // Replace any character that's not alphanumeric, underscore, or dollar sign
  let sanitized = nodeId.replace(/[^a-zA-Z0-9_$]/g, '_');
  // Ensure it doesn't start with a digit
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }
  return sanitized;
}

/**
 * Build a JavaScript expression that merges multiple source values based on strategy.
 *
 * @param sources - Array of source variable names
 * @param strategy - Merge strategy to apply
 * @returns JavaScript expression string
 */
export function buildMergeExpression(sources: string[], strategy: TMergeStrategy): string {
  switch (strategy) {
    case 'FIRST':
      return `(() => { const __s__ = [${sources.join(', ')}]; return __s__.find(v => v !== undefined); })()`;
    case 'LAST':
      return `(() => { const __s__ = [${sources.join(', ')}]; return __s__.filter(v => v !== undefined).pop(); })()`;
    case 'COLLECT':
      return `[${sources.join(', ')}]`;
    case 'MERGE':
      return `Object.assign({}, ${sources.join(', ')})`;
    case 'CONCAT':
      return `[${sources.join(', ')}].flat()`;
    default:
      return sources[0] ?? 'undefined';
  }
}

export type TBuildNodeArgsOptions = {
  node: TNodeTypeAST;
  workflow: TWorkflowAST;
  id: string;
  lines: string[];
  indent?: string;
  getCall?: string;
  isAsync?: boolean;
  instanceParent?: string;
  skipPorts?: Set<string>;
  emitInputEvents?: boolean;
  setCall?: string;
  nodeTypeName?: string;
  bundleMode?: boolean;
};

/**
 * Builds the argument list for a node function call by resolving input port values.
 *
 * This function is central to code generation - it determines where each input port
 * gets its value from: connections, expressions, defaults, or execution strategies.
 *
 * ## Resolution Priority (per port):
 * 1. **Skip Ports**: If port is in skipPorts set, use pre-declared variable
 * 2. **Instance Expression**: Check instance.config.portConfigs for evaluateConstantAs
 * 3. **Connection**: Get value from connected output port via ctx.getVariable()
 * 4. **Node Type Expression**: Check nodeType.inputs[port].expression
 * 5. **Default Value**: Use nodeType.inputs[port].default if available
 * 6. **Undefined**: No value source found (may cause runtime error)
 *
 * ## Special Handling:
 * - **execute port**: Always first, handles CONJUNCTION/DISJUNCTION strategies
 * - **Scoped INPUT ports**: Skipped (they're return values from scope functions)
 * - **STEP ports (onSuccess/onFailure)**: Use executionSignal config if present
 * - **Scope functions**: Generated via generateScopeFunctionClosure() for FUNCTION ports
 *
 * ## STEP Port Execution Strategies:
 * - **CONJUNCTION (AND)**: `execute = stepA && stepB && stepC`
 * - **DISJUNCTION (OR)**: `execute = stepA || stepB || stepC`
 * - **CUSTOM**: Uses evaluateExecutionSignalAs expression
 *
 * @param opts - Configuration object with node, workflow, and generation settings
 * @param opts.node - The node type definition with input/output port specs
 * @param opts.workflow - The workflow AST containing connections and instances
 * @param opts.id - The node instance ID being generated
 * @param opts.lines - Array to push generated code lines into
 * @param opts.indent - Indentation prefix for generated lines (default: "    ")
 * @param opts.getCall - Method to get variables (default: "await ctx.getVariable")
 * @param opts.isAsync - Whether generating async code
 * @param opts.instanceParent - Parent node ID if this node is in a scope
 * @param opts.skipPorts - Ports to skip (already pre-handled)
 * @param opts.emitInputEvents - Whether to emit VARIABLE_SET events for inputs
 * @param opts.setCall - Method to set variables (default: "await ctx.setVariable")
 * @param opts.nodeTypeName - Override for node type name in events
 * @returns Array of argument expressions to pass to the node function
 */
export function buildNodeArgumentsWithContext(opts: TBuildNodeArgsOptions): string[] {
  const {
    node,
    workflow,
    id,
    lines,
    indent = '    ',
    getCall = 'await ctx.getVariable',
    isAsync = true,
    instanceParent,
    skipPorts,
    emitInputEvents = false,
    setCall = 'await ctx.setVariable',
    nodeTypeName,
    bundleMode = false,
  } = opts;
  const safeId = toValidIdentifier(id);
  const inputConnections = workflow.connections.filter((conn) => conn.to.node === id);
  const args: string[] = [];

  // Find instance for checking instance-level constant expressions
  const instance = workflow.instances.find((i) => i.id === id);
  const getInstancePortConfig = (portName: string) =>
    instance?.config?.portConfigs?.find(
      (pc) => pc.portName === portName && (pc.direction == null || pc.direction === 'INPUT')
    );

  // Handle execute port first
  const executeConnections = inputConnections.filter((conn) => conn.to.port === 'execute');
  const effectiveNodeTypeName = nodeTypeName || node.functionName;
  if (node.expression) {
    // Expression nodes don't take execute as a function argument.
    // Their _impl has no execute parameter (data-only signature).
    // The wrapper or workflow body handles execute guard and control flow.
    // Still emit the event for the execute port so the UI shows it.
    if (emitInputEvents) {
      lines.push(
        `${indent}${setCall}({ id: '${id}', portName: 'execute', executionIndex: ${safeId}Idx, nodeTypeName: '${effectiveNodeTypeName}' }, true);`
      );
    }
    // Don't push execute to args - expression _impl doesn't receive it
  } else if (skipPorts?.has('execute')) {
    // Execute was pre-handled (e.g., in scope functions)
    args.push(`${safeId}_execute`);
  } else if (executeConnections.length > 0) {
    // Execute port has a connection - use it
    const conn = executeConnections[0];
    const sourceNode = conn.from.node;
    const sourcePort = conn.from.port;
    const varName = `${safeId}_execute`;
    // startIdx is const so no ! needed; parent scope node is also const; other node indices are let so need !
    const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
    const isConstSource = isStartNode(sourceNode) || sourceNode === instanceParent;
    const nonNullAssert = isConstSource ? '' : '!';
    lines.push(
      `${indent}const ${varName} = ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}${nonNullAssert} }) as boolean;`
    );
    // Emit VARIABLE_SET for execute input port
    if (emitInputEvents) {
      lines.push(
        `${indent}${setCall}({ id: '${id}', portName: 'execute', executionIndex: ${safeId}Idx, nodeTypeName: '${effectiveNodeTypeName}' }, ${varName});`
      );
    }
    args.push(varName);
  } else {
    // Default execute to true - still emit event for the default value
    if (emitInputEvents) {
      lines.push(
        `${indent}${setCall}({ id: '${id}', portName: 'execute', executionIndex: ${safeId}Idx, nodeTypeName: '${effectiveNodeTypeName}' }, true);`
      );
    }
    args.push('true');
  }

  Object.keys(node.inputs).forEach((portName) => {
    if (isExecutePort(portName)) return;
    // Skip scoped INPUT ports - they're return values from scope, not function parameters
    const portConfig = node.inputs[portName];
    if (portConfig.scope) return;
    if (skipPorts?.has(portName)) {
      // Port was pre-handled - skip variable declaration but include in args
      const varName = `${safeId}_${portName}`;
      args.push(varName);
      return;
    }
    const connections = inputConnections.filter((conn) => {
      const targetPort = conn.to.port;
      return targetPort === portName;
    });

    // Check for instance-level expression first
    const instancePortConfig = getInstancePortConfig(portName);
    const hasInstanceExpression = instancePortConfig?.expression !== undefined;

    const varName = `${safeId}_${portName}`;
    const effectiveNodeTypeName = nodeTypeName || node.functionName;

    // Helper to emit VARIABLE_SET event for input port
    const emitSetEvent = () => {
      if (emitInputEvents) {
        lines.push(
          `${indent}${setCall}({ id: '${id}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${effectiveNodeTypeName}' }, ${varName});`
        );
      }
    };

    if (hasInstanceExpression) {
      // Instance-level expression takes priority
      const expr = String(instancePortConfig!.expression);
      // Check if expression is a function (arrow or regular)
      const isFunction = expr.includes('=>') || expr.trim().startsWith('function');
      if (isFunction) {
        lines.push(`${indent}const ${varName} = ${isAsync ? 'await ' : ''}(${expr})(ctx);`);
      } else {
        // Simple expression - evaluate directly
        lines.push(`${indent}const ${varName} = ${expr};`);
      }
      args.push(varName);
      emitSetEvent();
    } else if (connections.length > 0) {
      if (connections.length === 1) {
        const connection = connections[0];
        const sourceNode = connection.from.node;
        const sourcePort = connection.from.port;
        // Check if source node exists (Start node always exists)
        const sourceExists =
          isStartNode(sourceNode) || workflow.instances.some((i) => i.id === sourceNode);
        if (!sourceExists) {
          lines.push(
            `${indent}const ${varName} = undefined; // Source node '${sourceNode}' not found`
          );
          args.push(varName);
          emitSetEvent();
          return;
        }
        const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
        const isConstSource = isStartNode(sourceNode) || sourceNode === instanceParent;
        const nonNullAssert = isConstSource ? '' : '!';
        const portType = mapToTypeScript(portConfig.dataType, portConfig.tsType);

        // For FUNCTION type ports, add resolution step to handle registry IDs
        if (portConfig.dataType === 'FUNCTION') {
          const rawVarName = `${varName}_raw`;
          lines.push(
            `${indent}const ${rawVarName} = ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}${nonNullAssert} });`
          );
          lines.push(
            `${indent}const ${varName}_resolved = resolveFunction(${rawVarName});`
          );
          lines.push(
            `${indent}const ${varName} = ${varName}_resolved.fn as ${portType};`
          );
        } else {
          lines.push(
            `${indent}const ${varName} = ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}${nonNullAssert} }) as ${portType};`
          );
        }
      } else {
        // Filter to only connections with existing source nodes
        const validConnections = connections.filter((conn) => {
          const sourceNode = conn.from.node;
          return isStartNode(sourceNode) || workflow.instances.some((i) => i.id === sourceNode);
        });
        if (validConnections.length === 0) {
          // All source nodes are orphaned
          lines.push(`${indent}const ${varName} = undefined; // All source nodes not found`);
          args.push(varName);
          emitSetEvent();
          return;
        }
        const attempts: string[] = [];
        validConnections.forEach((conn, _idx) => {
          const sourceNode = conn.from.node;
          const sourcePort = conn.from.port;
          const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
          attempts.push(
            `(${sourceIdx} !== undefined ? ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx} }) : undefined)`
          );
        });
        const ternary = attempts.join(' ?? ');
        const portType = mapToTypeScript(portConfig.dataType, portConfig.tsType);

        // For FUNCTION type ports, add resolution step to handle registry IDs
        if (portConfig.dataType === 'FUNCTION') {
          const rawVarName = `${varName}_raw`;
          lines.push(`${indent}const ${rawVarName} = ${ternary};`);
          lines.push(
            `${indent}const ${varName}_resolved = ${rawVarName} !== undefined ? resolveFunction(${rawVarName}) : undefined;`
          );
          lines.push(
            `${indent}const ${varName} = ${varName}_resolved?.fn as ${portType};`
          );
        } else {
          lines.push(`${indent}const ${varName} = ${ternary} as ${portType};`);
        }
      }
      args.push(varName);
      emitSetEvent();
    } else if (portConfig.expression) {
      const expression = portConfig.expression;
      const isFunction = expression.includes('=>') || expression.trim().startsWith('function');
      const portType = mapToTypeScript(portConfig.dataType, portConfig.tsType);
      if (isFunction) {
        lines.push(`${indent}const ${varName} = ${isAsync ? 'await ' : ''}(${expression})(ctx) as ${portType};`);
      } else {
        lines.push(`${indent}const ${varName} = ${expression} as ${portType};`);
      }
      args.push(varName);
      emitSetEvent();
    } else if (portConfig.default !== undefined) {
      const defaultVal = JSON.stringify(portConfig.default);
      lines.push(`${indent}const ${varName} = ${defaultVal};`);
      args.push(varName);
      emitSetEvent();
    } else if (portConfig.optional) {
      lines.push(`${indent}const ${varName} = undefined;`);
      args.push(varName);
      emitSetEvent();
    } else {
      // Required port has no connection, expression, or default - use typed undefined fallback
      const portType = mapToTypeScript(portConfig.dataType, portConfig.tsType);
      lines.push(
        `${indent}let ${varName}!: ${portType}; // Required port '${portName}' has no connection`
      );
      args.push(varName);
      emitSetEvent();
    }
  });

  // Handle scoped ports: generate scope functions for each unique scope
  // Collect all unique scope names from both inputs and outputs
  const scopeNames = new Set<string>();
  Object.values(node.inputs).forEach((portDef) => {
    if (portDef.scope) scopeNames.add(portDef.scope);
  });
  Object.values(node.outputs).forEach((portDef) => {
    if (portDef.scope) scopeNames.add(portDef.scope);
  });

  // For each scope, generate a scope function closure
  scopeNames.forEach((scopeName) => {
    const scopeFunctionVar = `${safeId}_${scopeName}_scopeFn`;

    // Find child instances in this scope
    // Format: instance.parent = { id: parentId, scope: scopeName }
    const childInstances = workflow.instances.filter((inst) => {
      if (!inst.parent) return false;
      return inst.parent.id === id && inst.parent.scope === scopeName;
    });

    // Generate scope function closure
    // The scope function's async/sync nature should match the workflow context (isAsync parameter).
    // If the workflow is async, the scope function must be async to use await for context operations.
    // We also consider node.isAsync for cases where the node type explicitly expects async callbacks.
    // PHASE 9 FIX: Also check if any child node in the scope is async - if so, the scope
    // function must be async to properly await those child node calls.
    const hasAsyncChild = childInstances.some((child) => {
      const childNodeType = workflow.nodeTypes?.find(
        (nt) => nt.name === child.nodeType || nt.functionName === child.nodeType
      );
      return childNodeType?.isAsync === true;
    });
    const scopeIsAsync = isAsync || node.isAsync || hasAsyncChild;
    const scopeFunctionCode = generateScopeFunctionClosure(
      scopeName,
      id,
      node,
      workflow,
      childInstances,
      scopeIsAsync,
      false // production mode
    );
    lines.push(`${indent}const ${scopeFunctionVar} = ${scopeFunctionCode};`);

    args.push(scopeFunctionVar);
  });

  return args;
}

export function generateNodeWithExecutionContext(
  node: TNodeTypeAST,
  workflow: TWorkflowAST,
  lines: string[],
  isAsync: boolean,
  indent: string = '  '
): void {
  const nodeName = node.functionName;
  const safeNodeName = toValidIdentifier(nodeName); // Sanitize for use as JS variable name
  const awaitPrefix = isAsync ? 'await ' : '';
  const getCall = isAsync ? 'await ctx.getVariable' : 'ctx.getVariable';
  const setCall = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';
  lines.push(`${indent}const ${safeNodeName}Idx = ctx.addExecution('${nodeName}');`);
  lines.push(`${indent}if (typeof globalThis !== 'undefined') (globalThis as any).__fw_current_node_id__ = '${nodeName}';`);
  lines.push(`${indent}ctx.sendStatusChangedEvent({`);
  lines.push(`${indent}  nodeTypeName: '${nodeName}',`);
  lines.push(`${indent}  id: '${nodeName}',`);
  lines.push(`${indent}  executionIndex: ${safeNodeName}Idx,`);
  lines.push(`${indent}  status: 'RUNNING',`);
  lines.push(`${indent}});`);
  lines.push(`${indent}try {`);
  const args = buildNodeArgumentsWithContext({
    node,
    workflow,
    id: nodeName,
    lines,
    indent: `${indent}  `,
    getCall,
    isAsync,
  });
  const resultVar = `${safeNodeName}Result`;
  lines.push(
    `${indent}  const ${resultVar} = ${awaitPrefix}${node.functionName}(${args.join(', ')});`
  );
  Object.keys(node.outputs).forEach((portName) => {
    if (isSuccessPort(portName) || isFailurePort(portName)) return;
    lines.push(
      `${indent}  ${setCall}({ id: '${nodeName}', portName: '${portName}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, ${resultVar}.${portName});`
    );
  });
  lines.push(`${indent}  ctx.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${nodeName}',`);
  lines.push(`${indent}    id: '${nodeName}',`);
  lines.push(`${indent}    executionIndex: ${safeNodeName}Idx,`);
  lines.push(`${indent}    status: 'SUCCEEDED',`);
  lines.push(`${indent}  });`);
  const hasOnSuccess = node.outputs.hasOwnProperty(RESERVED_PORT_NAMES.ON_SUCCESS);
  const hasOnFailure = node.outputs.hasOwnProperty(RESERVED_PORT_NAMES.ON_FAILURE);
  if (hasOnSuccess || hasOnFailure) {
    if (hasOnSuccess) {
      lines.push(
        `${indent}  ${setCall}({ id: '${nodeName}', portName: '${RESERVED_PORT_NAMES.ON_SUCCESS}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, true);`
      );
    }
    if (hasOnFailure) {
      lines.push(
        `${indent}  ${setCall}({ id: '${nodeName}', portName: '${RESERVED_PORT_NAMES.ON_FAILURE}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, false);`
      );
    }
  }
  lines.push(`${indent}} catch (error: unknown) {`);
  lines.push(`${indent}  ctx.sendStatusChangedEvent({`);
  lines.push(`${indent}    nodeTypeName: '${nodeName}',`);
  lines.push(`${indent}    id: '${nodeName}',`);
  lines.push(`${indent}    executionIndex: ${safeNodeName}Idx,`);
  lines.push(`${indent}    status: 'FAILED',`);
  lines.push(`${indent}  });`);
  lines.push(`${indent}  ctx.sendLogErrorEvent({`);
  lines.push(`${indent}    nodeTypeName: '${nodeName}',`);
  lines.push(`${indent}    id: '${nodeName}',`);
  lines.push(`${indent}    executionIndex: ${safeNodeName}Idx,`);
  lines.push(`${indent}    error: error instanceof Error ? error.message : String(error),`);
  lines.push(`${indent}  });`);
  if (hasOnSuccess || hasOnFailure) {
    if (hasOnSuccess) {
      lines.push(
        `${indent}  ${setCall}({ id: '${nodeName}', portName: '${RESERVED_PORT_NAMES.ON_SUCCESS}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, false);`
      );
    }
    if (hasOnFailure) {
      lines.push(
        `${indent}  ${setCall}({ id: '${nodeName}', portName: '${RESERVED_PORT_NAMES.ON_FAILURE}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, true);`
      );
    }
  }
  const hasOnFailureConnection = workflow.connections.some(
    (conn) => conn.from.node === nodeName && isFailurePort(conn.from.port)
  );
  if (hasOnFailureConnection) {
    lines.push(`${indent}  `);
  } else {
    lines.push(`${indent}  throw error;`);
  }
  lines.push(`${indent}}`);
}

export function buildExecutionContextReturnForBranch(
  workflow: TWorkflowAST,
  lines: string[],
  isAsync: boolean,
  branchName: string,
  indent: string,
  executedNodes: string[]
): string {
  const getCall = isAsync ? 'await ctx.getVariable' : 'ctx.getVariable';
  const exitConnections = workflow.connections.filter((conn) => isExitNode(conn.to.node));
  const returnProps: string[] = [];
  exitConnections.forEach((conn) => {
    const exitPort = conn.to.port;
    const sourceNode = conn.from.node;
    const sourcePort = conn.from.port;
    const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
    // Get exit port type for type casting
    const exitPortDef = workflow.exitPorts[exitPort];
    const exitPortType =
      exitPortDef?.tsType || (exitPortDef ? mapToTypeScript(exitPortDef.dataType) : 'unknown');
    if (!executedNodes.includes(sourceNode) && !isStartNode(sourceNode)) {
      returnProps.push(`${exitPort}: undefined`);
    } else {
      const varName = `exit_${exitPort}_${branchName}`;
      lines.push(
        `${indent}const ${varName} = ${sourceIdx} !== undefined ? ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx} }) : undefined;`
      );
      // Cast to the exit port's declared type for type safety
      returnProps.push(`${exitPort}: ${varName} as ${exitPortType}`);
    }
  });
  return `{ ${returnProps.join(', ')} }`;
}
