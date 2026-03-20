/**
 * TDD tests for compiler type assertion generation.
 *
 * Bug: Types containing absolute import paths like
 * `as import("/Users/foo/bar").WeaverEnv` break when compiled on
 * different machines. These should fall back to generic types.
 *
 * Local types (defined in the same file) should be preserved.
 */

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { parser } from '../../src/parser';
import { generateCode } from '../../src/api/generate';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/compiler-type-assertions.ts');

describe('compiler type assertion generation', () => {
  it('fixture parses without errors', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.workflows).toHaveLength(1);
  });

  it('preserves local custom type names in generated code', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);

    // Local types (defined in the same file like MyConfig) should be preserved
    expect(generated).toContain('as MyConfig');
  });

  it('preserves safe built-in types in assertions', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);

    expect(generated).toContain('as string');
    expect(generated).toContain('as boolean');
  });

  it('does not contain absolute file paths in type assertions', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);

    // Should not contain absolute paths like import("/Users/...")
    expect(generated).not.toMatch(/as import\("\/[^"]+"\)/);
  });

  it('compiles and runs without errors', async () => {
    const result = await executeWorkflowFromFile(FIXTURE_PATH, {
      raw: JSON.stringify({ name: 'test', value: 42 }),
    });

    expect(result.result).toBeDefined();
    const output = result.result as { onSuccess: boolean; result: string };
    expect(output.onSuccess).toBe(true);
    expect(output.result).toBe('Processed test');
  });
});
