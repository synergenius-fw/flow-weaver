/**
 * Single source of truth for validation error code documentation.
 *
 * Every code the validator (src/validator.ts) and agent rules
 * (src/validation/agent-rules.ts) can emit is listed here.
 *
 * The generate-docs script uses this to build the summary tables
 * in docs/reference/error-codes.md.
 */

export interface TValidationCodeDoc {
  code: string;
  severity: 'error' | 'warning';
  title: string;
  description: string;
  category:
    | 'structural'
    | 'naming'
    | 'connection'
    | 'type'
    | 'node-ref'
    | 'graph'
    | 'data-flow'
    | 'agent';
}

export const VALIDATION_CODES: TValidationCodeDoc[] = [
  // ── Structural ──────────────────────────────────────────────────────
  {
    code: 'MISSING_WORKFLOW_NAME',
    severity: 'error',
    title: 'Missing Workflow Name',
    description: 'Workflow has no name',
    category: 'structural',
  },
  {
    code: 'MISSING_FUNCTION_NAME',
    severity: 'error',
    title: 'Missing Function Name',
    description: 'Workflow has no function name',
    category: 'structural',
  },
  {
    code: 'DUPLICATE_NODE_NAME',
    severity: 'error',
    title: 'Duplicate Node Name',
    description: 'Two node types share a function name',
    category: 'structural',
  },
  {
    code: 'MUTABLE_NODE_TYPE_BINDING',
    severity: 'warning',
    title: 'Mutable Node Binding',
    description: 'Node type declared with let/var instead of const',
    category: 'structural',
  },
  {
    code: 'INFERRED_NODE_TYPE',
    severity: 'warning',
    title: 'Inferred Node Type',
    description: 'Node type auto-inferred without explicit annotation',
    category: 'structural',
  },
  {
    code: 'ANNOTATION_SIGNATURE_MISMATCH',
    severity: 'warning',
    title: 'Optional Port Mismatch',
    description: 'Port optionality differs between annotation and sig',
    category: 'structural',
  },
  {
    code: 'ANNOTATION_SIGNATURE_TYPE_MISMATCH',
    severity: 'warning',
    title: 'Annotation Type Mismatch',
    description: 'Port type differs between annotation and signature',
    category: 'structural',
  },

  // ── Naming ──────────────────────────────────────────────────────────
  {
    code: 'RESERVED_NODE_NAME',
    severity: 'error',
    title: 'Reserved Name Used',
    description: 'Node type uses "Start" or "Exit"',
    category: 'naming',
  },
  {
    code: 'RESERVED_INSTANCE_ID',
    severity: 'error',
    title: 'Reserved Instance ID',
    description: 'Instance ID is "Start" or "Exit"',
    category: 'naming',
  },

  // ── Connection ──────────────────────────────────────────────────────
  {
    code: 'UNKNOWN_SOURCE_NODE',
    severity: 'error',
    title: 'Missing Source Node',
    description: 'Connection from nonexistent node',
    category: 'connection',
  },
  {
    code: 'UNKNOWN_TARGET_NODE',
    severity: 'error',
    title: 'Missing Target Node',
    description: 'Connection to nonexistent node',
    category: 'connection',
  },
  {
    code: 'UNKNOWN_SOURCE_PORT',
    severity: 'error',
    title: 'Unknown Output Port',
    description: 'Connection from nonexistent output port',
    category: 'connection',
  },
  {
    code: 'UNKNOWN_TARGET_PORT',
    severity: 'error',
    title: 'Unknown Input Port',
    description: 'Connection to nonexistent input port',
    category: 'connection',
  },
  {
    code: 'MULTIPLE_CONNECTIONS_TO_INPUT',
    severity: 'error',
    title: 'Multiple Input Connections',
    description: 'Data input port has more than one source',
    category: 'connection',
  },

  // ── Type ────────────────────────────────────────────────────────────
  {
    code: 'STEP_PORT_TYPE_MISMATCH',
    severity: 'error',
    title: 'Wrong Port Type',
    description: 'STEP port connected to data port or vice versa',
    category: 'type',
  },
  {
    code: 'TYPE_INCOMPATIBLE',
    severity: 'error',
    title: 'Type Incompatible',
    description: 'Type mismatch with @strictTypes enabled',
    category: 'type',
  },
  {
    code: 'OBJECT_TYPE_MISMATCH',
    severity: 'warning',
    title: 'Object Shape Mismatch',
    description: 'OBJECT ports have different structural types',
    category: 'type',
  },
  {
    code: 'LOSSY_TYPE_COERCION',
    severity: 'warning',
    title: 'Lossy Type Conversion',
    description: 'Type coercion may lose information',
    category: 'type',
  },
  {
    code: 'UNUSUAL_TYPE_COERCION',
    severity: 'warning',
    title: 'Unusual Type Coercion',
    description: 'Type coercion is semantically unusual',
    category: 'type',
  },
  {
    code: 'TYPE_MISMATCH',
    severity: 'warning',
    title: 'Type Mismatch',
    description: 'Incompatible types, runtime coercion attempted',
    category: 'type',
  },

  // ── Node Reference ──────────────────────────────────────────────────
  {
    code: 'UNKNOWN_NODE_TYPE',
    severity: 'error',
    title: 'Unknown Node Type',
    description: 'Instance references nonexistent node type',
    category: 'node-ref',
  },
  {
    code: 'UNDEFINED_NODE',
    severity: 'error',
    title: 'Undefined Node',
    description: 'Connection references node with no instance',
    category: 'node-ref',
  },
  {
    code: 'MISSING_REQUIRED_INPUT',
    severity: 'error',
    title: 'Missing Required Input',
    description: 'Required input has no connection/default/expression',
    category: 'node-ref',
  },

  // ── Graph ───────────────────────────────────────────────────────────
  {
    code: 'CYCLE_DETECTED',
    severity: 'error',
    title: 'Circular Dependency Found',
    description: 'Graph contains a loop',
    category: 'graph',
  },
  {
    code: 'INVALID_EXIT_PORT_TYPE',
    severity: 'error',
    title: 'Invalid Exit Port Type',
    description: 'Exit onSuccess/onFailure is not STEP type',
    category: 'graph',
  },

  // ── Data Flow ───────────────────────────────────────────────────────
  {
    code: 'UNUSED_NODE',
    severity: 'warning',
    title: 'Unused Node',
    description: 'Node defined but not connected',
    category: 'data-flow',
  },
  {
    code: 'NO_START_CONNECTIONS',
    severity: 'warning',
    title: 'No Start Connections',
    description: 'No connections from Start',
    category: 'data-flow',
  },
  {
    code: 'NO_EXIT_CONNECTIONS',
    severity: 'warning',
    title: 'No Exit Connections',
    description: 'No connections to Exit',
    category: 'data-flow',
  },
  {
    code: 'UNUSED_OUTPUT_PORT',
    severity: 'warning',
    title: 'Unused Output Port',
    description: 'Output port data is discarded',
    category: 'data-flow',
  },
  {
    code: 'UNREACHABLE_EXIT_PORT',
    severity: 'warning',
    title: 'Unreachable Exit Port',
    description: 'Exit port has no incoming connection',
    category: 'data-flow',
  },
  {
    code: 'MULTIPLE_EXIT_CONNECTIONS',
    severity: 'warning',
    title: 'Multiple Exit Connections',
    description: 'Exit port has multiple sources',
    category: 'data-flow',
  },

  // ── Agent ───────────────────────────────────────────────────────────
  {
    code: 'AGENT_LLM_MISSING_ERROR_HANDLER',
    severity: 'error',
    title: 'LLM Missing Error Handler',
    description: "LLM node's onFailure port is unconnected",
    category: 'agent',
  },
  {
    code: 'AGENT_UNGUARDED_TOOL_EXECUTOR',
    severity: 'warning',
    title: 'Unguarded Tool Executor',
    description: 'Tool executor has no upstream human-approval gate',
    category: 'agent',
  },
  {
    code: 'AGENT_MISSING_MEMORY_IN_LOOP',
    severity: 'warning',
    title: 'No Memory in Agent Loop',
    description: 'Loop has LLM but no conversation memory node',
    category: 'agent',
  },
  {
    code: 'AGENT_LLM_NO_FALLBACK',
    severity: 'warning',
    title: 'LLM Failure Goes to Exit',
    description: 'LLM onFailure routes directly to Exit',
    category: 'agent',
  },
  {
    code: 'AGENT_TOOL_NO_OUTPUT_HANDLING',
    severity: 'warning',
    title: 'Tool Results Discarded',
    description: 'Tool executor data outputs all unconnected',
    category: 'agent',
  },
];
