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
    throw new Error(`File not found: ${filePath1}`);
  }
  if (!fs.existsSync(filePath2)) {
    throw new Error(`File not found: ${filePath2}`);
  }

  let diff;
  try {
    // Parse both workflows
    const [result1, result2] = await Promise.all([
      parseWorkflow(filePath1, { workflowName, projectDir: path.dirname(filePath1) }),
      parseWorkflow(filePath2, { workflowName, projectDir: path.dirname(filePath2) }),
    ]);

    if (result1.errors.length > 0) {
      throw new Error(`Parse errors in ${file1}:\n${result1.errors.map((err) => `  ${err}`).join('\n')}`);
    }

    if (result2.errors.length > 0) {
      throw new Error(`Parse errors in ${file2}:\n${result2.errors.map((err) => `  ${err}`).join('\n')}`);
    }

    diff = WorkflowDiffer.compare(result1.ast, result2.ast);
  } catch (error) {
    throw new Error(`Failed to diff workflows: ${getErrorMessage(error)}`);
  }

  if (diff.identical) {
    if (format === 'json') {
      console.log(JSON.stringify({ identical: true }));
    } else {
      logger.success('Workflows are identical');
    }
    return;
  }

  console.log(formatDiff(diff, format));
  // A difference is the answer, not a failure: exit 1 for CI without the
  // "failed" prefix a real failure gets.
  if (!exitZero) {
    throw new Error('Workflows have differences');
  }
}
