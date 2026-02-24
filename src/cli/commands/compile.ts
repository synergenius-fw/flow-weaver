/**
 * Compile command - compiles workflow files to TypeScript
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { parseWorkflow } from '../../api/index.js';
import { generateInPlace } from '../../api/generate-in-place.js';
import { generateCode } from '../../api/generate.js';
import { validator } from '../../validator.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import { getFriendlyError } from '../../friendly-errors.js';
import type { TModuleFormat } from '../../ast/types.js';
import { detectProjectModuleFormat } from './doctor.js';
import { generateInngestFunction } from '../../generator/inngest.js';
import { AnnotationParser } from '../../parser.js';

export interface CompileOptions {
  output?: string;
  production?: boolean;
  sourceMap?: boolean;
  strict?: boolean;
  verbose?: boolean;
  workflowName?: string;
  dryRun?: boolean;
  /**
   * Module format for generated code.
   * - 'esm': ECMAScript modules (import/export)
   * - 'cjs': CommonJS modules (require/module.exports)
   * - 'auto': Auto-detect from project's package.json (default)
   */
  format?: 'esm' | 'cjs' | 'auto';
  /**
   * Force inline runtime even when @synergenius/flow-weaver package is installed.
   * By default, the compiler uses external runtime imports when the package is available.
   */
  inlineRuntime?: boolean;
  /**
   * Omit redundant @param/@returns annotations from compiled output.
   * Useful for vibe coders who don't use the visual editor.
   */
  clean?: boolean;
  /**
   * Compilation target.
   * - 'typescript' (default): Standard in-place compilation
   * - 'inngest': Generate Inngest function with per-node step.run() for durability
   */
  target?: 'typescript' | 'inngest';
  /** Override @trigger cron from CLI (Inngest target only) */
  cron?: string;
  /** Generate serve() handler */
  serve?: boolean;
  /** Framework adapter for serve handler */
  framework?: 'next' | 'express' | 'hono' | 'fastify' | 'remix';
  /** Generate Zod event schemas from @param annotations */
  typedEvents?: boolean;
  /** Override @retries from CLI */
  retries?: number;
  /** Override @timeout from CLI */
  timeout?: string;
}

/**
 * Resolve the module format to use for compilation.
 * If 'auto' or not specified, detect from the project's package.json.
 */
function resolveModuleFormat(format: string | undefined, cwd: string): TModuleFormat {
  if (format === 'esm' || format === 'cjs') {
    return format;
  }
  // Auto-detect from project
  const detection = detectProjectModuleFormat(cwd);
  return detection.format;
}

