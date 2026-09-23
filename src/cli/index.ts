/**
 * Flow Weaver Annotations CLI
 * Command-line interface for compiling and validating workflow files
 *
 * Note: Shebang is added by build script (scripts/build-cli.ts) to the CJS bundle.
 * Do not add #!/usr/bin/env node here - it will cause duplicate shebangs.
 */

// Must be imported first: sets up env vars before picocolors reads them
import './env-setup.js';


// Load built-in extensions before any commands run
import '../extensions/index.js';

import { Command, Option } from 'commander';
import { parseIntStrict } from './utils/parse-int-strict.js';
import { logger } from './utils/logger.js';
import { getErrorMessage } from '../utils/error-utils.js';

// ---------------------------------------------------------------------------
// All command handlers are lazy-loaded via dynamic import() inside their
// .action() callbacks. This avoids pulling in the parser/compiler/runtime
// chains (ts-morph, chevrotain, etc.) until a command that actually needs
// them is invoked, which makes lightweight commands like `fw --version` ~80%
// faster (~0.5s vs ~2.5s).
// ---------------------------------------------------------------------------


// Version is injected at build time by Vite
declare const __CLI_VERSION__: string;
const version = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev';

const program = new Command();

program
  .name('fw')
  .description('Flow Weaver: workflows as annotated TypeScript, compiled, validated, run, served and paused at gates')
  .option('-v, --version', 'Output the current version')
  .option('--no-color', 'Disable colors')
  .option('--color', 'Force colors')
  .on('option:version', () => {
    logger.banner(version);
    process.exit(0);
  })
  .configureHelp({
    sortSubcommands: false,
    subcommandTerm: (cmd) => cmd.name() + (cmd.usage() ? ' ' + cmd.usage() : ''),
  });

// Track whether our action handler already printed the error,
// so Commander's own error handling doesn't duplicate it.
let actionErrorHandled = false;

program.configureOutput({
  writeErr: (str) => {
    if (actionErrorHandled) return;
    const trimmed = str.replace(/^error:\s*/i, '').trimEnd();
    if (trimmed) {
      logger.error(trimmed);
    }
  },
  writeOut: (str) => process.stdout.write(str),
});

/**
 * Wraps a command action with centralized error handling.
 * Catches errors, prints them once, sets the flag to prevent Commander duplication.
 */
function wrapAction<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      actionErrorHandled = true;
      logger.error(getErrorMessage(error));
      process.exit(1);
    }
  };
}

// Compile command
program
  .command('compile <input>')
  .description('Compile workflow files to TypeScript')
  .option('-o, --output <path>', 'Output file or directory')
  .option('-p, --production', 'Generate production code (no debug events)', false)
  .option('-s, --source-map', 'Generate source maps', false)
  .option('--verbose', 'Verbose output', false)
  .option('--dry-run', 'Preview compilation without writing files', false)
  .option('-w, --workflow <name>', 'Specific workflow name to compile')
  .addOption(new Option('-f, --format <format>', 'Module format').choices(['esm', 'cjs', 'auto']).default('auto'))
  .option('--strict', 'Treat type coercion warnings as errors', false)
  .option('--clean', 'Omit redundant @param/@returns annotations from compiled output', false)
  .option('--target <target>', 'Compilation target: typescript (default) or a registered extension target')
  .option('--cron <schedule>', 'Set cron trigger schedule')
  .option('--serve', 'Generate serve() handler for HTTP event reception')
  .option('--framework <name>', 'Framework adapter for serve handler (next, express, hono, fastify, remix)')
  .option('--typed-events', 'Generate Zod event schemas from workflow @param annotations')
  .option('--retries <n>', 'Number of retries per function', parseIntStrict)
  .option('--timeout <duration>', 'Function timeout (e.g. "30m", "1h")')
  .action(wrapAction(async (input: string, options) => {
    const { compileCommand } = await import('./commands/compile.js');
    if (options.workflow) options.workflowName = options.workflow;
    await compileCommand(input, options);
  }));

// Strip command
program
  .command('strip <input>')
  .description('Remove generated code from compiled workflow files')
  .option('-o, --output <path>', 'Output directory (default: in-place)')
  .option('--dry-run', 'Preview without writing', false)
  .option('--verbose', 'Verbose output', false)
  .action(wrapAction(async (input: string, options) => {
      const { stripCommand } = await import('./commands/strip.js');
      await stripCommand(input, options);
  }));

