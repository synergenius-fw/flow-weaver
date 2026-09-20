/**
 * The approval template: generated, it parses and validates clean, pauses at
 * its gate when run, resumes with the approver's note, and takes the
 * failure path when refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getWorkflowTemplate } from '../../src/cli/templates/index.js';
import { parseWorkflow } from '../../src/api/parse.js';
import { validateWorkflow } from '../../src/api/validate.js';
import { createLocalCoordinator, createMemoryRunStore } from '../../src/coordinator/index.js';

let dir: string;
let file: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-approval-'));
  file = path.join(dir, 'approve.ts');
  fs.writeFileSync(file, getWorkflowTemplate('approval')!.generate({ workflowName: 'approveSpend' }));
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the approval template', () => {
  it('is listed, parses and validates clean', async () => {
    const t = getWorkflowTemplate('approval')!;
    expect(t.category).toBe('automation');
    const parsed = await parseWorkflow(file, { projectDir: dir });
    expect(parsed.errors).toEqual([]);
    const v = validateWorkflow(parsed.ast);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(parsed.ast.instances.map((i) => i.id)).toEqual(['prepare', 'approval', 'apply']);
  });

  it('pauses at the gate, resumes with the note, and follows the failure path when refused', async () => {
    const c = createLocalCoordinator({ store: createMemoryRunStore() });
    const paused = await c.start({ filePath: file, params: { request: { amount: 120, for: 'a keyboard' } } });
    expect(paused.status).toBe('waiting');
    expect(paused.gate).toMatchObject({ kind: 'approval', node: 'approval', inputs: { summary: '{"amount":120,"for":"a keyboard"}' } });
    const done = await c.resume({ runId: paused.runId, input: { answer: 'fine by me' } });
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ onSuccess: true, onFailure: false, outcome: 'applied {"amount":120,"for":"a keyboard"} -- fine by me' });

    const other = await c.start({ filePath: file, params: { request: 'a boat' } });
    const refused = await c.resume({ runId: other.runId, input: { reject: 'no boats' } });
    expect(refused.status).toBe('completed');
    expect(refused.result).toMatchObject({ onSuccess: false, onFailure: true });
  }, 60000);

  it('renames the ports when asked', () => {
    const code = getWorkflowTemplate('approval')!.generate({ workflowName: 'approveOrder', config: { input: 'order', output: 'status' } });
    expect(code).toContain('@param order');
    expect(code).toContain('@returns status');
    expect(code).toContain('function prepareOrder(order: any)');
  });
});
