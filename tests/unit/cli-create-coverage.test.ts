/**
 * Coverage for cli/commands/create.ts (createNodeCommand):
 * - Line 164: invalid --config JSON in node creation (process.exit path)
 * - Line 183: "Inserted at line N" log when line is specified
 * - Lines 187-188: error catch block when insertIntoFile throws
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock logger to capture output
vi.mock('../../src/cli/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock templates
vi.mock('../../src/cli/templates/index', () => ({
  getNodeTemplate: vi.fn((name: string) => {
    if (name === 'processor') {
      return {
        name: 'processor',
        generate: (_nodeName: string, _config?: Record<string, unknown>) => '// generated node code',
      };
    }
    return null;
  }),
  getWorkflowTemplate: vi.fn(),
  toCamelCase: vi.fn((s: string) => s.replace(/-./g, (m) => m[1].toUpperCase())),
}));

import { createNodeCommand } from '../../src/cli/commands/create';
import { logger } from '../../src/cli/utils/logger';

const mockLogger = vi.mocked(logger);
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as any);
});

afterEach(() => {
  exitSpy.mockRestore();
});

describe('createNodeCommand: invalid config JSON', () => {
  it('should log error and exit when --config is invalid JSON', async () => {
    await expect(
      createNodeCommand('my-node', 'test.ts', { config: '{bad json}' })
    ).rejects.toThrow('process.exit called');

    expect(mockLogger.error).toHaveBeenCalledWith('Invalid --config JSON');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('createNodeCommand: successful creation with line number', () => {
  const tmpFile = path.join(__dirname, '__test-create-node-tmp.ts');

  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  it('should log the line number when line option is provided', async () => {
    // Create a file so insertIntoFile works
    fs.writeFileSync(tmpFile, '// line 1\n// line 2\n// line 3\n');

    await createNodeCommand('my-node', tmpFile, { line: 2 });

    expect(mockLogger.success).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Inserted at line 2'));
  });
});

describe('createNodeCommand: insertIntoFile failure', () => {
  it('should catch error and exit when file write fails', async () => {
    // Use a path inside a non-existent deeply nested directory that will fail
    // Actually, insertIntoFile creates dirs. Let's mock fs.writeFileSync to throw.
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);

    await expect(
      createNodeCommand('my-node', '/fake/path/test.ts', {})
    ).rejects.toThrow('process.exit called');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create node')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    writeSpy.mockRestore();
    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });
});
