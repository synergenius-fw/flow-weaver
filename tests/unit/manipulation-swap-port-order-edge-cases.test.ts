/**
 * Coverage tests for src/api/manipulation/ports.ts
 * Targets uncovered lines:
 *   28-29: getImplicitOrder helper
 *   63: Start ports not found
 *   80: Exit ports not found
 *   130: Node type not found for instance
 */

import {
  swapPortOrder,
  swapNodeInstancePortOrder,
} from '../../src/api/manipulation/ports';
import type { TWorkflowAST } from '../../src/ast/types';
import {
  createProcessorNodeType,
  createNodeInstance,
} from '../helpers/test-fixtures';

function makeWorkflow(overrides?: Partial<TWorkflowAST>): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'test',
    functionName: 'test',
    sourceFile: 'test.ts',
    nodeTypes: [createProcessorNodeType()],
    instances: [createNodeInstance('node1', 'process')],
    connections: [],
    scopes: {},
    startPorts: {
      portA: { dataType: 'NUMBER' },
      portB: { dataType: 'STRING' },
    },
    exitPorts: {
      outA: { dataType: 'NUMBER' },
      outB: { dataType: 'STRING' },
    },
    imports: [],
    ...overrides,
  };
}

describe('swapPortOrder - Start/Exit edge cases', () => {
  it('should throw when Start ports are missing', () => {
    const workflow = makeWorkflow({ startPorts: undefined });
    expect(() => swapPortOrder(workflow, 'Start', 'portA', 'portB')).toThrow(
      'Start ports not found'
    );
  });

  it('should throw when Exit ports are missing', () => {
    const workflow = makeWorkflow({ exitPorts: undefined });
    expect(() => swapPortOrder(workflow, 'Exit', 'outA', 'outB')).toThrow(
      'Exit ports not found'
    );
  });

  it('should use implicit order when metadata.order is not set', () => {
    const workflow = makeWorkflow();
    const result = swapPortOrder(workflow, 'Start', 'portA', 'portB');
    // portA was at implicit index 0, portB at index 1. After swap they should be flipped.
    const startPorts = result.startPorts as Record<string, { metadata?: { order?: number } }>;
    expect(startPorts.portA.metadata?.order).toBe(1);
    expect(startPorts.portB.metadata?.order).toBe(0);
  });
});

describe('swapNodeInstancePortOrder - node type not found', () => {
  it('should throw when the node type for an instance cannot be found', () => {
    const workflow = makeWorkflow({
      instances: [createNodeInstance('node1', 'unknownType')],
    });
    expect(() =>
      swapNodeInstancePortOrder(workflow, 'node1', 'input', 'output')
    ).toThrow('Node type "unknownType" not found');
  });
});
