/**
 * What the validator says, word for word. Each diagnostic an author reads is
 * checked here with its severity and full message, including the "Did you
 * mean" hint when a close name exists and its absence when none does, and
 * the documentation link attached to it. Then the post-processing steps of
 * validate(): dropping errors that only echo an unknown node type, demoting
 * stub errors in draft mode, and per-instance warning suppression.
 */
import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../../src/validation/validator';
import { VALID_NODE_COLORS } from '../../../src/constants';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TConnectionAST, TValidationError } from '../../../src/ast/types';

const DOCS = 'https://github.com/synergenius-fw/flow-weaver/blob/main/docs/reference';

function nodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: 'proc',
    functionName: 'proc',
    inputs: { execute: { dataType: 'STEP', isControlFlow: true } },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
    ...overrides,
  };
}

/** A node type with one required NUMBER input, `value`. */
const needsValue = (overrides: Partial<TNodeTypeAST> = {}) =>
  nodeType({
    name: 'needs',
    functionName: 'needs',
    inputs: { execute: { dataType: 'STEP', isControlFlow: true }, value: { dataType: 'NUMBER' } },
    ...overrides,
  });

const instance = (id: string, type: string, config?: TNodeInstanceAST['config']): TNodeInstanceAST => ({ type: 'NodeInstance', id, nodeType: type, config });

const conn = (fromNode: string, fromPort: string, toNode: string, toPort: string): TConnectionAST => ({
  type: 'Connection',
  from: { node: fromNode, port: fromPort },
  to: { node: toNode, port: toPort },
});

/** Instances wired Start -> each -> Exit, so none is unused. */
function workflow(nodeTypes: TNodeTypeAST[], instances: TNodeInstanceAST[], extra: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'wf',
    functionName: 'wf',
    sourceFile: 'wf.ts',
    nodeTypes,
    instances,
    connections: instances.flatMap((i) => [conn('Start', 'execute', i.id, 'execute'), conn(i.id, 'onSuccess', 'Exit', 'onSuccess')]),
    scopes: {},
    startPorts: {},
    exitPorts: {},
    imports: [],
    ...extra,
  };
}

const validate = (wf: TWorkflowAST, options?: Parameters<WorkflowValidator['validate']>[1]) => new WorkflowValidator().validate(wf, options);
const only = (diags: TValidationError[], code: string) => {
  const found = diags.filter((d) => d.code === code);
  expect(found, `${code} in ${JSON.stringify(diags.map((d) => d.code))}`).toHaveLength(1);
  return found[0];
};

describe('unknown node types', () => {
  it('suggests the closest type name, with a link to node registration', () => {
    const r = validate(workflow([nodeType()], [instance('a', 'porc')]));
    expect(only(r.errors, 'UNKNOWN_NODE_TYPE')).toMatchObject({
      type: 'error',
      message: 'Node "a" references unknown node type "porc". Did you mean "proc"?',
      node: 'a',
      docUrl: `${DOCS}/concepts.md#node-registration`,
    });
  });

  it('gives no hint when nothing is close', () => {
    const r = validate(workflow([nodeType()], [instance('a', 'somethingElseEntirely')]));
    expect(only(r.errors, 'UNKNOWN_NODE_TYPE').message).toBe('Node "a" references unknown node type "somethingElseEntirely".');
  });

  it('says how to annotate a function that exists without an annotation', () => {
    const r = validate(workflow([nodeType()], [instance('a', 'helper')], { availableFunctionNames: ['helper'] }));
    expect(only(r.errors, 'UNKNOWN_NODE_TYPE').message).toBe(
      'Node "a" references unknown node type "helper". Function "helper" exists but has no @flowWeaver nodeType annotation. Add /** @flowWeaver nodeType */ above it.',
    );
  });

  it('resolves an instance by the type\'s function name when its name differs (npm nodes)', () => {
    const npm = needsValue({ name: 'npm/pkg/needs', functionName: 'needs' });
    const byFunction = validate(workflow([npm], [instance('a', 'needs')]));
    expect(byFunction.errors.map((e) => e.code)).toEqual(['MISSING_REQUIRED_INPUT']);
    const byName = validate(workflow([npm], [instance('a', 'npm/pkg/needs')]));
    expect(byName.errors.map((e) => e.code)).toEqual(['MISSING_REQUIRED_INPUT']);
  });
});

