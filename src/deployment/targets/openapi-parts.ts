/**
 * The pieces an export target's OpenAPI document is made of: a port's
 * schema, the POST operation that runs a workflow or a node type, and the
 * endpoints every generated service has. `BaseExportTarget` composes them
 * into the node-type, multi-workflow and bundle documents.
 */

/** A port as the export targets describe it. */
export interface OpenApiPort {
  dataType?: string;
  label?: string;
  tsType?: string;
  optional?: boolean;
}

/** The JSON Schema type of each Flow Weaver data type. ANY, and a data type this file does not know, have none. */
const SCHEMA_TYPE: Record<string, string> = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  OBJECT: 'object',
  ARRAY: 'array',
  FUNCTION: 'object',
  STEP: 'boolean',
};

/**
 * The schema of one port. A value of any type carries no `type`: OpenAPI
 * 3.0 has no `any`, and a schema without `type` accepts every value.
 */
function portSchema(name: string, port: OpenApiPort): Record<string, unknown> {
  const type = port.dataType ? SCHEMA_TYPE[port.dataType] : undefined;
  return {
    ...(type && { type }),
    description: port.label || name,
    ...(port.tsType && { 'x-ts-type': port.tsType }),
  };
}

/** The data ports of a node type as schema properties, control ports (STEP) left out, with the names that are required. */
function portProperties(ports: Record<string, OpenApiPort>): { properties: Record<string, object>; required: string[] } {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const [name, port] of Object.entries(ports)) {
    if (port.dataType === 'STEP') continue;
    properties[name] = portSchema(name, port);
    if (!port.optional) required.push(name);
  }
  return { properties, required };
}

const jsonBody = (schema: object) => ({ content: { 'application/json': { schema } } });

/** The POST operation that runs one workflow or node type, with its three responses. */
function executeOperation(op: {
  operationId: string;
  summary: string;
  description: string;
  tag: string;
  /** What the thing is called in the 404 text: "Workflow" or "Node type". */
  subject: string;
  requestDescription: string;
  requestSchema: object;
  resultSchema: object;
}): object {
  return {
    post: {
      operationId: op.operationId,
      summary: op.summary,
      description: op.description,
      tags: [op.tag],
      requestBody: { description: op.requestDescription, required: true, ...jsonBody(op.requestSchema) },
      responses: {
        '200': {
          description: op.subject === 'Workflow' ? 'Successful workflow execution' : 'Successful execution',
          ...jsonBody({
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              result: op.resultSchema,
              executionTime: { type: 'number' },
              requestId: { type: 'string' },
            },
          }),
        },
        '404': {
          description: `${op.subject} not found`,
          ...jsonBody({ type: 'object', properties: { error: { type: 'string' } } }),
        },
        '500': {
          description: 'Execution error',
          ...jsonBody({
            type: 'object',
            properties: { success: { type: 'boolean' }, error: { type: 'string' }, requestId: { type: 'string' } },
          }),
        },
      },
    },
  };
}

/** The POST operation that runs a node type, its request and result built from its ports. */
export function nodeTypeOperation(
  nodeType: { name: string; functionName: string; description?: string; inputs: Record<string, OpenApiPort>; outputs: Record<string, OpenApiPort> },
  operationId: string,
): object {
  const inputs = portProperties(nodeType.inputs);
  const outputs = portProperties(nodeType.outputs);
  return executeOperation({
    operationId,
    summary: `Execute ${nodeType.name}`,
    description: nodeType.description || `Execute the ${nodeType.name} node type function`,
    tag: 'node-types',
    subject: 'Node type',
    requestDescription: 'Node type input parameters',
    requestSchema: {
      type: 'object',
      properties: inputs.properties,
      required: inputs.required.length > 0 ? inputs.required : undefined,
    },
    resultSchema: { type: 'object', properties: outputs.properties },
  });
}

/** The POST operation that runs a workflow; its parameters are the workflow's own. */
export function workflowOperation(
  workflow: { name: string; functionName: string; description?: string },
  operationId: string,
  parametersDescription: string,
): object {
  return executeOperation({
    operationId,
    summary: `Execute ${workflow.name} workflow`,
    description: workflow.description || `Execute the ${workflow.name} workflow`,
    tag: 'workflows',
    subject: 'Workflow',
    requestDescription: 'Workflow input parameters',
    requestSchema: { type: 'object', description: parametersDescription, additionalProperties: true },
    resultSchema: { type: 'object' },
  });
}

const FUNCTION_CATEGORIES = ['transform', 'filter', 'validate', 'format', 'custom'];

/** `GET /api/functions`: the registered functions a workflow parameter can name. */
export function functionsEndpoint(): object {
  return {
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
          schema: { type: 'string', enum: FUNCTION_CATEGORIES },
          description: 'Filter by function category',
        },
      ],
      responses: {
        '200': {
          description: 'List of registered functions',
          ...jsonBody({
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', example: 'string:uppercase' },
                name: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string', enum: FUNCTION_CATEGORIES },
                inputType: { type: 'string' },
                outputType: { type: 'string' },
              },
            },
          }),
        },
      },
    },
  };
}

/** `GET /api/openapi.json`: the document itself. */
export function specEndpoint(): object {
  return {
    get: {
      operationId: 'get_openapi',
      summary: 'OpenAPI Specification',
      description: 'Returns this OpenAPI 3.0 specification',
      tags: ['documentation'],
      responses: { '200': { description: 'OpenAPI specification', content: { 'application/json': {} } } },
    },
  };
}

/** A function parameter: a registry ID, or one with arguments bound in advance. */
export const FUNCTION_REFERENCE_SCHEMA = {
  oneOf: [
    { type: 'string', description: 'Registry function ID (e.g., "string:uppercase")' },
    {
      type: 'object',
      properties: {
        registryId: { type: 'string', description: 'Registry function ID' },
        partialArgs: { type: 'object', description: 'Pre-bound arguments', additionalProperties: true },
      },
      required: ['registryId'],
    },
  ],
  description: 'Function parameter - can be a registry ID or object with partial arguments',
};

/** The tags the generated documents use, by name. */
export const TAGS = {
  workflows: { name: 'workflows', description: 'Workflow execution endpoints' },
  nodeTypes: { name: 'node-types', description: 'Node type execution endpoints' },
  functions: { name: 'functions', description: 'Function registry endpoints' },
  documentation: { name: 'documentation', description: 'API documentation' },
} as const;

/**
 * The document around the paths. It is a deep copy, so the constants above
 * are never shared with a caller that edits what it is given.
 */
export function openApiDocument(opts: {
  title: string;
  version: string;
  baseUrl?: string;
  description: string;
  paths: Record<string, object>;
  tags: ReadonlyArray<{ name: string; description: string }>;
  components?: object;
}): object {
  return structuredClone({
    openapi: '3.0.3',
    info: { title: opts.title, version: opts.version, description: opts.description },
    servers: [{ url: opts.baseUrl || '/', description: 'Current deployment' }],
    paths: opts.paths,
    tags: opts.tags,
    ...(opts.components && { components: opts.components }),
  });
}