// Describe command
program
  .command('describe <input>')
  .description('Output workflow structure in LLM-friendly formats (JSON, text, mermaid)')
  .addOption(new Option('-f, --format <format>', 'Output format').choices(['json', 'text', 'mermaid', 'paths', 'ascii', 'ascii-compact']).default('json'))
  .option('-n, --node <id>', 'Focus on a specific node')
  .option('--compile', 'Also update runtime markers in the source file')
  .option('-w, --workflow <name>', 'Specific workflow name to describe')
  .action(wrapAction(async (input: string, options) => {
      const { describeCommand } = await import('./commands/describe.js');
      if (options.workflow) options.workflowName = options.workflow;
      await describeCommand(input, options);
  }));

// Diagram command
program
  .command('diagram <input>')
  .description('Draw a workflow: its spine as an SVG, or text for a terminal')
  .addOption(new Option('-t, --theme <theme>', 'Color theme').choices(['dark', 'light']).default('dark'))
  .option('-w, --workflow <name>', 'Specific workflow to render')
  .addOption(new Option('-f, --format <format>', 'Output format').choices(['svg', 'ascii', 'ascii-compact', 'text']).default('svg'))
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(wrapAction(async (input: string, options) => {
      if (options.workflow) options.workflowName = options.workflow;
      const { diagramCommand } = await import('./commands/diagram.js');
      await diagramCommand(input, options);
  }));

// Artifact command
program
  .command('artifact <input>')
  .description('Hand a workflow to a person: the brief as a page or a PDF, or the spine as an SVG')
  .addOption(new Option('-k, --kind <kind>', 'What to produce').choices(['brief', 'pdf', 'svg']).default('brief'))
  .addOption(new Option('-t, --theme <theme>', 'Color theme').choices(['light', 'dark']).default('light'))
  .option('-w, --workflow <name>', 'Specific workflow to render')
  .option('--subtitle <text>', 'Shown under the title (default: the folder name)')
  .option('--browser <path>', 'Browser to print the PDF with (default: the one found on this machine, or FW_BROWSER)')
  .option('-o, --output <file>', 'Write to a file (a PDF is always written, beside the workflow when omitted)')
  .action(wrapAction(async (input: string, options) => {
      if (options.workflow) options.workflowName = options.workflow;
      const { artifactCommand } = await import('./commands/artifact.js');
      await artifactCommand(input, options);
  }));

// Diff command
program
  .command('diff <file1> <file2>')
  .description('Compare two workflow files semantically')
  .addOption(new Option('-f, --format <format>', 'Output format').choices(['text', 'json', 'compact']).default('text'))
  .option('-w, --workflow <name>', 'Specific workflow name to compare')
  .option('--exit-zero', 'Exit 0 even when differences are found', false)
  .action(wrapAction(async (file1: string, file2: string, options) => {
      const { diffCommand } = await import('./commands/diff.js');
      if (options.workflow) options.workflowName = options.workflow;
      await diffCommand(file1, file2, options);
  }));

// Validate command
program
  .command('validate <input>')
  .description('Validate workflow files without compiling')
  .option('--verbose', 'Verbose output', false)
  .option('-q, --quiet', 'Suppress warnings', false)
  .option('--json', 'Output results as JSON', false)
  .option('-w, --workflow <name>', 'Specific workflow name to validate')
  .option('--strict', 'Treat type coercion warnings as errors', false)
  .action(wrapAction(async (input: string, options) => {
      const { validateCommand } = await import('./commands/validate.js');
      if (options.workflow) options.workflowName = options.workflow;
      await validateCommand(input, options);
  }));

// Doctor command
program
  .command('doctor')
  .description('Check project environment and configuration for flow-weaver compatibility')
  .option('--json', 'Output results as JSON', false)
  .action(wrapAction(async (options) => {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand(options);
  }));

// Agents command
program
  .command('agents [directory]')
  .description('The agent profiles that answer agent gates in this project, and whether each is ready')
  .option('--init', 'Write the starter .flowweaver/agents.yaml', false)
  .option('--force', 'With --init: replace an existing file', false)
  .option('--json', 'Output as JSON', false)
  .action(wrapAction(async (directory: string | undefined, options) => {
      const { agentsCommand } = await import('./commands/agents.js');
      await agentsCommand(directory, options);
  }));