describe('errors that only echo an unknown node type', () => {
  const wf = () => {
    const w = workflow([needsValue()], [instance('ghost', 'nope'), instance('ghost', 'nope'), instance('real', 'needs')]);
    w.connections = [
      conn('Start', 'execute', 'ghost', 'execute'), // target type unknown: dropped
      conn('ghost', 'onSuccess', 'real', 'execute'), // source type unknown: dropped
      conn('real', 'onSuccess', 'missing', 'execute'), // no such instance at all: kept
      conn('real', 'onSuccess', 'Exit', 'onSuccess'),
    ];
    return w;
  };

  it('drops the unknown-node errors about the instance and keeps the root cause', () => {
    const codes = validate(wf()).errors.map((e) => `${e.code}:${e.node ?? e.connection?.to.node}`);
    expect(codes).not.toContain('UNKNOWN_TARGET_NODE:ghost');
    expect(codes.filter((c) => c.startsWith('UNKNOWN_SOURCE_NODE'))).toEqual([]);
    expect(codes.filter((c) => c.startsWith('UNKNOWN_NODE_TYPE'))).toEqual(['UNKNOWN_NODE_TYPE:ghost', 'UNKNOWN_NODE_TYPE:ghost']);
  });

  it('keeps the errors about other nodes, and the other kinds of error about the unknown one', () => {
    const errors = validate(wf()).errors;
    expect(only(errors, 'UNKNOWN_TARGET_NODE').message).toBe('Connection references unknown target node: "missing"');
    expect(only(errors, 'MISSING_REQUIRED_INPUT').node).toBe('real');
    expect(only(errors, 'DUPLICATE_INSTANCE_ID')).toMatchObject({
      type: 'error',
      node: 'ghost',
      message: 'Duplicate instance ID "ghost" in workflow. Each @node must have a unique ID.',
    });
  });

  it('drops a missing required input on an instance of a type not in the workflow', () => {
    // An npm-style instance naming a type by a name that is not in the map.
    const w = workflow([needsValue()], [instance('x', 'unknown/needs')]);
    expect(validate(w).errors.map((e) => e.code)).toEqual(['UNKNOWN_NODE_TYPE']);
  });
});

describe('stub nodes', () => {
  const stub = () => needsValue({ name: 'npm/stubbed', functionName: 'stubbed', variant: 'STUB' });

  it('are errors unless the mode is draft', () => {
    for (const options of [undefined, { mode: 'strict' as const }]) {
      const r = validate(workflow([stub()], [instance('s', 'stubbed')]), options);
      expect(only(r.errors, 'STUB_NODE')).toMatchObject({
        type: 'error',
        message: 'Node "s" uses stub type "stubbed" which has no implementation. Use draft mode to validate structure, or implement the node.',
        docUrl: `${DOCS}/scaffold.md`,
      });
      expect(r.valid).toBe(false);
    }
  });

  it('become warnings in draft mode, with their missing inputs, found by the type\'s name too', () => {
    for (const ref of ['stubbed', 'npm/stubbed']) {
      const r = validate(workflow([stub(), needsValue()], [instance('s', ref), instance('real', 'needs')]), { mode: 'draft' });
      expect(r.errors.map((e) => `${e.type}:${e.code}:${e.node}`)).toEqual(['error:MISSING_REQUIRED_INPUT:real']);
      expect(r.warnings.filter((w) => w.node === 's').map((w) => `${w.type}:${w.code}`).sort()).toEqual([
        'warning:MISSING_REQUIRED_INPUT',
        'warning:STUB_NODE',
      ]);
    }
  });
});

