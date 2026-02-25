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
  // New format: "from TypeName (ENUM) to TypeName (ENUM)" — extract the structural types
  const structuralMatch = message.match(/from (.+?) \(\w+\) to (.+?) \(\w+\)/);
  if (structuralMatch) return { source: structuralMatch[1], target: structuralMatch[2] };

  // Legacy format: "from ENUM to ENUM"
  const fromToMatch = message.match(/from (\w+) to (\w+)/i);
  if (fromToMatch) return { source: fromToMatch[1], target: fromToMatch[2] };

  // Parenthetical format with structural types: "(TypeName (ENUM)) ... (TypeName (ENUM))"
  const structuralParenMatch = message.match(/\((.+?) \(\w+\)\) .* \((.+?) \(\w+\)\)/);
  if (structuralParenMatch) return { source: structuralParenMatch[1], target: structuralParenMatch[2] };

  // Simple parenthetical format: "(ENUM) ... (ENUM)"
  const parenMatch = message.match(/\((\w+)\) .* \((\w+)\)/);
  if (parenMatch) return { source: parenMatch[1], target: parenMatch[2] };

  return null;
}

const COERCE_TARGET_TYPES: Record<string, string> = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  OBJECT: 'object',
};

/**
 * Build a concrete @coerce suggestion from error message context.
 * Returns null if not enough info is available.
 */
