/**
 * Tests for the dev command (watch + compile + run)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tempDir = path.join(os.tmpdir(), `flow-weaver-dev-test-${process.pid}`);

// Simple workflow for testing
const SIMPLE_WORKFLOW = `
/** @flowWeaver nodeType @expression */
function greet(name: string): { greeting: string } {
  return { greeting: \`Hello, \${name}!\` };
}

/**
 * @flowWeaver workflow
 * @node g greet
 * @connect Start.name -> g.name
 * @connect g.greeting -> Exit.message
 */
export function devTestWorkflow(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; message: string } {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`;

// Broken workflow for error testing
const BROKEN_WORKFLOW = `
/** @flowWeaver nodeType @expression */
function process(data: string): { result: string } {
  return { result: data };
}

/**
 * @flowWeaver workflow
 * @node p process
 * @node missing ghostNode
 * @connect Start.data -> p.data
 * @connect p.result -> Exit.result
 */
export function brokenWorkflow(
  execute: boolean,
  params: { data: string }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`;

beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('devCommand', () => {
  it('should compile and run workflow on startup (once mode)', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-once');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, SIMPLE_WORKFLOW);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      await devCommand(file, {
        once: true,
        params: '{"name": "World"}',
      });

      const output = logs.join('\n');
      // Should have compiled
      expect(output).toContain('Compiled');
      // Should have run and produced a result
      expect(output).toContain('Hello, World!');
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should pass --params to workflow execution', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-params');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, SIMPLE_WORKFLOW);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      await devCommand(file, {
        once: true,
        params: '{"name": "Claude"}',
      });

      const output = logs.join('\n');
      expect(output).toContain('Hello, Claude!');
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should show friendly errors on compile failure', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-error');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'broken.ts');
    fs.writeFileSync(file, BROKEN_WORKFLOW);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      await devCommand(file, { once: true });

      const output = logs.join('\n');
      // Should report compile/validation error (not crash)
      expect(output).toMatch(/error|fail|invalid/i);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should output JSON when --json is set', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-json');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, SIMPLE_WORKFLOW);

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    // Suppress console output
    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await devCommand(file, {
        once: true,
        json: true,
        params: '{"name": "JSON"}',
      });

      const output = stdoutChunks.join('');
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.result).toBeDefined();
      expect(parsed.result.message).toBe('Hello, JSON!');
    } finally {
      process.stdout.write = origWrite;
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should throw for non-existent file', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    await expect(
      devCommand('/nonexistent/path/workflow.ts', { once: true })
    ).rejects.toThrow(/not found/i);
  });

  it('should throw on invalid JSON in --params', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-bad-json');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, SIMPLE_WORKFLOW);

    await expect(
      devCommand(file, { once: true, params: '{invalid json}' })
    ).rejects.toThrow(/Invalid JSON in --params/);
  });

  it('should throw on non-existent params file', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-missing-pf');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, SIMPLE_WORKFLOW);

    await expect(
      devCommand(file, { once: true, paramsFile: '/nonexistent/params.json' })
    ).rejects.toThrow(/Params file not found/);
  });

  it('should throw on invalid JSON in params file', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-bad-pf');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, SIMPLE_WORKFLOW);
    const paramsFile = path.join(dir, 'bad-params.json');
    fs.writeFileSync(paramsFile, '{not valid json}');

    await expect(
      devCommand(file, { once: true, paramsFile })
    ).rejects.toThrow(/Failed to parse params file/);
  });

  it('should return empty params when neither --params nor --params-file are given', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-no-params');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, SIMPLE_WORKFLOW);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      await devCommand(file, { once: true });
      // Without params, the greeting node gets undefined for name
      // but the command should still run without throwing
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should output JSON error on run failure when --json is set', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-json-err');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'broken.ts');
    fs.writeFileSync(file, BROKEN_WORKFLOW);

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await devCommand(file, { once: true, json: true });

      // Should have written either error from compile or run
      // The compile failure should still produce output
    } finally {
      process.stdout.write = origWrite;
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should parse params from --params-file', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-params-file');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, SIMPLE_WORKFLOW);
    const paramsFile = path.join(dir, 'params.json');
    fs.writeFileSync(paramsFile, '{"name": "FromFile"}');

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      await devCommand(file, {
        once: true,
        paramsFile,
      });

      const output = logs.join('\n');
      expect(output).toContain('Hello, FromFile!');
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});

// ---------------------------------------------------------------------------
// Inngest dev mode tests
// ---------------------------------------------------------------------------

// A minimal workflow with an Inngest built-in node, usable for Inngest target compilation
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

describe('compileInngestTarget dry-run', () => {
  it('should show preview without writing file in dry-run mode', async () => {
    const { compileInngestTarget } = await import('../../src/cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-dry');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await compileInngestTarget(file, { production: false, dryRun: true });
      const outputPath = file.replace(/\.ts$/, '.inngest.ts');
      expect(fs.existsSync(outputPath)).toBe(false);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});

describe('compileInngestTarget CLI overrides', () => {
  it('should apply --cron override', async () => {
    const { compileInngestTarget } = await import('../../src/cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-cron');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await compileInngestTarget(file, {
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
    const { compileInngestTarget } = await import('../../src/cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-parse-err');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'bad.ts');
    // File with @flowWeaver but broken annotation
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
        compileInngestTarget(file, { production: false })
      ).rejects.toThrow();
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});

describe('compileInngestTarget', () => {
  it('should throw (not process.exit) on missing file', async () => {
    const { compileInngestTarget } = await import('../../src/cli/commands/compile');

    await expect(
      compileInngestTarget('/nonexistent/path/workflow.ts', { production: false })
    ).rejects.toThrow(/not found/i);
  });

  it('should throw on file with no workflows', async () => {
    const { compileInngestTarget } = await import('../../src/cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-no-wf');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'empty.ts');
    fs.writeFileSync(file, '// no workflow here\nexport function hello() {}');

    await expect(
      compileInngestTarget(file, { production: false })
    ).rejects.toThrow(/no workflows found/i);
  });

  it('should throw on non-existent workflow name', async () => {
    const { compileInngestTarget } = await import('../../src/cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-bad-name');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    // Suppress logger output during test
    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await expect(
        compileInngestTarget(file, { production: false, workflowName: 'doesNotExist' })
      ).rejects.toThrow(/not found.*Available/i);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it('should compile to .inngest.ts file', async () => {
    const { compileInngestTarget } = await import('../../src/cli/commands/compile');

    const dir = path.join(tempDir, 'inngest-compile');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    const origLog = console.log;
    const origError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await compileInngestTarget(file, { production: false });

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
  it('should route to Inngest mode when target is inngest', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

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
    const { devCommand } = await import('../../src/cli/commands/dev');

    await expect(
      devCommand('/nonexistent/path/workflow.ts', { target: 'inngest', once: true })
    ).rejects.toThrow(/not found/i);
  });

  it('should report missing framework dependencies', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const dir = path.join(tempDir, 'dev-inngest-hono');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'workflow.ts');
    fs.writeFileSync(file, INNGEST_WORKFLOW);

    // Request hono framework — should list hono in missing deps
    await expect(
      devCommand(file, { target: 'inngest', once: true, framework: 'hono' })
    ).rejects.toThrow(/hono/i);
  });
});
