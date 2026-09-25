/**
 * `compileWorkflow` reports what validation said about the workflow it
 * compiled: a caller showing the code (fw_compile, the console) gets the
 * warnings beside it instead of an always-empty list.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { compileWorkflow, parseWorkflow, validateWorkflow } from '../../../src/api/index.js';

const fixture = path.resolve(__dirname, '..', '..', 'fixtures', 'lead-processing.ts');

describe('compileWorkflow analysis', () => {
  it('carries the validation warnings of the compiled workflow', async () => {
    const parsed = await parseWorkflow(fixture);
    const expected = validateWorkflow(parsed.ast).warnings;
    expect(expected.length).toBeGreaterThan(0);

    const result = await compileWorkflow(fixture, { write: false });
    expect(result.analysis.warnings.map((w) => w.code)).toEqual(expected.map((w) => w.code));
    expect(result.analysis.errors).toEqual([]);
  }, 60000);
});
