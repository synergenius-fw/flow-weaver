/**
 * Tests for src/ast/serialization-node.ts.
 * Covers saveAST, loadAST, saveASTAlongside, loadASTAlongside
 * with mocked fs/promises.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
}));

import * as fs from 'node:fs/promises';
import { saveAST, loadAST, saveASTAlongside, loadASTAlongside } from '../../../src/ast/serialization-node';
import type { TWorkflowAST } from '../../../src/ast/types';

const mockWriteFile = vi.mocked(fs.writeFile);
const mockReadFile = vi.mocked(fs.readFile);

function makeMinimalAST(overrides?: Partial<TWorkflowAST>): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: '/src/example.ts',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: {},
    exitPorts: {},
    imports: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveAST', () => {
  it('writes pretty-printed JSON to the given path', async () => {
    const ast = makeMinimalAST();
    await saveAST(ast, '/out/workflow.ast.json');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [filePath, content, encoding] = mockWriteFile.mock.calls[0];
    expect(filePath).toBe('/out/workflow.ast.json');
    expect(encoding).toBe('utf-8');

    // Content should be valid JSON with indentation (pretty = true)
    const parsed = JSON.parse(content as string);
    expect(parsed.type).toBe('Workflow');
    expect(parsed.name).toBe('testWorkflow');
    expect((content as string)).toContain('\n'); // indented
  });
});

describe('loadAST', () => {
  it('reads and deserializes a valid AST file', async () => {
    const ast = makeMinimalAST({ name: 'loaded' });
    mockReadFile.mockResolvedValueOnce(JSON.stringify(ast));

    const result = await loadAST('/input/my.ast.json');
    expect(mockReadFile).toHaveBeenCalledWith('/input/my.ast.json', 'utf-8');
    expect(result.type).toBe('Workflow');
    expect(result.name).toBe('loaded');
  });

  it('throws when file contains non-Workflow JSON', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ type: 'NotWorkflow' }));
    await expect(loadAST('/bad.json')).rejects.toThrow('Invalid AST');
  });

  it('throws on invalid JSON', async () => {
    mockReadFile.mockResolvedValueOnce('not json at all');
    await expect(loadAST('/bad.json')).rejects.toThrow();
  });
});

describe('saveAST / loadAST round-trip', () => {
  it('round-trips through save and load', async () => {
    const original = makeMinimalAST({ name: 'roundTrip', description: 'test desc' });
    let captured = '';

    mockWriteFile.mockImplementationOnce(async (_path, data) => {
      captured = data as string;
    });

    await saveAST(original, '/tmp/rt.ast.json');

    mockReadFile.mockResolvedValueOnce(captured);
    const loaded = await loadAST('/tmp/rt.ast.json');

    expect(loaded.name).toBe('roundTrip');
    expect(loaded.description).toBe('test desc');
    expect(loaded.type).toBe('Workflow');
  });
});

describe('saveASTAlongside', () => {
  it('derives .ast.json path from sourceFile and writes', async () => {
    const ast = makeMinimalAST({ sourceFile: '/project/src/my-workflow.ts' });
    const result = await saveASTAlongside(ast);

    expect(result).toBe('/project/src/my-workflow.ast.json');
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [filePath] = mockWriteFile.mock.calls[0];
    expect(filePath).toBe('/project/src/my-workflow.ast.json');
  });

  it('strips any extension from the source file', async () => {
    const ast = makeMinimalAST({ sourceFile: '/code/utils.flow.tsx' });
    const result = await saveASTAlongside(ast);
    expect(result).toBe('/code/utils.flow.ast.json');
  });
});

describe('loadASTAlongside', () => {
  it('derives .ast.json path from source file and loads', async () => {
    const ast = makeMinimalAST();
    mockReadFile.mockResolvedValueOnce(JSON.stringify(ast));

    const result = await loadASTAlongside('/project/src/pipeline.ts');
    expect(mockReadFile).toHaveBeenCalledWith('/project/src/pipeline.ast.json', 'utf-8');
    expect(result.type).toBe('Workflow');
  });

  it('handles source files with multiple dots', async () => {
    const ast = makeMinimalAST();
    mockReadFile.mockResolvedValueOnce(JSON.stringify(ast));

    await loadASTAlongside('/code/my.workflow.ts');
    expect(mockReadFile).toHaveBeenCalledWith('/code/my.workflow.ast.json', 'utf-8');
  });
});
