/**
 * Agent-Specific Validation Rules
 *
 * Custom TValidationRule implementations for agent/AI workflow patterns.
 * These run AFTER the built-in validator via the api/validate.ts custom rules injection.
 *
 * Rules:
 * 1. AGENT_LLM_MISSING_ERROR_HANDLER - LLM node's onFailure is unconnected
 * 2. AGENT_UNGUARDED_TOOL_EXECUTOR - Tool executor has no human-approval upstream
 * 3. AGENT_MISSING_MEMORY_IN_LOOP - Agent loop has LLM but no memory node
 * 4. AGENT_LLM_NO_FALLBACK - LLM onFailure goes directly to Exit
 * 5. AGENT_TOOL_NO_OUTPUT_HANDLING - Tool executor outputs are all unconnected
 */

import type {
  TValidationRule,
  TValidationError,
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
} from '../ast/types';
import { detectNodeRole, findNodesByRole } from './agent-detection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a node instance to its node type definition */
function resolveNodeType(
  ast: TWorkflowAST,
  instance: TNodeInstanceAST,
): TNodeTypeAST | undefined {
  return ast.nodeTypes.find(
    (nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType,
  );
}

/** Get all outgoing connections from a specific port of a node */
function getOutgoing(ast: TWorkflowAST, nodeId: string, portName?: string) {
  return ast.connections.filter((c) => {
    if (c.from.node !== nodeId) return false;
    if (portName && c.from.port !== portName) return false;
    return true;
  });
}

/** Get all instances whose node type has a given agent role */
function getInstancesByRole(
  ast: TWorkflowAST,
  role: ReturnType<typeof detectNodeRole>,
): Array<{ instance: TNodeInstanceAST; nodeType: TNodeTypeAST }> {
  const results: Array<{ instance: TNodeInstanceAST; nodeType: TNodeTypeAST }> = [];

  for (const instance of ast.instances) {
    const nt = resolveNodeType(ast, instance);
    if (nt && detectNodeRole(nt) === role) {
      results.push({ instance, nodeType: nt });
    }
  }

  return results;
}

/**
 * Get all transitive upstream node IDs for a given node.
 * Walks backwards through connections (BFS).
 */
function getUpstreamNodes(ast: TWorkflowAST, nodeId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const conn of ast.connections) {
      if (conn.to.node === current && !visited.has(conn.from.node)) {
        queue.push(conn.from.node);
      }
    }
  }

  visited.delete(nodeId); // exclude self
  return visited;
}

// ---------------------------------------------------------------------------
// Rule 1: Missing Error Handler
// ---------------------------------------------------------------------------

/**
 * LLM nodes should have their onFailure port connected.
 * LLM calls are inherently unreliable (rate limits, timeouts, model errors).
 * An unconnected onFailure means failures are silently swallowed.
 */
