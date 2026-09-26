/**
 * The scope topology rule on its own: each check it makes around a node with
 * scoped ports, with the exact diagnostic, and the neighbouring cases that
 * must stay silent. A loop node `L` runs its child `c1` once per item: `start`
 * and `item` flow into the scope, `success` and `result` flow back out.
 */
import { describe, it, expect } from 'vitest';
import { validateScopeTopology } from '../../../src/validation/rules/scope-topology';
import type { ValidationContext } from '../../../src/validation/rules/context';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TConnectionAST, TPortDefinition } from '../../../src/ast/types';

const STEP: TPortDefinition = { dataType: 'STEP', isControlFlow: true };

function nodeType(name: string, inputs: Record<string, TPortDefinition>, outputs: Record<string, TPortDefinition>): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { execute: STEP, ...inputs },
    outputs: { onSuccess: STEP, onFailure: { ...STEP, failure: true }, ...outputs },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
  };
}

const LOOP = nodeType(
  'loop',
  { items: { dataType: 'ARRAY' }, success: { ...STEP, scope: 'iter' }, result: { dataType: 'STRING', scope: 'iter' } },
  { start: { ...STEP, scope: 'iter' }, item: { dataType: 'NUMBER', scope: 'iter' }, done: { dataType: 'NUMBER' } },
);
const WORK = nodeType('work', { value: { dataType: 'NUMBER' } }, { out: { dataType: 'STRING' }, count: { dataType: 'NUMBER' }, any: { dataType: 'ANY' } });
/** A child with nothing required. */
const FREE = nodeType('free', { value: { dataType: 'NUMBER', optional: true } }, { count: { dataType: 'NUMBER' } });
/** A grouping node: children, but no scoped ports. */
const GROUP = nodeType('group', {}, {});
/** Two scopes, `a` on its outputs and `b` on its inputs. */
const TWO = nodeType('two', { back: { ...STEP, scope: 'b' } }, { go: { ...STEP, scope: 'a' } });

const inst = (id: string, type: string, parent?: { id: string; scope: string }, config?: TNodeInstanceAST['config']): TNodeInstanceAST => ({
  type: 'NodeInstance', id, nodeType: type, ...(parent ? { parent } : {}), ...(config ? { config } : {}),
});

/** `L.port:iter`, `c1.port`, ... A trailing `:scope` qualifies that end. */
function conn(from: string, to: string): TConnectionAST {
  const end = (s: string) => {
    const [nodePort, scope] = s.split(':');
    const [node, port] = nodePort.split('.');
    return scope ? { node, port, scope } : { node, port };
  };
  return { type: 'Connection', from: end(from), to: end(to) };
}

/** The loop and its one child, wired both ways. */
const WIRED = [
  'L.start:iter -> c1.execute',
  'L.item:iter -> c1.value',
  'c1.onSuccess -> L.success:iter',
  'c1.out -> L.result:iter',
];

function check(opts: { instances?: TNodeInstanceAST[]; connections?: string[]; scopes?: Record<string, string[]>; types?: TNodeTypeAST[] } = {}) {
  const types = opts.types ?? [LOOP, WORK, FREE, GROUP, TWO];
  const instances = opts.instances ?? [inst('L', 'loop'), inst('c1', 'work', { id: 'L', scope: 'iter' })];
  const workflow: TWorkflowAST = {
    type: 'Workflow', name: 'wf', functionName: 'wf', sourceFile: 'wf.ts',
    nodeTypes: types,
    instances,
    connections: (opts.connections ?? WIRED).map((c) => conn(...(c.split(' -> ') as [string, string]))),
    scopes: opts.scopes ?? {},
    startPorts: {}, exitPorts: {}, imports: [],
  };
  const byName = new Map(types.map((t) => [t.functionName, t]));
  const instanceMap = new Map(instances.flatMap((i) => (byName.has(i.nodeType) ? [[i.id, byName.get(i.nodeType)!] as const] : [])));
  const ctx: ValidationContext = { errors: [], warnings: [], strictMode: false, draftMode: false };
  validateScopeTopology(ctx, workflow, instanceMap);
  const show = (d: ValidationContext['errors'][number]) => `${d.type} ${d.code}: ${d.message}`;
  return { errors: ctx.errors.map(show), warnings: ctx.warnings.map(show), raw: ctx };
}