describe('inferred node types', () => {
  it('are a warning that points at explicit annotation', () => {
    const r = validate(workflow([nodeType({ inferred: true })], [instance('p', 'proc')]));
    expect(only(r.warnings, 'INFERRED_NODE_TYPE')).toMatchObject({
      type: 'warning',
      message: 'Node type "proc" was auto-inferred from function signature (expression mode). Add @flowWeaver nodeType for explicit port control.',
      docUrl: `${DOCS}/node-conversion.md`,
    });
  });
});

describe('warning suppression', () => {
  it('drops only the named code, only on the instance that names it', () => {
    const w = workflow([nodeType({ inferred: true, declarationKind: 'let' })], [
      instance('quiet', 'proc', { suppressWarnings: ['INFERRED_NODE_TYPE'] }),
      instance('loud', 'proc'),
    ]);
    const r = validate(w);
    expect(r.warnings.filter((x) => x.code === 'INFERRED_NODE_TYPE').map((x) => x.node)).toEqual(['loud']);
    // A warning about the node type, not an instance, is kept.
    expect(only(r.warnings, 'MUTABLE_NODE_TYPE_BINDING')).toMatchObject({
      type: 'warning',
      node: 'proc',
      message: 'Node type "proc" is declared with "let" instead of "const". Use "const" to prevent accidental reassignment.',
    });
  });

  it('keeps warnings that name no node at all', () => {
    const w = workflow([nodeType()], [instance('p', 'proc', { suppressWarnings: ['NO_START_CONNECTIONS'] })], { connections: [] });
    const r = validate(w);
    expect(only(r.warnings, 'NO_START_CONNECTIONS')).toEqual({ type: 'warning', code: 'NO_START_CONNECTIONS', message: 'Workflow has no connections from Start node' });
    expect(only(r.warnings, 'NO_EXIT_CONNECTIONS')).toEqual({ type: 'warning', code: 'NO_EXIT_CONNECTIONS', message: 'Workflow has no connections to Exit node (no return value)' });
    expect(only(r.warnings, 'UNUSED_NODE')).toMatchObject({ type: 'warning', message: 'Node "p" is defined but never used in workflow' });
  });
});

describe('documentation links', () => {
  it('are attached only to the codes that have a page, and leave other diagnostics without one', () => {
    const w = workflow([nodeType()], [instance('p', 'proc')]);
    w.connections.push(conn('Start', 'execute', 'p', 'execute'));
    const r = validate(w);
    expect(only(r.errors, 'DUPLICATE_CONNECTION')).toMatchObject({
      type: 'error',
      message: 'Duplicate connection: Start.execute->p.execute',
      docUrl: `${DOCS}/error-codes.md`,
    });
    const unused = validate(workflow([nodeType()], [instance('p', 'proc')], { connections: [] }));
    expect('docUrl' in only(unused.warnings, 'UNUSED_NODE')).toBe(false);
  });
});

