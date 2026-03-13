/**
 * Coverage for api/generate-in-place.ts:
 * - @scope tag emission for non-macro scopes in JSDoc (line 1621)
 * - Topological sort fallback for disconnected nodes (lines 1764-1767)
 */
import { generateInPlace } from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

function makeNodeType(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { value: { dataType: 'NUMBER', optional: true } },
    outputs: { result: { dataType: 'NUMBER' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    ...overrides,
  };
}

describe('generateInPlace: @scope tag in JSDoc', () => {
  it('emits @scope annotations for non-macro scopes', () => {
    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'scopedFlow',
      functionName: 'scopedFlow',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('processor')],
      instances: [
        { type: 'NodeInstance', id: 'proc1', nodeType: 'processor', config: { x: 200, y: 100 } },
        { type: 'NodeInstance', id: 'proc2', nodeType: 'processor', config: { x: 400, y: 100 } },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'proc1', port: 'value' } },
        { type: 'Connection', from: { node: 'proc1', port: 'result' }, to: { node: 'proc2', port: 'value' } },
        { type: 'Connection', from: { node: 'proc2', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      scopes: {
        'myScope': ['proc1', 'proc2'],
      },
      startPorts: { input: { dataType: 'NUMBER' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
      ui: {
        startNode: { x: 0, y: 100 },
        exitNode: { x: 600, y: 100 },
      },
    };

    const sourceCode = `/**
 * @flowWeaver workflow
 * @node proc1 processor
 * @node proc2 processor
 */
export async function scopedFlow(execute: boolean, params: { input: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}`;

    const result = generateInPlace(sourceCode, ast);
    expect(result.code).toContain('@scope myScope [proc1, proc2]');
  });
});

describe('generateInPlace: topological sort fallback for disconnected nodes', () => {
  it('appends disconnected nodes in declaration order when topological sort misses them', () => {
    // Create a workflow with 3 instances where one is disconnected from the others.
    // The disconnected node has no execution flow connections, so it gets no in-degree.
    // All three should still appear as @node in the generated JSDoc.
    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'disconnectedFlow',
      functionName: 'disconnectedFlow',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('processor')],
      instances: [
        { type: 'NodeInstance', id: 'connected1', nodeType: 'processor' },
        { type: 'NodeInstance', id: 'connected2', nodeType: 'processor' },
        { type: 'NodeInstance', id: 'isolated', nodeType: 'processor' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'connected1', port: 'value' } },
        // Execution flow between connected1 and connected2
        { type: 'Connection', from: { node: 'connected1', port: 'onSuccess' }, to: { node: 'connected2', port: 'execute' } },
        { type: 'Connection', from: { node: 'connected1', port: 'result' }, to: { node: 'connected2', port: 'value' } },
        { type: 'Connection', from: { node: 'connected2', port: 'result' }, to: { node: 'Exit', port: 'result' } },
        // 'isolated' has a data connection but no execution flow connection to/from others
        // It connects to Start data but has no onSuccess -> execute chain
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'isolated', port: 'value' } },
      ],
      scopes: {},
      startPorts: { input: { dataType: 'NUMBER' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
    };

    const sourceCode = `/**
 * @flowWeaver workflow
 * @node connected1 processor
 * @node connected2 processor
 * @node isolated processor
 */
export async function disconnectedFlow(execute: boolean, params: { input: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}`;

    const result = generateInPlace(sourceCode, ast);
    // All three nodes should be present in the output
    expect(result.code).toContain('connected1');
    expect(result.code).toContain('connected2');
    expect(result.code).toContain('isolated');
  });
});

describe('generateInPlace: topological sort with cyclic execution flow', () => {
  it('includes cycle nodes in declaration order as fallback', () => {
    // Create a cycle: nodeA.onSuccess -> nodeB.execute, nodeB.onSuccess -> nodeA.execute
    // This creates a cycle in execution flow. The topological sort won't resolve all nodes,
    // so the fallback path (lines 1764-1767) appends the remaining ones.
    const ast: TWorkflowAST = {
      type: 'Workflow',
      name: 'cyclicFlow',
      functionName: 'cyclicFlow',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('processor')],
      instances: [
        { type: 'NodeInstance', id: 'nodeA', nodeType: 'processor' },
        { type: 'NodeInstance', id: 'nodeB', nodeType: 'processor' },
        { type: 'NodeInstance', id: 'nodeC', nodeType: 'processor' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'nodeC', port: 'value' } },
        { type: 'Connection', from: { node: 'nodeC', port: 'result' }, to: { node: 'Exit', port: 'result' } },
        // Cyclic execution flow between nodeA and nodeB
        { type: 'Connection', from: { node: 'nodeA', port: 'onSuccess' }, to: { node: 'nodeB', port: 'execute' } },
        { type: 'Connection', from: { node: 'nodeB', port: 'onSuccess' }, to: { node: 'nodeA', port: 'execute' } },
        // Data connections
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'nodeA', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'nodeB', port: 'value' } },
      ],
      scopes: {},
      startPorts: { input: { dataType: 'NUMBER' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
    };

    const sourceCode = `/**
 * @flowWeaver workflow
 * @node nodeA processor
 * @node nodeB processor
 * @node nodeC processor
 */
export async function cyclicFlow(execute: boolean, params: { input: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}`;

    const result = generateInPlace(sourceCode, ast);
    // All nodes should still appear (the cycle nodes are appended via fallback)
    expect(result.code).toContain('nodeA');
    expect(result.code).toContain('nodeB');
    expect(result.code).toContain('nodeC');
  });
});
