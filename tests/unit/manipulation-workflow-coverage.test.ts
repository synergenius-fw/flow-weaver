/**
 * Coverage tests for src/api/manipulation/workflow.ts
 * Targets uncovered lines 119-151: renameWorkflow and setWorkflowPorts
 */

import {
  renameWorkflow,
  setWorkflowPorts,
} from '../../src/api/manipulation/workflow';
import type { TWorkflowAST, TNodeTypePort } from '../../src/ast/types';
import { createSimpleWorkflow } from '../helpers/test-fixtures';

describe('renameWorkflow', () => {
  it('should rename the workflow functionName', () => {
    const workflow = createSimpleWorkflow();
    const result = renameWorkflow(workflow, 'newName');

    expect(result.functionName).toBe('newName');
  });

  it('should accept names starting with underscore', () => {
    const workflow = createSimpleWorkflow();
    const result = renameWorkflow(workflow, '_private');
    expect(result.functionName).toBe('_private');
  });

  it('should accept names starting with $', () => {
    const workflow = createSimpleWorkflow();
    const result = renameWorkflow(workflow, '$special');
    expect(result.functionName).toBe('$special');
  });

  it('should accept names with digits after the first character', () => {
    const workflow = createSimpleWorkflow();
    const result = renameWorkflow(workflow, 'myWorkflow2');
    expect(result.functionName).toBe('myWorkflow2');
  });

  it('should throw for empty name', () => {
    const workflow = createSimpleWorkflow();
    expect(() => renameWorkflow(workflow, '')).toThrow('Invalid workflow name');
  });

  it('should throw for name starting with a digit', () => {
    const workflow = createSimpleWorkflow();
    expect(() => renameWorkflow(workflow, '1bad')).toThrow('Invalid workflow name: 1bad');
  });

  it('should throw for name with spaces', () => {
    const workflow = createSimpleWorkflow();
    expect(() => renameWorkflow(workflow, 'has space')).toThrow('Invalid workflow name');
  });

  it('should throw for name with hyphens', () => {
    const workflow = createSimpleWorkflow();
    expect(() => renameWorkflow(workflow, 'my-workflow')).toThrow('Invalid workflow name');
  });

  it('should throw for name with special characters', () => {
    const workflow = createSimpleWorkflow();
    expect(() => renameWorkflow(workflow, 'name@bad')).toThrow('Invalid workflow name');
  });

  it('should not modify the original workflow', () => {
    const workflow = createSimpleWorkflow();
    const originalName = workflow.functionName;

    renameWorkflow(workflow, 'changed');

    expect(workflow.functionName).toBe(originalName);
  });

  it('should preserve other workflow properties', () => {
    const workflow = createSimpleWorkflow();
    const result = renameWorkflow(workflow, 'renamed');

    expect(result.sourceFile).toBe(workflow.sourceFile);
    expect(result.nodeTypes).toEqual(workflow.nodeTypes);
    expect(result.instances).toEqual(workflow.instances);
    expect(result.connections).toEqual(workflow.connections);
  });
});

describe('setWorkflowPorts', () => {
  it('should set ports on a workflow', () => {
    const workflow = createSimpleWorkflow();
    const ports: TNodeTypePort[] = [
      { name: 'input', direction: 'INPUT', dataType: 'STRING' },
      { name: 'output', direction: 'OUTPUT', dataType: 'NUMBER' },
    ];

    const result = setWorkflowPorts(workflow, ports);

    expect(result.ports).toHaveLength(2);
    expect(result.ports![0].name).toBe('input');
    expect(result.ports![0].direction).toBe('INPUT');
    expect(result.ports![1].name).toBe('output');
    expect(result.ports![1].direction).toBe('OUTPUT');
  });

  it('should replace existing ports', () => {
    const workflow = createSimpleWorkflow();
    (workflow as any).ports = [
      { name: 'old', direction: 'INPUT', dataType: 'NUMBER' },
    ];

    const newPorts: TNodeTypePort[] = [
      { name: 'fresh', direction: 'OUTPUT', dataType: 'BOOLEAN' },
    ];

    const result = setWorkflowPorts(workflow, newPorts);

    expect(result.ports).toHaveLength(1);
    expect(result.ports![0].name).toBe('fresh');
  });

  it('should allow setting an empty ports array', () => {
    const workflow = createSimpleWorkflow();
    const result = setWorkflowPorts(workflow, []);
    expect(result.ports).toEqual([]);
  });

  it('should not modify the original workflow', () => {
    const workflow = createSimpleWorkflow();
    const ports: TNodeTypePort[] = [
      { name: 'x', direction: 'INPUT', dataType: 'NUMBER' },
    ];

    setWorkflowPorts(workflow, ports);

    expect(workflow.ports).toBeUndefined();
  });

  it('should preserve other workflow properties', () => {
    const workflow = createSimpleWorkflow();
    const ports: TNodeTypePort[] = [
      { name: 'x', direction: 'INPUT' },
    ];

    const result = setWorkflowPorts(workflow, ports);

    expect(result.functionName).toBe(workflow.functionName);
    expect(result.nodeTypes).toEqual(workflow.nodeTypes);
    expect(result.instances).toEqual(workflow.instances);
  });
});
