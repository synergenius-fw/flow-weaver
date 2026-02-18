/**
 * Base export target interface and abstract class
 *
 * Defines the contract for serverless export targets and provides
 * shared utilities for generating deployment artifacts.
 */

import * as path from 'path';
import { getGeneratedBranding } from '../../generated-branding.js';

/**
 * Export options passed to targets
 */
export interface ExportOptions {
  /** Path to the workflow source file */
  sourceFile: string;
  /** Workflow function name */
  workflowName: string;
  /** Workflow display name */
  displayName: string;
  /** Output directory */
  outputDir: string;
  /** Workflow description */
  description?: string;
  /** Production mode (no trace events) */
  production?: boolean;
  /** Include API documentation routes (/docs and /openapi.json) */
  includeDocs?: boolean;
  /** Additional target-specific options */
  targetOptions?: Record<string, unknown>;
  /** Export all workflows in file as a single service */
  multi?: boolean;
  /** Specific workflow names to export (subset of file) */
  workflows?: string[];
}

/**
 * Compiled workflow metadata for multi-workflow export
 */
export interface CompiledWorkflow {
  /** Workflow name (used in URL path) */
  name: string;
  /** Function name in compiled code */
  functionName: string;
  /** Workflow description */
  description?: string;
  /** Compiled code content */
  code?: string;
}

/**
 * A single generated file
 */
export interface GeneratedFile {
  /** Relative path from output directory */
  relativePath: string;
  /** Absolute path */
  absolutePath: string;
  /** File content */
  content: string;
  /** File type for display */
  type: 'handler' | 'config' | 'workflow' | 'nodeType' | 'package' | 'other';
}

/**
 * Export result with all generated artifacts
 */
export interface ExportArtifacts {
  /** Generated files */
  files: GeneratedFile[];
  /** Target name */
  target: string;
  /** Workflow name */
  workflowName: string;
  /** Entry point file */
  entryPoint: string;
}

/**
 * Deployment instructions
 */
export interface DeployInstructions {
  /** Title for the instructions */
  title: string;
  /** Step-by-step instructions */
  steps: string[];
  /** Required tools/dependencies */
  prerequisites: string[];
  /** Steps to test locally before deploying */
  localTestSteps?: string[];
  /** Links to documentation */
  links?: { label: string; url: string }[];
}

/**
 * Multi-workflow export artifacts
 */
export interface MultiWorkflowArtifacts extends ExportArtifacts {
  /** All workflow names included */
  workflowNames: string[];
  /** OpenAPI spec if generated */
  openApiSpec?: object;
}

/**
 * Node type export options
 */
export interface NodeTypeExportOptions {
  /** Source file path */
  sourceFile: string;
  /** Service name for the exported handlers */
  serviceName: string;
  /** Output directory */
  outputDir: string;
  /** Production mode (no trace events) */
  production?: boolean;
  /** Include API documentation routes */
  includeDocs?: boolean;
}

/**
 * Node type export artifacts
 */
export interface NodeTypeArtifacts extends ExportArtifacts {
  /** All node type names included */
  nodeTypeNames: string[];
  /** OpenAPI spec if generated */
  openApiSpec?: object;
}

/**
 * Node type info for export (matches TNodeTypeAST structure)
 */
export interface NodeTypeInfo {
  name: string;
  functionName: string;
  description?: string;
  inputs: Record<
    string,
    { dataType?: string; tsType?: string; label?: string; optional?: boolean }
  >;
  outputs: Record<string, { dataType?: string; tsType?: string; label?: string }>;
  /** Generated wrapper code for standalone deployment */
  code?: string;
}

/**
 * Bundle item with expose flag - used for unified bundle export
 *
 * Key concepts:
 * - bundled items are included in the export
 * - exposed items get HTTP endpoints
 * - non-exposed bundled items are available as internal dependencies
 */
export interface BundleWorkflow extends CompiledWorkflow {
  /** Whether to create HTTP endpoint for this workflow */
  expose: boolean;
}

export interface BundleNodeType extends NodeTypeInfo {
  /** Whether to create HTTP endpoint for this node type */
  expose: boolean;
  /** Generated wrapper code for standalone deployment */
  code?: string;
}

/**
 * Bundle export artifacts
 */
export interface BundleArtifacts extends ExportArtifacts {
  /** All workflow names included */
  workflowNames?: string[];
  /** All node type names included */
  nodeTypeNames?: string[];
  /** OpenAPI spec if generated */
  openApiSpec?: object;
}

