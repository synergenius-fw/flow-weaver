/**
 * Node argument generation.
 *
 * buildNodeArgumentsWithContext resolves the argument list of a node call. A
 * FUNCTION-typed scoped port becomes a closure (generateScopeFunctionClosure),
 * and that closure builds the arguments of each child node with
 * buildNodeArgumentsWithContext again. The two are one recursive algorithm, so
 * they live in one module; code-utils keeps the leaf helpers both use.
 */

import type { TNodeTypeAST, TWorkflowAST, TNodeInstanceAST, TDataType } from '../ast';
import {
  RESERVED_PORT_NAMES,
  isStartNode,
  isExitNode,
  isExecutePort,
  isSuccessPort,
  isFailurePort,
} from '../constants';
import { findAllBranchingNodes, findNodesInBranch, performKahnsTopologicalSort, buildControlFlowGraph } from './control-flow';
import { getCoercionWrapper, toValidIdentifier, nodeResultVar } from './code-utils';
import { emitDurableNodeCall } from './node-invocation';
import { mapToTypeScript } from '../types/type-mappings';
import { findExpressionReferences, rewriteExpressionReferences } from '../parser/expression-references';

/**
 * Resolve the dataType of a source port by looking up the node instance -> node type -> outputs.
 */
function resolveSourcePortDataType(
  workflow: TWorkflowAST,
  sourceNodeId: string,
  sourcePort: string,
): TDataType | undefined {
  if (isStartNode(sourceNodeId)) {
    return workflow.startPorts?.[sourcePort]?.dataType;
  }
  if (isExitNode(sourceNodeId)) {
    return workflow.exitPorts?.[sourcePort]?.dataType;
  }
  const instance = workflow.instances.find((i) => i.id === sourceNodeId);
  if (!instance) return undefined;
  const nodeType = workflow.nodeTypes.find(
    (nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType,
  );
  if (!nodeType) return undefined;
  return nodeType.outputs?.[sourcePort]?.dataType;
}

/**
 * Resolve the TypeScript type of a value read out of an expression reference
 * (`node.port` inside an `[expr: ...]` annotation). Mirrors the
 * `Parameters<typeof fn>[N]` trick used for plain connections: a node
 * instance's function is always in scope in generated code, so its return
 * type is a safe way to name a non-primitive output type without risking a
 * bare type name from a module that isn't imported. Start has no function to
 * reference, so its declared `tsType` is used directly (same caveat the rest
 * of the generator already accepts for Start ports).
 */
function resolveReferencedPortType(workflow: TWorkflowAST, sourceNodeId: string, sourcePort: string): string {
  const dataType = resolveSourcePortDataType(workflow, sourceNodeId, sourcePort);
  if (!dataType) return 'any';
  if (isStartNode(sourceNodeId)) {
    return mapToTypeScript(dataType, workflow.startPorts?.[sourcePort]?.tsType);
  }
  const instance = workflow.instances.find((i) => i.id === sourceNodeId);
  const nodeType = instance
    ? workflow.nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType)
    : undefined;
  const tsType = nodeType?.outputs?.[sourcePort]?.tsType;
  const rawPortType = mapToTypeScript(dataType, tsType);
  const isPrimitive = /^(string|number|boolean|void|unknown|any|never|null|undefined)(\[\])?$/.test(rawPortType);
  if (isPrimitive || !nodeType) return rawPortType;
  return `Awaited<ReturnType<typeof ${nodeType.functionName}>>['${sourcePort}']`;
}

function isPullExecutionSource(workflow: TWorkflowAST, sourceNodeId: string): boolean {
  const instance = workflow.instances.find((candidate) => candidate.id === sourceNodeId);
  if (!instance) return false;
  const nodeType = workflow.nodeTypes.find((candidate) => candidate.name === instance.nodeType);
  return Boolean(instance.config?.pullExecution ?? nodeType?.defaultConfig?.pullExecution);
}

/**
 * Whether a source node may not have run by the time a reader reads it.
 *
 * A node inside a branch region runs only on the arm that was taken, so a
 * reader reachable from more than one arm -- a convergence node -- can be
 * asked for a port belonging to a node that never ran. Its execution index is
 * then `undefined`, and addressing it at that index is not a wire value: the
 * continuation validator refuses the whole run over a read the reader was
 * prepared to find empty.
 *
 * This mirrors the condition the Exit path already applies to the same
 * question. It is deliberately about the SOURCE's reachability rather than the
 * reading port's optionality: a required port can be fed by a node that did
 * not run, which is exactly the case that used to slip through.
 */
function sourceMayNotHaveExecuted(
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  sourceNodeId: string,
): boolean {
  if (isStartNode(sourceNodeId) || isExitNode(sourceNodeId)) return false;

  const branchingNodes = findAllBranchingNodes(workflow, nodeTypes);
  if (branchingNodes.has(sourceNodeId)) return true;

  const allInstanceIds = new Set(workflow.instances.map((instance) => instance.id));
  for (const branchInstanceId of branchingNodes) {
    for (const port of [RESERVED_PORT_NAMES.ON_SUCCESS, RESERVED_PORT_NAMES.ON_FAILURE]) {
      const inBranch = findNodesInBranch(
        branchInstanceId,
        port,
        workflow,
        allInstanceIds,
        branchingNodes,
      );
      if (inBranch.has(sourceNodeId)) return true;
    }
  }
  return false;
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
  production?: boolean;
  abortSignalExpression?: string;
  runtimeContextExpression?: string;
};