// Init command
program
  .command('init [directory]')
  .description('Create a new flow-weaver project')
  .option('-n, --name <name>', 'Project name (defaults to directory name)')
  .option('-t, --template <template>', 'Workflow template (default: sequential)')
  .option('-f, --format <format>', 'Module format: esm or cjs (default: esm)')
  .option('-y, --yes', 'Skip prompts and use defaults', false)
  .option('--preset <persona>', 'User preset: nocode, vibecoder, lowcode, expert')
  .option('--use-case <category>', 'Use case: data, ai, api, automation, minimal')
  .option('--mcp', 'Auto-configure MCP for AI editors after scaffolding')
  .option('--no-mcp', 'Skip MCP setup prompt')
  .option('--no-agent', 'Skip post-init agent launch prompt')
  .option('--install', 'Run npm install after scaffolding')
  .option('--no-install', 'Skip npm install')
  .option('--git', 'Initialize a git repository')
  .option('--no-git', 'Skip git init')
  .option('--force', 'Overwrite existing files', false)
  .action(wrapAction(async (directory: string | undefined, options) => {
      const { initCommand } = await import('./commands/init.js');
      await initCommand(directory, options);
  }));

// Watch command
program
  .command('watch <input>')
  .description('Watch workflow files and recompile on changes')
  .option('-o, --output <path>', 'Output file or directory')
  .option('-p, --production', 'Generate production code (no debug events)', false)
  .option('-s, --source-map', 'Generate source maps', false)
  .option('--verbose', 'Verbose output', false)
  .option('-w, --workflow <name>', 'Specific workflow name to compile')
  .option('-f, --format <format>', 'Module format: esm, cjs, or auto', 'auto')
  .action(wrapAction(async (input: string, options) => {
      const { watchCommand } = await import('./commands/watch.js');
      if (options.workflow) options.workflowName = options.workflow;
      await watchCommand(input, options);
  }));

// Dev command (watch + compile + run)
program
  .command('dev <input>')
  .description('Watch, compile, and run workflow on changes')
  .option('--params <json>', 'Input parameters as JSON string')
  .option('--params-file <path>', 'Path to JSON file with input parameters')
  .option('-w, --workflow <name>', 'Specific workflow name to run')
  .option('-p, --production', 'Run in production mode (no trace events)', false)
  .option('-f, --format <format>', 'Module format: esm, cjs, or auto', 'auto')
  .option('--clean', 'Omit redundant @param/@returns annotations', false)
  .option('--once', 'Run once then exit', false)
  .option('--json', 'Output result as JSON', false)
  .option('--target <target>', 'Compilation target (default: typescript)')
  .option('--mocks <json>', 'Mock config as JSON: gates (answers by node id), events, agents, invocations, fast')
  .option('--mocks-file <path>', 'Path to JSON file with mock config for built-in nodes')
  .action(wrapAction(async (input: string, options) => {
      const { devCommand } = await import('./commands/dev.js');
      await devCommand(input, options);
  }));

// MCP server command
program
  .command('mcp-server')
  .description('Start MCP server for Claude Code integration')
  .option('--stdio', 'Run in MCP stdio mode (skip interactive registration)')
  .action(wrapAction(async (options) => {
      const { mcpServerCommand } = await import('../mcp/server.js');
      await mcpServerCommand(options);
  }));

// MCP setup command
program
  .command('mcp-setup')
  .description('Configure MCP server for AI coding tools (Claude, Cursor, VS Code, Windsurf, Codex, OpenClaw)')
  .option('--tool <tools...>', 'Specific tools to configure (claude, cursor, vscode, windsurf, codex, openclaw)')
  .option('--all', 'Configure all detected tools without prompting')
  .option('--list', 'List detected tools without configuring')
  .action(wrapAction(async (options) => {
      const { mcpSetupCommand } = await import('./commands/mcp-setup.js');
      await mcpSetupCommand(options);
  }));

// Create command (with subcommands)
const createCmd = program.command('create').description('Create workflows or nodes from templates');