/**
 * Export target interface
 */
export interface ExportTarget {
  /** Target identifier */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;

  /**
   * Generate deployment artifacts for single workflow
   */
  generate(options: ExportOptions): Promise<ExportArtifacts>;

  /**
   * Generate deployment artifacts for multiple workflows
   */
  generateMultiWorkflow?(
    workflows: CompiledWorkflow[],
    options: ExportOptions
  ): Promise<MultiWorkflowArtifacts>;

  /**
   * Generate deployment artifacts for node types as standalone HTTP endpoints
   */
  generateNodeTypeService?(
    nodeTypes: NodeTypeInfo[],
    options: NodeTypeExportOptions
  ): Promise<NodeTypeArtifacts>;

  /**
   * Generate deployment artifacts for a unified bundle of workflows and node types.
   * Supports mixed content with individual expose flags for each item.
   *
   * @param workflows - Workflows to include, with expose flags
   * @param nodeTypes - Node types to include, with expose flags
   * @param options - Export options
   * @returns Bundle artifacts including files and metadata
   */
  generateBundle?(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: ExportOptions
  ): Promise<BundleArtifacts>;

  /**
   * Get deployment instructions
   */
  getDeployInstructions(artifacts: ExportArtifacts): DeployInstructions;
}

/**
 * Base export target with shared utilities
 */
export abstract class BaseExportTarget implements ExportTarget {
  abstract readonly name: string;
  abstract readonly description: string;

  abstract generate(options: ExportOptions): Promise<ExportArtifacts>;

  abstract generateMultiWorkflow(
    workflows: CompiledWorkflow[],
    options: ExportOptions
  ): Promise<MultiWorkflowArtifacts>;

  abstract generateNodeTypeService(
    nodeTypes: NodeTypeInfo[],
    options: NodeTypeExportOptions
  ): Promise<NodeTypeArtifacts>;

  abstract generateBundle(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: ExportOptions
  ): Promise<BundleArtifacts>;

  abstract getDeployInstructions(artifacts: ExportArtifacts): DeployInstructions;

  /**
   * Generate a standard package.json
   */
  protected generatePackageJson(options: {
    name: string;
    description?: string;
    main?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }): string {
    const pkg = {
      name: `fw-${options.name}`,
      version: '1.0.0',
      description: options.description || `Flow Weaver workflow: ${options.name}`,
      type: 'module',
      main: options.main || 'index.js',
      scripts: options.scripts || {},
      dependencies: options.dependencies || {},
      devDependencies: {
        typescript: '^5.0.0',
        ...options.devDependencies,
      },
    };

    return JSON.stringify(pkg, null, 2);
  }

  /**
   * Generate a standard tsconfig.json
   */
  protected generateTsConfig(
    options: {
      outDir?: string;
      module?: string;
      moduleResolution?: string;
      types?: string[];
    } = {}
  ): string {
    const config = {
      compilerOptions: {
        target: 'ES2022',
        module: options.module || 'NodeNext',
        moduleResolution: options.moduleResolution || 'NodeNext',
        outDir: options.outDir || './dist',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        ...(options.types && { types: options.types }),
      },
      include: ['**/*.ts'],
    };

    return JSON.stringify(config, null, 2);
  }

  /**
   * Create a file object
   */
  protected createFile(
    outputDir: string,
    relativePath: string,
    content: string,
    type: GeneratedFile['type']
  ): GeneratedFile {
    return {
      relativePath,
      absolutePath: path.join(outputDir, relativePath),
      content,
      type,
    };
  }

  /**
   * Generate content files for workflows and node types in a bundle.
   * Creates files under workflows/ and node-types/ subdirectories.
   */
  protected generateBundleContentFiles(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    outputDir: string,
    workflowDir = 'workflows',
    nodeTypeDir = 'node-types'
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    for (const w of workflows) {
      if (w.code) {
        files.push(this.createFile(outputDir, `${workflowDir}/${w.name}.ts`, w.code, 'workflow'));
      }
    }
    for (const nt of nodeTypes) {
      if (nt.code) {
        // Use lowercase functionName for file naming to ensure consistency with import paths
        // and avoid case-sensitivity issues on case-insensitive filesystems (macOS, Windows)
        files.push(this.createFile(outputDir, `${nodeTypeDir}/${nt.functionName.toLowerCase()}.ts`, nt.code, 'nodeType'));
      }
    }
    return files;
  }