it('finds nothing wrong with a loop wired both ways', () => {
  expect(check()).toMatchObject({ errors: [], warnings: [] });
});

describe('scope membership', () => {
  it('refuses an instance listed under two scopes', () => {
    const r = check({ scopes: { 'L.iter': ['c1'], 'M.iter': ['c1', 'c1'] } });
    expect(r.errors).toEqual([
      'error SCOPE_INCONSISTENT: Instance "c1" appears in multiple scopes: "L.iter" and "M.iter". A node can only belong to one scope.',
    ]);
    expect(r.raw.errors[0].node).toBe('c1');
  });

  it('accepts an instance listed twice under the same scope', () => {
    expect(check({ scopes: { 'L.iter': ['c1', 'c1'] } }).errors).toEqual([]);
  });
});

describe('scope qualifiers', () => {
  it('refuses a qualifier naming a scope the node does not define, at either end', () => {
    const r = check({ connections: [...WIRED, 'L.start:nope -> c1.execute', 'c1.out -> L.result:nope'] });
    expect(r.errors).toEqual([
      'error SCOPE_WRONG_SCOPE_NAME: Connection from "L.start" uses scope qualifier ":nope" but node "L" does not define scope "nope". Available scopes: iter.',
      'error SCOPE_WRONG_SCOPE_NAME: Connection to "L.result" uses scope qualifier ":nope" but node "L" does not define scope "nope". Available scopes: iter.',
    ]);
  });

  it('lists every scope the node defines, outputs first', () => {
    const r = check({
      instances: [inst('T', 'two'), inst('a1', 'free', { id: 'T', scope: 'a' }), inst('b1', 'free', { id: 'T', scope: 'b' })],
      connections: ['T.go:a -> a1.execute', 'b1.onSuccess -> T.back:b', 'T.go:c -> a1.execute'],
    });
    expect(r.errors).toEqual([
      'error SCOPE_WRONG_SCOPE_NAME: Connection from "T.go" uses scope qualifier ":c" but node "T" does not define scope "c". Available scopes: a, b.',
    ]);
  });

  it('leaves a qualifier on another node\'s end to that node', () => {
    const r = check({ connections: [...WIRED, 'c1.count:elsewhere -> c1.value'] });
    expect(r.errors.filter((e) => e.includes('SCOPE_WRONG_SCOPE_NAME'))).toEqual([]);
  });
});

describe('a scope with no children', () => {
  it('is a warning, and nothing else is checked for it', () => {
    const r = check({ instances: [inst('L', 'loop')], connections: [] });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['warning SCOPE_EMPTY: Scope "iter" on node "L" has no child nodes.']);
    expect(r.raw.warnings[0].node).toBe('L');
  });
});

