/* eslint-disable no-console */
/**
 * CLI pattern commands
 * - list: Find patterns in files/directories
 * - apply: Merge pattern into workflow
 * - extract: Create pattern from workflow nodes
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { AnnotationParser } from '../../parser.js';
import type { TPatternAST } from '../../ast/types.js';
import { logger } from '../utils/logger.js';
import { listPatterns, applyPattern, extractPattern } from '../../api/patterns.js';

const parser = new AnnotationParser();

interface ListOptions {
  json?: boolean;
}

interface ApplyOptions {
  preview?: boolean;
  prefix?: string;
  name?: string;
}

interface ExtractOptions {
  nodes: string;
  output: string;
  name?: string;
  preview?: boolean;
}

/**
 * Find patterns in a file or directory
 */
export async function patternListCommand(inputPath: string, options: ListOptions): Promise<void> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Path not found: ${inputPath}`);
  }
  const stat = fs.statSync(inputPath);
  let files: string[];

  if (stat.isDirectory()) {
    files = await glob('**/*.ts', { cwd: inputPath, absolute: true });
  } else {
    files = [inputPath];
  }

  const allPatterns: Array<{ file: string; patterns: ReturnType<typeof listPatterns> }> = [];

  for (const file of files) {
    try {
      const patterns = listPatterns(file);
      if (patterns.length > 0) {
        allPatterns.push({ file, patterns });
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  const flat = allPatterns.flatMap(({ file, patterns }) => patterns.map((p) => ({ file, ...p })));

  if (flat.length === 0) {
    if (options.json) {
      console.log(JSON.stringify([]));
    } else {
      logger.info('No patterns found');
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(flat, null, 2));
    return;
  }

  // Human-readable output
  for (const { file, name, description, inputPorts, outputPorts, nodes } of flat) {
    logger.section(name);
    if (description) {
      logger.info(description);
    }
    logger.info(`File: ${path.relative(process.cwd(), file)}`);

    if (inputPorts.length > 0) {
      logger.info('Input ports:');
      for (const port of inputPorts) {
        logger.log(`  ${port.name}${port.description ? ` - ${port.description}` : ''}`);
      }
    }

    if (outputPorts.length > 0) {
      logger.info('Output ports:');
      for (const port of outputPorts) {
        logger.log(`  ${port.name}${port.description ? ` - ${port.description}` : ''}`);
      }
    }

    if (nodes.length > 0) {
      logger.info(`Nodes: ${nodes.join(', ')}`);
    }

    logger.newline();
  }
}

/**
 * Apply a pattern to a workflow file
 */
export async function patternApplyCommand(
  patternFile: string,
  targetFile: string,
  options: ApplyOptions
): Promise<void> {
  // Parse pattern file
  const patternResult = parser.parse(patternFile);

  if (patternResult.patterns.length === 0) {
    throw new Error(`No patterns found in ${patternFile}`);
  }

  // Select pattern (by name if specified, otherwise first)
  let pattern: TPatternAST;
  if (options.name) {
    const found = patternResult.patterns.find((p) => p.name === options.name);
    if (!found) {
      throw new Error(`Pattern "${options.name}" not found in ${patternFile}`);
    }
    pattern = found;
  } else {
    pattern = patternResult.patterns[0];
  }

  // Parse target to detect existing node types
  const targetContent = fs.readFileSync(targetFile, 'utf8');
  const targetResult = parser.parse(targetFile);
  const existingNodeTypes = new Set(targetResult.nodeTypes.map((nt) => nt.name));

  // Apply pattern via API
  const result = applyPattern({
    patternAST: pattern,
    targetContent,
    targetNodeTypes: existingNodeTypes,
    prefix: options.prefix,
  });

  if (result.conflicts.length > 0) {
    console.log(`\u26A0\uFE0F  Node type conflict detected: ${result.conflicts.join(', ')}`);
    console.log(
      '   Existing node types will be preserved. Consider using --prefix to avoid conflicts.'
    );
  }

  if (options.preview) {
    console.log(result.modifiedContent);
    logger.newline();
    logger.section('Manual wiring required');
    for (const instruction of result.wiringInstructions) {
      logger.log(`  ${instruction}`);
    }
    logger.info('Input ports:');
    for (const name of Object.keys(pattern.inputPorts)) {
      logger.log(`  IN.${name}`);
    }
    logger.info('Output ports:');
    for (const name of Object.keys(pattern.outputPorts)) {
      logger.log(`  OUT.${name}`);
    }
    return;
  }

  // Write modified content
  fs.writeFileSync(targetFile, result.modifiedContent);

  logger.success(`Applied pattern "${pattern.name}" to ${targetFile}`);
  if (result.nodeTypesAdded.length > 0) {
    logger.info(`Added node types: ${result.nodeTypesAdded.join(', ')}`);
  }
  const nodePrefix = options.prefix ? `${options.prefix}_` : '';
  logger.info(`Added nodes: ${pattern.instances.map((i) => `${nodePrefix}${i.id}`).join(', ')}`);

  logger.newline();
  logger.section('Wire these ports manually');
  for (const instruction of result.wiringInstructions) {
    logger.log(`  ${instruction}`);
  }
  logger.info('Input ports:');
  for (const name of Object.keys(pattern.inputPorts)) {
    logger.log(`  IN.${name}`);
  }
  logger.info('Output ports:');
  for (const name of Object.keys(pattern.outputPorts)) {
    logger.log(`  OUT.${name}`);
  }
}

/**
 * Extract a pattern from workflow nodes
 */
export async function patternExtractCommand(
  sourceFile: string,
  options: ExtractOptions
): Promise<void> {
  // Parse source file
  const parseResult = parser.parse(sourceFile);

  if (parseResult.workflows.length === 0) {
    throw new Error(`No workflows found in ${sourceFile}`);
  }

  const workflow = parseResult.workflows[0];
  const nodeIds = options.nodes.split(',').map((s) => s.trim());

  // Extract pattern via API
  const result = extractPattern({
    workflowAST: workflow,
    nodeTypes: parseResult.nodeTypes,
    nodeIds,
    name: options.name,
  });

  if (options.preview) {
    console.log(result.patternCode);
    return;
  }

  // Write to output file
  fs.writeFileSync(options.output, result.patternCode);
  logger.success(`Extracted pattern "${result.patternName}" to ${options.output}`);
  logger.info(`Included nodes: ${result.nodes.join(', ')}`);
  logger.info(`Input ports: ${result.inputPorts.join(', ') || 'none'}`);
  logger.info(`Output ports: ${result.outputPorts.join(', ') || 'none'}`);
}