/**
 * Builds the argument list for a node function call by resolving input port values.
 *
 * This function is central to code generation - it determines where each input port
 * gets its value from: connections, expressions, defaults, or execution strategies.
 *
 * ## Resolution Priority (per port):
 * 1. **Skip Ports**: If port is in skipPorts set, use pre-declared variable
 * 2. **Instance Expression**: Check instance.config.portConfigs for constant expressions
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
 * - **CUSTOM**: Uses executionSignal expression
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
    production = false,
    abortSignalExpression = 'ctx.getAbortSignal()',
    runtimeContextExpression = 'ctx',
  } = opts;
  const safeId = toValidIdentifier(id);
  const inputConnections = workflow.connections.filter((conn) => conn.to.node === id);
  const args: string[] = [];

  // Find instance for checking instance-level constant expressions
  const instance = workflow.instances.find((i) => i.id === id);
  const getInstancePortConfig = (portName: string) =>
    instance?.config?.portConfigs?.find(
      (pc) => pc.portName === portName && (pc.direction == null || pc.direction === 'INPUT'),
    );
  const getSourceNodeTypeName = (sourceNode: string): string => {
    if (isStartNode(sourceNode)) return 'Start';
    const sourceInstance = workflow.instances.find((candidate) => candidate.id === sourceNode);
    const sourceNodeType = workflow.nodeTypes.find(
      (candidate) => candidate.name === sourceInstance?.nodeType || candidate.functionName === sourceInstance?.nodeType,
    );
    return sourceNodeType?.functionName ?? sourceInstance?.nodeType ?? sourceNode;
  };

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
        `${indent}${setCall}({ id: '${id}', portName: 'execute', executionIndex: ${safeId}Idx, nodeTypeName: '${effectiveNodeTypeName}', durable: false }, true);`,
      );
    }
    // Don't push execute to args - expression _impl doesn't receive it
  } else if (skipPorts?.has('execute')) {
    // Execute was pre-handled (e.g., in scope functions)
    args.push(`${safeId}_execute`);
  } else if (executeConnections.length > 0) {
    // Execute port has connections - use them
    const varName = `${safeId}_execute`;

    if (executeConnections.length === 1) {
      const conn = executeConnections[0];
      const sourceNode = conn.from.node;
      const sourcePort = conn.from.port;
      const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
      const isConstSource = isStartNode(sourceNode) || sourceNode === instanceParent;
      if (isConstSource) {
        lines.push(
          `${indent}const ${varName} = ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' }) as boolean;`,
        );
      } else {
        // Non-const source may be undefined (CANCELLED branch) — guard with false default
        lines.push(
          `${indent}const ${varName} = ${sourceIdx} !== undefined ? ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' }) as boolean : false;`,
        );
      }
    } else {
      // Multiple execute connections — coalesce with ||, each guarded
      const parts = executeConnections.map((conn) => {
        const sourceNode = conn.from.node;
        const sourcePort = conn.from.port;
        const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
        const isConstSource = isStartNode(sourceNode) || sourceNode === instanceParent;
        if (isConstSource) {
          return `(${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' }) as boolean)`;
        }
        return `(${sourceIdx} !== undefined ? ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' }) as boolean : false)`;
      });
      lines.push(`${indent}const ${varName} = ${parts.join(' || ')};`);
    }
    // Emit VARIABLE_SET for execute input port
    if (emitInputEvents) {
      lines.push(
        `${indent}${setCall}({ id: '${id}', portName: 'execute', executionIndex: ${safeId}Idx, nodeTypeName: '${effectiveNodeTypeName}', durable: false }, ${varName});`,
      );
    }
    args.push(varName);
  } else {
    // Default execute to true - still emit event for the default value
    if (emitInputEvents) {
      lines.push(
        `${indent}${setCall}({ id: '${id}', portName: 'execute', executionIndex: ${safeId}Idx, nodeTypeName: '${effectiveNodeTypeName}', durable: false }, true);`,
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
          `${indent}${setCall}({ id: '${id}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${effectiveNodeTypeName}', durable: false }, ${varName});`,
        );
      }
    };

    if (hasInstanceExpression) {
      // Instance-level expression takes priority
      let expr = String(instancePortConfig!.expression);

      // Upstream references (`Start.x`, `node.port`) inside the expression are
      // data dependencies of this port. The parser has already validated them
      // and, unless a same-name @path edge covered the pair, flagged them
      // `derived`. Either way the reference names a node whose value lives in
      // the context, not a JavaScript variable in scope, so it must be fetched
      // and substituted. Keying the substitution off the expression text (what
      // is actually referenced) rather than off the `derived` flag is what
      // makes a same-name reference like factor="cfg.factor" work: @path
      // creates that connection as a plain edge, so it is never flagged
      // derived, but the identifier still has to be fetched.
      const referenceableRoots = new Set<string>(['Start', ...workflow.instances.map((inst) => inst.id)]);
      const isRealPort = (root: string, port: string): boolean => {
        if (isExecutePort(port) || isSuccessPort(port) || isFailurePort(port)) return false;
        if (isStartNode(root)) return port in (workflow.startPorts ?? {});
        const sourceInstance = workflow.instances.find((inst) => inst.id === root);
        const sourceType = sourceInstance
          ? workflow.nodeTypes.find((nt) => nt.name === sourceInstance.nodeType || nt.functionName === sourceInstance.nodeType)
          : undefined;
        return !!sourceType && port in sourceType.outputs;
      };
      const refs = findExpressionReferences(expr, referenceableRoots).filter(
        (ref) => ref.root !== id && isRealPort(ref.root, ref.port),
      );
      if (refs.length > 0) {
        const fetched = new Map<string, string>();
        for (const ref of refs) {
          const key = `${ref.root}.${ref.port}`;
          if (fetched.has(key)) continue;
          const refVar = `${safeId}_${portName}_ref_${toValidIdentifier(ref.root)}_${toValidIdentifier(ref.port)}`;
          const sourceIdx = isStartNode(ref.root) ? 'startIdx' : `${toValidIdentifier(ref.root)}Idx`;
          const isConstSource = isStartNode(ref.root) || ref.root === instanceParent;
          const sourceExecutionIndex = isPullExecutionSource(workflow, ref.root)
            ? `${sourceIdx} ?? 0`
            : `${sourceIdx}${isConstSource ? '' : '!'}`;
          const refType = resolveReferencedPortType(workflow, ref.root, ref.port);
          lines.push(
            `${indent}const ${refVar} = ${getCall}({ id: '${ref.root}', portName: '${ref.port}', executionIndex: ${sourceExecutionIndex}, nodeTypeName: '${getSourceNodeTypeName(ref.root)}' }) as ${refType};`,
          );
          fetched.set(key, refVar);
        }
        expr = rewriteExpressionReferences(expr, refs, (ref) => fetched.get(`${ref.root}.${ref.port}`)!);
      }

      // Type the value as the node declares the port, as the other input
      // paths do; a referenced upstream port can be typed more loosely (e.g.
      // `object` where the port wants `Record<string, unknown>`).
      const rawExprType = mapToTypeScript(portConfig.dataType, portConfig.tsType);
      const exprPortType = /^(string|number|boolean|void|unknown|any|never|null|undefined)(\[\])?$/.test(rawExprType)
        ? rawExprType
        : `Parameters<typeof ${node.functionName}>[${args.length}]`;
      // Check if expression is a function (arrow or regular)
      const isFunction = expr.includes('=>') || expr.trim().startsWith('function');
      if (isFunction) {
        lines.push(`${indent}const ${varName} = ${isAsync ? 'await ' : ''}(${expr})(ctx) as ${exprPortType};`);
      } else {
        // Simple expression - evaluate directly
        lines.push(`${indent}const ${varName} = (${expr}) as ${exprPortType};`);
      }
      args.push(varName);
      emitSetEvent();
    } else if (connections.length > 0) {
      if (connections.length === 1) {
        const connection = connections[0];
        const sourceNode = connection.from.node;
        const sourcePort = connection.from.port;
        // Check if source node exists (Start node always exists)
        const sourceExists = isStartNode(sourceNode) || workflow.instances.some((i) => i.id === sourceNode);
        if (!sourceExists) {
          lines.push(`${indent}const ${varName} = undefined; // Source node '${sourceNode}' not found`);
          args.push(varName);
          emitSetEvent();
          return;
        }
        const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
        const isConstSource = isStartNode(sourceNode) || sourceNode === instanceParent;
        const nonNullAssert = isConstSource ? '' : '!';
        const sourceExecutionIndex = isPullExecutionSource(workflow, sourceNode)
          ? `${sourceIdx} ?? 0`
          : `${sourceIdx}${nonNullAssert}`;
        const rawPortType = mapToTypeScript(portConfig.dataType, portConfig.tsType);
        // Use Parameters<typeof fn>[N] for non-primitive types to avoid bare
        // type names from external modules that aren't in scope. The function
        // IS always imported and in scope, so this is always safe.
        const isPrimitive = /^(string|number|boolean|void|unknown|any|never|null|undefined)(\[\])?$/.test(rawPortType);
        const paramIndex = args.length; // Current position in the function's parameter list
        const portType = isPrimitive ? rawPortType : `Parameters<typeof ${node.functionName}>[${paramIndex}]`;

        // Guard against an undefined execution index whenever the source may
        // not have run: an optional port on a non-const source (DISJUNCTION
        // nodes), or any source inside a branch region, whose index is unset
        // on the arm that was not taken. The second case applies even to a
        // required port -- a convergence node reachable from several arms has
        // to read ports from all of them, and the ones belonging to arms that
        // did not run are legitimately absent.
        const needsGuard =
          !isConstSource &&
          (portConfig.optional || sourceMayNotHaveExecuted(workflow, workflow.nodeTypes, sourceNode));

        // For FUNCTION type ports, add resolution step to handle registry IDs
        if (portConfig.dataType === 'FUNCTION') {
          // Emit inline resolveFunction stub if not already declared in scope
          // This avoids a ReferenceError in self-contained generated code
          lines.push(
            `${indent}const __resolveFunction = typeof resolveFunction === 'function' ? resolveFunction : (p: unknown) => ({ fn: typeof p === 'function' ? p : () => { throw new Error('Cannot resolve function reference'); }, source: 'direct' as const });`,
          );
          const rawVarName = `${varName}_raw`;
          if (needsGuard) {
            lines.push(
              `${indent}const ${rawVarName} = ${sourceIdx} !== undefined ? ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' }) : undefined;`,
            );
            lines.push(
              `${indent}const ${varName}_resolved = ${rawVarName} !== undefined ? __resolveFunction(${rawVarName}) : undefined;`,
            );
            lines.push(`${indent}const ${varName} = ${varName}_resolved?.fn as ${portType};`);
          } else {
            lines.push(
              `${indent}const ${rawVarName} = ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceExecutionIndex}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' });`,
            );
            lines.push(`${indent}const ${varName}_resolved = __resolveFunction(${rawVarName});`);
            lines.push(`${indent}const ${varName} = ${varName}_resolved.fn as ${portType};`);
          }
        } else {
          // Check for coercion (explicit or auto)
          const sourceDataType = resolveSourcePortDataType(workflow, sourceNode, sourcePort);
          const coerceExpr = getCoercionWrapper(connection, sourceDataType, portConfig.dataType);
          if (needsGuard) {
            const getExpr = `${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' })`;
            const wrappedExpr = coerceExpr ? `${coerceExpr}(${getExpr})` : getExpr;
            // An optional port really is `T | undefined`. A required port gets
            // the type its node declares, like the unguarded read below: the
            // guard only covers an arm that did not run, and typing the value
            // `T | undefined` made compiled files fail `tsc --strict`.
            lines.push(
              portConfig.optional
                ? `${indent}const ${varName} = ${sourceIdx} !== undefined ? ${wrappedExpr} as ${portType} : undefined;`
                : `${indent}const ${varName} = (${sourceIdx} !== undefined ? ${wrappedExpr} : undefined) as ${portType};`,
            );
          } else {
            const getExpr = `${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceExecutionIndex}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' })`;
            if (coerceExpr) {
              lines.push(`${indent}const ${varName} = ${coerceExpr}(${getExpr}) as ${portType};`);
            } else {
              lines.push(`${indent}const ${varName} = ${getExpr} as ${portType};`);
            }
          }
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
        validConnections.forEach((conn) => {
          const sourceNode = conn.from.node;
          const sourcePort = conn.from.port;
          const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
          const getExpr = `${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${getSourceNodeTypeName(sourceNode)}' })`;

          // Per-connection coercion: each source gets its own coercion wrapper
          if (portConfig.dataType !== 'FUNCTION') {
            const sourceDataType = resolveSourcePortDataType(workflow, sourceNode, sourcePort);
            const coerceExpr = getCoercionWrapper(conn, sourceDataType, portConfig.dataType);
            const wrapped = coerceExpr ? `${coerceExpr}(${getExpr})` : getExpr;
            attempts.push(`(${sourceIdx} !== undefined ? ${wrapped} : undefined)`);
          } else {
            attempts.push(`(${sourceIdx} !== undefined ? ${getExpr} : undefined)`);
          }
        });
        // Combine the sources as the port's mergeStrategy asks. Each attempt is
        // already a guarded read that yields undefined when its source did not
        // run (a fan-in usually joins arms of a branch), so the strategies
        // that keep several values first drop the arms that never arrived.
        // Without a strategy the first value wins, as it always has.
        const strategy = portConfig.mergeStrategy;
        const arrived = `[${attempts.join(', ')}].filter((v) => v !== undefined)`;
        const ternary =
          strategy === 'LAST'
            ? `${arrived}.pop()`
            : strategy === 'COLLECT'
              ? arrived
              : strategy === 'CONCAT'
                ? `${arrived}.flat()`
                : strategy === 'MERGE'
                  ? `Object.assign({}, ...${arrived})`
                  : attempts.join(' ?? ');
        const rawPortType2 = mapToTypeScript(portConfig.dataType, portConfig.tsType);
        const isPrimitive2 = /^(string|number|boolean|void|unknown|any|never|null|undefined)(\[\])?$/.test(
          rawPortType2,
        );
        const paramIndex2 = args.length;
        const portType = isPrimitive2 ? rawPortType2 : `Parameters<typeof ${node.functionName}>[${paramIndex2}]`;

        // For FUNCTION type ports, add resolution step to handle registry IDs
        if (portConfig.dataType === 'FUNCTION') {
          lines.push(
            `${indent}const __resolveFunction = typeof resolveFunction === 'function' ? resolveFunction : (p: unknown) => ({ fn: typeof p === 'function' ? p : () => { throw new Error('Cannot resolve function reference'); }, source: 'direct' as const });`,
          );
          const rawVarName = `${varName}_raw`;
          lines.push(`${indent}const ${rawVarName} = ${ternary};`);
          lines.push(
            `${indent}const ${varName}_resolved = ${rawVarName} !== undefined ? __resolveFunction(${rawVarName}) : undefined;`,
          );
          lines.push(`${indent}const ${varName} = ${varName}_resolved?.fn as ${portType};`);
        } else {
          lines.push(`${indent}const ${varName} = (${ternary}) as ${portType};`);
        }
      }
      args.push(varName);
      emitSetEvent();
    } else if (portConfig.expression) {
      const expression = portConfig.expression;
      const isFunction = expression.includes('=>') || expression.trim().startsWith('function');
      const rawPortType3 = mapToTypeScript(portConfig.dataType, portConfig.tsType);
      const isPrimitive3 = /^(string|number|boolean|void|unknown|any|never|null|undefined)(\[\])?$/.test(rawPortType3);
      const paramIndex3 = args.length;
      const portType = isPrimitive3 ? rawPortType3 : `Parameters<typeof ${node.functionName}>[${paramIndex3}]`;
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
      const rawPortType4 = mapToTypeScript(portConfig.dataType, portConfig.tsType);
      const isPrimitive4 = /^(string|number|boolean|void|unknown|any|never|null|undefined)(\[\])?$/.test(rawPortType4);
      const paramIndex4 = args.length;
      const portType = isPrimitive4 ? rawPortType4 : `Parameters<typeof ${node.functionName}>[${paramIndex4}]`;
      lines.push(
        `${indent}let ${varName}: ${portType} = undefined as unknown as ${portType}; // Required port '${portName}' has no connection`,
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
    // Scope function async/sync must match what the PARENT NODE expects from its callback.
    // A sync parent node (e.g., forEach) calls the callback synchronously — if the scope
    // function is async it returns a Promise, causing `.field` accesses to yield `undefined`.
    // Only make the scope function async if the parent node itself is async or a child is async.
    // Do NOT inherit the workflow-level isAsync flag (which is true in dev mode for debugging).
    const hasAsyncChild = childInstances.some((child) => {
      const childNodeType = workflow.nodeTypes?.find(
        (nt) => nt.name === child.nodeType || nt.functionName === child.nodeType,
      );
      return childNodeType?.isAsync === true;
    });
    const scopeIsAsync = node.isAsync || hasAsyncChild;
    const scopeFunctionCode = generateScopeFunctionClosure(
      scopeName,
      id,
      node,
      workflow,
      childInstances,
      scopeIsAsync,
      production,
    );
    lines.push(`${indent}const ${scopeFunctionVar} = ${scopeFunctionCode};`);

    args.push(scopeFunctionVar);
  });

  if (node.receivesAbortSignal) {
    args.push(abortSignalExpression);
  }
  if (node.receivesRuntime) {
    // `${safeId}Idx` is assigned before this call, but it is declared
    // `number | undefined` and read inside a closure, where TypeScript cannot
    // carry the definite assignment through. Every other read of it on these
    // lines is outside a closure and narrows fine.
    args.push(
      `{ nodeId: '${id}', runtime: ${runtimeContextExpression}.getRuntime(), recursionDepth: __rd__, createNestedRuntime: (workflowId: string) => ${runtimeContextExpression}.createNestedRuntime(workflowId, '${id}', ${safeId}Idx!) }`,
    );
  }

  return args;
}

/**
 * Generate a scope function closure for a scoped port (e.g., forEach iteration callback).
 *
 * ## Scoped Port Architecture (Key Concept)
 *
 * Scoped nodes enable iteration patterns WITHOUT graph cycles. The port directions
 * are intentionally INVERTED from what you might expect:
 *
 * | Port Type | Direction | Purpose | Becomes in Closure |
 * |-----------|-----------|---------|-------------------|
 * | Scoped OUTPUT | From parent to children | Parameters like `item`, `start` | Function parameters |
 * | Scoped INPUT | From children to parent | Returns like `success`, `result` | Return object fields |
 *
 * **Why the inversion?**
 * - OUTPUT ports on the parent node emit data TO children (function params)
 * - INPUT ports on the parent node receive data FROM children (function returns)
 * - This allows the loop to happen in imperative code, not the graph
 *
 * ## Generated Closure Structure:
 * ```typescript
 * ((ctx) => {
 *   return async (start: boolean, item: unknown) => {
 *     // 1. Create isolated scope context (cleanScope=true)
 *     const scopedCtx = ctx.createScope('parent', parentIdx, 'scopeName', true);
 *
 *     // 2. Store scope parameters as variables (scoped OUTPUT ports)
 *     await scopedCtx.setVariable({ id: 'parent', portName: 'start', scope, side: 'start' }, start);
 *     await scopedCtx.setVariable({ id: 'parent', portName: 'item', scope, side: 'start' }, item);
 *
 *     // 3. Execute child nodes in topological order
 *     const childIdx = scopedCtx.addExecution('childNode');
 *     const childResult = await childFunction(execute, ...args);
 *
 *     // 4. Merge scope execution back to parent context
 *     ctx.mergeScope(scopedCtx);
 *
 *     // 5. Collect return values from scoped INPUT ports
 *     const result = scopedCtx.getVariable({ id: 'childNode', portName: 'result' });
 *
 *     // 6. Return collected values to parent
 *     return { success: true, failure: false, result };
 *   };
 * })(ctx)
 * ```
 *
 * ## Execution Context Isolation:
 * - `cleanScope=true`: Each call gets fresh variables (forEach pattern)
 * - `cleanScope=false`: Variables inherited from parent (node-level scopes)
 * - `mergeScope()`: Accumulates execution records back to parent after call
 *
 * ## Example forEach Pattern:
 * ```
 * forEach node declares:
 *   @scope processItem
 *   @output start scope:processItem    // → function param (trigger)
 *   @output item scope:processItem     // → function param (current item)
 *   @input success scope:processItem   // → return value (completion signal)
 *   @input processed scope:processItem // → return value (processed item)
 *
 * forEach implementation calls:
 *   for (const item of items) {
 *     const result = await processItem(true, item); // Generated closure!
 *     results.push(result.processed);
 *   }
 * ```
 *
 * @param scopeName - Name of the scope (e.g., "processItem", "iteration")
 * @param parentNodeId - ID of the parent node instance declaring this scope
 * @param parentNodeType - The parent node type definition with scoped port specs
 * @param workflow - The workflow AST containing child instances and connections
 * @param childInstances - Node instances nested in this scope (have parent.scope = scopeName)
 * @param isAsync - Whether to generate async closure (adds await, async keyword)
 * @param production - If true, omits debug instrumentation
 * @returns Generated closure code string to be used as a function argument
 */
