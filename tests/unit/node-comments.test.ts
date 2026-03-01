/**
 * Tests that node header comments appear in generated code (dev mode)
 * and are absent in production mode.
 */
import { describe, it, expect } from 'vitest';
import { generateInPlace } from '../../src/api/generate-in-place';
import { parseWorkflow } from '../../src/api/parse';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const WORKFLOW_SOURCE = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function processData(value: string): { result: string } {
  return { result: value.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node proc processData
 * @path Start -> proc -> Exit
 * @connect proc.result -> Exit.result
 * @param execute - Execute
 * @param value - Input value
 * @returns onSuccess - On Success
 * @returns onFailure - On Failure
 * @returns result - Result
 */
export async function testWorkflow(
  execute: boolean,
  params: { value: string } = { value: '' },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string | null }> {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  return { onSuccess: false, onFailure: true, result: null };
}
`;

describe('Node header comments in generated code', () => {
  it('should include node comments in dev mode (default)', async () => {
    const tmpFile = path.join(os.tmpdir(), `fw-comments-test-${Date.now()}.ts`);
    fs.writeFileSync(tmpFile, WORKFLOW_SOURCE);

    try {
      const parsed = await parseWorkflow(tmpFile);
      expect(parsed.errors).toEqual([]);
      const workflow = parsed.ast;
      expect(workflow).toBeDefined();

      const result = generateInPlace(WORKFLOW_SOURCE, workflow!, { production: false });
      expect(result.code).toContain('// ── proc (processData) ──');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should NOT include node comments in production mode', async () => {
    const tmpFile = path.join(os.tmpdir(), `fw-comments-prod-test-${Date.now()}.ts`);
    fs.writeFileSync(tmpFile, WORKFLOW_SOURCE);

    try {
      const parsed = await parseWorkflow(tmpFile);
      expect(parsed.errors).toEqual([]);
      const workflow = parsed.ast;
      expect(workflow).toBeDefined();

      const result = generateInPlace(WORKFLOW_SOURCE, workflow!, { production: true });
      expect(result.code).not.toContain('// ── proc (processData) ──');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
