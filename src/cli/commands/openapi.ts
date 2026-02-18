/**
 * OpenAPI command - generate OpenAPI specification from workflow files
 */

import * as path from 'path';
import * as fs from 'fs';
import { WorkflowRegistry } from '../../server/workflow-registry.js';
import { generateOpenAPIJson, generateOpenAPIYaml } from '../../deployment/openapi/generator.js';
import { logger } from '../utils/logger.js';

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
}

/**
 * Generate OpenAPI specification from workflows in a directory.
 *
 * @param dir - Directory containing workflow files
 * @param options - Generation options
 *
 * @example
 * ```bash
 * # Generate JSON spec to stdout
 * flow-weaver openapi ./workflows
 *
 * # Generate YAML spec to file
 * flow-weaver openapi ./workflows --format yaml --output api-spec.yaml
 *
 * # With custom title and version
 * flow-weaver openapi ./workflows --title "My API" --version "2.0.0"
 * ```
 */
export async function openapiCommand(dir: string, options: OpenAPIOptions): Promise<void> {
  const workflowDir = path.resolve(dir);

  // Validate directory exists
  if (!fs.existsSync(workflowDir)) {
    throw new Error(`Directory not found: ${workflowDir}`);
  }

  if (!fs.statSync(workflowDir).isDirectory()) {
    throw new Error(`Not a directory: ${workflowDir}`);
  }

  // Initialize registry to discover workflows
  const registry = new WorkflowRegistry(workflowDir);
  await registry.initialize();

  const endpoints = registry.getAllEndpoints();

  if (endpoints.length === 0) {
    throw new Error(`No workflows found in ${workflowDir}`);
  }

  logger.info(`Found ${endpoints.length} workflow(s)`);

  // Generate options
  const generatorOptions = {
    title: options.title || 'Flow Weaver API',
    version: options.version || '1.0.0',
    description: options.description || 'API generated from Flow Weaver workflows',
    servers: options.server ? [{ url: options.server }] : undefined,
  };

  // Generate spec
  const format = options.format || 'json';
  const spec =
    format === 'yaml'
      ? generateOpenAPIYaml(endpoints, generatorOptions)
      : generateOpenAPIJson(endpoints, generatorOptions);

  // Output
  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.writeFileSync(outputPath, spec);
    logger.success(`OpenAPI specification written to ${outputPath}`);
  } else {
    // Output to stdout
    process.stdout.write(spec + '\n');
  }
}
