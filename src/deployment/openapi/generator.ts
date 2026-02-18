/**
 * OpenAPI specification generator
 *
 * Generates OpenAPI 3.0 specifications from workflow endpoints.
 */

import type { WorkflowEndpoint } from '../../server/types.js';
import { SchemaConverter, type OpenAPISchema } from './schema-converter.js';

/**
 * OpenAPI 3.0 Document (simplified)
 */
export interface OpenAPIDocument {
  openapi: string;
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  paths: Record<string, OpenAPIPathItem>;
  components?: {
    schemas?: Record<string, OpenAPISchema>;
    responses?: Record<string, OpenAPIResponse>;
    parameters?: Record<string, OpenAPIParameter>;
  };
  tags?: OpenAPITag[];
}

export interface OpenAPIInfo {
  title: string;
  description?: string;
  version: string;
  contact?: {
    name?: string;
    url?: string;
    email?: string;
  };
  license?: {
    name: string;
    url?: string;
  };
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPIPathItem {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  summary?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: Record<string, OpenAPIResponse>;
}

export interface OpenAPIParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: OpenAPISchema;
}

export interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, { schema: OpenAPISchema }>;
}

export interface OpenAPIResponse {
  description: string;
  content?: Record<string, { schema: OpenAPISchema }>;
  headers?: Record<string, { schema: OpenAPISchema; description?: string }>;
}

export interface OpenAPITag {
  name: string;
  description?: string;
}

/**
 * Options for generating OpenAPI specification
 */
export interface GeneratorOptions {
  /** API title */
  title: string;
  /** API version */
  version: string;
  /** API description */
  description?: string;
  /** Server URLs */
  servers?: OpenAPIServer[];
  /** Contact information */
  contact?: OpenAPIInfo['contact'];
  /** License information */
  license?: OpenAPIInfo['license'];
  /** Base path for all endpoints */
  basePath?: string;
}

/**
 * OpenAPI specification generator
 */
export class OpenAPIGenerator {
  private schemaConverter: SchemaConverter;

  constructor() {
    this.schemaConverter = new SchemaConverter();
  }

  /**
   * Generate OpenAPI specification from workflow endpoints
   */
  generate(endpoints: WorkflowEndpoint[], options: GeneratorOptions): OpenAPIDocument {
    const doc: OpenAPIDocument = {
      openapi: '3.0.3',
      info: {
        title: options.title,
        version: options.version,
        description: options.description,
        contact: options.contact,
        license: options.license,
      },
      servers: options.servers,
      paths: {},
      components: {
        schemas: this.generateComponentSchemas(),
        responses: this.generateStandardResponses(),
      },
      tags: [
        {
          name: 'workflows',
          description: 'Workflow execution endpoints',
        },
        {
          name: 'system',
          description: 'System and health check endpoints',
        },
      ],
    };

    // Add standard system endpoints
    doc.paths['/health'] = this.generateHealthEndpoint();
    doc.paths['/workflows'] = this.generateListEndpoint();

    // Add workflow endpoints
    for (const endpoint of endpoints) {
      const path = options.basePath ? `${options.basePath}${endpoint.path}` : endpoint.path;

      doc.paths[path] = this.generateWorkflowEndpoint(endpoint);
    }

    return doc;
  }

