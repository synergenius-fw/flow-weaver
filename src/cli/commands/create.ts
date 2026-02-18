/* eslint-disable no-console */
/**
 * Create command - scaffolds workflows and nodes from templates
 */

import * as fs from 'fs';
import * as path from 'path';
import { getWorkflowTemplate, getNodeTemplate, toCamelCase } from '../templates/index.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';

export interface CreateWorkflowOptions {
  line?: number;
  async?: boolean;
  preview?: boolean;
  provider?: string;
  model?: string;
  config?: string; // JSON string
  name?: string;
  nodes?: string; // Comma-separated node names
  input?: string; // Custom input port name
  output?: string; // Custom output port name
}

export interface CreateNodeOptions {
  line?: number;
  preview?: boolean;
  config?: string; // JSON string
  strategy?: string; // Shorthand for approval strategy
}

/**
 * Insert content at a specific line or append to end of file
 */
function insertIntoFile(filePath: string, content: string, line?: number): void {
  // Create file if it doesn't exist
  if (!fs.existsSync(filePath)) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content + '\n');
    return;
  }

  const existingContent = fs.readFileSync(filePath, 'utf8');
  const lines = existingContent.split('\n');

  if (line !== undefined && line > 0) {
    // Insert AFTER specific line (1-indexed)
    // Line 3 means insert after line 3, so at index 3
    const insertIndex = Math.min(line, lines.length);
    lines.splice(insertIndex, 0, content);
  } else {
    // Append to end
    lines.push('', content);
  }

  fs.writeFileSync(filePath, lines.join('\n'));
}

/**
 * Create a workflow from a template
 */
export async function createWorkflowCommand(
  template: string,
  file: string,
  options: CreateWorkflowOptions = {}
): Promise<void> {
  const {
    line,
    async: isAsync = false,
    preview = false,
    provider,
    model,
    config: configJson,
  } = options;

  const templateDef = getWorkflowTemplate(template);
  if (!templateDef) {
    logger.error(`Unknown workflow template: ${template}`);
    logger.info("Run 'flow-weaver templates' to see available templates");
    process.exit(1);
  }

  // Resolve to absolute path
  const filePath = path.resolve(file);

  // Derive workflow name from filename (or use --name override)
  const baseName = path.basename(filePath, path.extname(filePath));
  const workflowName = options.name || toCamelCase(baseName);

  // Build config object from options
  const config: Record<string, unknown> = {};
  if (provider) config.provider = provider;
  if (model) config.model = model;
  if (options.nodes) config.nodes = options.nodes.split(',').map((n: string) => n.trim());
  if (options.input) config.input = options.input;
  if (options.output) config.output = options.output;
  if (configJson) {
    try {
      Object.assign(config, JSON.parse(configJson));
    } catch {
      logger.error('Invalid --config JSON');
      process.exit(1);
    }
  }

  // Generate the template code
  const code = templateDef.generate({
    workflowName,
    async: isAsync,
    config: Object.keys(config).length > 0 ? config : undefined,
  });

  // Preview mode: just output the code
  if (preview) {
    console.log(code);
    return;
  }

  try {
    insertIntoFile(filePath, code, line);
    logger.success(`Created ${templateDef.name} workflow in ${file}`);
    if (line) {
      logger.info(`  Inserted at line ${line}`);
    }
    logger.info(`  Workflow function: ${workflowName}`);
  } catch (error) {
    logger.error(`Failed to create workflow: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

/**
 * Create a node type from a template
 * Uses processor template by default
 */
export async function createNodeCommand(
  name: string,
  file: string,
  options: CreateNodeOptions & { template?: string } = {}
): Promise<void> {
  const { line, template = 'processor', preview = false, strategy, config: configJson } = options;

  const templateDef = getNodeTemplate(template);
  if (!templateDef) {
    logger.error(`Unknown node template: ${template}`);
    logger.info("Run 'flow-weaver templates' to see available templates");
    process.exit(1);
  }

  // Resolve to absolute path
  const filePath = path.resolve(file);

  // Build config object from options
  const config: Record<string, unknown> = {};
  if (strategy) config.strategy = strategy;
  if (configJson) {
    try {
      Object.assign(config, JSON.parse(configJson));
    } catch {
      logger.error('Invalid --config JSON');
      process.exit(1);
    }
  }

  // Generate the template code with provided name and optional config
  const nodeName = toCamelCase(name);
  const nodeConfig = Object.keys(config).length > 0 ? config : undefined;
  const code = templateDef.generate(nodeName, nodeConfig);

  // Preview mode: just output the code
  if (preview) {
    console.log(code);
    return;
  }

  try {
    insertIntoFile(filePath, code, line);
    logger.success(`Created ${templateDef.name} node in ${file}`);
    if (line) {
      logger.info(`  Inserted at line ${line}`);
    }
    logger.info(`  Node function: ${nodeName}`);
  } catch (error) {
    logger.error(`Failed to create node: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}
