import type { DurableGate } from '../runtime/continuation.js';
import type { TNodeTypeAST, TWorkflowAST } from '../ast/types.js';

/**
 * A gate's inputs keyed by port name, plus what a resolver needs to know to
 * build the node's output envelope later.
 */
export interface LabeledGate {
  /** Declared inputs by name. An omitted optional input is `null`. */
  inputs: Record<string, unknown>;
  /** Input names that arrived as `{ absent: true }`. */
  absent: string[];
  /** Data output port names, in declared order. Control ports excluded. */
  outputs: string[];
  hasSuccessPort: boolean;
  hasFailurePort: boolean;
}

type PositionalArgument = { value: unknown } | { absent: true };

/**
 * Turn the engine's positional gate payload into named inputs.
 *
 * The generator emits `{ arguments: [ {value}|{absent}, ... ] }` in declared
 * input order, skipping `execute` and any trailing runtime arguments
 * (buildDurableGatePayload in `src/generator/node-invocation.ts`). An
 * assistant reading `{"arguments":[{"value":"review"},...]}` would have to
 * open the workflow to learn which position is which. The names come from
 * the parsed node type instead, so the tool result is self-describing.
 *
 * Names are taken in `@input` tag order. If an author declared tags in a
 * different order from the function parameters, labels would be wrong. The
 * positional payload is the source of truth and a length mismatch is
 * refused rather than zipped. The built-in gate nodes are covered by tests.
 */
export function labelGate(gate: DurableGate, ast: TWorkflowAST): LabeledGate {
  const instance = ast.instances.find((candidate) => candidate.id === gate.address.nodeId);
  if (!instance) {
    throw new Error(`gate node not found in workflow: ${gate.address.nodeId}`);
  }

  // `instance.type` is the AST discriminator ('NodeInstance'). The node-type
  // name is `instance.nodeType`.
  const nodeType = findNodeType(ast.nodeTypes, instance.nodeType, gate.address.nodeType);
  if (!nodeType) {
    throw new Error(
      `node type not found for gate ${gate.address.nodeId}: ${instance.nodeType} / ${gate.address.nodeType}`,
    );
  }

  // The parsed port maps include the control ports (`execute` on the way in,
  // `onSuccess`/`onFailure` on the way out) alongside data ports. The gate
  // payload carries data inputs only, and a resolver fills the control
  // outputs itself, so both are dropped here.
  const names = dataPorts(nodeType.inputs);
  const args = readArguments(gate.payload);
  if (args.length !== names.length) {
    throw new Error(
      `gate payload has ${args.length} arguments but node type ${nodeType.name} declares ${names.length} inputs`,
    );
  }

  const inputs: Record<string, unknown> = {};
  const absent: string[] = [];
  names.forEach((name, index) => {
    const argument = args[index];
    if ('absent' in argument) {
      inputs[name] = null;
      absent.push(name);
    } else {
      inputs[name] = argument.value;
    }
  });

  return {
    inputs,
    absent,
    outputs: dataPorts(nodeType.outputs),
    hasSuccessPort: nodeType.hasSuccessPort,
    hasFailurePort: nodeType.hasFailurePort,
  };
}

const CONTROL_PORT_NAMES = new Set(['execute', 'onSuccess', 'onFailure']);

function dataPorts(ports: TNodeTypeAST['inputs'] | TNodeTypeAST['outputs']): string[] {
  return Object.keys(ports).filter(
    (name) => !CONTROL_PORT_NAMES.has(name) && !ports[name].isControlFlow,
  );
}

function findNodeType(
  nodeTypes: readonly TNodeTypeAST[],
  instanceTypeName: string,
  functionName: string,
): TNodeTypeAST | undefined {
  return (
    nodeTypes.find((candidate) => candidate.name === instanceTypeName) ??
    nodeTypes.find((candidate) => candidate.functionName === functionName)
  );
}

function readArguments(payload: unknown): PositionalArgument[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as { arguments?: unknown }).arguments)
  ) {
    throw new Error('gate payload is not a positional argument list');
  }
  return (payload as { arguments: PositionalArgument[] }).arguments;
}
