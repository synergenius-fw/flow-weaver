/**
 * Coverage tests for src/cli/commands/validate.ts (round 3)
 *
 * Targets uncovered branches:
 *  - Agent validation rules injecting errors/warnings into validation result
 *  - Friendly error display with location, connection, docUrl fields
 *  - Warning display with friendly errors, location, node, docUrl
 *  - Per-file catch block recording errors in JSON mode with proper structure
 *  - Summary singular vs plural formatting for errors/warnings
 *  - Summary with both errors and warnings
 *  - statSync catch in file filter (line 57-59)
 *  - Outer catch re-throw when json=false (line 304)
 *  - JSON validation result with nodeId and code fields
 */

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockParseWorkflow,
  mockValidate,
  mockGetAgentValidationRules,
  mockGetFriendlyError,
  mockGetErrorMessage,
  mockGlob,
  mockExistsSync,
  mockStatSync,
} = vi.hoisted(() => ({
  mockParseWorkflow: vi.fn(),
  mockValidate: vi.fn(),
  mockGetAgentValidationRules: vi.fn(),
  mockGetFriendlyError: vi.fn(),
  mockGetErrorMessage: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : String(e)
  ),
  mockGlob: vi.fn(),
  mockExistsSync: vi.fn(),
  mockStatSync: vi.fn(),
}));

vi.mock('glob', () => ({
  glob: mockGlob,
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    statSync: mockStatSync,
  };
});

vi.mock('../../src/api/index.js', () => ({
  parseWorkflow: mockParseWorkflow,
}));

vi.mock('../../src/validator.js', () => ({
  validator: { validate: mockValidate },
}));

vi.mock('../../src/validation/agent-rules.js', () => ({
  getAgentValidationRules: mockGetAgentValidationRules,
}));

vi.mock('../../src/friendly-errors.js', () => ({
  getFriendlyError: mockGetFriendlyError,
}));

vi.mock('../../src/utils/error-utils.js', () => ({
  getErrorMessage: mockGetErrorMessage,
}));

// ── Imports ────────────────────────────────────────────────────────────────

import { validateCommand } from '../../src/cli/commands/validate';

// ── Helpers ────────────────────────────────────────────────────────────────

let logOutput: string[];
let errorOutput: string[];
let warnOutput: string[];
let origLog: typeof console.log;
let origError: typeof console.error;
let origWarn: typeof console.warn;
let origExit: typeof process.exit;

