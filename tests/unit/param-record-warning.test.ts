/**
 * Tests that @param warnings are suppressed for catch-all Record types
 * like Record<string, never>, Record<string, any>, and Record<string, unknown>.
 */
import { describe, it, expect } from 'vitest';
import { parseWorkflow } from '../../src/api/parse';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function writeTempFile(content: string): string {
  const tmpFile = path.join(os.tmpdir(), `fw-param-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(tmpFile, content);
  return tmpFile;
}

describe('@param warning suppression for Record types', () => {
  it('should NOT warn for Record<string, never> params', async () => {
    const file = writeTempFile(`
/**
 * @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function doWork(value: string): { result: string } {
  return { result: value };
}

/**
 * @flowWeaver workflow
 * @node w doWork
 * @path Start -> w -> Exit
 * @param execute - Execute
 * @param subject - Subject line
 * @param body - Body text
 * @returns onSuccess - On Success
 * @returns onFailure - On Failure
 */
export async function testWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: false, onFailure: true };
}
`);

    try {
      const result = await parseWorkflow(file);
      const paramWarnings = result.warnings.filter(w => w.includes('does not match any field'));
      expect(paramWarnings, 'Should not warn about @param fields for Record<string, never>').toEqual([]);
      // The workflow should still parse successfully
      expect(result.ast).toBeDefined();
      expect(result.errors).toEqual([]);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('should still warn for typed params when field is missing', async () => {
    const file = writeTempFile(`
/**
 * @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function doWork(value: string): { result: string } {
  return { result: value };
}

/**
 * @flowWeaver workflow
 * @node w doWork
 * @path Start -> w -> Exit
 * @param execute - Execute
 * @param nonExistent - This field does not exist
 * @returns onSuccess - On Success
 * @returns onFailure - On Failure
 */
export async function testWorkflow(
  execute: boolean,
  params: { realField: string } = { realField: '' },
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: false, onFailure: true };
}
`);

    try {
      const result = await parseWorkflow(file);
      const paramWarnings = result.warnings.filter((w: string) => w.includes('does not match any field'));
      expect(paramWarnings.length, 'Should warn when typed params object is missing the field').toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(file);
    }
  });
});
