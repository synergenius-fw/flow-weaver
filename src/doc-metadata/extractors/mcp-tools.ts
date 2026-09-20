/**
 * Extractor for MCP tool documentation
 *
 * One entry per tool the MCP server registers, mirroring the zod schema in
 * its src/mcp/tools-*.ts registration: same names, descriptions, parameter
 * types, enums and required flags. The platform's documentation plugin
 * renders this array, so a tool missing here is missing from the product
 * docs. When a tool schema changes, change the entry with it.
 */

import type { TMcpToolDoc } from '../types.js';

/**
 * MCP tool definitions - single source of truth for tool documentation
 */
export const MCP_TOOLS: TMcpToolDoc[] = [
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
        description: 'Output format (default: json). ascii/ascii-compact produce terminal-readable diagrams.',
        required: false,
        enum: ['json', 'text', 'mermaid', 'paths', 'ascii', 'ascii-compact'],
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
    description:
      'Validate a workflow file and return errors/warnings.',
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
      {
        name: 'draft',
        type: 'boolean',
        description: 'Draft mode - suppresses STUB_NODE errors for unimplemented nodes (default: false)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_compile',
    description:
      'Compile a workflow to executable code. Only regenerates code inside @flow-weaver-runtime and @flow-weaver-body marker sections, so user code outside markers is preserved. Set production: true to strip debug instrumentation. Custom targets are available via registered extensions.',
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
        description: 'Production mode, meaning no debug events (default: false)',
        required: false,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow name',
        required: false,
      },
      {
        name: 'target',
        type: 'string',
        description: 'Compilation target: typescript (default) or a registered extension target',
        required: false,
      },
      {
        name: 'cron',
        type: 'string',
        description: 'Cron schedule expression (e.g. "0 9 * * *"). Overrides @trigger annotation.',
        required: false,
      },
      {
        name: 'serve',
        type: 'boolean',
        description: 'Generate serve() handler for HTTP framework integration',
        required: false,
      },
      {
        name: 'framework',
        type: 'string',
        description: 'Framework adapter for serve handler (requires serve=true)',
        required: false,
        enum: ['next', 'express', 'hono', 'fastify', 'remix'],
      },
      {
        name: 'typedEvents',
        type: 'boolean',
        description: 'Generate Zod event schemas from workflow @param annotations',
        required: false,
      },
      {
        name: 'retries',
        type: 'number',
        description: 'Number of retries per function. Overrides @retries annotation.',
        required: false,
      },
      {
        name: 'timeout',
        type: 'string',
        description: 'Function timeout (e.g. "30m", "1h"). Overrides @timeout annotation.',
        required: false,
      },
      {
        name: 'draft',
        type: 'boolean',
        description: 'Draft mode - suppresses STUB_NODE validation errors so partially implemented workflows can compile (default: false)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_diff',
    description:
      'Semantic diff between two workflow files: node type changes, instance changes, connection changes, breaking changes.',
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
      'Query workflow structure.  Query types: - nodes: All node instances [{id, nodeType, parent}] - connections: All connections [{from, to}] in "node.port" format. Optional: nodeId to filter. - deps: Direct upstream dependencies [nodeId[]]. Requires: nodeId - dependents: Direct downstream dependents [nodeId[]]. Requires: nodeId - data-deps: Data-only upstream dependencies (excludes control flow). Requires: nodeId - execution-order: Topological sort of main-flow nodes. Scoped nodes are listed separately. - isolated: Nodes with no connections [nodeId[]] - dead-ends: Nodes that don\'t reach Exit [nodeId[]] - disconnected-outputs: Output ports not connected to anything [{nodeId, ports[]}] - node-types: All node type definitions [{name, functionName, inputs[], outputs[]}]',
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
        enum: ['nodes', 'connections', 'deps', 'dependents', 'data-deps', 'execution-order', 'isolated', 'dead-ends', 'disconnected-outputs', 'node-types'],
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
  {
    name: 'fw_market_search',
    description:
      'Search npm for Flow Weaver marketplace packages (node types, workflows, patterns). Returns package name, version, and description.',
    category: 'query',
    params: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query text (optional, omit to browse all)',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of results (default: 20)',
        required: false,
      },
      {
        name: 'registryUrl',
        type: 'string',
        description: 'Custom registry search URL for private registries (default: public npm)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_market_list',
    description:
      'List installed Flow Weaver marketplace packages in the current project. Shows available node types, workflows, and patterns from each package.',
    category: 'query',
    params: [],
  },
  {
    name: 'fw_diagram',
    description:
      'Generate a diagram of a workflow. Formats: svg draws the spine (steps in run order, control flow as lanes: failure arms, loop bodies, pulled steps) as a vector image. ascii/ascii-compact/text produce plain text readable in terminal. Provide either filePath (workflow .ts file) or source (inline code).',
    category: 'query',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow .ts file (required if source is not provided)',
        required: false,
      },
      {
        name: 'source',
        type: 'string',
        description: 'Inline workflow source code (required if filePath is not provided)',
        required: false,
      },
      {
        name: 'outputPath',
        type: 'string',
        description: 'Output file path. If omitted, returns content as text.',
        required: false,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow name if file has multiple',
        required: false,
      },
      {
        name: 'theme',
        type: 'string',
        description: 'Color theme (default: dark)',
        required: false,
        enum: ['dark', 'light'],
      },
      {
        name: 'format',
        type: 'string',
        description: 'Output format: svg (the default, drawing the spine as a vector image), ascii (port-level detail), ascii-compact (compact boxes), text (structured list)',
        required: false,
        enum: ['svg', 'ascii', 'ascii-compact', 'text'],
      },
    ],
  },
  {
    name: 'fw_docs',
    description:
      'Browse Flow Weaver documentation and reference guides. Use action="list" to see topics, action="read" to read a topic, action="search" to search across all docs.',
    category: 'query',
    params: [
      {
        name: 'action',
        type: 'string',
        description: 'What to do: list topics, read a topic, or search',
        required: true,
        enum: ['list', 'read', 'search'],
      },
      {
        name: 'topic',
        type: 'string',
        description: 'Topic slug to read (for action="read")',
        required: false,
      },
      {
        name: 'query',
        type: 'string',
        description: 'Search query (for action="search")',
        required: false,
      },
      {
        name: 'compact',
        type: 'boolean',
        description: 'Return compact LLM-friendly version (default: false)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_context',
    description:
      'Flow Weaver orientation as markdown: the model, the tool loop, which topic answers which task, and every other topic with its size. preset="core" (default) is that map; "authoring", "ops" and "full" bundle whole references.',
    category: 'query',
    params: [
      {
        name: 'preset',
        type: 'string',
        description: 'Topic preset',
        required: false,
        enum: ['core', 'authoring', 'full', 'ops'],
      },
      {
        name: 'profile',
        type: 'string',
        description: 'standalone = full self-contained dump, assistant = assumes MCP tools available',
        required: false,
        enum: ['standalone', 'assistant'],
      },
      {
        name: 'topics',
        type: 'string',
        description: 'Comma-separated topic slugs (overrides preset)',
        required: false,
      },
      {
        name: 'addTopics',
        type: 'string',
        description: 'Comma-separated slugs to add to preset',
        required: false,
      },
      {
        name: 'includeGrammar',
        type: 'boolean',
        description: 'Append the generated EBNF grammar (~3 KB), off by default',
        required: false,
      },
    ],
  },
  {
    name: 'fw_list_resources',
    description:
      'List available icons, colors, and annotation tags for use in workflow definitions.',
    category: 'query',
    params: [
      {
        name: 'type',
        type: 'string',
        description: 'Resource type to list (default: all)',
        required: false,
        enum: ['icons', 'colors', 'tags', 'all'],
      },
    ],
  },
  {
    name: 'fw_modify',
    description:
      'Modify a workflow file: add/remove/rename nodes, add/remove connections, set labels. Parses the file, applies the mutation, and regenerates annotations in-place. Returns auto-validation results and a text description of the updated workflow.',
    category: 'modify',
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
        description: 'Specific workflow if file has multiple',
        required: false,
      },
      {
        name: 'operation',
        type: 'string',
        description: 'The mutation to perform',
        required: true,
        enum: ['addNode', 'removeNode', 'renameNode', 'addConnection', 'removeConnection', 'setNodeLabel'],
      },
      {
        name: 'params',
        type: 'object',
        description: 'Operation-specific parameters. addNode: {nodeId, nodeType}. removeNode: {nodeId}. renameNode: {oldId, newId}. addConnection: {from, to} ("node.port" format). removeConnection: {from, to} ("node.port" format). setNodeLabel: {nodeId, label}.',
        required: true,
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
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow if file has multiple',
        required: false,
      },
      {
        name: 'operations',
        type: 'array',
        description: 'Array of operations to apply sequentially',
        required: true,
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
    name: 'fw_migrate',
    description:
      'Migrate workflow files to current syntax via parse → regenerate round-trip. The parser adds defaults for missing fields, edge-case migrations transform the AST, and generateInPlace writes current syntax back.',
    category: 'modify',
    params: [
      {
        name: 'glob',
        type: 'string',
        description: 'Glob pattern for workflow files to migrate (e.g., "src/**/*.ts")',
        required: true,
      },
      {
        name: 'dryRun',
        type: 'boolean',
        description: 'Preview changes without writing files (default: false)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_market_install',
    description:
      'Install a Flow Weaver marketplace package via npm. After installation, the package\'s node types, workflows, and patterns become available for use.',
    category: 'modify',
    params: [
      {
        name: 'package',
        type: 'string',
        description: 'Package name or specifier (e.g., "flow-weaver-pack-openai" or "flow-weaver-pack-openai@1.0.0")',
        required: true,
      },
    ],
  },
  {
    name: 'fw_list_templates',
    description:
      'List available scaffold templates for workflows and nodes.',
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
    description:
      'Create a workflow or node from a template.',
    category: 'template',
    params: [
      {
        name: 'template',
        type: 'string',
        description: 'Template name (e.g. "sequential", "validator", "ai-agent")',
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
        description: 'Preview only, returning generated code without writing (default: false)',
        required: false,
      },
      {
        name: 'config',
        type: 'object',
        description: 'Template configuration (e.g. { nodes: ["fetch", "parse"], input: "rawData" })',
        required: false,
      },
    ],
  },
  {
    name: 'fw_list_patterns',
    description:
      'List reusable patterns defined in a file.',
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
    description:
      'Apply a reusable pattern to a workflow file.',
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
        description: 'Preview only, don\'t write (default: false)',
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
  {
    name: 'fw_export',
    description:
      'Export workflows as serverless deployments. Generates platform-native config files and deploy instructions. Available targets depend on installed packs.',
    category: 'execution',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow .ts file',
        required: true,
      },
      {
        name: 'target',
        type: 'string',
        description: 'Deployment target name. Targets come from installed packs. An unknown name returns INVALID_TARGET listing the installed ones.',
        required: true,
      },
      {
        name: 'outputDir',
        type: 'string',
        description: 'Output directory for generated files (default: ./dist relative to workflow)',
        required: false,
      },
      {
        name: 'serviceName',
        type: 'string',
        description: 'Service name (default: derived from filename)',
        required: false,
      },
      {
        name: 'workflows',
        type: 'array',
        description: 'Specific workflow function names to include (default: all)',
        required: false,
      },
      {
        name: 'nodeTypes',
        type: 'array',
        description: 'Specific node type names to include',
        required: false,
      },
      {
        name: 'includeDocs',
        type: 'boolean',
        description: 'Include OpenAPI/Swagger routes (default: true)',
        required: false,
      },
      {
        name: 'preview',
        type: 'boolean',
        description: 'Preview without writing files to disk (default: false)',
        required: false,
      },
      {
        name: 'durableSteps',
        type: 'boolean',
        description: 'Use deep generator with per-node durable steps',
        required: false,
      },
    ],
  },
  {
    name: 'fw_workflow_run',
    description:
      'Run a workflow until completion or a durable approval, input, agent, or timer gate. For coordinators: returns the raw continuation. Assistants should use fw_run.',
    category: 'execution',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow .ts file',
        required: true,
      },
      {
        name: 'params',
        type: 'object',
        description: 'Workflow input parameters',
        required: false,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Export name if the file has several workflows',
        required: false,
      },
      {
        name: 'runId',
        type: 'string',
        description: 'Stable run identity, generated when omitted',
        required: false,
      },
      {
        name: 'bundleDigest',
        type: 'string',
        description: 'Verified sha256 identity of the executable bundle',
        required: false,
      },
    ],
  },
  {
    name: 'fw_workflow_resume',
    description:
      'Resume one exact durable gate continuation. The prior executor is not retained. For coordinators. Assistants should use fw_resume.',
    category: 'execution',
    params: [
      {
        name: 'runId',
        type: 'string',
        description: 'Run identity the continuation was produced under',
        required: true,
      },
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the same workflow .ts file',
        required: true,
      },
      {
        name: 'continuation',
        type: 'object',
        description: 'The continuation envelope returned by the yielded outcome, verbatim (any JSON value)',
        required: true,
      },
      {
        name: 'gateId',
        type: 'string',
        description: 'The gate id from the yielded outcome',
        required: true,
      },
      {
        name: 'resolution',
        type: 'object',
        description: 'The gate node\'s full output envelope, control ports included',
        required: true,
      },
      {
        name: 'params',
        type: 'object',
        description: 'Workflow input parameters, as on the first segment',
        required: false,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Export name if the file has several workflows',
        required: false,
      },
      {
        name: 'bundleDigest',
        type: 'string',
        description: 'sha256:<64 hex> identity of the executable bundle',
        required: true,
      },
    ],
  },
  {
    name: 'fw_run',
    description:
      'Run a workflow. Returns the result, or pauses at the first gate and returns {runId, gate}. Continue with fw_resume.',
    category: 'execution',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Workflow .ts file',
        required: true,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Export name if the file has several',
        required: false,
      },
      {
        name: 'params',
        type: 'object',
        description: 'Workflow input parameters',
        required: false,
      },
    ],
  },
  {
    name: 'fw_resume',
    description:
      'Continue a paused run. Give exactly one of answer (the gate\'s result) or reject (a reason).',
    category: 'execution',
    params: [
      {
        name: 'runId',
        type: 'string',
        description: 'Run id returned by fw_run',
        required: true,
      },
      {
        name: 'answer',
        type: 'object',
        description: 'For a single-output gate, the value. For multi-output, an object with every output (any JSON value)',
        required: false,
      },
      {
        name: 'reject',
        type: 'string',
        description: 'Fail the gate with this reason',
        required: false,
      },
    ],
  },
  {
    name: 'fw_runs',
    description:
      'List runs, or inspect one. With runId returns the full gate so you can re-read a pause without resuming.',
    category: 'execution',
    params: [
      {
        name: 'runId',
        type: 'string',
        description: 'Inspect one run in full',
        required: false,
      },
      {
        name: 'filePath',
        type: 'string',
        description: 'Only runs of this workflow file',
        required: false,
      },
    ],
  },
  {
    name: 'fw_debug_workflow',
    description:
      'Start a step-through debug session for a workflow. Compiles and executes the workflow, pausing before the first node. Returns a debugId and the initial pause state.',
    category: 'debug',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the workflow .ts file',
        required: true,
      },
      {
        name: 'workflowName',
        type: 'string',
        description: 'Specific workflow function name (for multi-workflow files)',
        required: false,
      },
      {
        name: 'params',
        type: 'object',
        description: 'Parameters to pass to the workflow',
        required: false,
      },
      {
        name: 'breakpoints',
        type: 'array',
        description: 'Node IDs to set as initial breakpoints',
        required: false,
      },
    ],
  },
  {
    name: 'fw_debug_step',
    description:
      'Step to the next node in a debug session. Executes one node then pauses again.',
    category: 'debug',
    params: [
      {
        name: 'debugId',
        type: 'string',
        description: 'The debug session ID from fw_debug_workflow',
        required: true,
      },
    ],
  },
  {
    name: 'fw_debug_continue',
    description:
      'Continue execution from the current pause point. Runs to completion, or stops at the next breakpoint if toBreakpoint is true.',
    category: 'debug',
    params: [
      {
        name: 'debugId',
        type: 'string',
        description: 'The debug session ID',
        required: true,
      },
      {
        name: 'toBreakpoint',
        type: 'boolean',
        description: 'If true, pause at the next breakpoint instead of running to completion',
        required: false,
      },
    ],
  },
  {
    name: 'fw_debug_inspect',
    description:
      'Inspect the current debug state without advancing execution. Returns all variables, or filter to a specific node.',
    category: 'debug',
    params: [
      {
        name: 'debugId',
        type: 'string',
        description: 'The debug session ID',
        required: true,
      },
      {
        name: 'nodeId',
        type: 'string',
        description: 'Filter to show only this node\'s variables',
        required: false,
      },
    ],
  },
  {
    name: 'fw_debug_set_variable',
    description:
      'Modify a variable value in the debug session. The new value will be used by downstream nodes when execution continues.',
    category: 'debug',
    params: [
      {
        name: 'debugId',
        type: 'string',
        description: 'The debug session ID',
        required: true,
      },
      {
        name: 'nodeId',
        type: 'string',
        description: 'The node that produced the variable',
        required: true,
      },
      {
        name: 'portName',
        type: 'string',
        description: 'The output port name',
        required: true,
      },
      {
        name: 'value',
        type: 'object',
        description: 'The new value to set (any JSON value)',
        required: true,
      },
      {
        name: 'executionIndex',
        type: 'number',
        description: 'Execution index (defaults to the latest)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_debug_breakpoint',
    description:
      'Add, remove, or list breakpoints in a debug session. Breakpoints cause execution to pause when running with fw_debug_continue(toBreakpoint: true).',
    category: 'debug',
    params: [
      {
        name: 'debugId',
        type: 'string',
        description: 'The debug session ID',
        required: true,
      },
      {
        name: 'action',
        type: 'string',
        description: 'Action to perform',
        required: true,
        enum: ['add', 'remove', 'list'],
      },
      {
        name: 'nodeId',
        type: 'string',
        description: 'Node ID for add/remove (not needed for list)',
        required: false,
      },
    ],
  },
  {
    name: 'fw_list_debug_sessions',
    description:
      'List all active debug sessions.',
    category: 'debug',
    params: [],
  },
];

/**
 * Extract MCP tool documentation.
 */
export function extractMcpTools(): TMcpToolDoc[] {
  return MCP_TOOLS;
}
