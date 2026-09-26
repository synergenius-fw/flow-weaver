/**
 * The rules that judge each connection on its own: type compatibility with
 * and without `as <type>` coercions, data flow into and out of the workflow,
 * `@http` route parameters, and the connection-level errors. Each rule is
 * called directly with the exact diagnostic it gives, and with the cases on
 * either side of each check that must stay silent.
 */
import { describe, it, expect } from 'vitest';
import { validateTypeCompatibility } from '../../../src/validation/rules/type-compatibility';
import { validateDataFlow } from '../../../src/validation/rules/data-flow';
import { validateConnections, validateMultipleInputConnections } from '../../../src/validation/rules/connections';
import type { ValidationContext } from '../../../src/validation/rules/context';
import type { TWorkflowAST, TNodeTypeAST, TConnectionAST, TPortDefinition, TDataType, TCoerceTargetType } from '../../../src/ast/types';

const STEP: TPortDefinition = { dataType: 'STEP', isControlFlow: true };

/** One node type with an output and an input of every data type: `outX`, `inX`. */
const TYPES: TDataType[] = ['STRING', 'NUMBER', 'BOOLEAN', 'OBJECT', 'ARRAY', 'FUNCTION', 'ANY', 'STEP'];
const ALL: TNodeTypeAST = {
  type: 'NodeType',
  name: 'all',
  functionName: 'all',
  inputs: { execute: STEP, ...Object.fromEntries(TYPES.map((t) => [`in${t}`, { dataType: t }])) },
  outputs: { onSuccess: STEP, onFailure: { ...STEP, failure: true }, ...Object.fromEntries(TYPES.map((t) => [`out${t}`, { dataType: t }])) },
  hasSuccessPort: true,
  hasFailurePort: true,
  executeWhen: 'CONJUNCTION',
  isAsync: false,
};

function withPorts(outputs: Record<string, TPortDefinition>, inputs: Record<string, TPortDefinition>): TNodeTypeAST {
  return { ...ALL, name: 'custom', functionName: 'custom', inputs: { execute: STEP, ...inputs }, outputs: { onSuccess: STEP, ...outputs } };
}

const conn = (from: string, to: string, extra: Partial<TConnectionAST> = {}): TConnectionAST => {
  const [fn, fp] = from.split('.');
  const [tn, tp] = to.split('.');
  return { type: 'Connection', from: { node: fn, port: fp }, to: { node: tn, port: tp }, ...extra };
};

function run(
  rule: (ctx: ValidationContext, wf: TWorkflowAST, map: Map<string, TNodeTypeAST>) => void,
  connections: TConnectionAST[],
  opts: { type?: TNodeTypeAST; strictMode?: boolean; workflow?: Partial<TWorkflowAST>; ids?: string[] } = {},
) {
  const type = opts.type ?? ALL;
  const ids = opts.ids ?? ['a', 'b'];
  const workflow: TWorkflowAST = {
    type: 'Workflow', name: 'wf', functionName: 'wf', sourceFile: 'wf.ts',
    nodeTypes: [type],
    instances: ids.map((id) => ({ type: 'NodeInstance' as const, id, nodeType: type.functionName })),
    connections, scopes: {}, startPorts: {}, exitPorts: {}, imports: [],
    ...opts.workflow,
  };
  const ctx: ValidationContext = { errors: [], warnings: [], strictMode: opts.strictMode ?? false, draftMode: false };
  rule(ctx, workflow, new Map(ids.map((id) => [id, type])));
  const show = (d: ValidationContext['errors'][number]) => `${d.type} ${d.code}: ${d.message}`;
  return [...ctx.errors.map(show), ...ctx.warnings.map(show)];
}

const typeCheck = (from: TDataType, to: TDataType, extra: Partial<TConnectionAST> = {}, opts: Parameters<typeof run>[2] = {}) =>
  run(validateTypeCompatibility, [conn(`a.out${from}`, `b.in${to}`, extra)], opts);

