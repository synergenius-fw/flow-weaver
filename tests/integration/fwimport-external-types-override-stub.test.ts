/**
 * Regression: an `@fwImport <name> <fn> from "<pkg>"` whose package cannot
 * be resolved on disk (the on-device case: a Console install dir has no
 * `node_modules` to read the package `.d.ts` from) produces a generic
 * import STUB nodeType (`inputs: {}`, `outputs: { result }`). When the
 * caller ALSO supplies `externalNodeTypes` carrying the node's real port
 * shape (resolved from the install's wire manifest), the parser MUST use
 * the real ports, not let the port-less stub win.
 *
 * This is the platform's offline-device approval-gate path: the testkit
 * "Approval Gate" workflow does `@fwImport waitForApproval ... from
 * "@synergenius/flow-weaver-pack-core"` (the runtime provides the impl
 * via the vm-host linker) and the Console threads the node's ports from
 * the install manifest into `parseWorkflow`'s externalNodeTypes. The
 * workflow body below is the VERBATIM device install
 * (`pack-testkit@0.1.14/workflows/approval.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parser, TExternalNodeType } from '../../src/parser';
import { parseWorkflow } from '../../src/api/parse';
import { compileWorkflow } from '../../src/api/compile';

// Verbatim copy of the on-device testkit Approval Gate workflow.
const DEVICE_WORKFLOW = `/**
 * Approval Gate
 */
export interface ApprovalOutcome {
  approved: boolean;
  decidedReason: string;
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Prepare Prompt
 * @input question - The question to ask the approver
 * @output prompt - The prompt text shown to the human reviewer
 * @output context - Optional structured context passed to the approver
 */
function preparePrompt(question: string): { prompt: string; context: string } {
  const q =
    typeof question === 'string' && question.trim().length > 0 ? question.trim() : 'Approve this test run?';
  return { prompt: q, context: 'Testkit Approval Gate run.' };
}

/**
 * @flowWeaver nodeType
 * @label Decide
 * @input execute - Gate execute signal
 * @input approved - Whether the approver chose to proceed
 * @input note - The approver's free-form note
 * @output outcome - The resolved approval outcome
 */
function decide(
  execute: boolean,
  approved: boolean,
  note: string,
): { onSuccess: boolean; onFailure: boolean; outcome: ApprovalOutcome } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, outcome: { approved: false, decidedReason: '' } };
  }
  const didApprove = approved === true;
  const outcome: ApprovalOutcome = { approved: didApprove, decidedReason: note ?? '' };
  return { onSuccess: didApprove, onFailure: !didApprove, outcome };
}

/**
 * @flowWeaver workflow
 * @summary Wait for a human approval.
 * @category testing
 * @fwImport waitForApproval waitForApproval from "@synergenius/flow-weaver-pack-core"
 *
 * @param {string} [question="Approve this test run?"] - The question shown to the approver.
 * @returns outcome - The resolved approval outcome
 *
 *
 * @node prepare preparePrompt
 * @node approver waitForApproval [expr: approverId="'testkit-approver'"]
 * @node decide decide
 *
 *
 * @path Start -> prepare -> approver -> decide -> Exit
 * @path approver:fail -> decide
 * @path decide:fail -> Exit
 *
 * @connect Start.question -> prepare.question
 * @connect prepare.prompt -> approver.prompt
 * @connect prepare.context -> approver.context
 * @connect approver.approved -> decide.approved
 * @connect approver.reason -> decide.note
 * @connect decide.outcome -> Exit.outcome
 */
export function approval(
  execute: boolean,
  params: { question: string },
): { onSuccess: boolean; onFailure: boolean; outcome: ApprovalOutcome } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, outcome: { approved: false, decidedReason: '' } };
  }
  throw new Error('stub: ' + params.question);
}
`;

// The real port shape the Console resolves from the install wire manifest.
const WAIT_FOR_APPROVAL: TExternalNodeType = {
  name: 'waitForApproval',
  functionName: 'waitForApproval',
  ports: [
    { name: 'prompt', type: 'String', direction: 'INPUT' },
    { name: 'context', type: 'String', direction: 'INPUT' },
    { name: 'approverId', type: 'String', direction: 'INPUT' },
    { name: 'approved', type: 'Boolean', direction: 'OUTPUT' },
    { name: 'rejected', type: 'Boolean', direction: 'OUTPUT' },
    { name: 'reason', type: 'String', direction: 'OUTPUT' },
  ],
};

describe('@fwImport (unresolvable pkg) + externalNodeTypes overrides the stub', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    // mkdtemp under os.tmpdir(): no `@synergenius/flow-weaver-pack-core`
    // resolvable above the workflow file, reproducing the device install dir.
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-fwimport-ext-'));
    tempFile = path.join(tempDir, 'approval.ts');
    fs.writeFileSync(tempFile, DEVICE_WORKFLOW, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('parser.parse: resolves the @node to the real external ports, not the import stub', () => {
    const parsed = parser.parse(tempFile, [WAIT_FOR_APPROVAL]);
    const approver = parsed.nodeTypes.find((nt) => nt.name === 'waitForApproval');
    expect(approver, 'waitForApproval nodeType should be present').toBeDefined();
    expect(Object.keys(approver!.inputs)).toContain('prompt');
    expect(Object.keys(approver!.inputs)).toContain('context');
    expect(Object.keys(approver!.outputs)).toContain('approved');
    expect(Object.keys(approver!.outputs)).toContain('reason');
    expect(Object.keys(approver!.outputs)).not.toContain('result');
  });

  it('parseWorkflow (the compile entry): compiles without "does not have port" errors', async () => {
    parser.clearCache();
    const result = await parseWorkflow(tempFile, {
      workflowName: 'approval',
      externalNodeTypes: [WAIT_FOR_APPROVAL],
    });
    const portErrors = (result.errors ?? []).filter((e) => {
      const msg = typeof e === 'string' ? e : (e as { message?: string }).message ?? '';
      return /approver|does not have|port/i.test(msg);
    });
    expect(portErrors).toEqual([]);
  });

  it('compileWorkflow (the device run path): validates without throwing on stub ports', async () => {
    // This is the exact path `executeWorkflow` takes on-device:
    // compileWorkflow -> parseWorkflow (gets externalNodeTypes) -> validateWorkflow
    // (validates node-instance connections against the resolved node types).
    // Before the fix, the import stub shadowed the real ports and this threw
    // "Validation errors: Node "approver" does not have input port ...".
    parser.clearCache();
    await expect(
      compileWorkflow(tempFile, {
        write: false,
        parse: { workflowName: 'approval', externalNodeTypes: [WAIT_FOR_APPROVAL] },
      }),
    ).resolves.toBeDefined();
  });
});
