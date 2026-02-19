/**
 * WU11: S16 — Dedicated MULTIPLE_WORKFLOWS error code
 */

import { describe, it, expect } from 'vitest';
import { parseWorkflow } from '../../src/api/parse';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('parseWorkflow multiple workflows error', () => {
  it('should return MULTIPLE_WORKFLOWS_FOUND marker when file has multiple workflows and no workflowName', async () => {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `test-multi-wf-${Date.now()}.ts`);
    fs.writeFileSync(
      tmpFile,
      `
/**
 * @flowWeaver nodeType
 * @input data
 * @output result
 */
function process(execute: boolean, data: string) {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: data };
}

/**
 * @flowWeaver workflow
 * @node p1 process
 * @connect Start.execute -> p1.execute
 * @connect p1.onSuccess -> Exit.onSuccess
 */
export function workflowA() {}

/**
 * @flowWeaver workflow
 * @node p2 process
 * @connect Start.execute -> p2.execute
 * @connect p2.onSuccess -> Exit.onSuccess
 */
export function workflowB() {}
`
    );

    try {
      const result = await parseWorkflow(tmpFile);
      expect(result.errors.length).toBeGreaterThan(0);
      // Error should contain MULTIPLE_WORKFLOWS_FOUND code marker
      const errorMsg = result.errors.join(' ');
      expect(errorMsg).toContain('MULTIPLE_WORKFLOWS_FOUND');
      // Should list available workflow names
      expect(errorMsg).toContain('workflowA');
      expect(errorMsg).toContain('workflowB');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('ERROR_HINTS for MULTIPLE_WORKFLOWS_FOUND', () => {
  it('should have a hint for MULTIPLE_WORKFLOWS_FOUND', async () => {
    const { ERROR_HINTS } = await import('../../src/mcp/response-utils');
    expect(ERROR_HINTS['MULTIPLE_WORKFLOWS_FOUND']).toBeDefined();
    expect(ERROR_HINTS['MULTIPLE_WORKFLOWS_FOUND']).toContain('workflowName');
  });
});
