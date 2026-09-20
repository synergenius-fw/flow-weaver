/**
 * OpenAPI command - the document `fw serve` publishes at /openapi.json,
 * written to a file: the declared `@http` routes, the run resource of every
 * workflow, and the run endpoints.
 */

import * as path from 'path';
import * as fs from 'fs';
import yaml from 'js-yaml';
import { WorkflowRegistry } from '../../server/workflow-registry.js';
import { planRoutes } from '../../server/api.js';
import { buildOpenApi } from '../../server/openapi.js';
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

  const registry = new WorkflowRegistry(workflowDir);
  await registry.initialize();
  const endpoints = registry.getAllEndpoints();
  if (endpoints.length === 0) {
    throw new Error(`No workflows found in ${workflowDir}`);
  }

  const plan = planRoutes(endpoints.map((endpoint) => ({ name: endpoint.name, routes: endpoint.routes ?? [], endpoint })));
  const mounted = plan.mounted.map(({ owner, route }) => ({
    endpoint: owner.endpoint,
    route,
    keys: [...route.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  }));

  // Only speak when writing to a file, so stdout stays a clean document.
  if (options.output) {
    logger.info(`Found ${endpoints.length} workflow(s), ${mounted.length} declared route(s)`);
    for (const problem of plan.problems) logger.warn(problem);
  }

  const doc = buildOpenApi({
    endpoints,
    mounted,
    legacy: options.legacy !== false,
    secured: options.auth !== false,
    serverUrl: options.server,
    info: { title: options.title, version: options.version, description: options.description },
  });

  const format = options.format || 'json';
  const spec = format === 'yaml' ? yaml.dump(doc, { lineWidth: 120, noRefs: true }) : JSON.stringify(doc, null, 2);

  if (options.output) {
    const outputPath = path.resolve(options.output);
    safeWriteFile(outputPath, spec);
    logger.success(`OpenAPI specification written to ${outputPath}`);
  } else {
    process.stdout.write(spec + '\n');
  }
}
