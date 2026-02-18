/**
 * WU7: S11 — "No workflows found" should mention nodeType prerequisite
 */

import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../../src/parser';

describe('parse error messages', () => {
  it('should mention nodeType in no-workflow error guidance', () => {
    const parser = new AnnotationParser();
    // A file with no @flowWeaver annotations
    const result = parser.parseFromString(`
      function helper(x: number) {
        return x * 2;
      }
    `);

    // No workflows or node types found
    expect(result.workflows).toHaveLength(0);
    expect(result.nodeTypes).toHaveLength(0);

    // This test verifies what the parseWorkflow API returns.
    // We can't test parseWorkflow directly here (it needs a file),
    // so we just verify the parser returns empty results.
    // The actual message test is below using the api/parse module.
  });
});

// Test the API-level error message
import { parseWorkflow } from '../../src/api/parse';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('parseWorkflow error message for no workflows', () => {
  it('should mention nodeType annotation in guidance when no workflows found', async () => {
    // Write a temporary file with no annotations
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `test-no-workflow-${Date.now()}.ts`);
    fs.writeFileSync(
      tmpFile,
      `
      export function helper(x: number) {
        return x * 2;
      }
    `
    );

    try {
      const result = await parseWorkflow(tmpFile);
      expect(result.errors.length).toBeGreaterThan(0);
      const errorMsg = result.errors.join(' ');
      // Should mention both workflow and nodeType
      expect(errorMsg).toContain('workflow');
      expect(errorMsg).toContain('nodeType');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
