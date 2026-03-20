/**
 * TDD tests for compiler type assertion generation.
 *
 * Bug: Types containing import() paths like
 * `as import("/Users/foo/bar").WeaverEnv` break when compiled on
 * different machines. These should fall back to generic types.
 *
 * Local types (defined in the same file) should be preserved.
 */

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { parser } from '../../src/parser';
import { generateCode } from '../../src/api/generate';
import { mapToTypeScript } from '../../src/type-mappings';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/compiler-type-assertions.ts');

describe('mapToTypeScript sanitization', () => {
  it('preserves primitive types', () => {
    expect(mapToTypeScript('STRING')).toBe('string');
    expect(mapToTypeScript('NUMBER')).toBe('number');
    expect(mapToTypeScript('BOOLEAN')).toBe('boolean');
  });

  it('preserves local custom type names for OBJECT ports', () => {
    expect(mapToTypeScript('OBJECT', 'MyConfig')).toBe('MyConfig');
  });

  it('preserves structural types', () => {
    expect(mapToTypeScript('OBJECT', '{ name: string; value: number }')).toBe('{ name: string; value: number }');
  });

  it('preserves array types with custom elements', () => {
    expect(mapToTypeScript('ARRAY', 'SearchResult[]')).toBe('SearchResult[]');
  });

  it('strips import() path types', () => {
    const importType = 'import("/Users/foo/bar/types").WeaverEnv';
    const result = mapToTypeScript('OBJECT', importType);
    expect(result).not.toContain('import(');
    expect(result).toBe('Record<string, unknown>');
  });

  it('strips relative import() path types', () => {
    const importType = 'import("../bot/types").BotConfig';
    const result = mapToTypeScript('OBJECT', importType);
    expect(result).toBe('Record<string, unknown>');
  });
});

describe('compiler type assertion generation', () => {
  it('fixture parses without errors', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.workflows).toHaveLength(1);
  });

  it('preserves safe built-in types in assertions', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);
    expect(generated).toContain('as string');
    expect(generated).toContain('as boolean');
  });

  it('does not contain import() paths in type assertions', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);
    expect(generated).not.toMatch(/as import\(/);
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