describe('workflow and node type structure', () => {
  it('names the missing workflow name and function name', () => {
    const r = validate(workflow([nodeType()], [instance('p', 'proc')], { name: '', functionName: '' }));
    expect(only(r.errors, 'MISSING_WORKFLOW_NAME')).toEqual({ type: 'error', code: 'MISSING_WORKFLOW_NAME', message: 'Workflow must have a name' });
    expect(only(r.errors, 'MISSING_FUNCTION_NAME')).toEqual({ type: 'error', code: 'MISSING_FUNCTION_NAME', message: 'Workflow must have a functionName' });
  });

  it('names a duplicated node type and a reserved type or instance name', () => {
    const r = validate(workflow([nodeType(), nodeType(), nodeType({ name: 'Start', functionName: 'Start' })], [instance('Exit', 'proc')]));
    expect(only(r.errors, 'DUPLICATE_NODE_NAME')).toMatchObject({ type: 'error', node: 'proc', message: 'Duplicate node type name: "proc"' });
    expect(only(r.errors, 'RESERVED_NODE_NAME')).toMatchObject({ type: 'error', message: 'Node type name "Start" is reserved. Reserved node names: Start, Exit' });
    expect(only(r.errors, 'RESERVED_INSTANCE_ID')).toMatchObject({ type: 'error', message: 'Instance ID "Exit" is reserved. Reserved names: Start, Exit' });
  });

  it('says an Exit control port must be STEP', () => {
    const r = validate(workflow([nodeType()], [instance('p', 'proc')], {
      exitPorts: { onSuccess: { dataType: 'STRING' }, onFailure: { dataType: 'NUMBER' } },
    }));
    expect(r.errors.filter((e) => e.code === 'INVALID_EXIT_PORT_TYPE')).toEqual([
      { type: 'error', code: 'INVALID_EXIT_PORT_TYPE', message: "Exit port 'onSuccess' must be of type STEP (control flow), found: STRING" },
      { type: 'error', code: 'INVALID_EXIT_PORT_TYPE', message: "Exit port 'onFailure' must be of type STEP (control flow), found: NUMBER" },
    ]);
  });

  it('is checked by validateNodeType on its own, which finds nothing wrong in a sound type', () => {
    const v = new WorkflowValidator();
    expect(v.validateNodeType(nodeType())).toEqual([]);
    const bad = nodeType({ outputs: { ...nodeType().outputs, item: { dataType: 'ANY', scope: 'my-scope' } } });
    expect(v.validateNodeType(bad)).toEqual([
      'Port "item" on node type "proc" has invalid scope name "my-scope". Scope names must be valid JavaScript identifiers (letters, numbers, underscore, dollar sign, and cannot start with a number).',
    ]);
  });
});

describe('required inputs and instance port configs', () => {
  const withConfigs = (portConfigs: NonNullable<TNodeInstanceAST['config']>['portConfigs']) =>
    validate(workflow([needsValue()], [instance('n', 'needs', { portConfigs })]));

  it('names the unconnected input and how to make it optional', () => {
    expect(only(withConfigs(undefined).errors, 'MISSING_REQUIRED_INPUT')).toMatchObject({
      type: 'error',
      node: 'n',
      message: 'Node "n" has unconnected required input port "value". Connect a value to it, or mark it optional with @input [value].',
    });
  });

  it('is satisfied by an expression on the input, whether or not its direction is given', () => {
    expect(withConfigs([{ portName: 'value', expression: '1' }]).errors).toEqual([]);
    expect(withConfigs([{ portName: 'value', direction: 'INPUT', expression: '1' }]).errors).toEqual([]);
  });

  it('is not satisfied by an expression on an output of that name, or on another port', () => {
    expect(withConfigs([{ portName: 'value', direction: 'OUTPUT', expression: '1' }]).errors.map((e) => e.code)).toEqual(['MISSING_REQUIRED_INPUT']);
    expect(withConfigs([{ portName: 'onSuccess', expression: '1' }]).errors.map((e) => e.code)).toEqual(['MISSING_REQUIRED_INPUT']);
  });

  it('warns about a port config for a port the type does not have, with a hint when one is close', () => {
    const r = validate(workflow([needsValue()], [instance('n', 'needs', { portConfigs: [
      { portName: 'valeu', label: 'x' },
      { portName: 'zzzzzzzzzz', label: 'y' },
      { portName: 'value', expression: '1' },
    ] })]));
    expect(r.warnings.filter((w) => w.code === 'INVALID_PORT_CONFIG_REF').map((w) => [w.type, w.message])).toEqual([
      ['warning', 'Instance "n" references port "valeu" in portConfig, but this port does not exist on node type "needs". Did you mean "value"?'],
      ['warning', 'Instance "n" references port "zzzzzzzzzz" in portConfig, but this port does not exist on node type "needs".'],
    ]);
  });
});

