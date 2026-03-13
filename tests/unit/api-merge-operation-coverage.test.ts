/**
 * Coverage tests for src/api/modify-operation.ts
 * Targets uncovered lines:
 *   188: autoConnect warning on addConnection
 *   195-196: autoConnect warning on removeConnection
 *   218: unknown operation default case
 */

import { applyModifyOperation } from '../../src/api/modify-operation';
import type { TWorkflowAST } from '../../src/ast/types';
import {
  createProcessorNodeType,
  createNodeInstance,
} from '../helpers/test-fixtures';

function makeWorkflowWithAutoConnect(): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'test',
    functionName: 'test',
    sourceFile: 'test.ts',
    nodeTypes: [createProcessorNodeType()],
    instances: [
      createNodeInstance('nodeA', 'process'),
      createNodeInstance('nodeB', 'process'),
    ],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'x' },
        to: { node: 'nodeA', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'nodeA', port: 'output' },
        to: { node: 'nodeB', port: 'input' },
      },
    ],
    scopes: {},
    startPorts: { x: { dataType: 'NUMBER' } },
    exitPorts: { result: { dataType: 'NUMBER' } },
    imports: [],
    options: { autoConnect: true },
  } as TWorkflowAST;
}

describe('applyModifyOperation - autoConnect warnings', () => {
  it('should warn and disable autoConnect when adding a connection', () => {
    const workflow = makeWorkflowWithAutoConnect();
    const { warnings, ast } = applyModifyOperation(workflow, 'addConnection', {
      from: 'nodeB.output',
      to: 'Exit.result',
    });
    expect(warnings).toContain(
      'autoConnect was disabled because connections were manually modified'
    );
    expect((ast as any).options?.autoConnect).toBeUndefined();
  });

  it('should warn and disable autoConnect when removing a connection', () => {
    const workflow = makeWorkflowWithAutoConnect();
    const { warnings, ast } = applyModifyOperation(workflow, 'removeConnection', {
      from: 'nodeA.output',
      to: 'nodeB.input',
    });
    expect(warnings).toContain(
      'autoConnect was disabled because connections were manually modified'
    );
    expect((ast as any).options?.autoConnect).toBeUndefined();
  });
});

describe('applyModifyOperation - unknown operation', () => {
  it('should throw for an unknown operation', () => {
    const workflow = makeWorkflowWithAutoConnect();
    expect(() =>
      applyModifyOperation(workflow, 'bogusOperation', {})
    ).toThrow('Unknown operation: bogusOperation');
  });
});
