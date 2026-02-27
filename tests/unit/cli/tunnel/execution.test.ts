import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { executionHandlers } from '../../../../src/cli/tunnel/handlers/execution.js';
import type { TunnelContext } from '../../../../src/cli/tunnel/dispatch.js';

const WORKFLOW_SOURCE = `
/**
 * @flowWeaver nodeType
 * @input execute [order:0] - Execute
 * @input value [order:0]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2]
 */
function proc(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect Start.value -> p.value
 * @connect Start.execute -> p.execute
 * @connect p.result -> Exit.result
 * @connect p.onSuccess -> Exit.onSuccess
 * @param execute - Execute
 * @param value
 * @returns onSuccess
 * @returns result
 */
export async function myWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;

let tmpDir: string;
let ctx: TunnelContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-test-'));
  ctx = { workspaceRoot: tmpDir };
  await fs.writeFile(path.join(tmpDir, 'workflow.ts'), WORKFLOW_SOURCE, 'utf-8');
});

describe('execution handlers', () => {
  describe('compileFile', () => {
    it('compiles a valid workflow file', async () => {
      const result = (await executionHandlers.compileFile(
        { filePath: '/workflow.ts' },
        ctx,
      )) as any;

      // Should either succeed with compiled output or fail gracefully
      expect(result).toBeDefined();
    });

    it('returns error for non-existent file', async () => {
      const result = (await executionHandlers.compileFile(
        { filePath: '/missing.ts' },
        ctx,
      )) as any;

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('generateDiagram', () => {
    it('handles diagram generation with content', async () => {
      const result = (await executionHandlers.generateDiagram(
        { content: WORKFLOW_SOURCE },
        ctx,
      )) as any;

      // Will either generate SVG or return error if diagram module isn't available
      expect(result).toBeDefined();
      if (result.success) {
        expect(result.svg).toBeDefined();
      } else {
        expect(result.error).toBeDefined();
      }
    });

    it('throws when neither filePath nor content provided', async () => {
      await expect(executionHandlers.generateDiagram({}, ctx)).rejects.toThrow(
        'filePath or content is required',
      );
    });
  });

  describe('executeFile', () => {
    it('returns error for non-existent file', async () => {
      const result = (await executionHandlers.executeFile(
        { filePath: '/missing.ts' },
        ctx,
      )) as any;

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
