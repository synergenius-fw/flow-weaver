/**
 * Schema converter for transforming Flow Weaver schemas to OpenAPI format
 */

import type { TDataType } from '../../ast/types.js';

/**
 * OpenAPI 3.0 Schema Object (simplified)
 */
export interface OpenAPISchema {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  nullable?: boolean;
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  $ref?: string;
  additionalProperties?: boolean | OpenAPISchema;
}

/**
 * Flow Weaver data type to OpenAPI type mapping
 */
const DATA_TYPE_MAP: Record<TDataType, { type: string; format?: string }> = {
  STRING: { type: 'string' },
  NUMBER: { type: 'number' },
  BOOLEAN: { type: 'boolean' },
  OBJECT: { type: 'object' },
  ARRAY: { type: 'array' },
  FUNCTION: { type: 'object', format: 'function' },
  ANY: { type: 'object', format: 'any' },
  STEP: { type: 'boolean', format: 'step' },
};

/**
 * Schema converter class
 */
export class SchemaConverter {
  /**
   * Convert a Flow Weaver data type to OpenAPI schema
   */
  toOpenAPIType(dataType: TDataType): OpenAPISchema {
    const mapping = DATA_TYPE_MAP[dataType];
    if (!mapping) {
      return { type: 'object' };
    }

    const schema: OpenAPISchema = { type: mapping.type };
    if (mapping.format) {
      schema.format = mapping.format;
    }

    return schema;
  }

  /**
   * Convert a Flow Weaver JSON Schema to OpenAPI Schema
   */
  toOpenAPISchema(schema: Record<string, unknown>): OpenAPISchema {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object' };
    }

    const result: OpenAPISchema = {};

    // Copy basic properties
    if (schema.type) {
      result.type = schema.type as string;
    }

    if (schema.description) {
      result.description = schema.description as string;
    }

    if (schema.format) {
      result.format = schema.format as string;
    }

    if (schema.default !== undefined) {
      result.default = schema.default;
    }

    if (schema.enum) {
      result.enum = schema.enum as unknown[];
    }

    // Convert properties recursively
    if (schema.properties) {
      result.properties = {};
      const props = schema.properties as Record<string, unknown>;
      for (const [key, value] of Object.entries(props)) {
        result.properties[key] = this.toOpenAPISchema(value as Record<string, unknown>);
      }
    }

    // Handle required fields
    if (schema.required) {
      result.required = schema.required as string[];
    }

    // Handle array items
    if (schema.items) {
      result.items = this.toOpenAPISchema(schema.items as Record<string, unknown>);
    }

    // Handle additional properties
    if (schema.additionalProperties !== undefined) {
      if (typeof schema.additionalProperties === 'boolean') {
        result.additionalProperties = schema.additionalProperties;
      } else {
        result.additionalProperties = this.toOpenAPISchema(
          schema.additionalProperties as Record<string, unknown>
        );
      }
    }

    // Handle composition keywords
    if (schema.oneOf) {
      result.oneOf = (schema.oneOf as Record<string, unknown>[]).map((s) =>
        this.toOpenAPISchema(s)
      );
    }

    if (schema.anyOf) {
      result.anyOf = (schema.anyOf as Record<string, unknown>[]).map((s) =>
        this.toOpenAPISchema(s)
      );
    }

    if (schema.allOf) {
      result.allOf = (schema.allOf as Record<string, unknown>[]).map((s) =>
        this.toOpenAPISchema(s)
      );
    }

    return result;
  }

  /**
   * Create a schema for workflow error responses
   */
  createErrorSchema(): OpenAPISchema {
    return {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Always false for error responses',
          default: false,
        },
        error: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Error code',
              enum: [
                'WORKFLOW_NOT_FOUND',
                'VALIDATION_ERROR',
                'EXECUTION_ERROR',
                'TIMEOUT',
                'CANCELLED',
                'INTERNAL_ERROR',
              ],
            },
            message: {
              type: 'string',
              description: 'Human-readable error message',
            },
            stack: {
              type: 'string',
              description: 'Stack trace (development only)',
            },
          },
          required: ['code', 'message'],
        },
        executionTime: {
          type: 'number',
          description: 'Execution time in milliseconds',
        },
        requestId: {
          type: 'string',
          description: 'Unique request identifier',
        },
      },
      required: ['success', 'error'],
    };
  }

  /**
   * Create a schema for successful workflow responses
   */
  createSuccessSchema(outputSchema?: OpenAPISchema): OpenAPISchema {
    return {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Always true for successful responses',
          default: true,
        },
        workflow: {
          type: 'string',
          description: 'Name of the executed workflow',
        },
        result: outputSchema || { type: 'object', description: 'Workflow result' },
        executionTime: {
          type: 'number',
          description: 'Execution time in milliseconds',
        },
        trace: {
          type: 'array',
          description: 'Execution trace events (if requested)',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              timestamp: { type: 'number' },
              data: { type: 'object' },
            },
          },
        },
        requestId: {
          type: 'string',
          description: 'Unique request identifier',
        },
      },
      required: ['success', 'workflow', 'executionTime', 'requestId'],
    };
  }
}

/**
 * Singleton instance for convenience
 */
export const schemaConverter = new SchemaConverter();
