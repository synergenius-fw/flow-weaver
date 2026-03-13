/**
 * Coverage for WorkflowDiffer.ts uncovered lines:
 * - Lines 288-289: instance UI changes detected and flagged
 * - Lines 422, 425: UI instance maps built from workflow.ui.instances
 */
import { describe, it, expect } from 'vitest';
import { WorkflowDiffer } from '../../src/diff/WorkflowDiffer.js';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types.js';

function createNodeType(name: string): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { execute: { dataType: 'STEP' } },
    outputs: { onSuccess: { dataType: 'STEP' } },
    hasSuccessPort: true,
    hasFailurePort: false,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
  };
}

function createInstance(id: string, nodeType: string): TNodeInstanceAST {
  return { type: 'NodeInstance', id, nodeType };
}

function createWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: 'test.ts',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes: [createNodeType('proc')],
    instances: [createInstance('node1', 'proc')],
    connections: [],
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: { onSuccess: { dataType: 'STEP' } },
    imports: [],
    ...overrides,
  };
}

describe('WorkflowDiffer UI instance comparison (lines 288-289, 422, 425)', () => {
  it('detects UI changes when instance position changes', () => {
    const before = createWorkflow({
      ui: {
        instances: [
          { name: 'node1', x: 0, y: 0 },
        ],
      },
    });

    const after = createWorkflow({
      ui: {
        instances: [
          { name: 'node1', x: 100, y: 200 },
        ],
      },
    });

    const diff = WorkflowDiffer.compare(before, after);
    // Should detect UI modification
    expect(diff.identical).toBe(false);
    expect(diff.summary.instancesUIModified).toBe(1);

    const modifiedInst = diff.instances.find(i => i.id === 'node1');
    expect(modifiedInst).toBeDefined();
    expect(modifiedInst!.changes.ui).toBeDefined();
    expect(modifiedInst!.changes.ui!.position).toBeDefined();
  });

  it('detects UI label change', () => {
    const before = createWorkflow({
      ui: {
        instances: [
          { name: 'node1', x: 0, y: 0, label: 'Old Label' },
        ],
      },
    });

    const after = createWorkflow({
      ui: {
        instances: [
          { name: 'node1', x: 0, y: 0, label: 'New Label' },
        ],
      },
    });

    const diff = WorkflowDiffer.compare(before, after);
    expect(diff.identical).toBe(false);
    const inst = diff.instances.find(i => i.id === 'node1');
    expect(inst?.changes.ui?.label).toBeDefined();
  });

  it('handles workflows with no UI data (lines 422, 425 with nullish coalescing)', () => {
    // Both workflows have no ui property at all
    const before = createWorkflow();
    const after = createWorkflow();

    const diff = WorkflowDiffer.compare(before, after);
    expect(diff.identical).toBe(true);
  });

  it('handles one workflow with UI data and one without', () => {
    const before = createWorkflow();
    const after = createWorkflow({
      ui: {
        instances: [
          { name: 'node1', x: 50, y: 50 },
        ],
      },
    });

    const diff = WorkflowDiffer.compare(before, after);
    // UI change from undefined to defined position
    expect(diff.identical).toBe(false);
  });

  it('detects no changes when UI data is identical', () => {
    const ui = {
      instances: [
        { name: 'node1', x: 10, y: 20 },
      ],
    };
    const before = createWorkflow({ ui });
    const after = createWorkflow({ ui });

    const diff = WorkflowDiffer.compare(before, after);
    expect(diff.identical).toBe(true);
  });
});
