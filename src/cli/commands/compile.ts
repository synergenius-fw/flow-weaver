/**
 * Compile command - compiles workflow files to TypeScript
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { parseWorkflow, validateWorkflow, type ValidationResult } from '../../api/index.js';
import { parseWorkflowSourceAtPath, isMultipleWorkflows } from '../../api/parse.js';
import { generateInPlace } from '../../api/generate-in-place.js';
import { generateCode } from '../../api/generate.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import { getFriendlyError } from '../../validation/friendly-errors.js';
import type { TModuleFormat } from '../../ast/types.js';
import { detectProjectModuleFormat } from './doctor.js';
import { safeWriteFile, safeAppendFile } from '../utils/safe-write.js';

/**
 * Print a workflow's validation result. Returns false when it must not be
 * compiled: in strict mode validation errors block compilation. Warnings are
 * always shown (the fix hint only with --verbose).
 */
function reportValidation(
  label: string,
  validation: ValidationResult,
  strict: boolean,
  verbose: boolean,
): boolean {
  // In strict mode, validation errors block compilation
  if (strict && validation.errors.length > 0) {
    logger.error(`  ${label}`);
    validation.errors.forEach((err) => {
      const friendly = getFriendlyError(err);
      if (friendly) {
        const loc = err.location ? `[line ${err.location.line}] ` : '';
        logger.error(`    ${loc}${friendly.title}: ${friendly.explanation}`);
        logger.warn(`    How to fix: ${friendly.fix}`);
        if (err.docUrl) {
          logger.warn(`    See: ${err.docUrl}`);
        }
      } else {
        let msg = `    ${err.message}`;
        if (err.node) {
          msg += ` (node: ${err.node})`;
        }
        logger.error(msg);
        if (err.docUrl) {
          logger.warn(`    See: ${err.docUrl}`);
        }
      }
    });
    return false;
  }

  // Always show validation warnings (not just in verbose mode)
  if (validation.warnings.length > 0) {
    validation.warnings.forEach((warn) => {
      const friendly = getFriendlyError(warn);
      if (friendly) {
        const loc = warn.location ? `[line ${warn.location.line}] ` : '';
        logger.warn(`  ${loc}${friendly.title}: ${friendly.explanation}`);
        if (verbose) {
          logger.warn(`    How to fix: ${friendly.fix}`);
        }
      } else {
        logger.warn(`  ${warn.message}`);
      }
    });
  }
  return true;
}