describe('parent ports named by scoped connections', () => {
  it('refuses a port the parent does not have, listing the scoped ones of that side', () => {
    const r = check({ connections: [...WIRED, 'L.ghost:iter -> c1.value', 'c1.count -> L.ghost:iter'] });
    expect(r.errors).toEqual([
      'error SCOPE_UNKNOWN_PORT: Scoped connection references non-existent output port "ghost" on "L" in scope "iter". Available scoped outputs: start, item.',
      'error SCOPE_UNKNOWN_PORT: Scoped connection references non-existent input port "ghost" on "L" in scope "iter". Available scoped inputs: success, result.',
    ]);
  });

  it('says none when the side has no scoped ports', () => {
    const r = check({
      instances: [inst('T', 'two'), inst('a1', 'free', { id: 'T', scope: 'a' }), inst('b1', 'free', { id: 'T', scope: 'b' })],
      connections: ['T.go:a -> a1.execute', 'b1.onSuccess -> T.back:b', 'a1.onSuccess -> T.missing:a', 'T.missing:b -> b1.execute'],
    });
    expect(r.errors).toEqual([
      'error SCOPE_UNKNOWN_PORT: Scoped connection references non-existent input port "missing" on "T" in scope "a". Available scoped inputs: none.',
      'error SCOPE_UNKNOWN_PORT: Scoped connection references non-existent output port "missing" on "T" in scope "b". Available scoped outputs: none.',
    ]);
  });

  it('refuses an unscoped port, or one of another scope, used as this scope\'s', () => {
    const r = check({ connections: [...WIRED, 'L.done:iter -> c1.value', 'c1.count -> L.items:iter'] });
    expect(r.errors).toEqual([
      'error SCOPE_UNKNOWN_PORT: Output port "done" on "L" is not a scoped port of scope "iter" (it is an unscoped port).',
      'error SCOPE_UNKNOWN_PORT: Input port "items" on "L" is not a scoped port of scope "iter" (it is an unscoped port).',
    ]);
    const other = check({
      instances: [inst('T', 'two'), inst('a1', 'free', { id: 'T', scope: 'a' }), inst('b1', 'free', { id: 'T', scope: 'b' })],
      connections: ['T.go:a -> a1.execute', 'b1.onSuccess -> T.back:b', 'a1.onSuccess -> T.back:a', 'T.go:b -> b1.execute'],
    });
    expect(other.errors).toEqual([
      'error SCOPE_UNKNOWN_PORT: Input port "back" on "T" is not a scoped port of scope "a" (it belongs to scope "b").',
      'error SCOPE_UNKNOWN_PORT: Output port "go" on "T" is not a scoped port of scope "b" (it belongs to scope "a").',
    ]);
  });
});

describe('the scope boundary', () => {
  const withRoot = (extra: string[]) => check({
    instances: [inst('L', 'loop'), inst('c1', 'work', { id: 'L', scope: 'iter' }), inst('c2', 'work', { id: 'L', scope: 'iter' }), inst('R', 'work')],
    connections: [...WIRED, 'L.start:iter -> c2.execute', 'c2.onSuccess -> L.success:iter', ...extra],
  });

  it('refuses a scoped connection from a child to a node outside the scope, and into a child from outside', () => {
    const r = withRoot(['c1.count:iter -> R.value', 'R.count -> c1.value:iter']);
    expect(r.errors.filter((e) => e.includes('SCOPE_CONNECTION_OUTSIDE'))).toEqual([
      'error SCOPE_CONNECTION_OUTSIDE: Scoped connection from "c1.count" targets "R" which is not inside scope "iter" of "L".',
      'error SCOPE_CONNECTION_OUTSIDE: Scoped connection to "c1.value" sources from "R" which is not inside scope "iter" of "L".',
    ]);
  });

  it('allows scoped connections between siblings', () => {
    expect(withRoot(['c1.count:iter -> c2.value:iter']).errors).toEqual([]);
  });
});