describe('type compatibility', () => {
  it('lets STEP connect only to STEP, whichever end is wrong, and stops there', () => {
    expect(typeCheck('STEP', 'NUMBER')).toEqual([
      'error STEP_PORT_TYPE_MISMATCH: STEP port "outSTEP" on node "a" cannot connect to non-STEP port "inNUMBER" (NUMBER) on node "b"',
    ]);
    expect(typeCheck('STRING', 'STEP')).toEqual([
      'error STEP_PORT_TYPE_MISMATCH: Non-STEP port "outSTRING" (STRING) on node "a" cannot connect to STEP port "inSTEP" on node "b"',
    ]);
    expect(typeCheck('STEP', 'STEP', { coerce: 'string' })).toEqual([]);
  });

  it('refuses a coercion on a FUNCTION port at either end, and nothing else about it', () => {
    expect(typeCheck('FUNCTION', 'NUMBER', { coerce: 'string' })).toEqual([
      'error COERCE_ON_FUNCTION_PORT: Coercion `as string` cannot be used on FUNCTION ports in connection "a.outFUNCTION" → "b.inNUMBER". FUNCTION values cannot be meaningfully coerced.',
    ]);
    expect(typeCheck('NUMBER', 'FUNCTION', { coerce: 'number' })).toHaveLength(1);
    expect(typeCheck('FUNCTION', 'FUNCTION')).toEqual([]);
  });

  it('calls a coercion between equal types redundant, and nothing else', () => {
    expect(typeCheck('NUMBER', 'NUMBER', { coerce: 'string' })).toEqual([
      'warning REDUNDANT_COERCE: Coercion `as string` on connection "a.outNUMBER" → "b.inNUMBER" is redundant because source and target are both NUMBER.',
    ]);
  });

  it('compares the TS types of two OBJECT ports only', () => {
    const shapes = (dataType: TDataType, from: string, to: string) =>
      run(validateTypeCompatibility, [conn('a.o', 'b.i')], { type: withPorts({ o: { dataType, tsType: from } }, { i: { dataType, tsType: to } }) });
    expect(shapes('OBJECT', '{ a: string }', '{ b: number }')).toEqual([
      'warning OBJECT_TYPE_MISMATCH: Structural type mismatch: a.o outputs "{ a: string }" but b.i expects "{ b: number }". Verify the object shapes are compatible.',
    ]);
    expect(shapes('OBJECT', '{ a: string }', '{a:string}')).toEqual([]);
    expect(shapes('STRING', 'Foo', 'Bar')).toEqual([]);
  });

  it('accepts ANY at either end', () => {
    expect(typeCheck('ANY', 'NUMBER')).toEqual([]);
    expect(typeCheck('OBJECT', 'ANY')).toEqual([]);
  });

  it('checks that an explicit coercion produces the target type, and stops there', () => {
    expect(typeCheck('STRING', 'NUMBER', { coerce: 'number' })).toEqual([]);
    expect(typeCheck('STRING', 'NUMBER', { coerce: 'boolean' })).toEqual([
      'warning COERCE_TYPE_MISMATCH: Coercion `as boolean` produces BOOLEAN but target port "inNUMBER" on "b" expects NUMBER. Use `as number` instead.',
    ]);
    expect(typeCheck('NUMBER', 'ARRAY', { coerce: 'json' as TCoerceTargetType })).toEqual([
      'warning COERCE_TYPE_MISMATCH: Coercion `as json` produces STRING but target port "inARRAY" on "b" expects ARRAY. Use `as <type>` instead.',
    ]);
  });

  it('passes the safe implicit coercions silently', () => {
    expect(typeCheck('NUMBER', 'STRING')).toEqual([]);
    expect(typeCheck('BOOLEAN', 'STRING')).toEqual([]);
  });

  it('warns about each lossy implicit coercion, saying what happens', () => {
    const lossy = (from: TDataType, to: TDataType, what: string) =>
      `warning LOSSY_TYPE_COERCION: Lossy type coercion from ${from} to ${to} in connection a.out${from} → b.in${to}. ${what}. Add @strictTypes to your workflow annotation to enforce type safety.`;
    expect(typeCheck('STRING', 'NUMBER')).toEqual([lossy('STRING', 'NUMBER', 'May result in NaN if string is not a valid number')]);
    expect(typeCheck('STRING', 'BOOLEAN')).toEqual([lossy('STRING', 'BOOLEAN', 'Will use JavaScript truthy/falsy conversion')]);
    expect(typeCheck('OBJECT', 'STRING')).toEqual([lossy('OBJECT', 'STRING', 'Will use JSON.stringify()')]);
    expect(typeCheck('ARRAY', 'STRING')).toEqual([lossy('ARRAY', 'STRING', 'Will use JSON.stringify()')]);
  });

  it('warns about each unusual implicit coercion, saying what happens', () => {
    const unusual = (from: TDataType, to: TDataType, what: string) =>
      `warning UNUSUAL_TYPE_COERCION: Unusual type coercion from ${from} to ${to} in connection a.out${from} → b.in${to}. ${what}.`;
    expect(typeCheck('NUMBER', 'BOOLEAN')).toEqual([unusual('NUMBER', 'BOOLEAN', 'Will use JavaScript truthy/falsy conversion (0 = false, non-zero = true)')]);
    expect(typeCheck('BOOLEAN', 'NUMBER')).toEqual([unusual('BOOLEAN', 'NUMBER', 'Will convert false to 0, true to 1')]);
    expect(typeCheck('STRING', 'OBJECT')).toEqual([unusual('STRING', 'OBJECT', 'May fail if string is not valid JSON')]);
    expect(typeCheck('STRING', 'ARRAY')).toEqual([unusual('STRING', 'ARRAY', 'May fail if string is not valid JSON array')]);
  });

  it('calls any other pair a mismatch, naming the TS types when known', () => {
    expect(typeCheck('NUMBER', 'ARRAY')).toEqual([
      'warning TYPE_MISMATCH: Type mismatch in connection a.outNUMBER (NUMBER) → b.inARRAY (ARRAY). Runtime coercion will be attempted.',
    ]);
    const typed = run(validateTypeCompatibility, [conn('a.o', 'b.i')], { type: withPorts({ o: { dataType: 'NUMBER', tsType: 'number' } }, { i: { dataType: 'ARRAY', tsType: 'string[]' } }) });
    expect(typed).toEqual([
      'warning TYPE_MISMATCH: Type mismatch in connection a.o (number (NUMBER)) → b.i (string[] (ARRAY)). Runtime coercion will be attempted.',
    ]);
  });

  it('makes each warning a TYPE_INCOMPATIBLE error under strict types or strict mode', () => {
    for (const opts of [{ strictMode: true }, { workflow: { options: { strictTypes: true } } }]) {
      expect(typeCheck('NUMBER', 'ARRAY', {}, opts)).toEqual([
        'error TYPE_INCOMPATIBLE: Type mismatch in connection a.outNUMBER (NUMBER) → b.inARRAY (ARRAY). Runtime coercion will be attempted.',
      ]);
      expect(typeCheck('STRING', 'NUMBER', {}, opts)[0]).toMatch(/^error TYPE_INCOMPATIBLE: Lossy type coercion/);
      expect(typeCheck('NUMBER', 'BOOLEAN', {}, opts)[0]).toMatch(/^error TYPE_INCOMPATIBLE: Unusual type coercion/);
      expect(typeCheck('STRING', 'NUMBER', { coerce: 'boolean' }, opts)[0]).toMatch(/^error TYPE_INCOMPATIBLE: Coercion `as boolean` produces BOOLEAN/);
    }
  });

  it('skips a connection derived from an expression, and one whose ends do not resolve', () => {
    expect(typeCheck('NUMBER', 'ARRAY', { derived: { kind: 'expression', expression: 'a.outNUMBER * 2' } })).toEqual([]);
    expect(run(validateTypeCompatibility, [conn('a.nope', 'b.inARRAY'), conn('a.outNUMBER', 'ghost.inARRAY'), conn('Start.x', 'b.inARRAY'), conn('a.outNUMBER', 'Exit.x')])).toEqual([]);
  });
});

