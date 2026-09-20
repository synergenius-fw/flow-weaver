/**
 * Extractor for CLI command documentation
 *
 * This defines all CLI commands with their descriptions, options, and action blocks.
 * The data is extracted from the Commander.js definitions in cli/index.ts.
 * Template lists are generated from the actual template registries.
 */

import { workflowTemplates, nodeTemplates } from '../../cli/templates/index.js';
import type { TCliCommandDoc } from '../types.js';

/**
 * CLI command definitions - single source of truth for CLI documentation
 */
export const CLI_COMMANDS: TCliCommandDoc[] = [
  // ── Core commands ──────────────────────────────────────────────
  {
    name: 'compile',
    syntax: 'fw compile <file> [options]',
    description: 'Compile workflow source file',
    botCompatible: true,
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
    syntax: 'fw validate <file> [options]',
    description: 'Validate workflow without compiling',
    botCompatible: true,
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
    syntax: 'fw describe <file> [options]',
    description: 'Output workflow structure in LLM-friendly formats (JSON, text, mermaid)',
    botCompatible: true,
    options: [
      { flags: '-f, --format', arg: 'json|text|mermaid|paths', description: 'Output format (paths: enumerate all Start-to-Exit paths via DFS)' },
      { flags: '-w, --workflow-name', arg: '<name>', description: 'Target workflow' },
      { flags: '-n, --node', arg: '<id>', description: 'Focus on specific node' },
      { flags: '--compile', description: 'Also update runtime markers in the source file' },
    ],
  },
  {
    name: 'run',
    syntax: 'fw run <file> [options]',
    description: 'Execute a workflow file directly',
    botCompatible: true,
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
    syntax: 'fw serve [directory] [options]',
    description: 'Serve the workflows as HTTP endpoints; gated runs pause, resume and stream over the same API',
    options: [
      { flags: '-p, --port', arg: '<port>', description: 'Server port', defaultValue: '3000' },
      { flags: '-H, --host', arg: '<host>', description: 'Server host; beyond loopback needs --token or --insecure', defaultValue: '127.0.0.1' },
      { flags: '--token', arg: '<token>', description: 'Bearer token every request must carry (also FW_SERVE_TOKEN)' },
      { flags: '--no-agents', description: 'Do not answer agent gates from .flowweaver/agents.yaml' },
      { flags: '--trace', description: 'Keep a step trace for every run and stream it on /runs/:id/events' },
      { flags: '--dev', description: 'Error stacks in responses; mocks accepted when starting a run' },
      { flags: '--insecure', description: 'Listen beyond loopback without a token' },
      { flags: '--no-watch', description: 'Disable file watching for hot reload' },
      { flags: '--cors', arg: '<origin>', description: 'Send CORS headers for this origin' },
      { flags: '--swagger', description: 'Enable Swagger UI at /docs' },
    ],
  },

  // ── Create subcommands ─────────────────────────────────────────
  {
    name: 'create workflow',
    syntax: 'fw create workflow <template> <file> [options]',
    description: 'Create new workflow from template',
    botCompatible: true,
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
    syntax: 'fw create node <name> <file> [options]',
    description: 'Create a node type from template',
    botCompatible: true,
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
    syntax: 'fw templates [--json]',
    description: `List available workflow templates (${workflowTemplates.length} total)`,
    botCompatible: true,
    listStyle: 'definition',
    options: [
      { flags: '--json', description: 'Output as JSON' },
    ],
    list: workflowTemplates.map(t => `${t.id} - ${t.description}`),
  },
  {
    name: 'Node Templates',
    syntax: 'fw create node <name> <file> --template <type>',
    description: `Create node types from templates (${nodeTemplates.length} total)`,
    listStyle: 'definition',
    options: [],
    list: nodeTemplates.map(t => `${t.id} - ${t.description}`),
  },

  // ── Pattern subcommands ────────────────────────────────────────
  {
    name: 'pattern list',
    syntax: 'fw pattern list <path> [--json]',
    description: 'List patterns in file or directory',
    botCompatible: true,
    group: 'pattern',
    options: [
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    name: 'pattern apply',
    syntax: 'fw pattern apply <pattern-file> <target-file> [options]',
    description: 'Apply a pattern to a workflow file',
    botCompatible: true,
    group: 'pattern',
    options: [
      { flags: '-p, --preview', description: 'Preview changes without writing' },
      { flags: '--prefix', arg: '<prefix>', description: 'Prefix for node instance IDs' },
      { flags: '-n, --name', arg: '<name>', description: 'Specific pattern name to apply' },
    ],
  },
  {
    name: 'pattern extract',
    syntax: 'fw pattern extract <source-file> --nodes <ids> -o <file> [options]',
    description: 'Extract nodes as reusable pattern',
    botCompatible: true,
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
    syntax: 'fw init [directory] [options]',
    description: 'Create a new flow-weaver project with templates and config',
    options: [
      { flags: '-n, --name', arg: '<name>', description: 'Project name (defaults to directory name)' },
      { flags: '-t, --template', arg: workflowTemplates.map(t => t.id).join('|'), description: 'Workflow template', defaultValue: 'sequential' },
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
    syntax: 'fw watch <file> [options]',
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
    syntax: 'fw doctor [--json]',
    description: 'Check project environment and configuration. Validates Node.js version, TypeScript, package installation, and tsconfig.json settings.',
    botCompatible: true,
    options: [
      { flags: '--json', description: 'Output results as JSON' },
    ],
  },
  {
    name: 'agents',
    syntax: 'fw agents [directory] [--init] [--json]',
    description: 'The agent profiles in .flowweaver/agents.yaml that answer agent gates, whether each is ready, and the gate mapping. --init writes the starter file.',
    botCompatible: true,
    options: [
      { flags: '--init', description: 'Write the starter .flowweaver/agents.yaml' },
      { flags: '--force', description: 'With --init: replace an existing file' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },

  // ── Context ─────────────────────────────────────────────────────
  {
    name: 'context',
    syntax: 'fw context [preset] [options]',
    description: 'Generate LLM context bundle from documentation and grammar',
    botCompatible: true,
    options: [
      { flags: '--profile', arg: 'standalone|assistant', description: 'Output profile', defaultValue: 'standalone' },
      { flags: '--topics', arg: '<slugs>', description: 'Comma-separated topic slugs (overrides preset)' },
      { flags: '--add', arg: '<slugs>', description: 'Extra topic slugs to add to preset' },
      { flags: '--no-grammar', description: 'Omit EBNF grammar section' },
      { flags: '-o, --output', arg: '<path>', description: 'Write to file instead of stdout' },
      { flags: '--list', description: 'List available presets and exit' },
    ],
    positionalChoices: {
      preset: [
        { id: 'core', label: 'core' },
        { id: 'authoring', label: 'authoring' },
        { id: 'ops', label: 'ops' },
        { id: 'full', label: 'full' },
      ],
    },
  },

  // ── Export & generation ────────────────────────────────────────
  {
    name: 'export',
    syntax: 'fw export <file> -t <target> -o <path> [options]',
    description: 'Export workflow as serverless function',
    botCompatible: true,
    options: [
      { flags: '-t, --target', arg: '<target>', description: 'Target platform (provided by installed packs)', required: true },
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
    syntax: 'fw diff <file1> <file2> [options]',
    description: 'Semantic diff between two workflow files',
    botCompatible: true,
    options: [
      { flags: '-f, --format', arg: 'text|json|compact', description: 'Output format', defaultValue: 'text' },
      { flags: '-w, --workflow-name', arg: '<name>', description: 'Specific workflow to compare' },
      { flags: '--exit-zero', description: 'Exit 0 even when differences are found' },
    ],
  },
  {
    name: 'openapi',
    syntax: 'fw openapi <directory> [options]',
    description: 'Generate the OpenAPI specification fw serve publishes: declared @http routes, run resources, run endpoints',
    options: [
      { flags: '-o, --output', arg: '<path>', description: 'Output file path' },
      { flags: '--title', arg: '<title>', description: 'API title', defaultValue: 'Flow Weaver API' },
      { flags: '--version', arg: '<version>', description: 'API version', defaultValue: '1.0.0' },
      { flags: '--description', arg: '<desc>', description: 'API description' },
      { flags: '-f, --format', arg: 'json|yaml', description: 'Output format', defaultValue: 'json' },
      { flags: '--server', arg: '<url>', description: 'Server URL' },
      { flags: '--no-auth', description: 'Leave out the bearer scheme, for a server without a token' },
      { flags: '--no-legacy', description: 'Leave out POST /workflows/<name>; declared @http routes only' },
    ],
  },
  {
    name: 'grammar',
    syntax: 'fw grammar [options]',
    description: 'Output JSDoc annotation grammar specification',
    options: [
      { flags: '-f, --format', arg: 'html|ebnf', description: 'Output format', defaultValue: 'html' },
      { flags: '-o, --output', arg: '<path>', description: 'Write output to file instead of stdout' },
    ],
  },

  // ── Integration commands ───────────────────────────────────────
  {
    name: 'mcp-server',
    syntax: 'fw mcp-server [options]',
    description: 'Start MCP server for Claude Code integration',
    options: [
      { flags: '--stdio', description: 'Run in MCP stdio mode (skip interactive registration)' },
    ],
  },

  // ── Migration & changelog ──────────────────────────────────────
  {
    name: 'migrate',
    syntax: 'fw migrate <glob> [options]',
    description: 'Migrate workflow files to current syntax via parse → regenerate round-trip',
    botCompatible: true,
    options: [
      { flags: '--dry-run', description: 'Preview changes without writing files' },
      { flags: '--diff', description: 'Show semantic diff before/after' },
    ],
  },
];

/**
 * Extract CLI command documentation
 */
export function extractCliCommands(): TCliCommandDoc[] {
  return CLI_COMMANDS;
}
