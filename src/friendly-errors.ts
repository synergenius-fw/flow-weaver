/**
 * Friendly error messages for the Flow Weaver validator.
 *
 * Maps validator error codes to beginner-friendly explanations with
 * contextual details extracted from the original error message.
 */

export interface TFriendlyError {
  /** Short title (3-5 words) */
  title: string;
  /** Contextual explanation with node/port names from the error */
  explanation: string;
  /** Actionable suggestion for fixing the issue */
  fix: string;
  /** Original validator error code */
  code: string;
}

interface ValidatorError {
  code: string;
  message: string;
  node?: string;
}

// ── Helpers to extract contextual info from error messages ──────────────

function extractQuoted(message: string): string[] {
  const matches = message.match(/"([^"]+)"/g);
  return matches ? matches.map((m) => m.replace(/"/g, '')) : [];
}

function extractTypes(message: string): { source: string; target: string } | null {
  // Match patterns like "from STRING to NUMBER" or "(STRING) ... (NUMBER)"
  const fromToMatch = message.match(/from (\w+) to (\w+)/i);
  if (fromToMatch) return { source: fromToMatch[1], target: fromToMatch[2] };

  const parenMatch = message.match(/\((\w+)\) .* \((\w+)\)/);
  if (parenMatch) return { source: parenMatch[1], target: parenMatch[2] };

  return null;
}

function extractCyclePath(message: string): string | null {
  const match = message.match(/:\s*(.+ -> .+)/);
  return match ? match[1] : null;
}

// ── Error code mappings ────────────────────────────────────────────────

type ErrorMapper = (error: ValidatorError) => TFriendlyError;

const errorMappers: Record<string, ErrorMapper> = {
  MISSING_WORKFLOW_NAME(error) {
    return {
      title: 'Missing Workflow Name',
      explanation: 'The workflow annotation is missing or has no name. Every workflow needs a name in the @flowWeaver workflow block.',
      fix: 'Add @flowWeaver workflow to the JSDoc block above your exported workflow function.',
      code: error.code,
    };
  },

  MISSING_FUNCTION_NAME(error) {
    return {
      title: 'Missing Function Name',
      explanation: 'The compiler found a @flowWeaver workflow annotation but the function is anonymous or not exported.',
      fix: 'Make sure your workflow is declared as `export function myWorkflowName(...)` — not anonymous or unexported.',
      code: error.code,
    };
  },

  MISSING_REQUIRED_INPUT(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    const portName = quoted[1] || 'unknown';
    return {
      title: 'Missing Required Input',
      explanation: `Node '${nodeName}' needs a value for '${portName}' but nothing is connected to it.`,
      fix: `Connect an output port from another node to '${portName}' on '${nodeName}', or mark the port as optional with @input [${portName}].`,
      code: error.code,
    };
  },

  STEP_PORT_TYPE_MISMATCH(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    return {
      title: 'Wrong Port Type',
      explanation: `Port '${portName}' expects a trigger signal but received data. Connect it to onSuccess or onFailure instead.`,
      fix: 'STEP ports carry control flow signals (like "go next"), not data. Connect data ports to data ports and STEP ports to STEP ports.',
      code: error.code,
    };
  },

  UNKNOWN_NODE_TYPE(error) {
    const quoted = extractQuoted(error.message);
    // Second quoted value is the node type name (first is the instance ID)
    const nodeTypeName = quoted[1] || quoted[0] || 'unknown';
    return {
      title: 'Unknown Node Type',
      explanation: `Node type '${nodeTypeName}' doesn't exist. Did you forget to add @flowWeaver nodeType above the function?`,
      fix: `Add /** @flowWeaver nodeType */ as a JSDoc comment above the function '${nodeTypeName}', or check that the function name is spelled correctly.`,
      code: error.code,
    };
  },

  UNKNOWN_SOURCE_NODE(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    return {
      title: 'Missing Source Node',
      explanation: `Connection references node '${nodeName}' which doesn't exist in this workflow.`,
      fix: `Add a @node annotation for '${nodeName}' in the workflow JSDoc, or fix the spelling in the @connect annotation.`,
      code: error.code,
    };
  },

  UNKNOWN_TARGET_NODE(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    return {
      title: 'Missing Target Node',
      explanation: `Connection references node '${nodeName}' which doesn't exist in this workflow.`,
      fix: `Add a @node annotation for '${nodeName}' in the workflow JSDoc, or fix the spelling in the @connect annotation.`,
      code: error.code,
    };
  },

  UNKNOWN_SOURCE_PORT(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    const portName = quoted[1] || quoted[0] || 'unknown';
    // If the message says 'does not have output port', first quoted is node, second is port
    const hasNodeAndPort = error.message.includes('does not have output port');
    const displayNode = hasNodeAndPort ? quoted[0] : nodeName;
    const displayPort = hasNodeAndPort ? quoted[1] : portName;
    return {
      title: 'Unknown Output Port',
      explanation: `Port '${displayPort}' doesn't exist on node '${displayNode}'. Check the spelling or add the port to the node type.`,
      fix: `Add @output ${displayPort} to the node type's JSDoc, or check the port name in the @connect annotation.`,
      code: error.code,
    };
  },

  UNKNOWN_TARGET_PORT(error) {
    const quoted = extractQuoted(error.message);
    const hasNodeAndPort = error.message.includes('does not have input port');
    const displayNode = hasNodeAndPort ? quoted[0] : (error.node || 'unknown');
    const displayPort = hasNodeAndPort ? quoted[1] : (quoted[0] || 'unknown');
    return {
      title: 'Unknown Input Port',
      explanation: `Port '${displayPort}' doesn't exist on node '${displayNode}'. Check the spelling or add the port to the node type.`,
      fix: `Add @input ${displayPort} to the node type's JSDoc, or check the port name in the @connect annotation.`,
      code: error.code,
    };
  },

  TYPE_MISMATCH(error) {
    const types = extractTypes(error.message);
    const source = types?.source || 'unknown';
    const target = types?.target || 'unknown';
    return {
      title: 'Type Mismatch',
      explanation: `Type mismatch: you're connecting a ${source} to a ${target}. The value will be automatically converted, but this might cause unexpected behavior.`,
      fix: `Add a conversion node between the two ports, or change one of the port types to match. You can also use @strictTypes to turn this into an error.`,
      code: error.code,
    };
  },

  CYCLE_DETECTED(error) {
    const cyclePath = extractCyclePath(error.message);
    const nodeName = error.node || 'unknown';
    return {
      title: 'Circular Dependency Found',
      explanation: `Circular dependency found. Node '${nodeName}' eventually connects back to itself, creating an infinite loop.${cyclePath ? ` Path: ${cyclePath}` : ''}`,
      fix: 'Break the cycle by removing one of the connections in the loop, or use a scoped node (like forEach) for intentional iteration.',
      code: error.code,
    };
  },

  UNUSED_NODE(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    return {
      title: 'Unused Node',
      explanation: `Node '${nodeName}' is defined but never used in the workflow. Consider removing it or connecting it.`,
      fix: `Connect '${nodeName}' to other nodes with @connect, or remove the @node annotation if it's no longer needed.`,
      code: error.code,
    };
  },

  NO_START_CONNECTIONS(error) {
    return {
      title: 'No Start Connections',
      explanation: 'Your workflow has no connections from the Start node. Nothing will execute.',
      fix: 'Add a @connect Start.execute -> yourNode.execute annotation to kick off the workflow.',
      code: error.code,
    };
  },

  NO_EXIT_CONNECTIONS(error) {
    return {
      title: 'No Exit Connections',
      explanation: "Your workflow has no connections to the Exit node. The workflow won't return any results.",
      fix: 'Add a @connect yourNode.onSuccess -> Exit.onSuccess annotation so the workflow produces output.',
      code: error.code,
    };
  },

  DUPLICATE_NODE_NAME(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    return {
      title: 'Duplicate Node Name',
      explanation: `Two node types have the same name '${nodeName}'. Each node type needs a unique function name.`,
      fix: `Rename one of the '${nodeName}' functions to give it a unique name.`,
      code: error.code,
    };
  },

  RESERVED_NODE_NAME(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    return {
      title: 'Reserved Name Used',
      explanation: `'Start' and 'Exit' are reserved names. Choose a different name for your node type.`,
      fix: `Rename '${nodeName}' to something other than 'Start' or 'Exit'. These names are used internally by the workflow engine.`,
      code: error.code,
    };
  },

  RESERVED_INSTANCE_ID(error) {
    const quoted = extractQuoted(error.message);
    const instanceId = quoted[0] || error.node || 'unknown';
    return {
      title: 'Reserved Instance ID',
      explanation: `Instance ID '${instanceId}' is reserved. 'Start' and 'Exit' are built-in nodes in every workflow.`,
      fix: `Choose a different instance ID, like 'startHandler' or 'exitProcessor'.`,
      code: error.code,
    };
  },

  INFERRED_NODE_TYPE(error) {
    const quoted = extractQuoted(error.message);
    const nodeTypeName = quoted[0] || error.node || 'unknown';
    return {
      title: 'Inferred Node Type',
      explanation: `Node type '${nodeTypeName}' was auto-inferred from the function signature. It works, but you lose explicit control over port names, types, and ordering.`,
      fix: `Add /** @flowWeaver nodeType @expression */ above the function for explicit port control.`,
      code: error.code,
    };
  },

  UNDEFINED_NODE(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    return {
      title: 'Undefined Node',
      explanation: `A connection references node '${nodeName}', but there's no @node annotation defining it.`,
      fix: `Add a @node annotation for '${nodeName}' in the workflow JSDoc, or remove the connections that reference it.`,
      code: error.code,
    };
  },

  TYPE_INCOMPATIBLE(error) {
    const types = extractTypes(error.message);
    const source = types?.source || 'unknown';
    const target = types?.target || 'unknown';
    return {
      title: 'Type Incompatible',
      explanation: `Type mismatch: ${source} to ${target}. With @strictTypes enabled, this is an error instead of a warning.`,
      fix: `Add a conversion node between the ports, change one of the port types, or remove @strictTypes to allow implicit coercions.`,
      code: error.code,
    };
  },

  UNUSUAL_TYPE_COERCION(error) {
    const types = extractTypes(error.message);
    const source = types?.source || 'unknown';
    const target = types?.target || 'unknown';
    return {
      title: 'Unusual Type Coercion',
      explanation: `Converting ${source} to ${target} is technically valid but semantically unusual and may produce unexpected behavior.`,
      fix: `Add an explicit conversion node if this is intentional, or use @strictTypes to enforce type safety.`,
      code: error.code,
    };
  },

  MULTIPLE_CONNECTIONS_TO_INPUT(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    const nodeName = quoted[1] || error.node || 'unknown';
    return {
      title: 'Multiple Input Connections',
      explanation: `Input port '${portName}' on node '${nodeName}' has multiple connections. Only one value can be received — use a merge node instead.`,
      fix: `Remove extra connections to '${nodeName}.${portName}', or add a merge/combine node to join multiple values before connecting.`,
      code: error.code,
    };
  },

  SCOPE_CONSISTENCY_ERROR(error) {
    const quoted = extractQuoted(error.message);
    const scopeName = quoted[0] || error.node || 'unknown';
    return {
      title: 'Scope Mismatch',
      explanation: `The forEach loop '${scopeName}' has mismatched inner connections. Each loop body needs matching start/end connections.`,
      fix: `Check that all scoped nodes inside '${scopeName}' have proper connections from the scope's output ports to input ports.`,
      code: error.code,
    };
  },

  OBJECT_TYPE_MISMATCH(error) {
    const quoted = extractQuoted(error.message);
    const sourceType = quoted[0] || 'unknown';
    const targetType = quoted[1] || 'unknown';
    return {
      title: 'Object Shape Mismatch',
      explanation: `The object shapes don't match. The source provides '${sourceType}' but the target expects '${targetType}'.`,
      fix: 'Verify the object structures are compatible. Add a transformation node if you need to reshape the data.',
      code: error.code,
    };
  },

  MUTABLE_NODE_TYPE_BINDING(error) {
    const quoted = extractQuoted(error.message);
    const nodeName = quoted[0] || error.node || 'unknown';
    const bindingKind = quoted[1] || 'let';
    return {
      title: 'Mutable Node Binding',
      explanation: `Node type '${nodeName}' is declared with '${bindingKind}' which allows accidental reassignment at runtime.`,
      fix: `Use 'function ${nodeName}(...)' or 'const ${nodeName} = ...' instead. Node types must be immutable.`,
      code: error.code,
    };
  },

  UNUSED_OUTPUT_PORT(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    const nodeName = quoted[1] || error.node || 'unknown';
    return {
      title: 'Unused Output Port',
      explanation: `Output port '${portName}' on node '${nodeName}' is not connected to anything. Its data will be discarded.`,
      fix: `Connect '${nodeName}.${portName}' to another node's input, or remove the @output annotation if it's not needed.`,
      code: error.code,
    };
  },

  UNREACHABLE_EXIT_PORT(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    return {
      title: 'Unreachable Exit Port',
      explanation: `Exit port '${portName}' has no incoming data. The workflow will return undefined for this output.`,
      fix: `Add a @connect annotation to send data to Exit.${portName}, or remove the @returns ${portName} annotation.`,
      code: error.code,
    };
  },

  MULTIPLE_EXIT_CONNECTIONS(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    return {
      title: 'Multiple Exit Connections',
      explanation: `Exit port '${portName}' receives data from multiple nodes. Only one value will be used, which may lead to unpredictable results.`,
      fix: `Use separate Exit ports for each source, or add a merge node to combine the values before connecting to Exit.${portName}.`,
      code: error.code,
    };
  },

  ANNOTATION_SIGNATURE_MISMATCH(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    const nodeName = quoted[1] || error.node || 'unknown';
    return {
      title: 'Optional Port Mismatch',
      explanation: `Port '${portName}' on '${nodeName}' is optional in the TypeScript signature but required in the annotation.`,
      fix: `Use @input [${portName}] (with brackets) to mark the port as optional in the annotation, matching the TypeScript signature.`,
      code: error.code,
    };
  },

  ANNOTATION_SIGNATURE_TYPE_MISMATCH(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    const nodeName = quoted[1] || error.node || 'unknown';
    const annotationType = quoted[2] || 'unknown';
    const sigType = quoted[3] || 'unknown';
    return {
      title: 'Annotation Type Mismatch',
      explanation: `Port '${portName}' on '${nodeName}' has type '${annotationType}' in the annotation but '${sigType}' in the TypeScript signature.`,
      fix: `Update the @input/@output annotation type to match the function signature, or change the signature type. The annotation and TypeScript types should agree.`,
      code: error.code,
    };
  },

  // ── Agent-specific rules ──────────────────────────────────────────────

  AGENT_LLM_MISSING_ERROR_HANDLER(error) {
    const nodeName = error.node || 'unknown';
    return {
      title: 'LLM Missing Error Handler',
      explanation: `LLM node '${nodeName}' has no error handler. LLM calls can fail due to rate limits, timeouts, or model errors, and failures will be silently swallowed.`,
      fix: `Connect ${nodeName}.onFailure to a retry node, fallback handler, or Exit.onFailure to handle LLM errors gracefully.`,
      code: error.code,
    };
  },

  AGENT_UNGUARDED_TOOL_EXECUTOR(error) {
    const nodeName = error.node || 'unknown';
    return {
      title: 'Unguarded Tool Executor',
      explanation: `Tool executor '${nodeName}' has no human approval gate upstream. If it performs destructive actions (writes, deletes, sends), this could be unsafe.`,
      fix: `Add a human-approval node before '${nodeName}' to gate destructive tool calls. If this tool is read-only, you can safely ignore this warning.`,
      code: error.code,
    };
  },

  AGENT_MISSING_MEMORY_IN_LOOP(error) {
    const quoted = extractQuoted(error.message);
    const scopeName = quoted[0] || 'the loop';
    return {
      title: 'No Memory in Agent Loop',
      explanation: `Loop scope '${scopeName}' contains an LLM node but no conversation memory. The LLM will lose context between loop iterations.`,
      fix: `Add a conversation-memory node inside the loop to persist messages between iterations, so the LLM retains context across loop cycles.`,
      code: error.code,
    };
  },

  AGENT_LLM_NO_FALLBACK(error) {
    const nodeName = error.node || 'unknown';
    return {
      title: 'LLM Failure Goes to Exit',
      explanation: `LLM node '${nodeName}' routes failures directly to Exit, meaning any LLM error immediately aborts the entire workflow.`,
      fix: `Add a retry node or fallback LLM provider between ${nodeName}.onFailure and Exit to improve resilience against transient LLM failures.`,
      code: error.code,
    };
  },

  AGENT_TOOL_NO_OUTPUT_HANDLING(error) {
    const nodeName = error.node || 'unknown';
    return {
      title: 'Tool Results Discarded',
      explanation: `Tool executor '${nodeName}' computes results but none of its data output ports are connected. Tool results are being thrown away.`,
      fix: `Connect the data output ports of '${nodeName}' (e.g., result, resultMessage) to downstream nodes, or remove this tool executor if its results aren't needed.`,
      code: error.code,
    };
  },

  LOSSY_TYPE_COERCION(error) {
    const types = extractTypes(error.message);
    const source = types?.source || 'unknown';
    const target = types?.target || 'unknown';
    return {
      title: 'Lossy Type Conversion',
      explanation: `Converting ${source} to ${target} may lose data or produce unexpected results (e.g., NaN, truncation).`,
      fix: `Add an explicit conversion node, or use @strictTypes on the workflow to enforce type safety and catch these at validation time.`,
      code: error.code,
    };
  },

  INVALID_EXIT_PORT_TYPE(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'onSuccess';
    return {
      title: 'Invalid Exit Port Type',
      explanation: `Exit port '${portName}' must be STEP type (control flow signal), but a different type was found. onSuccess and onFailure are control flow ports, not data ports.`,
      fix: `Connect a STEP-type output (like onSuccess or onFailure) to Exit.${portName}. Don't connect data ports to control flow ports.`,
      code: error.code,
    };
  },
};

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Get a friendly error object for a validator error, or null if the code is unmapped.
 */
export function getFriendlyError(error: {
  code: string;
  message: string;
  node?: string;
}): TFriendlyError | null {
  const mapper = errorMappers[error.code];
  if (!mapper) return null;
  return mapper(error);
}

/**
 * Format all validation errors/warnings with friendly messages.
 * Falls back to the original message for unmapped error codes.
 */
export function formatFriendlyDiagnostics(
  errors: Array<{ code: string; message: string; node?: string; type: 'error' | 'warning' }>
): string {
  if (errors.length === 0) return '';

  const lines: string[] = [];

  for (const error of errors) {
    const friendly = getFriendlyError(error);
    const severity = error.type === 'error' ? 'ERROR' : 'WARNING';

    if (friendly) {
      lines.push(`[${severity}] ${friendly.title}`);
      lines.push(`  ${friendly.explanation}`);
      lines.push(`  How to fix: ${friendly.fix}`);
      lines.push(`  Code: ${friendly.code}`);
    } else {
      lines.push(`[${severity}] ${error.code}`);
      lines.push(`  ${error.message}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
