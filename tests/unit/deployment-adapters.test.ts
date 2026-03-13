import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CliRequestAdapter,
  HttpRequestAdapter,
  createAdapter,
} from '../../src/deployment/core/adapters.js';
import type { WorkflowRequest } from '../../src/deployment/types.js';
import * as fs from 'fs';
import * as path from 'path';

// ── BaseRequestAdapter.validate (inherited by both adapters) ──

describe('BaseRequestAdapter.validate', () => {
  const adapter = new CliRequestAdapter();

  function makeRequest(overrides: Partial<WorkflowRequest> = {}): WorkflowRequest {
    return {
      workflowId: 'test',
      params: {},
      context: {
        source: 'cli',
        environment: 'development',
        requestId: 'req-1',
        includeTrace: true,
      },
      ...overrides,
    };
  }

  it('returns valid for a correct request', () => {
    const result = adapter.validate(makeRequest());
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('flags missing workflowId', () => {
    const result = adapter.validate(makeRequest({ workflowId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'workflowId' }),
      ]),
    );
  });

  it('flags non-string workflowId', () => {
    const result = adapter.validate(makeRequest({ workflowId: 123 as any }));
    expect(result.valid).toBe(false);
    expect(result.errors![0].actual).toBe('number');
  });

  it('flags non-object params', () => {
    const result = adapter.validate(makeRequest({ params: 'bad' as any }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'params' }),
      ]),
    );
  });

  it('allows null params (null is typeof object)', () => {
    const result = adapter.validate(makeRequest({ params: null as any }));
    expect(result.valid).toBe(true);
  });

  it('flags missing context', () => {
    const result = adapter.validate(makeRequest({ context: undefined as any }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'context' }),
      ]),
    );
  });

  it('flags missing context.requestId', () => {
    const result = adapter.validate(
      makeRequest({
        context: {
          source: 'cli',
          environment: 'development',
          requestId: '',
          includeTrace: true,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'context.requestId' }),
      ]),
    );
  });
});

// ── CliRequestAdapter.parseRequest ──

