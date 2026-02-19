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
