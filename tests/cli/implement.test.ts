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

vi.mock('../../src/annotation-generator.js', () => ({
  generateFunctionSignature: vi.fn(),
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

vi.mock('../../src/utils/error-utils.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { implementCommand } from '../../src/cli/commands/implement';
import { parseWorkflow } from '../../src/api/index.js';
import { generateFunctionSignature } from '../../src/annotation-generator.js';
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
  let origExit: typeof process.exit;

  beforeEach(() => {
    origExit = process.exit;
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.exit = origExit;
  });

  it('should exit(1) when input file does not exist', async () => {
    try {
      await implementCommand('/nonexistent/file.ts', 'myNode');
    } catch {
      // mocked process.exit doesn't halt
    }

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('File not found'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should exit(1) when workflow has parse errors', async () => {
    const inputFile = path.join(IMPL_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// bad workflow');

    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: ['Syntax error on line 5'],
      ast: { nodeTypes: [], workflows: [] },
      allWorkflows: [],
    } as any);

    try {
      await implementCommand(inputFile, 'myNode');
    } catch {
      // mocked process.exit doesn't halt
    }

    expect(logger.error).toHaveBeenCalledWith('Parse errors:');
    expect(process.exit).toHaveBeenCalledWith(1);
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

    try {
      await implementCommand(inputFile, 'myNode');
    } catch {
      // mocked process.exit doesn't halt
    }

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already implemented'));
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should exit(1) when stub node is not found and no stubs exist', async () => {
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

    try {
      await implementCommand(inputFile, 'nonExistentNode');
    } catch {
      // mocked process.exit doesn't halt
    }

    expect(logger.error).toHaveBeenCalledWith('No stub nodes found in this workflow.');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should exit(1) when stub node is not found but other stubs exist', async () => {
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

    try {
      await implementCommand(inputFile, 'nonExistentNode');
    } catch {
      // mocked process.exit doesn't halt
    }

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Available stubs: otherStub')
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should exit(1) when declare function is not found in source', async () => {
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

    try {
      await implementCommand(inputFile, 'myStub');
    } catch {
      // mocked process.exit doesn't halt
    }

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not find "declare function myStub"')
    );
    expect(process.exit).toHaveBeenCalledWith(1);
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

    try {
      await implementCommand(inputFile, 'myNode');
    } catch {
      // mocked process.exit doesn't halt
    }

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Implement failed')
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
