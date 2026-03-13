/**
 * Coverage tests for src/generator/unified.ts
 * Targets lines 2040 (CONJUNCTION OR-grouped with multiple sources per port),
 * 2049-2064 (DISJUNCTION with dedup), and 2065-2087 (CUSTOM fallback with
 * multiple sources per port generating OR-grouped conditions).
 */

import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

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

describe('Unified Generator - CONJUNCTION with multiple ports each having multiple sources', () => {
  it('generates AND of OR-grouped conditions across multiple STEP input ports', () => {
    // nodeC has TWO step inputs: "execute" and "trigger", both receiving from different sources.
    // With CONJUNCTION, each port generates an OR of its sources, then AND them together.
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const nodeC = makeNodeType('nodeC', {
      executeWhen: 'CONJUNCTION',
      inputs: {
        execute: { dataType: 'STEP' },
        trigger: { dataType: 'STEP' },
        value: { dataType: 'NUMBER' },
      },
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
        // Two sources for execute port
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        // Two sources for trigger port
        { type: 'Connection', from: { node: 'a', port: 'onFailure' }, to: { node: 'c', port: 'trigger' } },
        { type: 'Connection', from: { node: 'b', port: 'onFailure' }, to: { node: 'c', port: 'trigger' } },
        { type: 'Connection', from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ]
    );

    const code = generateCode(workflow, { production: true, generateStubs: true });
    // Should have OR groups (||) AND-ed together (&&)
    expect(code).toContain('||');
    expect(code).toContain('&&');
  });
});

describe('Unified Generator - DISJUNCTION with multiple distinct step sources', () => {
  it('generates OR across all unique source nodes for DISJUNCTION', () => {
    // nodeC uses DISJUNCTION with two separate step input ports, each from different sources.
    // All unique sources should be OR-ed together in a single condition.
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const nodeC = makeNodeType('nodeC', {
      executeWhen: 'DISJUNCTION',
      inputs: {
        execute: { dataType: 'STEP' },
        trigger: { dataType: 'STEP' },
        value: { dataType: 'NUMBER' },
      },
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
        // a -> c.execute, b -> c.trigger (different ports)
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'trigger' } },
        { type: 'Connection', from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ]
    );

    const code = generateCode(workflow, { production: true, generateStubs: true });
    // DISJUNCTION: any source triggers, so OR condition
    expect(code).toContain('||');
  });
});

describe('Unified Generator - CUSTOM fallback with OR-grouped per-port conditions', () => {
  it('falls back to CONJUNCTION with OR-grouped conditions when CUSTOM has no condition and multiple sources', () => {
    // nodeC has CUSTOM executeWhen but no customExecuteCondition metadata,
    // and multiple sources per STEP port. The fallback should produce
    // OR-grouped conditions per port, AND-ed together (same as CONJUNCTION).
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');
    const nodeC = makeNodeType('nodeC', {
      executeWhen: 'CUSTOM',
      // No metadata.customExecuteCondition
      inputs: {
        execute: { dataType: 'STEP' },
        trigger: { dataType: 'STEP' },
        value: { dataType: 'NUMBER' },
      },
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
        // Two sources for execute port
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        // Two sources for trigger port
        { type: 'Connection', from: { node: 'a', port: 'onFailure' }, to: { node: 'c', port: 'trigger' } },
        { type: 'Connection', from: { node: 'b', port: 'onFailure' }, to: { node: 'c', port: 'trigger' } },
        { type: 'Connection', from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ]
    );

    const code = generateCode(workflow, { production: true, generateStubs: true });
    // Fallback to CONJUNCTION: OR-grouped per port, AND-ed together
    expect(code).toContain('||');
    expect(code).toContain('&&');
    expect(code).not.toContain('someFlag');
  });
});
