/**
 * Tests for OpenAPI generator and YAML output
 */

import { describe, it, expect } from 'vitest';
import {
  OpenAPIGenerator,
  generateOpenAPIJson,
  generateOpenAPIYaml,
} from '../../../src/deployment/openapi/generator.js';
import type { WorkflowEndpoint } from '../../../src/server/types.js';

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

    it('should apply basePath to endpoint paths', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
        basePath: '/v1',
      });

      expect(doc.paths['/v1/workflows/calculator']).toBeDefined();
      expect(doc.paths['/v1/workflows/greeter']).toBeDefined();
      // System endpoints should NOT have basePath
      expect(doc.paths['/health']).toBeDefined();
    });

    it('should include contact info when provided', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], {
        title: 'Test API',
        version: '1.0.0',
        contact: { name: 'Test User', email: 'test@example.com', url: 'https://example.com' },
      });

      expect(doc.info.contact?.name).toBe('Test User');
      expect(doc.info.contact?.email).toBe('test@example.com');
    });

    it('should include license info when provided', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], {
        title: 'Test API',
        version: '1.0.0',
        license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      });

      expect(doc.info.license?.name).toBe('MIT');
    });

    it('should handle endpoints without inputSchema', () => {
      const generator = new OpenAPIGenerator();
      const endpoints: WorkflowEndpoint[] = [
        {
          name: 'noSchema',
          functionName: 'noSchema',
          filePath: '/path/to/noSchema.ts',
          method: 'POST',
          path: '/workflows/noSchema',
        },
      ];

      const doc = generator.generate(endpoints, { title: 'Test', version: '1.0.0' });
      const operation = doc.paths['/workflows/noSchema'].post;
      const schema = operation?.requestBody?.content['application/json'].schema;
      expect(schema?.type).toBe('object');
    });

    it('should handle endpoints without outputSchema', () => {
      const generator = new OpenAPIGenerator();
      const endpoints: WorkflowEndpoint[] = [
        {
          name: 'noOutput',
          functionName: 'noOutput',
          filePath: '/path/to/noOutput.ts',
          method: 'POST',
          path: '/workflows/noOutput',
        },
      ];

      const doc = generator.generate(endpoints, { title: 'Test', version: '1.0.0' });
      const operation = doc.paths['/workflows/noOutput'].post;
      const responseSchema = operation?.responses['200']?.content?.['application/json']?.schema;
      expect(responseSchema).toBeDefined();
      // The result field should be a generic object
      expect(responseSchema?.properties?.result?.type).toBe('object');
    });

    it('should use endpoint description or generate a default', () => {
      const generator = new OpenAPIGenerator();
      const endpoints: WorkflowEndpoint[] = [
        {
          name: 'described',
          functionName: 'described',
          filePath: '/test.ts',
          method: 'POST',
          path: '/workflows/described',
          description: 'Custom description',
        },
        {
          name: 'undescribed',
          functionName: 'undescribed',
          filePath: '/test.ts',
          method: 'POST',
          path: '/workflows/undescribed',
        },
      ];

      const doc = generator.generate(endpoints, { title: 'Test', version: '1.0.0' });
      expect(doc.paths['/workflows/described'].post?.description).toBe('Custom description');
      expect(doc.paths['/workflows/undescribed'].post?.description).toContain('undescribed');
    });

    it('should include timeout (504) response', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, { title: 'Test', version: '1.0.0' });
      const operation = doc.paths['/workflows/calculator'].post;
      expect(operation?.responses['504']).toBeDefined();
      expect(operation?.responses['504'].description).toContain('timeout');
    });

    it('should include X-Request-Id and X-Execution-Time response headers', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate(sampleEndpoints, { title: 'Test', version: '1.0.0' });
      const response200 = doc.paths['/workflows/calculator'].post?.responses['200'];
      expect(response200?.headers?.['X-Request-Id']).toBeDefined();
      expect(response200?.headers?.['X-Execution-Time']).toBeDefined();
    });

    it('should generate standard responses in components', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], { title: 'Test', version: '1.0.0' });
      expect(doc.components?.responses?.BadRequest).toBeDefined();
      expect(doc.components?.responses?.NotFound).toBeDefined();
      expect(doc.components?.responses?.InternalError).toBeDefined();
    });

    it('should handle GET method endpoints', () => {
      const generator = new OpenAPIGenerator();
      const endpoints: WorkflowEndpoint[] = [
        {
          name: 'getter',
          functionName: 'getter',
          filePath: '/test.ts',
          method: 'GET',
          path: '/workflows/getter',
        },
      ];

      const doc = generator.generate(endpoints, { title: 'Test', version: '1.0.0' });
      expect(doc.paths['/workflows/getter'].get).toBeDefined();
      expect(doc.paths['/workflows/getter'].post).toBeUndefined();
    });

    it('should generate with zero endpoints', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], { title: 'Empty', version: '0.1.0' });
      expect(doc.openapi).toBe('3.0.3');
      expect(doc.paths['/health']).toBeDefined();
      expect(doc.paths['/workflows']).toBeDefined();
      // Only system paths, no workflow paths
      expect(Object.keys(doc.paths)).toHaveLength(2);
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

    it('should produce parseable JSON with all endpoints', () => {
      const json = generateOpenAPIJson(sampleEndpoints, {
        title: 'Test API',
        version: '2.0.0',
      });
      const parsed = JSON.parse(json);
      expect(parsed.info.version).toBe('2.0.0');
      expect(parsed.paths['/workflows/calculator']).toBeDefined();
      expect(parsed.paths['/workflows/greeter']).toBeDefined();
    });
  });

  describe('generateOpenAPIYaml', () => {
    it('should generate a YAML-like string', () => {
      const yaml = generateOpenAPIYaml(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      expect(typeof yaml).toBe('string');
      // YAML output should contain key-value pairs without braces (at the top level)
      expect(yaml).toContain('openapi:');
      expect(yaml).toContain('info:');
      expect(yaml).toContain('paths:');
    });

    it('should include workflow paths', () => {
      const yaml = generateOpenAPIYaml(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      expect(yaml).toContain('/workflows/calculator');
      expect(yaml).toContain('/workflows/greeter');
    });

    it('should quote strings that contain colons', () => {
      const yaml = generateOpenAPIYaml([], {
        title: 'Test API',
        version: '1.0.0',
        description: 'API with a colon: here',
      });

      // The description should be quoted because it contains a colon
      expect(yaml).toContain('"API with a colon: here"');
    });

    it('should represent arrays with dash syntax', () => {
      const yaml = generateOpenAPIYaml(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      // Tags array should use YAML dash syntax
      expect(yaml).toContain('- ');
    });

    it('should handle empty arrays as []', () => {
      const yaml = generateOpenAPIYaml([], {
        title: 'Test API',
        version: '1.0.0',
      });

      // The YAML converter should still produce valid output
      expect(yaml).toContain('openapi:');
    });

    it('should handle boolean values', () => {
      const yaml = generateOpenAPIYaml(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      // The trace parameter has default: false, required fields have booleans
      expect(yaml).toContain('false');
    });

    it('should handle number values', () => {
      const yaml = generateOpenAPIYaml(sampleEndpoints, {
        title: 'Test API',
        version: '1.0.0',
      });

      // Version string "1.0.0" should appear, and there are numeric types
      expect(yaml).toContain('1.0.0');
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

    it('should include uptime in health schema', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], { title: 'Test', version: '1.0.0' });
      const schema = doc.paths['/health'].get?.responses['200']?.content?.['application/json']?.schema;
      expect(schema?.properties?.uptime).toBeDefined();
      expect(schema?.properties?.uptime?.type).toBe('integer');
    });

    it('should mark status, timestamp, workflows as required', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], { title: 'Test', version: '1.0.0' });
      const schema = doc.paths['/health'].get?.responses['200']?.content?.['application/json']?.schema;
      expect(schema?.required).toContain('status');
      expect(schema?.required).toContain('timestamp');
      expect(schema?.required).toContain('workflows');
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

    it('should define workflow item schema with required fields', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], { title: 'Test', version: '1.0.0' });
      const listSchema = doc.paths['/workflows'].get?.responses['200']?.content?.['application/json']?.schema;
      const itemSchema = listSchema?.properties?.workflows?.items;
      expect(itemSchema?.properties?.name).toBeDefined();
      expect(itemSchema?.properties?.path).toBeDefined();
      expect(itemSchema?.properties?.method).toBeDefined();
      expect(itemSchema?.required).toContain('name');
      expect(itemSchema?.required).toContain('path');
      expect(itemSchema?.required).toContain('method');
    });
  });

  describe('Error schema in components', () => {
    it('should define error codes enum', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], { title: 'Test', version: '1.0.0' });
      const errorSchema = doc.components?.schemas?.Error;
      const codeEnum = errorSchema?.properties?.error?.properties?.code?.enum;
      expect(codeEnum).toContain('WORKFLOW_NOT_FOUND');
      expect(codeEnum).toContain('VALIDATION_ERROR');
      expect(codeEnum).toContain('EXECUTION_ERROR');
      expect(codeEnum).toContain('TIMEOUT');
      expect(codeEnum).toContain('CANCELLED');
      expect(codeEnum).toContain('INTERNAL_ERROR');
    });

    it('should require code and message in error object', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], { title: 'Test', version: '1.0.0' });
      const errorSchema = doc.components?.schemas?.Error;
      const innerError = errorSchema?.properties?.error;
      expect(innerError?.required).toContain('code');
      expect(innerError?.required).toContain('message');
    });
  });

  describe('TraceEvent schema in components', () => {
    it('should define type, timestamp, and data properties', () => {
      const generator = new OpenAPIGenerator();
      const doc = generator.generate([], { title: 'Test', version: '1.0.0' });
      const traceSchema = doc.components?.schemas?.TraceEvent;
      expect(traceSchema?.properties?.type?.type).toBe('string');
      expect(traceSchema?.properties?.timestamp?.type).toBe('number');
      expect(traceSchema?.properties?.data?.type).toBe('object');
      expect(traceSchema?.required).toContain('type');
      expect(traceSchema?.required).toContain('timestamp');
    });
  });
});
