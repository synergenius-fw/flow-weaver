/**
 * The small pieces the validation rules lean on: the string type checker,
 * the shared helpers (branch exclusivity, type normalisation, lookups), and
 * the loop detector's report, each called directly.
 */
import { describe, it, expect } from 'vitest';
import { checkTypeCompatibilityFromStrings, isRuntimeCoercible, isOpaqueObjectType } from '../../../src/validation/type-checker';
import {
  areMutuallyExclusive,
  normalizeTypeString,
  resolveNodeType,
  getInstanceLocation,
  suggestCoerceType,
  COERCE_OUTPUT_TYPE,
} from '../../../src/validation/validator-helpers';
import { validateCycles } from '../../../src/validation/rules/cycles';
import type { ValidationContext } from '../../../src/validation/rules/context';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TConnectionAST, TPortDefinition } from '../../../src/ast/types';

const STEP: TPortDefinition = { dataType: 'STEP', isControlFlow: true };

function nodeType(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType', name, functionName: name,
    inputs: { execute: STEP },
    outputs: { onSuccess: STEP, onFailure: { ...STEP, failure: true } },
    hasSuccessPort: true, hasFailurePort: true, executeWhen: 'CONJUNCTION', isAsync: false,
    ...overrides,
  };
}

const conn = (s: string): TConnectionAST => {
  const [from, to] = s.split(' -> ');
  const [fn, fp] = from.split('.');
  const [tn, tp] = to.split('.');
  return { type: 'Connection', from: { node: fn, port: fp }, to: { node: tn, port: tp } };
};

const wf = (instances: TNodeInstanceAST[], connections: string[], nodeTypes: TNodeTypeAST[] = [nodeType('t')]): TWorkflowAST => ({
  type: 'Workflow', name: 'wf', functionName: 'wf', sourceFile: 'wf.ts',
  nodeTypes, instances, connections: connections.map(conn), scopes: {}, startPorts: {}, exitPorts: {}, imports: [],
});
const inst = (id: string, parent?: string, type = 't'): TNodeInstanceAST => ({
  type: 'NodeInstance', id, nodeType: type, ...(parent ? { parent: { id: parent, scope: 's' } } : {}),
});

describe('the string type checker', () => {
  it('names why two types are compatible, or why not', () => {
    expect(checkTypeCompatibilityFromStrings('string', 'string')).toEqual({ isCompatible: true, reason: 'exact', sourceType: 'string', targetType: 'string' });
    expect(checkTypeCompatibilityFromStrings('any', 'number')).toMatchObject({ isCompatible: true, reason: 'assignable' });
    expect(checkTypeCompatibilityFromStrings('number', 'any')).toMatchObject({ isCompatible: true, reason: 'assignable' });
    expect(checkTypeCompatibilityFromStrings('{ a: string }', 'Record<string, unknown>')).toMatchObject({ isCompatible: true, reason: 'assignable' });
    expect(checkTypeCompatibilityFromStrings('object', '{ a: string }')).toMatchObject({ isCompatible: true, reason: 'assignable' });
    expect(checkTypeCompatibilityFromStrings('{ a: string }', ' unknown ')).toMatchObject({ isCompatible: true, reason: 'assignable' });
    expect(checkTypeCompatibilityFromStrings('number', 'string')).toMatchObject({ isCompatible: true, reason: 'coercible' });
    expect(checkTypeCompatibilityFromStrings('string', 'number')).toEqual({
      isCompatible: false,
      reason: 'incompatible',
      sourceType: 'string',
      targetType: 'number',
      errorMessage: "Type 'string' is not assignable to type 'number'",
    });
  });

  it('knows the safe coercions only in their own direction, in any case', () => {
    expect(isRuntimeCoercible('number', 'STRING')).toBe(true);
    expect(isRuntimeCoercible('Boolean', 'string')).toBe(true);
    expect(isRuntimeCoercible('string', 'number')).toBe(false);
    expect(isRuntimeCoercible('number', 'boolean')).toBe(false);
    expect(isRuntimeCoercible('boolean', 'number')).toBe(false);
  });

  it('treats the shapeless object types alike, whatever their spacing', () => {
    expect(isOpaqueObjectType('Record< string ,  any >')).toBe(true);
    expect(isOpaqueObjectType('{ [key: string]: unknown }')).toBe(true);
    expect(isOpaqueObjectType('{ a: string }')).toBe(false);
  });
});

