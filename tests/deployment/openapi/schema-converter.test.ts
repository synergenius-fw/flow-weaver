/**
 * Tests for the OpenAPI schema converter
 *
 * Covers conversion from Flow Weaver data types and JSON Schema
 * to OpenAPI 3.0 schema format, plus the error/success schema generators.
 */

import { describe, it, expect } from 'vitest';
import { SchemaConverter, schemaConverter } from '../../../src/deployment/openapi/schema-converter.js';
import type { TDataType } from '../../../src/ast/types.js';

describe('SchemaConverter', () => {
  describe('toOpenAPIType', () => {
    it('should convert STRING to string', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('STRING');
      expect(result).toEqual({ type: 'string' });
    });

    it('should convert NUMBER to number', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('NUMBER');
      expect(result).toEqual({ type: 'number' });
    });

    it('should convert BOOLEAN to boolean', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('BOOLEAN');
      expect(result).toEqual({ type: 'boolean' });
    });

    it('should convert OBJECT to object', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('OBJECT');
      expect(result).toEqual({ type: 'object' });
    });

    it('should convert ARRAY to array', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('ARRAY');
      expect(result).toEqual({ type: 'array' });
    });

    it('should convert FUNCTION to object with format', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('FUNCTION');
      expect(result.type).toBe('object');
      expect(result.format).toBe('function');
    });

    it('should convert ANY to object with format', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('ANY');
      expect(result.type).toBe('object');
      expect(result.format).toBe('any');
    });

    it('should convert STEP to boolean with format', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('STEP');
      expect(result.type).toBe('boolean');
      expect(result.format).toBe('step');
    });

    it('should fall back to object for unknown types', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPIType('UNKNOWN_TYPE' as TDataType);
      expect(result).toEqual({ type: 'object' });
    });
  });

  describe('toOpenAPISchema', () => {
    it('should return object type for null/undefined input', () => {
      const converter = new SchemaConverter();
      expect(converter.toOpenAPISchema(null as any)).toEqual({ type: 'object' });
      expect(converter.toOpenAPISchema(undefined as any)).toEqual({ type: 'object' });
    });

    it('should return object type for non-object input', () => {
      const converter = new SchemaConverter();
      expect(converter.toOpenAPISchema('string' as any)).toEqual({ type: 'object' });
    });

    it('should copy basic type property', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({ type: 'string' });
      expect(result.type).toBe('string');
    });

    it('should copy description', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({ type: 'string', description: 'A name field' });
      expect(result.description).toBe('A name field');
    });

    it('should copy format', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({ type: 'string', format: 'date-time' });
      expect(result.format).toBe('date-time');
    });

    it('should copy default value', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({ type: 'number', default: 42 });
      expect(result.default).toBe(42);
    });

    it('should copy enum values', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({ type: 'string', enum: ['a', 'b', 'c'] });
      expect(result.enum).toEqual(['a', 'b', 'c']);
    });

    it('should convert properties recursively', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'number' },
        },
      });

      expect(result.properties?.name).toEqual({ type: 'string', description: 'User name' });
      expect(result.properties?.age).toEqual({ type: 'number' });
    });

    it('should copy required fields', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        type: 'object',
        required: ['name', 'email'],
      });
      expect(result.required).toEqual(['name', 'email']);
    });

    it('should convert array items recursively', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        type: 'array',
        items: { type: 'string' },
      });
      expect(result.items).toEqual({ type: 'string' });
    });

    it('should handle additionalProperties as boolean', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        type: 'object',
        additionalProperties: true,
      });
      expect(result.additionalProperties).toBe(true);
    });

    it('should handle additionalProperties as false', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        type: 'object',
        additionalProperties: false,
      });
      expect(result.additionalProperties).toBe(false);
    });

    it('should convert additionalProperties as schema', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        type: 'object',
        additionalProperties: { type: 'string' },
      });
      expect(result.additionalProperties).toEqual({ type: 'string' });
    });

    it('should convert oneOf schemas', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        oneOf: [{ type: 'string' }, { type: 'number' }],
      });
      expect(result.oneOf).toEqual([{ type: 'string' }, { type: 'number' }]);
    });

    it('should convert anyOf schemas', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        anyOf: [{ type: 'string' }, { type: 'boolean' }],
      });
      expect(result.anyOf).toEqual([{ type: 'string' }, { type: 'boolean' }]);
    });

    it('should convert allOf schemas', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
      });
      expect(result.allOf).toHaveLength(2);
      expect(result.allOf?.[0].properties?.a).toEqual({ type: 'string' });
      expect(result.allOf?.[1].properties?.b).toEqual({ type: 'number' });
    });

    it('should handle deeply nested schemas', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: {
              deep: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      });

      expect(result.properties?.nested?.properties?.deep?.items).toEqual({ type: 'string' });
    });

    it('should handle empty properties object', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({
        type: 'object',
        properties: {},
      });
      expect(result.properties).toEqual({});
    });

    it('should return empty schema for empty input object', () => {
      const converter = new SchemaConverter();
      const result = converter.toOpenAPISchema({});
      expect(result).toEqual({});
    });
  });

  describe('createErrorSchema', () => {
    it('should return a well-structured error schema', () => {
      const converter = new SchemaConverter();
      const schema = converter.createErrorSchema();

      expect(schema.type).toBe('object');
      expect(schema.properties?.success).toBeDefined();
      expect(schema.properties?.success?.default).toBe(false);
      expect(schema.properties?.error).toBeDefined();
      expect(schema.properties?.executionTime).toBeDefined();
      expect(schema.properties?.requestId).toBeDefined();
      expect(schema.required).toContain('success');
      expect(schema.required).toContain('error');
    });

    it('should define error code enum with all known codes', () => {
      const converter = new SchemaConverter();
      const schema = converter.createErrorSchema();
      const codeEnum = schema.properties?.error?.properties?.code?.enum as string[];

      expect(codeEnum).toContain('WORKFLOW_NOT_FOUND');
      expect(codeEnum).toContain('VALIDATION_ERROR');
      expect(codeEnum).toContain('EXECUTION_ERROR');
      expect(codeEnum).toContain('TIMEOUT');
      expect(codeEnum).toContain('CANCELLED');
      expect(codeEnum).toContain('INTERNAL_ERROR');
      expect(codeEnum).toHaveLength(6);
    });

    it('should require code and message in the error sub-object', () => {
      const converter = new SchemaConverter();
      const schema = converter.createErrorSchema();
      const errorObj = schema.properties?.error;

      expect(errorObj?.required).toContain('code');
      expect(errorObj?.required).toContain('message');
    });

    it('should include optional stack field', () => {
      const converter = new SchemaConverter();
      const schema = converter.createErrorSchema();
      const stackProp = schema.properties?.error?.properties?.stack;

      expect(stackProp).toBeDefined();
      expect(stackProp?.type).toBe('string');
    });
  });

  describe('createSuccessSchema', () => {
    it('should return a well-structured success schema', () => {
      const converter = new SchemaConverter();
      const schema = converter.createSuccessSchema();

      expect(schema.type).toBe('object');
      expect(schema.properties?.success).toBeDefined();
      expect(schema.properties?.success?.default).toBe(true);
      expect(schema.properties?.workflow).toBeDefined();
      expect(schema.properties?.result).toBeDefined();
      expect(schema.properties?.executionTime).toBeDefined();
      expect(schema.properties?.trace).toBeDefined();
      expect(schema.properties?.requestId).toBeDefined();
    });

    it('should mark success, workflow, executionTime, requestId as required', () => {
      const converter = new SchemaConverter();
      const schema = converter.createSuccessSchema();

      expect(schema.required).toContain('success');
      expect(schema.required).toContain('workflow');
      expect(schema.required).toContain('executionTime');
      expect(schema.required).toContain('requestId');
    });

    it('should use provided output schema for result field', () => {
      const converter = new SchemaConverter();
      const outputSchema = {
        type: 'object' as const,
        properties: {
          sum: { type: 'number' as const, description: 'The sum' },
        },
      };

      const schema = converter.createSuccessSchema(outputSchema);

      expect(schema.properties?.result).toBe(outputSchema);
    });

    it('should use generic object for result when no output schema provided', () => {
      const converter = new SchemaConverter();
      const schema = converter.createSuccessSchema();

      expect(schema.properties?.result?.type).toBe('object');
      expect(schema.properties?.result?.description).toContain('result');
    });

    it('should define trace as array of trace event objects', () => {
      const converter = new SchemaConverter();
      const schema = converter.createSuccessSchema();
      const trace = schema.properties?.trace;

      expect(trace?.type).toBe('array');
      expect(trace?.items?.properties?.type?.type).toBe('string');
      expect(trace?.items?.properties?.timestamp?.type).toBe('number');
      expect(trace?.items?.properties?.data?.type).toBe('object');
    });
  });

  describe('singleton instance', () => {
    it('should export a pre-created singleton', () => {
      expect(schemaConverter).toBeInstanceOf(SchemaConverter);
    });

    it('should work the same as a new instance', () => {
      const fresh = new SchemaConverter();
      const singletonResult = schemaConverter.toOpenAPIType('STRING');
      const freshResult = fresh.toOpenAPIType('STRING');
      expect(singletonResult).toEqual(freshResult);
    });
  });
});
