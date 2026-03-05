/**
 * Tests for the Inngest dev mode and compile target integration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Load extensions so the inngest compile target is registered
import '../register';

const tempDir = path.join(os.tmpdir(), `flow-weaver-inngest-dev-test-${process.pid}`);

const INNGEST_WORKFLOW = `
/** @flowWeaver nodeType @expression */
function classify(amount: number): { needsApproval: boolean } {
  return { needsApproval: amount >= 100 };
}

/**
 * @flowWeaver workflow
 * @node c classify
 * @connect Start.amount -> c.amount
 * @connect c.needsApproval -> Exit.needsApproval
 */
export function expenseCheck(
  execute: boolean,
  params: { amount: number }
): { onSuccess: boolean; onFailure: boolean; needsApproval: boolean } {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`;

beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('compileCustomTarget dry-run', () => {
  it('should show preview without writing file in dry-run mode', async () => {
    const { compileCustomTarget } = await import('../../../cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-dry');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await compileCustomTarget('inngest', file, { production: false, dryRun: true });
      const outputPath = file.replace(/\.ts$/, '.inngest.ts');
      expect(fs.existsSync(outputPath)).toBe(false);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});

describe('compileCustomTarget CLI overrides', () => {
  it('should apply --cron override', async () => {
    const { compileCustomTarget } = await import('../../../cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-cron');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await compileCustomTarget('inngest', file, {
        production: false,
        cron: '0 * * * *',
      });
      const outputPath = file.replace(/\.ts$/, '.inngest.ts');
      expect(fs.existsSync(outputPath)).toBe(true);
      const code = fs.readFileSync(outputPath, 'utf8');
      expect(code).toContain('cron');
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should accept parse errors and throw', async () => {
    const { compileCustomTarget } = await import('../../../cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-parse-err');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'bad.ts');
    fs.writeFileSync(file, `
/** @flowWeaver workflow
 * @node missing nonExistentType
 */
export function broken(execute: boolean): { onSuccess: boolean } {
  throw new Error("not compiled");
}
`);

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await expect(
        compileCustomTarget('inngest', file, { production: false })
      ).rejects.toThrow();
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});

describe('compileCustomTarget', () => {
  it('should throw (not process.exit) on missing file', async () => {
    const { compileCustomTarget } = await import('../../../cli/commands/compile');

    await expect(
      compileCustomTarget('inngest', '/nonexistent/path/workflow.ts', { production: false })
    ).rejects.toThrow(/not found/i);
  });

  it('should throw on file with no workflows', async () => {
    const { compileCustomTarget } = await import('../../../cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-no-wf');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'empty.ts');
    fs.writeFileSync(file, '// no workflow here\nexport function hello() {}');

    await expect(
      compileCustomTarget('inngest', file, { production: false })
    ).rejects.toThrow(/no workflows found/i);
  });

  it('should throw on non-existent workflow name', async () => {
    const { compileCustomTarget } = await import('../../../cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-bad-name');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await expect(
        compileCustomTarget('inngest', file, { production: false, workflowName: 'doesNotExist' })
      ).rejects.toThrow(/not found.*Available/i);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should compile to .inngest.ts file', async () => {
    const { compileCustomTarget } = await import('../../../cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-compile');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await compileCustomTarget('inngest', file, { production: false });

      const outputPath = file.replace(/\.ts$/, '.inngest.ts');
      expect(fs.existsSync(outputPath)).toBe(true);

      const code = fs.readFileSync(outputPath, 'utf8');
      expect(code).toContain('inngest');
      expect(code).toContain('createFunction');
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});

describe('devCommand --target inngest', () => {
  it('should route to inngest dev mode via the registry', async () => {
    const { devCommand } = await import('../../../cli/commands/dev');

    const dir = path.join(tempDir, 'dev-inngest-route');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    // In test env, inngest package is not installed, so runInngestDevMode
    // should throw about missing dependencies (not process.exit)
    await expect(
      devCommand(file, { target: 'inngest', once: true })
    ).rejects.toThrow(/Missing dependencies.*inngest/i);
  });

  it('should throw on missing file with target inngest', async () => {
    const { devCommand } = await import('../../../cli/commands/dev');

    await expect(
      devCommand('/nonexistent/path/workflow.ts', { target: 'inngest', once: true })
    ).rejects.toThrow(/not found/i);
  });

  it('should report missing framework dependencies', async () => {
    const { devCommand } = await import('../../../cli/commands/dev');

    const dir = path.join(tempDir, 'dev-inngest-hono');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    await expect(
      devCommand(file, { target: 'inngest', once: true, framework: 'hono' })
    ).rejects.toThrow(/hono/i);
  });
});
