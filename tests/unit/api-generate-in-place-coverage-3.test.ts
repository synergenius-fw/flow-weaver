/**
 * Coverage tests for src/api/generate-in-place.ts
 * Targets line 1564 (@fanIn macro emission) and lines 1764-1767
 * (topological sort cycle fallback).
 */

import { generateInPlace } from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST, TFanInMacro } from '../../src/ast/types';

function makeNodeType(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
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

describe('generate-in-place coverage - fanIn macro', () => {
  it('emits @fanIn macro line in workflow JSDoc', () => {
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const merger = makeNodeType('merger');

    const fanInMacro: TFanInMacro = {
      type: 'fanIn',
      sources: [
        { node: 'a', port: 'result' },
        { node: 'b', port: 'result' },
      ],
      target: { node: 'merger', port: 'value' },
    };

    const sourceCode = `/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @node merger merger
 * @connect Start.execute -> a.execute
 * @connect Start.execute -> b.execute
 * @connect a.result -> merger.value
 * @connect b.result -> merger.value
 * @connect merger.onSuccess -> Exit.onSuccess
 */
export async function fanInWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}`;

    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'fanInWorkflow',
      functionName: 'fanInWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [nodeA, nodeB, merger],
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        { type: 'NodeInstance', id: 'merger', nodeType: 'merger' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'b', port: 'execute' } },
        { type: 'Connection', from: { node: 'a', port: 'result' }, to: { node: 'merger', port: 'value' } },
        { type: 'Connection', from: { node: 'b', port: 'result' }, to: { node: 'merger', port: 'value' } },
        { type: 'Connection', from: { node: 'merger', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
      macros: [fanInMacro],
    };

    const result = generateInPlace(sourceCode, ast, { skipParamReturns: true });
    expect(result.code).toContain('@fanIn');
    expect(result.code).toContain('a.result');
    expect(result.code).toContain('b.result');
    expect(result.code).toContain('merger.value');
  });

  it('emits @fanIn with sources that have no port specified', () => {
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const merger = makeNodeType('merger');

    const fanInMacro: TFanInMacro = {
      type: 'fanIn',
      sources: [
        { node: 'a' },
        { node: 'b' },
      ],
      target: { node: 'merger', port: 'value' },
    };

    const sourceCode = `/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @node merger merger
 * @connect Start.execute -> a.execute
 * @connect Start.execute -> b.execute
 * @connect a.value -> merger.value
 * @connect b.value -> merger.value
 * @connect merger.onSuccess -> Exit.onSuccess
 */
export async function fanInNoPort(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}`;

    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'fanInNoPort',
      functionName: 'fanInNoPort',
      sourceFile: 'test.ts',
      nodeTypes: [nodeA, nodeB, merger],
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        { type: 'NodeInstance', id: 'merger', nodeType: 'merger' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'b', port: 'execute' } },
        // Connections with source port defaulting to target port (value)
        { type: 'Connection', from: { node: 'a', port: 'value' }, to: { node: 'merger', port: 'value' } },
        { type: 'Connection', from: { node: 'b', port: 'value' }, to: { node: 'merger', port: 'value' } },
        { type: 'Connection', from: { node: 'merger', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
      macros: [fanInMacro],
    };

    const result = generateInPlace(sourceCode, ast, { skipParamReturns: true });
    // Sources without ports should render as just the node name
    expect(result.code).toContain('@fanIn a, b -> merger.value');
  });
});

describe('generate-in-place coverage - topological sort cycle fallback', () => {
  it('exercises topological sort cycle fallback (lines 1764-1767) before body generator throws', () => {
    // All three nodes form a cycle in execution flow: a -> b -> c -> a.
    // computeTopologicalOrder runs first (for JSDoc node ordering) and hits the
    // cycle fallback (lines 1764-1767), then the body generator detects the cycle
    // and throws. The fallback lines are still covered.
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const nodeC = makeNodeType('nodeC');

    const sourceCode = `/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @node c nodeC
 * @connect a.onSuccess -> b.execute
 * @connect b.onSuccess -> c.execute
 * @connect c.onSuccess -> a.execute
 */
export async function cyclicWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}`;

    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'cyclicWorkflow',
      functionName: 'cyclicWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [nodeA, nodeB, nodeC],
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        { type: 'NodeInstance', id: 'c', nodeType: 'nodeC' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
        { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'c', port: 'onSuccess' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'a', port: 'onFailure' }, to: { node: 'Exit', port: 'onFailure' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    // The body generator throws on cycles, but computeTopologicalOrder
    // (which contains our target lines) runs before that
    expect(() => generateInPlace(sourceCode, ast, { skipParamReturns: true })).toThrow('Circular dependency');
  });
});
