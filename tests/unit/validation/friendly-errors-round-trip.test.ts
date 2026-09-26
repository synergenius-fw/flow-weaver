/**
 * Friendly errors read the validator's own sentences back to pull out the
 * node, port and type names. These tests feed them the messages the
 * validator really writes, not hand-written ones, so a change to either side
 * that breaks the extraction fails here instead of showing an author
 * 'unknown' or the wrong port.
 */
import { describe, it, expect } from 'vitest';
import { getFriendlyError, formatFriendlyDiagnostics } from '../../../src/validation/friendly-errors';
import { WorkflowValidator } from '../../../src/validation/validator';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TConnectionAST, TPortDefinition, TDataType, TValidationError } from '../../../src/ast/types';

const STEP: TPortDefinition = { dataType: 'STEP', isControlFlow: true };
const TYPES: TDataType[] = ['STRING', 'NUMBER', 'BOOLEAN', 'OBJECT', 'ARRAY', 'STEP'];

/** Every data type as an output `outX` and an input `inX`, all optional. */
const ALL: TNodeTypeAST = {
  type: 'NodeType',
  name: 'all',
  functionName: 'all',
  inputs: { execute: STEP, ...Object.fromEntries(TYPES.map((t) => [`in${t}`, { dataType: t, optional: true }])) },
  outputs: { onSuccess: STEP, onFailure: { ...STEP, failure: true }, ...Object.fromEntries(TYPES.map((t) => [`out${t}`, { dataType: t }])) },
  hasSuccessPort: true,
  hasFailurePort: true,
  executeWhen: 'CONJUNCTION',
  isAsync: false,
};

const conn = (from: string, to: string): TConnectionAST => {
  const [fn, fp] = from.split('.');
  const [tn, tp] = to.split('.');
  return { type: 'Connection', from: { node: fn, port: fp }, to: { node: tn, port: tp } };
};

function diagnose(connections: string[], extra: Partial<TWorkflowAST> = {}, instances?: TNodeInstanceAST[], types: TNodeTypeAST[] = [ALL]) {
  const workflow: TWorkflowAST = {
    type: 'Workflow', name: 'wf', functionName: 'wf', sourceFile: 'wf.ts',
    nodeTypes: types,
    instances: instances ?? [{ type: 'NodeInstance', id: 'a', nodeType: 'all' }, { type: 'NodeInstance', id: 'b', nodeType: 'all' }],
    connections: connections.map((c) => conn(...(c.split(' -> ') as [string, string]))),
    scopes: {}, startPorts: {}, exitPorts: {}, imports: [],
    ...extra,
  };
  const r = new WorkflowValidator().validate(workflow);
  return [...r.errors, ...r.warnings];
}

function friendlyFor(diags: TValidationError[], code: string) {
  const d = diags.find((x) => x.code === code);
  expect(d, `${code} in ${diags.map((x) => x.code).join(', ')}`).toBeDefined();
  const f = getFriendlyError(d!);
  expect(f).not.toBeNull();
  return f!;
}