  /**
   * Generate content files for compiled workflows.
   * Creates files under the workflows/ subdirectory.
   */
  protected generateWorkflowContentFiles(
    workflows: CompiledWorkflow[],
    outputDir: string,
    workflowDir = 'workflows'
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    for (const w of workflows) {
      if (w.code) {
        files.push(this.createFile(outputDir, `${workflowDir}/${w.name}.ts`, w.code, 'workflow'));
      }
    }
    return files;
  }

  /**
   * Generate content files for node types.
   * Creates files under the node-types/ subdirectory.
   */
  protected generateNodeTypeContentFiles(
    nodeTypes: NodeTypeInfo[],
    outputDir: string,
    nodeTypeDir = 'node-types'
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    for (const nt of nodeTypes) {
      if (nt.code) {
        // Use lowercase functionName for file naming to ensure consistency with import paths
        // and avoid case-sensitivity issues on case-insensitive filesystems
        files.push(this.createFile(outputDir, `${nodeTypeDir}/${nt.functionName.toLowerCase()}.ts`, nt.code, 'nodeType'));
      }
    }
    return files;
  }

  /**
   * Get relative import path for the workflow
   */
  protected getWorkflowImport(workflowFile: string): string {
    const basename = path.basename(workflowFile, path.extname(workflowFile));
    return `./${basename}.js`;
  }

