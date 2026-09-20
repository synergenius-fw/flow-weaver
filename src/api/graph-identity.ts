/**
 * The identity of a compiled workflow graph, and the graph a continuation is
 * checked against.
 *
 * Three places need the same answer: the executor, which fingerprints the
 * graph before a gated run and hands the continuation graph to
 * `decodeContinuation`; the artifact compiler, which writes both into a
 * deployable module's metadata; and the code generator, which bakes the
 * fingerprint into a gated body so the compiled file can name its own graph
 * when it yields. One computation here keeps them equal.
 */
import type { TWorkflowAST } from '../ast/types.js';
import { durableBranchPaths, validateDurableClosure } from './durable-validation.js';
import { getTopologicalOrder } from './query.js';
import { canonicalWireValue, sha256Hex, type WireValue } from '../runtime/continuation-core.js';
import type { ContinuationGraphCompatibility } from '../runtime/continuation.js';

export interface GraphIdentity {
  /** The workflows the root can reach, in name order. */
  readonly reachable: readonly TWorkflowAST[];
  readonly capabilities: { readonly gate: boolean; readonly effect: boolean };
  /** SHA-256 over the canonical form of the reachable closure's graph manifest. */
  readonly graphFingerprint: string;
  readonly continuationGraph: ContinuationGraphCompatibility;
}

/**
 * Compute the graph identity of `root` within `allWorkflows`. Source
 * locations are diagnostics, not graph identity, so they are left out:
 * identical source parsed from a temp copy yields the same fingerprint.
 */
export function graphIdentity(root: TWorkflowAST, allWorkflows: readonly TWorkflowAST[] = []): GraphIdentity {
  const analysis = validateDurableClosure(root, allWorkflows, { enforce: false });
  const reachable = [...analysis.reachable].sort((left, right) =>
    left.functionName.localeCompare(right.functionName),
  );
  const workflowsByName = new Map(
    [...allWorkflows, root].map((workflow) => [workflow.functionName, workflow]),
  );
  const manifest = JSON.parse(
    JSON.stringify(
      reachable.map((workflow) => ({
        functionName: workflow.functionName,
        instances: workflow.instances.map(({ sourceLocation: _sourceLocation, ...instance }) => instance),
        connections: workflow.connections.map(({ sourceLocation: _sourceLocation, ...connection }) => connection),
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
      })),
    ),
  ) as WireValue;
  const graphFingerprint = sha256Hex(canonicalWireValue(manifest));

  const continuationGraph: ContinuationGraphCompatibility = {
    nodes: reachable.flatMap((workflow) => {
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
          const invokedWorkflows =
            instance.nodeType === 'invokeWorkflow'
              ? reachable.map((candidate) => candidate.functionName)
              : workflowsByName.has(instance.nodeType)
                ? [instance.nodeType]
                : [];
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
              ...Object.values(nodeType?.inputs ?? {})
                .map((port) => port.scope)
                .filter((scope): scope is string => scope !== undefined),
              ...Object.values(nodeType?.outputs ?? {})
                .map((port) => port.scope)
                .filter((scope): scope is string => scope !== undefined),
            ].filter((scope, index, scopes) => scopes.indexOf(scope) === index),
            invokedWorkflows,
            ...(instance.parent !== undefined &&
              instance.parent !== null && {
                parentScope: { parentNodeId: instance.parent.id, scopeName: instance.parent.scope },
              }),
            branchArms: [
              ...(Object.hasOwn(nodeType?.outputs ?? {}, 'onSuccess') ? ['success'] : []),
              ...(Object.hasOwn(nodeType?.outputs ?? {}, 'onFailure') ? ['failure'] : []),
            ],
            branchPath: instanceBranchPath,
            predecessors: [
              { nodeId: 'Start', branchPath: [] },
              ...executionOrder
                .slice(0, instanceOrder)
                .map((nodeId) => ({ nodeId, branchPath: branchPaths.get(nodeId) ?? [] }))
                .filter((predecessor) =>
                  predecessor.branchPath.every((requirement) =>
                    instanceBranchPath.some(
                      (active) => active.nodeId === requirement.nodeId && active.arm === requirement.arm,
                    ),
                  ),
                ),
            ],
            ...(nodeType?.durableGate !== undefined && { durableGate: nodeType.durableGate }),
            ...(nodeType?.durableEffect === true && { durableEffect: true as const }),
          };
        }),
      ];
    }),
  };

  return {
    reachable,
    capabilities: { gate: analysis.hasDurableGate, effect: analysis.hasDurableEffect },
    graphFingerprint,
    continuationGraph,
  };
}
