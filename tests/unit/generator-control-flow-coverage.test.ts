/**
 * Coverage for control-flow.ts determineExecutionOrder function (lines 402-428).
 * Tests topological ordering of nodes based on workflow connections.
 */
import { describe, it, expect } from 'vitest';
import { determineExecutionOrder } from '../../src/generator/control-flow';
import type { TWorkflowAST, TNodeTypeAST, TConnectionAST } from '../../src/ast/types';

function makeWorkflow(
  connections: Array<{ fromNode: string; fromPort: string; toNode: string; toPort: string }>,
): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: 'test.ts',
    name: 'test',
    functionName: 'test',
    nodeTypes: [],
    instances: [],
    connections: connections.map((c) => ({
      from: { node: c.fromNode, port: c.fromPort },
      to: { node: c.toNode, port: c.toPort },
    })) as TConnectionAST[],
    startPorts: {},
    exitPorts: {},
    imports: [],
  } as TWorkflowAST;
}

function makeNodeTypes(names: string[]): TNodeTypeAST[] {
  return names.map((name) => ({
    functionName: name,
    inputs: {},
    outputs: {},
    sourceFile: 'test.ts',
  })) as TNodeTypeAST[];
}

describe('determineExecutionOrder', () => {
  it('returns nodes in topological order for a simple chain', () => {
    const workflow = makeWorkflow([
      { fromNode: 'Start', fromPort: 'onSuccess', toNode: 'nodeA', toPort: 'execute' },
      { fromNode: 'nodeA', fromPort: 'onSuccess', toNode: 'nodeB', toPort: 'execute' },
      { fromNode: 'nodeB', fromPort: 'onSuccess', toNode: 'Exit', toPort: 'onSuccess' },
    ]);
    const nodeTypes = makeNodeTypes(['nodeA', 'nodeB']);

    const order = determineExecutionOrder(workflow, nodeTypes);

    expect(order).toEqual(['nodeA', 'nodeB']);
  });

  it('returns empty array when no start connections exist', () => {
    const workflow = makeWorkflow([
      { fromNode: 'nodeA', fromPort: 'onSuccess', toNode: 'nodeB', toPort: 'execute' },
    ]);
    const nodeTypes = makeNodeTypes(['nodeA', 'nodeB']);

    const order = determineExecutionOrder(workflow, nodeTypes);
    expect(order).toEqual([]);
  });

  it('handles diamond-shaped graph (two paths converging)', () => {
    const workflow = makeWorkflow([
      { fromNode: 'Start', fromPort: 'onSuccess', toNode: 'nodeA', toPort: 'execute' },
      { fromNode: 'nodeA', fromPort: 'onSuccess', toNode: 'nodeB', toPort: 'execute' },
      { fromNode: 'nodeA', fromPort: 'onSuccess', toNode: 'nodeC', toPort: 'execute' },
      { fromNode: 'nodeB', fromPort: 'onSuccess', toNode: 'nodeD', toPort: 'execute' },
      { fromNode: 'nodeC', fromPort: 'onSuccess', toNode: 'nodeD', toPort: 'execute' },
      { fromNode: 'nodeD', fromPort: 'onSuccess', toNode: 'Exit', toPort: 'onSuccess' },
    ]);
    const nodeTypes = makeNodeTypes(['nodeA', 'nodeB', 'nodeC', 'nodeD']);

    const order = determineExecutionOrder(workflow, nodeTypes);

    // nodeA must come first, nodeD must come last, B and C in between
    expect(order[0]).toBe('nodeA');
    expect(order[order.length - 1]).toBe('nodeD');
    expect(order).toContain('nodeB');
    expect(order).toContain('nodeC');
    expect(order.length).toBe(4);
  });

  it('excludes Exit node from the result', () => {
    const workflow = makeWorkflow([
      { fromNode: 'Start', fromPort: 'onSuccess', toNode: 'nodeA', toPort: 'execute' },
      { fromNode: 'nodeA', fromPort: 'onSuccess', toNode: 'Exit', toPort: 'onSuccess' },
    ]);
    const nodeTypes = makeNodeTypes(['nodeA']);

    const order = determineExecutionOrder(workflow, nodeTypes);

    expect(order).toEqual(['nodeA']);
    expect(order).not.toContain('Exit');
  });

  it('handles multiple start connections', () => {
    const workflow = makeWorkflow([
      { fromNode: 'Start', fromPort: 'onSuccess', toNode: 'nodeA', toPort: 'execute' },
      { fromNode: 'Start', fromPort: 'onSuccess', toNode: 'nodeB', toPort: 'execute' },
      { fromNode: 'nodeA', fromPort: 'onSuccess', toNode: 'Exit', toPort: 'onSuccess' },
      { fromNode: 'nodeB', fromPort: 'onSuccess', toNode: 'Exit', toPort: 'onSuccess' },
    ]);
    const nodeTypes = makeNodeTypes(['nodeA', 'nodeB']);

    const order = determineExecutionOrder(workflow, nodeTypes);

    expect(order).toContain('nodeA');
    expect(order).toContain('nodeB');
    expect(order.length).toBe(2);
  });

  it('handles single node workflow', () => {
    const workflow = makeWorkflow([
      { fromNode: 'Start', fromPort: 'num', toNode: 'proc', toPort: 'value' },
      { fromNode: 'proc', fromPort: 'result', toNode: 'Exit', toPort: 'result' },
    ]);
    const nodeTypes = makeNodeTypes(['proc']);

    const order = determineExecutionOrder(workflow, nodeTypes);
    expect(order).toEqual(['proc']);
  });

  it('does not visit the same node twice (dedup with visited set)', () => {
    // nodeA connects to nodeB twice via different ports
    const workflow = makeWorkflow([
      { fromNode: 'Start', fromPort: 'onSuccess', toNode: 'nodeA', toPort: 'execute' },
      { fromNode: 'nodeA', fromPort: 'result', toNode: 'nodeB', toPort: 'input1' },
      { fromNode: 'nodeA', fromPort: 'onSuccess', toNode: 'nodeB', toPort: 'execute' },
      { fromNode: 'nodeB', fromPort: 'onSuccess', toNode: 'Exit', toPort: 'onSuccess' },
    ]);
    const nodeTypes = makeNodeTypes(['nodeA', 'nodeB']);

    const order = determineExecutionOrder(workflow, nodeTypes);
    // nodeB should appear only once
    expect(order.filter((n) => n === 'nodeB').length).toBe(1);
    expect(order).toEqual(['nodeA', 'nodeB']);
  });
});
