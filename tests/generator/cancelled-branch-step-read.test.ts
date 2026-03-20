/**
 * Regression tests for CANCELLED branch variable scoping.
 *
 * Bug 1: CANCELLED nodes didn't have onSuccess/onFailure set → "Variable not found"
 * Bug 2: CANCELLED code used `const` which shadows the outer `let` → outer variable
 *         stays undefined → downstream getVariable crashes with undefined executionIndex
 */

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { parser } from '../../src/parser';
import { generateCode } from '../../src/api/generate';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/cancelled-branch-step-read.ts');

describe('cancelled branch STEP port read', () => {
  it('runs main path without crashing (alt path CANCELLED)', async () => {
    const result = await executeWorkflowFromFile(FIXTURE_PATH, {
      ctx: JSON.stringify({ mode: 'main' }),
    });

    expect(result.result).toBeDefined();
    const output = result.result as { onSuccess: boolean; result: string };
    expect(output.onSuccess).toBe(true);
    expect(JSON.parse(output.result).mainDone).toBe(true);
  });

  it('STEP port reads from branched nodes have undefined guards', () => {
    // When merge reads onSuccess from branched nodes (main, alt), the
    // generated code must guard against undefined execution indices.
    // Without the guard: `mainIdx!` crashes when main was CANCELLED.
    // With the guard: `mainIdx !== undefined ? getVariable(...) : false`
    const parsed = parser.parse(FIXTURE_PATH);
    const workflow = parsed.workflows[0]!;
    const generated = generateCode(workflow);

    // getVariable calls for STEP ports from branched nodes should have
    // undefined guards, not bare non-null assertions
    const unguardedStepReads = generated.match(
      /getVariable\(\{[^}]*portName:\s*'onSuccess'[^}]*executionIndex:\s*\w+Idx!\s*\}/g
    );
    expect(unguardedStepReads).toBeNull();
  });
});
