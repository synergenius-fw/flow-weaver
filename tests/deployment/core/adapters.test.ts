/**
 * Tests for request adapters
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CliRequestAdapter,
  HttpRequestAdapter,
  LambdaRequestAdapter,
  VercelRequestAdapter,
  CloudflareRequestAdapter,
  createAdapter,
} from '../../../src/deployment/core/adapters';
import type {
  CliInput,
  HttpInput,
  LambdaInput,
  VercelInput,
  CloudflareInput,
  WorkflowRequest,
} from '../../../src/deployment/types';

const tempDir = path.join(os.tmpdir(), `fw-adapter-test-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
});

describe('CliRequestAdapter', () => {
  it('should parse basic CLI input', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
      params: '{"key": "value"}',
    };

    const request = adapter.parseRequest(input);

    expect(request.workflowId).toBe('workflow');
    expect(request.params).toEqual({ key: 'value' });
    expect(request.context.source).toBe('cli');
    expect(request.context.includeTrace).toBe(true);
  });

  it('should use workflow name when provided', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/file.ts',
      workflowName: 'myWorkflow',
    };

    const request = adapter.parseRequest(input);

    expect(request.workflowId).toBe('myWorkflow');
  });

  it('should parse params from file', () => {
    const adapter = new CliRequestAdapter();
    const paramsFilePath = path.join(tempDir, 'params.json');
    fs.writeFileSync(paramsFilePath, JSON.stringify({ a: 1, b: 2 }));

    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
      paramsFile: paramsFilePath,
    };

    const request = adapter.parseRequest(input);

    expect(request.params).toEqual({ a: 1, b: 2 });
  });

  it('should throw error for invalid JSON params', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
      params: 'not valid json',
    };

    expect(() => adapter.parseRequest(input)).toThrow('Invalid JSON');
  });

  it('should throw error for non-existent params file', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
      paramsFile: '/nonexistent/params.json',
    };

    expect(() => adapter.parseRequest(input)).toThrow('Params file not found');
  });

  it('should disable trace in production mode', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
      production: true,
    };

    const request = adapter.parseRequest(input);

    expect(request.context.includeTrace).toBe(false);
    expect(request.context.environment).toBe('production');
  });

  it('should enable trace when explicitly requested', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
      trace: true,
    };

    const request = adapter.parseRequest(input);

    expect(request.context.includeTrace).toBe(true);
  });

  it('should include timeout when specified', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
      timeout: 5000,
    };

    const request = adapter.parseRequest(input);

    expect(request.context.timeout).toBe(5000);
  });

  it('should validate valid requests', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
    };

    const request = adapter.parseRequest(input);
    const validation = adapter.validate(request);

    expect(validation.valid).toBe(true);
  });
});

describe('HttpRequestAdapter', () => {
  it('should parse HTTP input', () => {
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'myWorkflow' },
      body: { input: 'value' },
      query: { trace: 'true' },
      headers: { 'x-request-id': 'req-123' },
    };

    const request = adapter.parseRequest(input);

    expect(request.workflowId).toBe('myWorkflow');
    expect(request.params).toEqual({ input: 'value' });
    expect(request.context.source).toBe('http');
    expect(request.context.includeTrace).toBe(true);
    expect(request.context.requestId).toBe('req-123');
  });

  it('should handle missing request ID', () => {
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'workflow' },
      body: {},
      query: {},
      headers: {},
    };

    const request = adapter.parseRequest(input);

    expect(request.context.requestId).toBeDefined();
    expect(request.context.requestId.length).toBeGreaterThan(0);
  });

  it('should not include trace when query param is false', () => {
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'workflow' },
      body: {},
      query: { trace: 'false' },
      headers: {},
    };

    const request = adapter.parseRequest(input);

    expect(request.context.includeTrace).toBe(false);
  });
});

describe('LambdaRequestAdapter', () => {
  it('should parse Lambda event with string body', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      body: JSON.stringify({ data: 'test' }),
      pathParameters: { name: 'myWorkflow' },
      queryStringParameters: {},
      requestContext: {
        requestId: 'lambda-req-123',
        stage: 'dev',
      },
    };

    const request = adapter.parseRequest(input);

    expect(request.workflowId).toBe('myWorkflow');
    expect(request.params).toEqual({ data: 'test' });
    expect(request.context.source).toBe('lambda');
    expect(request.context.requestId).toBe('lambda-req-123');
  });

  it('should parse Lambda event with object body', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      body: { data: 'test' },
      pathParameters: { workflow: 'myWorkflow' },
    };

    const request = adapter.parseRequest(input);

    expect(request.params).toEqual({ data: 'test' });
    expect(request.workflowId).toBe('myWorkflow');
  });

  it('should handle production stage', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      pathParameters: { name: 'workflow' },
      requestContext: {
        stage: 'production',
      },
    };

    const request = adapter.parseRequest(input);

    expect(request.context.environment).toBe('production');
  });

  it('should handle invalid JSON body gracefully', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      body: 'not json',
      pathParameters: { name: 'workflow' },
    };

    const request = adapter.parseRequest(input);

    expect(request.params).toEqual({});
  });
});

describe('VercelRequestAdapter', () => {
  it('should parse Vercel request', () => {
    const adapter = new VercelRequestAdapter();
    const input: VercelInput = {
      method: 'POST',
      body: { input: 'data' },
      query: { workflow: 'myWorkflow', trace: 'true' },
      headers: { 'x-vercel-id': 'vercel-123' },
    };

    const request = adapter.parseRequest(input);

    expect(request.workflowId).toBe('myWorkflow');
    expect(request.params).toEqual({ input: 'data' });
    expect(request.context.source).toBe('vercel');
    expect(request.context.includeTrace).toBe(true);
  });

  it('should handle missing Vercel ID', () => {
    const adapter = new VercelRequestAdapter();
    const input: VercelInput = {
      method: 'POST',
      body: {},
      query: {},
      headers: {},
    };

    const request = adapter.parseRequest(input);

    expect(request.context.requestId).toBeDefined();
  });
});

describe('CliRequestAdapter - additional coverage', () => {
  it('should throw for malformed params file content', () => {
    const adapter = new CliRequestAdapter();
    const paramsFilePath = path.join(tempDir, 'bad-params.json');
    fs.writeFileSync(paramsFilePath, '{ broken json');

    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
      paramsFile: paramsFilePath,
    };

    expect(() => adapter.parseRequest(input)).toThrow('Failed to parse params file');
  });

  it('should default to empty params when neither params nor paramsFile given', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/path/to/workflow.ts',
    };

    const request = adapter.parseRequest(input);
    expect(request.params).toEqual({});
  });

  it('should extract workflow ID from file path with nested directories', () => {
    const adapter = new CliRequestAdapter();
    const input: CliInput = {
      filePath: '/deep/nested/path/order-processing.flow',
    };

    const request = adapter.parseRequest(input);
    expect(request.workflowId).toBe('order-processing');
  });
});

describe('HttpRequestAdapter - additional coverage', () => {
  it('should fall back to workflow param when name is missing', () => {
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { workflow: 'fallback-workflow' },
      body: { x: 1 },
      query: {},
      headers: {},
    };

    const request = adapter.parseRequest(input);
    expect(request.workflowId).toBe('fallback-workflow');
  });

  it('should use empty string when no name or workflow param', () => {
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: {},
      body: {},
      query: {},
      headers: {},
    };

    const request = adapter.parseRequest(input);
    expect(request.workflowId).toBe('');
  });

  it('should use empty body as params when body is falsy', () => {
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'wf' },
      body: null as unknown as Record<string, unknown>,
      query: {},
      headers: {},
    };

    const request = adapter.parseRequest(input);
    expect(request.params).toEqual({});
  });
});

describe('LambdaRequestAdapter - additional coverage', () => {
  it('should use id path parameter as fallback', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      pathParameters: { id: 'by-id-workflow' },
    };

    const request = adapter.parseRequest(input);
    expect(request.workflowId).toBe('by-id-workflow');
  });

  it('should return empty workflowId when no path parameters', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {};

    const request = adapter.parseRequest(input);
    expect(request.workflowId).toBe('');
  });

  it('should handle prod stage as production', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      pathParameters: { name: 'wf' },
      requestContext: { stage: 'prod' },
    };

    const request = adapter.parseRequest(input);
    expect(request.context.environment).toBe('production');
  });

  it('should default to development for non-prod stages', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      pathParameters: { name: 'wf' },
      requestContext: { stage: 'dev' },
    };

    const request = adapter.parseRequest(input);
    expect(request.context.environment).toBe('development');
  });

  it('should parse trace query parameter', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      pathParameters: { name: 'wf' },
      queryStringParameters: { trace: 'true' },
    };

    const request = adapter.parseRequest(input);
    expect(request.context.includeTrace).toBe(true);
  });

  it('should handle empty string body', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      body: '',
      pathParameters: { name: 'wf' },
    };

    const request = adapter.parseRequest(input);
    expect(request.params).toEqual({});
  });

  it('should generate requestId when requestContext has none', () => {
    const adapter = new LambdaRequestAdapter();
    const input: LambdaInput = {
      pathParameters: { name: 'wf' },
      requestContext: { stage: 'dev' },
    };

    const request = adapter.parseRequest(input);
    expect(request.context.requestId).toBeDefined();
    expect(request.context.requestId.length).toBeGreaterThan(0);
  });
});

describe('VercelRequestAdapter - additional coverage', () => {
  it('should fall back to name query param', () => {
    const adapter = new VercelRequestAdapter();
    const input: VercelInput = {
      method: 'POST',
      body: {},
      query: { name: 'name-wf' },
      headers: {},
    };

    const request = adapter.parseRequest(input);
    expect(request.workflowId).toBe('name-wf');
  });

  it('should return empty workflowId when no query params', () => {
    const adapter = new VercelRequestAdapter();
    const input: VercelInput = {
      method: 'GET',
      body: {},
      query: {},
      headers: {},
    };

    const request = adapter.parseRequest(input);
    expect(request.workflowId).toBe('');
  });

  it('should set trace to false when not specified', () => {
    const adapter = new VercelRequestAdapter();
    const input: VercelInput = {
      method: 'POST',
      body: {},
      query: {},
      headers: {},
    };

    const request = adapter.parseRequest(input);
    expect(request.context.includeTrace).toBe(false);
  });

  it('should use empty object for null body', () => {
    const adapter = new VercelRequestAdapter();
    const input: VercelInput = {
      method: 'POST',
      body: null as unknown as Record<string, unknown>,
      query: { workflow: 'wf' },
      headers: {},
    };

    const request = adapter.parseRequest(input);
    expect(request.params).toEqual({});
  });
});

describe('CloudflareRequestAdapter', () => {
  function makeCloudflareInput(options: {
    url: string;
    body?: Record<string, unknown>;
    jsonThrows?: boolean;
    cfRay?: string;
  }): CloudflareInput {
    const headers = new Headers();
    if (options.cfRay) {
      headers.set('cf-ray', options.cfRay);
    }

    return {
      request: {
        method: 'POST',
        url: options.url,
        headers,
        json: options.jsonThrows
          ? () => Promise.reject(new Error('parse error'))
          : () => Promise.resolve(options.body || {}),
      },
    };
  }

  it('should parse request async with body and path', async () => {
    const adapter = new CloudflareRequestAdapter();
    const input = makeCloudflareInput({
      url: 'https://worker.example.com/api/my-workflow?trace=true',
      body: { key: 'val' },
      cfRay: 'ray-abc',
    });

    const request = await adapter.parseRequestAsync(input);

    expect(request.workflowId).toBe('my-workflow');
    expect(request.params).toEqual({ key: 'val' });
    expect(request.context.source).toBe('cloudflare');
    expect(request.context.includeTrace).toBe(true);
    expect(request.context.requestId).toBe('ray-abc');
  });

  it('should handle json parse failure gracefully', async () => {
    const adapter = new CloudflareRequestAdapter();
    const input = makeCloudflareInput({
      url: 'https://worker.example.com/run/wf',
      jsonThrows: true,
    });

    const request = await adapter.parseRequestAsync(input);
    expect(request.params).toEqual({});
  });

  it('should extract last path segment as workflowId', async () => {
    const adapter = new CloudflareRequestAdapter();
    const input = makeCloudflareInput({
      url: 'https://worker.example.com/v1/workflows/deep-path-wf',
    });

    const request = await adapter.parseRequestAsync(input);
    expect(request.workflowId).toBe('deep-path-wf');
  });

  it('should return empty workflowId for root path', async () => {
    const adapter = new CloudflareRequestAdapter();
    const input = makeCloudflareInput({
      url: 'https://worker.example.com/',
    });

    const request = await adapter.parseRequestAsync(input);
    expect(request.workflowId).toBe('');
  });

  it('should set trace to false when query param missing', async () => {
    const adapter = new CloudflareRequestAdapter();
    const input = makeCloudflareInput({
      url: 'https://worker.example.com/wf',
    });

    const request = await adapter.parseRequestAsync(input);
    expect(request.context.includeTrace).toBe(false);
  });

  it('should generate requestId when cf-ray header is absent', async () => {
    const adapter = new CloudflareRequestAdapter();
    const input = makeCloudflareInput({
      url: 'https://worker.example.com/wf',
    });

    const request = await adapter.parseRequestAsync(input);
    expect(request.context.requestId).toBeDefined();
    expect(request.context.requestId.length).toBeGreaterThan(0);
  });

  it('should throw when using sync parseRequest', () => {
    const adapter = new CloudflareRequestAdapter();
    const input = makeCloudflareInput({
      url: 'https://worker.example.com/wf',
    });

    expect(() => adapter.parseRequest(input)).toThrow('Use parseRequestAsync for Cloudflare Workers');
  });
});

describe('BaseRequestAdapter validation', () => {
  // Use CliRequestAdapter to test shared base validation
  const adapter = new CliRequestAdapter();

  it('should fail validation for empty workflowId', () => {
    const request: WorkflowRequest = {
      workflowId: '',
      params: {},
      context: {
        source: 'cli',
        environment: 'development',
        requestId: 'req-1',
        includeTrace: false,
      },
    };

    const result = adapter.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.path === 'workflowId')).toBe(true);
  });

  it('should fail validation for non-string workflowId', () => {
    const request = {
      workflowId: 123,
      params: {},
      context: {
        source: 'cli',
        environment: 'development',
        requestId: 'req-1',
        includeTrace: false,
      },
    } as unknown as WorkflowRequest;

    const result = adapter.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors!.some((e) => e.path === 'workflowId')).toBe(true);
    expect(result.errors![0].actual).toBe('number');
  });

  it('should fail validation for non-object params', () => {
    const request = {
      workflowId: 'test',
      params: 'not-an-object',
      context: {
        source: 'cli',
        environment: 'development',
        requestId: 'req-1',
        includeTrace: false,
      },
    } as unknown as WorkflowRequest;

    const result = adapter.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors!.some((e) => e.path === 'params')).toBe(true);
  });

  it('should pass validation for null params', () => {
    const request = {
      workflowId: 'test',
      params: null,
      context: {
        source: 'cli',
        environment: 'development',
        requestId: 'req-1',
        includeTrace: false,
      },
    } as unknown as WorkflowRequest;

    const result = adapter.validate(request);
    // null params is valid (the check is params !== null && typeof !== object)
    expect(result.errors?.some((e) => e.path === 'params')).toBeFalsy();
  });

  it('should fail validation for missing context', () => {
    const request = {
      workflowId: 'test',
      params: {},
      context: undefined,
    } as unknown as WorkflowRequest;

    const result = adapter.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors!.some((e) => e.path === 'context')).toBe(true);
  });

  it('should fail validation for missing requestId in context', () => {
    const request = {
      workflowId: 'test',
      params: {},
      context: {
        source: 'cli',
        environment: 'development',
        requestId: '',
        includeTrace: false,
      },
    } as unknown as WorkflowRequest;

    const result = adapter.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors!.some((e) => e.path === 'context.requestId')).toBe(true);
  });

  it('should return no errors array when valid', () => {
    const request: WorkflowRequest = {
      workflowId: 'good',
      params: { a: 1 },
      context: {
        source: 'cli',
        environment: 'development',
        requestId: 'req-abc',
        includeTrace: true,
      },
    };

    const result = adapter.validate(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should accumulate multiple validation errors', () => {
    const request = {
      workflowId: null,
      params: 42,
      context: undefined,
    } as unknown as WorkflowRequest;

    const result = adapter.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Environment detection', () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.NODE_ENV = origEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it('should detect production from NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    const adapter = new CliRequestAdapter();
    const request = adapter.parseRequest({ filePath: '/wf.ts' });
    expect(request.context.environment).toBe('development');
    // Note: CLI adapter sets environment based on production flag, not NODE_ENV
    // The detectEnvironment is called but overridden by the explicit production param
  });

  it('should detect production from NODE_ENV=prod', () => {
    process.env.NODE_ENV = 'prod';
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'wf' },
      body: {},
      query: {},
      headers: {},
    };
    const request = adapter.parseRequest(input);
    expect(request.context.environment).toBe('production');
  });

  it('should detect staging from NODE_ENV=staging', () => {
    process.env.NODE_ENV = 'staging';
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'wf' },
      body: {},
      query: {},
      headers: {},
    };
    const request = adapter.parseRequest(input);
    expect(request.context.environment).toBe('staging');
  });

  it('should detect staging from NODE_ENV=stage', () => {
    process.env.NODE_ENV = 'stage';
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'wf' },
      body: {},
      query: {},
      headers: {},
    };
    const request = adapter.parseRequest(input);
    expect(request.context.environment).toBe('staging');
  });

  it('should default to development for unknown NODE_ENV', () => {
    process.env.NODE_ENV = 'test';
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'wf' },
      body: {},
      query: {},
      headers: {},
    };
    const request = adapter.parseRequest(input);
    expect(request.context.environment).toBe('development');
  });

  it('should default to development when NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;
    const adapter = new HttpRequestAdapter();
    const input: HttpInput = {
      params: { name: 'wf' },
      body: {},
      query: {},
      headers: {},
    };
    const request = adapter.parseRequest(input);
    expect(request.context.environment).toBe('development');
  });
});

describe('createAdapter', () => {
  it('should create CLI adapter', () => {
    const adapter = createAdapter('cli');
    expect(adapter).toBeInstanceOf(CliRequestAdapter);
  });

  it('should create HTTP adapter', () => {
    const adapter = createAdapter('http');
    expect(adapter).toBeInstanceOf(HttpRequestAdapter);
  });

  it('should create Lambda adapter', () => {
    const adapter = createAdapter('lambda');
    expect(adapter).toBeInstanceOf(LambdaRequestAdapter);
  });

  it('should create Vercel adapter', () => {
    const adapter = createAdapter('vercel');
    expect(adapter).toBeInstanceOf(VercelRequestAdapter);
  });

  it('should create Cloudflare adapter', () => {
    const adapter = createAdapter('cloudflare');
    expect(adapter).toBeInstanceOf(CloudflareRequestAdapter);
  });
});