describe('connection diagnostics, as the validator writes them', () => {
  it('names both ends of a STEP port mismatch, whichever way round', () => {
    const toData = friendlyFor(diagnose(['a.onSuccess -> b.inNUMBER']), 'STEP_PORT_TYPE_MISMATCH');
    expect(toData.title).toBe('Wrong Port Type');
    expect(toData.explanation).toBe("'a.onSuccess' is a STEP port: it carries a control signal, but 'b.inNUMBER' is a data port. Connect 'a.onSuccess' to a STEP input such as 'b.execute'.");
    const toStep = friendlyFor(diagnose(['a.outNUMBER -> b.execute']), 'STEP_PORT_TYPE_MISMATCH');
    expect(toStep.title).toBe('Wrong Port Type');
    expect(toStep.explanation).toBe("'b.execute' is a STEP port: it expects a control signal, but 'a.outNUMBER' carries data. Connect 'b.execute' to a STEP output such as 'a.onSuccess'.");
  });

  it('names the node and port of an unknown output, with the suggestion', () => {
    const f = friendlyFor(diagnose(['a.outNUMBR -> b.inNUMBER']), 'UNKNOWN_SOURCE_PORT');
    expect(f.explanation).toBe("Port 'outNUMBR' doesn't exist on node 'a'. Did you mean 'outNUMBER'? Check the spelling or add the port to the node type.");
    expect(f.fix).toBe("Add @output outNUMBR to the node type's JSDoc, or check the port name in the @connect annotation.");
    const start = friendlyFor(diagnose(['Start.count -> b.inNUMBER']), 'UNKNOWN_SOURCE_PORT');
    expect(start.explanation).toBe("Port 'count' doesn't exist on node 'Start'. Check the spelling or add the port to the node type.");
    expect(start.fix).toBe("Add '@param count' to the workflow JSDoc and to its params object, or fix the port name in the @connect annotation.");
  });

  it('names the node and port of an unknown input, with the suggestion', () => {
    const f = friendlyFor(diagnose(['a.outNUMBER -> b.inNUMBR']), 'UNKNOWN_TARGET_PORT');
    expect(f.explanation).toBe("Port 'inNUMBR' doesn't exist on node 'b'. Did you mean 'inNUMBER'? Check the spelling or add the port to the node type.");
    expect(f.fix).toBe("Add @input inNUMBR to the node type's JSDoc, or check the port name in the @connect annotation.");
    const exit = friendlyFor(diagnose(['a.outNUMBER -> Exit.total']), 'UNKNOWN_TARGET_PORT');
    expect(exit.explanation).toBe("Port 'total' doesn't exist on node 'Exit'. Check the spelling or add the port to the node type.");
    expect(exit.fix).toBe("Add '@returns total' to the workflow JSDoc and to its return type, or fix the port name in the @connect annotation.");
  });

  it('suggests the exact coercion for a lossy connection or a mismatch', () => {
    const lossy = friendlyFor(diagnose(['a.outSTRING -> b.inNUMBER']), 'LOSSY_TYPE_COERCION');
    expect(lossy.explanation).toBe('Converting STRING to NUMBER may lose data or produce unexpected results (e.g., NaN, truncation).');
    expect(lossy.fix).toBe('Use `@connect a.outSTRING -> b.inNUMBER as number` for explicit coercion, or use @strictTypes to enforce type safety.');
    const mismatch = friendlyFor(diagnose(['a.outOBJECT -> b.inNUMBER']), 'TYPE_MISMATCH');
    expect(mismatch.explanation).toBe("Type mismatch: you're connecting a OBJECT to a NUMBER. The value will be automatically converted, but this might cause unexpected behavior.");
    expect(mismatch.fix).toBe('Use `@connect a.outOBJECT -> b.inNUMBER as number` for explicit coercion, change one of the port types, or use @strictTypes to turn this into an error.');
  });

  it('keeps the generic advice when no coercion produces the target type', () => {
    const f = friendlyFor(diagnose(['a.outNUMBER -> b.inARRAY']), 'TYPE_MISMATCH');
    expect(f.fix).toBe('Add `as <type>` to the @connect annotation (e.g. `as string`), change one of the port types, or use @strictTypes to turn this into an error.');
  });

  it('names the port of an Exit control port with the wrong type', () => {
    const diags = diagnose(['a.onSuccess -> Exit.onSuccess'], { exitPorts: { onSuccess: { dataType: 'STRING' }, onFailure: { dataType: 'NUMBER' } } });
    const [success, failure] = diags.filter((d) => d.code === 'INVALID_EXIT_PORT_TYPE').map((d) => getFriendlyError(d)!);
    expect(success.explanation).toMatch(/^Exit port 'onSuccess' must be STEP type/);
    expect(failure.explanation).toMatch(/^Exit port 'onFailure' must be STEP type/);
    expect(failure.fix).toBe("Connect a STEP-type output (like onSuccess or onFailure) to Exit.onFailure. Don't connect data ports to control flow ports.");
  });
});

describe('scope and node diagnostics, as the validator writes them', () => {
  it('names both ends and their scopes for a connection across scopes', () => {
    const loop: TNodeTypeAST = { ...ALL, name: 'loop', functionName: 'loop', outputs: { ...ALL.outputs, item: { dataType: 'NUMBER', scope: 'iter' } } };
    const diags = diagnose(['a.outNUMBER -> c.inNUMBER', 'c.outNUMBER -> b.inNUMBER'], {}, [
      { type: 'NodeInstance', id: 'L', nodeType: 'loop' },
      { type: 'NodeInstance', id: 'c', nodeType: 'all', parent: { id: 'L', scope: 'iter' } },
      { type: 'NodeInstance', id: 'a', nodeType: 'all' },
      { type: 'NodeInstance', id: 'b', nodeType: 'all' },
    ], [ALL, loop]);
    const f = friendlyFor(diags, 'CROSS_SCOPE_CONNECTION');
    expect(f.explanation).toBe("Connection 'a.outNUMBER' → 'c.inNUMBER' links a node in root to a node in L.iter. Nodes in different scopes cannot connect directly. Data crosses a scope boundary only through the scope owner's scoped ports.");
    expect(f.fix).toBe("Route the value through the scope owner: connect 'a.outNUMBER' to one of the owner's scoped output ports, and read it inside the scope from there. Or move both nodes into the same scope.");
  });

  it('names the stub node and its type', () => {
    const stub: TNodeTypeAST = { ...ALL, name: 'later', functionName: 'later', variant: 'STUB' };
    const f = friendlyFor(diagnose([], {}, [{ type: 'NodeInstance', id: 's', nodeType: 'later' }], [stub]), 'STUB_NODE');
    expect(f.explanation).toBe("Node 's' uses node type 'later', which has no implementation yet. The workflow cannot run until it is implemented.");
    expect(f.fix).toBe("Implement 'later' as a @flowWeaver nodeType function, or validate with draft mode (fw_validate draft: true) to check structure while it is still a stub.");
  });

  it('keeps the parser\'s reason for an expression that does not parse, and nothing before it', () => {
    const diags = diagnose([], {}, [{ type: 'NodeInstance', id: 'n', nodeType: 'all', config: { portConfigs: [{ portName: 'inNUMBER', expression: '24h' }] } }]);
    const raw = diags.find((d) => d.code === 'EXPRESSION_SYNTAX')!;
    const f = getFriendlyError(raw)!;
    const reason = raw.message.slice(raw.message.indexOf('24h. ') + '24h. '.length);
    expect(f.explanation).toBe(`The expression for 'inNUMBER' on 'n' does not parse as JavaScript. 24h. ${reason}`);
  });
});

