/**
 * Tests for MCP developer experience improvements:
 * 1. @async accepted in workflow blocks
 * 2. fw_validate draft mode
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkflow, validateWorkflow } from '../../../src/api/index.js';
import { AnnotationParser } from '../../../src/parser.js';

// =============================================================================
// 1. @async in workflow blocks
// =============================================================================

describe('@async in workflow blocks', () => {
  it('should not warn on @async annotation in workflow JSDoc', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver nodeType */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}

/**
 * @flowWeaver workflow @async
 * @node a myNode
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean, params: {}): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);
    const asyncWarnings = result.warnings.filter((w: string) => w.includes('Unknown annotation @async'));
    expect(asyncWarnings).toHaveLength(0);
  });
});

// =============================================================================
// 2. fw_validate draft mode
// =============================================================================

describe('fw_validate draft mode', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-validate-draft-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('draft mode should suppress STUB_NODE errors', async () => {
    const src = `
/** @flowWeaver node */
declare function myStub(x: string): string;

/**
 * @flowWeaver workflow @autoConnect
 * @node myStub myStub
 * @path Start -> myStub -> Exit
 */
export async function testWf() {}
`;
    const file = path.join(tmpDir, 'stub.ts');
    fs.writeFileSync(file, src);

    const parseRes = await parseWorkflow(file);
    expect(parseRes.errors).toHaveLength(0);

    // Normal mode: STUB_NODE errors present
    const normalResult = validateWorkflow(parseRes.ast);
    expect(normalResult.errors.some((e) => e.code === 'STUB_NODE')).toBe(true);

    // Draft mode: STUB_NODE errors suppressed (reclassified to warnings)
    const draftResult = validateWorkflow(parseRes.ast, { mode: 'draft' });
    expect(draftResult.errors.some((e) => e.code === 'STUB_NODE')).toBe(false);
  });
});