export async function compileCommand(input: string, options: CompileOptions = {}): Promise<void> {
  const { production = false, sourceMap = false, strict = false, verbose = false, workflowName, dryRun = false, format, inlineRuntime = false, clean = false, target } = options;

  // Handle Inngest target compilation
  if (target === 'inngest') {
    return compileInngestTarget(input, { production, verbose, workflowName, dryRun });
  }

  // Resolve module format (auto-detect if not specified)
  const cwd = process.cwd();
  const moduleFormat = resolveModuleFormat(format, cwd);

  try {
    // If input is a directory, expand to all .ts files recursively
    let pattern = input;
    try {
      if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
        pattern = path.join(input, '**/*.ts');
      }
    } catch {
      // Not a valid path, use as glob pattern
    }

    // Find files matching the pattern, filter to actual files only
    const allFiles = await glob(pattern, { absolute: true });
    const files = allFiles.filter((f) => {
      try {
        return fs.statSync(f).isFile();
      } catch {
        return false;
      }
    });

    if (files.length === 0) {
      throw new Error(`No files found matching pattern: ${input}`);
    }

    logger.section('Compiling Workflows');
    logger.info(`Found ${files.length} file(s)`);
    logger.info(`Module format: ${moduleFormat.toUpperCase()}`);
    if (sourceMap) {
      logger.info('Source maps: enabled');
    }
    if (verbose) {
      files.forEach((file) => logger.info(`  - ${file}`));
    }
    logger.newline();

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = path.basename(file);

      logger.progress(i + 1, files.length, fileName);

      try {
        // Skip files without @flowWeaver annotations before parsing
        const rawSource = fs.readFileSync(file, 'utf8');
        if (!rawSource.includes('@flowWeaver')) {
          if (verbose) {
            logger.info(`  Skipped ${fileName} (no @flowWeaver annotations)`);
          }
          continue;
        }

        // Parse the workflow
        const parseResult = await parseWorkflow(file, { workflowName });

        if (parseResult.warnings.length > 0) {
          parseResult.warnings.forEach((w) => logger.warn(`  ${w}`));
        }

        if (parseResult.errors.length > 0) {
          // Skip non-workflow files silently (only error is "No workflows found")
          const isNonWorkflowFile =
            parseResult.errors.length === 1 &&
            typeof parseResult.errors[0] === 'string' &&
            parseResult.errors[0].startsWith('No workflows found');

          if (isNonWorkflowFile) {
            if (verbose) {
              logger.info(`  Skipped ${fileName} (no workflow)`);
            }
            continue;
          }

          logger.error(`Failed to parse ${fileName}:`);
          parseResult.errors.forEach((err) => logger.error(`  ${err}`));
          errorCount++;
          continue;
        }

        // Validate the AST (especially for --strict mode)
        if (strict) {
          const validation = validator.validate(parseResult.ast, { strictMode: true });
          if (validation.errors.length > 0) {
            logger.error(`Validation errors in ${fileName}:`);
            validation.errors.forEach((err) => {
              const friendly = getFriendlyError(err);
              if (friendly) {
                const loc = err.location ? `[line ${err.location.line}] ` : '';
                logger.error(`  ${loc}${friendly.title}: ${friendly.explanation}`);
                logger.info(`    How to fix: ${friendly.fix}`);
              } else {
                let msg = `  - ${err.message}`;
                if (err.node) {
                  msg += ` (node: ${err.node})`;
                }
                logger.error(msg);
                if (err.docUrl) {
                  logger.info(`    See: ${err.docUrl}`);
                }
              }
            });
            errorCount++;
            continue;
          }
          if (validation.warnings.length > 0 && verbose) {
            validation.warnings.forEach((warn) => {
              const friendly = getFriendlyError(warn);
              if (friendly) {
                const loc = warn.location ? `[line ${warn.location.line}] ` : '';
                logger.warn(`  ${loc}${friendly.title}: ${friendly.explanation}`);
                logger.info(`    How to fix: ${friendly.fix}`);
              } else {
                logger.warn(`  ${warn.message}`);
              }
            });
          }
        }

        // Read original source
        const sourceCode = fs.readFileSync(file, 'utf8');

        // Generate code in-place (preserves types, interfaces, etc.)
        const result = generateInPlace(sourceCode, parseResult.ast, { production, moduleFormat, inlineRuntime, sourceFile: file, skipParamReturns: clean });

        // Write back to original file (skip in dry-run mode)
        if (!dryRun) {
          fs.writeFileSync(file, result.code, 'utf8');

          // Generate source map if requested
          if (sourceMap) {
            const mapResult = generateCode(parseResult.ast, {
              production,
              sourceMap: true,
              moduleFormat,
            });
            if (mapResult.sourceMap) {
              const mapPath = file + '.map';
              fs.writeFileSync(mapPath, mapResult.sourceMap, 'utf8');
              // Append sourceMappingURL comment to the compiled file
              const sourceMappingComment = `\n//# sourceMappingURL=${path.basename(mapPath)}\n`;
              if (!result.code.includes('//# sourceMappingURL=')) {
                fs.appendFileSync(file, sourceMappingComment, 'utf8');
              }
              if (verbose) {
                logger.info(`  Source map: ${mapPath}`);
              }
            }
          }
        }

        if (dryRun) {
          if (result.hasChanges) {
            logger.success(`  Would compile: ${file}`);
          } else if (verbose) {
            logger.info(`  No changes: ${file}`);
          }
        } else if (result.hasChanges) {
          logger.success(`  Compiled: ${file}`);
        } else if (verbose) {
          logger.info(`  No changes: ${file}`);
        }

        successCount++;
      } catch (error) {
        logger.error(`Failed to compile ${fileName}: ${getErrorMessage(error)}`);
        errorCount++;
      }
    }

    // Summary
    logger.newline();
    logger.section('Summary');
    logger.success(`${successCount} file(s) compiled successfully`);
    if (errorCount > 0) {
      throw new Error(`${errorCount} file(s) failed to compile`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('file(s) failed')) {
      throw error;
    }
    throw new Error(`Compilation failed: ${getErrorMessage(error)}`);
  }
}

