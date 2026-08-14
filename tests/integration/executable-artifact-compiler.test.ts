import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  compileExecutableWorkflowArtifact,
  EXECUTABLE_WORKFLOW_METADATA_EXPORT,
  EXECUTABLE_WORKFLOW_MODULE_FORMAT,
} from '../../src/compiler/index.js';

describe('executable workflow artifact compiler', () => {
  const deterministicSource = `
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
export function deterministicWorkflow(
  execute: boolean,
  params: { value: number },
): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not compiled');
}
`;

  function graphFingerprint(code: string): string {
    const match = code.match(/"graphFingerprint":"([a-f0-9]{64})"/);
    if (!match) throw new Error('executable artifact metadata has no graph fingerprint');
    return match[1];
  }

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

  it('emits byte-identical artifacts and graph fingerprints for identical input', async () => {
    const first = await compileExecutableWorkflowArtifact({
      source: deterministicSource,
      workflowName: 'deterministicWorkflow',
    });
    const second = await compileExecutableWorkflowArtifact({
      source: deterministicSource,
      workflowName: 'deterministicWorkflow',
    });

    expect(second.code).toBe(first.code);
    expect(graphFingerprint(second.code)).toBe(graphFingerprint(first.code));
  });

  it('changes the graph fingerprint when the executable graph changes', async () => {
    const original = await compileExecutableWorkflowArtifact({
      source: deterministicSource,
      workflowName: 'deterministicWorkflow',
    });
    const changed = await compileExecutableWorkflowArtifact({
      source: deterministicSource
        .replace('@node d doubleIt', '@node doubled doubleIt')
        .replaceAll('d.', 'doubled.'),
      workflowName: 'deterministicWorkflow',
    });

    expect(graphFingerprint(changed.code)).not.toBe(graphFingerprint(original.code));
  });

  it('validates named durable-effect types when the closed source contains their declarations', async () => {
    const source = `
interface Receipt { readonly schemaVersion: 1; readonly operationKey: string }
interface Report { readonly month: string; readonly ready: number }
interface Result {
  readonly report: Report;
  readonly stepReport: string;
  readonly onSuccess: boolean;
  readonly onFailure: boolean;
}

/** @flowWeaver nodeType
 * @durableEffect
 * @expression
 * @input month
 * @output report
 * @output stepReport
 */
async function assemble(
  month: string,
  operationKey: string,
): Promise<{ receipt: Receipt; result: Result }> {
  return {
    receipt: { schemaVersion: 1, operationKey },
    result: {
      report: { month, ready: 1 },
      stepReport: month,
      onSuccess: true,
      onFailure: false,
    },
  };
}

/** @flowWeaver workflow
 * @node effect assemble
 * @connect Start.execute -> effect.execute
 * @connect Start.month -> effect.month
 * @connect effect.report -> Exit.report
 * @param month
 * @returns report
 */
export async function namedDurableTypes(
  execute: boolean,
  params: { month: string },
): Promise<{ report: Report; onSuccess: boolean; onFailure: boolean }> {
  throw new Error(String(execute) + params.month);
}
`;

    await expect(compileExecutableWorkflowArtifact({
      source,
      workflowName: 'namedDurableTypes',
    })).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));
  });

  it('fails closed when a pre-bundler restores headers without their named type declarations', async () => {
    const source = `
/** @flowWeaver nodeType
 * @durableEffect
 * @expression
 * @input month
 * @output report
 * @output stepReport
 */
async function assemble(
  month: string,
  operationKey: string,
): Promise<{ receipt: ErasedReceipt; result: ErasedResult }> {
  return {
    receipt: { schemaVersion: 1, operationKey },
    result: {
      report: { month, ready: 1 },
      stepReport: month,
      onSuccess: true,
      onFailure: false,
    },
  };
}

/** @flowWeaver workflow
 * @node effect assemble
 * @connect Start.execute -> effect.execute
 * @connect Start.month -> effect.month
 * @connect effect.report -> Exit.report
 * @param month
 * @returns report
 */
export async function erasedDurableTypes(
  execute: boolean,
  params: { month: string },
): Promise<{ report: { month: string; ready: number }; onSuccess: boolean; onFailure: boolean }> {
  throw new Error(String(execute) + params.month);
}
`;

    await expect(compileExecutableWorkflowArtifact({
      source,
      workflowName: 'erasedDurableTypes',
    })).rejects.toThrow(
      /Durable effect contract errors:[\s\S]*ErasedReceipt \(\$ is ErasedReceipt\)/,
    );
  });

  it('binds a strict pre-erasure proof to an otherwise type-erased closed artifact', async () => {
    const declarations = `
export interface ErasedReceipt { readonly operationKey: string }
export interface ErasedReport { readonly month: string; readonly ready: number }
export interface ErasedResult {
  readonly report: ErasedReport;
  readonly stepReport: string;
  readonly onSuccess: boolean;
  readonly onFailure: boolean;
}
`;
    const erased = `
/** @flowWeaver nodeType
 * @durableEffect
 * @expression
 * @input month
 * @output report
 * @output stepReport
 */
async function assembleErased(
  month: string,
  operationKey: string,
): Promise<{ receipt: ErasedReceipt; result: ErasedResult }> {
  return {
    receipt: { operationKey },
    result: {
      report: { month, ready: 1 },
      stepReport: month,
      onSuccess: true,
      onFailure: false,
    },
  };
}

/** @flowWeaver workflow
 * @node effect assembleErased
 * @connect Start.execute -> effect.execute
 * @connect Start.month -> effect.month
 * @connect effect.report -> Exit.report
 * @param month
 * @returns report
 */
export async function prevalidatedErasedTypes(
  execute: boolean,
  params: { month: string },
): Promise<{ report: ErasedReport; onSuccess: boolean; onFailure: boolean }> {
  throw new Error(String(execute) + params.month);
}
`;
    const typed = `${declarations}${erased}`;
    const sourcePath = path.join(process.cwd(), 'tests/fixtures/prevalidated-erased.ts');

    await expect(compileExecutableWorkflowArtifact({
      source: erased,
      workflowName: 'prevalidatedErasedTypes',
      durableValidationSource: { source: typed, sourcePath },
    })).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));

    const virtualRoot = path.join(process.cwd(), 'tests/fixtures/virtual-proof');
    const virtualTypes = path.join(virtualRoot, 'effect-types.ts');
    const importedTyped = `
import type { ErasedReceipt, ErasedReport, ErasedResult } from './effect-types.js';
${erased}`;
    await expect(compileExecutableWorkflowArtifact({
      source: erased,
      workflowName: 'prevalidatedErasedTypes',
      durableValidationSource: {
        source: importedTyped,
        sourcePath: path.join(virtualRoot, 'workflow.ts'),
        resolveImport: (specifier, importer) =>
          specifier === './effect-types.js'
            ? virtualTypes
            : path.resolve(path.dirname(importer), specifier),
        loadSource: (filePath) => filePath === virtualTypes ? declarations : undefined,
      },
    })).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));
  });

  it('rejects flattened return binding, operation-key, and result-key drift from typed proof', async () => {
    const typed = `
interface Receipt { operationKey: string }
interface Result { report: { month: string }; onSuccess: boolean; onFailure: boolean }
/** @flowWeaver nodeType
 * @durableEffect
 * @expression
 * @input month
 * @output report
 */
async function effect(month: string, operationKey: string): Promise<{receipt: Receipt; result: Result}> {
  return { receipt: { operationKey }, result: { report: { month }, onSuccess: true, onFailure: false } };
}
/** @flowWeaver workflow
 * @node effect effect
 * @connect Start.execute -> effect.execute
 * @connect Start.month -> effect.month
 * @connect effect.report -> Exit.report
 * @param month
 * @returns report
 */
export async function drifted(execute: boolean, params: {month: string}): Promise<{report: {month: string}; onSuccess: boolean; onFailure: boolean}> { throw new Error(String(execute) + params.month); }
`;
    const erased = typed
      .replace(/interface Receipt[^\n]*\n/u, '')
      .replace(/interface Result[^\n]*\n/u, '');
    const variants = [
      erased.replace(
        'result: { report: { month }, onSuccess: true, onFailure: false }',
        'result: { wrong: { month }, onSuccess: true, onFailure: false }',
      ),
      erased.replace(
        'async function effect(month: string, operationKey: string)',
        'async function effect(month: string)',
      ),
      erased.replace(
        'return { receipt: { operationKey }, result:',
        'return { result:',
      ),
    ];

    for (const source of variants) {
      await expect(compileExecutableWorkflowArtifact({
        source,
        workflowName: 'drifted',
        durableValidationSource: {
          source: typed,
          sourcePath: path.join(process.cwd(), 'tests/fixtures/drifted.ts'),
        },
      })).rejects.toThrow(/return binding differs|result fields differ|receipt|operation key/i);
    }
  });
});
