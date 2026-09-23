/**
 * `[mergeStrategy:X]` on an `@input` must travel from the annotation to the
 * running code.
 *
 * The validator honoured the strategy (a port with one can take several
 * connections), but the parser dropped it when it turned an `@input` into a
 * port definition, and the generator ignored it anyway: every fan-in was
 * emitted as a `??` chain, which is FIRST whatever the author asked for. So
 * `COLLECT`, `LAST`, `MERGE` and `CONCAT` were documented, accepted, and never
 * applied -- the kind of gap an author only discovers at run time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parser } from '../../src/parser/annotation-parser';
import { validateWorkflow } from '../../src/api/validate';
import { executeWorkflow } from '../../src/mcp/workflow-executor';

const SOURCE = `/**
 * @flowWeaver nodeType
 * @expression
 * @input seed - Seed
 * @output left - Left value
 * @output right - Right value
 */
export function split(seed: number): { left: number; right: number } {
  return { left: seed, right: seed * 10 };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input values [mergeStrategy:COLLECT] - Every incoming value
 * @output total - Sum of the collected values
 * @output count - How many arrived
 */
export function gather(values: number[]): { total: number; count: number } {
  return { total: values.reduce((a, b) => a + b, 0), count: values.length };
}

/**
 * @flowWeaver workflow
 * @param seed - Seed
 * @returns total - Sum
 * @returns count - Count
 * @node s split
 * @node g gather
 * @path Start -> s -> g -> Exit
 * @connect s.left -> g.values
 * @connect s.right -> g.values
 */
export async function collectBoth(
  execute: boolean,
  params: { seed: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; total: number; count: number }> {
  throw new Error('generated body was not installed');
}
`;

describe('mergeStrategy declared on an @input', () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-merge-'));
    tmpFile = path.join(tmpDir, 'merge.ts');
    fs.writeFileSync(tmpFile, SOURCE, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('survives parsing onto the port definition', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    const gather = wf.nodeTypes.find((nt) => nt.functionName === 'gather');
    expect(gather?.inputs.values.mergeStrategy).toBe('COLLECT');
  });

  it('lets the port take several connections', () => {
    const wf = parser.parse(tmpFile).workflows[0];
    const result = validateWorkflow(wf);
    const codes = result.errors.map((e) => (typeof e === 'string' ? e : e.code));
    expect(codes).not.toContain('MULTIPLE_CONNECTIONS_TO_INPUT');
  });

  it('is applied at run time: COLLECT hands the node every value', async () => {
    const outcome = await executeWorkflow({
      runId: 'merge-collect',
      filePath: tmpFile,
      workflowName: 'collectBoth',
      params: { seed: 3 },
      production: true,
      includeTrace: false,
    });
    if (outcome.kind !== 'completed') throw new Error('expected completion');
    const result = outcome.result as { total?: unknown; count?: unknown };
    expect(result.count).toBe(2);
    expect(result.total).toBe(33);
  });
});
