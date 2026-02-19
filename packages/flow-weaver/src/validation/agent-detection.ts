/**
 * Agent Node Detection
 *
 * Multi-signal detection to classify workflow nodes by their agent role.
 * Uses a priority hierarchy: port signatures > visual annotations > name heuristics.
 */

import type { TNodeTypeAST } from '../ast/types';

/**
 * Recognized agent node roles.
 * - llm: Calls a language model (has messages/toolCalls/content ports)
 * - tool-executor: Executes tool calls from an LLM (has toolCall input, result output)
 * - human-approval: Gates execution on human review (has approved/rejected outputs)
 * - memory: Stores/retrieves conversation history (has conversationId input, messages output)
 */
export type AgentNodeRole = 'llm' | 'tool-executor' | 'human-approval' | 'memory';

// ---------------------------------------------------------------------------
// Signal matchers (ordered by priority)
// ---------------------------------------------------------------------------

/** Port-based detection — most reliable since port names define the contract */
const PORT_SIGNATURES: Array<{ role: AgentNodeRole; match: (nt: TNodeTypeAST) => boolean }> = [
  {
    // LLM node: has 'messages' input AND ('content' or 'toolCalls' output)
    role: 'llm',
    match: (nt) => {
      const hasMessagesInput = 'messages' in nt.inputs;
      const hasContentOutput = 'content' in nt.outputs;
      const hasToolCallsOutput = 'toolCalls' in nt.outputs;
      return hasMessagesInput && (hasContentOutput || hasToolCallsOutput);
    },
  },
  {
    // Tool executor: has 'toolCall' input AND 'result' output
    role: 'tool-executor',
    match: (nt) => {
      const hasToolCallInput = 'toolCall' in nt.inputs || 'toolCalls' in nt.inputs;
      const hasResultOutput = 'result' in nt.outputs || 'resultMessage' in nt.outputs;
      return hasToolCallInput && hasResultOutput;
    },
  },
  {
    // Human approval: has ('approved' AND 'rejected') outputs
    role: 'human-approval',
    match: (nt) => {
      return 'approved' in nt.outputs && 'rejected' in nt.outputs;
    },
  },
  {
    // Memory: has 'conversationId' input AND 'messages' output
    role: 'memory',
    match: (nt) => {
      const hasConversationIdInput = 'conversationId' in nt.inputs;
      const hasMessagesOutput = 'messages' in nt.outputs;
      return hasConversationIdInput && hasMessagesOutput;
    },
  },
];

/** Icon-based detection — reliable when present, from @icon annotation */
const ICON_MAP: Record<string, AgentNodeRole> = {
  psychology: 'llm',
  build: 'tool-executor',
  verified: 'human-approval',
  database: 'memory',
};

/** Color-based detection — weaker signal, only used to confirm */
const COLOR_MAP: Record<string, AgentNodeRole> = {
  purple: 'llm',
  cyan: 'tool-executor',
  orange: 'human-approval',
};

/** Name pattern heuristics — fallback only */
const NAME_PATTERNS: Array<{ role: AgentNodeRole; pattern: RegExp }> = [
  { role: 'llm', pattern: /^(llm|chat|completion|model|ai)/i },
  { role: 'tool-executor', pattern: /^(tool|action|execute|exec)/i },
  { role: 'human-approval', pattern: /^(human|approv|review|gate)/i },
  { role: 'memory', pattern: /^(memory|conversation|history|context)/i },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the agent role of a node type using multi-signal analysis.
 *
 * Priority:
 * 1. Port signature patterns (strongest — defines the contract)
 * 2. @icon annotation (strong — explicit visual intent)
 * 3. @color annotation (weak — only used to break ties)
 * 4. Function name heuristics (weakest — fallback only)
 *
 * @returns The detected role, or null if the node is not an agent node
 */
export function detectNodeRole(nodeType: TNodeTypeAST): AgentNodeRole | null {
  // 1. Port signatures (highest confidence)
  for (const sig of PORT_SIGNATURES) {
    if (sig.match(nodeType)) {
      return sig.role;
    }
  }

  // 2. Icon annotation
  const icon = nodeType.visuals?.icon;
  if (icon && icon in ICON_MAP) {
    return ICON_MAP[icon];
  }

  // 3. Color annotation (only if it maps unambiguously)
  const color = nodeType.visuals?.color;
  if (color && color in COLOR_MAP) {
    return COLOR_MAP[color];
  }

  // 4. Function name heuristics
  const name = nodeType.functionName || nodeType.name;
  for (const { role, pattern } of NAME_PATTERNS) {
    if (pattern.test(name)) {
      return role;
    }
  }

  return null;
}

/**
 * Convenience: find all node types in a workflow that match a specific role.
 * Returns array of [instanceId, nodeType] pairs for all instances with that role.
 */
export function findNodesByRole(
  nodeTypes: TNodeTypeAST[],
  role: AgentNodeRole,
): TNodeTypeAST[] {
  return nodeTypes.filter((nt) => detectNodeRole(nt) === role);
}