export function generateScopeFunctionClosure(
  scopeName: string,
  parentNodeId: string,
  parentNodeType: TNodeTypeAST,
  workflow: TWorkflowAST,
  childInstances: TNodeInstanceAST[],
  isAsync: boolean,
  production: boolean,
): string {
  const lines: string[] = [];

  // NOTE: Scope function async/sync is determined by the caller (buildNodeArgumentsWithContext)
  // based on whether the parent node or its children are async. We do NOT force async in dev
  // mode here because the parent node function calls this callback synchronously. If we
  // return a Promise from an async closure, the parent gets Promise objects instead of values.

  // Extract scoped ports for this scope
  const scopedOutputPorts: string[] = []; // Parameters to the scope function
  const scopedInputPorts: string[] = []; // Return values from the scope function

  Object.entries(parentNodeType.outputs).forEach(([portName, portDef]) => {
    // Scoped OUTPUT ports become function parameters (include execute, but exclude FUNCTION type)
    if (portDef.scope === scopeName && portDef.dataType !== 'FUNCTION') {
      scopedOutputPorts.push(portName);
    }
  });

  Object.entries(parentNodeType.inputs).forEach(([portName, portDef]) => {
    // Include ALL scoped INPUT ports in return object, including success/failure
    // The callback type expects { success: boolean; failure: boolean; ...data }
    if (portDef.scope === scopeName) {
      scopedInputPorts.push(portName);
    }
  });

  // Generate function signature
  // Parameters: all scoped OUTPUT ports (what the parent provides to the scope)
  const awaitKeyword = isAsync ? 'async ' : '';
  const params = scopedOutputPorts
    .map((p) => {
      const portDef = parentNodeType.outputs[p];
      const portType = portDef ? mapToTypeScript(portDef.dataType, portDef.tsType) : 'unknown';
      return `${p}: ${portType}`;
    })
    .join(', ');

  // Start closure: ((ctx) => { ... })(ctx)
  lines.push(`((ctx) => {`);
  lines.push(`  return ${awaitKeyword}(${params}) => {`);
  lines.push(`    // Scope function body for '${scopeName}'`);
  lines.push(``);

  // Create scoped execution context for isolation
  // Pass cleanScope=true for per-port function scopes (each call gets fresh variables)
  // When the scope function is sync, override isAsync to false so context ops return values directly
  const safeParentId = toValidIdentifier(parentNodeId);
  lines.push(`    // Create scoped context for child nodes`);
  const isAsyncOverrideArg = isAsync ? '' : ', false';
  lines.push(
    `    const scopedCtx = ctx.createScope('${parentNodeId}', ${safeParentId}Idx!, '${scopeName}', true${isAsyncOverrideArg});`,
  );
  lines.push(``);

  // Set scope parameter values in execution context
  // These become available to child nodes as outputs from the parent node
  if (scopedOutputPorts.length > 0) {
    lines.push(`    // Set scope parameters as variables for child nodes`);
    scopedOutputPorts.forEach((portName) => {
      // Store using parent node ID so connections from parent.port work
      lines.push(`    const scopeParamIdx_${portName} = scopedCtx.addExecution('${parentNodeId}_param_${portName}');`);
      const setCall = isAsync ? `await scopedCtx.setVariable` : `scopedCtx.setVariable`;
      // Include scope and side for scoped OUTPUT ports (start side of scope)
      lines.push(
        `    ${setCall}({ id: '${parentNodeId}', portName: '${portName}', executionIndex: scopeParamIdx_${portName}, nodeTypeName: '${parentNodeType.functionName}', scope: '${scopeName}', side: 'start' }, ${portName});`,
      );
    });
    lines.push(``);
  }

  // Execute child nodes
  if (childInstances.length > 0) {
    lines.push(`    // Execute child nodes in topologically sorted order`);

    // Build control flow graph for children only
    const childIds = childInstances.map((c) => c.id);
    const childConnections = workflow.connections.filter((conn) => {
      // Include child-to-child connections
      if (childIds.includes(conn.from.node) && childIds.includes(conn.to.node)) {
        return true;
      }
      // Include connections from parent's scoped OUTPUT ports to children
      if (conn.from.node === parentNodeId && childIds.includes(conn.to.node)) {
        // Check if the source port is a scoped OUTPUT port for this scope
        const sourcePort = parentNodeType.outputs[conn.from.port];
        if (sourcePort && sourcePort.scope === scopeName) {
          return true;
        }
      }
      return false;
    });

    // Create a minimal workflow for topological sorting
    // Include a virtual parent instance so connections from parent ports can be resolved
    const parentVirtualInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: parentNodeId,
      nodeType: parentNodeType.functionName,
      parent: undefined,
    };
    const scopeWorkflow = {
      ...workflow,
      instances: [parentVirtualInstance, ...childInstances],
      connections: childConnections,
    };

    // Get node types for children
    const childNodeTypes = childInstances
      .map((c) => {
        return workflow.nodeTypes?.find((nt) => nt.name === c.nodeType || nt.functionName === c.nodeType);
      })
      .filter((nt): nt is TNodeTypeAST => nt !== undefined);

    const cfg = buildControlFlowGraph(scopeWorkflow, childNodeTypes);
    const sortedChildren = performKahnsTopologicalSort(cfg);

    sortedChildren.forEach((childId) => {
      const child = childInstances.find((c) => c.id === childId);
      if (!child) return;

      const childNodeType = workflow.nodeTypes?.find(
        (nt) => nt.name === child.nodeType || nt.functionName === child.nodeType,
      );
      if (!childNodeType) {
        lines.push(`    // WARNING: Node type '${child.nodeType}' not found for child '${child.id}'`);
        return;
      }

      const safeChildId = toValidIdentifier(child.id);
      // Never let the result local shadow the node type it calls.
      const childResultVar = nodeResultVar(safeChildId, child.nodeType);
      const awaitPrefix = isAsync ? 'await ' : '';
      const emitDebugHooks = !production;
      // Indentation increases when debug hooks wrap the child block
      let childIndent = '    ';

      lines.push(``);
      lines.push(`    // Execute: ${child.id} (${child.nodeType})`);

      // Live debugging may pause but cannot skip a durable boundary.
      if (emitDebugHooks) {
        const awaitHook = isAsync ? 'await ' : '';
        lines.push(`    ${awaitHook}__ctrl__.beforeNode('${child.id}', scopedCtx);`);
      }

      lines.push(`${childIndent}scopedCtx.checkAborted('${child.id}');`);
      const idxDecl = 'const ';
      lines.push(`${childIndent}${idxDecl}${safeChildId}Idx = scopedCtx.addExecution('${child.id}');`);
      lines.push(`${childIndent}if (scopedCtx.shouldExecute('${child.id}', '${child.nodeType}', ${safeChildId}Idx)) {`);
      childIndent = `${childIndent}  `;
      lines.push(`${childIndent}${awaitPrefix}scopedCtx.sendStatusChangedEvent({`);
      lines.push(`${childIndent}  nodeTypeName: '${child.nodeType}',`);
      lines.push(`${childIndent}  id: '${child.id}',`);
      lines.push(`${childIndent}  executionIndex: ${safeChildId}Idx,`);
      lines.push(`${childIndent}  status: 'RUNNING',`);
      lines.push(`${childIndent}});`);
      lines.push(`${childIndent}try {`);

      // Inner indentation: inside try block (childIndent + 2 spaces for try body)
      const tryIndent = `${childIndent}  `;

      // Pre-handle connections from parent scoped OUTPUT ports with correct index variables
      const argLines: string[] = [];
      const getCall = isAsync ? 'await scopedCtx.getVariable' : 'scopedCtx.getVariable';
      const childSetCall = isAsync ? `await scopedCtx.setVariable` : `scopedCtx.setVariable`;
      const preHandledPorts = new Set<string>();

      // Find connections from parent scoped OUTPUT ports to this child
      const parentConnections = workflow.connections.filter(
        (conn) => conn.from.node === parentNodeId && conn.to.node === child.id,
      );

      parentConnections.forEach((conn) => {
        const sourcePort = parentNodeType.outputs[conn.from.port];
        if (sourcePort && sourcePort.scope === scopeName) {
          // This is a scoped OUTPUT port - use scope parameter index
          const targetPort = conn.to.port;
          const varName = `${safeChildId}_${targetPort}`;
          const scopeParamIdxVar = `scopeParamIdx_${conn.from.port}`;
          // Get the target port type for the type cast
          const targetPortDef = childNodeType.inputs[targetPort];
          const portType = targetPortDef ? mapToTypeScript(targetPortDef.dataType, targetPortDef.tsType) : 'unknown';
          argLines.push(
            `${tryIndent}const ${varName} = ${getCall}({ id: '${parentNodeId}', portName: '${conn.from.port}', executionIndex: ${scopeParamIdxVar} }) as ${portType};`,
          );
          // Emit VARIABLE_SET for the child's INPUT port so breakpoints and
          // inspection work. `durable: false` keeps it live/debug-visible but
          // out of the serialized continuation — an input is not a graph-owned
          // output, and a durable resume authenticates outputs only. Without
          // this a scoped gate's `execute`/`prompt` inputs would be committed
          // as durable variables and a resumed loop iteration would be refused.
          // This matches buildNodeArgumentsWithContext, which sets every input
          // port `durable: false`; the pre-handled scope path must not diverge.
          argLines.push(
            `${tryIndent}${childSetCall}({ id: '${child.id}', portName: '${targetPort}', executionIndex: ${safeChildId}Idx, nodeTypeName: '${child.nodeType}', durable: false }, ${varName});`,
          );
          preHandledPorts.add(targetPort);
        }
      });

      // Build remaining arguments using buildNodeArgumentsWithContext
      const args = buildNodeArgumentsWithContext({
        node: childNodeType,
        workflow: scopeWorkflow,
        id: child.id,
        lines: argLines,
        indent: tryIndent,
        getCall,
        isAsync,
        instanceParent: child.parent ? `${child.parent.id}.${child.parent.scope}` : undefined,
        skipPorts: preHandledPorts,
        emitInputEvents: true,
        setCall: childSetCall,
        nodeTypeName: child.nodeType,
        production,
        runtimeContextExpression: 'scopedCtx',
      });

      // Add argument building lines
      argLines.forEach((line) => lines.push(line));

      // Call the child node function. Expression and regular children alike
      // take positional arguments (an expression has no execute argument).
      const childCall = {
        nodeType: childNodeType,
        instanceId: child.id,
        safeId: safeChildId,
        functionName: child.nodeType,
        resultVar: childResultVar,
        args,
        ctxVar: 'scopedCtx',
        indent: tryIndent,
        lines,
      };
      if (!emitDurableNodeCall(childCall, 'any')) {
        lines.push(`${tryIndent}const ${childResultVar} = ${awaitPrefix}${child.nodeType}(${args.join(', ')});`);
      }

      // Store outputs (including onSuccess/onFailure for debugging)
      // Expression nodes don't return onSuccess/onFailure — hardcode them
      if (childNodeType.expression) {
        Object.keys(childNodeType.outputs || {}).forEach((outPort) => {
          const portDef = childNodeType.outputs[outPort];
          if (portDef.failure || isFailurePort(outPort)) {
            // Failure ports always false on success (expression nodes always succeed)
            lines.push(
              `${tryIndent}${childSetCall}({ id: '${child.id}', portName: '${outPort}', executionIndex: ${safeChildId}Idx, nodeTypeName: '${child.nodeType}' }, false);`,
            );
          } else if (portDef.isControlFlow || isSuccessPort(outPort)) {
            // Success control flow ports always true (expression nodes always succeed)
            lines.push(
              `${tryIndent}${childSetCall}({ id: '${child.id}', portName: '${outPort}', executionIndex: ${safeChildId}Idx, nodeTypeName: '${child.nodeType}' }, true);`,
            );
          } else {
            // Data outputs read from result object
            lines.push(
              `${tryIndent}${childSetCall}({ id: '${child.id}', portName: '${outPort}', executionIndex: ${safeChildId}Idx, nodeTypeName: '${child.nodeType}' }, ${childResultVar}.${outPort});`,
            );
          }
        });
      } else {
        Object.keys(childNodeType.outputs || {}).forEach((outPort) => {
          lines.push(
            `${tryIndent}${childSetCall}({ id: '${child.id}', portName: '${outPort}', executionIndex: ${safeChildId}Idx, nodeTypeName: '${child.nodeType}' }, ${childResultVar}.${outPort});`,
          );
        });
      }

      // Add SUCCEEDED status event
      lines.push(`${tryIndent}${awaitPrefix}scopedCtx.sendStatusChangedEvent({`);
      lines.push(`${tryIndent}  nodeTypeName: '${child.nodeType}',`);
      lines.push(`${tryIndent}  id: '${child.id}',`);
      lines.push(`${tryIndent}  executionIndex: ${safeChildId}Idx,`);
      lines.push(`${tryIndent}  status: 'SUCCEEDED',`);
      lines.push(`${tryIndent}});`);
      lines.push(`${tryIndent}scopedCtx.commitNode('${child.id}', '${child.nodeType}', ${safeChildId}Idx);`);
      // Debug controller: afterNode hook for scoped children
      if (emitDebugHooks) {
        const awaitHook = isAsync ? 'await ' : '';
        lines.push(`${tryIndent}${awaitHook}__ctrl__.afterNode('${child.id}', scopedCtx);`);
      }
      lines.push(`${childIndent}} catch (error: unknown) {`);
      lines.push(
        `${tryIndent}if ((error as { code?: unknown })?.code === 'FLOW_WEAVER_DURABLE_GATE_YIELD') throw error;`,
      );
      lines.push(`${tryIndent}const isCancellation = CancellationError.isCancellationError(error);`);
      lines.push(`${tryIndent}${awaitPrefix}scopedCtx.sendStatusChangedEvent({`);
      lines.push(`${tryIndent}  nodeTypeName: '${child.nodeType}',`);
      lines.push(`${tryIndent}  id: '${child.id}',`);
      lines.push(`${tryIndent}  executionIndex: ${safeChildId}Idx,`);
      lines.push(`${tryIndent}  status: isCancellation ? 'CANCELLED' : 'FAILED',`);
      lines.push(`${tryIndent}});`);
      lines.push(`${tryIndent}if (!isCancellation) {`);
      lines.push(`${tryIndent}  scopedCtx.sendLogErrorEvent({`);
      lines.push(`${tryIndent}    nodeTypeName: '${child.nodeType}',`);
      lines.push(`${tryIndent}    id: '${child.id}',`);
      lines.push(`${tryIndent}    executionIndex: ${safeChildId}Idx,`);
      lines.push(`${tryIndent}    error: error instanceof Error ? error.message : String(error),`);
      lines.push(
        `${tryIndent}    code: typeof (error as { code?: unknown }).code === 'string' ? ((error as { code?: unknown }).code as string) : undefined,`,
      );
      lines.push(`${tryIndent}  });`);
      lines.push(`${tryIndent}}`);
      lines.push(`${tryIndent}throw error;`);
      lines.push(`${childIndent}}`);
      lines.push(`    }`);
    });
    lines.push(``);
  }

  // Merge scope back to parent context
  lines.push(`    // Merge scoped execution back to parent context`);
  lines.push(`    ctx.mergeScope(scopedCtx);`);
  lines.push(``);

  // Extract return values from scoped INPUT ports
  // These are the outputs of child nodes that become the scope function's return value
  lines.push(`    // Extract return values from child outputs`);
  const returnObj: string[] = [];
  // Read return values from scopedCtx (not ctx) because:
  // 1. scopedCtx still has all variables after mergeScope (merge copies, doesn't move)
  // 2. scopedCtx.isAsync matches the scope function's sync/async nature, so getVariable
  //    returns values directly (not Promises) when the scope function is sync
  const getCallAfterMerge = isAsync ? 'await scopedCtx.getVariable' : 'scopedCtx.getVariable';

  // Create per-iteration execution index for scoped exit ports (so each iteration shows separately in UI)
  // Use ctx (parent context) not scopedCtx so indices accumulate across iterations
  lines.push(`    const scopeExitIdx = ctx.addExecution('${parentNodeId}_scope_exit');`);

  scopedInputPorts.forEach((portName) => {
    // Find connections TO this scoped INPUT port FROM child nodes
    // The source of the connection tells us which child output to read
    const connection = workflow.connections.find((conn) => {
      return conn.to.port === portName && childInstances.some((c) => c.id === conn.from.node);
    });

    // Get the port definition for type casting
    const portDef = parentNodeType.inputs[portName];
    const portType = portDef ? mapToTypeScript(portDef.dataType, portDef.tsType) : 'unknown';

    if (connection) {
      const sourceNode = connection.from.node;
      const sourcePort = connection.from.port;
      const varName = `scopeReturn_${portName}`;
      // Find the child instance to get its node type name
      const childInstance = childInstances.find((c) => c.id === sourceNode);
      const sourceNodeTypeName = childInstance?.nodeType ?? '';
      const varAddr = `{ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${toValidIdentifier(sourceNode)}Idx, nodeTypeName: '${sourceNodeTypeName}' }`;

      // STEP ports (success/failure) may be undefined for expression nodes — use hasVariable with default
      const isStepPort = portName === 'success' || portName === 'failure';
      const defaultValue = portName === 'success' ? 'true' : portName === 'failure' ? 'false' : 'undefined';

      if (isStepPort) {
        lines.push(
          `    const ${varName} = scopedCtx.hasVariable(${varAddr}) ? ${getCallAfterMerge}(${varAddr}) as ${portType} : ${defaultValue};`,
        );
      } else {
        lines.push(`    const ${varName} = ${getCallAfterMerge}(${varAddr}) as ${portType};`);
      }

      // Emit VARIABLE_SET for the parent's scoped INPUT port (debug mode only)
      if (!production) {
        const setCallAfterMerge = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';
        lines.push(
          `    ${setCallAfterMerge}({ id: '${parentNodeId}', portName: '${portName}', executionIndex: scopeExitIdx, scope: '${scopeName}', side: 'exit', nodeTypeName: '${parentNodeType.functionName}' }, ${varName});`,
        );
      }

      returnObj.push(`${portName}: ${varName}`);
    } else {
      // No connection found - default STEP ports to true/false, others to undefined
      const defaultValue = portName === 'success' ? 'true' : portName === 'failure' ? 'false' : 'undefined';

      // Emit VARIABLE_SET for unconnected ports (debug mode only)
      if (!production) {
        const setCallAfterMerge = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';
        lines.push(
          `    ${setCallAfterMerge}({ id: '${parentNodeId}', portName: '${portName}', executionIndex: scopeExitIdx, scope: '${scopeName}', side: 'exit', nodeTypeName: '${parentNodeType.functionName}' }, ${defaultValue});`,
        );
      }

      returnObj.push(`${portName}: ${defaultValue}`);
    }
  });

  lines.push(`    return { ${returnObj.join(', ')} };`);
  lines.push(`  };`);
  lines.push(`})(ctx)`);

  return lines.join('\n    ');
}
