/**
 * Migrate command - upgrades workflow files to current syntax
 *
 * Uses the parse → generate round-trip as the primary migration mechanism:
 * the parser adds defaults for missing fields, edge-case migrations transform
 * the AST, and generateInPlace writes current syntax back.
 */

import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import { parseWorkflow } from '../../api/index.js';
import { generateInPlace } from '../../api/generate-in-place.js';
import { WorkflowDiffer, formatDiff } from '../../diff/index.js';
import { applyMigrations, getRegisteredMigrations } from '../../migration/registry.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';

export interface MigrateOptions {
  dryRun?: boolean;
  diff?: boolean;
}

export async function migrateCommand(
  globPattern: string,
  options: MigrateOptions = {}
): Promise<void> {
  const { dryRun = false, diff = false } = options;

  const files = globSync(globPattern, { ignore: ['**/node_modules/**', '**/*.generated.ts'] });

  if (files.length === 0) {
    logger.warn(`No files matched pattern: ${globPattern}`);
    return;
  }

  const registeredMigrations = getRegisteredMigrations();
  if (registeredMigrations.length > 0) {
    logger.info(`Registered edge-case migrations: ${registeredMigrations.map((m) => m.name).join(', ')}`);
  }

  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const filePath = path.resolve(file);

    try {
      const sourceCode = fs.readFileSync(filePath, 'utf8');

      // Parse with current parser (backward-compatible — adds defaults for missing fields)
      const parseResult = await parseWorkflow(filePath);

      if (parseResult.errors.length > 0) {
        logger.error(`  ${file}: parse errors — skipping`);
        parseResult.errors.forEach((err) => logger.error(`    ${err}`));
        errorCount++;
        continue;
      }

      // Apply edge-case migrations (if any registered)
      let ast = parseResult.ast;
      ast = applyMigrations(ast);

      // Regenerate annotations in-place using current syntax
      const genResult = generateInPlace(sourceCode, ast, {
        allWorkflows: parseResult.allWorkflows,
      });

      if (!genResult.hasChanges) {
        skippedCount++;
        continue;
      }

      if (diff) {
        // Show semantic diff before/after
        const reparsed = await parseWorkflow(filePath);
        if (reparsed.errors.length === 0) {
          const semanticDiff = WorkflowDiffer.compare(parseResult.ast, ast);
          if (!semanticDiff.identical) {
            logger.info(`\n${file}:`);
            // eslint-disable-next-line no-console
            console.log(formatDiff(semanticDiff, 'text'));
          }
        }
      }

      if (dryRun) {
        logger.info(`  ${file}: would be updated`);
        migratedCount++;
        continue;
      }

      fs.writeFileSync(filePath, genResult.code, 'utf8');
      logger.success(`  ${file}: migrated`);
      migratedCount++;
    } catch (error) {
      logger.error(`  ${file}: ${getErrorMessage(error)}`);
      errorCount++;
    }
  }

  // Summary
  logger.newline();
  if (dryRun) {
    logger.info(`Dry run complete: ${migratedCount} file(s) would be updated, ${skippedCount} already current, ${errorCount} error(s)`);
  } else {
    logger.info(`Migration complete: ${migratedCount} file(s) updated, ${skippedCount} already current, ${errorCount} error(s)`);
  }
}
