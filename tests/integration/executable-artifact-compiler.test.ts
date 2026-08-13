import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  compileExecutableWorkflowArtifact,
  EXECUTABLE_WORKFLOW_METADATA_EXPORT,
  EXECUTABLE_WORKFLOW_MODULE_FORMAT,
} from '../../src/compiler/index.js';

describe('executable workflow artifact compiler', () => {
  it('emits a closed executable module and compiler-owned metadata', async () => {
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } { return { result: value * 2 }; }

/** @flowWeaver workflow
 * @node d doubleIt
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param value
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function simpleWorkflow(
  execute: boolean,
  params: { value: number },
): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not compiled');
}
`;

    const artifact = await compileExecutableWorkflowArtifact({
      source,
      workflowName: 'simpleWorkflow',
    });

    expect(artifact).toMatchObject({
      formatVersion: 1,
      workflowName: 'simpleWorkflow',
    });
    expect(artifact.code).toContain('@flow-weaver-body-start');
    expect(artifact.code).toContain(`export const ${EXECUTABLE_WORKFLOW_METADATA_EXPORT}`);
    expect(artifact.code).toContain(`\"formatVersion\":${EXECUTABLE_WORKFLOW_MODULE_FORMAT}`);
  });

  it('emits durable graph metadata without owning a production executor', async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/continuation/fixtures/durable-approval.ts'),
      'utf8',
    );

    const artifact = await compileExecutableWorkflowArtifact({
      source,
      workflowName: 'durableApproval',
    });

    expect(artifact.code).toContain('\"gate\":true');
    expect(artifact.code).toContain('\"continuationGraph\"');
  });

  it('rejects a workflow name outside the supplied source closure', async () => {
    await expect(compileExecutableWorkflowArtifact({
      source: '/** @flowWeaver workflow */\nexport function present() {}',
      workflowName: 'missing',
    })).rejects.toThrow('Workflow missing is not declared');
  });
});