createCmd
  .command('workflow <template> <file>')
  .description('Create a workflow from a template')
  .option('-l, --line <number>', 'Insert at specific line number', parseIntStrict)
  .option('-a, --async', 'Generate an async workflow', false)
  .option('-p, --preview', 'Preview generated code without writing', false)
  .option('--provider <provider>', 'LLM provider (openai, anthropic, ollama, mock)')
  .option('--model <model>', 'Model identifier (e.g., gpt-4o, claude-3-5-sonnet-20241022)')
  .option('--config <json>', 'Configuration as JSON string')
  .option('--name <name>', 'Override the derived workflow function name')
  .option('--nodes <names>', 'Comma-separated node function names (e.g., "fetch,parse,store")')
  .option('--input <name>', 'Custom input port name (default: "data")')
  .option('--output <name>', 'Custom output port name (default: "result")')
  .action(wrapAction(async (template: string, file: string, options) => {
      const { createWorkflowCommand } = await import('./commands/create.js');
      await createWorkflowCommand(template, file, options);
  }));

createCmd
  .command('node <name> <file>')
  .description('Create a node type from a template')
  .option('-l, --line <number>', 'Insert at specific line number', parseIntStrict)
  .option('-t, --template <template>', 'Node template to use', 'transformer')
  .option('-p, --preview', 'Preview generated code without writing', false)
  .option('--strategy <strategy>', 'Template strategy (e.g. mock, callback, webhook)')
  .option('--config <json>', 'Additional configuration (JSON)')
  .action(wrapAction(async (name: string, file: string, options) => {
      const { createNodeCommand } = await import('./commands/create.js');
      await createNodeCommand(name, file, options);
  }));

// Modify command (with subcommands)
const modifyCmd = program.command('modify').description('Modify workflow structure');

modifyCmd
  .command('addNode')
  .description('Add a node instance to a workflow')
  .requiredOption('--file <path>', 'Workflow file')
  .requiredOption('--nodeId <id>', 'Node instance ID')
  .requiredOption('--nodeType <type>', 'Node type name')
  .action(wrapAction(async (options) => {
    const { modifyAddNodeCommand } = await import('./commands/modify.js');
    await modifyAddNodeCommand(options.file, options);
  }));

modifyCmd
  .command('removeNode')
  .description('Remove a node instance from a workflow')
  .requiredOption('--file <path>', 'Workflow file')
  .requiredOption('--nodeId <id>', 'Node instance ID')
  .action(wrapAction(async (options) => {
    const { modifyRemoveNodeCommand } = await import('./commands/modify.js');
    await modifyRemoveNodeCommand(options.file, options);
  }));

modifyCmd
  .command('addConnection')
  .description('Add a connection between nodes')
  .requiredOption('--file <path>', 'Workflow file')
  .requiredOption('--from <node.port>', 'Source (e.g. nodeA.output)')
  .requiredOption('--to <node.port>', 'Target (e.g. nodeB.input)')
  .action(wrapAction(async (options) => {
    const { modifyAddConnectionCommand } = await import('./commands/modify.js');
    await modifyAddConnectionCommand(options.file, options);
  }));

modifyCmd
  .command('removeConnection')
  .description('Remove a connection between nodes')
  .requiredOption('--file <path>', 'Workflow file')
  .requiredOption('--from <node.port>', 'Source (e.g. nodeA.output)')
  .requiredOption('--to <node.port>', 'Target (e.g. nodeB.input)')
  .action(wrapAction(async (options) => {
    const { modifyRemoveConnectionCommand } = await import('./commands/modify.js');
    await modifyRemoveConnectionCommand(options.file, options);
  }));

modifyCmd
  .command('renameNode')
  .description('Rename a node instance (updates all connections)')
  .requiredOption('--file <path>', 'Workflow file')
  .requiredOption('--oldId <id>', 'Current node ID')
  .requiredOption('--newId <id>', 'New node ID')
  .action(wrapAction(async (options) => {
    const { modifyRenameNodeCommand } = await import('./commands/modify.js');
    await modifyRenameNodeCommand(options.file, options);
  }));

modifyCmd
  .command('setLabel')
  .description('Set display label for a node instance')
  .requiredOption('--file <path>', 'Workflow file')
  .requiredOption('--nodeId <id>', 'Node instance ID')
  .requiredOption('--label <text>', 'Display label')
  .action(wrapAction(async (options) => {
    const { modifySetLabelCommand } = await import('./commands/modify.js');
    await modifySetLabelCommand(options.file, options);
  }));

