import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { addNodeType } from '../../src/api/manipulation/node-types';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

const MOCK_FILE = path.join(os.tmpdir(), 'test.ts');

function makeEmptyWorkflow(): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: MOCK_FILE,
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
    imports: [],
  };
}

function makeNpmNodeType(): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: 'npm/autoprefixer/autoprefixer',
    functionName: 'autoprefixer',
    importSource: 'autoprefixer',
    inputs: { execute: { dataType: 'STEP' } },
    outputs: { result: { dataType: 'ANY' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };
}

describe('addNodeType preserves importSource', () => {
  it('should preserve importSource when adding new npm node type', () => {
    const workflow = makeEmptyWorkflow();
    const npmNodeType = makeNpmNodeType();

    // Verify input has importSource
    expect(npmNodeType.importSource).toBe('autoprefixer');

    const result = addNodeType(workflow, npmNodeType);

    // Find the added node type
    const addedType = result.nodeTypes.find(nt => nt.name === 'npm/autoprefixer/autoprefixer');

    // Verify importSource is preserved
    expect(addedType).toBeDefined();
    expect(addedType?.importSource).toBe('autoprefixer');
  });

  it('idempotent check with existing type WITHOUT importSource should update it', () => {
    // Workflow already has the npm type BUT without importSource (from file parsing)
    const existingTypeWithoutImportSource: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'autoprefixer',
      // NO importSource - simulating what happens after parsing file without @import
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const workflow: TWorkflowAST = {
      ...makeEmptyWorkflow(),
      nodeTypes: [existingTypeWithoutImportSource],
    };

    // Now add the SAME type but WITH importSource
    const npmNodeTypeWithImportSource = makeNpmNodeType();
    expect(npmNodeTypeWithImportSource.importSource).toBe('autoprefixer');

    const result = addNodeType(workflow, npmNodeTypeWithImportSource);

    // The idempotent check should either:
    // 1. Update the existing type with the new importSource, OR
    // 2. At minimum, the result should have importSource
    const addedType = result.nodeTypes.find(nt => nt.name === 'npm/autoprefixer/autoprefixer');

    // The idempotent check should update the existing type with the new importSource
    expect(addedType?.importSource).toBe('autoprefixer');
  });

  it('idempotent: should return unchanged when both types have importSource', () => {
    const existingTypeWithImportSource = makeNpmNodeType();
    const workflow: TWorkflowAST = {
      ...makeEmptyWorkflow(),
      nodeTypes: [existingTypeWithImportSource],
    };

    // Add the same type again
    const sameType = makeNpmNodeType();
    const result = addNodeType(workflow, sameType);

    // Should return unchanged (same reference)
    expect(result).toBe(workflow);
    expect(result.nodeTypes.length).toBe(1);
    expect(result.nodeTypes[0].importSource).toBe('autoprefixer');
  });

  it('idempotent: should return unchanged when both types have NO importSource', () => {
    const existingTypeWithoutImportSource: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'autoprefixer',
      // NO importSource
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const workflow: TWorkflowAST = {
      ...makeEmptyWorkflow(),
      nodeTypes: [existingTypeWithoutImportSource],
    };

    // Add the same type without importSource
    const sameTypeWithoutImportSource: TNodeTypeAST = {
      ...existingTypeWithoutImportSource,
    };
    const result = addNodeType(workflow, sameTypeWithoutImportSource);

    // Should return unchanged (same reference)
    expect(result).toBe(workflow);
    expect(result.nodeTypes.length).toBe(1);
  });
});
