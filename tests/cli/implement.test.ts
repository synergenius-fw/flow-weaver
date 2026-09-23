/**
 * Tests for implement command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies
vi.mock('../../src/api/index.js', () => ({
  parseWorkflow: vi.fn(),
}));

vi.mock('../../src/generator/annotation-generator.js', () => ({
  generateFunctionSignature: vi.fn(),
}));

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

vi.mock('../../src/utils/error-utils.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { implementCommand } from '../../src/cli/commands/implement';
import { parseWorkflow } from '../../src/api/index.js';
import { generateFunctionSignature } from '../../src/generator/annotation-generator.js';
import { logger } from '../../src/cli/utils/logger.js';

const IMPL_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-implement-test-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(IMPL_TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(IMPL_TEMP_DIR, { recursive: true, force: true });
});

describe('implementCommand', () => {
  it('should throw when input file does not exist', async () => {
    await expect(
      implementCommand('/nonexistent/file.ts', 'myNode')
    ).rejects.toThrow(/File not found/);
  });

  it('should throw when workflow has parse errors', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// bad workflow');

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: ['Syntax error on line 5'],
      ast: { nodeTypes: [], workflows: [] },
      allWorkflows: [],
    } as any);

    await expect(
      implementCommand(inputFile, 'myNode')
    ).rejects.toThrow(/Parse errors/);
  });

  it('should exit(0) with warning when node is already implemented', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// workflow');

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myNode',
            functionName: 'myNode',
            variant: 'FUNCTION',
            inputs: {},
            outputs: {},
          },
        ],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    const origExit = process.exit;
    process.exit = vi.fn() as never;

    try {
      await implementCommand(inputFile, 'myNode');
    } catch {
      // process.exit(0) is mocked
    } finally {
      process.exit = origExit;
    }

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already implemented'));
  });

  it('should throw when stub node is not found and no stubs exist', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// workflow');

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    await expect(
      implementCommand(inputFile, 'nonExistentNode')
    ).rejects.toThrow(/No stub nodes found/);
  });

  it('should throw when stub node is not found but other stubs exist', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// workflow');

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'otherStub',
            functionName: 'otherStub',
            variant: 'STUB',
            inputs: {},
            outputs: {},
          },
        ],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    await expect(
      implementCommand(inputFile, 'nonExistentNode')
    ).rejects.toThrow(/Available stubs: otherStub/);
  });

  it('should throw when declare function is not found in source', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// no declare function here');

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myStub',
            functionName: 'myStub',
            variant: 'STUB',
            inputs: {},
            outputs: {},
          },
        ],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    await expect(
      implementCommand(inputFile, 'myStub')
    ).rejects.toThrow(/Could not find "declare function myStub"/);
  });

  it('should replace declare function with implementation when not in preview mode', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    const sourceContent = [
      '// @flowWeaver nodeType',
      'declare function myStub(x: number): { result: number };',
      '',
    ].join('\n');
    fs.writeFileSync(inputFile, sourceContent);

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myStub',
            functionName: 'myStub',
            variant: 'STUB',
            inputs: { x: { type: 'number' } },
            outputs: { result: { type: 'number' } },
          },
        ],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    vi.mocked(generateFunctionSignature).mockReturnValue([
      'function myStub(x: number): { result: number } {',
      '  // TODO: implement',
      '  return { result: 0 };',
      '}',
    ]);

    await implementCommand(inputFile, 'myStub');

    const updated = fs.readFileSync(inputFile, 'utf8');
    expect(updated).toContain('function myStub(x: number)');
    expect(updated).toContain('// TODO: implement');
    expect(updated).not.toContain('declare function');
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Implemented myStub'));
  });

  it('should output preview without modifying the file when --preview is set', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    const sourceContent = 'declare function myStub(x: number): { result: number };';
    fs.writeFileSync(inputFile, sourceContent);

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myStub',
            functionName: 'myStub',
            variant: 'STUB',
            inputs: {},
            outputs: {},
          },
        ],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    vi.mocked(generateFunctionSignature).mockReturnValue([
      'function myStub(x: number): { result: number } {',
      '  return { result: 0 };',
      '}',
    ]);

    await implementCommand(inputFile, 'myStub', { preview: true });

    // File should not be modified
    const afterContent = fs.readFileSync(inputFile, 'utf8');
    expect(afterContent).toBe(sourceContent);
    expect(logger.section).toHaveBeenCalledWith(expect.stringContaining('Preview'));
  });

  it('should find stub by name (not just functionName)', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, 'declare function processData(): void;');

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'ProcessData',
            functionName: 'processData',
            variant: 'STUB',
            inputs: {},
            outputs: {},
          },
        ],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    vi.mocked(generateFunctionSignature).mockReturnValue([
      'function processData(): void {',
      '  // TODO: implement',
      '}',
    ]);

    await implementCommand(inputFile, 'ProcessData');

    expect(logger.success).toHaveBeenCalled();
  });

  it('should pass workflowName option to parseWorkflow', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, 'declare function myStub(): void;');

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myStub',
            functionName: 'myStub',
            variant: 'STUB',
            inputs: {},
            outputs: {},
          },
        ],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    vi.mocked(generateFunctionSignature).mockReturnValue([
      'function myStub(): void {',
      '}',
    ]);

    await implementCommand(inputFile, 'myStub', { workflowName: 'MyWorkflow' });

    expect(parseWorkflow).toHaveBeenCalledWith(
      expect.any(String),
      { workflowName: 'MyWorkflow' }
    );
  });

  it('should handle multiline declare function statements', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    const sourceContent = [
      '// @flowWeaver nodeType',
      'declare function myStub(',
      '  x: number,',
      '  y: number',
      '): { result: number };',
      '',
    ].join('\n');
    fs.writeFileSync(inputFile, sourceContent);

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: {
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myStub',
            functionName: 'myStub',
            variant: 'STUB',
            inputs: {},
            outputs: {},
          },
        ],
        workflows: [],
      },
      allWorkflows: [],
    } as any);

    vi.mocked(generateFunctionSignature).mockReturnValue([
      'function myStub(x: number, y: number): { result: number } {',
      '  return { result: 0 };',
      '}',
    ]);

    await implementCommand(inputFile, 'myStub');

    const updated = fs.readFileSync(inputFile, 'utf8');
    expect(updated).toContain('function myStub(x: number, y: number)');
    expect(updated).not.toContain('declare function');
  });

  it('should catch and report unexpected errors', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// workflow');

    vi.mocked(parseWorkflow).mockRejectedValue(new Error('Unexpected internal error'));

    await expect(
      implementCommand(inputFile, 'myNode')
    ).rejects.toThrow(/Implement failed/);
  });
});
