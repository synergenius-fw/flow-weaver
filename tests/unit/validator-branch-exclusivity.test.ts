/**
 * Tests for suppressing MULTIPLE_EXIT_CONNECTIONS when connections come from
 * mutually exclusive branches (onSuccess vs onFailure paths).
 */

import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

describe('Validator Branch Exclusivity', () => {
  const createBranchingNodeType = (name: string): TNodeTypeAST => ({
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP', failure: true },
      result: { dataType: 'ANY' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
  });

  const createSimpleNodeType = (name: string): TNodeTypeAST => ({
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      result: { dataType: 'ANY' },
    },
    hasSuccessPort: true,
    hasFailurePort: false,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
  });

  const createWorkflow = (
    instances: TWorkflowAST['instances'],
    connections: TWorkflowAST['connections'],
    nodeTypes: TNodeTypeAST[]
  ): TWorkflowAST => ({
    type: 'Workflow',
    functionName: 'testWorkflow',
    name: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes,
    instances,
    connections,
    scopes: {},
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: {
      onSuccess: { dataType: 'STEP' },
      result: { dataType: 'ANY' },
    },
    imports: [],
  });

  it('should not warn when Exit port has connections from mutually exclusive branches', () => {
    // brancher -> onSuccess -> successHandler -> Exit.result
    // brancher -> onFailure -> failureHandler -> Exit.result
    const brancher = createBranchingNodeType('brancher');
    const successHandler = createSimpleNodeType('successHandler');
    const failureHandler = createSimpleNodeType('failureHandler');

    const workflow = createWorkflow(
      [
        { type: 'NodeInstance', id: 'branch', nodeType: 'brancher', config: { x: 0, y: 0 } },
        { type: 'NodeInstance', id: 'onOk', nodeType: 'successHandler', config: { x: 200, y: 0 } },
        { type: 'NodeInstance', id: 'onFail', nodeType: 'failureHandler', config: { x: 200, y: 100 } },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'branch', port: 'execute' } },
        { type: 'Connection', from: { node: 'branch', port: 'onSuccess' }, to: { node: 'onOk', port: 'execute' } },
        { type: 'Connection', from: { node: 'branch', port: 'onFailure' }, to: { node: 'onFail', port: 'execute' } },
        { type: 'Connection', from: { node: 'onOk', port: 'result' }, to: { node: 'Exit', port: 'result' } },
        { type: 'Connection', from: { node: 'onFail', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      [brancher, successHandler, failureHandler]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const multiExitWarning = result.warnings.find(
      (w) => w.code === 'MULTIPLE_EXIT_CONNECTIONS' && w.message.includes('result')
    );
    expect(multiExitWarning).toBeUndefined();
  });

  it('should still warn when Exit port has connections from non-exclusive sources', () => {
    // Both nodeA and nodeB are on the SUCCESS branch of brancher -> both connect to Exit.result
    const brancher = createBranchingNodeType('brancher');
    const handlerA = createSimpleNodeType('handlerA');
    const handlerB = createSimpleNodeType('handlerB');

    const workflow = createWorkflow(
      [
        { type: 'NodeInstance', id: 'branch', nodeType: 'brancher', config: { x: 0, y: 0 } },
        { type: 'NodeInstance', id: 'nodeA', nodeType: 'handlerA', config: { x: 200, y: 0 } },
        { type: 'NodeInstance', id: 'nodeB', nodeType: 'handlerB', config: { x: 200, y: 100 } },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'branch', port: 'execute' } },
        { type: 'Connection', from: { node: 'branch', port: 'onSuccess' }, to: { node: 'nodeA', port: 'execute' } },
        { type: 'Connection', from: { node: 'branch', port: 'onSuccess' }, to: { node: 'nodeB', port: 'execute' } },
        { type: 'Connection', from: { node: 'nodeA', port: 'result' }, to: { node: 'Exit', port: 'result' } },
        { type: 'Connection', from: { node: 'nodeB', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      [brancher, handlerA, handlerB]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const multiExitWarning = result.warnings.find(
      (w) => w.code === 'MULTIPLE_EXIT_CONNECTIONS' && w.message.includes('result')
    );
    expect(multiExitWarning).toBeDefined();
  });

  it('should still warn when Exit port has connections from unrelated nodes', () => {
    // Two disconnected nodes both connect to Exit.result
    const handlerA = createSimpleNodeType('handlerA');
    const handlerB = createSimpleNodeType('handlerB');

    const workflow = createWorkflow(
      [
        { type: 'NodeInstance', id: 'nodeA', nodeType: 'handlerA', config: { x: 0, y: 0 } },
        { type: 'NodeInstance', id: 'nodeB', nodeType: 'handlerB', config: { x: 200, y: 0 } },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'nodeA', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'nodeB', port: 'execute' } },
        { type: 'Connection', from: { node: 'nodeA', port: 'result' }, to: { node: 'Exit', port: 'result' } },
        { type: 'Connection', from: { node: 'nodeB', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      [handlerA, handlerB]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const multiExitWarning = result.warnings.find(
      (w) => w.code === 'MULTIPLE_EXIT_CONNECTIONS' && w.message.includes('result')
    );
    expect(multiExitWarning).toBeDefined();
  });
});
