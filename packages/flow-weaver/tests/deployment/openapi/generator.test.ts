/**
 * Tests for OpenAPI generator
 */

import { describe, it, expect } from 'vitest';
import { OpenAPIGenerator, generateOpenAPIJson } from '../../../src/deployment/openapi/generator';
import type { WorkflowEndpoint } from '../../../src/server/types';

describe('OpenAPIGenerator', () => {
  const sampleEndpoints: WorkflowEndpoint[] = [
    {
      name: 'calculator',
      functionName: 'calculator',
      filePath: '/path/to/calculator.ts',
      method: 'POST',
      path: '/workflows/calculator',
      description: 'A simple calculator workflow',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          result: { type: 'number', description: 'Sum result' },
        },
      },
    },
    {
      name: 'greeter',
      functionName: 'greeter',
      filePath: '/path/to/greeter.ts',
      method: 'POST',
      path: '/workflows/greeter',
      description: 'Greets a user',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  ];

  describe('generate', () => {
    it('should generate valid OpenAPI document', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      expect(doc.openapi).toBe('3.0.3');
      expect(doc.info.title).toBe('Test API');
      expect(doc.info.version).toBe('1.0.0');
    });

    it('should include description when provided', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
        description: 'Test description',
      });

      expect(doc.info.description).toBe('Test description');
    });

    it('should include servers when provided', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
        servers: [{ url: 'https://api.example.com', description: 'Production' }],
      });

      expect(doc.servers).toHaveLength(1);
      expect(doc.servers?.[0].url).toBe('https://api.example.com');
    });

    it('should generate paths for all endpoints', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      expect(doc.paths['/workflows/calculator']).toBeDefined();
      expect(doc.paths['/workflows/greeter']).toBeDefined();
    });

    it('should include system endpoints', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      expect(doc.paths['/health']).toBeDefined();
      expect(doc.paths['/workflows']).toBeDefined();
    });

    it('should generate correct operation for workflow', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      const operation = doc.paths['/workflows/calculator'].post;
      expect(operation).toBeDefined();
      expect(operation?.operationId).toBe('execute_calculator');
      expect(operation?.summary).toContain('calculator');
      expect(operation?.description).toContain('calculator');
      expect(operation?.tags).toContain('workflows');
    });

    it('should include request body schema', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      const operation = doc.paths['/workflows/calculator'].post;
      const requestBody = operation?.requestBody;

      expect(requestBody).toBeDefined();
      expect(requestBody?.required).toBe(true);
      expect(requestBody?.content['application/json']).toBeDefined();

      const schema = requestBody?.content['application/json'].schema;
      expect(schema?.properties?.a).toBeDefined();
      expect(schema?.properties?.b).toBeDefined();
    });

    it('should include response schemas', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      const operation = doc.paths['/workflows/calculator'].post;

      expect(operation?.responses['200']).toBeDefined();
      expect(operation?.responses['400']).toBeDefined();
      expect(operation?.responses['404']).toBeDefined();
      expect(operation?.responses['500']).toBeDefined();
    });

    it('should include trace query parameter', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      const operation = doc.paths['/workflows/calculator'].post;
      const traceParam = operation?.parameters?.find((p) => p.name === 'trace');

      expect(traceParam).toBeDefined();
      expect(traceParam?.in).toBe('query');
      expect(traceParam?.schema?.type).toBe('boolean');
    });

    it('should include component schemas', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      expect(doc.components?.schemas?.Error).toBeDefined();
      expect(doc.components?.schemas?.TraceEvent).toBeDefined();
    });

    it('should include tags', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      expect(doc.tags).toBeDefined();
      expect(doc.tags?.some((t) => t.name === 'workflows')).toBe(true);
      expect(doc.tags?.some((t) => t.name === 'system')).toBe(true);
    });
  });

  describe('generateOpenAPIJson', () => {
    it('should generate valid JSON string', () => {
      const json = generateOpenAPIJson(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      const parsed = JSON.parse(json);
      expect(parsed.openapi).toBe('3.0.3');
      expect(parsed.info.title).toBe('Test API');
    });

    it('should be pretty-printed', () => {
      const json = generateOpenAPIJson(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      // Pretty-printed JSON should have newlines
      expect(json.includes('\n')).toBe(true);
    });
  });

  describe('health endpoint', () => {
    it('should have correct schema', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], {
        title: 'Test API',
        version: '1.0.0',
      });

      const healthPath = doc.paths['/health'];
      expect(healthPath.get).toBeDefined();
      expect(healthPath.get?.tags).toContain('system');

      const response = healthPath.get?.responses['200'];
      const schema = response?.content?.['application/json']?.schema;

      expect(schema?.properties?.status).toBeDefined();
      expect(schema?.properties?.timestamp).toBeDefined();
      expect(schema?.properties?.workflows).toBeDefined();
    });
  });

  describe('workflows list endpoint', () => {
    it('should have correct schema', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], {
        title: 'Test API',
        version: '1.0.0',
      });

      const listPath = doc.paths['/workflows'];
      expect(listPath.get).toBeDefined();
      expect(listPath.get?.tags).toContain('system');

      const response = listPath.get?.responses['200'];
      const schema = response?.content?.['application/json']?.schema;

      expect(schema?.properties?.count).toBeDefined();
      expect(schema?.properties?.workflows).toBeDefined();
      expect(schema?.properties?.workflows?.type).toBe('array');
    });
  });
});