// Templates command
program
  .command('templates')
  .description('List available templates')
  .option('--json', 'Output as JSON', false)
  .action(wrapAction(async (options) => {
      const { templatesCommand } = await import('./commands/templates.js');
      await templatesCommand(options);
  }));

// Grammar command
program
  .command('grammar')
  .description(
    'Output JSDoc annotation grammar (@input, @output, @connect, @node, @scope) as HTML railroad diagrams or EBNF text'
  )
  .addOption(new Option('-f, --format <format>', 'Output format').choices(['html', 'ebnf']))
  .option('-o, --output <path>', 'Write output to file instead of stdout')
  .action(wrapAction(async (options) => {
      const { grammarCommand } = await import('./commands/grammar.js');
      await grammarCommand(options);
  }));

// Run command
program
  .command('run <input>')
  .description('Execute a workflow file directly')
  .option('-w, --workflow <name>', 'Specific workflow name to run')
  .option('--params <json>', 'Input parameters as JSON string')
  .option('--params-file <path>', 'Path to JSON file with input parameters')
  .option('-p, --production', 'Production mode (no trace events)', false)
  .option('-t, --trace', 'Include execution trace events')
  .option('-s, --stream', 'Stream trace events in real-time')
  .option('--json', 'Output result as JSON', false)
  .option('--timeout <ms>', 'Execution timeout in milliseconds', parseIntStrict)
  .option('--mocks <json>', 'Mock config as JSON: gates (answers by node id), events, agents, invocations, fast')
  .option('--mocks-file <path>', 'Path to JSON file with mock config for built-in nodes')
  .option('-d, --debug', 'Start in step-through debug mode')
  .option('-b, --breakpoint <nodeIds...>', 'Set initial breakpoints (repeatable)')
  .action(wrapAction(async (input: string, options) => {
      const { runCommand } = await import('./commands/run.js');
      await runCommand(input, options);
  }));

// Serve command
program
  .command('serve [directory]')
  .description('Serve the workflows as HTTP endpoints. Gated runs pause, resume and stream over the same API')
  .option('-p, --port <port>', 'Server port', '3000')
  .option('-H, --host <host>', 'Server host. Beyond loopback needs --token or --insecure', '127.0.0.1')
  .option('--token <token>', 'Bearer token every request must carry (also FW_SERVE_TOKEN)')
  .option('--no-agents', 'Do not answer agent gates from .flowweaver/agents.yaml')
  .option('--trace', 'Keep a step trace for every run and stream it on /runs/:id/events', false)
  .option('--dev', 'Error stacks in responses, and mocks accepted when starting a run', false)
  .option('--insecure', 'Listen beyond loopback without a token', false)
  .option('--no-watch', 'Disable file watching for hot reload')
  .option('--cors <origin>', 'Send CORS headers for this origin')
  .option('--swagger', 'Enable Swagger UI at /docs', false)
  .option('--production', 'Deprecated: the same as leaving --trace off', false)
  .action(wrapAction(async (directory: string | undefined, options) => {
      const { serveCommand } = await import('./commands/serve.js');
      await serveCommand(directory, {
        port: parseIntStrict(options.port),
        host: options.host,
        watch: options.watch,
        production: options.production,
        cors: options.cors,
        swagger: options.swagger,
        token: options.token,
        agents: options.agents,
        trace: options.trace,
        dev: options.dev,
        insecure: options.insecure,
      });
  }));

// Console command
program
  .command('console [directory]')
  .description('Open the local operator console: workflows as processes, issues, code, live runs and gates')
  .option('-p, --port <port>', 'Port', '4311')
  .option('-H, --host <host>', 'Host to bind (local by default)', '127.0.0.1')
  .option('--open', 'Open the browser once listening', false)
  .option('--no-watch', 'Do not reload when project files change')
  .action(wrapAction(async (directory: string | undefined, options) => {
      const { consoleCommand } = await import('./commands/console.js');
      await consoleCommand(directory, {
        port: parseIntStrict(options.port),
        host: options.host,
        open: options.open,
        watch: options.watch,
      });
  }));

