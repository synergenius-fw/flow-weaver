/**
 * Design Quality Validation Rules
 *
 * Deterministic, AST-inspectable rules that catch common workflow design problems.
 * A workflow can compile fine and still be poorly designed: missing error paths,
 * unbounded retries, fan-out without fan-in, dead-end branches.
 *
 * All rules are warnings or info. None block compilation.
 * Users can suppress any with @suppress.
 *
 * Rules:
 * 1. DESIGN_ASYNC_NO_ERROR_PATH - Async node has no onFailure connection
 * 2. DESIGN_SCOPE_NO_FAILURE_EXIT - Scope has no failure path out
 * 3. DESIGN_UNBOUNDED_RETRY - Retry scope has no visible attempt limit
 * 4. DESIGN_FANOUT_NO_FANIN - Fan-out to step targets with no merge back
 * 5. DESIGN_EXIT_DATA_UNREACHABLE - Exit data port has no connection and no pull-execution provider
 * 6. DESIGN_PULL_CANDIDATE - Node with no incoming step but consumed data outputs
 * 7. DESIGN_PULL_UNUSED - Node marked pullExecution but no downstream reads its output
 */

import type {
  TValidationRule,
  TValidationError,
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
} from '../ast/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveNodeType(
  ast: TWorkflowAST,
  instance: TNodeInstanceAST,
): TNodeTypeAST | undefined {
  return ast.nodeTypes.find(
    (nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType,
  );
}

function getOutgoing(ast: TWorkflowAST, nodeId: string, portName?: string) {
  return ast.connections.filter((c) => {
    if (c.from.node !== nodeId) return false;
    if (portName && c.from.port !== portName) return false;
    return true;
  });
}

function getIncoming(ast: TWorkflowAST, nodeId: string, portName?: string) {
  return ast.connections.filter((c) => {
    if (c.to.node !== nodeId) return false;
    if (portName && c.to.port !== portName) return false;
    return true;
  });
}

const STEP_PORTS = new Set(['execute', 'onSuccess', 'onFailure', 'start', 'success', 'failure']);

function isStepPort(portName: string, portDef?: { dataType?: string }): boolean {
  if (portDef?.dataType === 'STEP') return true;
  return STEP_PORTS.has(portName);
}

// ---------------------------------------------------------------------------
// Rule 1: Async Node Missing Error Path
// ---------------------------------------------------------------------------

/**
 * Async nodes (network, disk, AI) can fail. If onFailure is unconnected,
 * failures may be silently swallowed or crash the workflow.
 */
export const asyncNoErrorPathRule: TValidationRule = {
  name: 'DESIGN_ASYNC_NO_ERROR_PATH',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];

    for (const instance of ast.instances) {
      const nt = resolveNodeType(ast, instance);
      if (!nt) continue;
      if (!nt.isAsync) continue;
      if (!nt.hasFailurePort) continue;

      const failureConns = getOutgoing(ast, instance.id, 'onFailure');
      if (failureConns.length === 0) {
        errors.push({
          type: 'warning',
          code: 'DESIGN_ASYNC_NO_ERROR_PATH',
          message: `Async node '${instance.id}' has no onFailure connection. Async operations (network, disk, AI) can fail, and errors will be silently lost.`,
          node: instance.id,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 2: Scope With No Failure Exit
// ---------------------------------------------------------------------------

/**
 * A scope (retry/forEach) with no failure path out means if every iteration
 * fails, execution stalls with no way to surface the error.
 */
export const scopeNoFailureExitRule: TValidationRule = {
  name: 'DESIGN_SCOPE_NO_FAILURE_EXIT',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];

    for (const instance of ast.instances) {
      const nt = resolveNodeType(ast, instance);
      if (!nt) continue;

      // Only check nodes that define scopes
      const scopeNames = nt.scopes ?? (nt.scope ? [nt.scope] : []);
      if (scopeNames.length === 0) continue;

      // A scope parent needs an onFailure or failure port connected
      if (!nt.hasFailurePort) continue;

      const failureConns = getOutgoing(ast, instance.id, 'onFailure');
      // Also check 'failure' port used in some scope patterns
      const failureConns2 = getOutgoing(ast, instance.id, 'failure');

      if (failureConns.length === 0 && failureConns2.length === 0) {
        errors.push({
          type: 'warning',
          code: 'DESIGN_SCOPE_NO_FAILURE_EXIT',
          message: `Scope node '${instance.id}' has no failure path out. If all iterations fail, execution stalls with no error surfaced.`,
          node: instance.id,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 3: Unbounded Retry
// ---------------------------------------------------------------------------

/**
 * A scope used as a retry loop without a visible attempt limit could loop
 * indefinitely. Check if the parent node type name/function suggests retry
 * semantics but lacks a maxAttempts-like input or config.
 */
export const unboundedRetryRule: TValidationRule = {
  name: 'DESIGN_UNBOUNDED_RETRY',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const retryPatterns = /retry|repeat|loop|poll|backoff/i;

    for (const instance of ast.instances) {
      const nt = resolveNodeType(ast, instance);
      if (!nt) continue;

      const scopeNames = nt.scopes ?? (nt.scope ? [nt.scope] : []);
      if (scopeNames.length === 0) continue;

      // Only flag nodes that look like retry patterns
      const nameHint = `${nt.name} ${nt.functionName} ${nt.label ?? ''}`;
      if (!retryPatterns.test(nameHint)) continue;

      // Check for a maxAttempts/retries/limit input port
      const limitInputs = Object.keys(nt.inputs).filter((p) =>
        /max|limit|attempts|retries|count/i.test(p),
      );

      if (limitInputs.length === 0) {
        errors.push({
          type: 'warning',
          code: 'DESIGN_UNBOUNDED_RETRY',
          message: `Scope node '${instance.id}' appears to be a retry loop but has no visible attempt limit input. This could loop indefinitely.`,
          node: instance.id,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 4: Fan-Out Without Fan-In
// ---------------------------------------------------------------------------

/**
 * A node that fans out via step connections to multiple targets, but none of
 * those paths merge back to a shared downstream node. Data from parallel
 * branches may be lost.
 */
export const fanoutNoFaninRule: TValidationRule = {
  name: 'DESIGN_FANOUT_NO_FANIN',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];

    for (const instance of ast.instances) {
      const nt = resolveNodeType(ast, instance);

      // Find step output connections (excluding data ports)
      const stepOutConns = getOutgoing(ast, instance.id).filter((c) => {
        if (nt) {
          const portDef = nt.outputs[c.from.port];
          return isStepPort(c.from.port, portDef);
        }
        return isStepPort(c.from.port);
      });

      // Get unique step targets (excluding Exit, which is a natural terminus)
      const stepTargets = [...new Set(stepOutConns.map((c) => c.to.node))].filter(
        (n) => n !== 'Exit',
      );

      // Need at least 3 targets to be a meaningful fan-out (2 is just success/failure branching)
      if (stepTargets.length < 3) continue;

      // For each target, walk forward to find all reachable nodes
      const reachableSets = stepTargets.map((target) => getReachableNodes(ast, target));

      // Check if any node appears in multiple reachable sets (fan-in point)
      const allNodes = new Set<string>();
      let hasMerge = false;
      for (const reachable of reachableSets) {
        for (const node of reachable) {
          if (allNodes.has(node)) {
            hasMerge = true;
            break;
          }
        }
        if (hasMerge) break;
        for (const node of reachable) {
          allNodes.add(node);
        }
      }

      // Also check if any target has a merge strategy on its input ports
      if (!hasMerge) {
        for (const target of stepTargets) {
          const targetInst = ast.instances.find((i) => i.id === target);
          if (!targetInst) continue;
          const targetNt = resolveNodeType(ast, targetInst);
          if (!targetNt) continue;
          const hasMergePort = Object.values(targetNt.inputs).some((p) => p.mergeStrategy);
          if (hasMergePort) {
            hasMerge = true;
            break;
          }
        }
      }

      if (!hasMerge) {
        errors.push({
          type: 'warning',
          code: 'DESIGN_FANOUT_NO_FANIN',
          message: `Node '${instance.id}' fans out to ${stepTargets.length} step targets (${stepTargets.join(', ')}) but those paths never merge back. Data from parallel branches may be lost.`,
          node: instance.id,
        });
      }
    }

    return errors;
  },
};

/** Walk forward from a node to find all reachable nodes (BFS via step connections). */
function getReachableNodes(ast: TWorkflowAST, startNode: string): Set<string> {
  const visited = new Set<string>();
  const queue = [startNode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const conn of ast.connections) {
      if (conn.from.node === current && !visited.has(conn.to.node)) {
        queue.push(conn.to.node);
      }
    }
  }

  return visited;
}

// ---------------------------------------------------------------------------
// Rule 5: Exit Data Port Unreachable (Pull-Execution Aware)
// ---------------------------------------------------------------------------

/**
 * Extends UNREACHABLE_EXIT_PORT to consider pull execution. An exit data port
 * is fine if a pull-executed node is wired to provide it, even without a
 * step path.
 */
export const exitDataUnreachableRule: TValidationRule = {
  name: 'DESIGN_EXIT_DATA_UNREACHABLE',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const stepPorts = new Set(['onSuccess', 'onFailure']);

    for (const [portName, portDef] of Object.entries(ast.exitPorts)) {
      if (portDef.dataType === 'STEP') continue; // Step ports handled by core validator

      const incoming = getIncoming(ast, 'Exit', portName);
      if (incoming.length > 0) continue; // Has a direct connection, fine

      // Check if a pull-executed node provides this port
      const hasPullProvider = ast.instances.some((inst) => {
        const isPull =
          inst.config?.pullExecution ||
          resolveNodeType(ast, inst)?.defaultConfig?.pullExecution;
        if (!isPull) return false;

        // Check if this pull node has a data output connected to Exit.<portName>
        return getOutgoing(ast, inst.id).some(
          (c) => c.to.node === 'Exit' && c.to.port === portName,
        );
      });

      if (!hasPullProvider) {
        errors.push({
          type: 'warning',
          code: 'DESIGN_EXIT_DATA_UNREACHABLE',
          message: `Exit port '${portName}' has no incoming connection and no pull-execution node provides it. The output will be undefined.`,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 6: Pull Execution Candidate
// ---------------------------------------------------------------------------

/**
 * A node with no incoming step connections but data outputs consumed downstream
 * is a candidate for pullExecution. Without it, the node may never execute.
 */
export const pullCandidateRule: TValidationRule = {
  name: 'DESIGN_PULL_CANDIDATE',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];

    for (const instance of ast.instances) {
      const nt = resolveNodeType(ast, instance);
      if (!nt) continue;

      // Skip if already has pullExecution configured
      if (instance.config?.pullExecution || nt.defaultConfig?.pullExecution) continue;

      // Skip expression nodes (they are already pull-executed by nature)
      if (nt.expression) continue;

      // Check for incoming step connections
      const incomingStep = getIncoming(ast, instance.id).filter((c) => {
        const portDef = nt.inputs[c.to.port];
        return isStepPort(c.to.port, portDef);
      });

      if (incomingStep.length > 0) continue; // Has step trigger, not a candidate

      // Check if any data outputs are consumed downstream
      const dataOutputs = Object.keys(nt.outputs).filter((p) => !STEP_PORTS.has(p));
      const hasConsumedOutput = dataOutputs.some(
        (port) => getOutgoing(ast, instance.id, port).length > 0,
      );

      if (hasConsumedOutput) {
        errors.push({
          type: 'warning',
          code: 'DESIGN_PULL_CANDIDATE',
          message: `Node '${instance.id}' has no incoming step connection but its data outputs are consumed downstream. Consider adding [pullExecution: execute] so it executes on demand.`,
          node: instance.id,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 7: Unused Pull Execution
// ---------------------------------------------------------------------------

/**
 * A node marked with pullExecution but no downstream node reads its data output.
 * The node will never execute since pull execution requires a consumer.
 */
export const pullUnusedRule: TValidationRule = {
  name: 'DESIGN_PULL_UNUSED',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];

    for (const instance of ast.instances) {
      const nt = resolveNodeType(ast, instance);
      if (!nt) continue;

      const isPull =
        instance.config?.pullExecution || nt.defaultConfig?.pullExecution;
      if (!isPull) continue;

      // Check if any data output ports are connected
      const dataOutputs = Object.keys(nt.outputs).filter((p) => !STEP_PORTS.has(p));
      const hasConnectedOutput = dataOutputs.some(
        (port) => getOutgoing(ast, instance.id, port).length > 0,
      );

      if (!hasConnectedOutput) {
        errors.push({
          type: 'warning',
          code: 'DESIGN_PULL_UNUSED',
          message: `Node '${instance.id}' is marked with pullExecution but no downstream node reads its data output. It will never execute.`,
          node: instance.id,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const designValidationRules: TValidationRule[] = [
  asyncNoErrorPathRule,
  scopeNoFailureExitRule,
  unboundedRetryRule,
  fanoutNoFaninRule,
  exitDataUnreachableRule,
  pullCandidateRule,
  pullUnusedRule,
];

export function getDesignValidationRules(): TValidationRule[] {
  return designValidationRules;
}