  /**
   * Generate path item for a workflow endpoint
   */
  private generateWorkflowEndpoint(endpoint: WorkflowEndpoint): OpenAPIPathItem {
    const operation: OpenAPIOperation = {
      operationId: `execute_${endpoint.name}`,
      summary: `Execute ${endpoint.name} workflow`,
      description: endpoint.description || `Execute the ${endpoint.name} workflow`,
      tags: ['workflows'],
      parameters: [
        {
          name: 'trace',
          in: 'query',
          description: 'Include execution trace events in response',
          required: false,
          schema: { type: 'boolean', default: false },
        },
      ],
      requestBody: {
        description: 'Workflow input parameters',
        required: true,
        content: {
          'application/json': {
            schema: endpoint.inputSchema
              ? this.schemaConverter.toOpenAPISchema(endpoint.inputSchema)
              : { type: 'object' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Successful workflow execution',
          content: {
            'application/json': {
              schema: this.schemaConverter.createSuccessSchema(
                endpoint.outputSchema
                  ? this.schemaConverter.toOpenAPISchema(endpoint.outputSchema)
                  : undefined
              ),
            },
          },
          headers: {
            'X-Request-Id': {
              schema: { type: 'string' },
              description: 'Unique request identifier',
            },
            'X-Execution-Time': {
              schema: { type: 'string' },
              description: 'Execution time in milliseconds',
            },
          },
        },
        '400': {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        '404': {
          description: 'Workflow not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        '500': {
          description: 'Execution error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        '504': {
          description: 'Execution timeout',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    };

    return {
      [endpoint.method.toLowerCase()]: operation,
    } as OpenAPIPathItem;
  }

  /**
   * Generate health endpoint
   */
  private generateHealthEndpoint(): OpenAPIPathItem {
    return {
      get: {
        operationId: 'health_check',
        summary: 'Health check',
        description: 'Check server health and get basic status information',
        tags: ['system'],
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['ok', 'error'],
                    },
                    timestamp: {
                      type: 'string',
                      format: 'date-time',
                    },
                    workflows: {
                      type: 'integer',
                      description: 'Number of registered workflows',
                    },
                    uptime: {
                      type: 'integer',
                      description: 'Server uptime in seconds',
                    },
                  },
                  required: ['status', 'timestamp', 'workflows'],
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Generate workflow list endpoint
   */
  private generateListEndpoint(): OpenAPIPathItem {
    return {
      get: {
        operationId: 'list_workflows',
        summary: 'List all workflows',
        description: 'Get a list of all registered workflows with their metadata',
        tags: ['system'],
        responses: {
          '200': {
            description: 'List of workflows',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: {
                      type: 'integer',
                      description: 'Total number of workflows',
                    },
                    workflows: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          path: { type: 'string' },
                          method: { type: 'string' },
                          description: { type: 'string' },
                          inputSchema: { type: 'object' },
                          outputSchema: { type: 'object' },
                        },
                        required: ['name', 'path', 'method'],
                      },
                    },
                  },
                  required: ['count', 'workflows'],
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Generate component schemas
   */
  private generateComponentSchemas(): Record<string, OpenAPISchema> {
    return {
      Error: this.schemaConverter.createErrorSchema(),
      TraceEvent: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Event type' },
          timestamp: { type: 'number', description: 'Unix timestamp' },
          data: { type: 'object', description: 'Event data' },
        },
        required: ['type', 'timestamp'],
      },
    };
  }

  /**
   * Generate standard responses
   */
  private generateStandardResponses(): Record<string, OpenAPIResponse> {
    return {
      BadRequest: {
        description: 'Bad request - validation failed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      InternalError: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
    };
  }
}

/**
 * Generate OpenAPI specification as JSON string
 */
export function generateOpenAPIJson(
  endpoints: WorkflowEndpoint[],
  options: GeneratorOptions
): string {
  const generator = new OpenAPIGenerator();
  const doc = generator.generate(endpoints, options);
  return JSON.stringify(doc, null, 2);
}

/**
 * Generate OpenAPI specification as YAML string
 */
export function generateOpenAPIYaml(
  endpoints: WorkflowEndpoint[],
  options: GeneratorOptions
): string {
  const generator = new OpenAPIGenerator();
  const doc = generator.generate(endpoints, options);

  // Simple JSON to YAML conversion (for basic cases)
  // For production, use a proper YAML library
  return jsonToYaml(doc);
}

/**
 * Simple JSON to YAML converter
 */
function jsonToYaml(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (obj === null || obj === undefined) {
    return 'null';
  }

  if (typeof obj === 'string') {
    // Quote strings that need it
    if (
      obj.includes('\n') ||
      obj.includes(':') ||
      obj.includes('#') ||
      obj.startsWith(' ') ||
      obj.endsWith(' ')
    ) {
      return `"${obj.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return obj;
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map((item) => `${spaces}- ${jsonToYaml(item, indent + 1).trimStart()}`).join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';

    return entries
      .map(([key, value]) => {
        const valueStr = jsonToYaml(value, indent + 1);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        if (Array.isArray(value)) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr}`;
      })
      .join('\n');
  }

  return String(obj);
}