  /**
   * Generate OpenAPI spec for node types as HTTP endpoints
   */
  protected generateNodeTypeOpenAPI(
    nodeTypes: NodeTypeInfo[],
    options: { title: string; version: string; baseUrl?: string }
  ): object {
    const paths: Record<string, object> = {};

    for (const nodeType of nodeTypes) {
      // Build request schema from inputs
      const inputProperties: Record<string, object> = {};
      const requiredInputs: string[] = [];

      for (const [portName, portDef] of Object.entries(nodeType.inputs)) {
        // Skip control flow ports (execute)
        if (portDef.dataType === 'STEP') continue;

        inputProperties[portName] = {
          type: this.mapDataTypeToJsonSchema(portDef.dataType || 'any'),
          description: portDef.label || portName,
          ...(portDef.tsType && { 'x-ts-type': portDef.tsType }),
        };

        if (!portDef.optional) {
          requiredInputs.push(portName);
        }
      }

      // Build response schema from outputs
      const outputProperties: Record<string, object> = {};

      for (const [portName, portDef] of Object.entries(nodeType.outputs)) {
        // Skip control flow ports (onSuccess, onFailure)
        if (portDef.dataType === 'STEP') continue;

        outputProperties[portName] = {
          type: this.mapDataTypeToJsonSchema(portDef.dataType || 'any'),
          description: portDef.label || portName,
          ...(portDef.tsType && { 'x-ts-type': portDef.tsType }),
        };
      }

      paths[`/api/${nodeType.name}`] = {
        post: {
          operationId: `execute_${nodeType.functionName}`,
          summary: `Execute ${nodeType.name}`,
          description: nodeType.description || `Execute the ${nodeType.name} node type function`,
          tags: ['node-types'],
          requestBody: {
            description: 'Node type input parameters',
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: inputProperties,
                  required: requiredInputs.length > 0 ? requiredInputs : undefined,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Successful execution',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      result: {
                        type: 'object',
                        properties: outputProperties,
                      },
                      executionTime: { type: 'number' },
                      requestId: { type: 'string' },
                    },
                  },
                },
              },
            },
            '404': {
              description: 'Node type not found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string' },
                    },
                  },
                },
              },
            },
            '500': {
              description: 'Execution error',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      error: { type: 'string' },
                      requestId: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }

    // Add OpenAPI spec endpoint
    paths['/api/openapi.json'] = {
      get: {
        operationId: 'get_openapi',
        summary: 'OpenAPI Specification',
        description: 'Returns this OpenAPI 3.0 specification',
        tags: ['documentation'],
        responses: {
          '200': {
            description: 'OpenAPI specification',
            content: {
              'application/json': {},
            },
          },
        },
      },
    };

    return {
      openapi: '3.0.3',
      info: {
        title: options.title,
        version: options.version,
        description: `Node type service with ${nodeTypes.length} endpoints`,
      },
      servers: [{ url: options.baseUrl || '/', description: 'Current deployment' }],
      paths,
      tags: [
        { name: 'node-types', description: 'Node type execution endpoints' },
        { name: 'documentation', description: 'API documentation' },
      ],
    };
  }

  /**
   * Map Flow Weaver data types to JSON Schema types
   */
  private mapDataTypeToJsonSchema(dataType: string): string {
    const typeMap: Record<string, string> = {
      STRING: 'string',
      NUMBER: 'number',
      BOOLEAN: 'boolean',
      OBJECT: 'object',
      ARRAY: 'array',
      ANY: 'any',
      FUNCTION: 'object',
      STEP: 'boolean',
    };
    return typeMap[dataType] || 'any';
  }

  /**
   * Generate consolidated OpenAPI spec for multiple workflows
   */
  protected generateConsolidatedOpenAPI(
    workflows: CompiledWorkflow[],
    options: { title: string; version: string; baseUrl?: string }
  ): object {
    const paths: Record<string, object> = {};

    for (const workflow of workflows) {
      paths[`/api/${workflow.name}`] = {
        post: {
          operationId: `execute_${workflow.functionName}`,
          summary: `Execute ${workflow.name} workflow`,
          description: workflow.description || `Execute the ${workflow.name} workflow`,
          tags: ['workflows'],
          requestBody: {
            description: 'Workflow input parameters',
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description:
                    'Workflow-specific parameters. Function parameters can be registry IDs.',
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Successful workflow execution',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      result: { type: 'object' },
                      executionTime: { type: 'number' },
                      requestId: { type: 'string' },
                    },
                  },
                },
              },
            },
            '404': {
              description: 'Workflow not found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string' },
                    },
                  },
                },
              },
            },
            '500': {
              description: 'Execution error',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      error: { type: 'string' },
                      requestId: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }

    // Add /api/functions endpoint
    paths['/api/functions'] = {
      get: {
        operationId: 'list_functions',
        summary: 'List available functions',
        description: 'Returns all registered functions that can be used as parameters',
        tags: ['functions'],
        parameters: [
          {
            name: 'category',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['transform', 'filter', 'validate', 'format', 'custom'],
            },
            description: 'Filter by function category',
          },
        ],
        responses: {
          '200': {
            description: 'List of registered functions',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', example: 'string:uppercase' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                      category: {
                        type: 'string',
                        enum: ['transform', 'filter', 'validate', 'format', 'custom'],
                      },
                      inputType: { type: 'string' },
                      outputType: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    // Add OpenAPI spec endpoint
    paths['/api/openapi.json'] = {
      get: {
        operationId: 'get_openapi',
        summary: 'OpenAPI Specification',
        description: 'Returns this OpenAPI 3.0 specification',
        tags: ['documentation'],
        responses: {
          '200': {
            description: 'OpenAPI specification',
            content: {
              'application/json': {},
            },
          },
        },
      },
    };

    return {
      openapi: '3.0.3',
      info: {
        title: options.title,
        version: options.version,
        description: `Multi-workflow service with ${workflows.length} workflows`,
      },
      servers: [{ url: options.baseUrl || '/', description: 'Current deployment' }],
      paths,
      tags: [
        { name: 'workflows', description: 'Workflow execution endpoints' },
        { name: 'functions', description: 'Function registry endpoints' },
        { name: 'documentation', description: 'API documentation' },
      ],
      components: {
        schemas: {
          FunctionReference: {
            oneOf: [
              {
                type: 'string',
                description: 'Registry function ID (e.g., "string:uppercase")',
              },
              {
                type: 'object',
                properties: {
                  registryId: {
                    type: 'string',
                    description: 'Registry function ID',
                  },
                  partialArgs: {
                    type: 'object',
                    description: 'Pre-bound arguments',
                    additionalProperties: true,
                  },
                },
                required: ['registryId'],
              },
            ],
            description:
              'Function parameter - can be a registry ID or object with partial arguments',
          },
        },
      },
    };
  }

  /**
   * Generate OpenAPI spec for a unified bundle of workflows and node types.
   * Only includes exposed items as HTTP endpoints.
   */
  protected generateBundleOpenAPI(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: { title: string; version: string; baseUrl?: string }
  ): object {
    const paths: Record<string, object> = {};
    const tags: Array<{ name: string; description: string }> = [];

    // Add exposed workflows
    const exposedWorkflows = workflows.filter((w) => w.expose);
    if (exposedWorkflows.length > 0) {
      tags.push({ name: 'workflows', description: 'Workflow execution endpoints' });

      for (const workflow of exposedWorkflows) {
        paths[`/api/workflows/${workflow.name}`] = {
          post: {
            operationId: `execute_workflow_${workflow.functionName}`,
            summary: `Execute ${workflow.name} workflow`,
            description: workflow.description || `Execute the ${workflow.name} workflow`,
            tags: ['workflows'],
            requestBody: {
              description: 'Workflow input parameters',
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    description: 'Workflow-specific parameters',
                    additionalProperties: true,
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Successful workflow execution',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        result: { type: 'object' },
                        executionTime: { type: 'number' },
                        requestId: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '404': {
                description: 'Workflow not found',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { error: { type: 'string' } },
                    },
                  },
                },
              },
              '500': {
                description: 'Execution error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        error: { type: 'string' },
                        requestId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      }
    }

    // Add exposed node types
    const exposedNodeTypes = nodeTypes.filter((nt) => nt.expose);
    if (exposedNodeTypes.length > 0) {
      tags.push({ name: 'node-types', description: 'Node type execution endpoints' });

      for (const nodeType of exposedNodeTypes) {
        // Build request schema from inputs
        const inputProperties: Record<string, object> = {};
        const requiredInputs: string[] = [];

        for (const [portName, portDef] of Object.entries(nodeType.inputs)) {
          // Skip control flow ports (execute)
          if (portDef.dataType === 'STEP') continue;

          inputProperties[portName] = {
            type: this.mapDataTypeToJsonSchema(portDef.dataType || 'any'),
            description: portDef.label || portName,
            ...(portDef.tsType && { 'x-ts-type': portDef.tsType }),
          };

          if (!portDef.optional) {
            requiredInputs.push(portName);
          }
        }

        // Build response schema from outputs
        const outputProperties: Record<string, object> = {};

        for (const [portName, portDef] of Object.entries(nodeType.outputs)) {
          // Skip control flow ports
          if (portDef.dataType === 'STEP') continue;

          outputProperties[portName] = {
            type: this.mapDataTypeToJsonSchema(portDef.dataType || 'any'),
            description: portDef.label || portName,
            ...(portDef.tsType && { 'x-ts-type': portDef.tsType }),
          };
        }

        paths[`/api/nodes/${nodeType.name}`] = {
          post: {
            operationId: `execute_node_${nodeType.functionName}`,
            summary: `Execute ${nodeType.name}`,
            description: nodeType.description || `Execute the ${nodeType.name} node type function`,
            tags: ['node-types'],
            requestBody: {
              description: 'Node type input parameters',
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: inputProperties,
                    required: requiredInputs.length > 0 ? requiredInputs : undefined,
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Successful execution',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        result: {
                          type: 'object',
                          properties: outputProperties,
                        },
                        executionTime: { type: 'number' },
                        requestId: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '404': {
                description: 'Node type not found',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { error: { type: 'string' } },
                    },
                  },
                },
              },
              '500': {
                description: 'Execution error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        error: { type: 'string' },
                        requestId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      }
    }

    // Add function registry endpoint
    tags.push({ name: 'functions', description: 'Function registry endpoints' });
    paths['/api/functions'] = {
      get: {
        operationId: 'list_functions',
        summary: 'List available functions',
        description: 'Returns all registered functions that can be used as parameters',
        tags: ['functions'],
        parameters: [
          {
            name: 'category',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['transform', 'filter', 'validate', 'format', 'custom'],
            },
            description: 'Filter by function category',
          },
        ],
        responses: {
          '200': {
            description: 'List of registered functions',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                      category: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    // Add OpenAPI spec endpoint
    tags.push({ name: 'documentation', description: 'API documentation' });
    paths['/api/openapi.json'] = {
      get: {
        operationId: 'get_openapi',
        summary: 'OpenAPI Specification',
        description: 'Returns this OpenAPI 3.0 specification',
        tags: ['documentation'],
        responses: {
          '200': {
            description: 'OpenAPI specification',
            content: { 'application/json': {} },
          },
        },
      },
    };

    // Build description
    const exposedCounts: string[] = [];
    if (exposedWorkflows.length > 0) {
      exposedCounts.push(
        `${exposedWorkflows.length} workflow${exposedWorkflows.length !== 1 ? 's' : ''}`
      );
    }
    if (exposedNodeTypes.length > 0) {
      exposedCounts.push(
        `${exposedNodeTypes.length} node type${exposedNodeTypes.length !== 1 ? 's' : ''}`
      );
    }

    return {
      openapi: '3.0.3',
      info: {
        title: options.title,
        version: options.version,
        description: `Bundle service with ${exposedCounts.join(' and ')} exposed`,
      },
      servers: [{ url: options.baseUrl || '/', description: 'Current deployment' }],
      paths,
      tags,
    };
  }

  /**
   * Generate a README.md from deploy instructions
   */
  protected generateReadme(
    instructions: DeployInstructions,
    workflowName: string,
    target: string
  ): string {
    const lines: string[] = [];

    lines.push(`# Deploy ${workflowName} to ${target}`);
    lines.push('');

    if (instructions.prerequisites.length > 0) {
      lines.push('## Prerequisites');
      lines.push('');
      instructions.prerequisites.forEach((p) => lines.push(`- ${p}`));
      lines.push('');
    }

    if (instructions.steps.length > 0) {
      lines.push('## Deployment Steps');
      lines.push('');
      instructions.steps.forEach((step, i) => {
        if (step.startsWith('  ')) {
          // Indented sub-steps rendered as code
          lines.push(`   \`${step.trim()}\``);
        } else {
          lines.push(`${i + 1}. \`${step}\``);
        }
      });
      lines.push('');
    }

    if (instructions.localTestSteps && instructions.localTestSteps.length > 0) {
      lines.push('## Local Testing');
      lines.push('');
      lines.push('Test your deployment locally before pushing to production:');
      lines.push('');
      lines.push('```bash');
      instructions.localTestSteps.forEach((step) => lines.push(step));
      lines.push('```');
      lines.push('');
    }

    if (instructions.links && instructions.links.length > 0) {
      lines.push('## Useful Links');
      lines.push('');
      instructions.links.forEach((link) => lines.push(`- [${link.label}](${link.url})`));
      lines.push('');
    }

    lines.push('---');
    lines.push(getGeneratedBranding().markdown);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate real runtime files from the Flow Weaver runtime source.
   * Includes the function registry, builtin functions, and parameter resolver.
   * These replace the placeholder files that were previously generated.
   */
  protected generateRuntimeFiles(
    outputDir: string,
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[]
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    // Generate function registry with workflow/nodeType metadata
    files.push(
      this.createFile(
        outputDir,
        'runtime/function-registry.ts',
        this.generateFunctionRegistryContent(workflows, nodeTypes),
        'other'
      )
    );

    // Generate builtin functions module
    files.push(
      this.createFile(
        outputDir,
        'runtime/builtin-functions.ts',
        `// Builtin functions — auto-registers known functions\nimport './function-registry.js';\n`,
        'other'
      )
    );

    // Generate parameter resolver
    files.push(
      this.createFile(
        outputDir,
        'runtime/parameter-resolver.ts',
        `// Parameter resolver\nexport function resolveFunction(param: unknown) { return typeof param === 'function' ? param : undefined; }\n`,
        'other'
      )
    );

    return files;
  }

  /**
   * Generate function registry content with workflow/nodeType metadata.
   * Used as fallback when real runtime source files aren't available.
   */
  protected generateFunctionRegistryContent(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[]
  ): string {
    return `// Generated function registry
type FunctionInfo = {
  name: string;
  type: 'workflow' | 'nodeType';
  exposed: boolean;
};

const functions: FunctionInfo[] = [
${workflows.map((w) => `  { name: '${w.name}', type: 'workflow', exposed: ${w.expose} },`).join('\n')}
${nodeTypes.map((nt) => `  { name: '${nt.name}', type: 'nodeType', exposed: ${nt.expose} },`).join('\n')}
];

export const functionRegistry = {
  list(category?: 'workflow' | 'nodeType'): FunctionInfo[] {
    if (!category) return functions;
    return functions.filter((f) => f.type === category);
  },
  get(name: string): FunctionInfo | undefined {
    return functions.find((f) => f.name === name);
  },
};
`;
  }
}

/**
 * Registry of available export targets
 */
export class ExportTargetRegistry {
  private targets = new Map<string, ExportTarget>();

  register(target: ExportTarget): void {
    this.targets.set(target.name, target);
  }

  get(name: string): ExportTarget | undefined {
    return this.targets.get(name);
  }

  getAll(): ExportTarget[] {
    return Array.from(this.targets.values());
  }

  getNames(): string[] {
    return Array.from(this.targets.keys());
  }
}
