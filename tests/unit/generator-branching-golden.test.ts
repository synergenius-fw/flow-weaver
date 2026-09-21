/**
 * GOLDEN characterization tests for the branching code path in
 * src/generator/unified.ts (debt item #2).
 *
 * These snapshot the FULL generated code for a matrix of branching workflows
 * (each in dev + production mode). They exist to make the following refactors
 * provably behavior-neutral:
 *   - removal of the dead `_generateReturns` positional parameter of
 *     generateBranchingNodeCode (and the `false` argument at all 5 call sites)
 *   - decomposition of the ~515-line generateBranchingNodeCode into helpers.
 *
 * If any snapshot changes, the refactor changed emitted output. Investigate
 * before updating. Snapshots are captured against the pre-refactor code.
 *
 * The workflows deliberately exercise distinct branches of
 * generateBranchingNodeCode:
 *   1. single branching node, both success+failure downstream
 *   2. branching node with ONLY success downstream
 *   3. branching node with ONLY failure downstream
 *   4. branching node with NEITHER downstream (terminal branch)
 *   5. fan-out: two branching nodes from Start
 *   6. chained branching nodes (branch -> branch)
 *   7. expression branching node (single data output)
 *   8. async branching node (await path)
 *
 * Coverage note: the extracted helper (emitBranchNodeCallAndOutputs) is fully
 * covered by these scenarios EXCEPT the sync arm of the MAP_ITERATOR iteration
 * body's `isAsync ? 'await ' : ''` ternary. A MAP_ITERATOR branching node's
 * inline iteration is only generated in async context, so that arm is
 * effectively unreachable through generateCode (it is uncovered on main as
 * well, pre-refactor). This is a pre-existing gap in relocated code, not a
 * regression introduced by the extraction.
 */

import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

function makeBranch(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
    functionText: `function ${name}(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }`,
    ...overrides,
  };
}

function makeSink(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      out: { dataType: 'NUMBER' },
    },
    hasSuccessPort: false,
    hasFailurePort: false,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
    functionText: `function ${name}(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; out: number } { return { onSuccess: true, onFailure: false, out: value }; }`,
    ...overrides,
  };
}

function wf(
  nodeTypes: TNodeTypeAST[],
  instances: TWorkflowAST['instances'],
  connections: TWorkflowAST['connections'],
  overrides: Partial<TWorkflowAST> = {},
): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes,
    instances,
    connections,
    scopes: {},
    startPorts: { execute: { dataType: 'STEP' }, n: { dataType: 'NUMBER' } },
    exitPorts: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    imports: [],
    ...overrides,
  };
}

const conn = (fn: string, fp: string, tn: string, tp: string): TWorkflowAST['connections'][number] => ({
  type: 'Connection',
  from: { node: fn, port: fp },
  to: { node: tn, port: tp },
});

// --- workflow builders (one per branching scenario) ---

function singleBothDownstream(): TWorkflowAST {
  return wf(
    [makeBranch('br'), makeSink('okSink'), makeSink('failSink')],
    [
      { type: 'NodeInstance', id: 'b', nodeType: 'br' },
      { type: 'NodeInstance', id: 'ok', nodeType: 'okSink' },
      { type: 'NodeInstance', id: 'fail', nodeType: 'failSink' },
    ],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'onSuccess', 'ok', 'execute'),
      conn('b', 'result', 'ok', 'value'),
      conn('b', 'onFailure', 'fail', 'execute'),
      conn('b', 'result', 'fail', 'value'),
      conn('ok', 'out', 'Exit', 'result'),
    ],
  );
}

function onlySuccessDownstream(): TWorkflowAST {
  return wf(
    [makeBranch('br'), makeSink('okSink')],
    [
      { type: 'NodeInstance', id: 'b', nodeType: 'br' },
      { type: 'NodeInstance', id: 'ok', nodeType: 'okSink' },
    ],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'onSuccess', 'ok', 'execute'),
      conn('b', 'result', 'ok', 'value'),
      conn('ok', 'out', 'Exit', 'result'),
    ],
  );
}