describe('data flow', () => {
  const flow = (connections: TConnectionAST[], workflow: Partial<TWorkflowAST> = {}, type?: TNodeTypeAST) =>
    run(validateDataFlow, connections, { workflow, type: type ?? withPorts({ out: { dataType: 'NUMBER' }, fail: { dataType: 'STRING', failure: true }, s: { dataType: 'NUMBER', scope: 'x' } }, {}), ids: ['a'] });

  it('warns about a data output nothing reads, but not a control, failure or scoped one', () => {
    expect(flow([])).toEqual(['warning UNUSED_OUTPUT_PORT: Output port "out" of node "a" is never connected. Data will be discarded.']);
    expect(flow([conn('a.out', 'Exit.result')], { exitPorts: { result: { dataType: 'NUMBER' } } })).toEqual([]);
  });

  it('warns about a declared return value nothing produces', () => {
    expect(flow([conn('a.out', 'Exit.result')], { exitPorts: { result: { dataType: 'NUMBER' }, other: { dataType: 'STRING' }, onSuccess: STEP } })).toEqual([
      'warning UNREACHABLE_EXIT_PORT: Exit port "other" has no incoming connection. Return value will be undefined.',
    ]);
  });

  it('warns when several values race for one Exit data port, naming them', () => {
    const two = withPorts({ out: { dataType: 'NUMBER' }, more: { dataType: 'NUMBER' } }, {});
    expect(run(validateDataFlow, [conn('a.out', 'Exit.result'), conn('a.more', 'Exit.result')], { type: two, ids: ['a'], workflow: { exitPorts: { result: { dataType: 'NUMBER' } } } })).toEqual([
      'warning MULTIPLE_EXIT_CONNECTIONS: Exit port "result" has 2 incoming connections (a.out, a.more). Only one value will be used - consider using separate Exit ports.',
    ]);
    // An Exit port the workflow does not declare is still checked.
    expect(run(validateDataFlow, [conn('a.out', 'Exit.extra'), conn('a.more', 'Exit.extra')], { type: two, ids: ['a'] })).toHaveLength(1);
    // Control flow may converge on Exit.
    expect(run(validateDataFlow, [conn('a.out', 'Exit.done'), conn('a.more', 'Exit.done')], { type: two, ids: ['a'], workflow: { exitPorts: { done: { dataType: 'STEP' } } } })).toEqual([]);
    expect(run(validateDataFlow, [conn('a.out', 'Exit.done'), conn('a.more', 'Exit.done')], { type: two, ids: ['a'], workflow: { exitPorts: { done: { dataType: 'NUMBER', isControlFlow: true } } } })).toEqual([]);
  });

  it('refuses an @http route parameter that names no workflow parameter', () => {
    const http = (path: string, startPorts: TWorkflowAST['startPorts']) =>
      flow([conn('a.out', 'Exit.r')], { startPorts, options: { http: [{ method: 'GET', path }] } }).filter((d) => d.includes('HTTP_PARAM_UNKNOWN'));
    expect(http('/items/:id/:bad', { execute: STEP, id: { dataType: 'STRING' }, q: { dataType: 'STRING' } })).toEqual([
      'error HTTP_PARAM_UNKNOWN: @http GET /items/:id/:bad: ":bad" is not a parameter of this workflow (parameters: id, q).',
    ]);
    expect(http('/run/:execute', { execute: STEP })).toEqual([
      'error HTTP_PARAM_UNKNOWN: @http GET /run/:execute: ":execute" is not a parameter of this workflow.',
    ]);
    expect(http('/items/:id', { id: { dataType: 'STRING' } })).toEqual([]);
    expect(http('/items/id:/x', {})).toEqual([]);
  });
});

