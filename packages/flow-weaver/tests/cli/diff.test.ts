/**
 * Tests for diff command
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const WORKFLOW_A = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function wfA(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

const WORKFLOW_B = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver nodeType
 */
function extra(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @node e extra
 * @connect p.onSuccess -> e.execute
 * @connect e.onSuccess -> Exit.onSuccess
 */
export function wfA(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-diff-test-'));
});

afterAll(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
});

describe('diffCommand', () => {
  it('should not call process.exit when files are identical', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file1 = path.join(tempDir, 'identical-a.ts');
    const file2 = path.join(tempDir, 'identical-b.ts');
    fs.writeFileSync(file1, WORKFLOW_A);
    fs.writeFileSync(file2, WORKFLOW_A);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const origLog = console.log;
    console.log = () => {};

    try {
      await diffCommand(file1, file2, {});
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      console.log = origLog;
    }
  });

  it('should call process.exit(1) when files differ', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file1 = path.join(tempDir, 'diff-a.ts');
    const file2 = path.join(tempDir, 'diff-b.ts');
    fs.writeFileSync(file1, WORKFLOW_A);
    fs.writeFileSync(file2, WORKFLOW_B);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const origLog = console.log;
    console.log = () => {};

    try {
      await diffCommand(file1, file2, {});
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      console.log = origLog;
    }
  });

  it('should not call process.exit when files differ but exitZero is true', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file1 = path.join(tempDir, 'ez-a.ts');
    const file2 = path.join(tempDir, 'ez-b.ts');
    fs.writeFileSync(file1, WORKFLOW_A);
    fs.writeFileSync(file2, WORKFLOW_B);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const origLog = console.log;
    console.log = () => {};

    try {
      await diffCommand(file1, file2, { exitZero: true });
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      console.log = origLog;
    }
  });
});