function onlyFailureDownstream(): TWorkflowAST {
  return wf(
    [makeBranch('br'), makeSink('failSink')],
    [
      { type: 'NodeInstance', id: 'b', nodeType: 'br' },
      { type: 'NodeInstance', id: 'fail', nodeType: 'failSink' },
    ],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'onFailure', 'fail', 'execute'),
      conn('b', 'result', 'fail', 'value'),
      conn('fail', 'out', 'Exit', 'result'),
    ],
  );
}

function neitherDownstream(): TWorkflowAST {
  return wf(
    [makeBranch('br')],
    [{ type: 'NodeInstance', id: 'b', nodeType: 'br' }],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'result', 'Exit', 'result'),
    ],
  );
}

function fanOutTwoBranches(): TWorkflowAST {
  return wf(
    [makeBranch('brA'), makeBranch('brB'), makeSink('okSink')],
    [
      { type: 'NodeInstance', id: 'a', nodeType: 'brA' },
      { type: 'NodeInstance', id: 'bb', nodeType: 'brB' },
      { type: 'NodeInstance', id: 'ok', nodeType: 'okSink' },
    ],
    [
      conn('Start', 'execute', 'a', 'execute'),
      conn('Start', 'n', 'a', 'value'),
      conn('Start', 'execute', 'bb', 'execute'),
      conn('Start', 'n', 'bb', 'value'),
      conn('a', 'onSuccess', 'ok', 'execute'),
      conn('a', 'result', 'ok', 'value'),
      conn('ok', 'out', 'Exit', 'result'),
    ],
  );
}

function chainedBranches(): TWorkflowAST {
  return wf(
    [makeBranch('brA'), makeBranch('brB'), makeSink('okSink')],
    [
      { type: 'NodeInstance', id: 'a', nodeType: 'brA' },
      { type: 'NodeInstance', id: 'bb', nodeType: 'brB' },
      { type: 'NodeInstance', id: 'ok', nodeType: 'okSink' },
    ],
    [
      conn('Start', 'execute', 'a', 'execute'),
      conn('Start', 'n', 'a', 'value'),
      conn('a', 'onSuccess', 'bb', 'execute'),
      conn('a', 'result', 'bb', 'value'),
      conn('bb', 'onSuccess', 'ok', 'execute'),
      conn('bb', 'result', 'ok', 'value'),
      conn('ok', 'out', 'Exit', 'result'),
    ],
  );
}

function expressionBranch(): TWorkflowAST {
  return wf(
    [
      makeBranch('checkValue', {
        expression: true,
        outputs: {
          onSuccess: { dataType: 'STEP' },
          onFailure: { dataType: 'STEP' },
          result: { dataType: 'BOOLEAN' },
        },
      }),
      makeSink('handler'),
    ],
    [
      { type: 'NodeInstance', id: 'chk', nodeType: 'checkValue' },
      { type: 'NodeInstance', id: 'h', nodeType: 'handler' },
    ],
    [
      conn('Start', 'execute', 'chk', 'execute'),
      conn('Start', 'n', 'chk', 'value'),
      conn('chk', 'onSuccess', 'h', 'execute'),
      conn('h', 'out', 'Exit', 'result'),
    ],
  );
}

function asyncBranch(): TWorkflowAST {
  return wf(
    [makeBranch('brAsync', { isAsync: true }), makeSink('okSink')],
    [
      { type: 'NodeInstance', id: 'b', nodeType: 'brAsync' },
      { type: 'NodeInstance', id: 'ok', nodeType: 'okSink' },
    ],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'onSuccess', 'ok', 'execute'),
      conn('b', 'result', 'ok', 'value'),
      conn('ok', 'out', 'Exit', 'result'),
    ],
    { isAsync: true },
  );
}

// Regular branching node carrying a scoped output port (in addition to its
// data output). Exercises the regular-variant arm's scoped-port skip.
function regularBranchWithScopedOutput(): TWorkflowAST {
  const b = makeBranch('regScoped', {
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
      scopedOut: { dataType: 'ANY', scope: 'body' },
    },
  });
  return wf(
    [b, makeSink('regScopedSink')],
    [
      { type: 'NodeInstance', id: 'b', nodeType: 'regScoped' },
      { type: 'NodeInstance', id: 'ok', nodeType: 'regScopedSink' },
    ],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'onSuccess', 'ok', 'execute'),
      conn('b', 'result', 'ok', 'value'),
      conn('ok', 'out', 'Exit', 'result'),
    ],
  );
}