describe('types across the scope boundary', () => {
  it('warns when parent and child data ports disagree, both ways, naming the TS types', () => {
    const typedLoop: TNodeTypeAST = { ...LOOP, outputs: { ...LOOP.outputs, item: { dataType: 'NUMBER', scope: 'iter', tsType: 'number' } } };
    const r = check({
      types: [typedLoop, WORK],
      connections: ['L.start:iter -> c1.execute', 'L.item:iter -> c1.value', 'L.item:iter -> c1.execute', 'c1.onSuccess -> L.success:iter', 'c1.count -> L.result:iter'],
    });
    expect(r.warnings).toEqual([
      'warning SCOPE_PORT_TYPE_MISMATCH: Type mismatch in scope "iter": "c1.count" outputs NUMBER but "L.result" expects STRING.',
    ]);
    const intoChild = check({
      types: [{ ...typedLoop, outputs: { ...typedLoop.outputs, item: { dataType: 'BOOLEAN', scope: 'iter', tsType: 'boolean' } } }, WORK],
    });
    expect(intoChild.warnings).toEqual([
      'warning SCOPE_PORT_TYPE_MISMATCH: Type mismatch in scope "iter": "L.item" outputs boolean (BOOLEAN) but "c1.value" expects NUMBER.',
    ]);
  });

  it('does not warn about ANY, STEP, or matching types', () => {
    const r = check({ connections: ['L.start:iter -> c1.execute', 'L.item:iter -> c1.value', 'c1.onSuccess -> L.success:iter', 'c1.any -> L.result:iter', 'c1.onSuccess -> L.result:iter'] });
    expect(r.warnings).toEqual([]);
  });
});

describe('required inputs of children', () => {
  const child = (inputs: Record<string, TPortDefinition>, config?: TNodeInstanceAST['config'], extra: string[] = []) =>
    check({
      types: [LOOP, nodeType('kid', inputs, { out: { dataType: 'STRING' } })],
      instances: [inst('L', 'loop'), inst('k', 'kid', { id: 'L', scope: 'iter' }, config)],
      connections: ['L.start:iter -> k.execute', 'k.onSuccess -> L.success:iter', 'k.out -> L.result:iter', ...extra],
    });

  it('refuses an unconnected required input, naming the scope', () => {
    const r = child({ need: { dataType: 'NUMBER' } });
    expect(r.errors).toEqual(['error SCOPE_MISSING_REQUIRED_INPUT: Scoped child "k" has unconnected required input "need" within scope "iter" of "L".']);
    expect(r.raw.errors[0].node).toBe('k');
  });

  it('accepts one that is optional, defaulted, has an expression, or is connected from anywhere', () => {
    expect(child({ need: { dataType: 'NUMBER', optional: true } }).errors).toEqual([]);
    expect(child({ need: { dataType: 'NUMBER', default: 1 } }).errors).toEqual([]);
    expect(child({ need: { dataType: 'NUMBER', expression: '1' } }).errors).toEqual([]);
    expect(child({ need: { dataType: 'NUMBER' } }, { portConfigs: [{ portName: 'need', expression: '1' }] }).errors).toEqual([]);
    expect(child({ need: { dataType: 'NUMBER' } }, { portConfigs: [{ portName: 'need', direction: 'INPUT', expression: '1' }] }).errors).toEqual([]);
    expect(child({ need: { dataType: 'NUMBER' } }, undefined, ['L.item:iter -> k.need']).errors).toEqual([]);
    expect(child({ need: { dataType: 'NUMBER', scope: 'inner' } }).errors).toEqual([]);
  });

  it('is not satisfied by an expression on an output, or on another port', () => {
    const msg = 'error SCOPE_MISSING_REQUIRED_INPUT: Scoped child "k" has unconnected required input "need" within scope "iter" of "L".';
    expect(child({ need: { dataType: 'NUMBER' } }, { portConfigs: [{ portName: 'need', direction: 'OUTPUT', expression: '1' }] }).errors).toEqual([msg]);
    expect(child({ need: { dataType: 'NUMBER' } }, { portConfigs: [{ portName: 'other', expression: '1' }] }).errors).toEqual([msg]);
    expect(child({ need: { dataType: 'NUMBER' } }, undefined, ['L.item:iter -> k.execute']).errors).toEqual([msg]);
  });
});

