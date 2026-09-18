/**
 * What a throw in an @expression node does at run time, pinned so the
 * documentation and the DESIGN_ASYNC_NO_ERROR_PATH wording stay true.
 *
 * The generated per-node catch marks the node failed (onSuccess=false,
 * onFailure=true), emits LOG_ERROR, and rethrows. So the error leaves the
 * workflow call even when a `:fail` route is declared. A normal-mode node
 * that RETURNS onFailure: true is routed. The docs describe exactly this;
 * if the generator's policy ever changes, this test is the place that says
 * the docs must change with it.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeWorkflow } from '../../src/mcp/workflow-executor';

const bundleDigest = `sha256:${'9'.repeat(64)}`;

async function run(code: string, workflowName: string, params: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-throw-semantics-'));
  const file = path.join(dir, 'flow.ts');
  fs.writeFileSync(file, code);
  try {
    return await executeWorkflow({ runId: `throw-semantics-${workflowName}`, bundleDigest, filePath: file, workflowName, params, production: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('a throw in an expression node', () => {
  it('propagates out of the workflow call even when a :fail route is declared', async () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Number
 * @output value - Same number when positive
 */
function check(value: number): { value: number } {
  if (value <= 0) throw new Error('not positive');
  return { value };
}

/**
 * @flowWeaver workflow
 * @param value - Number
 * @returns value - Result
 * @node check check
 * @path Start -> check -> Exit
 * @path Start -> check:fail -> Exit
 */
export function throwRoute(execute: boolean, params: { value: number }): { onSuccess: boolean; onFailure: boolean; value: number } {
  throw new Error('stub');
}
`;
    await expect(run(code, 'throwRoute', { value: -1 })).rejects.toThrow('not positive');
    const ok = await run(code, 'throwRoute', { value: 2 });
    expect(ok.kind).toBe('completed');
    if (ok.kind === 'completed') expect(ok.result).toMatchObject({ onSuccess: true, value: 2 });
  });

  it('is routed when the node is normal mode and returns onFailure instead of throwing', async () => {
    const code = `
/**
 * Normal mode on purpose: the failure is an outcome to route, not an exception.
 *
 * @flowWeaver nodeType
 * @input value - Number
 * @output value - Same number when positive
 * @output reason - Why it was refused
 */
function check(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; value: number; reason: string } {
  if (!execute) return { onSuccess: false, onFailure: false, value: 0, reason: '' };
  if (value <= 0) return { onSuccess: false, onFailure: true, value: 0, reason: 'not positive' };
  return { onSuccess: true, onFailure: false, value, reason: '' };
}

/**
 * @flowWeaver workflow
 * @param value - Number
 * @returns value - Result
 * @returns reason - Why it was refused
 * @node check check
 * @path Start -> check -> Exit
 * @path Start -> check:fail -> Exit
 */
export function returnRoute(execute: boolean, params: { value: number }): { onSuccess: boolean; onFailure: boolean; value: number; reason: string } {
  throw new Error('stub');
}
`;
    const refused = await run(code, 'returnRoute', { value: -1 });
    expect(refused.kind).toBe('completed');
    if (refused.kind === 'completed') {
      expect(refused.result).toMatchObject({ onSuccess: false, onFailure: true, reason: 'not positive' });
    }
  });
});