describe('connection errors', () => {
  it('names unknown nodes and ports as errors', () => {
    const r = run(validateConnections, [conn('ghost.out', 'b.inNUMBER'), conn('Start.nope', 'b.inNUMBER'), conn('a.outNUMBER', 'Exit.nope')], { workflow: { exitPorts: {} } });
    expect(r).toEqual([
      'error UNKNOWN_SOURCE_NODE: Connection references unknown source node: "ghost"',
      'error UNKNOWN_SOURCE_PORT: Start node does not have output port "nope".\nAdd \'@param nope\' to the workflow JSDoc and include it in the params object:\n(execute: boolean, params: { nope: type, ... })',
      'error UNKNOWN_TARGET_PORT: Exit node does not have input port "nope"',
    ]);
  });

  it('refuses several values into one data input, naming every source', () => {
    const r = run(validateMultipleInputConnections, [conn('a.outNUMBER', 'b.inNUMBER'), conn('Start.n', 'b.inNUMBER'), conn('a.outSTRING', 'b.inNUMBER')], { workflow: { startPorts: { n: { dataType: 'NUMBER' } } } });
    expect(r).toEqual([
      'error MULTIPLE_CONNECTIONS_TO_INPUT: Input port "inNUMBER" on node "b" has 3 connections (a.outNUMBER, Start.n, a.outSTRING). Only one value can be received.',
    ]);
  });
});
