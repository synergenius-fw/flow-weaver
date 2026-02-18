/**
 * Extractor for CLI command documentation
 *
 * This defines all CLI commands with their descriptions, options, and action blocks.
 * The data is extracted from the Commander.js definitions in cli/index.ts.
 * Template lists are generated from the actual template registries.
 */

import { workflowTemplates, nodeTemplates } from '../../cli/templates/index.js';
import type { TCliCommandDoc } from '../types.js';
import { DEFAULT_SERVER_URL } from '../../defaults.js';

/**
 * CLI command definitions - single source of truth for CLI documentation
 */
export const CLI_COMMANDS: TCliCommandDoc[] = [
  // ── Core commands ──────────────────────────────────────────────
  {
    name: 'compile',
    syntax: 'flow-weaver compile <file> [options]',
    description: 'Compile workflow source file',
    options: [
      { flags: '-o, --output', arg: '<path>', description: 'Output file or directory' },
      { flags: '-p, --production', description: 'Production build (no debug events)' },
      { flags: '-s, --source-map', description: 'Generate source maps' },
      { flags: '-w, --workflow-name', arg: '<name>', description: 'Target specific workflow' },
      { flags: '-f, --format', arg: 'esm|cjs|auto', description: 'Module format', defaultValue: 'auto' },
      { flags: '--strict', description: 'Treat type coercion warnings as errors' },
      { flags: '--dry-run', description: 'Preview compilation without writing files' },
      { flags: '--verbose', description: 'Detailed output' },
    ],
  },
  {
    name: 'validate',
    syntax: 'flow-weaver validate <file> [options]',
    description: 'Validate workflow without compiling',
    options: [
      { flags: '-w, --workflow-name', arg: '<name>', description: 'Target specific workflow' },
      { flags: '--json', description: 'Output as JSON', exclusive: 'output-mode' },
      { flags: '--verbose', description: 'Verbose output', exclusive: 'output-mode' },
      { flags: '-q, --quiet', description: 'Suppress warnings', exclusive: 'output-mode' },
      { flags: '--strict', description: 'Treat type coercion warnings as errors' },
    ],
  },
  {
    name: 'describe',
    syntax: 'flow-weaver describe <file> [options]',
    description: 'Output workflow structure in LLM-friendly formats (JSON, text, mermaid)',
    options: [
      { flags: '-f, --format', arg: 'json|text|mermaid|paths', description: 'Output format (paths: enumerate all Start-to-Exit paths via DFS)' },
      { flags: '-w, --workflow-name', arg: '<name>', description: 'Target workflow' },
      { flags: '-n, --node', arg: '<id>', description: 'Focus on specific node' },
      { flags: '--compile', description: 'Also update runtime markers in the source file' },
    ],
  },
  {
    name: 'run',
    syntax: 'flow-weaver run <file> [options]',
    description: 'Execute a workflow file directly',
    options: [
      { flags: '-w, --workflow', arg: '<name>', description: 'Specific workflow to run' },
      { flags: '--params', arg: '<json>', description: 'Input parameters as JSON string', exclusive: 'params' },
      { flags: '--params-file', arg: '<path>', description: 'Path to JSON file with input parameters', exclusive: 'params' },
      { flags: '-p, --production', description: 'Production mode (no trace events)' },
      { flags: '-t, --trace', description: 'Include execution trace events' },
      { flags: '--json', description: 'Output result as JSON' },
      { flags: '--timeout', arg: '<ms>', description: 'Execution timeout in milliseconds' },
    ],
  },
  {
    name: 'serve',
    syntax: 'flow-weaver serve [directory] [options]',
    description: 'Start HTTP server exposing workflows as endpoints',
    options: [
      { flags: '-p, --port', arg: '<port>', description: 'Server port', defaultValue: '3000' },
      { flags: '-H, --host', arg: '<host>', description: 'Server host', defaultValue: '0.0.0.0' },
      { flags: '--no-watch', description: 'Disable file watching for hot reload' },
      { flags: '--production', description: 'Production mode (no trace events)' },
      { flags: '--precompile', description: 'Precompile all workflows on startup' },
      { flags: '--cors', arg: '<origin>', description: 'CORS origin', defaultValue: '*' },
      { flags: '--swagger', description: 'Enable Swagger UI at /docs' },
    ],
  },

  // ── Create subcommands ─────────────────────────────────────────
  {
    name: 'create workflow',
    syntax: 'flow-weaver create workflow <template> <file> [options]',
    description: 'Create new workflow from template',
    group: 'create',
    positionalChoices: {
      template: workflowTemplates.map(t => ({ id: t.id, label: t.id })),
    },
    options: [
      { flags: '-p, --preview', description: 'Show without writing' },
      { flags: '--provider', arg: 'openai|anthropic|ollama|mock', description: 'LLM provider' },
      { flags: '--model', arg: '<model>', description: 'Model identifier' },
      { flags: '--name', arg: '<name>', description: 'Override derived function name' },
      { flags: '--nodes', arg: '<names>', description: 'Comma-separated node function names' },
      { flags: '--config', arg: '<json>', description: 'Configuration as JSON string' },
      { flags: '--input', arg: '<name>', description: 'Custom input port name', defaultValue: 'data' },
      { flags: '--output', arg: '<name>', description: 'Custom output port name', defaultValue: 'result' },
      { flags: '-l, --line', arg: '<number>', description: 'Insert at specific line number' },
      { flags: '-a, --async', description: 'Generate an async workflow' },
    ],
  },
  {
    name: 'create node',
    syntax: 'flow-weaver create node <name> <file> [options]',
    description: 'Create a node type from template',
    group: 'create',
    options: [
      { flags: '-t, --template', arg: nodeTemplates.map(t => t.id).join('|'), description: 'Node template to use', defaultValue: 'processor' },
      { flags: '-p, --preview', description: 'Preview generated code without writing' },
      { flags: '-l, --line', arg: '<number>', description: 'Insert at specific line number' },
    ],
  },

  // ── Templates (generated from registries) ──────────────────────
  {
    name: 'templates',
    syntax: 'flow-weaver templates [--json]',
    description: `List available workflow templates (${workflowTemplates.length} total)`,
    listStyle: 'definition',
    options: [
      { flags: '--json', description: 'Output as JSON' },
    ],
    list: workflowTemplates.map(t => `${t.id} - ${t.description}`),
  },
  {
    name: 'Node Templates',
    syntax: 'flow-weaver create node <name> <file> --template <type>',
    description: `Create node types from templates (${nodeTemplates.length} total)`,
    listStyle: 'definition',
    options: [],
    list: nodeTemplates.map(t => `${t.id} - ${t.description}`),
  },

  // ── Pattern subcommands ────────────────────────────────────────
  {
    name: 'pattern list',
    syntax: 'flow-weaver pattern list <path> [--json]',
    description: 'List patterns in file or directory',
    group: 'pattern',
    options: [
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    name: 'pattern apply',
    syntax: 'flow-weaver pattern apply <pattern-file> <target-file> [options]',
    description: 'Apply a pattern to a workflow file',
    group: 'pattern',
    options: [
      { flags: '-p, --preview', description: 'Preview changes without writing' },
      { flags: '--prefix', arg: '<prefix>', description: 'Prefix for node instance IDs' },
      { flags: '-n, --name', arg: '<name>', description: 'Specific pattern name to apply' },
    ],
  },
  {
    name: 'pattern extract',
    syntax: 'flow-weaver pattern extract <source-file> --nodes <ids> -o <file> [options]',
    description: 'Extract nodes as reusable pattern',
    group: 'pattern',
    options: [
      { flags: '--nodes', arg: '<ids>', description: 'Comma-separated list of node IDs to extract', required: true },
      { flags: '-o, --output', arg: '<file>', description: 'Output pattern file', required: true },
      { flags: '-n, --name', arg: '<name>', description: 'Pattern name' },
      { flags: '-p, --preview', description: 'Preview pattern without writing' },
    ],
  },

  // ── Project & dev commands ─────────────────────────────────────
  {
    name: 'init',
    syntax: 'flow-weaver init [directory] [options]',
    description: 'Create a new flow-weaver project with templates and config',
    options: [
      { flags: '-n, --name', arg: '<name>', description: 'Project name (defaults to directory name)' },
      { flags: '-t, --template', arg: workflowTemplates.map(t => t.id).join('|'), description: 'Workflow template', defaultValue: 'simple' },
      { flags: '-f, --format', arg: 'esm|cjs', description: 'Module format', defaultValue: 'esm' },
      { flags: '-y, --yes', description: 'Skip prompts, use defaults' },
      { flags: '--install / --no-install', description: 'Run npm install after scaffolding' },
      { flags: '--git / --no-git', description: 'Initialize a git repository' },
      { flags: '--force', description: 'Overwrite existing files' },
      { flags: '--json', description: 'Output results as JSON' },
    ],
  },
  {
    name: 'watch',
    syntax: 'flow-weaver watch <file> [options]',
    description: 'Watch workflow files and recompile on changes',
    options: [
      { flags: '-o, --output', arg: '<path>', description: 'Output file or directory' },
      { flags: '-p, --production', description: 'Production build (no debug events)' },
      { flags: '-s, --source-map', description: 'Generate source maps' },
      { flags: '-w, --workflow-name', arg: '<name>', description: 'Target specific workflow' },
      { flags: '-f, --format', arg: 'esm|cjs|auto', description: 'Module format', defaultValue: 'auto' },
      { flags: '--verbose', description: 'Detailed output' },
    ],
  },
  {
    name: 'doctor',
    syntax: 'flow-weaver doctor [--json]',
    description: 'Check project environment and configuration. Validates Node.js version, TypeScript, package installation, and tsconfig.json settings.',
    options: [
      { flags: '--json', description: 'Output results as JSON' },
    ],
  },

  // ── Export & generation ────────────────────────────────────────
  {
    name: 'export',
    syntax: 'flow-weaver export <file> -t <target> -o <path> [options]',
    description: 'Export workflow as serverless function',
    options: [
      { flags: '-t, --target', arg: 'lambda|vercel|cloudflare', description: 'Target platform', required: true },
      { flags: '-o, --output', arg: '<path>', description: 'Output directory', required: true },
      { flags: '-w, --workflow', arg: '<name>', description: 'Specific workflow to export' },
      { flags: '-p, --production', description: 'Production mode', defaultValue: 'true' },
      { flags: '--multi', description: 'Export all workflows as single multi-workflow service' },
      { flags: '--workflows', arg: '<names>', description: 'Comma-separated workflow subset (with --multi)' },
      { flags: '--docs', description: 'Include API documentation routes (/docs, /openapi.json)' },
      { flags: '--dry-run', description: 'Preview without writing files' },
    ],
  },
  {
    name: 'diff',
    syntax: 'flow-weaver diff <file1> <file2> [options]',
    description: 'Semantic diff between two workflow files',
    options: [
      { flags: '-f, --format', arg: 'text|json|compact', description: 'Output format', defaultValue: 'text' },
      { flags: '-w, --workflow-name', arg: '<name>', description: 'Specific workflow to compare' },
      { flags: '--exit-zero', description: 'Exit 0 even when differences are found' },
    ],
  },
  {
    name: 'openapi',
    syntax: 'flow-weaver openapi <directory> [options]',
    description: 'Generate OpenAPI specification from workflows',
    options: [
      { flags: '-o, --output', arg: '<path>', description: 'Output file path' },
      { flags: '--title', arg: '<title>', description: 'API title', defaultValue: 'Flow Weaver API' },
      { flags: '--version', arg: '<version>', description: 'API version', defaultValue: '1.0.0' },
      { flags: '--description', arg: '<desc>', description: 'API description' },
      { flags: '-f, --format', arg: 'json|yaml', description: 'Output format', defaultValue: 'json' },
      { flags: '--server', arg: '<url>', description: 'Server URL' },
    ],
  },
  {
    name: 'grammar',
    syntax: 'flow-weaver grammar [options]',
    description: 'Output JSDoc annotation grammar specification',
    options: [
      { flags: '-f, --format', arg: 'html|ebnf', description: 'Output format', defaultValue: 'html' },
      { flags: '-o, --output', arg: '<path>', description: 'Write output to file instead of stdout' },
    ],
  },

  // ── Integration commands ───────────────────────────────────────
  {
    name: 'listen',
    syntax: 'flow-weaver listen [options]',
    description: 'Connect to the editor and stream integration events as JSON lines',
    options: [
      { flags: '-s, --server', arg: '<url>', description: 'Editor URL', defaultValue: DEFAULT_SERVER_URL },
    ],
  },
  {
    name: 'mcp-server',
    syntax: 'flow-weaver mcp-server [options]',
    description: 'Start MCP server for Claude Code integration',
    options: [
      { flags: '-s, --server', arg: '<url>', description: 'Editor URL', defaultValue: DEFAULT_SERVER_URL },
      { flags: '--stdio', description: 'Run in MCP stdio mode (skip interactive registration)' },
    ],
  },

  // ── UI subcommands ─────────────────────────────────────────────
  {
    name: 'ui focus-node',
    syntax: 'flow-weaver ui focus-node <nodeId> [options]',
    description: 'Select and center a node in the editor',
    group: 'ui',
    options: [
      { flags: '-s, --server', arg: '<url>', description: 'Editor URL', defaultValue: DEFAULT_SERVER_URL },
    ],
  },
  {
    name: 'ui add-node',
    syntax: 'flow-weaver ui add-node <nodeTypeName> [options]',
    description: 'Add a node at viewport center',
    group: 'ui',
    options: [
      { flags: '-s, --server', arg: '<url>', description: 'Editor URL', defaultValue: DEFAULT_SERVER_URL },
    ],
  },
  {
    name: 'ui open-workflow',
    syntax: 'flow-weaver ui open-workflow <filePath> [options]',
    description: 'Open a workflow file in the editor',
    group: 'ui',
    options: [
      { flags: '-s, --server', arg: '<url>', description: 'Editor URL', defaultValue: DEFAULT_SERVER_URL },
    ],
  },
  {
    name: 'ui get-state',
    syntax: 'flow-weaver ui get-state [options]',
    description: 'Return current workflow state from the editor',
    group: 'ui',
    options: [
      { flags: '-s, --server', arg: '<url>', description: 'Editor URL', defaultValue: DEFAULT_SERVER_URL },
    ],
  },
  {
    name: 'ui batch',
    syntax: 'flow-weaver ui batch <json> [options]',
    description: 'Execute a batch of commands with auto-snapshot rollback',
    group: 'ui',
    options: [
      { flags: '-s, --server', arg: '<url>', description: 'Editor URL', defaultValue: DEFAULT_SERVER_URL },
    ],
  },

  // ── Plugin subcommands ─────────────────────────────────────────
  {
    name: 'plugin init',
    syntax: 'flow-weaver plugin init <name> [options]',
    description: 'Scaffold a new external plugin',
    group: 'plugin',
    options: [
      { flags: '-a, --area', arg: 'sidebar|main|toolbar|modal|panel', description: 'Component area', defaultValue: 'panel' },
      { flags: '--no-system', description: 'Skip generating a system module' },
      { flags: '-p, --preview', description: 'Preview generated files without writing' },
      { flags: '--force', description: 'Overwrite existing files' },
    ],
  },

  // ── Migration & changelog ──────────────────────────────────────
  {
    name: 'migrate',
    syntax: 'flow-weaver migrate <glob> [options]',
    description: 'Migrate workflow files to current syntax via parse → regenerate round-trip',
    options: [
      { flags: '--dry-run', description: 'Preview changes without writing files' },
      { flags: '--diff', description: 'Show semantic diff before/after' },
    ],
  },
  {
    name: 'changelog',
    syntax: 'flow-weaver changelog [options]',
    description: 'Generate changelog from git history, categorized by file path',
    options: [
      { flags: '--last-tag', description: 'From last git tag to HEAD', exclusive: 'range' },
      { flags: '--since', arg: '<date>', description: 'Date-based range (e.g., "2024-01-01")', exclusive: 'range' },
      { flags: '-r, --range', arg: '<range>', description: 'Custom git range (e.g., "v0.1.0..HEAD")', exclusive: 'range' },
    ],
  },
];

/**
 * Extract CLI command documentation
 */
export function extractCliCommands(): TCliCommandDoc[] {
  return CLI_COMMANDS;
}
