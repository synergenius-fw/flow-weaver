/**
 * The identity of a compiled workflow graph, and the graph a continuation is
 * checked against.
 *
 * Three places need the same answer. The executor fingerprints the graph
 * before a gated run and hands the continuation graph to `decodeContinuation`.
 * The artifact compiler writes both into a deployable module's metadata. The
 * code generator bakes the fingerprint into a gated body so the compiled file
 * can name its own graph when it yields. One computation here keeps them equal.
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

const connectionKey = (c: TWorkflowAST['connections'][number]) => `${c.from.node}.${c.from.port}\0${c.to.node}.${c.to.port}`;

/** A port as the graph knows it: its name and role, not its label or its type's spelling. */
function portShape(ports: TWorkflowAST['nodeTypes'][number]['inputs']): Record<string, { optional?: true; control?: true; failure?: true }> {
  const shape: Record<string, { optional?: true; control?: true; failure?: true }> = {};
  for (const name of Object.keys(ports).sort()) {
    const port = ports[name];
    shape[name] = {
      ...(port.optional ? { optional: true as const } : {}),
      ...(port.isControlFlow || port.dataType === 'STEP' ? { control: true as const } : {}),
      ...(port.failure ? { failure: true as const } : {}),
    };
  }
  return shape;
}

/**
 * Compute the graph identity of `root` within `allWorkflows`.
 *
 * What goes into the fingerprint is what replaying a continuation depends
 * on: the instances and their configuration, the connections, the scopes,
 * the Start and Exit ports, and each node type's ports by name and role
 * with its durable classification. What stays out is anything that reads
 * the same graph differently: source locations (a temp copy parses to the
 * same identity as the file), port labels (a doc comment is not a graph
 * change) and type spellings (a built-in injected from the registry and
 * the same built-in inlined by a compile lose their TypeScript types on
 * re-parse; the graph is the same graph). A changed node body is the
 * bundle digest's to catch.
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
        // Declaration order is how the file happens to be written; a
        // regenerated JSDoc lists the same connections in another order.
        instances: [...workflow.instances]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(({ sourceLocation: _sourceLocation, ...instance }) => instance),
        connections: [...workflow.connections]
          .sort((left, right) => connectionKey(left).localeCompare(connectionKey(right)))
          .map(({ sourceLocation: _sourceLocation, ...connection }) => connection),
        scopes: workflow.scopes,
        startPorts: portShape(workflow.startPorts),
        exitPorts: portShape(workflow.exitPorts),
        nodeTypes: [...workflow.nodeTypes]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((nodeType) => ({
            name: nodeType.name,
            functionName: nodeType.functionName,
            inputs: portShape(nodeType.inputs),
            outputs: portShape(nodeType.outputs),
            expression: nodeType.expression === true,
            scope: nodeType.scope,
            durableGate: nodeType.durableGate,
            durableEffect: nodeType.durableEffect === true,
            durablePure: nodeType.durablePure === true,
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