describe('durable closure errors', () => {
  const fixFor = (message: string) => getFriendlyError({ code: 'DURABLE_CLOSURE_INVALID', message })!;

  it('answers the rule the message names', () => {
    expect(fixFor('Scope "loop" needs a visible attempt limit').fix).toMatch(/^A loop inside a durable workflow is allowed once it is bounded/);
    expect(fixFor('Nodes a, b do not support pull or lazy execution').fix).toMatch(/^Remove pullExecution from the named nodes/);
    expect(fixFor('Durable classification errors: x').fix).toMatch(/^Give every reachable node exactly one of @durablePure/);
    expect(fixFor('Node "e" breaks the effect contract').fix).toMatch(/^A @durableEffect node takes an operationKey parameter/);
  });

  it('falls back to the branch-region advice, and keeps the message as the explanation', () => {
    const f = fixFor('Gate "g" reads around a branch');
    expect(f).toEqual({
      title: 'Invalid Durable Closure',
      explanation: 'Gate "g" reads around a branch',
      fix: 'Keep each gate/effect in one branch region reading only from its immediate predecessor. Thread shared values through the chain rather than wiring them around a gate. See the durable-gates topic.',
      code: 'DURABLE_CLOSURE_INVALID',
    });
  });
});

describe('suppress lists', () => {
  it('shows a comma-joined list split into separate codes', () => {
    const f = getFriendlyError({
      code: 'SUPPRESS_UNKNOWN_CODE',
      node: 'n',
      message: "Node 'n' suppresses 'UNUSED_NODE, UNUSED_OUTPUT_PORT', which cannot be a validation code, so it suppresses nothing.",
    })!;
    expect(f.explanation).toBe("Node 'n' lists 'UNUSED_NODE, UNUSED_OUTPUT_PORT' in [suppress: ...], but that cannot be a validation code, so nothing is suppressed. Codes are separate string literals, not one comma-joined string.");
    expect(f.fix).toBe('Write each code as its own string: [suppress: "UNUSED_NODE", "UNUSED_OUTPUT_PORT"].');
  });

  it('shows the placeholder for a single bad code', () => {
    const f = getFriendlyError({ code: 'SUPPRESS_UNKNOWN_CODE', node: 'n', message: "Node 'n' suppresses 'lower', which cannot be a validation code, so it suppresses nothing." })!;
    expect(f.fix).toBe('Write each code as its own string: [suppress: "<CODE>"].');
    const bare = getFriendlyError({ code: 'SUPPRESS_UNKNOWN_CODE', message: 'something else' })!;
    expect(bare.explanation).toMatch(/^Node 'unknown' lists 'unknown' in/);
  });
});

describe('formatting a list of diagnostics', () => {
  it('is empty for no diagnostics', () => {
    expect(formatFriendlyDiagnostics([])).toBe('');
  });

  it('gives each mapped code its title, explanation, fix and code, and each unmapped one its message', () => {
    const text = formatFriendlyDiagnostics([
      { type: 'error', code: 'MISSING_WORKFLOW_NAME', message: 'Workflow must have a name' },
      { type: 'warning', code: 'SOMETHING_NEW', message: 'A message nobody maps' },
    ]);
    expect(text).toBe([
      '[ERROR] Missing Workflow Name',
      '  The workflow annotation is missing or has no name. Every workflow needs a name in the @flowWeaver workflow block.',
      '  How to fix: Add @flowWeaver workflow to the JSDoc block above your exported workflow function.',
      '  Code: MISSING_WORKFLOW_NAME',
      '',
      '[WARNING] SOMETHING_NEW',
      '  A message nobody maps',
      '',
    ].join('\n'));
  });
});
