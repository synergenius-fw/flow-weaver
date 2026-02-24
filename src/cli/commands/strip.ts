import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { hasInPlaceMarkers, stripGeneratedSections } from '../../api/generate-in-place.js';
import { logger } from '../utils/logger.js';

export interface StripOptions {
  output?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function stripCommand(input: string, options: StripOptions = {}): Promise<void> {
  const { output, dryRun = false, verbose = false } = options;

  // If input is a directory, expand to all .ts files recursively
  let pattern = input;
  try {
    if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
      pattern = path.join(input, '**/*.ts');
    }
  } catch {
    // Not a valid path, use as glob pattern
  }

  const allFiles = await glob(pattern, { absolute: true });
  const files = allFiles.filter((f) => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  });

  if (files.length === 0) {
    logger.error(`No files found matching pattern: ${input}`);
    process.exit(1);
  }

  let stripped = 0;
  let skipped = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');

    if (!hasInPlaceMarkers(content)) {
      skipped++;
      if (verbose) {
        logger.info(`Skipped (no markers): ${path.relative(process.cwd(), filePath)}`);
      }
      continue;
    }

    const result = stripGeneratedSections(content);

    if (dryRun) {
      logger.info(`Would strip: ${path.relative(process.cwd(), filePath)}`);
      stripped++;
      continue;
    }

    const outPath = output
      ? path.join(path.resolve(output), path.basename(filePath))
      : filePath;

    if (output) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
    }

    fs.writeFileSync(outPath, result);
    stripped++;

    if (verbose) {
      logger.success(`Stripped: ${path.relative(process.cwd(), outPath)}`);
    }
  }

  logger.success(`${stripped} file${stripped !== 1 ? 's' : ''} stripped, ${skipped} skipped`);
}
