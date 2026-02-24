/* eslint-disable no-console */
/**
 * Validate command - validates workflow files without compiling
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { parseWorkflow } from '../../api/index.js';
import { validator } from '../../validator.js';
import { getFriendlyError } from '../../friendly-errors.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import { getAgentValidationRules } from '../../validation/agent-rules.js';

export interface ValidateOptions {
  verbose?: boolean;
  quiet?: boolean;
  workflowName?: string;
  json?: boolean;
  strict?: boolean;
}

interface JsonValidationItem {
  message: string;
  severity: string;
  nodeId?: string;
  code?: string;
}

interface JsonValidationResult {
  file: string;
  valid: boolean;
  errors: JsonValidationItem[];
  warnings: JsonValidationItem[];
}

export async function validateCommand(input: string, options: ValidateOptions = {}): Promise<void> {
  const { verbose = false, quiet = false, workflowName, json = false, strict = false } = options;

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
      if (json) {
        console.log(JSON.stringify({ error: `No files found matching pattern: ${input}` }));
      } else {
        logger.error(`No files found matching pattern: ${input}`);
      }
      process.exit(1);
    }

    if (!json) {
      logger.section('Validating Workflows');
      logger.info(`Found ${files.length} file(s)`);
      logger.newline();
    }

    let totalErrors = 0;
    let totalWarnings = 0;
    let successCount = 0;
    const jsonResults: JsonValidationResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = path.basename(file);

      if (!json) {
        logger.progress(i + 1, files.length, fileName);
      }

      try {
        // Parse the workflow
        const parseResult = await parseWorkflow(file, { workflowName });

        if (parseResult.warnings.length > 0) {
          if (!json && !quiet) {
            logger.warn(`Parse warnings in ${fileName}:`);
            parseResult.warnings.forEach((w) => logger.warn(`  - ${w}`));
          }
          totalWarnings += parseResult.warnings.length;
        }

        if (parseResult.errors.length > 0) {
          // Skip non-workflow files silently (only error is "No workflows found")
          const isNonWorkflowFile =
            parseResult.errors.length === 1 &&
            typeof parseResult.errors[0] === 'string' &&
            parseResult.errors[0].startsWith('No workflows found');

          if (isNonWorkflowFile) {
            if (verbose && !json) {
              logger.debug(`  Skipped ${fileName} (no workflow)`);
            }
            continue;
          }

          if (json) {
            jsonResults.push({
              file,
              valid: false,
              errors: parseResult.errors.map((e) =>
                typeof e === 'string' ? { message: e, severity: 'error' } : e
              ),
              warnings: parseResult.warnings.map((w) =>
                typeof w === 'string' ? { message: w, severity: 'warning' } : w
              ),
            });
          } else {
            logger.error(`Parse errors in ${fileName}:`);
            parseResult.errors.forEach((err) => logger.error(`  ${err}`));
          }
          totalErrors += parseResult.errors.length;
          continue;
        }

        // Validate the AST (built-in rules)
        const validation = validator.validate(parseResult.ast, { strictMode: strict });

        // Run agent-specific validation rules
        const agentRules = getAgentValidationRules();
        for (const rule of agentRules) {
          const ruleErrors = rule.validate(parseResult.ast);
          for (const err of ruleErrors) {
            if (err.type === 'warning') {
              validation.warnings.push(err);
            } else {
              validation.errors.push(err);
              validation.valid = false;
            }
          }
        }

        if (json) {
          jsonResults.push({
            file,
            valid: validation.valid,
            errors: validation.errors.map((e) => ({
              message: e.message,
              severity: e.type || 'error',
              ...(e.node && { nodeId: e.node }),
              ...(e.code && { code: e.code }),
            })),
            warnings: [
              ...parseResult.warnings.map((w) =>
                typeof w === 'string' ? { message: w, severity: 'warning' } : w
              ),
              ...validation.warnings.map((w) => ({
                message: w.message,
                severity: w.type || 'warning',
                ...(w.node && { nodeId: w.node }),
                ...(w.code && { code: w.code }),
              })),
            ],
          });
        }

        if (validation.errors.length > 0) {
          if (!json) {
            logger.error(`Validation errors in ${fileName}:`);
            validation.errors.forEach((err) => {
              const friendly = getFriendlyError(err);
              if (friendly) {
                const loc = err.location ? `[line ${err.location.line}] ` : '';
                logger.error(`  ${loc}${friendly.title}: ${friendly.explanation}`);
                logger.info(`    How to fix: ${friendly.fix}`);
              } else {
                let msg = `  - ${err.message}`;
                if (err.location) {
                  msg = `  [line ${err.location.line}] - ${err.message}`;
                }
                if (err.node) {
                  msg += ` (node: ${err.node})`;
                }
                if (err.connection) {
                  msg += ` (connection: ${err.connection.from.node}:${err.connection.from.port} -> ${err.connection.to.node}:${err.connection.to.port})`;
                }
                logger.error(msg);
                if (err.docUrl) {
                  logger.info(`    See: ${err.docUrl}`);
                }
              }
            });
          }
          totalErrors += validation.errors.length;
        }

        if (validation.warnings.length > 0) {
          if (!json && !quiet) {
            logger.warn(`Warnings in ${fileName}:`);
            validation.warnings.forEach((warn) => {
              const friendly = getFriendlyError(warn);
              if (friendly) {
                const loc = warn.location ? `[line ${warn.location.line}] ` : '';
                logger.warn(`  ${loc}${friendly.title}: ${friendly.explanation}`);
                logger.info(`    How to fix: ${friendly.fix}`);
              } else {
                let msg = `  - ${warn.message}`;
                if (warn.location) {
                  msg = `  [line ${warn.location.line}] - ${warn.message}`;
                }
                if (warn.node) {
                  msg += ` (node: ${warn.node})`;
                }
                logger.warn(msg);
                if (warn.docUrl) {
                  logger.info(`    See: ${warn.docUrl}`);
                }
              }
            });
          }
          totalWarnings += validation.warnings.length;
        }

        if (validation.valid) {
          if (!json && verbose) {
            logger.success(`  ${fileName} is valid`);
          }
          successCount++;
        }
      } catch (error) {
        if (json) {
          jsonResults.push({
            file,
            valid: false,
            errors: [{ message: getErrorMessage(error), severity: 'error' }],
            warnings: [],
          });
        } else {
          logger.error(`Failed to validate ${fileName}: ${getErrorMessage(error)}`);
        }
        totalErrors++;
      }
    }

    // Output
    if (json) {
      console.log(
        JSON.stringify(
          {
            valid: totalErrors === 0,
            totalFiles: files.length,
            validFiles: successCount,
            totalErrors,
            totalWarnings,
            results: jsonResults,
          },
          null,
          2
        )
      );
    } else {
      // Summary
      logger.newline();
      logger.section('Validation Summary');
      logger.success(`${successCount} file(s) valid`);

      if (totalWarnings > 0) {
        logger.warn(`${totalWarnings} warning(s) found`);
      }

      if (totalErrors > 0) {
        logger.error(`${totalErrors} error(s) found`);
      } else {
        logger.success('All workflows are valid!');
      }
    }

    if (totalErrors > 0) {
      process.exit(1);
    }
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({ error: getErrorMessage(error) }));
    } else {
      logger.error(`Validation failed: ${getErrorMessage(error)}`);
    }
    process.exit(1);
  }
}