// IMPORTED_WORKFLOW-variant branching node carrying a scoped output port.
// Exercises the workflow-variant arm (params object) + scoped-port skip.
function workflowVariantBranchWithScopedOutput(): TWorkflowAST {
  const wfNode = makeBranch('subWf', {
    variant: 'IMPORTED_WORKFLOW',
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
      scopedOut: { dataType: 'ANY', scope: 'body' },
    },
  });
  return wf(
    [wfNode, makeSink('subWfSink')],
    [
      { type: 'NodeInstance', id: 'b', nodeType: 'subWf' },
      { type: 'NodeInstance', id: 'ok', nodeType: 'subWfSink' },
    ],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'onSuccess', 'ok', 'execute'),
      conn('b', 'result', 'ok', 'value'),
      conn('ok', 'out', 'Exit', 'result'),
    ],
  );
}

// Node-level scoped branching node (FUNCTION variant with `scope`) carrying a
// scoped output port. Exercises the scoped-node arm (distinct from the regular
// arm) + its scoped-port skip.
function nodeScopedBranch(): TWorkflowAST {
  const b = makeBranch('scopedFn', {
    scope: 'body',
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
      item: { dataType: 'ANY', scope: 'body' },
    },
  });
  return wf(
    [b, makeSink('nodeScopedSink')],
    [
      { type: 'NodeInstance', id: 'b', nodeType: 'scopedFn' },
      { type: 'NodeInstance', id: 'sk', nodeType: 'nodeScopedSink' },
    ],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'onSuccess', 'sk', 'execute'),
      conn('b', 'result', 'sk', 'value'),
      conn('sk', 'out', 'Exit', 'result'),
    ],
  );
}

// MAP_ITERATOR branching node (inline iteration) with a scoped `item` output
// and a downstream success sink. Exercises the MAP_ITERATOR arm.
function mapIteratorBranch(): TWorkflowAST {
  const mapBranch = makeBranch('mapBranch', {
    variant: 'MAP_ITERATOR',
    scope: 'body',
    inputs: {
      execute: { dataType: 'STEP' },
      items: { dataType: 'ARRAY' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      results: { dataType: 'ARRAY' },
      item: { dataType: 'ANY', scope: 'body' },
    },
  });
  return wf(
    [mapBranch, makeSink('mapSink')],
    [
      { type: 'NodeInstance', id: 'mb', nodeType: 'mapBranch' },
      { type: 'NodeInstance', id: 'mh', nodeType: 'mapSink' },
    ],
    [
      conn('Start', 'execute', 'mb', 'execute'),
      conn('Start', 'n', 'mb', 'items'),
      conn('mb', 'onSuccess', 'mh', 'execute'),
      conn('mb', 'results', 'mh', 'value'),
      conn('mh', 'out', 'Exit', 'result'),
    ],
  );
}

// Expression branching node with a scoped output port and a control-flow
// output port (in addition to two plain data outputs). Exercises the
// dataOutputPorts filter's scope + isControlFlow/failure `return false` arms
// AND the multiple-data-output (length !== 1) path.
function expressionBranchExtraPorts(): TWorkflowAST {
  const b = makeBranch('exprExtra', {
    expression: true,
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      low: { dataType: 'NUMBER' },
      high: { dataType: 'NUMBER' },
      scopedOut: { dataType: 'ANY', scope: 'body' },
      ctrlOut: { dataType: 'STEP', isControlFlow: true },
    },
  });
  return wf(
    [b, makeSink('exprExtraSink')],
    [
      { type: 'NodeInstance', id: 'ex', nodeType: 'exprExtra' },
      { type: 'NodeInstance', id: 'h', nodeType: 'exprExtraSink' },
    ],
    [
      conn('Start', 'execute', 'ex', 'execute'),
      conn('Start', 'n', 'ex', 'value'),
      conn('ex', 'onSuccess', 'h', 'execute'),
      conn('ex', 'low', 'h', 'value'),
      conn('h', 'out', 'Exit', 'result'),
    ],
  );
}

