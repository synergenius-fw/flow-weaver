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
  createAdapter,
} from '../../../src/deployment/core/adapters';
import type { CliInput, HttpInput, LambdaInput, VercelInput } from '../../../src/deployment/types';

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
});