/**
 * Compile a workflow file to Inngest function code with per-node step.run().
 */
export async function compileInngestTarget(
  input: string,
  options: {
    production: boolean; verbose?: boolean; workflowName?: string; dryRun?: boolean;
    cron?: string; serve?: boolean; framework?: 'next' | 'express' | 'hono' | 'fastify' | 'remix';
    typedEvents?: boolean; retries?: number; timeout?: string;
  }
): Promise<void> {
  const filePath = path.resolve(input);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  logger.section('Compiling to Inngest');
  logger.info(`Input: ${filePath}`);
  logger.info(`Target: Inngest (per-node step.run)`);
  logger.newline();

  const parser = new AnnotationParser();
  const parseResult = parser.parse(filePath);

  if (parseResult.errors.length > 0) {
    const msgs = parseResult.errors.map((e) => `  ${e}`).join('\n');
    throw new Error(`Parse errors:\n${msgs}`);
  }

  if (parseResult.workflows.length === 0) {
    throw new Error('No workflows found in file');
  }

  const workflow = options.workflowName
    ? parseResult.workflows.find((w) => w.name === options.workflowName || w.functionName === options.workflowName)
    : parseResult.workflows[0];

  if (!workflow) {
    const available = parseResult.workflows.map((w) => w.name).join(', ');
    throw new Error(`Workflow "${options.workflowName}" not found. Available: ${available}`);
  }

  const allNodeTypes = [...(workflow.nodeTypes || [])];

  // CLI overrides for workflow options
  if (options.cron) {
    workflow.options = workflow.options || {};
    workflow.options.trigger = { ...workflow.options.trigger, cron: options.cron };
  }
  if (options.retries !== undefined) {
    workflow.options = workflow.options || {};
    workflow.options.retries = options.retries;
  }
  if (options.timeout) {
    workflow.options = workflow.options || {};
    workflow.options.timeout = options.timeout;
  }

  const code = generateInngestFunction(workflow, allNodeTypes, {
    production: options.production,
    typedEvents: options.typedEvents,
    serveHandler: options.serve,
    framework: options.framework,
  });

  const outputPath = filePath.replace(/\.ts$/, '.inngest.ts');

  if (options.dryRun) {
    logger.success(`Would generate: ${outputPath}`);
    logger.newline();
    logger.section('Preview');
    const lines = code.split('\n');
    const preview = lines.slice(0, 50).join('\n');
    logger.log(preview);
    if (lines.length > 50) {
      logger.info(`... (${lines.length - 50} more lines)`);
    }
  } else {
    fs.writeFileSync(outputPath, code, 'utf8');
    logger.success(`Compiled: ${outputPath}`);
  }

  logger.newline();
  logger.section('Summary');
  logger.success(`Workflow "${workflow.name}" compiled to Inngest function`);
  logger.info('Each node is wrapped in step.run() for per-node durability');
}