describe('the shared helpers', () => {
  it('normalise a type for comparison: no spaces, Array<T> as T[], no trailing semicolons, lower case', () => {
    expect(normalizeTypeString('Array< Foo >')).toBe('foo[]');
    expect(normalizeTypeString('{ a: String; }')).toBe('{a:string}');
    expect(normalizeTypeString('Map<A,\n B>')).toBe('map<a,b>');
  });

  it('suggest the coercion for a data type, or a placeholder', () => {
    expect(['STRING', 'NUMBER', 'BOOLEAN', 'OBJECT', 'ARRAY'].map(suggestCoerceType)).toEqual(['string', 'number', 'boolean', 'object', '<type>']);
    expect(COERCE_OUTPUT_TYPE).toEqual({ string: 'STRING', number: 'NUMBER', boolean: 'BOOLEAN', json: 'STRING', object: 'OBJECT' });
  });

  it('resolve a node type by name or function name, and an instance\'s location by id', () => {
    const npm = nodeType('fn', { name: 'npm/pkg/fn' });
    const w = wf([{ ...inst('a', undefined, 'npm/pkg/fn'), sourceLocation: { file: 'x.ts', line: 3, column: 1 } }, inst('b', undefined, 'fn')], [], [npm]);
    expect(resolveNodeType(w, w.instances[0])).toBe(npm);
    expect(resolveNodeType(w, w.instances[1])).toBe(npm);
    expect(resolveNodeType(w, inst('c', undefined, 'other'))).toBeUndefined();
    expect(getInstanceLocation(w, 'a')).toEqual({ file: 'x.ts', line: 3, column: 1 });
    expect(getInstanceLocation(w, 'b')).toBeUndefined();
    expect(getInstanceLocation(w, 'nope')).toBeUndefined();
  });

  describe('mutually exclusive sources', () => {
    const branch = nodeType('t');
    const noFailure = nodeType('plain', { hasFailurePort: false });
    const map = (w: TWorkflowAST) => new Map(w.instances.map((i) => [i.id, w.nodeTypes.find((t) => t.functionName === i.nodeType)!]));
    const check = (w: TWorkflowAST, sources: string[]) => areMutuallyExclusive(sources, w, map(w));

    it('are the two arms of one branching node, however far downstream', () => {
      // `ok` has no failure port, so it is not a branch of its own.
      const w = wf([inst('g'), inst('ok', undefined, 'plain'), inst('bad'), inst('okLater')], ['g.onSuccess -> ok.execute', 'g.onFailure -> bad.execute', 'ok.onSuccess -> okLater.execute'], [branch, noFailure]);
      expect(check(w, ['okLater', 'bad'])).toBe(true);
    });

    it('are not one source, two sources on the same arm, or sources under different branching nodes', () => {
      const w = wf(
        [inst('g'), inst('h'), inst('a1'), inst('a2'), inst('b1')],
        ['g.onSuccess -> a1.execute', 'g.onSuccess -> a2.execute', 'h.onFailure -> b1.execute'],
        [branch],
      );
      expect(check(w, ['a1'])).toBe(false);
      expect(check(w, ['a1', 'a2'])).toBe(false);
      expect(check(w, ['a1', 'b1'])).toBe(false);
    });

    it('need a branching ancestor for every source, one with both a success and a failure port', () => {
      const w = wf(
        [inst('g'), inst('ok'), inst('bad'), inst('loose'), inst('p', undefined, 'plain'), inst('x')],
        ['g.onSuccess -> ok.execute', 'g.onFailure -> bad.execute', 'p.onSuccess -> x.execute'],
        [branch, noFailure],
      );
      expect(check(w, ['ok', 'loose'])).toBe(false);
      expect(check(w, ['ok', 'x'])).toBe(false);
      // A data edge does not make a branch.
      const data = wf([inst('g'), inst('d1'), inst('d2')], ['g.value -> d1.value', 'g.other -> d2.value'], [branch]);
      expect(check(data, ['d1', 'd2'])).toBe(false);
    });

    it('stop at a loop instead of walking it forever', () => {
      const w = wf([inst('a', undefined, 'plain'), inst('b', undefined, 'plain')], ['a.onSuccess -> b.execute', 'b.onSuccess -> a.execute'], [noFailure]);
      expect(check(w, ['a', 'b'])).toBe(false);
    });
  });
});

describe('loops', () => {
  const cycles = (w: TWorkflowAST) => {
    const ctx: ValidationContext = { errors: [], warnings: [], strictMode: false, draftMode: false };
    validateCycles(ctx, w);
    return ctx.errors.map((e) => `${e.type} ${e.code} ${e.node}: ${e.message}`);
  };

  it('reports a loop once, with its path from where it was entered', () => {
    const w = wf([inst('a'), inst('b'), inst('c')], ['a.onSuccess -> b.execute', 'b.onSuccess -> c.execute', 'c.onSuccess -> b.execute', 'a.onSuccess -> c.execute']);
    expect(cycles(w)).toEqual(['error CYCLE_DETECTED b: Loop detected: b -> c -> b']);
  });

  it('names the scope a loop among children is in, and keeps layers apart', () => {
    const w = wf([inst('p'), inst('x', 'p'), inst('y', 'p'), inst('r')], ['x.onSuccess -> y.execute', 'y.onSuccess -> x.execute', 'x.onSuccess -> r.execute', 'r.onSuccess -> x.execute']);
    expect(cycles(w)).toEqual(['error CYCLE_DETECTED x: Loop detected in scope "p": x -> y -> x']);
  });

  it('reports two different loops through one node separately', () => {
    const w = wf([inst('a'), inst('b'), inst('c')], ['a.onSuccess -> b.execute', 'b.onSuccess -> a.execute', 'a.onSuccess -> c.execute', 'c.onSuccess -> a.execute']);
    expect(cycles(w)).toEqual(['error CYCLE_DETECTED a: Loop detected: a -> b -> a', 'error CYCLE_DETECTED a: Loop detected: a -> c -> a']);
  });

  it('allows a node connected to itself, and a chain through it', () => {
    expect(cycles(wf([inst('a'), inst('b')], ['a.onSuccess -> a.execute', 'a.onSuccess -> b.execute', 'b.onSuccess -> a.execute']))).toEqual([]);
    expect(cycles(wf([inst('a'), inst('b')], ['a.onSuccess -> a.execute', 'a.onSuccess -> b.execute']))).toEqual([]);
  });

  it('ignores connections to nodes that are not instances', () => {
    expect(cycles(wf([inst('a')], ['a.onSuccess -> ghost.execute', 'ghost.onSuccess -> a.execute', 'Start.execute -> a.execute', 'a.onSuccess -> Exit.onSuccess']))).toEqual([]);
  });
});
