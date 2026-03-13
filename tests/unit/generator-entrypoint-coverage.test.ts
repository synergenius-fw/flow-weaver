/**
 * Coverage for generator.ts (WorkflowGenerator class):
 * - Line 72: sourceMap=true branch
 * - Lines 88-92: parse errors branch (logs errors, throws)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api modules before importing the generator
vi.mock('../../src/api/parse', () => ({
  parseWorkflow: vi.fn(),
}));
vi.mock('../../src/api/validate', () => ({
  validateWorkflow: vi.fn(),
}));
vi.mock('../../src/api/generate', () => ({
  generateCode: vi.fn(),
}));

import { WorkflowGenerator } from '../../src/generator';
import { parseWorkflow } from '../../src/api/parse';
import { validateWorkflow } from '../../src/api/validate';
import { generateCode } from '../../src/api/generate';

const mockParseWorkflow = vi.mocked(parseWorkflow);
const mockValidateWorkflow = vi.mocked(validateWorkflow);
const mockGenerateCode = vi.mocked(generateCode);

function makeParseResult(overrides: Record<string, unknown> = {}) {
  return {
    ast: {
      type: 'Workflow',
      functionName: 'test',
      nodeTypes: [],
      instances: [],
      connections: [],
      macros: [],
    },
    errors: [],
    allWorkflows: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WorkflowGenerator.generate', () => {
  it('should pass sourceMap: true to generateCode when requested', async () => {
    mockParseWorkflow.mockResolvedValue(makeParseResult() as any);
    mockValidateWorkflow.mockReturnValue({ valid: true, errors: [], warnings: [] } as any);
    mockGenerateCode.mockReturnValue({ code: 'output', sourceMap: '{}' } as any);

    const gen = new WorkflowGenerator();
    const result = await gen.generate('/test.ts', 'test', { sourceMap: true });

    expect(mockGenerateCode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceMap: true })
    );
    expect(result).toEqual({ code: 'output', sourceMap: '{}' });
  });

  it('should throw when parse returns errors', async () => {
    mockParseWorkflow.mockResolvedValue(
      makeParseResult({ errors: ['Missing @workflow annotation', 'Unknown node type'] }) as any
    );

    const gen = new WorkflowGenerator();
    await expect(gen.generate('/test.ts', 'test')).rejects.toThrow(
      'Workflow parsing failed with 2 error(s)'
    );
  });
});
