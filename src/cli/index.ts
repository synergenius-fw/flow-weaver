/**
 * Flow Weaver Annotations CLI
 * Command-line interface for compiling and validating workflow files
 *
 * Note: Shebang is added by build script (scripts/build-cli.ts) to the CJS bundle.
 * Do not add #!/usr/bin/env node here - it will cause duplicate shebangs.
 */

import { Command } from 'commander';
import { compileCommand } from './commands/compile.js';
import { createWorkflowCommand, createNodeCommand } from './commands/create.js';
import { describeCommand } from './commands/describe.js';
import { diagramCommand } from './commands/diagram.js';
import { diffCommand } from './commands/diff.js';
import {
  patternListCommand,
  patternApplyCommand,
  patternExtractCommand,
} from './commands/pattern.js';
import { templatesCommand } from './commands/templates.js';
import { validateCommand } from './commands/validate.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { watchCommand } from './commands/watch.js';
import { devCommand } from './commands/dev.js';
import { listenCommand } from './commands/listen.js';
import { mcpServerCommand } from '../mcp/server.js';
import { uiFocusNode, uiAddNode, uiOpenWorkflow, uiGetState, uiBatch } from './commands/ui.js';
import { grammarCommand } from './commands/grammar.js';
import { runCommand } from './commands/run.js';
import { serveCommand } from './commands/serve.js';
import { exportCommand } from './commands/export.js';
import { openapiCommand } from './commands/openapi.js';
import { pluginInitCommand } from './commands/plugin.js';
import { migrateCommand } from './commands/migrate.js';
import { changelogCommand } from './commands/changelog.js';
import { docsListCommand, docsReadCommand, docsSearchCommand } from './commands/docs.js';
import {
  marketInitCommand,
  marketPackCommand,
  marketPublishCommand,
  marketInstallCommand,
  marketSearchCommand,
  marketListCommand,
} from './commands/market.js';
import { logger } from './utils/logger.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { DEFAULT_SERVER_URL } from '../defaults.js';

// Version is injected at build time by Vite
declare const __CLI_VERSION__: string;
const version = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev';

const program = new Command();

program
  .name('flow-weaver')
  .description('Flow Weaver Annotations - Compile and validate workflow files')
  .version(version, '-v, --version', 'Output the current version');

program.configureOutput({
  writeErr: (str) => {
    const trimmed = str.replace(/^error:\s*/i, '').trimEnd();
    if (trimmed) {
      logger.error(trimmed);
    }
  },
  writeOut: (str) => process.stdout.write(str),
});

