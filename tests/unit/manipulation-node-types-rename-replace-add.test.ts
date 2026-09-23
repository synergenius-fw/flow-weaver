/**
 * Coverage tests for src/api/manipulation/node-types.ts
 * Targets uncovered lines 204-253: renameNodeType and replaceNodeTypes
 */

import {
  addNodeType,
  renameNodeType,
  replaceNodeTypes,
} from '../../src/api/manipulation/node-types';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';
import {
  createSimpleWorkflow,
  createProcessorNodeType,
  createTransformerNodeType,
  createNodeInstance,
} from '../helpers/test-fixtures';

function makeNodeType(name: string, functionName?: string): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: functionName ?? name,
    inputs: { input: { dataType: 'NUMBER', optional: true } },
    outputs: { output: { dataType: 'NUMBER' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };
}

describe('renameNodeType', () => {
  it('should rename a node type and update referencing instances', () => {
    const workflow = createSimpleWorkflow();
    // The default workflow has a node type named "processor" with functionName "process"
    // and an instance "node1" with nodeType "process"
    const result = renameNodeType(workflow, 'processor', 'renamedProcessor');

    // Node type name should be updated
    const renamed = result.nodeTypes.find(nt => nt.name === 'renamedProcessor');
    expect(renamed).toBeDefined();
    expect(result.nodeTypes.find(nt => nt.name === 'processor')).toBeUndefined();

    // Instances referencing the old name via nodeType should be updated
    // The instance uses functionName ("process"), and renameNodeType updates instances
    // where instance.nodeType === oldTypeName
    // Since oldTypeName is "processor" and instance.nodeType is "process", no instance update happens here
    // Let's build a case where instance.nodeType matches oldTypeName
  });

  it('should update instances that reference the old type name', () => {
    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('myType')],
      instances: [
        { type: 'NodeInstance', id: 'inst1', nodeType: 'myType' },
        { type: 'NodeInstance', id: 'inst2', nodeType: 'myType' },
        { type: 'NodeInstance', id: 'inst3', nodeType: 'otherType' },
      ],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
    };

    const result = renameNodeType(workflow, 'myType', 'newName');

    expect(result.nodeTypes[0].name).toBe('newName');
    expect(result.instances[0].nodeType).toBe('newName');
    expect(result.instances[1].nodeType).toBe('newName');
    // Instance with a different type should be unchanged
    expect(result.instances[2].nodeType).toBe('otherType');
  });

  it('should throw if the new name already exists', () => {
    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('typeA'), makeNodeType('typeB')],
      instances: [],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
    };

    expect(() => renameNodeType(workflow, 'typeA', 'typeB')).toThrow(
      'Node type "typeB" already exists',
    );
  });

  it('should handle renaming when node type is not in nodeTypes array', () => {
    // Edge case: the old name doesn't exist in nodeTypes (nodeTypeIndex < 0)
    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('onlyType')],
      instances: [{ type: 'NodeInstance', id: 'inst1', nodeType: 'ghost' }],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
    };

    // "ghost" isn't a node type name, so nodeTypeIndex will be -1
    // but it should still try to update instances
    const result = renameNodeType(workflow, 'ghost', 'renamed');
    expect(result.instances[0].nodeType).toBe('renamed');
    // The existing node type should remain
    expect(result.nodeTypes[0].name).toBe('onlyType');
  });

  it('should not modify the original workflow', () => {
    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('original')],
      instances: [{ type: 'NodeInstance', id: 'inst1', nodeType: 'original' }],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
    };

    const result = renameNodeType(workflow, 'original', 'changed');
    expect(workflow.nodeTypes[0].name).toBe('original');
    expect(result.nodeTypes[0].name).toBe('changed');
  });
});

describe('replaceNodeTypes', () => {
  it('should replace all node types with the given array', () => {
    const workflow = createSimpleWorkflow();
    const newTypes = [makeNodeType('alpha'), makeNodeType('beta')];

    const result = replaceNodeTypes(workflow, newTypes);

    expect(result.nodeTypes).toHaveLength(2);
    expect(result.nodeTypes[0].name).toBe('alpha');
    expect(result.nodeTypes[1].name).toBe('beta');
  });

  it('should allow replacing with an empty array', () => {
    const workflow = createSimpleWorkflow();
    const result = replaceNodeTypes(workflow, []);
    expect(result.nodeTypes).toHaveLength(0);
  });

  it('should not modify the original workflow', () => {
    const workflow = createSimpleWorkflow();
    const originalLength = workflow.nodeTypes.length;

    replaceNodeTypes(workflow, []);

    expect(workflow.nodeTypes).toHaveLength(originalLength);
  });

  it('should preserve other workflow properties', () => {
    const workflow = createSimpleWorkflow();
    const newTypes = [makeNodeType('newType')];

    const result = replaceNodeTypes(workflow, newTypes);

    expect(result.instances).toEqual(workflow.instances);
    expect(result.connections).toEqual(workflow.connections);
    expect(result.functionName).toBe(workflow.functionName);
  });
});

describe('addNodeType - importSource update path', () => {
  it('should update importSource on existing type when new type has it but existing does not', () => {
    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('myType')],
      instances: [],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
    };

    const newType = { ...makeNodeType('myType'), importSource: '@pkg/module' } as TNodeTypeAST;
    const result = addNodeType(workflow, newType);

    expect((result.nodeTypes[0] as any).importSource).toBe('@pkg/module');
  });

  it('should return unchanged if existing type already has importSource', () => {
    const existingType = { ...makeNodeType('myType'), importSource: '@old/pkg' } as TNodeTypeAST;
    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [existingType],
      instances: [],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
    };

    const newType = { ...makeNodeType('myType'), importSource: '@new/pkg' } as TNodeTypeAST;
    const result = addNodeType(workflow, newType);

    // Should return same reference (unchanged)
    expect(result).toBe(workflow);
  });

  it('should return unchanged if neither has importSource (idempotent)', () => {
    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [makeNodeType('myType')],
      instances: [],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
    };

    const result = addNodeType(workflow, makeNodeType('myType'));
    expect(result).toBe(workflow);
  });
});
