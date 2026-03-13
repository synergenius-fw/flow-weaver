/**
 * Coverage tests for src/generator/unified.ts
 * Targets uncovered lines around executeWhen strategies (CONJUNCTION with OR-grouped conditions,
 * DISJUNCTION, and CUSTOM with fallback).
 */

import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST, TDataType } from '../../src/ast/types';

function makeNodeType(
  name: string,
  overrides: Partial<TNodeTypeAST> = {}
): TNodeTypeAST {
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

function makeWorkflow(
  nodeTypes: TNodeTypeAST[],
  instances: TWorkflowAST['instances'],
  connections: TWorkflowAST['connections'],
  overrides: Partial<TWorkflowAST> = {}
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
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
    imports: [],
    ...overrides,
  };
}

describe('Unified Generator - executeWhen strategies', () => {
  it('generates OR-grouped conditions for CONJUNCTION with multiple sources per port', () => {
    // Two nodes (A, B) both connect onSuccess -> C.execute
    // This means C's "execute" port has two sources, so the condition should be OR-grouped.
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const nodeC = makeNodeType('nodeC', { executeWhen: 'CONJUNCTION' });

    const workflow = makeWorkflow(
      [nodeA, nodeB, nodeC],
      [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        { type: 'NodeInstance', id: 'c', nodeType: 'nodeC' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'b', port: 'execute' } },
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ]
    );

    const code = generateCode(workflow, { production: true, generateStubs: true });
    // The generated code should contain an OR condition for the two sources
    // Both A and B are branching (have success/failure), so the condition uses _success variables
    expect(code).toContain('||');
  });

  it('generates DISJUNCTION (OR) conditions', () => {
    // Two step inputs, both with separate sources. DISJUNCTION means ANY source triggers execution.
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const nodeC = makeNodeType('nodeC', { executeWhen: 'DISJUNCTION' });

    const workflow = makeWorkflow(
      [nodeA, nodeB, nodeC],
      [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        { type: 'NodeInstance', id: 'c', nodeType: 'nodeC' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'b', port: 'execute' } },
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ]
    );

    const code = generateCode(workflow, { production: true, generateStubs: true });
    // DISJUNCTION should produce OR between all unique sources
    expect(code).toContain('||');
  });

  it('generates CUSTOM execution condition from metadata', () => {
    // nodeA is branching (has onSuccess/onFailure). nodeB is independent.
    // nodeC is in nodeA's success branch but has a DATA dependency on nodeB,
    // so it gets "promoted" to top level with useConst=false, skipExecuteGuard=false.
    // This lets the CUSTOM executeWhen condition apply.
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB', {
      hasSuccessPort: false,
      hasFailurePort: false,
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { result: { dataType: 'NUMBER' } },
      functionText: `function nodeB(execute: boolean, value: number): { result: number } { return { result: value }; }`,
    });
    const nodeC = makeNodeType('nodeC', {
      executeWhen: 'CUSTOM',
      metadata: { customExecuteCondition: 'someFlag === true' },
      hasSuccessPort: false,
      hasFailurePort: false,
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { result: { dataType: 'NUMBER' } },
      functionText: `function nodeC(execute: boolean, value: number): { result: number } { return { result: value }; }`,
    });

    const workflow = makeWorkflow(
      [nodeA, nodeB, nodeC],
      [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        { type: 'NodeInstance', id: 'c', nodeType: 'nodeC' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'b', port: 'execute' } },
        // nodeC gets execute from nodeA's onSuccess (puts it in A's success branch)
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        // nodeC gets data from nodeB (external data dep promotes it out of branch)
        { type: 'Connection', from: { node: 'b', port: 'result' }, to: { node: 'c', port: 'value' } },
        { type: 'Connection', from: { node: 'c', port: 'result' }, to: { node: 'Exit', port: 'onSuccess' } },
        { type: 'Connection', from: { node: 'a', port: 'onFailure' }, to: { node: 'Exit', port: 'onFailure' } },
      ],
      { exitPorts: { onSuccess: { dataType: 'NUMBER' }, onFailure: { dataType: 'STEP' } } }
    );

    const code = generateCode(workflow, { production: true, generateStubs: true });
    expect(code).toContain('someFlag === true');
  });

  it('falls back to CONJUNCTION when CUSTOM has no customExecuteCondition', () => {
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const nodeC = makeNodeType('nodeC', {
      executeWhen: 'CUSTOM',
      // No metadata.customExecuteCondition provided
    });

    const workflow = makeWorkflow(
      [nodeA, nodeB, nodeC],
      [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        { type: 'NodeInstance', id: 'c', nodeType: 'nodeC' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'b', port: 'execute' } },
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ]
    );

    const code = generateCode(workflow, { production: true, generateStubs: true });
    // Falls back to CONJUNCTION, should produce OR-grouped conditions just like the first test
    expect(code).toContain('||');
    // Should NOT contain a custom condition string
    expect(code).not.toContain('someFlag');
  });
});
