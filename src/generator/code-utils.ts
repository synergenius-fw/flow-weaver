import type { TNodeTypeAST, TWorkflowAST, TMergeStrategy, TCoerceTargetType, TConnectionAST, TDataType } from '../ast';
import {
  RESERVED_PORT_NAMES,
  isStartNode,
  isExitNode,
  isExecutePort,
  isSuccessPort,
  isFailurePort,
} from '../constants';
import { findAllBranchingNodes, findNodesInBranch } from './control-flow';

/**
 * Encode positional durable-gate inputs without admitting JavaScript
 * `undefined` into the wire payload. The tagged representation preserves the
 * distinction between an omitted optional argument and an explicit null.
 */
export function buildDurableGatePayload(arguments_: readonly string[]): string {
  return `{ arguments: [${arguments_.join(', ')}].map((value) => value === undefined ? { absent: true } : { value }) }`;
}
import { generateScopeFunctionClosure } from './scope-function-generator';
import { mapToTypeScript } from '../type-mappings';
import { findExpressionReferences, rewriteExpressionReferences } from '../parser/expression-references';

/** Map coercion target type to inline JS expression */
const COERCION_EXPRESSIONS: Record<TCoerceTargetType, string> = {
  string: 'String',
  number: 'Number',
  boolean: 'Boolean',
  json: 'JSON.stringify',
  object: 'JSON.parse',
};

/** Map TDataType to TCoerceTargetType for auto-coercion */
const DATATYPE_TO_COERCE: Partial<Record<TDataType, TCoerceTargetType>> = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  OBJECT: 'object',
};

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
        nodeTypes,
      );
      if (inBranch.has(sourceNodeId)) return true;
    }
  }
  return false;
}

/**
 * Get the coercion expression to wrap a value, if coercion is needed.
 * Returns null if no coercion needed.
 *
 * Priority:
 * 1. Explicit coerce on the connection (from `as <type>` annotation)
 * 2. Auto-coercion for safe pairs:
 *    - anything -> STRING (String() never fails)
 *    - BOOLEAN -> NUMBER (well-defined: false->0, true->1)
 */
export function getCoercionWrapper(
  connection: TConnectionAST,
  sourceDataType: TDataType | undefined,
  targetDataType: TDataType | undefined,
): string | null {
  // Explicit coerce on connection
  if (connection.coerce) {
    return COERCION_EXPRESSIONS[connection.coerce];
  }

  // No auto-coercion if types are unknown or same
  if (!sourceDataType || !targetDataType || sourceDataType === targetDataType) return null;

  // Skip STEP and ANY ports — no coercion needed
  if (sourceDataType === 'STEP' || targetDataType === 'STEP') return null;
  if (sourceDataType === 'ANY' || targetDataType === 'ANY') return null;

  // Auto-coerce: anything -> STRING
  if (targetDataType === 'STRING' && sourceDataType !== 'STRING') {
    return 'String';
  }

  // Auto-coerce: BOOLEAN -> NUMBER
  if (sourceDataType === 'BOOLEAN' && targetDataType === 'NUMBER') {
    return 'Number';
  }

  return null;
}

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
 * Name the local that holds a node's call result.
 *
 * Normally `<nodeId>Result`, but that collides when a node's id plus "Result"
 * happens to equal the node type it calls -- e.g. `@node rec recResult` emits
 * `const recResult = recResult(...)`, whose `const` puts the function in the
 * temporal dead zone and throws "Cannot access 'recResult' before
 * initialization" at run time. Suffix the local in that case so it can never
 * shadow the callee.
 *
 * @param safeNodeName - The node id, already a valid identifier
 * @param functionName - The node type function this local's initializer calls
 */
export function nodeResultVar(safeNodeName: string, functionName: string): string {
  const candidate = `${safeNodeName}Result`;
  return candidate === functionName ? `${candidate}_` : candidate;
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
    bundleMode = false,
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
          lines.push(
            `${indent}const ${refVar} = ${getCall}({ id: '${ref.root}', portName: '${ref.port}', executionIndex: ${sourceExecutionIndex}, nodeTypeName: '${getSourceNodeTypeName(ref.root)}' }) as any;`,
          );
          fetched.set(key, refVar);
        }
        expr = rewriteExpressionReferences(expr, refs, (ref) => fetched.get(`${ref.root}.${ref.port}`)!);
      }

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
            lines.push(
              `${indent}const ${varName} = ${sourceIdx} !== undefined ? ${wrappedExpr} as ${portType} : undefined;`,
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
          lines.push(`${indent}const ${varName} = ${ternary} as ${portType};`);
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
    args.push(
      `{ nodeId: '${id}', runtime: ${runtimeContextExpression}.getRuntime(), recursionDepth: __rd__, createNestedRuntime: (workflowId: string) => ${runtimeContextExpression}.createNestedRuntime(workflowId, '${id}', ${safeId}Idx) }`,
    );
  }

  return args;
}

