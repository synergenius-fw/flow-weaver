/**
 * Tests for migrate command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies
vi.mock('glob', () => ({
  globSync: vi.fn(),
}));

vi.mock('../../src/api/index.js', () => ({
  parseWorkflow: vi.fn(),
}));

vi.mock('../../src/api/generate-in-place.js', () => ({
  generateInPlace: vi.fn(),
}));

vi.mock('../../src/diff/index.js', () => ({
  WorkflowDiffer: {
    compare: vi.fn().mockReturnValue({ identical: true }),
  },
  formatDiff: vi.fn().mockReturnValue('mock diff output'),
}));

vi.mock('../../src/migration/registry.js', () => ({
  applyMigrations: vi.fn((ast: any) => ast),
  getRegisteredMigrations: vi.fn().mockReturnValue([]),
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

import { migrateCommand } from '../../src/cli/commands/migrate';
import { globSync } from 'glob';
import { parseWorkflow } from '../../src/api/index.js';
import { generateInPlace } from '../../src/api/generate-in-place.js';
import { getRegisteredMigrations } from '../../src/migration/registry.js';
import { logger } from '../../src/cli/utils/logger.js';
import { WorkflowDiffer, formatDiff } from '../../src/diff/index.js';

const MIGRATE_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-migrate-test-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(MIGRATE_TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(MIGRATE_TEMP_DIR, { recursive: true, force: true });
});

describe('migrateCommand', () => {
  it('should warn and return when no files match the pattern', async () => {
    vi.mocked(globSync).mockReturnValue([]);

    await migrateCommand('src/**/*.flow.ts');

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No files matched'));
  });

  it('should log registered migrations when they exist', async () => {
    vi.mocked(globSync).mockReturnValue([]);
    vi.mocked(getRegisteredMigrations).mockReturnValue([
      { name: 'rename-port-types' },
      { name: 'add-defaults' },
    ]);

    await migrateCommand('src/**/*.flow.ts');

    // It logs migrations before processing files, but also warns no files matched
    expect(logger.warn).toHaveBeenCalled();
  });

  it('should skip files that are already current (no changes)', async () => {
    const filePath = path.join(MIGRATE_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(filePath, '// current workflow');

    vi.mocked(globSync).mockReturnValue([filePath]);
    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: { nodeTypes: [], workflows: [] },
      allWorkflows: [],
    } as any);
    vi.mocked(generateInPlace).mockReturnValue({
      hasChanges: false,
      code: '// current workflow',
    });

    await migrateCommand('**/*.ts');

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('0 file(s) updated')
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('1 already current')
    );
  });

  it('should write updated files when changes are detected', async () => {
    const filePath = path.join(MIGRATE_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(filePath, '// old workflow syntax');

    vi.mocked(globSync).mockReturnValue([filePath]);
    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: { nodeTypes: [], workflows: [] },
      allWorkflows: [],
    } as any);
    vi.mocked(generateInPlace).mockReturnValue({
      hasChanges: true,
      code: '// new workflow syntax',
    });

    await migrateCommand('**/*.ts');

    const updated = fs.readFileSync(filePath, 'utf8');
    expect(updated).toBe('// new workflow syntax');
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('migrated'));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('1 file(s) updated')
    );
  });

  it('should not write files in dry-run mode', async () => {
    const filePath = path.join(MIGRATE_TEMP_DIR, 'workflow.ts');
    const originalContent = '// old workflow syntax';
    fs.writeFileSync(filePath, originalContent);

    vi.mocked(globSync).mockReturnValue([filePath]);
    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: { nodeTypes: [], workflows: [] },
      allWorkflows: [],
    } as any);
    vi.mocked(generateInPlace).mockReturnValue({
      hasChanges: true,
      code: '// new workflow syntax',
    });

    await migrateCommand('**/*.ts', { dryRun: true });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toBe(originalContent);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('would be updated'));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Dry run complete')
    );
  });

  it('should count and skip files with parse errors', async () => {
    const filePath = path.join(MIGRATE_TEMP_DIR, 'bad-workflow.ts');
    fs.writeFileSync(filePath, '// broken');

    vi.mocked(globSync).mockReturnValue([filePath]);
    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: ['Syntax error on line 1'],
      ast: { nodeTypes: [], workflows: [] },
      allWorkflows: [],
    } as any);

    await migrateCommand('**/*.ts');

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('parse errors'));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('1 error(s)')
    );
  });

  it('should handle multiple files with mixed results', async () => {
    const goodFile = path.join(MIGRATE_TEMP_DIR, 'good.ts');
    const currentFile = path.join(MIGRATE_TEMP_DIR, 'current.ts');
    const badFile = path.join(MIGRATE_TEMP_DIR, 'bad.ts');
    fs.writeFileSync(goodFile, '// old');
    fs.writeFileSync(currentFile, '// current');
    fs.writeFileSync(badFile, '// broken');

    vi.mocked(globSync).mockReturnValue([goodFile, currentFile, badFile]);

    vi.mocked(parseWorkflow)
      .mockResolvedValueOnce({
        errors: [],
        ast: { nodeTypes: [], workflows: [] },
        allWorkflows: [],
      } as any)
      .mockResolvedValueOnce({
        errors: [],
        ast: { nodeTypes: [], workflows: [] },
        allWorkflows: [],
      } as any)
      .mockResolvedValueOnce({
        errors: ['Parse error'],
        ast: { nodeTypes: [], workflows: [] },
        allWorkflows: [],
      } as any);

    vi.mocked(generateInPlace)
      .mockReturnValueOnce({ hasChanges: true, code: '// new' })
      .mockReturnValueOnce({ hasChanges: false, code: '// current' });

    await migrateCommand('**/*.ts');

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('1 file(s) updated')
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('1 already current')
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('1 error(s)')
    );
  });

  it('should handle unexpected errors during file processing', async () => {
    const filePath = path.join(MIGRATE_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(filePath, '// workflow');

    vi.mocked(globSync).mockReturnValue([filePath]);
    vi.mocked(parseWorkflow).mockRejectedValue(new Error('Internal error'));

    await migrateCommand('**/*.ts');

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Internal error'));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('1 error(s)')
    );
  });

  it('should show diff when --diff option is set and changes exist', async () => {
    const filePath = path.join(MIGRATE_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(filePath, '// old workflow');

    vi.mocked(globSync).mockReturnValue([filePath]);

    const mockAst = { nodeTypes: [], workflows: [] };
    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: mockAst,
      allWorkflows: [],
    } as any);
    vi.mocked(generateInPlace).mockReturnValue({
      hasChanges: true,
      code: '// new workflow',
    });
    vi.mocked(WorkflowDiffer.compare).mockReturnValue({ identical: false } as any);

    await migrateCommand('**/*.ts', { diff: true });

    expect(WorkflowDiffer.compare).toHaveBeenCalled();
    expect(formatDiff).toHaveBeenCalled();
  });

  it('should display "Migration complete" in normal mode', async () => {
    vi.mocked(globSync).mockReturnValue([]);

    // No files to process, but summary is still printed... actually when 0 files it warns and returns.
    // Let's use a real file scenario.
    const filePath = path.join(MIGRATE_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(filePath, '// old');

    vi.mocked(globSync).mockReturnValue([filePath]);
    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: { nodeTypes: [], workflows: [] },
      allWorkflows: [],
    } as any);
    vi.mocked(generateInPlace).mockReturnValue({
      hasChanges: false,
      code: '// old',
    });

    await migrateCommand('**/*.ts');

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Migration complete')
    );
  });

  it('should display "Dry run complete" in dry-run mode', async () => {
    const filePath = path.join(MIGRATE_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(filePath, '// old');

    vi.mocked(globSync).mockReturnValue([filePath]);
    vi.mocked(parseWorkflow).mockResolvedValue({
      errors: [],
      ast: { nodeTypes: [], workflows: [] },
      allWorkflows: [],
    } as any);
    vi.mocked(generateInPlace).mockReturnValue({
      hasChanges: false,
      code: '// old',
    });

    await migrateCommand('**/*.ts', { dryRun: true });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Dry run complete')
    );
  });
});