describe('what the scope returns, and children cut off from it', () => {
  it('warns about a scoped input nothing inside returns into, even when a plain connection reaches it', () => {
    const r = check({
      instances: [inst('L', 'loop'), inst('c1', 'work', { id: 'L', scope: 'iter' }), inst('R', 'work')],
      connections: ['L.start:iter -> c1.execute', 'L.item:iter -> c1.value', 'c1.onSuccess -> L.success:iter', 'R.out -> L.result', 'c1.count -> L.success:iter'],
    });
    expect(r.warnings).toEqual([
      'warning SCOPE_UNUSED_INPUT: Scoped input port "result" of "L" (scope "iter") has no connection from inner nodes. Data will not flow back from the scope.',
    ]);
    expect(r.raw.warnings[0].node).toBe('L');
  });

  it('warns about a child with no scoped connection to or from the parent', () => {
    const r = check({
      instances: [inst('L', 'loop'), inst('c1', 'work', { id: 'L', scope: 'iter' }), inst('c2', 'work', { id: 'L', scope: 'iter' }), inst('c3', 'work', { id: 'L', scope: 'iter' })],
      connections: [...WIRED, 'c1.onSuccess -> c2.execute', 'c1.count -> c2.value', 'c3.onSuccess -> L.success:iter', 'L.item:iter -> c3.value'],
    });
    expect(r.warnings).toEqual([
      'warning SCOPE_ORPHANED_CHILD: Child node "c2" is declared inside scope "iter" of "L" but has no scoped connections to or from the parent. It is disconnected from the scope\'s data flow.',
    ]);
    expect(r.raw.warnings[0].node).toBe('c2');
  });
});

describe('plain connections across a scope boundary', () => {
  const layout = (connections: string[]) => check({
    instances: [
      inst('L', 'loop'), inst('c1', 'work', { id: 'L', scope: 'iter' }), inst('c2', 'work', { id: 'L', scope: 'iter' }),
      inst('R', 'work'), inst('G', 'group'), inst('g1', 'work', { id: 'G', scope: 'grp' }),
      inst('T', 'two'), inst('a1', 'free', { id: 'T', scope: 'a' }), inst('b1', 'free', { id: 'T', scope: 'b' }),
    ],
    connections: [...WIRED, 'L.start:iter -> c2.execute', 'c2.onSuccess -> L.success:iter', 'T.go:a -> a1.execute', 'b1.onSuccess -> T.back:b', 'T.go:a -> b1.execute', ...connections],
  }).errors.filter((e) => e.includes('CROSS_SCOPE_CONNECTION'));

  it('refuses one from a scoped child to the root, and from the root into a scoped child', () => {
    expect(layout(['c1.count -> R.value', 'R.count -> c2.value'])).toEqual([
      'error CROSS_SCOPE_CONNECTION: Connection from "c1.count" (in L.iter) to "R.value" (in root) crosses scope boundaries. Nodes in different scopes cannot connect directly.',
      'error CROSS_SCOPE_CONNECTION: Connection from "R.count" (in root) to "c2.value" (in L.iter) crosses scope boundaries. Nodes in different scopes cannot connect directly.',
    ]);
  });

  it('refuses one between two scopes of the same parent, or of different parents', () => {
    expect(layout(['a1.count -> b1.value', 'c1.count -> a1.value'])).toEqual([
      'error CROSS_SCOPE_CONNECTION: Connection from "a1.count" (in T.a) to "b1.value" (in T.b) crosses scope boundaries. Nodes in different scopes cannot connect directly.',
      'error CROSS_SCOPE_CONNECTION: Connection from "c1.count" (in L.iter) to "a1.value" (in T.a) crosses scope boundaries. Nodes in different scopes cannot connect directly.',
    ]);
  });

  it('allows siblings, the parent and its child, root nodes, a grouping scope, and unknown nodes', () => {
    expect(layout([
      'c1.count -> c2.value',
      'L.done -> c1.value',
      'c1.count -> L.items',
      'R.count -> R.value',
      'g1.count -> R.value',
      'R.count -> g1.value',
      'c1.count -> nobody.value',
      'nobody.count -> c1.value',
    ])).toEqual([]);
  });
});
