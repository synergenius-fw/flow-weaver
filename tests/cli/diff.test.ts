/**
 * Tests for diff command.
 * Covers identical workflows, differences with various formats,
 * file-not-found errors, parse errors, and exitZero behavior.
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

const INVALID_WORKFLOW = `
// This file has no valid workflow annotations
export function notAWorkflow() { return 42; }
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

  it('should exit(1) when first file does not exist', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file2 = path.join(tempDir, 'exists.ts');
    fs.writeFileSync(file2, WORKFLOW_A);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const origErr = console.error;
    console.error = () => {};

    try {
      await diffCommand('/nonexistent/file.ts', file2, {});
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      console.error = origErr;
    }
  });

  it('should exit(1) when second file does not exist', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file1 = path.join(tempDir, 'exists2.ts');
    fs.writeFileSync(file1, WORKFLOW_A);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const origErr = console.error;
    console.error = () => {};

    try {
      await diffCommand(file1, '/nonexistent/other.ts', {});
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      console.error = origErr;
    }
  });

  it('should exit(1) when first file has parse errors', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file1 = path.join(tempDir, 'bad-parse.ts');
    const file2 = path.join(tempDir, 'good-parse.ts');
    fs.writeFileSync(file1, INVALID_WORKFLOW);
    fs.writeFileSync(file2, WORKFLOW_A);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const origLog = console.log;
    const origErr = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await diffCommand(file1, file2, {});
      // Either the parse produces errors or the diff throws; both exit(1)
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      console.log = origLog;
      console.error = origErr;
    }
  });

  it('should output json format when requested', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file1 = path.join(tempDir, 'json-a.ts');
    const file2 = path.join(tempDir, 'json-b.ts');
    fs.writeFileSync(file1, WORKFLOW_A);
    fs.writeFileSync(file2, WORKFLOW_B);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured = msg; };

    try {
      await diffCommand(file1, file2, { format: 'json', exitZero: true });
      // JSON format should produce parseable JSON
      const parsed = JSON.parse(captured);
      expect(parsed).toHaveProperty('identical', false);
    } finally {
      exitSpy.mockRestore();
      console.log = origLog;
    }
  });

  it('should output compact format when requested', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file1 = path.join(tempDir, 'compact-a.ts');
    const file2 = path.join(tempDir, 'compact-b.ts');
    fs.writeFileSync(file1, WORKFLOW_A);
    fs.writeFileSync(file2, WORKFLOW_B);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured = msg; };

    try {
      await diffCommand(file1, file2, { format: 'compact', exitZero: true });
      // Compact format is typically shorter than full text
      expect(captured.length).toBeGreaterThan(0);
    } finally {
      exitSpy.mockRestore();
      console.log = origLog;
    }
  });

  it('should output text format by default for different files', async () => {
    const { diffCommand } = await import('../../src/cli/commands/diff');

    const file1 = path.join(tempDir, 'text-a.ts');
    const file2 = path.join(tempDir, 'text-b.ts');
    fs.writeFileSync(file1, WORKFLOW_A);
    fs.writeFileSync(file2, WORKFLOW_B);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured = msg; };

    try {
      await diffCommand(file1, file2, { format: 'text', exitZero: true });
      expect(captured.length).toBeGreaterThan(0);
      // Text format should not be valid JSON
      expect(() => JSON.parse(captured)).toThrow();
    } finally {
      exitSpy.mockRestore();
      console.log = origLog;
    }
  });
});