export function generateNodeWithExecutionContext(
  node: TNodeTypeAST,
  workflow: TWorkflowAST,
  lines: string[],
  isAsync: boolean,
  indent: string = '  ',
): void {
  const nodeName = node.functionName;
  const safeNodeName = toValidIdentifier(nodeName); // Sanitize for use as JS variable name
  const awaitPrefix = isAsync ? 'await ' : '';
  const getCall = isAsync ? 'await ctx.getVariable' : 'ctx.getVariable';
  const setCall = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';
  lines.push(`${indent}const ${safeNodeName}Idx = ctx.addExecution('${nodeName}');`);
  lines.push(`${indent}${awaitPrefix}ctx.sendStatusChangedEvent({`);
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
  const resultVar = nodeResultVar(safeNodeName, node.functionName);
  lines.push(`${indent}  const ${resultVar} = ${awaitPrefix}${node.functionName}(${args.join(', ')});`);
  Object.keys(node.outputs).forEach((portName) => {
    if (isSuccessPort(portName) || isFailurePort(portName)) return;
    lines.push(
      `${indent}  ${setCall}({ id: '${nodeName}', portName: '${portName}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, ${resultVar}.${portName});`,
    );
  });
  lines.push(`${indent}  ${awaitPrefix}ctx.sendStatusChangedEvent({`);
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
        `${indent}  ${setCall}({ id: '${nodeName}', portName: '${RESERVED_PORT_NAMES.ON_SUCCESS}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, true);`,
      );
    }
    if (hasOnFailure) {
      lines.push(
        `${indent}  ${setCall}({ id: '${nodeName}', portName: '${RESERVED_PORT_NAMES.ON_FAILURE}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, false);`,
      );
    }
  }
  lines.push(`${indent}} catch (error: unknown) {`);
  lines.push(`${indent}  ${awaitPrefix}ctx.sendStatusChangedEvent({`);
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
  lines.push(
    `${indent}    code: typeof (error as { code?: unknown }).code === 'string' ? ((error as { code?: unknown }).code as string) : undefined,`,
  );
  lines.push(`${indent}  });`);
  if (hasOnSuccess || hasOnFailure) {
    if (hasOnSuccess) {
      lines.push(
        `${indent}  ${setCall}({ id: '${nodeName}', portName: '${RESERVED_PORT_NAMES.ON_SUCCESS}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, false);`,
      );
    }
    if (hasOnFailure) {
      lines.push(
        `${indent}  ${setCall}({ id: '${nodeName}', portName: '${RESERVED_PORT_NAMES.ON_FAILURE}', executionIndex: ${safeNodeName}Idx, nodeTypeName: '${nodeName}' }, true);`,
      );
    }
  }
  const hasOnFailureConnection = workflow.connections.some(
    (conn) => conn.from.node === nodeName && isFailurePort(conn.from.port),
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
  executedNodes: string[],
): string {
  const getCall = isAsync ? 'await ctx.getVariable' : 'ctx.getVariable';
  const exitConnections = workflow.connections.filter((conn) => isExitNode(conn.to.node));
  const returnProps: string[] = [];
  exitConnections.forEach((conn) => {
    const exitPort = conn.to.port;
    const sourceNode = conn.from.node;
    const sourcePort = conn.from.port;
    const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
    const sourceInstance = workflow.instances.find((candidate) => candidate.id === sourceNode);
    const sourceNodeType = workflow.nodeTypes.find(
      (candidate) => candidate.name === sourceInstance?.nodeType || candidate.functionName === sourceInstance?.nodeType,
    );
    const sourceNodeTypeName = isStartNode(sourceNode)
      ? 'Start'
      : (sourceNodeType?.functionName ?? sourceInstance?.nodeType ?? sourceNode);
    // Get exit port type for type casting
    const exitPortDef = workflow.exitPorts[exitPort];
    const exitPortType = exitPortDef?.tsType || (exitPortDef ? mapToTypeScript(exitPortDef.dataType) : 'unknown');
    if (!executedNodes.includes(sourceNode) && !isStartNode(sourceNode)) {
      returnProps.push(`${exitPort}: undefined`);
    } else {
      const varName = `exit_${exitPort}_${branchName}`;
      lines.push(
        `${indent}const ${varName} = ${sourceIdx} !== undefined ? ${getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${sourceNodeTypeName}' }) : undefined;`,
      );
      // Cast to the exit port's declared type for type safety
      returnProps.push(`${exitPort}: ${varName} as ${exitPortType}`);
    }
  });
  return `{ ${returnProps.join(', ')} }`;
}
