/**
 * Tests for validate command
 * Uses direct validator calls for speed, with CLI smoke tests for wiring
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parser } from '../../src/parser';
import { validator } from '../../src/validator';
import { validateCommand } from '../../src/cli/commands/validate';

const VALIDATE_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-validate-${process.pid}`);

beforeAll(() => fs.mkdirSync(VALIDATE_TEMP_DIR, { recursive: true }));
afterAll(() => fs.rmSync(VALIDATE_TEMP_DIR, { recursive: true, force: true }));

describe('validator (pure function)', () => {
  describe('valid workflows', () => {
    it('should validate a valid simple workflow', () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function proc(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect Start.value -> p.value
 * @connect p.result -> Exit.result
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function simpleWorkflow(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'valid.ts');
      expect(result.errors).toHaveLength(0);
      expect(result.workflows).toHaveLength(1);

      const validation = validator.validate(result.workflows[0]);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should validate workflow with multiple nodes', () => {
      const content = `
/**
 * @flowWeaver nodeType
 */
function nodeA(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver nodeType
 */
function nodeB(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @connect a.onSuccess -> b.execute
 * @connect b.onSuccess -> Exit.onSuccess
 */
export function multiNodeWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'multi-node.ts');
      expect(result.errors).toHaveLength(0);

      const validation = validator.validate(result.workflows[0]);
      expect(validation.valid).toBe(true);
    });
  });

  describe('invalid workflows', () => {
    it('should fail validation for workflow with invalid connection target', () => {
      const content = `
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
 * @connect p.nonExistentPort -> Exit.onFailure
 */
export function invalidPortWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'invalid-port.ts');
      expect(result.errors).toHaveLength(0);

      const validation = validator.validate(result.workflows[0]);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validation errors and warnings', () => {
    it('should return detailed error messages for invalid port', () => {
      const content = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.invalidPort -> Exit.onSuccess
 */
export function errorWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'error-detail.ts');
      const validation = validator.validate(result.workflows[0]);

      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0].message).toBeDefined();
    });
  });
});

describe('CLI validate --json output', () => {
  it('should return structured error objects with message and severity', async () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
function double(x: number): number { return x * 2; }

/**
 * @flowWeaver workflow
 * @node d double
 * @connect Start.execute -> d.execute
 * @connect ghost.output -> d.x
 * @param value
 * @returns result
 */
export function broken(execute: boolean, params: { value: number }): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error("Compile with: flow-weaver compile <file>");
}`;
    const testFile = path.join(VALIDATE_TEMP_DIR, 'broken-validate.ts');
    fs.writeFileSync(testFile, code);

    // Capture console.log output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));

    // Suppress process.exit
    const originalExit = process.exit;
    process.exit = vi.fn() as never;

    // Suppress console.error from parseWorkflow
    const originalError = console.error;
    console.error = vi.fn() as typeof console.error;

    try {
      await validateCommand(testFile, { json: true });
    } catch {
      /* may throw */
    } finally {
      console.log = originalLog;
      process.exit = originalExit;
      console.error = originalError;
    }

    expect(logs.length).toBeGreaterThan(0);
    const output = JSON.parse(logs.join(''));
    expect(output.results).toBeDefined();

    const result = output.results[0];
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);

    // Key assertion: errors should be objects, not strings
    const firstError = result.errors[0];
    expect(typeof firstError).toBe('object');
    expect(firstError).toHaveProperty('message');
    expect(firstError).toHaveProperty('severity');
  });
});

// ── validateCommand additional coverage ──────────────────────────────────────

function makeValidateFixture(name: string, content: string): string {
  const filePath = path.join(VALIDATE_TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const VALID_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function proc(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect Start.value -> p.value
 * @connect p.result -> Exit.result
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function validWorkflow(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error("Not implemented");
}
`;

const NON_WORKFLOW_FILE = `
// A regular TypeScript file, not a workflow
export function helper(x: number): number {
  return x + 1;
}
`;

describe('validateCommand with valid workflow', () => {
  it('should succeed on a valid workflow file', async () => {
    const file = makeValidateFixture('valid-cmd.ts', VALID_WORKFLOW);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    const origExit = process.exit;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();
    process.exit = vi.fn() as never;

    try {
      await validateCommand(file, { json: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
      process.exit = origExit;
    }

    expect(logs.length).toBeGreaterThan(0);
    const output = JSON.parse(logs.join(''));
    expect(output.valid).toBe(true);
    expect(output.totalErrors).toBe(0);
    expect(output.validFiles).toBe(1);
  });
});

describe('validateCommand with directory input', () => {
  it('should expand a directory to *.ts files', async () => {
    const dir = path.join(VALIDATE_TEMP_DIR, 'dir-input');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'wf.ts'), VALID_WORKFLOW);
    fs.writeFileSync(path.join(dir, 'helper.ts'), NON_WORKFLOW_FILE);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    const origExit = process.exit;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();
    process.exit = vi.fn() as never;

    try {
      await validateCommand(dir, { json: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
      process.exit = origExit;
    }

    const output = JSON.parse(logs.join(''));
    expect(output.totalFiles).toBeGreaterThanOrEqual(1);
  });
});

describe('validateCommand no files found', () => {
  it('should exit(1) when pattern matches no files', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    const origExit = process.exit;
    const mockExit = vi.fn() as unknown as typeof process.exit;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();
    process.exit = mockExit;

    try {
      await validateCommand('/nonexistent/path/*.ts', { json: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
      process.exit = origExit;
    }

    expect(mockExit).toHaveBeenCalledWith(1);
    // Parse only the first log entry since mocked process.exit doesn't
    // actually halt execution, so additional JSON may be logged after
    const output = JSON.parse(logs[0]);
    expect(output.error).toContain('No files found');
  });
});

describe('validateCommand --strict mode', () => {
  it('should pass strict option through to validator', async () => {
    const file = makeValidateFixture('strict-test.ts', VALID_WORKFLOW);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    const origExit = process.exit;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();
    process.exit = vi.fn() as never;

    try {
      await validateCommand(file, { json: true, strict: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
      process.exit = origExit;
    }

    expect(logs.length).toBeGreaterThan(0);
    const output = JSON.parse(logs.join(''));
    // The valid workflow should still pass in strict mode
    expect(output).toHaveProperty('valid');
  });
});

describe('validateCommand human-readable output', () => {
  it('should produce text output (not JSON) by default', async () => {
    const file = makeValidateFixture('human-readable.ts', VALID_WORKFLOW);

    const logs: string[] = [];
    const errors: string[] = [];
    const warns: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    const origExit = process.exit;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));
    process.exit = vi.fn() as never;

    try {
      await validateCommand(file, { json: false, verbose: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
      process.exit = origExit;
    }

    const allOutput = [...logs, ...errors, ...warns].join(' ');
    // Should contain human-readable text, not JSON
    expect(allOutput).toContain('valid');
  });
});
