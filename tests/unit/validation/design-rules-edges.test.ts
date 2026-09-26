/**
 * The design rules at the edges of each heuristic: which port names and
 * labels count, which alternatives silence a rule, and the exact warning.
 * tests/validation/design-rules.test.ts covers the main case of each rule.
 */
import { describe, it, expect } from 'vitest';
import {
  scopeNoFailureExitRule,
  unboundedRetryRule,
  fanoutNoFaninRule,
  pullCandidateRule,
  pullUnusedRule,
} from '../../../src/validation/design-rules';
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

const inst = (id: string, type: string, config?: TNodeInstanceAST['config']): TNodeInstanceAST => ({ type: 'NodeInstance', id, nodeType: type, ...(config ? { config } : {}) });

const conn = (s: string): TConnectionAST => {
  const [from, to] = s.split(' -> ');
  const [fn, fp] = from.split('.');
  const [tn, tp] = to.split('.');
  return { type: 'Connection', from: { node: fn, port: fp }, to: { node: tn, port: tp } };
};

const wf = (nodeTypes: TNodeTypeAST[], instances: TNodeInstanceAST[], connections: string[]): TWorkflowAST => ({
  type: 'Workflow', name: 'wf', functionName: 'wf', sourceFile: 'wf.ts',
  nodeTypes, instances, connections: connections.map(conn), scopes: {}, startPorts: {}, exitPorts: {}, imports: [],
});

const show = (ds: Array<{ type: string; code: string; message: string; node?: string }>) => ds.map((d) => `${d.type} ${d.code} ${d.node}: ${d.message}`);

describe('a scope with no failure exit', () => {
  const scoped = nodeType('each', { scopes: ['item'] });

  it('warns when neither onFailure nor failure leads anywhere', () => {
    expect(show(scopeNoFailureExitRule.validate(wf([scoped], [inst('s', 'each')], ['s.onSuccess -> Exit.onSuccess'])))).toEqual([
      "warning DESIGN_SCOPE_NO_FAILURE_EXIT s: Scope node 's' has no failure path out. If all iterations fail, execution stalls with no error surfaced.",
    ]);
  });

  it('accepts a connected failure port as the way out, and skips a type without a failure port', () => {
    expect(scopeNoFailureExitRule.validate(wf([scoped], [inst('s', 'each')], ['s.failure -> Exit.onFailure']))).toEqual([]);
    expect(scopeNoFailureExitRule.validate(wf([nodeType('each', { scopes: ['item'], hasFailurePort: false })], [inst('s', 'each')], []))).toEqual([]);
    expect(scopeNoFailureExitRule.validate(wf([nodeType('each', { scope: 'item' })], [inst('s', 'each')], ['s.onFailure -> Exit.onFailure']))).toEqual([]);
  });
});

describe('an unbounded retry', () => {
  it('recognises a retry by the type\'s label as well as its names', () => {
    const labelled = nodeType('wrapper', { scopes: ['attempt'], label: 'Retry until it works' });
    expect(show(unboundedRetryRule.validate(wf([labelled], [inst('r', 'wrapper')], [])))).toEqual([
      "warning DESIGN_UNBOUNDED_RETRY r: Scope node 'r' appears to be a retry loop but has no visible attempt limit input. This could loop indefinitely.",
    ]);
  });

  it('is silenced by a limit input, and does not apply to a scope that is not a retry', () => {
    const bounded = nodeType('retry', { scopes: ['attempt'], inputs: { execute: STEP, maxAttempts: { dataType: 'NUMBER' } } });
    expect(unboundedRetryRule.validate(wf([bounded], [inst('r', 'retry')], []))).toEqual([]);
    expect(unboundedRetryRule.validate(wf([nodeType('each', { scopes: ['item'] })], [inst('e', 'each')], []))).toEqual([]);
    expect(unboundedRetryRule.validate(wf([nodeType('retry')], [inst('r', 'retry')], []))).toEqual([]);
  });
});

