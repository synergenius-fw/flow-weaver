/**
 * Build-time executable artifact emission for workflow deployments.
 *
 * The interactive executor still accepts source for development tooling. A
 * deployed workflow, however, must never make a user wait for parsing and
 * compilation after pressing Run. This compiler boundary turns a
 * closed TypeScript workflow source into one ESM module before it is signed.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import {
  compileWorkflow,
  getAvailableWorkflows,
  parseWorkflow,
  parseWorkflowSourceAtPath,
} from '../api/index.js';
import { validateDurableClosure } from '../api/durable-validation.js';
import { graphIdentity } from '../api/graph-identity.js';
import type { TExternalNodeType } from '../parser/annotation-parser.js';
import {
  EXECUTABLE_WORKFLOW_METADATA_EXPORT,
  EXECUTABLE_WORKFLOW_MODULE_FORMAT,
  type ExecutableWorkflowModuleMetadata,
} from '../runtime/executable-module-contract.js';
import { GENERATOR_ABI } from '../runtime/continuation.js';
import {
  applyDurableSourceProof,
  DurableSourceProof,
} from './durable-source-proof.js';

export {
  EXECUTABLE_WORKFLOW_METADATA_EXPORT,
  EXECUTABLE_WORKFLOW_MODULE_FORMAT,
  type ExecutableWorkflowModuleMetadata,
} from '../runtime/executable-module-contract.js';

export interface ExecutableWorkflowArtifactRequest {
  readonly source: string;
  readonly workflowName: string;
  readonly externalNodeTypes?: readonly TExternalNodeType[];
  /**
   * Typed, pre-erasure workflow source at its real import base. Required when
   * `source` was flattened by a transform that removes type declarations.
   */
  readonly durableValidationSource?: Readonly<{
    source: string;
    sourcePath: string;
    resolveImport?: (specifier: string, importer: string) => string | undefined;
    loadSource?: (filePath: string) => string | undefined;
  }>;
}

export interface ExecutableWorkflowArtifact {
  readonly formatVersion: 1;
  readonly workflowName: string;
  readonly code: string;
}

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
    const durableSourceProof = request.durableValidationSource === undefined
      ? undefined
      : DurableSourceProof.create(
          await parseWorkflowSourceAtPath(
            request.durableValidationSource.sourcePath,
            request.durableValidationSource.source,
            {
              workflowName: request.workflowName,
              ...(request.externalNodeTypes === undefined
                ? {}
                : { externalNodeTypes: [...request.externalNodeTypes] }),
              ...(request.durableValidationSource.resolveImport === undefined
                ? {}
                : { sourceImportResolver: request.durableValidationSource.resolveImport }),
              ...(request.durableValidationSource.loadSource === undefined
                ? {}
                : { sourceOverrideLoader: request.durableValidationSource.loadSource }),
            },
          ),
          request.durableValidationSource.source,
        );
    await writeFile(filePath, request.source, { encoding: 'utf8', mode: 0o600 });
    const metadata = await createExecutableWorkflowMetadata(
      filePath,
      request.workflowName,
      request.externalNodeTypes,
      durableSourceProof,
      request.source,
    );
    for (const workflow of workflows) {
      // Sequential compilation is intentional: every generated body remains
      // in the same module for local workflow composition.
       
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
        ...(durableSourceProof === undefined ? {} : {
          durableSourceProof,
          durableFlattenedSource: request.source,
        }),
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
    const metadataExport = `\nexport const ${EXECUTABLE_WORKFLOW_METADATA_EXPORT} = Object.freeze(${JSON.stringify(metadata)});\n`;
    return Object.freeze({
      formatVersion: 1,
      workflowName: request.workflowName,
      code: `${transpiled}${metadataExport}`,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createExecutableWorkflowMetadata(
  filePath: string,
  workflowName: string,
  externalNodeTypes: readonly TExternalNodeType[] | undefined,
  durableSourceProof: DurableSourceProof | undefined,
  flattenedSource: string,
): Promise<ExecutableWorkflowModuleMetadata> {
  const parsed = await parseWorkflow(filePath, {
    workflowName,
    projectDir: dirname(filePath),
    ...(externalNodeTypes === undefined ? {} : { externalNodeTypes: [...externalNodeTypes] }),
  });
  if (parsed.errors.length > 0) {
    throw new Error(`Cannot emit executable artifact metadata: ${parsed.errors.join('; ')}`);
  }
  if (durableSourceProof !== undefined) {
    applyDurableSourceProof(durableSourceProof, parsed, flattenedSource);
  }
  validateDurableClosure(parsed.ast, parsed.allWorkflows);
  const { graphFingerprint, continuationGraph, capabilities } = graphIdentity(parsed.ast, parsed.allWorkflows);
  return Object.freeze({
    formatVersion: EXECUTABLE_WORKFLOW_MODULE_FORMAT,
    generatorAbi: GENERATOR_ABI,
    workflowName,
    workflowNames: parsed.allWorkflows.map((workflow) => workflow.functionName).sort(),
    graphFingerprint,
    continuationGraph,
    capabilities,
  });
}
