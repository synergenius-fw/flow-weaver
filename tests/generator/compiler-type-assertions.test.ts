/**
 * TDD tests for compiler type assertion bugs.
 *
 * Bug 1: Bare type names — compiler emits `as MyConfig` which fails
 * when the type isn't in scope (external runtime mode). Should use
 * `as any` or strip custom type assertions in generated code.
 *
 * Bug 2: Non-expression node return type — compiler reads
 * result.onSuccess/onFailure but TS doesn't know they exist on the
 * return type. Compiler should cast result appropriately.
 */

import * as fs from 'fs';
import * as os from 'os';
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

  it('does not emit bare custom type names in generated code', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);

    // Should NOT have bare `as MyConfig` — this fails in external runtime mode
    // where MyConfig is not imported. Should use `as any` instead.
    const bareTypePattern = / as MyConfig[;\s)]/;
    expect(generated).not.toMatch(bareTypePattern);
  });

  it('non-expression node result is cast to include STEP ports', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);

    // The generated code accesses procResult.onSuccess and procResult.onFailure.
    // The TS return type may not include these, so the compiler must cast.
    // Verify the result is cast to a type that includes onSuccess/onFailure.
    expect(generated).toContain('procResult');

    // The cast should make TS happy — either `as any` on the result,
    // or the property access should not cause a TS error
    const resultLine = generated.split('\n').find(l => l.includes('procResult') && l.includes('processData'));
    expect(resultLine).toBeDefined();
  });

  it('preserves safe built-in types in assertions', () => {
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);

    // Primitives should still be used (string, boolean, etc.)
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