// Export command
program
  .command('export <input>')
  .description('Export a workflow to a target provided by an installed pack')
  .requiredOption('-t, --target <target>', 'Target platform (install target packs via marketplace)')
  .requiredOption('-o, --output <path>', 'Output directory')
  .option('-w, --workflow <name>', 'Specific workflow name to export')
  .option('-p, --production', 'Production mode (no debug events)', false)
  .option('--bundle', 'Bundle node types into the output', false)
  .option('--dry-run', 'Preview without writing files', false)
  .option('--multi', 'Export all workflows in file as a single multi-workflow service', false)
  .option('--workflows <names>', 'Comma-separated list of workflows to export (used with --multi)')
  .option('--docs', 'Include API documentation routes (/docs and /openapi.json)', false)
  .option('--durable-steps', 'Use deep generator with per-node durable steps', false)
  .action(wrapAction(async (input: string, options) => {
      const { exportCommand } = await import('./commands/export.js');
      await exportCommand(input, options);
  }));

// OpenAPI command
program
  .command('openapi <directory>')
  .description('Generate OpenAPI specification from workflows')
  .option('-o, --output <path>', 'Output file path')
  .option('--title <title>', 'API title', 'Flow Weaver API')
  .option('--version <version>', 'API version', '1.0.0')
  .option('--description <desc>', 'API description')
  .option('-f, --format <format>', 'Output format: json, yaml', 'json')
  .option('--server <url>', 'Server URL')
  .option('--no-auth', 'Leave out the bearer scheme, for a server without a token')
  .option('--no-legacy', 'Leave out POST /workflows/<name>, and declare @http routes only')
  .action(wrapAction(async (directory: string, options) => {
      const { openapiCommand } = await import('./commands/openapi.js');
      await openapiCommand(directory, options);
  }));

// Plugin command group
// Migrate command
program
  .command('migrate <glob>')
  .description('Migrate workflow files to current syntax via parse → regenerate round-trip')
  .option('--dry-run', 'Preview changes without writing files', false)
  .option('--diff', 'Show semantic diff before/after', false)
  .action(wrapAction(async (glob: string, options) => {
      const { migrateCommand } = await import('./commands/migrate.js');
      await migrateCommand(glob, options);
  }));

// Status command
program
  .command('status <input>')
  .description('Report implementation progress for stub workflows')
  .option('-w, --workflow <name>', 'Specific workflow name')
  .option('--json', 'Output as JSON', false)
  .action(wrapAction(async (input: string, options) => {
      const { statusCommand } = await import('./commands/status.js');
      if (options.workflow) options.workflowName = options.workflow;
      await statusCommand(input, options);
  }));

// Implement command
program
  .command('implement <input> [node]')
  .description('Replace a stub node with a real function skeleton')
  .option('-w, --workflow <name>', 'Specific workflow name')
  .option('--nodeId <id>', 'Node to implement (alternative to positional arg)')
  .option('-p, --preview', 'Preview the generated code without writing', false)
  .action(wrapAction(async (input: string, node: string | undefined, options) => {
      const nodeName = node ?? options.nodeId;
      if (!nodeName) {
        throw new Error('Node name is required (as positional arg or --nodeId flag)');
      }
      const { implementCommand } = await import('./commands/implement.js');
      if (options.workflow) options.workflowName = options.workflow;
      await implementCommand(input, nodeName, options);
  }));

// Docs command: fw docs [topic] | fw docs search <query>
program
  .command('docs [args...]')
  .description('Browse reference documentation')
  .option('--json', 'Output as JSON', false)
  .option('--compact', 'Return compact LLM-friendly version', false)
  .action(wrapAction(async (args: string[], options) => {
      const { docsListCommand, docsReadCommand, docsSearchCommand } = await import('./commands/docs.js');
      if (args.length === 0 || args[0] === 'list') {
        await docsListCommand(options);
      } else if (args[0] === 'search') {
        const query = args.slice(1).join(' ');
        if (!query) {
          logger.error('Usage: fw docs search <query>');
          process.exit(1);
        }
        await docsSearchCommand(query, options);
      } else {
        await docsReadCommand(args[0], options);
      }
  }));

