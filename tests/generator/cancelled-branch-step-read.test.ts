/**
 * Regression test for: "Variable not found: X.onSuccess[undefined]"
 *
 * When a branching node (expression) routes to one path, nodes in the
 * non-taken path get CANCELLED status. The merge node (DISJUNCTION)
 * reads onSuccess from all incoming paths. The compiler must set
 * onSuccess=false and onFailure=false on CANCELLED executions so
 * downstream reads don't throw "Variable not found".
 *
 * Fix: generateCancelledEventsForBranch in unified.ts now sets
 * onSuccess=false and onFailure=false for each CANCELLED node.
 */

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/cancelled-branch-step-read.ts');

describe('cancelled branch STEP port read', () => {
  it('runs main path without crashing (alt path CANCELLED)', async () => {
    // Route succeeds → main path taken, alt path CANCELLED.
    // Before fix: merge reads alt.onSuccess → "Variable not found" crash.
    // After fix: CANCELLED nodes have onSuccess=false set, merge gets false.
    const result = await executeWorkflowFromFile(FIXTURE_PATH, {
      ctx: JSON.stringify({ mode: 'main' }),
    });

    expect(result.result).toBeDefined();
    const output = result.result as { onSuccess: boolean; result: string };
    expect(output.onSuccess).toBe(true);
    expect(JSON.parse(output.result).mainDone).toBe(true);
  });
});
