/**
 * Tests for validator detection of instances referencing unknown node types.
 *
 * When a workflow instance references a nodeType that doesn't exist in the file,
 * the validator should report an error rather than silently skipping the instance.
 */

import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

describe('Validator Unknown Node Type', () => {
  const createNodeType = (
    name: string,
    inputs: Record<string, unknown> = {},
    outputs: Record<string, unknown> = {}
  ): TNodeTypeAST => ({
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
      ...inputs,
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP', failure: true },
      ...outputs,
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
  });

  const createWorkflow = (
    instances: TWorkflowAST['instances'],
    connections: TWorkflowAST['connections'] = [],
    nodeTypes: TNodeTypeAST[] = []
  ): TWorkflowAST => ({
    type: 'Workflow',
    functionName: 'testWorkflow',
    name: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes,
    instances,
    connections,
    scopes: {},
    startPorts: {},
    exitPorts: {},
    imports: [],
  });

  it('should report error when instance references a node type that does not exist', () => {
    const knownType = createNodeType('knownType', { value: { dataType: 'NUMBER' } });

    const workflow = createWorkflow(
      [
        { type: 'NodeInstance', id: 'good', nodeType: 'knownType', config: { x: 0, y: 0 } },
        { type: 'NodeInstance', id: 'bad', nodeType: 'consoleLog', config: { x: 100, y: 0 } },
      ],
      [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'good', port: 'execute' },
        },
      ],
      [knownType] // Only knownType is defined — consoleLog is missing
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(
      result.errors.some(
        (e) =>
          e.code === 'UNKNOWN_NODE_TYPE' &&
          e.message.includes('bad') &&
          e.message.includes('consoleLog')
      )
    ).toBe(true);
  });

  it('should NOT report error when all instances reference existing node types', () => {
    const typeA = createNodeType('typeA', { value: { dataType: 'NUMBER' } });
    const typeB = createNodeType('typeB', { value: { dataType: 'STRING' } });

    const workflow = createWorkflow(
      [
        { type: 'NodeInstance', id: 'a', nodeType: 'typeA', config: { x: 0, y: 0 } },
        { type: 'NodeInstance', id: 'b', nodeType: 'typeB', config: { x: 100, y: 0 } },
      ],
      [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'a', port: 'execute' },
        },
      ],
      [typeA, typeB]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    expect(result.errors.some((e) => e.code === 'UNKNOWN_NODE_TYPE')).toBe(false);
  });

  it('should report error for each instance with an unknown node type', () => {
    const workflow = createWorkflow(
      [
        { type: 'NodeInstance', id: 'a', nodeType: 'missingA', config: { x: 0, y: 0 } },
        { type: 'NodeInstance', id: 'b', nodeType: 'missingB', config: { x: 100, y: 0 } },
      ],
      [],
      [] // No node types defined at all
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unknownTypeErrors = result.errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownTypeErrors).toHaveLength(2);
    expect(
      unknownTypeErrors.some((e) => e.message.includes('a') && e.message.includes('missingA'))
    ).toBe(true);
    expect(
      unknownTypeErrors.some((e) => e.message.includes('b') && e.message.includes('missingB'))
    ).toBe(true);
  });
});
