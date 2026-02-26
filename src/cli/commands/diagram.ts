/* eslint-disable no-console */
/**
 * Diagram command — generates SVG, interactive HTML, or ASCII diagrams from workflow files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileToSVG, fileToHTML, fileToASCII } from '../../diagram/index.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';

const ASCII_FORMATS = new Set(['ascii', 'ascii-compact', 'text']);

export interface DiagramCommandOptions {
  theme?: 'dark' | 'light';
  width?: number;
  padding?: number;
  showPortLabels?: boolean;
  workflowName?: string;
  output?: string;
  format?: 'svg' | 'html' | 'ascii' | 'ascii-compact' | 'text';
}

export async function diagramCommand(input: string, options: DiagramCommandOptions = {}): Promise<void> {
  const { output, format = 'svg', ...diagramOptions } = options;
  const filePath = path.resolve(input);

  if (!fs.existsSync(filePath)) {
    logger.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    let result: string;
    if (ASCII_FORMATS.has(format)) {
      result = fileToASCII(filePath, { ...diagramOptions, format });
    } else if (format === 'html') {
      result = fileToHTML(filePath, diagramOptions);
    } else {
      result = fileToSVG(filePath, diagramOptions);
    }

    if (output) {
      const outputPath = path.resolve(output);
      fs.writeFileSync(outputPath, result, 'utf-8');
      logger.success(`Diagram written to ${outputPath}`);
    } else {
      process.stdout.write(result);
    }
  } catch (error) {
    logger.error(`Failed to generate diagram: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}
