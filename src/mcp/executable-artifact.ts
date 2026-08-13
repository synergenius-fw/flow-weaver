/**
 * Build-time executable artifact emission for sealed workflow deployments.
 *
 * The interactive executor still accepts source for development tooling. A
 * deployed Stitch workflow, however, must never make an accountant wait for
 * parsing and compilation after pressing Run. This compiler boundary turns a
 * closed TypeScript workflow source into one ESM module before it is signed.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { compileWorkflow, getAvailableWorkflows } from '../api/index.js';
import type { TExternalNodeType } from '../parser.js';

export interface ExecutableWorkflowArtifactRequest {
  readonly source: string;
  readonly workflowName: string;
  readonly externalNodeTypes?: readonly TExternalNodeType[];
}

export interface ExecutableWorkflowArtifact {
  readonly formatVersion: 1;
  readonly workflowName: string;
  readonly code: string;
}

/** The signed module export holding the closed source graph for resume checks. */
export const EXECUTABLE_WORKFLOW_ARTIFACT_SOURCE_EXPORT = '__flowWeaverArtifactSource';

/**
 * Compile every workflow in a closed source module, then transpile the
 * generated TypeScript to an ESM module ready for a trusted executor. The
 * temporary source is private and removed before this operation resolves.
 */
export async function compileExecutableWorkflowArtifact(
  request: ExecutableWorkflowArtifactRequest,
): Promise<ExecutableWorkflowArtifact> {
  if (request.workflowName.trim().length === 0) {
    throw new Error('workflowName must be non-empty');
  }
  const workflows = getAvailableWorkflows(request.source);
  if (!workflows.some((workflow) => workflow.functionName === request.workflowName)) {
    throw new Error(`Workflow ${request.workflowName} is not declared by the artifact source`);
  }
  const directory = await mkdtemp(join(tmpdir(), 'flow-weaver-artifact-'));
  const filePath = join(directory, 'workflow.ts');
  try {
    await writeFile(filePath, request.source, { encoding: 'utf8', mode: 0o600 });
    for (const workflow of workflows) {
      // Sequential compilation is intentional: every generated body remains
      // in the same module for local workflow composition.
      // eslint-disable-next-line no-await-in-loop
      await compileWorkflow(filePath, {
        write: true,
        inPlace: true,
        parse: {
          workflowName: workflow.functionName,
          ...(request.externalNodeTypes === undefined ? {} : { externalNodeTypes: [...request.externalNodeTypes] }),
        },
        // The deployed artifact keeps step instrumentation. A runtime may
        // choose not to subscribe, but it must be able to report steps.
        generate: { production: false },
      });
    }
    const generated = await readFile(filePath, 'utf8');
    const transpiled = ts.transpileModule(generated, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        esModuleInterop: true,
      },
    }).outputText;
    // TypeScript removes node-type JSDoc from emitted JavaScript. Persist the
    // closed source graph as an ESM export inside the same signed byte stream:
    // executors use it only to validate durable identity/continuations, while
    // they invoke the already generated body above.
    const code = `${transpiled}\nexport const ${EXECUTABLE_WORKFLOW_ARTIFACT_SOURCE_EXPORT} = ${JSON.stringify(request.source)};\n`;
    return Object.freeze({ formatVersion: 1, workflowName: request.workflowName, code });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
