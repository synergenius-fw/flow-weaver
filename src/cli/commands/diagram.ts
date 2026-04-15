/* eslint-disable no-console */
/**
 * Diagram command — generates SVG, interactive HTML, or ASCII diagrams from workflow files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileToSVG, fileToHTML, fileToASCII } from '../../diagram/index.js';
import { parser } from '../../parser.js';
import { logger } from '../utils/logger.js';
import { safeWriteFile } from '../utils/safe-write.js';

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
    throw new Error(`File not found: ${filePath}`);
  }

  // Load marketplace pack tag handlers before parsing
  await parser.loadPackHandlers(path.dirname(filePath));

  let result: string;
  if (ASCII_FORMATS.has(format)) {
    result = fileToASCII(filePath, { ...diagramOptions, format });
  } else if (format === 'html') {
    result = fileToHTML(filePath, { ...diagramOptions, format });
  } else {
    result = fileToSVG(filePath, diagramOptions);
  }

  if (output) {
    const outputPath = path.resolve(output);
    safeWriteFile(outputPath, result);
    logger.success(`Diagram written to ${outputPath}`);
  } else {
    process.stdout.write(result);
  }
}
