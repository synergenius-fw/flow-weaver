/**
 * Wraps a data payload into a successful MCP tool result with JSON text content.
 * @param data - The result data to include in the response.
 * @returns An MCP tool result object with `success: true` and the serialized data.
 */
export function makeToolResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, data }, null, 2) }],
  };
}

/**
 * Wraps an error code and message into a failed MCP tool result.
 * @param code - A machine-readable error code (e.g. "UNKNOWN_NODE_TYPE").
 * @param message - A human-readable error description.
 * @returns An MCP tool result object with `success: false`, `isError: true`, and the serialized error.
 */
export function makeErrorResult(code: string, message: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: { code, message } }, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Maps validation error codes to suggested next MCP tool actions.
 * Used to guide LLM agents toward resolving workflow issues.
 */
export const ERROR_HINTS: Record<string, string> = {
  UNKNOWN_NODE_TYPE: 'Run fw_query(query="node-types") to see available types',
  UNKNOWN_SOURCE_NODE: 'Run fw_query(query="nodes") to see all node instances',
  UNKNOWN_TARGET_NODE: 'Run fw_query(query="nodes") to see all node instances',
  UNKNOWN_SOURCE_PORT:
    'Run fw_describe(node="<nodeId>") to see available ports. Use fw_modify(operation="addConnection") to safely wire ports.',
  UNKNOWN_TARGET_PORT:
    'Run fw_describe(node="<nodeId>") to see available ports. Use fw_modify(operation="addConnection") to safely wire ports.',
  MISSING_REQUIRED_INPUT:
    'Add a @connect to this port, or make it optional with @input portName [optional]',
  CYCLE_DETECTED:
    'Use a scoped forEach node instead of graph loops. See flow-weaver:flow-weaver-export-interface',
  STEP_PORT_TYPE_MISMATCH:
    'STEP ports (execute, onSuccess, onFailure) can only connect to other STEP ports',
  MULTIPLE_CONNECTIONS_TO_INPUT:
    'Data inputs accept only one connection. Use a merge node or separate ports',
  UNUSED_NODE: 'Connect this node or remove it with fw_modify(operation="removeNode")',
  NO_START_CONNECTIONS:
    'Add @connect Start.portName -> node.port, or use fw_modify(operation="addConnection") to wire it.',
  NO_EXIT_CONNECTIONS:
    'Add @connect node.port -> Exit.portName, or use fw_modify(operation="addConnection") to wire it.',
  UNREACHABLE_EXIT_PORT:
    'Use fw_modify(operation="addConnection") to connect a node output to this Exit port.',
  RESERVED_NODE_NAME: 'Rename the node type — "Start" and "Exit" are reserved',
  RESERVED_INSTANCE_ID: 'Rename the instance — "Start" and "Exit" are reserved IDs',
  MULTIPLE_WORKFLOWS_FOUND: 'Specify workflowName parameter to select which workflow to use',
  DUPLICATE_NODE_NAME: 'Rename one of the duplicate node type functions to be unique',
  UNDEFINED_NODE: 'Add a @node annotation for the referenced instance, or fix the connection',
  INVALID_EXIT_PORT_TYPE: 'Ensure Exit onSuccess/onFailure ports are STEP type (auto-generated)',

  // Agent-specific rules
  AGENT_LLM_MISSING_ERROR_HANDLER:
    'Use fw_modify(operation="addConnection", params={from:"<nodeId>.onFailure", to:"Exit.onFailure"}) or add a retry/fallback node',
  AGENT_UNGUARDED_TOOL_EXECUTOR:
    'Add a human-approval node before the tool executor. Use fw_scaffold(template="human-approval") to create one',
  AGENT_MISSING_MEMORY_IN_LOOP:
    'Add a conversation-memory node inside the loop scope. Use fw_scaffold(template="conversation-memory") to create one',
  AGENT_LLM_NO_FALLBACK:
    'Add a retry or fallback node between the LLM onFailure and Exit. Consider a second LLM provider as fallback',
  AGENT_TOOL_NO_OUTPUT_HANDLING:
    'Use fw_modify(operation="addConnection") to wire tool output ports to downstream nodes',
};

/**
 * Enriches validation items with actionable hints from {@link ERROR_HINTS} and optional
 * friendly error explanations. Replaces `<nodeId>` placeholders in hints with actual node IDs.
 * @param items - Array of validation errors/warnings, each with a message, severity, and optional code.
 * @param friendlyErrorFn - Optional function that produces user-friendly error explanations.
 * @returns A new array with `hint` and `friendly` fields added where applicable.
 */
export function addHintsToItems(
  items: Array<{ message: string; severity: string; nodeId?: string; code?: string }>,
  friendlyErrorFn?: (err: { code: string; message: string; node?: string }) => { title: string; explanation: string; fix: string; code: string } | null
): Array<{
  message: string;
  severity: string;
  nodeId?: string;
  code?: string;
  hint?: string;
  friendly?: { title: string; explanation: string; fix: string };
}> {
  return items.map((item) => {
    if (!item.code) return item;

    const result: typeof item & { hint?: string; friendly?: { title: string; explanation: string; fix: string } } = { ...item };

    // Add MCP tool hint
    let hint = ERROR_HINTS[item.code];
    if (hint) {
      if (item.nodeId && hint.includes('<nodeId>')) {
        hint = hint.replace(/<nodeId>/g, item.nodeId);
      }
      result.hint = hint;
    }

    // Add friendly error explanation
    if (friendlyErrorFn) {
      const friendly = friendlyErrorFn({ code: item.code, message: item.message, node: item.nodeId });
      if (friendly) {
        result.friendly = { title: friendly.title, explanation: friendly.explanation, fix: friendly.fix };
      }
    }

    return result;
  });
}
