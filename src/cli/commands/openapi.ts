/**
 * OpenAPI command - the document `fw serve` publishes at /openapi.json,
 * written to a file: the declared `@http` routes, the run resource of every
 * workflow, and the run endpoints.
 */

import * as path from 'path';
import * as fs from 'fs';
import { openApiForDirectory, formatOpenApi } from '../../server/openapi-document.js';
import { logger } from '../utils/logger.js';
import { safeWriteFile } from '../utils/safe-write.js';

export interface OpenAPIOptions {
  /** Output file path */
  output?: string;
  /** API title */
  title?: string;
  /** API version */
  version?: string;
  /** API description */
  description?: string;
  /** Output format: json or yaml */
  format?: 'json' | 'yaml';
  /** Server URL */
  server?: string;
  /** Describe the bearer scheme, as a server with a token has. Default true. */
  auth?: boolean;
  /** Include `POST /workflows/<name>` for every workflow. Default true. */
  legacy?: boolean;
}

/**
 * Generate the OpenAPI specification for the workflows in a directory.
 *
 * @example
 * ```bash
 * fw openapi ./workflows
 * fw openapi ./workflows --format yaml --output api-spec.yaml
 * fw openapi ./workflows --server https://api.example.com/api --title "Orders API"
 * ```
 */
export async function openapiCommand(dir: string, options: OpenAPIOptions): Promise<void> {
  const workflowDir = path.resolve(dir);

  if (!fs.existsSync(workflowDir)) {
    throw new Error(`Directory not found: ${workflowDir}`);
  }
  if (!fs.statSync(workflowDir).isDirectory()) {
    throw new Error(`Not a directory: ${workflowDir}`);
  }

  const { doc, workflowCount, routeCount, problems } = await openApiForDirectory(workflowDir, {
    title: options.title,
    version: options.version,
    description: options.description,
    serverUrl: options.server,
    auth: options.auth,
    legacy: options.legacy,
  });
  if (workflowCount === 0) {
    throw new Error(`No workflows found in ${workflowDir}`);
  }

  // Only speak when writing to a file, so stdout stays a clean document.
  if (options.output) {
    logger.info(`Found ${workflowCount} workflow(s), ${routeCount} declared route(s)`);
    for (const problem of problems) logger.warn(problem);
  }

  const spec = formatOpenApi(doc, options.format || 'json');

  if (options.output) {
    const outputPath = path.resolve(options.output);
    safeWriteFile(outputPath, spec);
    logger.success(`OpenAPI specification written to ${outputPath}`);
  } else {
    process.stdout.write(spec + '\n');
  }
}
