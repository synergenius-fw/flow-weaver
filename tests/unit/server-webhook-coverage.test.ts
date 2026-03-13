/**
 * Coverage tests for WebhookServer swagger routes (lines 279-307).
 * Covers the /openapi.json and /docs route handlers that are set up
 * when swaggerEnabled is true.
 */

import { WebhookServer } from '../../src/server/webhook-server';

// Store route handlers registered by WebhookServer
const routes: Record<string, Function> = {};

// Mock the WorkflowRegistry as a class
vi.mock('../../src/server/workflow-registry', () => {
  return {
    WorkflowRegistry: class {
      private _endpoints = [
        {
          name: 'greet',
          functionName: 'greet',
          filePath: '/tmp/greet.ts',
          method: 'POST' as const,
          path: '/workflows/greet',
          inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
          outputSchema: { type: 'object', properties: { message: { type: 'string' } } },
          description: 'A greeting workflow',
        },
      ];
      initialize = vi.fn().mockResolvedValue(undefined);
      getAllEndpoints = vi.fn(() => this._endpoints);
      getEndpoint = vi.fn();
      getUptime = vi.fn().mockReturnValue(42);
      startWatching = vi.fn().mockResolvedValue(undefined);
      stopWatching = vi.fn().mockResolvedValue(undefined);
      setEndpoints(eps: any[]) { this._endpoints = eps; }
    },
  };
});

// Mock fastify to capture registered route handlers
vi.mock('fastify', () => {
  const instance = {
    register: vi.fn().mockResolvedValue(undefined),
    get: vi.fn((path: string, handler: Function) => {
      routes[`GET ${path}`] = handler;
    }),
    post: vi.fn((path: string, handler: Function) => {
      routes[`POST ${path}`] = handler;
    }),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { default: vi.fn(() => instance) };
});

// Mock @fastify/cors
vi.mock('@fastify/cors', () => ({
  default: vi.fn(),
}));

describe('WebhookServer swagger routes', () => {
  let server: WebhookServer;

  beforeEach(async () => {
    // Clear captured routes between tests
    for (const key of Object.keys(routes)) {
      delete routes[key];
    }

    server = new WebhookServer({
      port: 9999,
      host: '127.0.0.1',
      workflowDir: '/tmp/workflows',
      watchEnabled: false,
      corsOrigin: '*',
      production: false,
      precompile: false,
      swaggerEnabled: true,
    });

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('registers /openapi.json route that returns OpenAPI spec', async () => {
    const handler = routes['GET /openapi.json'];
    expect(handler).toBeDefined();

    let sentData: unknown;
    let headerName: string | undefined;
    let headerValue: string | undefined;

    const mockReply = {
      header: vi.fn(function (this: any, name: string, value: string) {
        headerName = name;
        headerValue = value;
        return this;
      }),
      send: vi.fn((data: unknown) => {
        sentData = data;
      }),
    };

    await handler({}, mockReply);

    expect(headerName).toBe('Content-Type');
    expect(headerValue).toBe('application/json');

    const spec = sentData as any;
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Flow Weaver API');
    expect(spec.paths['/workflows/greet']).toBeDefined();
    expect(spec.paths['/workflows/greet'].post.operationId).toBe('execute_greet');
    expect(spec.paths['/workflows/greet'].post.description).toBe('A greeting workflow');
  });

  it('registers /docs route that returns Swagger UI HTML', async () => {
    const handler = routes['GET /docs'];
    expect(handler).toBeDefined();

    let sentHtml: string | undefined;
    let contentType: string | undefined;

    const mockReply = {
      type: vi.fn(function (this: any, ct: string) {
        contentType = ct;
        return this;
      }),
      send: vi.fn((data: unknown) => {
        sentHtml = data as string;
      }),
    };

    await handler({}, mockReply);

    expect(contentType).toBe('text/html');
    expect(sentHtml).toContain('<!DOCTYPE html>');
    expect(sentHtml).toContain('swagger-ui');
    expect(sentHtml).toContain('/openapi.json');
    expect(sentHtml).toContain('Flow Weaver API Documentation');
  });

  it('builds OpenAPI spec with fallback description when endpoint has none', async () => {
    // Access the internal registry and change endpoints
    const registry = (server as any).registry;
    registry.setEndpoints([
      {
        name: 'process',
        functionName: 'process',
        filePath: '/tmp/process.ts',
        method: 'POST',
        path: '/workflows/process',
        // no inputSchema, no outputSchema, no description
      },
    ]);

    const handler = routes['GET /openapi.json'];
    let sentData: unknown;

    const mockReply = {
      header: vi.fn().mockReturnThis(),
      send: vi.fn((data: unknown) => {
        sentData = data;
      }),
    };

    await handler({}, mockReply);

    const spec = sentData as any;
    const endpoint = spec.paths['/workflows/process'].post;
    expect(endpoint.description).toBe('Execute the process workflow');
    expect(endpoint.requestBody.content['application/json'].schema).toEqual({
      type: 'object',
      additionalProperties: true,
    });
  });
});