/** Show path relative to cwd for cleaner output */
function displayPath(filePath: string): string {
  const rel = path.relative(process.cwd(), filePath);
  // Use relative if it's shorter and doesn't escape cwd
  if (rel && !rel.startsWith('..') && rel.length < filePath.length) {
    return rel;
  }
  return filePath;
}

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
   * Omit redundant @param/@returns annotations from compiled output.
   */
  clean?: boolean;
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
  const { production = false, sourceMap = false, strict = false, verbose = false, workflowName, dryRun = false, format, clean = false, output } = options;

  // Resolve module format (auto-detect if not specified)
  const cwd = process.cwd();
  const moduleFormat = resolveModuleFormat(format, cwd);

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

  // Resolve --output: determine if it's a file or directory target
  let outputDir: string | undefined;
  let outputFile: string | undefined;
  if (output) {
    const isOutputDir = output.endsWith('/') || output.endsWith(path.sep) ||
      (fs.existsSync(output) && fs.statSync(output).isDirectory());

    if (isOutputDir) {
      outputDir = output.endsWith('/') || output.endsWith(path.sep) ? output.slice(0, -1) : output;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    } else if (files.length > 1) {
      // Multiple input files but output is a single file — ambiguous
      throw new Error(
        `Cannot use --output with a file path when compiling multiple files. ` +
        `Use a directory path instead (e.g. --output ${output}/)`
      );
    } else {
      outputFile = path.resolve(output);
    }
  }

  const totalTimer = logger.timer();

  logger.section('Compiling Workflows');

  if (verbose) {
    logger.info(`Found ${files.length} file(s)`);
    logger.info(`Module format: ${moduleFormat.toUpperCase()}`);
    if (sourceMap) {
      logger.info('Source maps: enabled');
    }
    files.forEach((file) => logger.info(`  ${displayPath(file)}`));
    logger.newline();
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileName = path.basename(file);
    const fileTimer = logger.timer();

    try {
      // Skip files without @flowWeaver annotations before parsing
      const rawSource = fs.readFileSync(file, 'utf8');
      if (!rawSource.includes('@flowWeaver')) {
        if (verbose) {
          logger.info(`  ${logger.dim('skip')} ${fileName} ${logger.dim('(no @flowWeaver annotations)')}`);
        }
        continue;
      }

      // Parse the workflow
      const parseResult = await parseWorkflow(file, { workflowName, projectDir: cwd });

      // A file may declare several workflows. Without -w, install each body in
      // turn on the in-memory source and write the file once, so a failure in
      // one leaves the file untouched and --dry-run writes nothing.
      if (!workflowName && isMultipleWorkflows(parseResult.errors) && parseResult.availableWorkflows.length > 1) {
        let code = rawSource;
        let failed = false;
        for (const name of parseResult.availableWorkflows) {
          const label = `${fileName} (${name})`;
          const one = await parseWorkflowSourceAtPath(file, code, { workflowName: name, projectDir: cwd });
          if (one.errors.length > 0) {
            logger.error(`  ${label}`);
            one.errors.forEach((err) => logger.error(`    ${err}`));
            failed = true;
            break;
          }
          if (!reportValidation(label, validateWorkflow(one.ast, strict ? { mode: 'strict' } : undefined), strict, verbose)) {
            failed = true;
            break;
          }
          code = generateInPlace(code, one.ast, { production, moduleFormat, sourceFile: file, skipParamReturns: clean }).code;
        }
        if (failed) {
          errorCount++;
          continue;
        }
        const writePath = outputFile ? outputFile : outputDir ? path.join(outputDir, path.basename(file)) : file;
        const changed = code !== rawSource;
        if (!dryRun && changed) safeWriteFile(writePath, code);
        if (sourceMap) logger.warn(`  ${fileName}: source maps are only written for files with one workflow`);
        const names = logger.dim(`(${parseResult.availableWorkflows.join(', ')})`);
        if (changed) logger.success(`${displayPath(file)} ${names} ${logger.dim(fileTimer.elapsed())}${dryRun ? ` ${logger.dim('(dry run)')}` : ''}`);
        else if (verbose || dryRun) logger.log(`  ${displayPath(file)} ${names} ${logger.dim(dryRun ? '(no changes, dry run)' : 'no changes')}`);
        successCount++;
        continue;
      }

      if (parseResult.warnings.length > 0 && verbose) {
        logger.warn(`Parse warnings in ${fileName}:`);
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
            logger.info(`  ${logger.dim('skip')} ${fileName} ${logger.dim('(no workflow)')}`);
          }
          continue;
        }

        logger.error(`  ${fileName}`);
        parseResult.errors.forEach((err) => logger.error(`    ${err}`));
        errorCount++;
        continue;
      }

      // Validate the AST
      if (!reportValidation(fileName, validateWorkflow(parseResult.ast, strict ? { mode: 'strict' } : undefined), strict, verbose)) {
        errorCount++;
        continue;
      }

      // Generate code in-place (preserves types, interfaces, etc.)
      const result = generateInPlace(rawSource, parseResult.ast, { production, moduleFormat, sourceFile: file, skipParamReturns: clean });

      // Determine where to write the compiled output
      const writePath = outputFile
        ? outputFile
        : outputDir
          ? path.join(outputDir, path.basename(file))
          : file; // in-place

      // Write compiled output (skip in dry-run mode)
      if (!dryRun) {
        safeWriteFile(writePath, result.code);

        // Generate source map if requested
        if (sourceMap) {
          const mapResult = generateCode(parseResult.ast, {
            production,
            sourceMap: true,
            moduleFormat,
          });
          if (mapResult.sourceMap) {
            const mapPath = writePath + '.map';
            safeWriteFile(mapPath, mapResult.sourceMap);
            const sourceMappingComment = `\n//# sourceMappingURL=${path.basename(mapPath)}\n`;
            if (!result.code.includes('//# sourceMappingURL=')) {
              safeAppendFile(writePath, sourceMappingComment);
            }
            if (verbose) {
              logger.info(`    source map: ${displayPath(mapPath)}`);
            }
          }
        }
      }

      const timing = logger.dim(fileTimer.elapsed());
      const filePrint = displayPath(file);
      if (dryRun) {
        if (result.hasChanges) {
          logger.success(`${filePrint} ${timing} ${logger.dim('(dry run)')}`);
        } else {
          logger.log(`  ${filePrint} ${logger.dim('(no changes, dry run)')}`);
        }
      } else if (result.hasChanges) {
        logger.success(`${filePrint} ${timing}`);
      } else if (verbose) {
        logger.info(`  ${filePrint} ${logger.dim('no changes')}`);
      }

      successCount++;
    } catch (error) {
      logger.error(`  ${fileName}: ${getErrorMessage(error)}`);
      errorCount++;
    }
  }

  // Summary
  const elapsed = totalTimer.elapsed();
  const formatNote = verbose ? '' : ` (${moduleFormat.toUpperCase()})`;
  const dryRunNote = dryRun ? ' (dry run)' : '';
  logger.newline();
  if (errorCount > 0) {
    logger.log(`  ${successCount} compiled, ${errorCount} failed${formatNote} in ${elapsed}${dryRunNote}`);
    throw new Error(`${errorCount} file(s) failed to compile`);
  } else {
    logger.log(`  ${successCount} file${successCount !== 1 ? 's' : ''} compiled${formatNote} in ${elapsed}${dryRunNote}`);
  }
}