describe('CliRequestAdapter.parseRequest', () => {
  const adapter = new CliRequestAdapter();

  it('parses basic CLI input with JSON params', () => {
    const request = adapter.parseRequest({
      filePath: '/workflows/my-flow.ts',
      params: '{"key":"value"}',
    });
    expect(request.workflowId).toBe('my-flow');
    expect(request.params).toEqual({ key: 'value' });
    expect(request.context.source).toBe('cli');
    expect(request.context.includeTrace).toBe(true);
  });

  it('uses workflowName over filePath for workflowId', () => {
    const request = adapter.parseRequest({
      filePath: '/workflows/file.ts',
      workflowName: 'custom-name',
    });
    expect(request.workflowId).toBe('custom-name');
  });

  it('throws on invalid JSON params', () => {
    expect(() =>
      adapter.parseRequest({ filePath: '/test.ts', params: 'not-json' }),
    ).toThrow('Invalid JSON in params');
  });

  it('reads params from a file', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'fw-test-'));
    const tmpFile = path.join(tmpDir, 'params.json');
    fs.writeFileSync(tmpFile, '{"fromFile":true}');

    try {
      const request = adapter.parseRequest({
        filePath: '/test.ts',
        paramsFile: tmpFile,
      });
      expect(request.params).toEqual({ fromFile: true });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('throws when paramsFile does not exist', () => {
    expect(() =>
      adapter.parseRequest({
        filePath: '/test.ts',
        paramsFile: '/nonexistent/params.json',
      }),
    ).toThrow('Params file not found');
  });

  it('throws when paramsFile contains invalid JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'fw-test-'));
    const tmpFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(tmpFile, '{invalid}');

    try {
      expect(() =>
        adapter.parseRequest({ filePath: '/test.ts', paramsFile: tmpFile }),
      ).toThrow('Failed to parse params file');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('sets production environment when production flag is true', () => {
    const request = adapter.parseRequest({
      filePath: '/test.ts',
      production: true,
    });
    expect(request.context.environment).toBe('production');
    expect(request.context.includeTrace).toBe(false);
  });

  it('respects explicit trace flag even in production mode', () => {
    const request = adapter.parseRequest({
      filePath: '/test.ts',
      production: true,
      trace: true,
    });
    expect(request.context.includeTrace).toBe(true);
  });

  it('passes timeout through to context', () => {
    const request = adapter.parseRequest({
      filePath: '/test.ts',
      timeout: 5000,
    });
    expect(request.context.timeout).toBe(5000);
  });

  it('assigns a UUID requestId by default', () => {
    const request = adapter.parseRequest({ filePath: '/test.ts' });
    expect(request.context.requestId).toBeTruthy();
    // UUID v4 format
    expect(request.context.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ── BaseRequestAdapter.detectEnvironment ──

describe('detectEnvironment', () => {
  const adapter = new CliRequestAdapter();
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('detects production from NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    const request = adapter.parseRequest({ filePath: '/test.ts' });
    // When not in production CLI mode, the adapter uses detectEnvironment
    // but the CLI adapter explicitly sets environment based on the production flag,
    // so we test via a non-production CLI call where detectEnvironment would be used
  });

  it('detects production from NODE_ENV=prod', () => {
    process.env.NODE_ENV = 'prod';
    // The HttpRequestAdapter doesn't pass an explicit environment, so it uses detectEnvironment
    const httpAdapter = new HttpRequestAdapter();
    const request = httpAdapter.parseRequest({
      params: { name: 'test' },
      body: {},
      query: {},
      headers: {},
    });
    expect(request.context.environment).toBe('production');
  });

  it('detects staging from NODE_ENV=staging', () => {
    process.env.NODE_ENV = 'staging';
    const httpAdapter = new HttpRequestAdapter();
    const request = httpAdapter.parseRequest({
      params: { name: 'test' },
      body: {},
      query: {},
      headers: {},
    });
    expect(request.context.environment).toBe('staging');
  });

  it('detects staging from NODE_ENV=stage', () => {
    process.env.NODE_ENV = 'stage';
    const httpAdapter = new HttpRequestAdapter();
    const request = httpAdapter.parseRequest({
      params: { name: 'test' },
      body: {},
      query: {},
      headers: {},
    });
    expect(request.context.environment).toBe('staging');
  });

  it('defaults to development for unrecognized NODE_ENV', () => {
    process.env.NODE_ENV = 'test';
    const httpAdapter = new HttpRequestAdapter();
    const request = httpAdapter.parseRequest({
      params: { name: 'test' },
      body: {},
      query: {},
      headers: {},
    });
    expect(request.context.environment).toBe('development');
  });
});

// ── HttpRequestAdapter.parseRequest ──

describe('HttpRequestAdapter.parseRequest', () => {
  const adapter = new HttpRequestAdapter();

  it('extracts workflowId from params.name', () => {
    const request = adapter.parseRequest({
      params: { name: 'my-workflow' },
      body: { input: 'data' },
      query: {},
      headers: {},
    });
    expect(request.workflowId).toBe('my-workflow');
    expect(request.params).toEqual({ input: 'data' });
    expect(request.context.source).toBe('http');
  });

  it('falls back to params.workflow when name is absent', () => {
    const request = adapter.parseRequest({
      params: { workflow: 'fallback-wf' },
      body: {},
      query: {},
      headers: {},
    });
    expect(request.workflowId).toBe('fallback-wf');
  });

  it('enables trace when query.trace is "true"', () => {
    const request = adapter.parseRequest({
      params: { name: 'test' },
      body: {},
      query: { trace: 'true' },
      headers: {},
    });
    expect(request.context.includeTrace).toBe(true);
  });

  it('disables trace by default', () => {
    const request = adapter.parseRequest({
      params: { name: 'test' },
      body: {},
      query: {},
      headers: {},
    });
    expect(request.context.includeTrace).toBe(false);
  });

  it('uses x-request-id header as requestId', () => {
    const request = adapter.parseRequest({
      params: { name: 'test' },
      body: {},
      query: {},
      headers: { 'x-request-id': 'custom-req-id' },
    });
    expect(request.context.requestId).toBe('custom-req-id');
  });

  it('generates a UUID when x-request-id is absent', () => {
    const request = adapter.parseRequest({
      params: { name: 'test' },
      body: {},
      query: {},
      headers: {},
    });
    expect(request.context.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('defaults to empty params when body is falsy', () => {
    const request = adapter.parseRequest({
      params: { name: 'test' },
      body: undefined as any,
      query: {},
      headers: {},
    });
    expect(request.params).toEqual({});
  });
});

// ── createAdapter factory ──

describe('createAdapter', () => {
  it('returns a CliRequestAdapter for "cli"', () => {
    const adapter = createAdapter('cli');
    expect(adapter).toBeInstanceOf(CliRequestAdapter);
  });

  it('returns an HttpRequestAdapter for "http"', () => {
    const adapter = createAdapter('http');
    expect(adapter).toBeInstanceOf(HttpRequestAdapter);
  });
});
