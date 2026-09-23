import type { TNodeTypeAST, TWorkflowAST, TNodeInstanceAST } from '../ast';
import { isSuccessPort, isFailurePort } from '../constants';
import { buildDurableGatePayload, buildNodeArgumentsWithContext, nodeResultVar, toValidIdentifier } from './code-utils';
import { performKahnsTopologicalSort, buildControlFlowGraph } from './control-flow';
import { mapToTypeScript } from '../type-mappings';

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

      // Call the child node function
      if (childNodeType.durableGate) {
        const trailingRuntimeArgs =
          (childNodeType.receivesAbortSignal ? 1 : 0) + (childNodeType.receivesRuntime ? 1 : 0);
        const gateArgs = args.slice(
          childNodeType.expression ? 0 : 1,
          trailingRuntimeArgs > 0 ? -trailingRuntimeArgs : undefined,
        );
        lines.push(
          `${tryIndent}const ${childResultVar} = scopedCtx.resolveGate('${childNodeType.durableGate}', '${child.id}', '${child.nodeType}', ${safeChildId}Idx, ${buildDurableGatePayload(gateArgs)} as unknown as WireValue) as any;`,
        );
      } else if (childNodeType.durableEffect) {
        lines.push(
          `${tryIndent}const ${childResultVar} = await scopedCtx.executeEffect('${child.id}', '${child.nodeType}', ${safeChildId}Idx, async (__operationKey__) => ${child.nodeType}(${[...args, '__operationKey__'].join(', ')}));`,
        );
      } else if (childNodeType.expression) {
        // Expression nodes use original signature (positional args, no execute)
        lines.push(`${tryIndent}const ${childResultVar} = ${awaitPrefix}${child.nodeType}(${args.join(', ')});`);
      } else {
        // Regular node call with positional arguments
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
