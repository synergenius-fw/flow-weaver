/**
 * Flow Weaver Annotations CLI
 * Command-line interface for compiling and validating workflow files
 *
 * Note: Shebang is added by build script (scripts/build-cli.ts) to the CJS bundle.
 * Do not add #!/usr/bin/env node here - it will cause duplicate shebangs.
 */

// Must be imported first: sets up env vars before picocolors reads them
import './env-setup.js';

import * as path from 'node:path';

// Load built-in extensions (CI/CD, etc.) before any commands run
import '../extensions/index.js';

import { Command, Option } from 'commander';
import { logger } from './utils/logger.js';
import { getErrorMessage } from '../utils/error-utils.js';

// ---------------------------------------------------------------------------
// All command handlers are lazy-loaded via dynamic import() inside their
// .action() callbacks. This avoids pulling in the parser/compiler/runtime
// chains (ts-morph, chevrotain, etc.) until a command that actually needs
// them is invoked — making lightweight commands like `fw --version` ~80%
// faster (~0.5s vs ~2.5s).
// ---------------------------------------------------------------------------


// Version is injected at build time by Vite
declare const __CLI_VERSION__: string;
const version = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev';

const program = new Command();

program
  .name('fw')
  .description('Flow Weaver Annotations - Compile and validate workflow files')
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
  .option('--inline-runtime', 'Force inline runtime even when @synergenius/flow-weaver package is installed', false)
  .option('--clean', 'Omit redundant @param/@returns annotations from compiled output', false)
  .option('--target <target>', 'Compilation target: typescript (default) or a registered extension target')
  .option('--cron <schedule>', 'Set cron trigger schedule')
  .option('--serve', 'Generate serve() handler for HTTP event reception')
  .option('--framework <name>', 'Framework adapter for serve handler (next, express, hono, fastify, remix)')
  .option('--typed-events', 'Generate Zod event schemas from workflow @param annotations')
  .option('--retries <n>', 'Number of retries per function', parseInt)
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
  .description('Generate SVG or interactive HTML diagram of a workflow')
  .option('-t, --theme <theme>', 'Color theme: dark, light', 'dark')
  .option('--width <pixels>', 'SVG width in pixels')
  .option('-p, --padding <pixels>', 'Canvas padding in pixels')
  .option('--no-port-labels', 'Hide data type labels on ports')
  .option('-w, --workflow <name>', 'Specific workflow to render')
  .addOption(new Option('-f, --format <format>', 'Output format').choices(['svg', 'html', 'ascii', 'ascii-compact', 'text']).default('svg'))
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(wrapAction(async (input: string, options) => {
      if (options.width) options.width = Number(options.width);
      if (options.padding) options.padding = Number(options.padding);
      options.showPortLabels = options.portLabels;
      if (options.workflow) options.workflowName = options.workflow;
      const { diagramCommand } = await import('./commands/diagram.js');
      await diagramCommand(input, options);
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

// Init command
program
  .command('init [directory]')
  .description('Create a new flow-weaver project')
  .option('-n, --name <name>', 'Project name (defaults to directory name)')
  .option('-t, --template <template>', 'Workflow template (default: sequential)')
  .option('-f, --format <format>', 'Module format: esm or cjs (default: esm)')
  .option('-y, --yes', 'Skip prompts and use defaults', false)
  .option('--preset <persona>', 'User preset: nocode, vibecoder, lowcode, expert')
  .option('--use-case <category>', 'Use case: data, ai, api, automation, cicd, minimal')
  .option('--mcp', 'Auto-configure MCP for AI editors after scaffolding')
  .option('--no-mcp', 'Skip MCP setup prompt')
  .option('--no-agent', 'Skip post-init agent launch prompt')
  .option('--install', 'Run npm install after scaffolding')
  .option('--no-install', 'Skip npm install')
  .option('--git', 'Initialize a git repository')
  .option('--no-git', 'Skip git init')
  .option('--with-weaver', 'Install Weaver AI assistant')
  .option('--no-weaver', 'Skip Weaver installation')
  .option('--force', 'Overwrite existing files', false)
  .option('--json', 'Output results as JSON', false)
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
  .option('--framework <framework>', 'Framework for serve handler', 'express')
  .option('--port <port>', 'Port for dev server', (v: string) => parseInt(v, 10), 3000)
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
  .option('-l, --line <number>', 'Insert at specific line number', parseInt)
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
  .option('-l, --line <number>', 'Insert at specific line number', parseInt)
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
  .command('setPosition')
  .description('Set position of a node instance')
  .requiredOption('--file <path>', 'Workflow file')
  .requiredOption('--nodeId <id>', 'Node instance ID')
  .requiredOption('--x <number>', 'X coordinate')
  .requiredOption('--y <number>', 'Y coordinate')
  .action(wrapAction(async (options) => {
    const { modifySetPositionCommand } = await import('./commands/modify.js');
    await modifySetPositionCommand(options.file, options);
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

// Pattern command (with subcommands)
const patternCmd = program.command('pattern').description('Work with reusable workflow patterns');

patternCmd
  .command('list <path>')
  .description('List patterns in a file or directory')
  .option('--json', 'Output as JSON', false)
  .action(wrapAction(async (inputPath: string, options) => {
      const { patternListCommand } = await import('./commands/pattern.js');
      await patternListCommand(inputPath, options);
  }));

patternCmd
  .command('apply <pattern-file> <target-file>')
  .description('Apply a pattern to a workflow file')
  .option('-p, --preview', 'Preview changes without writing', false)
  .option('--prefix <prefix>', 'Prefix for node instance IDs')
  .option('-n, --name <name>', 'Specific pattern name to apply')
  .action(wrapAction(async (patternFile: string, targetFile: string, options) => {
      const { patternApplyCommand } = await import('./commands/pattern.js');
      await patternApplyCommand(patternFile, targetFile, options);
  }));

patternCmd
  .command('extract <source-file>')
  .description('Extract a pattern from workflow nodes')
  .requiredOption('--nodes <nodes>', 'Comma-separated list of node IDs to extract')
  .requiredOption('-o, --output <file>', 'Output pattern file')
  .option('-n, --name <name>', 'Pattern name')
  .option('-p, --preview', 'Preview pattern without writing', false)
  .action(wrapAction(async (sourceFile: string, options) => {
      const { patternExtractCommand } = await import('./commands/pattern.js');
      await patternExtractCommand(sourceFile, options);
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
  .option('--timeout <ms>', 'Execution timeout in milliseconds', parseInt)
  .option('--mocks <json>', 'Mock config for built-in nodes (events, invocations, agents, fast) as JSON')
  .option('--mocks-file <path>', 'Path to JSON file with mock config for built-in nodes')
  .option('-d, --debug', 'Start in step-through debug mode')
  .option('--checkpoint', 'Enable checkpointing to disk after each node')
  .option('--resume [file]', 'Resume from a checkpoint file (auto-detects latest if no file)')
  .option('-b, --breakpoint <nodeIds...>', 'Set initial breakpoints (repeatable)')
  .action(wrapAction(async (input: string, options) => {
      const { runCommand } = await import('./commands/run.js');
      await runCommand(input, options);
  }));

// Serve command
program
  .command('serve [directory]')
  .description('Start HTTP server exposing workflows as endpoints')
  .option('-p, --port <port>', 'Server port', '3000')
  .option('-H, --host <host>', 'Server host', '0.0.0.0')
  .option('--no-watch', 'Disable file watching for hot reload')
  .option('--production', 'Production mode (no trace events)', false)
  .option('--precompile', 'Precompile all workflows on startup', false)
  .option('--cors <origin>', 'CORS origin', '*')
  .option('--swagger', 'Enable Swagger UI at /docs', false)
  .action(wrapAction(async (directory: string | undefined, options) => {
      const { serveCommand } = await import('./commands/serve.js');
      await serveCommand(directory, {
        port: parseInt(options.port, 10),
        host: options.host,
        watch: options.watch,
        production: options.production,
        precompile: options.precompile,
        cors: options.cors,
        swagger: options.swagger,
      });
  }));

// Export command
program
  .command('export <input>')
  .description('Export workflow as serverless function')
  .requiredOption('-t, --target <target>', 'Target platform (install target packs via marketplace)')
  .requiredOption('-o, --output <path>', 'Output directory')
  .option('-w, --workflow <name>', 'Specific workflow name to export')
  .option('-p, --production', 'Production mode', true)
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
  .action(wrapAction(async (directory: string, options) => {
      const { openapiCommand } = await import('./commands/openapi.js');
      await openapiCommand(directory, options);
  }));

// Plugin command group
const pluginCmd = program.command('plugin').description('Scaffold and manage external plugins');

pluginCmd
  .command('init <name>')
  .description('Scaffold a new external plugin')
  .option('-a, --area <area>', 'Component area: sidebar, main, toolbar, modal, panel', 'panel')
  .option('--no-system', 'Skip generating a system module')
  .option('-p, --preview', 'Preview generated files without writing', false)
  .option('--force', 'Overwrite existing files', false)
  .action(wrapAction(async (name: string, options) => {
      const { pluginInitCommand } = await import('./commands/plugin.js');
      await pluginInitCommand(name, options);
  }));

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

// Changelog command
program
  .command('changelog')
  .description('Generate changelog from git history, categorized by file path')
  .option('--last-tag', 'From last git tag to HEAD', false)
  .option('--since <date>', 'Date-based range (e.g., "2024-01-01")')
  .option('-r, --range <range>', 'Custom git range (e.g., "v0.1.0..HEAD")')
  .action(wrapAction(async (options) => {
      const { changelogCommand } = await import('./commands/changelog.js');
      await changelogCommand(options);
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
      await marketSearchCommand(query, { ...options, limit: parseInt(options.limit, 10) });
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

    // Auth commands (login, logout, status)
    program
      .command('login')
      .description('Log in to Flow Weaver platform')
      .option('-e, --email <email>', 'Email address')
      .option('-k, --api-key <key>', 'Use API key instead of email/password')
      .option('--platform-url <url>', 'Platform URL')
      .action(async (options) => {
        const { loginCommand } = await import('./commands/auth.js');
        await loginCommand(options);
      });

    program
      .command('logout')
      .description('Log out from Flow Weaver platform')
      .action(async () => {
        const { logoutCommand } = await import('./commands/auth.js');
        await logoutCommand();
      });

    program
      .command('auth')
      .description('Show authentication status')
      .action(async () => {
        const { authStatusCommand } = await import('./commands/auth.js');
        await authStatusCommand();
      });

    // Deploy commands (push + deploy to cloud)
    program
      .command('deploy <file>')
      .description('Deploy a workflow to the platform')
      .option('-n, --name <name>', 'Workflow name (defaults to filename)')
      .action(async (file: string, options: { name?: string }) => {
        const { deployCommand } = await import('./commands/deploy.js');
        await deployCommand(file, options);
      });

    program
      .command('undeploy <slug>')
      .description('Remove a deployed workflow')
      .action(async (slug: string) => {
        const { undeployCommand } = await import('./commands/deploy.js');
        await undeployCommand(slug);
      });

    program
      .command('cloud-status')
      .description('Show cloud deployments and usage')
      .action(async () => {
        const { cloudStatusCommand } = await import('./commands/deploy.js');
        await cloudStatusCommand();
      });

    // Connect command — connect this device to the platform
    program
      .command('connect [dir]')
      .description('Connect this device to the Flow Weaver platform')
      .action(async (dir?: string) => {
        const { handleConnect } = await import('./commands/connect.js');
        await handleConnect(path.resolve(dir ?? '.'));
      });

    // Fallback weaver shim if pack not installed
    if (!program.commands.some(c => c.name() === 'weaver')) {
      program
        .command('weaver')
        .description('AI assistant for Flow Weaver workflows')
        .allowUnknownOption(true)
        .action(async () => {
          console.log('');
          console.log('  Weaver is not installed.');
          console.log('');
          console.log('  Install it:');
          console.log('    npm install @synergenius/flow-weaver-pack-weaver');
          console.log('');
          console.log('  Or during project init:');
          console.log('    flow-weaver init    (select "Yes" when asked about Weaver)');
          console.log('');
        });
    }

    program.parse(process.argv);
  })();
}