// Compile command
program
  .command('compile <input>')
  .description('Compile workflow files to TypeScript')
  .option('-o, --output <path>', 'Output file or directory')
  .option('-p, --production', 'Generate production code (no debug events)', false)
  .option('-s, --source-map', 'Generate source maps', false)
  .option('--verbose', 'Verbose output', false)
  .option('--dry-run', 'Preview compilation without writing files', false)
  .option('-w, --workflow-name <name>', 'Specific workflow name to compile')
  .option('-f, --format <format>', 'Module format: esm, cjs, or auto (default: auto)', 'auto')
  .option('--strict', 'Treat type coercion warnings as errors', false)
  .option('--inline-runtime', 'Force inline runtime even when @synergenius/flow-weaver package is installed', false)
  .option('--clean', 'Omit redundant @param/@returns annotations from compiled output', false)
  .option('--target <target>', 'Compilation target: typescript (default) or inngest (per-node step.run)')
  .option('--cron <schedule>', 'Set cron trigger schedule (Inngest target only)')
  .option('--serve', 'Generate serve() handler for HTTP event reception')
  .option('--framework <name>', 'Framework adapter for serve handler (next, express, hono, fastify, remix)')
  .option('--typed-events', 'Generate Zod event schemas from workflow @param annotations')
  .option('--retries <n>', 'Number of retries per function (Inngest target only)', parseInt)
  .option('--timeout <duration>', 'Function timeout (e.g. "30m", "1h")')
  .action(async (input: string, options) => {
    try {
      await compileCommand(input, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Describe command
program
  .command('describe <input>')
  .description('Output workflow structure in LLM-friendly formats (JSON, text, mermaid)')
  .option('-f, --format <format>', 'Output format: json (default), text, mermaid', 'json')
  .option('-n, --node <id>', 'Focus on a specific node')
  .option('--compile', 'Also update runtime markers in the source file')
  .option('-w, --workflow-name <name>', 'Specific workflow name to describe')
  .action(async (input: string, options) => {
    try {
      await describeCommand(input, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Diagram command
program
  .command('diagram <input>')
  .description('Generate SVG or interactive HTML diagram of a workflow')
  .option('-t, --theme <theme>', 'Color theme: dark (default), light', 'dark')
  .option('-w, --width <pixels>', 'SVG width in pixels')
  .option('-p, --padding <pixels>', 'Canvas padding in pixels')
  .option('--no-port-labels', 'Hide data type labels on ports')
  .option('--workflow-name <name>', 'Specific workflow to render')
  .option('-f, --format <format>', 'Output format: svg (default), html (interactive viewer)', 'svg')
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (input: string, options) => {
    try {
      if (options.width) options.width = Number(options.width);
      if (options.padding) options.padding = Number(options.padding);
      options.showPortLabels = options.portLabels;
      await diagramCommand(input, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Diff command
program
  .command('diff <file1> <file2>')
  .description('Compare two workflow files semantically')
  .option('-f, --format <format>', 'Output format: text (default), json, compact', 'text')
  .option('-w, --workflow-name <name>', 'Specific workflow name to compare')
  .option('--exit-zero', 'Exit 0 even when differences are found', false)
  .action(async (file1: string, file2: string, options) => {
    try {
      await diffCommand(file1, file2, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate <input>')
  .description('Validate workflow files without compiling')
  .option('--verbose', 'Verbose output', false)
  .option('-q, --quiet', 'Suppress warnings', false)
  .option('--json', 'Output results as JSON', false)
  .option('-w, --workflow-name <name>', 'Specific workflow name to validate')
  .option('--strict', 'Treat type coercion warnings as errors', false)
  .action(async (input: string, options) => {
    try {
      await validateCommand(input, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Doctor command
program
  .command('doctor')
  .description('Check project environment and configuration for flow-weaver compatibility')
  .option('--json', 'Output results as JSON', false)
  .action(async (options) => {
    try {
      await doctorCommand(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Init command
program
  .command('init [directory]')
  .description('Create a new flow-weaver project')
  .option('-n, --name <name>', 'Project name (defaults to directory name)')
  .option('-t, --template <template>', 'Workflow template (default: simple)')
  .option('-f, --format <format>', 'Module format: esm or cjs (default: esm)')
  .option('-y, --yes', 'Skip prompts and use defaults', false)
  .option('--install', 'Run npm install after scaffolding')
  .option('--no-install', 'Skip npm install')
  .option('--git', 'Initialize a git repository')
  .option('--no-git', 'Skip git init')
  .option('--force', 'Overwrite existing files', false)
  .option('--json', 'Output results as JSON', false)
  .action(async (directory: string | undefined, options) => {
    try {
      await initCommand(directory, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Watch command
program
  .command('watch <input>')
  .description('Watch workflow files and recompile on changes')
  .option('-o, --output <path>', 'Output file or directory')
  .option('-p, --production', 'Generate production code (no debug events)', false)
  .option('-s, --source-map', 'Generate source maps', false)
  .option('--verbose', 'Verbose output', false)
  .option('-w, --workflow-name <name>', 'Specific workflow name to compile')
  .option('-f, --format <format>', 'Module format: esm, cjs, or auto (default: auto)', 'auto')
  .action(async (input: string, options) => {
    try {
      await watchCommand(input, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Dev command (watch + compile + run)
program
  .command('dev <input>')
  .description('Watch, compile, and run workflow on changes')
  .option('--params <json>', 'Input parameters as JSON string')
  .option('--params-file <path>', 'Path to JSON file with input parameters')
  .option('-w, --workflow <name>', 'Specific workflow name to run')
  .option('-p, --production', 'Run in production mode (no trace events)', false)
  .option('-f, --format <format>', 'Module format: esm, cjs, or auto (default: auto)', 'auto')
  .option('--clean', 'Omit redundant @param/@returns annotations', false)
  .option('--once', 'Run once then exit', false)
  .option('--json', 'Output result as JSON', false)
  .option('--target <target>', 'Compilation target: typescript or inngest (default: typescript)')
  .option('--framework <framework>', 'Framework for serve handler (inngest target only)', 'express')
  .option('--port <port>', 'Port for dev server (inngest target only)', (v: string) => parseInt(v, 10), 3000)
  .action(async (input: string, options) => {
    try {
      await devCommand(input, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Listen command
program
  .command('listen')
  .description('Connect to the editor and stream integration events as JSON lines')
  .option('-s, --server <url>', 'Editor URL', DEFAULT_SERVER_URL)
  .action(async (options) => {
    try {
      await listenCommand(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// MCP server command
program
  .command('mcp-server')
  .description('Start MCP server for Claude Code integration')
  .option('-s, --server <url>', 'Editor URL', DEFAULT_SERVER_URL)
  .option('--stdio', 'Run in MCP stdio mode (skip interactive registration)')
  .action(async (options) => {
    try {
      await mcpServerCommand(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// UI command group (send commands to editor)
const uiCmd = program.command('ui').description('Send commands to the editor');

uiCmd
  .command('focus-node <nodeId>')
  .description('Select and center a node in the editor')
  .option('-s, --server <url>', 'Editor URL', DEFAULT_SERVER_URL)
  .action(async (nodeId: string, options) => {
    try {
      await uiFocusNode(nodeId, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

uiCmd
  .command('add-node <nodeTypeName>')
  .description('Add a node at viewport center')
  .option('-s, --server <url>', 'Editor URL', DEFAULT_SERVER_URL)
  .action(async (nodeTypeName: string, options) => {
    try {
      await uiAddNode(nodeTypeName, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

uiCmd
  .command('open-workflow <filePath>')
  .description('Open a workflow file in the editor')
  .option('-s, --server <url>', 'Editor URL', DEFAULT_SERVER_URL)
  .action(async (filePath: string, options) => {
    try {
      await uiOpenWorkflow(filePath, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

uiCmd
  .command('get-state')
  .description('Return current workflow state from the editor')
  .option('-s, --server <url>', 'Editor URL', DEFAULT_SERVER_URL)
  .action(async (options) => {
    try {
      await uiGetState(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

uiCmd
  .command('batch <json>')
  .description('Execute a batch of commands with auto-snapshot rollback')
  .option('-s, --server <url>', 'Editor URL', DEFAULT_SERVER_URL)
  .action(async (json: string, options) => {
    try {
      await uiBatch(json, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

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
  .action(async (template: string, file: string, options) => {
    try {
      await createWorkflowCommand(template, file, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

createCmd
  .command('node <name> <file>')
  .description('Create a node type (uses processor template by default)')
  .option('-l, --line <number>', 'Insert at specific line number', parseInt)
  .option('-t, --template <template>', 'Node template to use', 'processor')
  .option('-p, --preview', 'Preview generated code without writing', false)
  .option('--strategy <strategy>', 'Template strategy (e.g. mock, callback, webhook)')
  .option('--config <json>', 'Additional configuration (JSON)')
  .action(async (name: string, file: string, options) => {
    try {
      await createNodeCommand(name, file, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Templates command
program
  .command('templates')
  .description('List available templates')
  .option('--json', 'Output as JSON', false)
  .action(async (options) => {
    try {
      await templatesCommand(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Grammar command
program
  .command('grammar')
  .description(
    'Output JSDoc annotation grammar (@input, @output, @connect, @node, @scope) as HTML railroad diagrams or EBNF text'
  )
  .option('-f, --format <format>', 'Output format: html (default), ebnf', 'html')
  .option('-o, --output <path>', 'Write output to file instead of stdout')
  .action(async (options) => {
    try {
      await grammarCommand(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Pattern command (with subcommands)
const patternCmd = program.command('pattern').description('Work with reusable workflow patterns');

patternCmd
  .command('list <path>')
  .description('List patterns in a file or directory')
  .option('--json', 'Output as JSON', false)
  .action(async (inputPath: string, options) => {
    try {
      await patternListCommand(inputPath, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

patternCmd
  .command('apply <pattern-file> <target-file>')
  .description('Apply a pattern to a workflow file')
  .option('-p, --preview', 'Preview changes without writing', false)
  .option('--prefix <prefix>', 'Prefix for node instance IDs')
  .option('-n, --name <name>', 'Specific pattern name to apply')
  .action(async (patternFile: string, targetFile: string, options) => {
    try {
      await patternApplyCommand(patternFile, targetFile, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

patternCmd
  .command('extract <source-file>')
  .description('Extract a pattern from workflow nodes')
  .requiredOption('--nodes <nodes>', 'Comma-separated list of node IDs to extract')
  .requiredOption('-o, --output <file>', 'Output pattern file')
  .option('-n, --name <name>', 'Pattern name')
  .option('-p, --preview', 'Preview pattern without writing', false)
  .action(async (sourceFile: string, options) => {
    try {
      await patternExtractCommand(sourceFile, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Run command
program
  .command('run <input>')
  .description('Execute a workflow file directly')
  .option('-w, --workflow <name>', 'Specific workflow name to run')
  .option('--params <json>', 'Input parameters as JSON string')
  .option('--params-file <path>', 'Path to JSON file with input parameters')
  .option('-p, --production', 'Production mode (no trace events)', false)
  .option('-t, --trace', 'Include execution trace events')
  .option('--json', 'Output result as JSON', false)
  .option('--timeout <ms>', 'Execution timeout in milliseconds', parseInt)
  .option('--mocks <json>', 'Mock config for built-in nodes (events, invocations, fast) as JSON')
  .option('--mocks-file <path>', 'Path to JSON file with mock config for built-in nodes')
  .action(async (input: string, options) => {
    try {
      await runCommand(input, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

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
  .action(async (directory: string | undefined, options) => {
    try {
      await serveCommand(directory, {
        port: parseInt(options.port, 10),
        host: options.host,
        watch: options.watch,
        production: options.production,
        precompile: options.precompile,
        cors: options.cors,
        swagger: options.swagger,
      });
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Export command
program
  .command('export <input>')
  .description('Export workflow as serverless function')
  .requiredOption('-t, --target <target>', 'Target platform (lambda, vercel, cloudflare)')
  .requiredOption('-o, --output <path>', 'Output directory')
  .option('-w, --workflow <name>', 'Specific workflow name to export')
  .option('-p, --production', 'Production mode', true)
  .option('--dry-run', 'Preview without writing files', false)
  .option('--multi', 'Export all workflows in file as a single multi-workflow service', false)
  .option('--workflows <names>', 'Comma-separated list of workflows to export (used with --multi)')
  .option('--docs', 'Include API documentation routes (/docs and /openapi.json)', false)
  .option('--durable-steps', 'Use deep generator with per-node Inngest steps for durability (inngest target only)', false)
  .action(async (input: string, options) => {
    try {
      await exportCommand(input, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// OpenAPI command
program
  .command('openapi <directory>')
  .description('Generate OpenAPI specification from workflows')
  .option('-o, --output <path>', 'Output file path')
  .option('--title <title>', 'API title', 'Flow Weaver API')
  .option('--version <version>', 'API version', '1.0.0')
  .option('--description <desc>', 'API description')
  .option('-f, --format <format>', 'Output format: json (default), yaml', 'json')
  .option('--server <url>', 'Server URL')
  .action(async (directory: string, options) => {
    try {
      await openapiCommand(directory, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Plugin command group
const pluginCmd = program.command('plugin').description('Scaffold and manage external plugins');

pluginCmd
  .command('init <name>')
  .description('Scaffold a new external plugin')
  .option('-a, --area <area>', 'Component area: sidebar, main, toolbar, modal, panel', 'panel')
  .option('--no-system', 'Skip generating a system module')
  .option('-p, --preview', 'Preview generated files without writing', false)
  .option('--force', 'Overwrite existing files', false)
  .action(async (name: string, options) => {
    try {
      await pluginInitCommand(name, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Migrate command
program
  .command('migrate <glob>')
  .description('Migrate workflow files to current syntax via parse → regenerate round-trip')
  .option('--dry-run', 'Preview changes without writing files', false)
  .option('--diff', 'Show semantic diff before/after', false)
  .action(async (glob: string, options) => {
    try {
      await migrateCommand(glob, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Changelog command
program
  .command('changelog')
  .description('Generate changelog from git history, categorized by file path')
  .option('--last-tag', 'From last git tag to HEAD', false)
  .option('--since <date>', 'Date-based range (e.g., "2024-01-01")')
  .option('-r, --range <range>', 'Custom git range (e.g., "v0.1.0..HEAD")')
  .action(async (options) => {
    try {
      await changelogCommand(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Docs command group
const docsCmd = program.command('docs').description('Browse reference documentation');

docsCmd
  .command('list', { isDefault: true })
  .description('List available documentation topics')
  .option('--json', 'Output as JSON', false)
  .option('--compact', 'Compact output', false)
  .action(async (options) => {
    try {
      await docsListCommand(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

docsCmd
  .command('read <topic>')
  .description('Read a documentation topic')
  .option('--json', 'Output as JSON', false)
  .option('--compact', 'Return compact LLM-friendly version', false)
  .action(async (topic: string, options) => {
    try {
      await docsReadCommand(topic, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

docsCmd
  .command('search <query>')
  .description('Search across all documentation')
  .option('--json', 'Output as JSON', false)
  .action(async (query: string, options) => {
    try {
      await docsSearchCommand(query, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Marketplace command group
const marketCmd = program.command('market').description('Discover, install, and publish marketplace packages');

marketCmd
  .command('init <name>')
  .description('Scaffold a new marketplace package')
  .option('-d, --description <desc>', 'Package description')
  .option('-a, --author <author>', 'Author name')
  .option('-y, --yes', 'Skip prompts and use defaults', false)
  .action(async (name: string, options) => {
    try {
      await marketInitCommand(name, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

marketCmd
  .command('pack [directory]')
  .description('Validate and generate flowweaver.manifest.json')
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Show parse warnings', false)
  .action(async (directory: string | undefined, options) => {
    try {
      await marketPackCommand(directory, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

marketCmd
  .command('publish [directory]')
  .description('Pack and publish to npm')
  .option('--dry-run', 'Preview without publishing', false)
  .option('--tag <tag>', 'npm dist-tag')
  .action(async (directory: string | undefined, options) => {
    try {
      await marketPublishCommand(directory, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

marketCmd
  .command('install <package>')
  .description('Install a marketplace package')
  .option('--json', 'Output results as JSON', false)
  .action(async (packageSpec: string, options) => {
    try {
      await marketInstallCommand(packageSpec, options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

marketCmd
  .command('search [query]')
  .description('Search npm for marketplace packages')
  .option('-l, --limit <number>', 'Max results', '20')
  .option('-r, --registry <url>', 'Custom registry search URL (e.g., private npm registry)')
  .option('--json', 'Output as JSON', false)
  .action(async (query: string | undefined, options) => {
    try {
      await marketSearchCommand(query, { ...options, limit: parseInt(options.limit, 10) });
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

marketCmd
  .command('list')
  .description('List installed marketplace packages')
  .option('--json', 'Output as JSON', false)
  .action(async (options) => {
    try {
      await marketListCommand(options);
    } catch (error) {
      logger.error(`Command failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

// Help command (default commander behavior)
program.on('--help', () => {
  logger.newline();
  logger.section('Examples');
  logger.log('  $ flow-weaver compile my-workflow.ts');
  logger.log("  $ flow-weaver compile '**/*.ts' -o .output");
  logger.log('  $ flow-weaver compile my-workflow.ts --format cjs');
  logger.log('  $ flow-weaver describe workflow.ts');
  logger.log('  $ flow-weaver describe workflow.ts --format mermaid');
  logger.log('  $ flow-weaver describe workflow.ts --node validator');
  logger.log('  $ flow-weaver diagram workflow.ts');
  logger.log('  $ flow-weaver diagram workflow.ts --theme light -o diagram.svg');
  logger.log('  $ flow-weaver diagram workflow.ts --format html -o diagram.html');
  logger.log('  $ flow-weaver diff workflow-v1.ts workflow-v2.ts');
  logger.log('  $ flow-weaver diff workflow-v1.ts workflow-v2.ts --format json');
  logger.log("  $ flow-weaver validate '**/*.ts'");
  logger.log("  $ flow-weaver watch 'src/**/*.ts' -o dist");
  logger.log('  $ flow-weaver create workflow simple my-workflow.ts');
  logger.log('  $ flow-weaver create workflow ai-agent agent.ts --provider openai --model gpt-4o');
  logger.log('  $ flow-weaver create node myProcessor my-workflow.ts');
  logger.log('  $ flow-weaver templates');
  logger.log('  $ flow-weaver pattern list ./patterns');
  logger.log('  $ flow-weaver pattern apply pattern.ts workflow.ts');
  logger.log('  $ flow-weaver pattern extract workflow.ts --nodes a,b -o extracted.ts');
  logger.log('  $ flow-weaver init my-project');
  logger.log('  $ flow-weaver init --template ai-agent -y');
  logger.log('  $ flow-weaver init my-project --format cjs');
  logger.log('  $ flow-weaver doctor');
  logger.log('  $ flow-weaver doctor --json');
  logger.newline();
  logger.section('Plugin Commands');
  logger.log('  $ flow-weaver plugin init my-plugin');
  logger.log('  $ flow-weaver plugin init my-plugin --area sidebar --no-system');
  logger.log('  $ flow-weaver plugin init my-plugin --preview');
  logger.newline();
  logger.section('Deployment Commands');
  logger.log('  $ flow-weaver run workflow.ts --params \'{"a": 5}\'');
  logger.log('  $ flow-weaver serve ./workflows --port 8080');
  logger.log('  $ flow-weaver export workflow.ts --target vercel --output api/');
  logger.log('  $ flow-weaver export workflows.ts --target lambda --output dist/ --multi');
  logger.log('  $ flow-weaver export workflows.ts --target lambda --output dist/ --multi --docs');
  logger.log('  $ flow-weaver export workflow.ts --target inngest --output dist/ --durable-steps');
  logger.log('  $ flow-weaver compile workflow.ts --target inngest');
  logger.log('  $ flow-weaver openapi ./workflows --output api-spec.json');
  logger.newline();
  logger.section('Marketplace Commands');
  logger.log('  $ flow-weaver market init openai');
  logger.log('  $ flow-weaver market pack');
  logger.log('  $ flow-weaver market publish');
  logger.log('  $ flow-weaver market publish --dry-run');
  logger.log('  $ flow-weaver market install flowweaver-pack-openai');
  logger.log('  $ flow-weaver market search openai');
  logger.log('  $ flow-weaver market list');
  logger.newline();
  logger.section('Documentation');
  logger.log('  $ flow-weaver docs');
  logger.log('  $ flow-weaver docs read error-codes');
  logger.log('  $ flow-weaver docs read scaffold --compact');
  logger.log('  $ flow-weaver docs search "missing workflow"');
  logger.log('  $ flow-weaver docs read error-codes --json');
  logger.newline();
  logger.section('Migration & Changelog');
  logger.log("  $ flow-weaver migrate '**/*.ts'");
  logger.log("  $ flow-weaver migrate '**/*.ts' --dry-run");
  logger.log("  $ flow-weaver migrate 'src/**/*.ts' --diff");
  logger.log('  $ flow-weaver changelog --last-tag');
  logger.log('  $ flow-weaver changelog --range v0.1.0..HEAD');
  logger.log('  $ flow-weaver changelog --since 2024-01-01');
  logger.newline();
});

// Parse arguments
program.parse(process.argv);

// Show help if no command specified
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