export const missingErrorHandlerRule: TValidationRule = {
  name: 'AGENT_LLM_MISSING_ERROR_HANDLER',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const llmInstances = getInstancesByRole(ast, 'llm');

    for (const { instance, nodeType } of llmInstances) {
      // Only check if the node type has an onFailure port
      if (!nodeType.hasFailurePort && !('onFailure' in nodeType.outputs)) {
        continue;
      }

      const failureConnections = getOutgoing(ast, instance.id, 'onFailure');
      if (failureConnections.length === 0) {
        errors.push({
          type: 'error',
          code: 'AGENT_LLM_MISSING_ERROR_HANDLER',
          message: `LLM node '${instance.id}' has no error handler — its onFailure port is unconnected. LLM calls can fail due to rate limits, timeouts, or model errors.`,
          node: instance.id,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 2: Unguarded Tool Executor
// ---------------------------------------------------------------------------

/**
 * Tool executors that perform actions should have a human-approval node upstream.
 * This is a warning, not an error — read-only tools may not need approval.
 */
export const unguardedToolExecutorRule: TValidationRule = {
  name: 'AGENT_UNGUARDED_TOOL_EXECUTOR',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const toolInstances = getInstancesByRole(ast, 'tool-executor');
    const approvalInstances = getInstancesByRole(ast, 'human-approval');

    // If no tool executors, nothing to check
    if (toolInstances.length === 0) return errors;

    // If no approval nodes at all, warn for every tool executor
    if (approvalInstances.length === 0) {
      for (const { instance } of toolInstances) {
        errors.push({
          type: 'warning',
          code: 'AGENT_UNGUARDED_TOOL_EXECUTOR',
          message: `Tool executor '${instance.id}' has no human approval gate upstream. If this node performs destructive actions, consider adding a human-approval node before it.`,
          node: instance.id,
        });
      }
      return errors;
    }

    // Check each tool executor for upstream approval
    for (const { instance: toolInstance } of toolInstances) {
      const upstream = getUpstreamNodes(ast, toolInstance.id);

      const hasUpstreamApproval = approvalInstances.some(({ instance: approvalInstance }) =>
        upstream.has(approvalInstance.id),
      );

      if (!hasUpstreamApproval) {
        errors.push({
          type: 'warning',
          code: 'AGENT_UNGUARDED_TOOL_EXECUTOR',
          message: `Tool executor '${toolInstance.id}' has no human approval gate upstream. If this node performs destructive actions, consider adding a human-approval node before it.`,
          node: toolInstance.id,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 3: Missing Memory in Loop
// ---------------------------------------------------------------------------

/**
 * An agent loop (scope) containing an LLM node but no memory node means
 * the LLM loses context between iterations. This is almost always a bug.
 */
export const missingMemoryInLoopRule: TValidationRule = {
  name: 'AGENT_MISSING_MEMORY_IN_LOOP',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];

    if (!ast.scopes) return errors;

    for (const [scopeName, instanceIds] of Object.entries(ast.scopes)) {
      let hasLlm = false;
      let hasMemory = false;

      for (const instId of instanceIds) {
        const instance = ast.instances.find((i) => i.id === instId);
        if (!instance) continue;

        const nt = resolveNodeType(ast, instance);
        if (!nt) continue;

        const role = detectNodeRole(nt);
        if (role === 'llm') hasLlm = true;
        if (role === 'memory') hasMemory = true;
      }

      if (hasLlm && !hasMemory) {
        errors.push({
          type: 'warning',
          code: 'AGENT_MISSING_MEMORY_IN_LOOP',
          message: `Scope '${scopeName}' contains an LLM node but no conversation memory node. The LLM will lose context between loop iterations.`,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 4: LLM Without Fallback
// ---------------------------------------------------------------------------

/**
 * An LLM node whose onFailure goes directly to Exit.onFailure means
 * any LLM error immediately aborts the workflow. Consider a retry or fallback.
 */
export const llmWithoutFallbackRule: TValidationRule = {
  name: 'AGENT_LLM_NO_FALLBACK',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const llmInstances = getInstancesByRole(ast, 'llm');

    for (const { instance, nodeType } of llmInstances) {
      if (!nodeType.hasFailurePort && !('onFailure' in nodeType.outputs)) {
        continue;
      }

      const failureConnections = getOutgoing(ast, instance.id, 'onFailure');

      // If unconnected, Rule 1 handles it — skip here
      if (failureConnections.length === 0) continue;

      // Check if ALL failure connections go directly to Exit
      const allToExit = failureConnections.every((c) => c.to.node === 'Exit');

      if (allToExit) {
        errors.push({
          type: 'warning',
          code: 'AGENT_LLM_NO_FALLBACK',
          message: `LLM node '${instance.id}' routes failures directly to Exit. Consider adding a retry node or fallback LLM provider for resilience.`,
          node: instance.id,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 5: Tool Executor No Output Handling
// ---------------------------------------------------------------------------

/**
 * A tool executor whose non-STEP output ports are all unconnected means
 * tool results are computed but never used — likely a wiring mistake.
 */
export const toolNoOutputHandlingRule: TValidationRule = {
  name: 'AGENT_TOOL_NO_OUTPUT_HANDLING',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const toolInstances = getInstancesByRole(ast, 'tool-executor');

    const stepPorts = new Set(['onSuccess', 'onFailure', 'execute']);

    for (const { instance, nodeType } of toolInstances) {
      const dataPorts = Object.keys(nodeType.outputs).filter((p) => !stepPorts.has(p));

      // If no data ports, nothing to check
      if (dataPorts.length === 0) continue;

      const hasAnyConnected = dataPorts.some(
        (port) => getOutgoing(ast, instance.id, port).length > 0,
      );

      if (!hasAnyConnected) {
        errors.push({
          type: 'warning',
          code: 'AGENT_TOOL_NO_OUTPUT_HANDLING',
          message: `Tool executor '${instance.id}' has no data output ports connected. Tool results (${dataPorts.join(', ')}) are being discarded.`,
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

/** All agent validation rules */
export const agentValidationRules: TValidationRule[] = [
  missingErrorHandlerRule,
  unguardedToolExecutorRule,
  missingMemoryInLoopRule,
  llmWithoutFallbackRule,
  toolNoOutputHandlingRule,
];

/**
 * Get all agent validation rules.
 * Convenience function for passing to validateWorkflow().
 */
export function getAgentValidationRules(): TValidationRule[] {
  return agentValidationRules;
}