// Async MAP_ITERATOR branching node — exercises the `await` arm of the
// iteration body's `isAsync ? 'await ' : ''` ternary.
function asyncMapIteratorBranch(): TWorkflowAST {
  const mapBranch = makeBranch('asyncMapBranch', {
    variant: 'MAP_ITERATOR',
    scope: 'body',
    isAsync: true,
    inputs: {
      execute: { dataType: 'STEP' },
      items: { dataType: 'ARRAY' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      results: { dataType: 'ARRAY' },
      item: { dataType: 'ANY', scope: 'body' },
    },
  });
  return wf(
    [mapBranch, makeSink('asyncMapSink')],
    [
      { type: 'NodeInstance', id: 'mb', nodeType: 'asyncMapBranch' },
      { type: 'NodeInstance', id: 'mh', nodeType: 'asyncMapSink' },
    ],
    [
      conn('Start', 'execute', 'mb', 'execute'),
      conn('Start', 'n', 'mb', 'items'),
      conn('mb', 'onSuccess', 'mh', 'execute'),
      conn('mb', 'results', 'mh', 'value'),
      conn('mh', 'out', 'Exit', 'result'),
    ],
    { isAsync: true },
  );
}

// Branching node using the `scopes` array (rather than a single `scope`).
// Exercises the right-hand side of the scoped-arm `||` condition.
function scopesArrayBranch(): TWorkflowAST {
  const b = makeBranch('multiScopeFn', {
    scopes: ['bodyA', 'bodyB'],
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
  });
  return wf(
    [b, makeSink('multiScopeSink')],
    [
      { type: 'NodeInstance', id: 'b', nodeType: 'multiScopeFn' },
      { type: 'NodeInstance', id: 'sk', nodeType: 'multiScopeSink' },
    ],
    [
      conn('Start', 'execute', 'b', 'execute'),
      conn('Start', 'n', 'b', 'value'),
      conn('b', 'onSuccess', 'sk', 'execute'),
      conn('b', 'result', 'sk', 'value'),
      conn('sk', 'out', 'Exit', 'result'),
    ],
  );
}

const SCENARIOS: Array<[string, () => TWorkflowAST]> = [
  ['single-both-downstream', singleBothDownstream],
  ['only-success-downstream', onlySuccessDownstream],
  ['only-failure-downstream', onlyFailureDownstream],
  ['neither-downstream', neitherDownstream],
  ['fan-out-two-branches', fanOutTwoBranches],
  ['chained-branches', chainedBranches],
  ['expression-branch', expressionBranch],
  ['async-branch', asyncBranch],
  ['regular-branch-scoped-output', regularBranchWithScopedOutput],
  ['workflow-variant-branch-scoped-output', workflowVariantBranchWithScopedOutput],
  ['node-scoped-branch', nodeScopedBranch],
  ['scopes-array-branch', scopesArrayBranch],
  ['map-iterator-branch', mapIteratorBranch],
  ['async-map-iterator-branch', asyncMapIteratorBranch],
  ['expression-branch-extra-ports', expressionBranchExtraPorts],
];

/**
 * The generated file carries the engine version it was written by, which
 * these snapshots baked in and so broke on every release -- a diff that says
 * nothing about branching codegen, which is all they are here to watch.
 */
const stableVersion = (code: string): string =>
  code.replace(/const VERSION = "\d+\.\d+\.\d+[^"]*";/g, 'const VERSION = "0.0.0-test";');

describe('branching codegen golden (debt #2)', () => {
  for (const [label, build] of SCENARIOS) {
    it(`dev-mode output is stable: ${label}`, () => {
      const code = generateCode(build(), { production: false });
      expect(stableVersion(code)).toMatchSnapshot();
    });
    it(`prod-mode output is stable: ${label}`, () => {
      const code = generateCode(build(), { production: true });
      expect(stableVersion(code)).toMatchSnapshot();
    });
  }
});
