/**
 * Tests for openapi command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies
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

vi.mock('../../src/deployment/openapi/generator.js', () => ({
  generateOpenAPIJson: vi.fn().mockReturnValue('{"openapi":"3.0.0"}'),
  generateOpenAPIYaml: vi.fn().mockReturnValue('openapi: "3.0.0"'),
}));

vi.mock('../../src/cli/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    newline: vi.fn(),
    section: vi.fn(),
  },
}));

import { openapiCommand } from '../../src/cli/commands/openapi';
import { WorkflowRegistry } from '../../src/server/workflow-registry.js';
import { generateOpenAPIJson, generateOpenAPIYaml } from '../../src/deployment/openapi/generator.js';
import { logger } from '../../src/cli/utils/logger.js';

const OPENAPI_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-openapi-test-${process.pid}`);

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
    await expect(
      openapiCommand('/nonexistent/dir', {})
    ).rejects.toThrow('Directory not found');
  });

  it('should throw when path is a file, not a directory', async () => {
    const filePath = path.join(OPENAPI_TEMP_DIR, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'content');

    await expect(
      openapiCommand(filePath, {})
    ).rejects.toThrow('Not a directory');
  });

  it('should throw when no workflows are found', async () => {
    mockGetAllEndpoints.mockReturnValue([]);

    await expect(
      openapiCommand(OPENAPI_TEMP_DIR, {})
    ).rejects.toThrow('No workflows found');
  });

  it('should generate JSON by default and output to stdout', async () => {
    mockGetAllEndpoints.mockReturnValue([
      { method: 'GET', path: '/api/hello', workflowName: 'hello' },
    ]);

    await openapiCommand(OPENAPI_TEMP_DIR, {});

    expect(generateOpenAPIJson).toHaveBeenCalled();
    expect(stdoutChunks.join('')).toContain('{"openapi":"3.0.0"}');
  });

  it('should generate YAML when format is yaml', async () => {
    mockGetAllEndpoints.mockReturnValue([
      { method: 'GET', path: '/api/hello', workflowName: 'hello' },
    ]);

    await openapiCommand(OPENAPI_TEMP_DIR, { format: 'yaml' });

    expect(generateOpenAPIYaml).toHaveBeenCalled();
    expect(stdoutChunks.join('')).toContain('openapi: "3.0.0"');
  });

  it('should write to output file when output option is provided', async () => {
    mockGetAllEndpoints.mockReturnValue([
      { method: 'GET', path: '/api/hello', workflowName: 'hello' },
    ]);

    const outputFile = path.join(OPENAPI_TEMP_DIR, 'openapi.json');

    await openapiCommand(OPENAPI_TEMP_DIR, { output: outputFile });

    expect(fs.existsSync(outputFile)).toBe(true);
    expect(fs.readFileSync(outputFile, 'utf-8')).toBe('{"openapi":"3.0.0"}');
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining(outputFile)
    );
  });

  it('should pass custom title, version, description, and server to generator', async () => {
    mockGetAllEndpoints.mockReturnValue([
      { method: 'GET', path: '/api/hello', workflowName: 'hello' },
    ]);

    await openapiCommand(OPENAPI_TEMP_DIR, {
      title: 'My API',
      version: '2.0.0',
      description: 'A test API',
      server: 'https://api.example.com',
    });

    expect(generateOpenAPIJson).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        title: 'My API',
        version: '2.0.0',
        description: 'A test API',
        servers: [{ url: 'https://api.example.com' }],
      })
    );
  });

  it('should use default title, version, and description when not specified', async () => {
    mockGetAllEndpoints.mockReturnValue([
      { method: 'GET', path: '/api/hello', workflowName: 'hello' },
    ]);

    await openapiCommand(OPENAPI_TEMP_DIR, {});

    expect(generateOpenAPIJson).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        title: 'Flow Weaver API',
        version: '1.0.0',
        description: 'API generated from Flow Weaver workflows',
      })
    );
  });

  it('should not include servers when server option is not provided', async () => {
    mockGetAllEndpoints.mockReturnValue([
      { method: 'GET', path: '/api/hello', workflowName: 'hello' },
    ]);

    await openapiCommand(OPENAPI_TEMP_DIR, {});

    expect(generateOpenAPIJson).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        servers: undefined,
      })
    );
  });

  it('should log the count of discovered workflows', async () => {
    mockGetAllEndpoints.mockReturnValue([
      { method: 'GET', path: '/api/a', workflowName: 'a' },
      { method: 'POST', path: '/api/b', workflowName: 'b' },
      { method: 'PUT', path: '/api/c', workflowName: 'c' },
    ]);

    await openapiCommand(OPENAPI_TEMP_DIR, {});

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('3 workflow(s)'));
  });

  it('should initialize the WorkflowRegistry before reading endpoints', async () => {
    mockGetAllEndpoints.mockReturnValue([
      { method: 'GET', path: '/api/hello', workflowName: 'hello' },
    ]);

    await openapiCommand(OPENAPI_TEMP_DIR, {});

    expect(mockInitialize).toHaveBeenCalled();
    expect(mockGetAllEndpoints).toHaveBeenCalled();
  });
});
