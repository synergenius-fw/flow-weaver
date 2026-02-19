/**
 * Extractor for MCP tool documentation
 *
 * This defines all MCP tools with their descriptions and parameters.
 * The data is extracted from the tool registration files (tools-query.ts, tools-template.ts, tools-pattern.ts, tools-editor.ts, tools-export.ts).
 */

import type { TMcpToolDoc } from '../types.js';

/**
 * MCP tool definitions - single source of truth for tool documentation
 */
export const MCP_TOOLS: TMcpToolDoc[] = [
  // Query tools (tools-query.ts)
  {
    name: 'fw_describe',
    description:
      'Describe a workflow in LLM-friendly format (nodes, connections, graph, validation).',
    category: 'query',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow .ts file',
        required: true,
      },
      {
        name: 'format',
        type: 'string',
        description: 'Output format (default: json)',
        required: false,
        enum: ['json', 'text', 'mermaid', 'paths'],
      },
      {
        name: 'node',
        type: 'string',
        description: 'Focus on a specific node ID',
        required: false,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow if file has multiple',
        required: false,
      },
    ],
  },
  {
    name: 'fw_validate',
    description: 'Validate a workflow file and return errors/warnings.',
    category: 'query',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow file',
        required: true,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow name',
        required: false,
      },
    ],
  },
  {
    name: 'fw_compile',
    description: 'Compile a workflow to executable code.',
    category: 'query',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow file',
        required: true,
      },
      {
        name: 'write',
        type: 'boolean',
        description: 'Whether to write the output file (default: true)',
        required: false,
      },
      {
        name: 'production',
        type: 'boolean',
        description: 'Production mode — no debug events (default: false)',
        required: false,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow name',
        required: false,
      },
    ],
  },
  {
    name: 'fw_diff',
    description:
      'Semantic diff between two workflow files — node type changes, instance changes, connection changes, breaking changes.',
    category: 'query',
    params: [
      {
        name: 'file1',
        type: 'string',
        description: 'Path to first workflow file',
        required: true,
      },
      {
        name: 'file2',
        type: 'string',
        description: 'Path to second workflow file',
        required: true,
      },
      {
        name: 'format',
        type: 'string',
        description: 'Output format (default: text)',
        required: false,
        enum: ['text', 'json', 'compact'],
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow name',
        required: false,
      },
    ],
  },
  {
    name: 'fw_query',
    description:
      'Query workflow structure: nodes, connections, deps, dependents, data-deps, execution-order, isolated, dead-ends, disconnected-outputs, node-types.',
    category: 'query',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow file',
        required: true,
      },
      {
        name: 'query',
        type: 'string',
        description: 'Query type',
        required: true,
        enum: [
          'nodes',
          'connections',
          'deps',
          'dependents',
          'data-deps',
          'execution-order',
          'isolated',
          'dead-ends',
          'disconnected-outputs',
          'node-types',
        ],
      },
      {
        name: 'nodeId',
        type: 'string',
        description: 'Required for deps/dependents. Optional filter for connections.',
        required: false,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow name',
        required: false,
      },
    ],
  },

  {
    name: 'fw_doctor',
    description:
      'Check project environment and configuration for flow-weaver compatibility.',
    category: 'query',
    params: [
      {
        name: 'directory',
        type: 'string',
        description: 'Directory to check (default: cwd)',
        required: false,
      },
    ],
  },

  // Template tools (tools-template.ts)
  {
    name: 'fw_list_templates',
    description: 'List available scaffold templates for workflows and nodes.',
    category: 'template',
    params: [
      {
        name: 'type',
        type: 'string',
        description: 'Filter template type (default: all)',
        required: false,
        enum: ['workflow', 'node', 'all'],
      },
    ],
  },
  {
    name: 'fw_scaffold',
    description: 'Create a workflow or node from a template.',
    category: 'template',
    params: [
      {
        name: 'template',
        type: 'string',
        description: 'Template name (e.g. "sequential", "validator")',
        required: true,
      },
      {
        name: 'filePath',
        type: 'string',
        description: 'Output file path',
        required: true,
      },
      {
        name: 'name',
        type: 'string',
        description: 'Workflow/node function name',
        required: false,
      },
      {
        name: 'preview',
        type: 'boolean',
        description: 'Preview only — return generated code without writing (default: false)',
        required: false,
      },
      {
        name: 'config',
        type: 'object',
        description:
          'Template configuration (e.g. { nodes: ["fetch", "parse"], input: "rawData" })',
        required: false,
      },
    ],
  },

  // Pattern tools (tools-pattern.ts)
  {
    name: 'fw_list_patterns',
    description: 'List reusable patterns defined in a file.',
    category: 'pattern',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to file containing patterns',
        required: true,
      },
    ],
  },
  {
    name: 'fw_apply_pattern',
    description: 'Apply a reusable pattern to a workflow file.',
    category: 'pattern',
    params: [
      {
        name: 'patternFile',
        type: 'string',
        description: 'Path to file containing the pattern',
        required: true,
      },
      {
        name: 'targetFile',
        type: 'string',
        description: 'Path to target workflow file',
        required: true,
      },
      {
        name: 'patternName',
        type: 'string',
        description: 'Specific pattern name if file has multiple',
        required: false,
      },
      {
        name: 'prefix',
        type: 'string',
        description: 'Node ID prefix to avoid conflicts',
        required: false,
      },
      {
        name: 'preview',
        type: 'boolean',
        description: "Preview only, don't write (default: false)",
        required: false,
      },
    ],
  },
  {
    name: 'fw_find_workflows',
    description:
      'Scan a directory for workflow files containing @flowWeaver workflow annotations. Returns file paths and workflow metadata.',
    category: 'pattern',
    params: [
      {
        name: 'directory',
        type: 'string',
        description: 'Directory to search for workflow files',
        required: true,
      },
      {
        name: 'pattern',
        type: 'string',
        description: 'Glob pattern (default: **/*.ts)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_extract_pattern',
    description:
      'Extract a reusable pattern from selected nodes in a workflow. Identifies internal connections and boundary IN/OUT ports automatically.',
    category: 'pattern',
    params: [
      {
        name: 'sourceFile',
        type: 'string',
        description: 'Path to workflow file',
        required: true,
      },
      {
        name: 'nodes',
        type: 'string',
        description: 'Comma-separated node IDs to extract',
        required: true,
      },
      {
        name: 'name',
        type: 'string',
        description: 'Pattern name',
        required: false,
      },
      {
        name: 'outputFile',
        type: 'string',
        description: 'Output file path (omit for preview only)',
        required: false,
      },
    ],
  },

  // Modify tools (tools-pattern.ts - fw_modify, fw_modify_batch)
  {
    name: 'fw_modify',
    description:
      'Modify a workflow file: add/remove/rename nodes, add/remove connections, set positions/labels. Parses the file, applies the mutation, and regenerates annotations in-place. Returns auto-validation results and a text description of the updated workflow.',
    category: 'modify',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow file',
        required: true,
      },
      {
        name: 'operation',
        type: 'string',
        description: 'The mutation to perform',
        required: true,
        enum: [
          'addNode',
          'removeNode',
          'renameNode',
          'addConnection',
          'removeConnection',
          'setNodePosition',
          'setNodeLabel',
        ],
      },
      {
        name: 'params',
        type: 'object',
        description:
          'Operation-specific parameters. addNode: {nodeId, nodeType, x?, y?}. removeNode: {nodeId}. renameNode: {oldId, newId}. addConnection/removeConnection: {from, to} ("node.port" format). setNodePosition: {nodeId, x, y}. setNodeLabel: {nodeId, label}.',
        required: true,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow if file has multiple',
        required: false,
      },
      {
        name: 'preview',
        type: 'boolean',
        description: 'Preview without writing (default: false)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_modify_batch',
    description:
      'Apply multiple modify operations in a single parse/write/validate cycle. More efficient than calling fw_modify multiple times.',
    category: 'modify',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow file',
        required: true,
      },
      {
        name: 'operations',
        type: 'array',
        description:
          'Array of operations to apply sequentially. Each operation has { operation, params }.',
        required: true,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow if file has multiple',
        required: false,
      },
      {
        name: 'preview',
        type: 'boolean',
        description: 'Preview without writing (default: false)',
        required: false,
      },
    ],
  },

  // Editor tools (tools-editor.ts)
  {
    name: 'fw_get_state',
    description: 'Get the current editor/workflow state from Flow Weaver.',
    category: 'editor',
    params: [],
  },
  {
    name: 'fw_check_events',
    description:
      'Get buffered editor events. Returns and clears the event buffer unless peek=true.',
    category: 'editor',
    params: [
      {
        name: 'peek',
        type: 'boolean',
        description: 'If true, return events without clearing the buffer',
        required: false,
      },
    ],
  },
  {
    name: 'fw_configure_events',
    description:
      'Configure event include/exclude filters, dedup window, and buffer size. Returns the active config after applying updates.',
    category: 'editor',
    params: [
      {
        name: 'include',
        type: 'array',
        description: 'Event types to include',
        required: false,
      },
      {
        name: 'exclude',
        type: 'array',
        description: 'Event types to exclude',
        required: false,
      },
      {
        name: 'dedupeWindowMs',
        type: 'number',
        description: 'Deduplication window in milliseconds',
        required: false,
      },
      {
        name: 'maxBufferSize',
        type: 'number',
        description: 'Maximum event buffer size',
        required: false,
      },
    ],
  },
  {
    name: 'fw_focus_node',
    description: 'Select and center a node in the Flow Weaver editor.',
    category: 'editor',
    params: [
      {
        name: 'nodeId',
        type: 'string',
        description: 'ID of the node to focus',
        required: true,
      },
    ],
  },
  {
    name: 'fw_add_node',
    description: 'Add a new node to the workflow in the Flow Weaver editor.',
    category: 'editor',
    params: [
      {
        name: 'nodeTypeName',
        type: 'string',
        description: 'Name of the node type to add',
        required: true,
      },
      {
        name: 'nodeTypeDefinition',
        type: 'object',
        description: 'Optional node type definition if creating a new type',
        required: false,
      },
    ],
  },
  {
    name: 'fw_remove_node',
    description: 'Remove a node and its connections from the workflow.',
    category: 'editor',
    params: [
      {
        name: 'nodeName',
        type: 'string',
        description: 'Name of the node to remove',
        required: true,
      },
    ],
  },
  {
    name: 'fw_connect',
    description: 'Add or remove a connection between ports.',
    category: 'editor',
    params: [
      {
        name: 'action',
        type: 'string',
        description: 'Whether to add or remove the connection',
        required: true,
        enum: ['add', 'remove'],
      },
      {
        name: 'connection',
        type: 'object',
        description:
          'Connection details: { sourceNode, sourcePort, targetNode, targetPort }',
        required: true,
      },
    ],
  },
  {
    name: 'fw_open_workflow',
    description: 'Open a workflow file in the Flow Weaver editor.',
    category: 'editor',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow file to open',
        required: true,
      },
    ],
  },
  {
    name: 'fw_send_command',
    description: 'Send a generic command to the Flow Weaver editor.',
    category: 'editor',
    params: [
      {
        name: 'action',
        type: 'string',
        description: 'Command action name',
        required: true,
      },
      {
        name: 'params',
        type: 'object',
        description: 'Optional command parameters',
        required: false,
      },
    ],
  },
  {
    name: 'fw_batch',
    description:
      'Execute a batch of commands with auto-snapshot rollback support.',
    category: 'editor',
    params: [
      {
        name: 'commands',
        type: 'array',
        description:
          'Array of commands to execute. Each command has { action, params? }.',
        required: true,
      },
    ],
  },
  {
    name: 'fw_undo_redo',
    description: 'Undo or redo the last workflow change.',
    category: 'editor',
    params: [
      {
        name: 'action',
        type: 'string',
        description: 'Whether to undo or redo',
        required: true,
        enum: ['undo', 'redo'],
      },
    ],
  },
  {
    name: 'fw_execute_workflow',
    description:
      'Run the current workflow with optional parameters and return the result.',
    category: 'editor',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to workflow file (uses current if omitted)',
        required: false,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow name',
        required: false,
      },
      {
        name: 'params',
        type: 'object',
        description: 'Input parameters for the workflow',
        required: false,
      },
      {
        name: 'includeTrace',
        type: 'boolean',
        description: 'Include execution trace events',
        required: false,
      },
    ],
  },
  {
    name: 'fw_get_workflow_details',
    description:
      'Get full workflow structure including nodes, connections, types, and positions.',
    category: 'editor',
    params: [],
  },

  // Export tools (tools-export.ts)
  {
    name: 'fw_export',
    description:
      'Export workflows as serverless deployments. Generates handler code, platform config, and deploy instructions.',
    category: 'execution',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow file',
        required: true,
      },
      {
        name: 'target',
        type: 'string',
        description: 'Target deployment platform',
        required: true,
        enum: ['lambda', 'vercel', 'cloudflare'],
      },
      {
        name: 'outputDir',
        type: 'string',
        description: 'Output directory for generated files',
        required: true,
      },
      {
        name: 'serviceName',
        type: 'string',
        description: 'Service name for the deployment',
        required: false,
      },
      {
        name: 'workflows',
        type: 'array',
        description: 'Specific workflows to export',
        required: false,
      },
      {
        name: 'nodeTypes',
        type: 'array',
        description: 'Node types to include',
        required: false,
      },
      {
        name: 'includeDocs',
        type: 'boolean',
        description: 'Include API documentation routes',
        required: false,
      },
      {
        name: 'preview',
        type: 'boolean',
        description: 'Preview without writing files (default: false)',
        required: false,
      },
    ],
  },
];

/**
 * Extract MCP tool documentation
 */
export function extractMcpTools(): TMcpToolDoc[] {
  return MCP_TOOLS;
}