describe('annotations against the function signature', () => {
  const typed = (functionText: string, inputs: TNodeTypeAST['inputs']) =>
    validate(workflow([nodeType({ functionText, inputs: { execute: { dataType: 'STEP', isControlFlow: true }, ...inputs } })], [instance('p', 'proc', {
      portConfigs: Object.keys(inputs).map((portName) => ({ portName, expression: '1' })),
    })]));

  it('warns when the annotation requires an input the signature makes optional', () => {
    const r = typed('function proc(execute: boolean, a?: number) { return {}; }', { a: { dataType: 'NUMBER' } });
    expect(only(r.warnings, 'ANNOTATION_SIGNATURE_MISMATCH')).toMatchObject({
      type: 'warning',
      node: 'proc',
      message: 'Port "a" in node type "proc" is optional in signature but required in annotation. Consider using @input [a] to mark it optional.',
    });
  });

  it('never compares the first parameter, the execute flag, whatever its name', () => {
    const r = typed('function proc(go?: boolean, a: number) { return {}; }', { go: { dataType: 'BOOLEAN' }, a: { dataType: 'NUMBER' } });
    expect(r.warnings.filter((w) => w.code.startsWith('ANNOTATION_SIGNATURE'))).toEqual([]);
  });

  it('warns about a differing type, but not against an untyped (any) parameter', () => {
    const r = typed('function proc(execute: boolean, a: string, b: any) { return {}; }', {
      a: { dataType: 'NUMBER', tsType: 'number' },
      b: { dataType: 'NUMBER', tsType: 'number' },
    });
    expect(r.warnings.filter((w) => w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH').map((w) => [w.type, w.message])).toEqual([
      ['warning', 'Port "a" in node type "proc" has type "number" in annotation but "string" in function signature.'],
    ]);
  });
});

describe('visual annotations', () => {
  const colors = VALID_NODE_COLORS.join(', ');

  it('warns about a node type color or icon, suggesting the closest valid one', () => {
    const r = validate(workflow([nodeType({ visuals: { color: 'gren', icon: 'zzzzzzzzzzzzzz' } })], [instance('p', 'proc')]));
    expect(only(r.warnings, 'INVALID_COLOR')).toMatchObject({
      type: 'warning',
      node: 'proc',
      message: `Node type "proc" has invalid color "gren". Did you mean "green"? Valid colors: ${colors}.`,
    });
    expect(only(r.warnings, 'INVALID_ICON')).toMatchObject({
      type: 'warning',
      message: 'Node type "proc" has invalid icon "zzzzzzzzzzzzzz". Icons are Material Symbols names, as flag or swap_horiz (swapHoriz works too).',
    });
  });

  it('warns about an instance color or icon the same way', () => {
    const r = validate(workflow([nodeType()], [instance('p', 'proc', { color: 'magentaish', icon: 'flagg' })]));
    expect(only(r.warnings, 'INVALID_COLOR')).toMatchObject({
      type: 'warning',
      node: 'p',
      message: `Instance "p" has invalid color "magentaish". Valid colors: ${colors}.`,
    });
    expect(only(r.warnings, 'INVALID_ICON')).toMatchObject({ type: 'warning', node: 'p' });
    expect(only(r.warnings, 'INVALID_ICON').message).toMatch(/^Instance "p" has invalid icon "flagg"\. Did you mean "[a-z_]+"\? Icons are Material Symbols names/);
  });

  it('accepts any Material Symbol, in snake or camel case', () => {
    const r = validate(workflow([nodeType({ visuals: { icon: 'swap_horiz' } })], [instance('p', 'proc', { icon: 'swapHoriz', color: 'teal' })]));
    expect(r.warnings.filter((w) => w.code === 'INVALID_ICON' || w.code === 'INVALID_COLOR')).toEqual([]);
  });

  it('names an invalid port type and an invalid @executeWhen', () => {
    const r = validate(workflow([nodeType({
      executeWhen: 'CONJUNCTON' as TNodeTypeAST['executeWhen'],
      inputs: { execute: { dataType: 'STEP', isControlFlow: true }, a: { dataType: 'NUMBR' as 'NUMBER', optional: true } },
      outputs: { ...nodeType().outputs, b: { dataType: 'TEXT' as 'STRING' } },
    })], [instance('p', 'proc')]));
    expect(r.warnings.filter((w) => w.code === 'INVALID_PORT_TYPE').map((w) => [w.type, w.message])).toEqual([
      ['warning', 'Port "a" on node type "proc" has invalid type "NUMBR".'],
      ['warning', 'Port "b" on node type "proc" has invalid type "TEXT".'],
    ]);
    expect(only(r.warnings, 'INVALID_EXECUTE_WHEN')).toMatchObject({
      type: 'warning',
      message: 'Node type "proc" has invalid @executeWhen value "CONJUNCTON". Did you mean "CONJUNCTION"? Valid values: CONJUNCTION, DISJUNCTION, CUSTOM.',
    });
    const far = validate(workflow([nodeType({ executeWhen: 'WHENEVER_IT_LIKES' as TNodeTypeAST['executeWhen'] })], [instance('p', 'proc')]));
    expect(only(far.warnings, 'INVALID_EXECUTE_WHEN').message).toBe(
      'Node type "proc" has invalid @executeWhen value "WHENEVER_IT_LIKES". Valid values: CONJUNCTION, DISJUNCTION, CUSTOM.',
    );
  });
});

