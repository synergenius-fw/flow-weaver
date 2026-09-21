import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findWorkflows } from '../../../src/api/query.js';

/**
 * findWorkflows scans a directory for workflow files and summarises each. It
 * moved from the removed pattern API into the query API; these tests pin its
 * behaviour there against real files in a temp directory.
 */

let dir: string;

const WF = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - v
 * @output result - r
 */
function up(value: string): string { return value; }

/**
 * @flowWeaver workflow
 * @param data - d
 * @returns result - r
 * @node u up
 * @path Start -> u -> Exit
 */
export function %NAME%(execute: boolean, params: { data: string }): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('stub');
}
`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-findwf-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('findWorkflows', () => {
  it('returns an empty array when there are no workflow files', async () => {
    fs.writeFileSync(path.join(dir, 'plain.ts'), 'export const x = 1;\n');
    expect(await findWorkflows(dir)).toEqual([]);
  });

  it('returns a summary of each workflow file', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), WF.replace('%NAME%', 'flowA'));
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const y = 2;\n');

    const result = await findWorkflows(dir);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe(path.join(dir, 'a.ts'));
    expect(result[0].workflows).toHaveLength(1);
    expect(result[0].workflows[0].name).toBe('flowA');
    expect(result[0].workflows[0].nodeCount).toBe(1);
  });

  it('honours a custom glob pattern', async () => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'w.workflow.ts'), WF.replace('%NAME%', 'flowW'));
    fs.writeFileSync(path.join(dir, 'other.ts'), WF.replace('%NAME%', 'flowOther'));

    const result = await findWorkflows(dir, 'src/**/*.workflow.ts');
    expect(result).toHaveLength(1);
    expect(result[0].workflows[0].name).toBe('flowW');
  });

  it('finds several files under one directory', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), WF.replace('%NAME%', 'flowA'));
    fs.writeFileSync(path.join(dir, 'b.ts'), WF.replace('%NAME%', 'flowB'));

    const result = await findWorkflows(dir);
    expect(result).toHaveLength(2);
    expect(result.flatMap((r) => r.workflows.map((w) => w.name)).sort()).toEqual(['flowA', 'flowB']);
  });
});
