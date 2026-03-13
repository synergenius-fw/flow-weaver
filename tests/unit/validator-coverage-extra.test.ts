/**
 * Extra coverage for validator.ts: invalid icon warnings and output port type validation.
 * Targets uncovered lines ~1670-1672 (invalid icon) and ~1700 (invalid output port type).
 */
import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST } from '../../src/ast/types';

function makeMinimalAST(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    functionName: 'testWorkflow',
    nodeTypes: [],
    instances: [
      { type: 'NodeInstance', id: 'Start', nodeType: 'Start' },
      { type: 'NodeInstance', id: 'Exit', nodeType: 'Exit' },
    ],
    connections: [],
    macros: [],
    ...overrides,
  } as TWorkflowAST;
}

describe('WorkflowValidator: invalid icon warning', () => {
  it('should warn when an instance has an invalid icon', () => {
    const ast = makeMinimalAST({
      instances: [
        { type: 'NodeInstance', id: 'Start', nodeType: 'Start' },
        { type: 'NodeInstance', id: 'Exit', nodeType: 'Exit' },
        {
          type: 'NodeInstance',
          id: 'myNode',
          nodeType: 'MyType',
          config: { icon: 'totally_bogus_icon_xyz' },
        },
      ],
      nodeTypes: [
        {
          type: 'NodeType',
          functionName: 'MyType',
          inputs: { execute: { dataType: 'STEP', isControlFlow: true } },
          outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
        },
      ] as TWorkflowAST['nodeTypes'],
    });

    const v = new WorkflowValidator();
    const result = v.validate(ast);
    const iconWarning = result.warnings.find((w) => w.code === 'INVALID_ICON');
    expect(iconWarning).toBeDefined();
    expect(iconWarning!.message).toContain('totally_bogus_icon_xyz');
    expect(iconWarning!.node).toBe('myNode');
  });
});

describe('WorkflowValidator: invalid output port type warning', () => {
  it('should warn when an output port has an unrecognized dataType', () => {
    const ast = makeMinimalAST({
      instances: [
        { type: 'NodeInstance', id: 'Start', nodeType: 'Start' },
        { type: 'NodeInstance', id: 'Exit', nodeType: 'Exit' },
        { type: 'NodeInstance', id: 'n1', nodeType: 'BadOutput' },
      ],
      nodeTypes: [
        {
          type: 'NodeType',
          functionName: 'BadOutput',
          inputs: { execute: { dataType: 'STEP', isControlFlow: true } },
          outputs: {
            onSuccess: { dataType: 'STEP', isControlFlow: true },
            data: { dataType: 'INVALID_TYPE_XYZ' as any },
          },
        },
      ] as TWorkflowAST['nodeTypes'],
    });

    const v = new WorkflowValidator();
    const result = v.validate(ast);
    const portWarning = result.warnings.find(
      (w) => w.code === 'INVALID_PORT_TYPE' && w.message.includes('data')
    );
    expect(portWarning).toBeDefined();
    expect(portWarning!.message).toContain('INVALID_TYPE_XYZ');
    expect(portWarning!.message).toContain('BadOutput');
  });
});