beforeEach(() => {
  logOutput = [];
  errorOutput = [];
  warnOutput = [];
  origLog = console.log;
  origError = console.error;
  origWarn = console.warn;
  origExit = process.exit;
  console.log = (...args: unknown[]) => logOutput.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errorOutput.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => warnOutput.push(args.map(String).join(' '));
  process.exit = vi.fn() as never;
  process.exitCode = undefined;

  vi.clearAllMocks();

  // Defaults: glob returns one file, fs says it's not a directory but is a file
  mockGlob.mockResolvedValue(['/fake/workflow.ts']);
  mockExistsSync.mockReturnValue(false);
  mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
  mockGetAgentValidationRules.mockReturnValue([]);
  mockGetFriendlyError.mockReturnValue(null);
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  console.warn = origWarn;
  process.exit = origExit;
  process.exitCode = undefined;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('validateCommand coverage round 3', () => {
  describe('agent validation rules producing errors and warnings', () => {
    it('should merge agent rule errors into validation result', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: { nodes: [], connections: [] },
        warnings: [],
        errors: [],
      });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });
      mockGetAgentValidationRules.mockReturnValue([
        {
          validate: () => [
            { type: 'error', message: 'Agent LLM missing error handler', node: 'llm1', code: 'AGENT_LLM_MISSING_ERROR_HANDLER' },
          ],
        },
      ]);

      await validateCommand('/fake/pattern', { json: true });

      const output = JSON.parse(logOutput.join(''));
      expect(output.valid).toBe(false);
      expect(output.totalErrors).toBe(1);
      expect(output.results[0].errors[0].message).toBe('Agent LLM missing error handler');
      expect(output.results[0].errors[0].nodeId).toBe('llm1');
      expect(output.results[0].errors[0].code).toBe('AGENT_LLM_MISSING_ERROR_HANDLER');
    });

    it('should merge agent rule warnings into validation result', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: { nodes: [], connections: [] },
        warnings: [],
        errors: [],
      });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });
      mockGetAgentValidationRules.mockReturnValue([
        {
          validate: () => [
            { type: 'warning', message: 'Unguarded tool executor', node: 'tool1', code: 'AGENT_UNGUARDED' },
          ],
        },
      ]);

      await validateCommand('/fake/pattern', { json: true });

      const output = JSON.parse(logOutput.join(''));
      expect(output.valid).toBe(true);
      expect(output.totalWarnings).toBe(1);
      expect(output.results[0].warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: 'Unguarded tool executor' }),
        ])
      );
    });
  });

  describe('friendly error display for validation errors', () => {
    it('should display friendly error with location and docUrl', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        warnings: [],
        errors: [],
      });
      mockValidate.mockReturnValue({
        valid: false,
        errors: [
          {
            message: 'Port not found',
            type: 'error',
            location: { line: 42 },
            docUrl: 'https://docs.example.com/port',
          },
        ],
        warnings: [],
      });
      mockGetFriendlyError.mockReturnValue({
        title: 'Missing Port',
        explanation: 'The port does not exist on this node.',
        fix: 'Check the port name.',
        code: 'PORT_NOT_FOUND',
      });

      await validateCommand('/fake/pattern', { json: false, verbose: true });

      const allErrors = errorOutput.join('\n');
      expect(allErrors).toContain('[line 42]');
      expect(allErrors).toContain('Missing Port');
      expect(allErrors).toContain('The port does not exist on this node.');
      const allWarns = warnOutput.join('\n');
      expect(allWarns).toContain('How to fix:');
      expect(allWarns).toContain('See: https://docs.example.com/port');
    });

    it('should display friendly error without location', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: false,
        errors: [
          { message: 'Some error', type: 'error' },
        ],
        warnings: [],
      });
      mockGetFriendlyError.mockReturnValue({
        title: 'Bad Config',
        explanation: 'Configuration is wrong.',
        fix: 'Fix it.',
        code: 'BAD_CONFIG',
      });

      await validateCommand('/fake/pattern', { json: false });

      const allErrors = errorOutput.join('\n');
      // No [line X] prefix when no location
      expect(allErrors).not.toContain('[line');
      expect(allErrors).toContain('Bad Config');
    });

    it('should display non-friendly error with location, node, and connection info', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        warnings: [],
        errors: [],
      });
      mockValidate.mockReturnValue({
        valid: false,
        errors: [
          {
            message: 'Type mismatch',
            type: 'error',
            location: { line: 10 },
            node: 'nodeA',
            connection: {
              from: { node: 'nodeA', port: 'out' },
              to: { node: 'nodeB', port: 'in' },
            },
            docUrl: 'https://docs.example.com/types',
          },
        ],
        warnings: [],
      });
      mockGetFriendlyError.mockReturnValue(null);

      await validateCommand('/fake/pattern', { json: false });

      const allErrors = errorOutput.join('\n');
      expect(allErrors).toContain('[line 10]');
      expect(allErrors).toContain('Type mismatch');
      expect(allErrors).toContain('(node: nodeA)');
      expect(allErrors).toContain('(connection: nodeA:out -> nodeB:in)');
      const allWarns = warnOutput.join('\n');
      expect(allWarns).toContain('See: https://docs.example.com/types');
    });

    it('should display non-friendly error without location, node, or connection', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: false,
        errors: [{ message: 'Generic error', type: 'error' }],
        warnings: [],
      });
      mockGetFriendlyError.mockReturnValue(null);

      await validateCommand('/fake/pattern', { json: false });

      const allErrors = errorOutput.join('\n');
      expect(allErrors).toContain('- Generic error');
      expect(allErrors).not.toContain('[line');
      expect(allErrors).not.toContain('(node:');
      expect(allErrors).not.toContain('(connection:');
    });

    it('should display non-friendly error with docUrl but no friendly match', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: false,
        errors: [
          { message: 'Some error', type: 'error', docUrl: 'https://docs.example.com/err' },
        ],
        warnings: [],
      });
      mockGetFriendlyError.mockReturnValue(null);

      await validateCommand('/fake/pattern', { json: false });

      const allWarns = warnOutput.join('\n');
      expect(allWarns).toContain('See: https://docs.example.com/err');
    });
  });

  describe('friendly error display for validation warnings', () => {
    it('should display friendly warning with location and docUrl', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [
          {
            message: 'Implicit coercion',
            type: 'warning',
            location: { line: 7 },
            docUrl: 'https://docs.example.com/coercion',
          },
        ],
      });
      mockGetFriendlyError.mockReturnValue({
        title: 'Type Coercion',
        explanation: 'Implicit conversion between types.',
        fix: 'Use explicit conversion.',
        code: 'TYPE_COERCION',
      });

      await validateCommand('/fake/pattern', { json: false, quiet: false });

      const allWarns = warnOutput.join('\n');
      expect(allWarns).toContain('[line 7]');
      expect(allWarns).toContain('Type Coercion');
      expect(allWarns).toContain('How to fix:');
      expect(allWarns).toContain('See: https://docs.example.com/coercion');
    });

    it('should display friendly warning without location', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [
          { message: 'Warn', type: 'warning' },
        ],
      });
      mockGetFriendlyError.mockReturnValue({
        title: 'Warning Title',
        explanation: 'Some explanation.',
        fix: 'Fix suggestion.',
        code: 'WARN_CODE',
      });

      await validateCommand('/fake/pattern', { json: false, quiet: false });

      const allWarns = warnOutput.join('\n');
      expect(allWarns).not.toContain('[line');
      expect(allWarns).toContain('Warning Title');
    });

    it('should display non-friendly warning with location, node, and docUrl', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [
          {
            message: 'Unused output',
            type: 'warning',
            location: { line: 15 },
            node: 'processorNode',
            docUrl: 'https://docs.example.com/unused',
          },
        ],
      });
      mockGetFriendlyError.mockReturnValue(null);

      await validateCommand('/fake/pattern', { json: false, quiet: false });

      const allWarns = warnOutput.join('\n');
      expect(allWarns).toContain('[line 15]');
      expect(allWarns).toContain('Unused output');
      expect(allWarns).toContain('(node: processorNode)');
      expect(allWarns).toContain('See: https://docs.example.com/unused');
    });

    it('should display non-friendly warning without location or node', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [{ message: 'General warning', type: 'warning' }],
      });
      mockGetFriendlyError.mockReturnValue(null);

      await validateCommand('/fake/pattern', { json: false, quiet: false });

      const allWarns = warnOutput.join('\n');
      expect(allWarns).toContain('- General warning');
    });

    it('should suppress warnings in quiet mode', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        warnings: ['Parse-level warning'],
        errors: [],
      });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [{ message: 'Validation warning', type: 'warning' }],
      });

      await validateCommand('/fake/pattern', { json: false, quiet: true });

      const allWarns = warnOutput.join('\n');
      expect(allWarns).not.toContain('Parse-level warning');
      expect(allWarns).not.toContain('Validation warning');
    });
  });

  describe('parse warnings display', () => {
    it('should display parse warnings when not quiet and not json', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        warnings: ['Deprecated annotation used', 'Unknown tag ignored'],
        errors: [],
      });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { json: false, quiet: false });

      const allWarns = warnOutput.join('\n');
      expect(allWarns).toContain('Deprecated annotation used');
      expect(allWarns).toContain('Unknown tag ignored');
    });
  });

  describe('parse errors handling', () => {
    it('should skip non-workflow files silently in non-verbose mode', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        warnings: [],
        errors: ['No workflows found in this file'],
      });

      await validateCommand('/fake/pattern', { json: false, verbose: false });

      expect(errorOutput.join('\n')).not.toContain('No workflows found');
    });

    it('should record parse errors in JSON mode with string-to-object mapping', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        warnings: ['a warning'],
        errors: ['Parse error: invalid syntax', { message: 'Structured error', severity: 'error' }],
      });

      await validateCommand('/fake/pattern', { json: true });

      const output = JSON.parse(logOutput.join(''));
      expect(output.totalErrors).toBe(2);
      const result = output.results[0];
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toEqual({ message: 'Parse error: invalid syntax', severity: 'error' });
      expect(result.warnings[0]).toEqual({ message: 'a warning', severity: 'warning' });
    });

    it('should display parse errors in non-JSON mode', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        warnings: [],
        errors: ['Node type "ghost" not found', 'Duplicate node id "x"'],
      });

      await validateCommand('/fake/pattern', { json: false });

      const allErrors = errorOutput.join('\n');
      expect(allErrors).toContain('Node type "ghost" not found');
      expect(allErrors).toContain('Duplicate node id "x"');
    });
  });

  describe('per-file catch block', () => {
    it('should record thrown error in JSON mode', async () => {
      mockParseWorkflow.mockRejectedValue(new Error('Unexpected parse failure'));

      await validateCommand('/fake/pattern', { json: true });

      const output = JSON.parse(logOutput.join(''));
      expect(output.totalErrors).toBe(1);
      expect(output.results[0].valid).toBe(false);
      expect(output.results[0].errors[0].message).toBe('Unexpected parse failure');
      expect(output.results[0].errors[0].severity).toBe('error');
    });

    it('should log error in non-JSON mode when file throws', async () => {
      mockParseWorkflow.mockRejectedValue(new Error('Crash during parse'));

      await validateCommand('/fake/pattern', { json: false });

      const allErrors = errorOutput.join('\n');
      expect(allErrors).toContain('Failed to validate');
      expect(allErrors).toContain('Crash during parse');
    });
  });

  describe('summary formatting', () => {
    it('should show singular "error" and plural "warnings"', async () => {
      mockGlob.mockResolvedValue(['/fake/a.ts', '/fake/b.ts']);

      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });

      let validateCallCount = 0;
      mockValidate.mockImplementation(() => {
        validateCallCount++;
        if (validateCallCount === 1) {
          return {
            valid: false,
            errors: [{ message: 'err1', type: 'error' }],
            warnings: [{ message: 'w1', type: 'warning' }, { message: 'w2', type: 'warning' }],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      });

      await validateCommand('/fake/pattern', { json: false });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toMatch(/1 error[^s]/);
      expect(allLogs).toContain('2 warnings');
    });

    it('should show plural "errors" when count > 1', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: false,
        errors: [
          { message: 'err1', type: 'error' },
          { message: 'err2', type: 'error' },
        ],
        warnings: [],
      });

      await validateCommand('/fake/pattern', { json: false });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('2 errors');
    });

    it('should show warnings-only summary when no errors', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [{ message: 'w1', type: 'warning' }],
      });

      await validateCommand('/fake/pattern', { json: false, quiet: false });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('1 valid');
      expect(allLogs).toContain('1 warning');
    });

    it('should show singular "file" when only 1 valid file', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { json: false });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toMatch(/1 file[^s]/);
    });

    it('should show plural "files" when multiple valid', async () => {
      mockGlob.mockResolvedValue(['/fake/a.ts', '/fake/b.ts']);
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { json: false });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('2 files');
    });
  });

  describe('no files found', () => {
    it('should output JSON error and set exitCode when json=true', async () => {
      mockGlob.mockResolvedValue([]);

      await validateCommand('/fake/nope', { json: true });

      expect(process.exitCode).toBe(1);
      const output = JSON.parse(logOutput[0]);
      expect(output.error).toContain('No files found');
    });

    it('should throw when json=false and no files found', async () => {
      mockGlob.mockResolvedValue([]);

      await expect(
        validateCommand('/fake/nope', { json: false })
      ).rejects.toThrow('No files found');
    });
  });

  describe('directory input expansion', () => {
    it('should convert directory input to glob pattern', async () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({
        isDirectory: () => true,
        isFile: () => true,
      });
      mockGlob.mockResolvedValue(['/fake/dir/file.ts']);
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/dir', { json: false });

      expect(mockGlob).toHaveBeenCalledWith(
        expect.stringContaining('**/*.ts'),
        expect.any(Object)
      );
    });

    it('should handle existsSync throwing and treat input as glob pattern', async () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      mockGlob.mockResolvedValue(['/fake/file.ts']);
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { json: false });

      // Should not throw, glob called with original pattern
      expect(mockGlob).toHaveBeenCalledWith('/fake/pattern', expect.any(Object));
    });
  });

  describe('statSync catch in file filter', () => {
    it('should filter out files where statSync throws', async () => {
      mockGlob.mockResolvedValue(['/fake/good.ts', '/fake/broken.ts']);

      mockStatSync.mockImplementation((p: string) => {
        if (String(p).includes('broken')) {
          throw new Error('ENOENT');
        }
        return { isDirectory: () => false, isFile: () => true };
      });

      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { json: true });

      const output = JSON.parse(logOutput.join(''));
      expect(output.totalFiles).toBe(1);
    });
  });

  describe('outer catch block', () => {
    it('should output JSON error when glob throws with json=true', async () => {
      mockGlob.mockRejectedValue(new Error('glob exploded'));

      await validateCommand('/fake/pattern', { json: true });

      expect(process.exitCode).toBe(1);
      const output = JSON.parse(logOutput[0]);
      expect(output.error).toBe('glob exploded');
    });

    it('should re-throw when glob throws with json=false', async () => {
      mockGlob.mockRejectedValue(new Error('glob exploded'));

      await expect(
        validateCommand('/fake/pattern', { json: false })
      ).rejects.toThrow('glob exploded');
    });
  });

  describe('JSON output structure', () => {
    it('should include nodeId and code in JSON validation errors', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: false,
        errors: [
          { message: 'Port not found', type: 'error', node: 'myNode', code: 'PORT_NOT_FOUND' },
        ],
        warnings: [
          { message: 'Type coercion', type: 'warning', node: 'otherNode', code: 'TYPE_COERCE' },
        ],
      });

      await validateCommand('/fake/pattern', { json: true });

      const output = JSON.parse(logOutput.join(''));
      expect(output.results[0].errors[0]).toEqual({
        message: 'Port not found',
        severity: 'error',
        nodeId: 'myNode',
        code: 'PORT_NOT_FOUND',
      });
      expect(output.results[0].warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Type coercion',
            severity: 'warning',
            nodeId: 'otherNode',
            code: 'TYPE_COERCE',
          }),
        ])
      );
    });

    it('should include parse warnings alongside validation warnings in JSON', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        warnings: ['Deprecated tag'],
        errors: [],
      });
      mockValidate.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [{ message: 'Runtime warning', type: 'warning' }],
      });

      await validateCommand('/fake/pattern', { json: true });

      const output = JSON.parse(logOutput.join(''));
      const warnings = output.results[0].warnings;
      expect(warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: 'Deprecated tag', severity: 'warning' }),
          expect.objectContaining({ message: 'Runtime warning', severity: 'warning' }),
        ])
      );
    });

    it('should produce correct JSON summary', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { json: true });

      const output = JSON.parse(logOutput.join(''));
      expect(output).toEqual({
        valid: true,
        totalFiles: 1,
        validFiles: 1,
        totalErrors: 0,
        totalWarnings: 0,
        results: expect.any(Array),
      });
    });
  });

  describe('verbose progress display', () => {
    it('should show progress and file count in verbose non-json mode', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { json: false, verbose: true });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('1 file(s)');
      expect(allLogs).toContain('workflow.ts');
    });
  });

  describe('strict mode', () => {
    it('should pass strictMode to validator', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { strict: true });

      expect(mockValidate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ strictMode: true })
      );
    });
  });

  describe('workflowName option', () => {
    it('should pass workflowName to parseWorkflow', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await validateCommand('/fake/pattern', { workflowName: 'myWf' });

      expect(mockParseWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ workflowName: 'myWf' })
      );
    });
  });

  describe('process.exit on errors', () => {
    it('should call process.exit(1) when there are validation errors', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, warnings: [], errors: [] });
      mockValidate.mockReturnValue({
        valid: false,
        errors: [{ message: 'err', type: 'error' }],
        warnings: [],
      });

      await validateCommand('/fake/pattern', { json: false });

      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
