/**
 * fw dev keeps watching when a cycle triggered by a file change fails in a
 * way compileAndRun does not report itself: the failure is logged and never
 * escapes the change handler as an unhandled rejection.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { mockWatcherOn, mockCompileCommand, mockExecuteWorkflow } = vi.hoisted(() => ({
  mockWatcherOn: vi.fn().mockReturnThis(),
  mockCompileCommand: vi.fn(),
  mockExecuteWorkflow: vi.fn(),
}));

vi.mock('chokidar', () => {
  const watch = vi.fn(() => ({ on: mockWatcherOn, close: vi.fn().mockResolvedValue(undefined) }));
  return { default: { watch }, watch };
});
vi.mock('../../../src/cli/commands/compile.js', () => ({ compileCommand: mockCompileCommand }));
vi.mock('../../../src/mcp/workflow-executor.js', () => ({ executeWorkflow: mockExecuteWorkflow }));
vi.mock('../../../src/cli/utils/logger.js', () => ({
  logger: {
    section: vi.fn(), info: vi.fn(), newline: vi.fn(), success: vi.fn(), log: vi.fn(),
    error: vi.fn(), warn: vi.fn(), debug: vi.fn(), dim: vi.fn(),
    timer: () => ({ elapsed: () => '1ms' }),
  },
}));

import { devCommand } from '../../../src/cli/commands/dev.js';
import { logger } from '../../../src/cli/utils/logger.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-dev-change-'));
  mockWatcherOn.mockClear();
  mockCompileCommand.mockReset();
  vi.mocked(logger.error).mockClear();
  vi.spyOn(process, 'on').mockImplementation(() => process);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('devCommand change handler', () => {
  it('logs a cycle that fails outside its own reporting, and leaks no rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.prependListener('unhandledRejection', onUnhandled);
    try {
      const file = path.join(dir, 'wf.ts');
      fs.writeFileSync(file, '// a workflow');
      mockExecuteWorkflow.mockResolvedValue({ kind: 'completed', functionName: 'wf', executionTime: 1, result: {} });
      mockCompileCommand.mockResolvedValueOnce(undefined);
      // A compile error whose error list the reporter cannot read.
      mockCompileCommand.mockRejectedValueOnce(Object.assign(new Error('bad'), { errors: [null] }));

      void devCommand(file, {});
      await vi.waitFor(() => expect(mockWatcherOn).toHaveBeenCalledWith('change', expect.any(Function)));
      const onChange = mockWatcherOn.mock.calls.find((c: unknown[]) => c[0] === 'change')![1] as (f: string) => unknown;

      onChange(file);

      await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Dev cycle failed')));
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