describe('expression syntax', () => {
  const exprOn = (expression: string) => validate(workflow([needsValue()], [instance('n', 'needs', { portConfigs: [{ portName: 'value', expression }] })]));
  const hintFor = (text: string) => ` If you meant the text ${JSON.stringify(text)}, quote it inside the attribute: ="'${text}'".`;

  it('refuses an expression that does not parse, and suggests quoting what looks like text', () => {
    for (const [expression, text] of [['24h', '24h'], ['  24h  ', '24h'], ['5 minutes', '5 minutes']]) {
      const e = only(exprOn(expression).errors, 'EXPRESSION_SYNTAX');
      expect(e.type).toBe('error');
      expect(e.node).toBe('n');
      expect(e.message.startsWith(`The [expr:] binding for "value" on "n" is not a JavaScript expression: ${expression}. `)).toBe(true);
      expect(e.message.endsWith(`.${hintFor(text)}`)).toBe(true);
    }
  });

  it('gives no quoting hint for what looks like code, or a reserved word used as a name', () => {
    for (const expression of ['foo(', '(24h', '24h)', 'class', 'if.then', '$x y']) {
      const e = only(exprOn(expression).errors, 'EXPRESSION_SYNTAX');
      expect(e.message, expression).not.toContain('If you meant the text');
    }
  });

  it('accepts a valid expression, and treats an empty one as no expression', () => {
    for (const expression of ['1 + 2', "'24h'", 'a.b.c', '', '   ']) {
      expect(exprOn(expression).errors.filter((e) => e.code === 'EXPRESSION_SYNTAX'), JSON.stringify(expression)).toEqual([]);
    }
  });

  it('checks the Expression: default of a node type input too', () => {
    const r = validate(workflow([needsValue({ inputs: { execute: { dataType: 'STEP', isControlFlow: true }, value: { dataType: 'NUMBER', expression: '24h' } } })], [instance('n', 'needs')]));
    const e = only(r.errors, 'EXPRESSION_SYNTAX');
    expect(e.type).toBe('error');
    expect(e.message.startsWith('The Expression: default of input "value" on node type "needs" is not a JavaScript expression: 24h. ')).toBe(true);
  });
});
