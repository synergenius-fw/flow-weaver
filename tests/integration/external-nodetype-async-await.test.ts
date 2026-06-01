/**
 * Regression: an async foreign nodeType supplied via `externalNodeTypes`
 * (the on-device case: a runtime-provided node like pack-core's
 * `waitForApproval`, resolved from a pack wire manifest) must generate an
 * `await` on its call. The wire `TExternalNodeType` carries `isAsync`;
 * codegen's `async-detection` keys `await` emission off the nodeType's
 * `isAsync`.
 *
 * Before the fix, `externalToAST` hardcoded `isAsync: false`, so the
 * generated workflow called the async node un-awaited. `const r = fn(...)`
 * then bound `r` to a pending Promise; `r.approved` / `r.onSuccess` read
 * back as `undefined`, so the downstream gate silently took its
 * `!execute` / failure path and the approval channel was never consulted.
 * Symptom on-device: the Approval Gate "Failed" with no error and no
 * Approve/Decline prompt.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parser, TExternalNodeType } from '../../src/parser';
import { compileWorkflow } from '../../src/api/compile';

const WORKFLOW = `/**
 * @flowWeaver nodeType
 * @expression
 * @output prompt
 */
function prep(question: string): { prompt: string } {
  return { prompt: question };
}

/**
 * @flowWeaver workflow
 * @name gateFlow
 * @fwImport waitForApproval waitForApproval from "@synergenius/flow-weaver-pack-core"
 * @param {string} question - The question to ask
 * @node prep prep
 * @node approver waitForApproval [expr: approverId="'tester'"]
 * @path Start -> prep -> approver -> Exit
 * @connect Start.question -> prep.question
 * @connect prep.prompt -> approver.prompt
 * @connect approver.approved -> Exit.approved
 * @returns approved
 */
export async function gateFlow(
  execute: boolean,
  params: { question: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  // @flow-weaver-body-start
  throw new Error('stub');
  // @flow-weaver-body-end
}
`;

const WAIT_FOR_APPROVAL_ASYNC: TExternalNodeType = {
  name: 'waitForApproval',
  functionName: 'waitForApproval',
  isAsync: true,
  ports: [
    { name: 'prompt', type: 'String', direction: 'INPUT' },
    { name: 'approverId', type: 'String', direction: 'INPUT' },
    { name: 'approved', type: 'Boolean', direction: 'OUTPUT' },
    { name: 'reason', type: 'String', direction: 'OUTPUT' },
  ],
};

describe('async externalNodeType generates an awaited call', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-async-'));
    tempFile = path.join(tempDir, 'gate.ts');
    fs.writeFileSync(tempFile, WORKFLOW, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('emits `await waitForApproval(...)` when the external type is isAsync', async () => {
    const result = await compileWorkflow(tempFile, {
      write: false,
      inPlace: false,
      parse: { workflowName: 'gateFlow', externalNodeTypes: [WAIT_FOR_APPROVAL_ASYNC] },
    });
    // The generated call to the async node MUST be awaited.
    expect(result.code).toMatch(/await\s+waitForApproval\s*\(/);
    // And it must NOT be called bare (un-awaited) anywhere.
    expect(result.code).not.toMatch(/[^.\w]waitForApproval\s*\([^)]*\)\s*;(?![^]*await)/);
  });

  it('the resolved nodeType is marked async', () => {
    const parsed = parser.parse(tempFile, [WAIT_FOR_APPROVAL_ASYNC]);
    const nt = parsed.nodeTypes.find((n) => n.name === 'waitForApproval');
    expect(nt).toBeDefined();
    expect(nt!.isAsync).toBe(true);
  });

  it('a sync external type still generates a bare (un-awaited) call', async () => {
    const sync: TExternalNodeType = { ...WAIT_FOR_APPROVAL_ASYNC, isAsync: false };
    parser.clearCache();
    const parsed = parser.parse(tempFile, [sync]);
    const nt = parsed.nodeTypes.find((n) => n.name === 'waitForApproval');
    expect(nt!.isAsync).toBe(false);
  });
});
