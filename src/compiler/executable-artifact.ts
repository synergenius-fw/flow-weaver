/**
 * Build-time executable artifact emission for workflow deployments.
 *
 * The interactive executor still accepts source for development tooling. A
 * deployed Stitch workflow, however, must never make an accountant wait for
 * parsing and compilation after pressing Run. This compiler boundary turns a
 * closed TypeScript workflow source into one ESM module before it is signed.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { compileWorkflow, getAvailableWorkflows, parseWorkflow } from '../api/index.js';
import { durableBranchPaths, validateDurableClosure } from '../api/durable-validation.js';
import { getTopologicalOrder } from '../api/query.js';
import type { TExternalNodeType } from '../parser.js';
import {
  canonicalWireValue,
  type ContinuationGraphCompatibility,
  type WireValue,
} from '../runtime/continuation.js';
import {
  EXECUTABLE_WORKFLOW_METADATA_EXPORT,
  EXECUTABLE_WORKFLOW_MODULE_FORMAT,
  type ExecutableWorkflowModuleMetadata,
} from '../runtime/executable-module-contract.js';
import { GENERATOR_ABI } from '../runtime/continuation.js';

export {
  EXECUTABLE_WORKFLOW_METADATA_EXPORT,
  EXECUTABLE_WORKFLOW_MODULE_FORMAT,
  type ExecutableWorkflowModuleMetadata,
} from '../runtime/executable-module-contract.js';

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
    const metadata = await createExecutableWorkflowMetadata(
      filePath,
      request.workflowName,
      request.externalNodeTypes,
    );
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
): Promise<ExecutableWorkflowModuleMetadata> {
  const parsed = await parseWorkflow(filePath, {
    workflowName,
    projectDir: dirname(filePath),
    ...(externalNodeTypes === undefined ? {} : { externalNodeTypes: [...externalNodeTypes] }),
  });
  if (parsed.errors.length > 0) {
    throw new Error(`Cannot emit executable artifact metadata: ${parsed.errors.join('; ')}`);
  }
  const workflowsByName = new Map(
    parsed.allWorkflows.map((workflow) => [workflow.functionName, workflow]),
  );
  const durableAnalysis = validateDurableClosure(parsed.ast, parsed.allWorkflows, { enforce: false });
  validateDurableClosure(parsed.ast, parsed.allWorkflows);
  const reachableClosure = [...durableAnalysis.reachable]
    .sort((left, right) => left.functionName.localeCompare(right.functionName));
  const graphManifest = JSON.parse(JSON.stringify(reachableClosure.map((workflow) => ({
    functionName: workflow.functionName,
    instances: workflow.instances,
    connections: workflow.connections,
    scopes: workflow.scopes,
    startPorts: workflow.startPorts,
    exitPorts: workflow.exitPorts,
    nodeTypes: workflow.nodeTypes.map((nodeType) => ({
      name: nodeType.name,
      functionName: nodeType.functionName,
      inputs: nodeType.inputs,
      outputs: nodeType.outputs,
      expression: nodeType.expression,
      scope: nodeType.scope,
      durableGate: nodeType.durableGate,
      durableEffect: nodeType.durableEffect,
      durablePure: nodeType.durablePure,
    })),
  })))) as WireValue;
  const graphFingerprint = createHash('sha256')
    .update(canonicalWireValue(graphManifest))
    .digest('hex');
  const continuationGraph: ContinuationGraphCompatibility = {
    nodes: reachableClosure.flatMap((workflow) => {
      const executionOrder = getTopologicalOrder(workflow, { includeScopedChildren: true });
      const branchPaths = durableBranchPaths(workflow);
      return [
        {
          workflowId: workflow.functionName,
          nodeId: 'Start',
          nodeType: 'Start',
          executionOrder: -1,
          inputPorts: [],
          outputPorts: Object.keys(workflow.startPorts),
          scopeNames: [],
          invokedWorkflows: [],
          branchArms: [],
          branchPath: [],
          predecessors: [],
        },
        ...workflow.instances.map((instance) => {
          const nodeType = workflow.nodeTypes.find(
            (candidate) => candidate.name === instance.nodeType || candidate.functionName === instance.nodeType,
          );
          const instanceOrder = executionOrder.indexOf(instance.id);
          const instanceBranchPath = branchPaths.get(instance.id) ?? [];
          const invokedWorkflows = instance.nodeType === 'invokeWorkflow'
            ? reachableClosure.map((candidate) => candidate.functionName)
            : workflowsByName.has(instance.nodeType) ? [instance.nodeType] : [];
          return {
            workflowId: workflow.functionName,
            nodeId: instance.id,
            nodeType: nodeType?.functionName ?? instance.nodeType,
            executionOrder: instanceOrder,
            inputPorts: Object.keys(nodeType?.inputs ?? {}),
            outputPorts: Object.keys(nodeType?.outputs ?? {}),
            scopeNames: [
              ...(nodeType?.scope === undefined ? [] : [nodeType.scope]),
              ...(nodeType?.scopes ?? []),
              ...Object.values(nodeType?.inputs ?? {}).map((port) => port.scope)
                .filter((scope): scope is string => scope !== undefined),
              ...Object.values(nodeType?.outputs ?? {}).map((port) => port.scope)
                .filter((scope): scope is string => scope !== undefined),
            ].filter((scope, index, scopes) => scopes.indexOf(scope) === index),
            invokedWorkflows,
            ...(instance.parent !== undefined && instance.parent !== null && {
              parentScope: { parentNodeId: instance.parent.id, scopeName: instance.parent.scope },
            }),
            branchArms: [
              ...(Object.hasOwn(nodeType?.outputs ?? {}, 'onSuccess') ? ['success'] : []),
              ...(Object.hasOwn(nodeType?.outputs ?? {}, 'onFailure') ? ['failure'] : []),
            ],
            branchPath: instanceBranchPath,
            predecessors: [
              { nodeId: 'Start', branchPath: [] },
              ...executionOrder.slice(0, instanceOrder).map((nodeId) => ({
                nodeId,
                branchPath: branchPaths.get(nodeId) ?? [],
              })).filter((predecessor) => predecessor.branchPath.every((requirement) =>
                instanceBranchPath.some((active) =>
                  active.nodeId === requirement.nodeId && active.arm === requirement.arm))),
            ],
            ...(nodeType?.durableGate !== undefined && { durableGate: nodeType.durableGate }),
            ...(nodeType?.durableEffect === true && { durableEffect: true as const }),
          };
        }),
      ];
    }),
  };
  return Object.freeze({
    formatVersion: EXECUTABLE_WORKFLOW_MODULE_FORMAT,
    generatorAbi: GENERATOR_ABI,
    workflowName,
    workflowNames: parsed.allWorkflows.map((workflow) => workflow.functionName).sort(),
    graphFingerprint,
    continuationGraph,
    capabilities: {
      gate: durableAnalysis.hasDurableGate,
      effect: durableAnalysis.hasDurableEffect,
    },
  });
}