function buildCoerceSuggestion(quoted: string[], targetType: string): string | null {
  // We need at least a source node.port and target node.port from the error message
  // Validator messages typically include connection endpoints in quoted values
  if (quoted.length < 2) return null;

  // Look for port references (node.port patterns)
  const portRefPattern = /^[\w]+\.[\w]+$/;
  const portRefs = quoted.filter(q => portRefPattern.test(q));
  if (portRefs.length < 2) return null;

  const coerceType = COERCE_TARGET_TYPES[targetType.toUpperCase()] || targetType.toLowerCase();
  if (!['string', 'number', 'boolean', 'json', 'object'].includes(coerceType)) return null;

  return `@coerce c1 ${portRefs[0]} -> ${portRefs[1]} as ${coerceType}`;
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
    const quoted = extractQuoted(error.message);
    const coerceSuggestion = buildCoerceSuggestion(quoted, target);
    return {
      title: 'Type Mismatch',
      explanation: `Type mismatch: you're connecting a ${source} to a ${target}. The value will be automatically converted, but this might cause unexpected behavior.`,
      fix: coerceSuggestion
        ? `Add an explicit coercion: \`${coerceSuggestion}\`, change one of the port types, or use @strictTypes to turn this into an error.`
        : `Add a @coerce annotation between the two ports, change one of the port types, or use @strictTypes to turn this into an error.`,
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
    const quoted = extractQuoted(error.message);
    const coerceSuggestion = buildCoerceSuggestion(quoted, target);
    return {
      title: 'Type Incompatible',
      explanation: `Type mismatch: ${source} to ${target}. With @strictTypes enabled, this is an error instead of a warning.`,
      fix: coerceSuggestion
        ? `Add an explicit coercion: \`${coerceSuggestion}\`, change one of the port types, or remove @strictTypes to allow implicit coercions.`
        : `Add a @coerce annotation between the ports, change one of the port types, or remove @strictTypes to allow implicit coercions.`,
      code: error.code,
    };
  },

  UNUSUAL_TYPE_COERCION(error) {
    const types = extractTypes(error.message);
    const source = types?.source || 'unknown';
    const target = types?.target || 'unknown';
    const quoted = extractQuoted(error.message);
    const coerceSuggestion = buildCoerceSuggestion(quoted, target);
    return {
      title: 'Unusual Type Coercion',
      explanation: `Converting ${source} to ${target} is technically valid but semantically unusual and may produce unexpected behavior.`,
      fix: coerceSuggestion
        ? `If intentional, add an explicit coercion: \`${coerceSuggestion}\`, or use @strictTypes to enforce type safety.`
        : `If intentional, add an explicit @coerce annotation, or use @strictTypes to enforce type safety.`,
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

  SCOPE_MISSING_REQUIRED_INPUT(error) {
    const quoted = extractQuoted(error.message);
    const childId = quoted[0] || error.node || 'unknown';
    const portName = quoted[1] || 'unknown';
    const scopeName = quoted[2] || 'unknown';
    const parentId = quoted[3] || 'unknown';
    return {
      title: 'Scope Child Missing Input',
      explanation: `Child node '${childId}' inside scope '${scopeName}' of '${parentId}' has a required input '${portName}' with no connection.`,
      fix: `Connect the parent's scoped output to '${childId}.${portName}' within the scope, or mark the port as optional.`,
      code: error.code,
    };
  },

  SCOPE_UNUSED_INPUT(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    const parentId = quoted[1] || error.node || 'unknown';
    const scopeName = quoted[2] || 'unknown';
    return {
      title: 'Scope Input Unused',
      explanation: `Scoped input '${portName}' on '${parentId}' expects data back from inner nodes, but nothing connects to it within scope '${scopeName}'.`,
      fix: `Connect an inner node's output to '${parentId}.${portName}:${scopeName}' to return data from the scope.`,
      code: error.code,
    };
  },

  SCOPE_WRONG_SCOPE_NAME(error) {
    const quoted = extractQuoted(error.message);
    const portRef = quoted[0] || 'unknown';
    const nodeName = quoted[2] || 'unknown';
    return {
      title: 'Invalid Scope Qualifier',
      explanation: `A connection at '${portRef}' uses an invalid scope name. Node '${nodeName}' doesn't define that scope.`,
      fix: `Check the scope names defined on the node type. Fix the :scopeName qualifier in the @connect annotation to match an existing scope.`,
      code: error.code,
    };
  },

  SCOPE_CONNECTION_OUTSIDE(error) {
    const quoted = extractQuoted(error.message);
    return {
      title: 'Scope Connection Leak',
      explanation: `A scoped connection references a node that is outside the scope boundary. Scoped connections must stay within the scope.`,
      fix: `Move the target node inside the scope (declare it with the scope parent in @node), or remove the scope qualifier from the connection.`,
      code: error.code,
    };
  },

  SCOPE_PORT_TYPE_MISMATCH(error) {
    const quoted = extractQuoted(error.message);
    return {
      title: 'Scope Port Type Mismatch',
      explanation: `Type mismatch within scope '${quoted[0] || 'unknown'}'. The parent's scoped port and the child's port have incompatible types.`,
      fix: `Change one of the port types to match, or add a transformation node inside the scope.`,
      code: error.code,
    };
  },

  SCOPE_UNKNOWN_PORT(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    return {
      title: 'Unknown Scoped Port',
      explanation: `Port '${portName}' is referenced in a scoped connection but doesn't exist as a scoped port on that node, or belongs to a different scope.`,
      fix: `Add the port as a scoped port with @output ${portName} scope:scopeName, or fix the port name in the @connect annotation.`,
      code: error.code,
    };
  },

  SCOPE_ORPHANED_CHILD(error) {
    const quoted = extractQuoted(error.message);
    const childId = quoted[0] || error.node || 'unknown';
    const scopeName = quoted[1] || 'unknown';
    const parentId = quoted[2] || 'unknown';
    return {
      title: 'Orphaned Scope Child',
      explanation: `Node '${childId}' is declared inside scope '${scopeName}' of '${parentId}' but has no scoped connections. It won't receive data from or return data to the scope.`,
      fix: `Connect the parent's scoped output ports to '${childId}' inputs, and connect '${childId}' outputs back to the parent's scoped input ports.`,
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

  COERCE_TYPE_MISMATCH(error) {
    const coerceMatch = error.message.match(/`as (\w+)`/);
    const coerceType = coerceMatch?.[1] || 'unknown';
    const expectsMatch = error.message.match(/expects (\w+)/);
    const expectedType = expectsMatch?.[1] || 'unknown';
    const suggestedType = COERCE_TARGET_TYPES[expectedType.toUpperCase()] || expectedType.toLowerCase();
    return {
      title: 'Wrong Coercion Type',
      explanation: `The \`as ${coerceType}\` coercion produces the wrong type for the target port. The target expects ${expectedType}.`,
      fix: `Change \`as ${coerceType}\` to \`as ${suggestedType}\` in the @connect annotation.`,
      code: error.code,
    };
  },

  REDUNDANT_COERCE(error) {
    const coerceMatch = error.message.match(/`as (\w+)`/);
    const coerceType = coerceMatch?.[1] || 'unknown';
    const bothMatch = error.message.match(/both (\w+)/);
    const dataType = bothMatch?.[1] || 'the same type';
    return {
      title: 'Redundant Coercion',
      explanation: `The \`as ${coerceType}\` coercion is unnecessary because both the source and target ports are already ${dataType}.`,
      fix: `Remove \`as ${coerceType}\` from the @connect annotation — no coercion is needed.`,
      code: error.code,
    };
  },

  COERCE_ON_FUNCTION_PORT(error) {
    const coerceMatch = error.message.match(/`as (\w+)`/);
    const coerceType = coerceMatch?.[1] || 'unknown';
    return {
      title: 'Coercion on Function Port',
      explanation: `The \`as ${coerceType}\` coercion cannot be applied to FUNCTION ports. Function values are callable references and cannot be meaningfully converted to other types.`,
      fix: `Remove \`as ${coerceType}\` from the @connect annotation. If you need to convert the function's return value, add a transformation node.`,
      code: error.code,
    };
  },

  LOSSY_TYPE_COERCION(error) {
    const types = extractTypes(error.message);
    const source = types?.source || 'unknown';
    const target = types?.target || 'unknown';
    const quoted = extractQuoted(error.message);
    const coerceSuggestion = buildCoerceSuggestion(quoted, target);
    return {
      title: 'Lossy Type Conversion',
      explanation: `Converting ${source} to ${target} may lose data or produce unexpected results (e.g., NaN, truncation).`,
      fix: coerceSuggestion
        ? `Add an explicit coercion: \`${coerceSuggestion}\`, or use @strictTypes to enforce type safety.`
        : `Add an explicit conversion with @coerce, or use @strictTypes to enforce type safety.`,
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

  // ── Annotation validation rules ──────────────────────────────────────

  DUPLICATE_INSTANCE_ID(error) {
    const quoted = extractQuoted(error.message);
    const instanceId = quoted[0] || error.node || 'unknown';
    return {
      title: 'Duplicate Instance ID',
      explanation: `Two @node declarations use the same ID '${instanceId}'. Each node instance needs a unique ID within its workflow.`,
      fix: `Rename one of the '${instanceId}' instances to give it a unique ID.`,
      code: error.code,
    };
  },

  DUPLICATE_CONNECTION(error) {
    return {
      title: 'Duplicate Connection',
      explanation: `The same connection is declared twice. ${error.message}`,
      fix: `Remove the duplicate @connect annotation.`,
      code: error.code,
    };
  },

  INVALID_COLOR(error) {
    const quoted = extractQuoted(error.message);
    const color = quoted[1] || quoted[0] || 'unknown';
    return {
      title: 'Invalid Color',
      explanation: `Color '${color}' is not a recognized node color. Check the spelling or use a valid color name.`,
      fix: `Use one of the valid colors: blue, purple, cyan, orange, pink, green, red, yellow, teal.`,
      code: error.code,
    };
  },

  INVALID_ICON(error) {
    const quoted = extractQuoted(error.message);
    const icon = quoted[1] || quoted[0] || 'unknown';
    return {
      title: 'Invalid Icon',
      explanation: `Icon '${icon}' is not a recognized node icon. Check the spelling.`,
      fix: `Use a valid icon name from the icon set (e.g., database, code, flow, psychology, send).`,
      code: error.code,
    };
  },

  INVALID_PORT_TYPE(error) {
    const quoted = extractQuoted(error.message);
    const portName = quoted[0] || 'unknown';
    const typeName = quoted[2] || quoted[1] || 'unknown';
    return {
      title: 'Invalid Port Type',
      explanation: `Port '${portName}' has an unrecognized type '${typeName}'.`,
      fix: `Use a valid port type: STRING, NUMBER, BOOLEAN, ARRAY, OBJECT, FUNCTION, ANY, or STEP.`,
      code: error.code,
    };
  },

  INVALID_PORT_CONFIG_REF(error) {
    const quoted = extractQuoted(error.message);
    const instanceId = quoted[0] || error.node || 'unknown';
    const portName = quoted[1] || 'unknown';
    return {
      title: 'Invalid Port Config Reference',
      explanation: `Instance '${instanceId}' references port '${portName}' in a portOrder or portLabel annotation, but this port doesn't exist on the node type.`,
      fix: `Check the port name spelling, or remove the port configuration if the port was renamed or removed.`,
      code: error.code,
    };
  },

  INVALID_EXECUTE_WHEN(error) {
    const quoted = extractQuoted(error.message);
    const value = quoted[1] || quoted[0] || 'unknown';
    return {
      title: 'Invalid Execution Strategy',
      explanation: `@executeWhen value '${value}' is not recognized.`,
      fix: `Use one of: CONJUNCTION (all inputs), DISJUNCTION (any input), or CUSTOM (custom logic).`,
      code: error.code,
    };
  },

  SCOPE_EMPTY(error) {
    const quoted = extractQuoted(error.message);
    const scopeName = quoted[0] || 'unknown';
    const nodeName = quoted[1] || error.node || 'unknown';
    return {
      title: 'Empty Scope',
      explanation: `Scope '${scopeName}' on node '${nodeName}' has no child nodes declared inside it. The scope won't iterate over anything.`,
      fix: `Add child nodes to the scope with @scope ${scopeName} [childId1, childId2], or remove the scope if it's not needed.`,
      code: error.code,
    };
  },

  SCOPE_INCONSISTENT(error) {
    const quoted = extractQuoted(error.message);
    const instanceId = quoted[0] || error.node || 'unknown';
    return {
      title: 'Scope Conflict',
      explanation: `Instance '${instanceId}' is assigned to multiple scopes. A node can only belong to one scope at a time.`,
      fix: `Remove '${instanceId}' from one of the conflicting @scope declarations.`,
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