describe('fan-out without fan-in', () => {
  const plain = nodeType('work', { outputs: { onSuccess: STEP, onFailure: { ...STEP, failure: true }, data: { dataType: 'NUMBER' } }, inputs: { execute: STEP, value: { dataType: 'NUMBER', optional: true } } });
  const merging = nodeType('merge', { inputs: { execute: STEP, value: { dataType: 'NUMBER', mergeStrategy: 'COLLECT' as TPortDefinition['mergeStrategy'] } } });
  const ids = ['src', 'a', 'b', 'c', 'd', 'e'];

  it('warns about three step targets whose paths never meet, naming them in order', () => {
    const r = fanoutNoFaninRule.validate(wf([plain], ids.map((id) => inst(id, 'work')), ['src.onSuccess -> a.execute', 'src.onSuccess -> b.execute', 'src.onFailure -> c.execute', 'src.onSuccess -> Exit.onSuccess']));
    expect(show(r)).toEqual([
      "warning DESIGN_FANOUT_NO_FANIN src: Node 'src' fans out to 3 step targets (a, b, c) but those paths never merge back. Data from parallel branches may be lost.",
    ]);
  });

  it('does not count data connections or Exit as step targets', () => {
    expect(fanoutNoFaninRule.validate(wf([plain], ids.map((id) => inst(id, 'work')), ['src.data -> a.value', 'src.data -> b.value', 'src.onSuccess -> c.execute', 'src.onSuccess -> Exit.onSuccess']))).toEqual([]);
  });

  it('is satisfied when two of the paths meet downstream', () => {
    expect(fanoutNoFaninRule.validate(wf([plain], ids.map((id) => inst(id, 'work')), ['src.onSuccess -> a.execute', 'src.onSuccess -> b.execute', 'src.onSuccess -> c.execute', 'c.onSuccess -> d.execute', 'b.onSuccess -> d.execute']))).toEqual([]);
  });

  it('is satisfied when a target merges its inputs, and skips targets that are not instances', () => {
    const instances = [...ids.map((id) => inst(id, 'work')), inst('m', 'merge')];
    expect(fanoutNoFaninRule.validate(wf([plain, merging], instances, ['src.onSuccess -> a.execute', 'src.onSuccess -> ghost.execute', 'src.onSuccess -> m.execute']))).toEqual([]);
    const withoutMerge = fanoutNoFaninRule.validate(wf([plain], ids.map((id) => inst(id, 'work')), ['src.onSuccess -> a.execute', 'src.onSuccess -> ghost.execute', 'src.onSuccess -> b.execute']));
    expect(withoutMerge.map((d) => d.code)).toEqual(['DESIGN_FANOUT_NO_FANIN']);
  });
});

describe('pull execution', () => {
  const producer = nodeType('produce', { outputs: { onSuccess: STEP, first: { dataType: 'NUMBER' }, second: { dataType: 'NUMBER' } } });
  const consumer = nodeType('consume', { inputs: { execute: STEP, value: { dataType: 'NUMBER' } } });

  it('suggests pull execution when any one data output is read without a step trigger', () => {
    const r = pullCandidateRule.validate(wf([producer, consumer], [inst('p', 'produce'), inst('c', 'consume')], ['Start.execute -> c.execute', 'p.second -> c.value']));
    expect(show(r)).toEqual([
      "warning DESIGN_PULL_CANDIDATE p: Node 'p' has no incoming step connection but its data outputs are consumed downstream. Consider adding [pullExecution: execute] so it executes on demand.",
    ]);
  });

  it('does not suggest it in a workflow with a durable effect', () => {
    const effect = nodeType('effect', { durableEffect: true });
    expect(pullCandidateRule.validate(wf([producer, consumer, effect], [inst('p', 'produce'), inst('c', 'consume'), inst('e', 'effect')], ['Start.execute -> c.execute', 'p.second -> c.value']))).toEqual([]);
  });

  it('warns about a pull node none of whose data is read, and not one with any output read', () => {
    const pulled = { pullExecution: { triggerPort: 'execute' } };
    expect(show(pullUnusedRule.validate(wf([producer], [inst('p', 'produce', pulled)], [])))).toEqual([
      "warning DESIGN_PULL_UNUSED p: Node 'p' is marked with pullExecution but no downstream node reads its data output. It will never execute.",
    ]);
    expect(pullUnusedRule.validate(wf([producer, consumer], [inst('p', 'produce', pulled), inst('c', 'consume')], ['p.first -> c.value']))).toEqual([]);
    const byDefault = nodeType('produce', { ...producer, defaultConfig: { pullExecution: { triggerPort: 'execute' } } });
    expect(pullUnusedRule.validate(wf([byDefault], [inst('p', 'produce')], [])).map((d) => d.code)).toEqual(['DESIGN_PULL_UNUSED']);
  });
});
