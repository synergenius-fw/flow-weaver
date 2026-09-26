/**
 * Node argument generation.
 *
 * buildNodeArgumentsWithContext resolves the argument list of a node call and
 * decides its order: execute first, then every data input in declaration
 * order, then one closure per scope, then the abort signal and runtime
 * context the node asks for. Each step is delegated:
 * - input-port-values: where a data input's value comes from
 * - connection-reads: how a connected value (and the execute signal) is read
 * - scope-closure / scoped-child: the closure a scoped port becomes
 *
 * A scope closure builds each child's arguments with
 * buildNodeArgumentsWithContext again. The closure modules receive it as a
 * parameter (generateScopeFunctionClosure passes it), so the recursion needs
 * no import cycle.
 */

import type { TNodeTypeAST, TWorkflowAST, TNodeInstanceAST } from '../ast';
import { isExecutePort } from '../constants';
import { toValidIdentifier } from './code-utils';
import { type ArgumentEmission, emitExecuteSignal } from './connection-reads';
import { emitInputEvent, emitInputPortValue } from './input-port-values';
import { emitScopeClosure } from './scope-closure';

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
  const em: ArgumentEmission = {
    node,
    workflow,
    id,
    safeId: toValidIdentifier(id),
    lines,
    indent,
    getCall,
    setCall,
    isAsync,
    instanceParent,
    emitInputEvents,
    eventNodeTypeName: nodeTypeName || node.functionName,
    inputConnections: workflow.connections.filter((conn) => conn.to.node === id),
  };
  const args: string[] = [];

  pushExecuteArgument(em, skipPorts, args);

  Object.keys(node.inputs).forEach((portName) => {
    if (isExecutePort(portName)) return;
    // Scoped INPUT ports are return values of the scope function, not parameters
    if (node.inputs[portName].scope) return;
    if (skipPorts?.has(portName)) {
      // Pre-handled by the caller: the local exists, only the argument is added
      args.push(`${em.safeId}_${portName}`);
      return;
    }
    const varName = emitInputPortValue(em, portName, args.length);
    args.push(varName);
    emitInputEvent(em, portName, varName);
  });

  pushScopeFunctionArguments(em, production, args);

  if (node.receivesAbortSignal) {
    args.push(abortSignalExpression);
  }
  if (node.receivesRuntime) {
    // `${safeId}Idx` is assigned before this call, but it is declared
    // `number | undefined` and read inside a closure, where TypeScript cannot
    // carry the definite assignment through. Every other read of it on these
    // lines is outside a closure and narrows fine.
    args.push(
      `{ nodeId: '${id}', runtime: ${runtimeContextExpression}.getRuntime(), recursionDepth: __rd__, createNestedRuntime: (workflowId: string) => ${runtimeContextExpression}.createNestedRuntime(workflowId, '${id}', ${em.safeId}Idx!) }`,
    );
  }

  return args;
}

/**
 * Pushes the execute argument. An expression node takes none (its _impl has a
 * data-only signature; the wrapper or workflow body guards execution) but
 * still reports the port as `true` so the UI shows it. A pre-handled execute
 * (scope functions) is passed through; connections are read by
 * emitExecuteSignal; with none, execute defaults to `true`.
 */
function pushExecuteArgument(em: ArgumentEmission, skipPorts: Set<string> | undefined, args: string[]): void {
  const executeConnections = em.inputConnections.filter((conn) => conn.to.port === 'execute');
  if (em.node.expression) {
    emitInputEvent(em, 'execute', 'true');
  } else if (skipPorts?.has('execute')) {
    args.push(`${em.safeId}_execute`);
  } else if (executeConnections.length > 0) {
    const varName = emitExecuteSignal(em, executeConnections);
    emitInputEvent(em, 'execute', varName);
    args.push(varName);
  } else {
    emitInputEvent(em, 'execute', 'true');
    args.push('true');
  }
}

/**
 * Pushes one scope function per distinct scope the node declares on its
 * inputs or outputs, emitting `const <id>_<scope>_scopeFn = <closure>;` for
 * each.
 *
 * The closure's async/sync must match what the PARENT NODE expects from its
 * callback. A sync parent node (e.g., forEach) calls the callback
 * synchronously; an async closure would hand it a Promise, and its `.field`
 * reads would yield `undefined`. So the closure is async only when the parent
 * node itself or one of the scope's children is async; the workflow-level
 * isAsync flag (true in dev mode for debugging) is deliberately not inherited.
 */
function pushScopeFunctionArguments(em: ArgumentEmission, production: boolean, args: string[]): void {
  const { node, workflow, id } = em;
  const scopeNames = new Set<string>();
  Object.values(node.inputs).forEach((portDef) => {
    if (portDef.scope) scopeNames.add(portDef.scope);
  });
  Object.values(node.outputs).forEach((portDef) => {
    if (portDef.scope) scopeNames.add(portDef.scope);
  });

  scopeNames.forEach((scopeName) => {
    const scopeFunctionVar = `${em.safeId}_${scopeName}_scopeFn`;
    const childInstances = workflow.instances.filter((inst) => {
      if (!inst.parent) return false;
      return inst.parent.id === id && inst.parent.scope === scopeName;
    });
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
    em.lines.push(`${em.indent}const ${scopeFunctionVar} = ${scopeFunctionCode};`);
    args.push(scopeFunctionVar);
  });
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
  return emitScopeClosure(
    scopeName,
    parentNodeId,
    parentNodeType,
    workflow,
    childInstances,
    isAsync,
    production,
    buildNodeArgumentsWithContext,
  );
}
