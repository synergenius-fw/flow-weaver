/**
 * Diff command - compares two workflow files semantically
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflow } from '../../api/index.js';
import { WorkflowDiffer, formatDiff } from '../../diff/index.js';
import type { TDiffFormat } from '../../diff/index.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';

export interface DiffOptions {
  format?: TDiffFormat;
  workflowName?: string;
  exitZero?: boolean;
}

export async function diffCommand(
  file1: string,
  file2: string,
  options: DiffOptions = {}
): Promise<void> {
  const { format = 'text', workflowName, exitZero = false } = options;
  const filePath1 = path.resolve(file1);
  const filePath2 = path.resolve(file2);

  // Validate files exist
  if (!fs.existsSync(filePath1)) {
    logger.error(`File not found: ${filePath1}`);
    process.exit(1);
  }
  if (!fs.existsSync(filePath2)) {
    logger.error(`File not found: ${filePath2}`);
    process.exit(1);
  }

  try {
    // Parse both workflows
    const [result1, result2] = await Promise.all([
      parseWorkflow(filePath1, { workflowName }),
      parseWorkflow(filePath2, { workflowName }),
    ]);

    if (result1.errors.length > 0) {
      logger.error(`Parse errors in ${file1}:`);
      result1.errors.forEach((err) => logger.error(`  ${err}`));
      process.exit(1);
    }

    if (result2.errors.length > 0) {
      logger.error(`Parse errors in ${file2}:`);
      result2.errors.forEach((err) => logger.error(`  ${err}`));
      process.exit(1);
    }

    // Compare workflows
    const diff = WorkflowDiffer.compare(result1.ast, result2.ast);

    // Output based on format
    if (diff.identical) {
      logger.success('Workflows are identical');
    } else {
      // eslint-disable-next-line no-console
      console.log(formatDiff(diff, format));
      // Exit with code 1 if there are differences (useful for CI)
      if (!exitZero) {
        process.exit(1);
      }
    }
  } catch (error) {
    logger.error(`Failed to diff workflows: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}
