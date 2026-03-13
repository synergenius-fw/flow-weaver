/**
 * Coverage tests for src/api/generate-in-place.ts
 * Targets line 1621 (scope emission in workflow JSDoc) and lines 1764-1767
 * (topological sort fallback for cycles/disconnected nodes).
 */

import { generateInPlace } from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

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

describe('generate-in-place coverage', () => {
  it('emits @scope tags in workflow JSDoc for non-macro scopes', () => {
    // Workflow with a scope that is NOT covered by a @map macro
    const parentNode = makeNodeType('forEach', {
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        results: { dataType: 'ARRAY' },
      },
      functionText: `function forEach(execute: boolean, items: any[]): { onSuccess: boolean; onFailure: boolean; results: any[] } { return { onSuccess: true, onFailure: false, results: items }; }`,
    });

    const childNode = makeNodeType('processItem', {
      functionText: `function processItem(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value * 2 }; }`,
    });

    const sourceCode = `/**
 * @flowWeaver workflow
 * @node parent forEach
 * @connect Start.execute -> parent.execute
 * @connect parent.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}`;

    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'myWorkflow',
      functionName: 'myWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [parentNode, childNode],
      instances: [
        { type: 'NodeInstance', id: 'parent', nodeType: 'forEach' },
        { type: 'NodeInstance', id: 'child', nodeType: 'processItem', parent: 'parent' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'parent', port: 'execute' } },
        { type: 'Connection', from: { node: 'parent', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {
        'iteration': ['child'],
      },
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    const result = generateInPlace(sourceCode, ast, { skipParamReturns: true });
    // The JSDoc should contain the @scope tag
    expect(result.code).toContain('@scope iteration [child]');
  });

  it('handles topological sort fallback for disconnected nodes', () => {
    // Node 'b' has no execution flow connections to/from other instances,
    // making it unreachable by topological sort. The fallback appends it
    // in declaration order. Only data connections exist for 'b'.
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');

    const sourceCode = `/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export async function disconnectedWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}`;

    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'disconnectedWorkflow',
      functionName: 'disconnectedWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [nodeA, nodeB],
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        // Only data connection for b, no execution flow (onSuccess/onFailure -> execute)
        { type: 'Connection', from: { node: 'a', port: 'result' }, to: { node: 'b', port: 'value' } },
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    const result = generateInPlace(sourceCode, ast, { skipParamReturns: true });
    expect(result.code).toBeDefined();
    // Both nodes should appear in the output
    expect(result.code).toContain('@node a nodeA');
    expect(result.code).toContain('@node b nodeB');
  });
});
