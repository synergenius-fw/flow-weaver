import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { dispatch } from '../../../../src/cli/tunnel/dispatch.js';

describe('dispatch', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-test-'));
  });

  it('returns undefined result for unknown methods', async () => {
    const result = await dispatch('nonExistentMethod', {}, { workspaceRoot: tmpDir });
    expect(result).toEqual({ success: true, result: undefined });
  });

  it('dispatches a known method successfully', async () => {
    const result = await dispatch('getCWD', {}, { workspaceRoot: tmpDir });
    expect(result).toEqual({ success: true, result: '/' });
  });

  it('wraps handler errors in error envelope', async () => {
    const result = await dispatch('getFile', {}, { workspaceRoot: tmpDir });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('filePath');
  });

  it('dispatches file operations with real filesystem', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello', 'utf-8');

    const result = await dispatch(
      'hasFile',
      { filePath: '/test.txt' },
      { workspaceRoot: tmpDir },
    );
    expect(result).toEqual({ success: true, result: true });
  });
});
