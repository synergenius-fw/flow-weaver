/**
 * Tests for WebhookServer
 *
 * The server dynamically imports Fastify at startup, so we mock the module
 * system to provide a fake Fastify instance. This lets us test route setup,
 * OpenAPI spec generation, and lifecycle methods without starting a real server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock executeWorkflowFromFile to avoid real compilation
const mockExecuteWorkflowFromFile = vi.fn();
vi.mock('../../../src/mcp/workflow-executor.js', () => ({
  executeWorkflowFromFile: (...a: unknown[]) => mockExecuteWorkflowFromFile(...a),
}));

import { WebhookServer } from '../../../src/server/webhook-server.js';
import { WorkflowRegistry } from '../../../src/server/workflow-registry.js';

const WEBHOOK_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-webhook-${process.pid}`);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output doubled - Doubled result
 */
function doubleValue(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; doubled: number } {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @name doubler
 * @description Doubles a numeric value
 * @node d doubleValue
 * @connect Start.execute -> d.execute
 * @connect Start.value -> d.value
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.doubled -> Exit.doubled
 */
export function doubler(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; doubled: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

beforeEach(() => {
  fs.mkdirSync(WEBHOOK_TEMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(WEBHOOK_TEMP_DIR, 'doubler.ts'), SAMPLE_WORKFLOW);
});

afterEach(() => {
  fs.rmSync(WEBHOOK_TEMP_DIR, { recursive: true, force: true });
});

// ── WebhookServer constructor and getServerInfo ──────────────────────────────

describe('WebhookServer', () => {
  it('should construct with config and return server info', () => {
    const server = new WebhookServer({
      port: 3456,
      host: '127.0.0.1',
      workflowDir: WEBHOOK_TEMP_DIR,
      watchEnabled: false,
      corsOrigin: '*',
      production: false,
      precompile: false,
    });

    const info = server.getServerInfo();
    expect(info.port).toBe(3456);
    expect(info.host).toBe('127.0.0.1');
    // Before start, endpoints will be 0
    expect(info.endpoints).toBe(0);
  });

  it('should handle stop gracefully when not started', async () => {
    const server = new WebhookServer({
      port: 3457,
      host: '127.0.0.1',
      workflowDir: WEBHOOK_TEMP_DIR,
      watchEnabled: false,
      corsOrigin: '*',
      production: false,
      precompile: false,
    });

    // Should not throw
    await server.stop();
  });
});

// ── WorkflowRegistry integration with server config ──────────────────────────

describe('WebhookServer with WorkflowRegistry', () => {
  it('should discover workflows from the configured directory', async () => {
    const registry = new WorkflowRegistry(WEBHOOK_TEMP_DIR, {
      precompile: false,
      production: false,
    });

    await registry.initialize();

    const endpoints = registry.getAllEndpoints();
    expect(endpoints.length).toBe(1);
    expect(endpoints[0].name).toBe('doubler');
    expect(endpoints[0].path).toBe('/workflows/doubler');
    expect(endpoints[0].method).toBe('POST');
    expect(endpoints[0].description).toBe('Doubles a numeric value');
  });

  it('should generate input schema from workflow ports', async () => {
    const registry = new WorkflowRegistry(WEBHOOK_TEMP_DIR);
    await registry.initialize();

    const endpoint = registry.getEndpoint('doubler');
    expect(endpoint?.inputSchema).toBeDefined();
    expect(endpoint?.inputSchema?.type).toBe('object');

    const props = endpoint?.inputSchema?.properties as Record<string, { type: string }>;
    expect(props.value).toBeDefined();
    expect(props.value.type).toBe('number');
  });

  it('should generate output schema from workflow ports', async () => {
    const registry = new WorkflowRegistry(WEBHOOK_TEMP_DIR);
    await registry.initialize();

    const endpoint = registry.getEndpoint('doubler');
    expect(endpoint?.outputSchema).toBeDefined();
    expect(endpoint?.outputSchema?.type).toBe('object');

    const props = endpoint?.outputSchema?.properties as Record<string, { type: string }>;
    expect(props.doubled).toBeDefined();
    expect(props.doubled.type).toBe('number');
  });

  it('should return undefined for nonexistent endpoint', async () => {
    const registry = new WorkflowRegistry(WEBHOOK_TEMP_DIR);
    await registry.initialize();

    expect(registry.getEndpoint('nonexistent')).toBeUndefined();
  });

  it('should track uptime', async () => {
    const registry = new WorkflowRegistry(WEBHOOK_TEMP_DIR);
    await registry.initialize();

    const uptime = registry.getUptime();
    expect(uptime).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty directory', async () => {
    const emptyDir = path.join(WEBHOOK_TEMP_DIR, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });

    const registry = new WorkflowRegistry(emptyDir);
    await registry.initialize();

    expect(registry.getAllEndpoints()).toHaveLength(0);
  });

  it('should skip non-workflow files', async () => {
    const mixedDir = path.join(WEBHOOK_TEMP_DIR, 'mixed');
    fs.mkdirSync(mixedDir, { recursive: true });
    fs.writeFileSync(path.join(mixedDir, 'workflow.ts'), SAMPLE_WORKFLOW);
    fs.writeFileSync(path.join(mixedDir, 'util.ts'), 'export function helper() { return 1; }');

    const registry = new WorkflowRegistry(mixedDir);
    await registry.initialize();

    expect(registry.getAllEndpoints()).toHaveLength(1);
  });

  it('should skip .generated.ts files', async () => {
    const genDir = path.join(WEBHOOK_TEMP_DIR, 'generated');
    fs.mkdirSync(genDir, { recursive: true });
    fs.writeFileSync(path.join(genDir, 'wf.ts'), SAMPLE_WORKFLOW);
    fs.writeFileSync(path.join(genDir, 'wf.generated.ts'), SAMPLE_WORKFLOW);

    const registry = new WorkflowRegistry(genDir);
    await registry.initialize();

    expect(registry.getAllEndpoints()).toHaveLength(1);
  });

  it('should handle re-discovery after adding a file', async () => {
    const reDir = path.join(WEBHOOK_TEMP_DIR, 'rediscover');
    fs.mkdirSync(reDir, { recursive: true });
    fs.writeFileSync(path.join(reDir, 'wf.ts'), SAMPLE_WORKFLOW);

    const registry = new WorkflowRegistry(reDir);
    await registry.initialize();
    expect(registry.getAllEndpoints()).toHaveLength(1);

    // Add another workflow (reuse same content, different filename)
    const secondWorkflow = SAMPLE_WORKFLOW.replace('doubler', 'tripler').replace(
      'Doubles a numeric value',
      'Triples a numeric value'
    );
    fs.writeFileSync(path.join(reDir, 'wf2.ts'), secondWorkflow);

    await registry.discoverWorkflows();
    expect(registry.getAllEndpoints()).toHaveLength(2);
  });

  it('should handle stopWatching without starting', async () => {
    const registry = new WorkflowRegistry(WEBHOOK_TEMP_DIR);
    // Should not throw
    await registry.stopWatching();
  });
});

// ── Server config options ────────────────────────────────────────────────────

describe('WebhookServer config options', () => {
  it('should accept swagger enabled config', () => {
    const server = new WebhookServer({
      port: 3500,
      host: '0.0.0.0',
      workflowDir: WEBHOOK_TEMP_DIR,
      watchEnabled: false,
      corsOrigin: ['http://localhost:3000'],
      production: true,
      precompile: true,
      swaggerEnabled: true,
    });

    const info = server.getServerInfo();
    expect(info.port).toBe(3500);
    expect(info.host).toBe('0.0.0.0');
  });

  it('should accept array CORS origin', () => {
    const server = new WebhookServer({
      port: 3501,
      host: '0.0.0.0',
      workflowDir: WEBHOOK_TEMP_DIR,
      watchEnabled: false,
      corsOrigin: ['http://localhost:3000', 'http://localhost:3001'],
      production: false,
      precompile: false,
    });

    expect(server.getServerInfo().port).toBe(3501);
  });
});

// ── Mocked Fastify start/stop lifecycle ──────────────────────────────────────

describe('WebhookServer start/stop with mock Fastify', () => {
  let routeHandlers: Map<string, { method: string; handler: Function }>;
  let mockFastifyInstance: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    routeHandlers = new Map();

    mockFastifyInstance = {
      register: vi.fn().mockResolvedValue(undefined),
      get: vi.fn((path: string, handler: Function) => {
        routeHandlers.set(`GET:${path}`, { method: 'GET', handler });
      }),
      post: vi.fn((path: string, handler: Function) => {
        routeHandlers.set(`POST:${path}`, { method: 'POST', handler });
      }),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
  });

  function createServerWithMockFastify(overrides: Record<string, unknown> = {}) {
    // We need to mock the dynamic import of fastify inside start()
    // Instead, we'll use a more direct approach: mock the 'fastify' module
    vi.doMock('fastify', () => ({
      default: () => mockFastifyInstance,
    }));

    // Mock @fastify/cors to succeed
    vi.doMock('@fastify/cors', () => ({
      default: vi.fn(),
    }));

    return new WebhookServer({
      port: 4000,
      host: '127.0.0.1',
      workflowDir: WEBHOOK_TEMP_DIR,
      watchEnabled: false,
      corsOrigin: '*',
      production: false,
      precompile: false,
      ...overrides,
    });
  }

  it('start() sets up health, list, and execute routes', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    expect(mockFastifyInstance.get).toHaveBeenCalled();
    expect(mockFastifyInstance.post).toHaveBeenCalled();

    // Verify health route was registered
    const getArgs = (mockFastifyInstance.get as ReturnType<typeof vi.fn>).mock.calls;
    const getPaths = getArgs.map((c: unknown[]) => c[0]);
    expect(getPaths).toContain('/health');
    expect(getPaths).toContain('/workflows');

    // Verify execute route
    const postArgs = (mockFastifyInstance.post as ReturnType<typeof vi.fn>).mock.calls;
    const postPaths = postArgs.map((c: unknown[]) => c[0]);
    expect(postPaths).toContain('/workflows/:name');

    // Verify listen was called
    expect(mockFastifyInstance.listen).toHaveBeenCalledWith({
      port: 4000,
      host: '127.0.0.1',
    });

    await server.stop();
  });

  it('start() registers CORS', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    expect(mockFastifyInstance.register).toHaveBeenCalled();

    await server.stop();
  });

  it('start() sets up swagger routes when swaggerEnabled is true', async () => {
    const server = createServerWithMockFastify({ swaggerEnabled: true });
    await server.start();

    const getArgs = (mockFastifyInstance.get as ReturnType<typeof vi.fn>).mock.calls;
    const getPaths = getArgs.map((c: unknown[]) => c[0]);
    expect(getPaths).toContain('/openapi.json');
    expect(getPaths).toContain('/docs');

    await server.stop();
  });

  it('start() does not set up swagger routes when swaggerEnabled is false', async () => {
    const server = createServerWithMockFastify({ swaggerEnabled: false });
    await server.start();

    const getArgs = (mockFastifyInstance.get as ReturnType<typeof vi.fn>).mock.calls;
    const getPaths = getArgs.map((c: unknown[]) => c[0]);
    expect(getPaths).not.toContain('/openapi.json');
    expect(getPaths).not.toContain('/docs');

    await server.stop();
  });

  it('stop() closes the fastify instance', async () => {
    const server = createServerWithMockFastify();
    await server.start();
    await server.stop();

    expect(mockFastifyInstance.close).toHaveBeenCalledTimes(1);
  });

  it('health route returns status and workflow count', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    const healthHandler = routeHandlers.get('GET:/health')?.handler;
    expect(healthHandler).toBeDefined();

    const result = await healthHandler!();
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeDefined();
    expect(typeof result.workflows).toBe('number');
    expect(typeof result.uptime).toBe('number');

    await server.stop();
  });

  it('list route returns workflow metadata', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    const listHandler = routeHandlers.get('GET:/workflows')?.handler;
    expect(listHandler).toBeDefined();

    const result = await listHandler!();
    expect(typeof result.count).toBe('number');
    expect(Array.isArray(result.workflows)).toBe(true);

    await server.stop();
  });

  it('execute route returns 404 for unknown workflow', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    const executeHandler = routeHandlers.get('POST:/workflows/:name')?.handler;
    expect(executeHandler).toBeDefined();

    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      type: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };

    const result = await executeHandler!(
      { params: { name: 'nonexistent' }, body: {}, query: {} },
      mockReply,
    );

    expect(mockReply.status).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('nonexistent');

    await server.stop();
  });

  it('execute route calls executeWorkflowFromFile for a known workflow', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    const executeHandler = routeHandlers.get('POST:/workflows/:name')?.handler;
    expect(executeHandler).toBeDefined();

    mockExecuteWorkflowFromFile.mockResolvedValue({
      functionName: 'doubler',
      executionTime: 42,
      result: { doubled: 10 },
    });

    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      type: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };

    const result = await executeHandler!(
      { params: { name: 'doubler' }, body: { value: 5 }, query: {} },
      mockReply,
    );

    expect(result.success).toBe(true);
    expect(result.workflow).toBe('doubler');
    expect(result.executionTime).toBe(42);
    expect(result.result).toEqual({ doubled: 10 });

    await server.stop();
  });

  it('execute route includes trace when query trace=true', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    const executeHandler = routeHandlers.get('POST:/workflows/:name')?.handler;

    mockExecuteWorkflowFromFile.mockResolvedValue({
      functionName: 'doubler',
      executionTime: 10,
      result: {},
      trace: [{ type: 'NODE_STARTED', timestamp: 1000 }],
    });

    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      type: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };

    const result = await executeHandler!(
      { params: { name: 'doubler' }, body: {}, query: { trace: 'true' } },
      mockReply,
    );

    expect(result.trace).toBeDefined();
    expect(result.trace[0].type).toBe('NODE_STARTED');

    await server.stop();
  });

  it('execute route returns 500 when executeWorkflowFromFile throws', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    const executeHandler = routeHandlers.get('POST:/workflows/:name')?.handler;

    mockExecuteWorkflowFromFile.mockRejectedValue(new Error('compile error'));

    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      type: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };

    const result = await executeHandler!(
      { params: { name: 'doubler' }, body: {}, query: {} },
      mockReply,
    );

    expect(mockReply.status).toHaveBeenCalledWith(500);
    expect(result.success).toBe(false);
    expect(result.error.message).toBe('compile error');
    expect(result.error.stack).toBeDefined();

    await server.stop();
  });

  it('execute route handles non-Error throws', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    const executeHandler = routeHandlers.get('POST:/workflows/:name')?.handler;

    mockExecuteWorkflowFromFile.mockRejectedValue('string error');

    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      type: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };

    const result = await executeHandler!(
      { params: { name: 'doubler' }, body: {}, query: {} },
      mockReply,
    );

    expect(result.success).toBe(false);
    expect(result.error.message).toBe('string error');
    expect(result.error.stack).toBeUndefined();

    await server.stop();
  });

  it('execute route uses empty object when body is missing', async () => {
    const server = createServerWithMockFastify();
    await server.start();

    const executeHandler = routeHandlers.get('POST:/workflows/:name')?.handler;

    mockExecuteWorkflowFromFile.mockResolvedValue({
      functionName: 'doubler',
      executionTime: 5,
      result: {},
    });

    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      type: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };

    const result = await executeHandler!(
      { params: { name: 'doubler' }, body: undefined, query: {} },
      mockReply,
    );

    expect(result.success).toBe(true);
    // The second arg to executeWorkflowFromFile should be {} (fallback)
    expect(mockExecuteWorkflowFromFile.mock.calls[0][1]).toEqual({});

    await server.stop();
  });
});