// Context command: generate LLM context bundles
program
  .command('context [preset]')
  .description('Generate LLM context bundle from documentation and grammar')
  .option('--profile <profile>', 'Output profile: standalone or assistant', 'standalone')
  .option('--topics <slugs>', 'Comma-separated topic slugs (overrides preset)')
  .option('--add <slugs>', 'Comma-separated topic slugs to add to preset')
  .option('--no-grammar', 'Omit EBNF grammar section')
  .option('-o, --output <path>', 'Write to file instead of stdout')
  .option('--list', 'List available presets and exit')
  .action(wrapAction(async (preset: string | undefined, options) => {
      const { contextCommand } = await import('./commands/context.js');
      await contextCommand(preset, options);
  }));

// Marketplace command group
const marketCmd = program.command('market').description('Discover, install, and publish marketplace packages');

marketCmd
  .command('init <name>')
  .description('Scaffold a new marketplace package')
  .option('-d, --description <desc>', 'Package description')
  .option('-a, --author <author>', 'Author name')
  .option('-y, --yes', 'Skip prompts and use defaults', false)
  .action(wrapAction(async (name: string, options) => {
      const { marketInitCommand } = await import('./commands/market.js');
      await marketInitCommand(name, options);
  }));

marketCmd
  .command('pack [directory]')
  .description('Validate and generate flowweaver.manifest.json')
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Show parse warnings', false)
  .action(wrapAction(async (directory: string | undefined, options) => {
      const { marketPackCommand } = await import('./commands/market.js');
      await marketPackCommand(directory, options);
  }));

marketCmd
  .command('publish [directory]')
  .description('Pack and publish to npm')
  .option('--dry-run', 'Preview without publishing', false)
  .option('--tag <tag>', 'npm dist-tag')
  .action(wrapAction(async (directory: string | undefined, options) => {
      const { marketPublishCommand } = await import('./commands/market.js');
      await marketPublishCommand(directory, options);
  }));

marketCmd
  .command('install <package>')
  .description('Install a marketplace package')
  .option('--json', 'Output results as JSON', false)
  .action(wrapAction(async (packageSpec: string, options) => {
      const { marketInstallCommand } = await import('./commands/market.js');
      await marketInstallCommand(packageSpec, options);
  }));

marketCmd
  .command('search [query]')
  .description('Search npm for marketplace packages')
  .option('-l, --limit <number>', 'Max results', '20')
  .option('-r, --registry <url>', 'Custom registry search URL (e.g., private npm registry)')
  .option('--json', 'Output as JSON', false)
  .action(wrapAction(async (query: string | undefined, options) => {
      const { marketSearchCommand } = await import('./commands/market.js');
      await marketSearchCommand(query, { ...options, limit: parseIntStrict(options.limit) });
  }));

marketCmd
  .command('list')
  .description('List installed marketplace packages')
  .option('--json', 'Output as JSON', false)
  .action(wrapAction(async (options) => {
      const { marketListCommand } = await import('./commands/market.js');
      await marketListCommand(options);
  }));

// Concise examples appended to --help
program.addHelpText('after', `
Examples:

  $ fw compile my-workflow.ts
  $ fw validate 'src/**/*.ts'
  $ fw run workflow.ts --params '{"a": 5}'
  $ fw describe workflow.ts --format ascii-compact
  $ fw init my-project

  Run fw <command> --help for detailed usage.
`);

// Show concise welcome when no command specified (before parse to avoid Commander error handling)
if (!process.argv.slice(2).length) {
  logger.banner(version);
  console.log();
  console.log('  Usage: flow-weaver <command> [options]');
  console.log();
  console.log('  Get started:');
  console.log('    init [dir]        Create a new project');
  console.log('    compile <input>   Compile workflow files');
  console.log('    validate <input>  Validate without compiling');
  console.log('    run <input>       Execute a workflow');
  console.log('    doctor            Check project environment');
  console.log();
  console.log('  Run ' + logger.highlight('fw --help') + ' for all commands.');
  console.log();
  process.exit(0);
}

// Register pack-contributed CLI commands, then parse.
// Skip when loaded inside vitest's worker (coverage instrumentation).
if (!process.env['VITEST']) {
  (async () => {
    const { registerPackCommands } = await import('./pack-commands.js');
    await registerPackCommands(program);

    program.parse(process.argv);
  })();
}
