/**
 * Tests for the openapi command: the document `fw serve` publishes, written
 * to stdout or a file, from a mocked registry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';

const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockGetAllEndpoints = vi.fn().mockReturnValue([]);

vi.mock('../../src/server/workflow-registry.js', () => {
  return {
    WorkflowRegistry: class MockWorkflowRegistry {
      constructor(public dir: string) {}
      initialize = mockInitialize;
      getAllEndpoints = mockGetAllEndpoints;
    },
  };
});

vi.mock('../../src/cli/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    newline: vi.fn(),
    section: vi.fn(),
    progress: vi.fn(),
    dim: vi.fn((s: string) => s),
    bold: vi.fn((s: string) => s),
    highlight: vi.fn((s: string) => s),
    banner: vi.fn(),
    table: vi.fn(),
    spinner: vi.fn(() => ({ stop: vi.fn(), fail: vi.fn(), update: vi.fn() })),
    timer: vi.fn(() => ({ elapsed: () => '0ms', ms: () => 0 })),
  },
}));

import { openapiCommand } from '../../src/cli/commands/openapi';
import { logger } from '../../src/cli/utils/logger.js';

const OPENAPI_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-openapi-test-${process.pid}`);

const hello = {
  name: 'hello', functionName: 'hello', path: '/workflows/hello', method: 'POST', filePath: '/x/hello.ts', gates: 0,
  routes: [{ method: 'GET', path: '/hello/:id' }, { method: 'POST', path: '/hello', callback: true }],
  inputSchema: { type: 'object', properties: { id: { type: 'string' }, loud: { type: 'boolean' } }, required: ['id'] },
  outputSchema: { type: 'object', properties: { greeting: { type: 'string' } } },
};
const clash = { name: 'other', functionName: 'other', path: '/workflows/other', method: 'POST', filePath: '/x/other.ts', gates: 1, routes: [{ method: 'GET', path: '/hello/:id' }, { method: 'POST', path: '/runs/mine' }] };

beforeEach(() => {
  fs.mkdirSync(OPENAPI_TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(OPENAPI_TEMP_DIR, { recursive: true, force: true });
});

describe('openapiCommand', () => {
  let origStdoutWrite: typeof process.stdout.write;
  let stdoutChunks: string[];
  const out = () => stdoutChunks.join('');

  beforeEach(() => {
    origStdoutWrite = process.stdout.write;
    stdoutChunks = [];
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = origStdoutWrite;
  });

  it('should throw when directory does not exist', async () => {
    await expect(openapiCommand('/nonexistent/dir', {})).rejects.toThrow('Directory not found');
  });

  it('should throw when path is a file, not a directory', async () => {
    const filePath = path.join(OPENAPI_TEMP_DIR, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'content');
    await expect(openapiCommand(filePath, {})).rejects.toThrow('Not a directory');
  });

  it('should throw when no workflows are found', async () => {
    mockGetAllEndpoints.mockReturnValue([]);
    await expect(openapiCommand(OPENAPI_TEMP_DIR, {})).rejects.toThrow('No workflows found');
  });

  it('writes JSON to stdout by default, with the declared routes and the run resources', async () => {
    mockGetAllEndpoints.mockReturnValue([hello]);
    await openapiCommand(OPENAPI_TEMP_DIR, {});
    const doc = JSON.parse(out());
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.paths['/hello/{id}'].get.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'loud', in: 'query', required: false }),
    ]));
    expect(doc.paths['/hello'].post.requestBody.content['application/json'].schema.properties.callbackUrl).toBeDefined();
    expect(doc.paths['/hello'].post.responses['422']).toBeDefined();
    expect(doc.paths['/workflows/hello'].post).toBeDefined();
    expect(doc.paths['/runs/{runId}/resolve'].post).toBeDefined();
    expect(doc.components.securitySchemes.bearer).toEqual({ type: 'http', scheme: 'bearer' });
    expect(doc.servers).toEqual([{ url: '/' }]);
  });

  it('writes YAML when asked', async () => {
    mockGetAllEndpoints.mockReturnValue([hello]);
    await openapiCommand(OPENAPI_TEMP_DIR, { format: 'yaml' });
    const doc = yaml.load(out()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.paths['/hello/{id}']).toBeDefined();
  });

  it('writes to the output file and reports the count and the route problems', async () => {
    mockGetAllEndpoints.mockReturnValue([hello, clash]);
    const outputFile = path.join(OPENAPI_TEMP_DIR, 'openapi.json');
    await openapiCommand(OPENAPI_TEMP_DIR, { output: outputFile });
    const doc = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
    expect(doc.paths['/hello/{id}'].get.operationId).toBe('get_hello_by_id');
    expect(doc.paths['/runs/mine']).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('2 workflow(s), 2 declared route(s)'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already declared by hello'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('reserved path'));
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining(outputFile));
    expect(out()).toBe('');
  });

  it('takes title, version, description and server', async () => {
    mockGetAllEndpoints.mockReturnValue([hello]);
    await openapiCommand(OPENAPI_TEMP_DIR, { title: 'My API', version: '2.0.0', description: 'A test API', server: 'https://api.example.com/api' });
    const doc = JSON.parse(out());
    expect(doc.info).toEqual({ title: 'My API', version: '2.0.0', description: 'A test API' });
    expect(doc.servers).toEqual([{ url: 'https://api.example.com/api' }]);
  });

  it('leaves the bearer scheme and the run resources out when told to', async () => {
    mockGetAllEndpoints.mockReturnValue([hello]);
    await openapiCommand(OPENAPI_TEMP_DIR, { auth: false, legacy: false });
    const doc = JSON.parse(out());
    expect(doc.components.securitySchemes).toBeUndefined();
    expect(doc.security).toBeUndefined();
    expect(doc.paths['/workflows/hello']).toBeUndefined();
    expect(doc.paths['/hello']).toBeDefined();
  });

  it('initializes the registry before reading endpoints', async () => {
    mockGetAllEndpoints.mockReturnValue([hello]);
    await openapiCommand(OPENAPI_TEMP_DIR, {});
    expect(mockInitialize).toHaveBeenCalled();
    expect(mockGetAllEndpoints).toHaveBeenCalled();
  });
});
