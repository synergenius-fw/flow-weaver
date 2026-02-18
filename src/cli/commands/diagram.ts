/* eslint-disable no-console */
/**
 * Diagram command — generates SVG diagrams from workflow files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileToSVG } from '../../diagram/index.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';

export interface DiagramCommandOptions {
  theme?: 'dark' | 'light';
  width?: number;
  padding?: number;
  showPortLabels?: boolean;
  workflowName?: string;
  output?: string;
}

export async function diagramCommand(input: string, options: DiagramCommandOptions = {}): Promise<void> {
  const { output, ...diagramOptions } = options;
  const filePath = path.resolve(input);

  if (!fs.existsSync(filePath)) {
    logger.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    const svg = fileToSVG(filePath, diagramOptions);

    if (output) {
      const outputPath = path.resolve(output);
      fs.writeFileSync(outputPath, svg, 'utf-8');
      logger.success(`Diagram written to ${outputPath}`);
    } else {
      process.stdout.write(svg);
    }
  } catch (error) {
    logger.error(`Failed to generate diagram: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}
