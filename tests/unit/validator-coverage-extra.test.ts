/**
 * Coverage tests for src/validator.ts (lines 1670-1672, 1700)
 * Targets: INVALID_ICON warning for instances with invalid icon config,
 * and INVALID_PORT_TYPE warning for output ports with unrecognized types.
 */

import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';

function makeBaseWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  const defaultNodeType: TNodeTypeAST = {
    type: 'NodeType',
    functionName: 'proc',
    name: 'proc',
    inputs: {
      execute: { name: 'execute', dataType: 'STEP', isControlFlow: true },
    },
    outputs: {
      onSuccess: { name: 'onSuccess', dataType: 'STEP', isControlFlow: true },
      onFailure: { name: 'onFailure', dataType: 'STEP', isControlFlow: true },
    },
  };

  const defaultInstance: TNodeInstanceAST = {
    type: 'NodeInstance',
    id: 'p',
    nodeType: 'proc',
  };

  return {
    type: 'Workflow',
    functionName: 'testWf',
    name: 'testWf',
    sourceFile: 'test.ts',
    nodeTypes: [defaultNodeType],
    instances: [defaultInstance],
    connections: [
      { from: { node: 'Start', port: 'execute' }, to: { node: 'p', port: 'execute' } },
      { from: { node: 'p', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
    ],
    scopes: {},
    startPorts: { execute: { name: 'execute', dataType: 'STEP', isControlFlow: true } },
    exitPorts: {
      onSuccess: { name: 'onSuccess', dataType: 'STEP', isControlFlow: true },
      onFailure: { name: 'onFailure', dataType: 'STEP', isControlFlow: true },
    },
    imports: [],
    ...overrides,
  };
}

describe('validator INVALID_ICON warning coverage', () => {
  it('should warn when an instance has an invalid icon', async () => {
    const { validator } = await import('../../src/validator');

    const ast = makeBaseWorkflow({
      instances: [
        {
          type: 'NodeInstance',
          id: 'p',
          nodeType: 'proc',
          config: { icon: 'nonexistent-icon-xyz' },
        },
      ],
    });

    const result = validator.validate(ast);
    const iconWarning = result.warnings.find((w) => w.code === 'INVALID_ICON');
    expect(iconWarning).toBeDefined();
    expect(iconWarning!.message).toContain('nonexistent-icon-xyz');
  });
});

describe('validator INVALID_PORT_TYPE warning on output ports coverage', () => {
  it('should warn when an output port has an invalid data type', async () => {
    const { validator } = await import('../../src/validator');

    const ast = makeBaseWorkflow({
      nodeTypes: [
        {
          type: 'NodeType',
          functionName: 'proc',
          name: 'proc',
          inputs: {
            execute: { name: 'execute', dataType: 'STEP', isControlFlow: true },
          },
          outputs: {
            onSuccess: { name: 'onSuccess', dataType: 'STEP', isControlFlow: true },
            onFailure: { name: 'onFailure', dataType: 'STEP', isControlFlow: true },
            badOut: { name: 'badOut', dataType: 'INVALID_TYPE' as any },
          },
        },
      ],
    });

    const result = validator.validate(ast);
    const typeWarning = result.warnings.find(
      (w) => w.code === 'INVALID_PORT_TYPE' && w.message.includes('badOut')
    );
    expect(typeWarning).toBeDefined();
    expect(typeWarning!.message).toContain('INVALID_TYPE');
  });

  it('should warn when an input port has an invalid data type', async () => {
    const { validator } = await import('../../src/validator');

    const ast = makeBaseWorkflow({
      nodeTypes: [
        {
          type: 'NodeType',
          functionName: 'proc',
          name: 'proc',
          inputs: {
            execute: { name: 'execute', dataType: 'STEP', isControlFlow: true },
            badIn: { name: 'badIn', dataType: 'FAKE_TYPE' as any },
          },
          outputs: {
            onSuccess: { name: 'onSuccess', dataType: 'STEP', isControlFlow: true },
            onFailure: { name: 'onFailure', dataType: 'STEP', isControlFlow: true },
          },
        },
      ],
    });

    const result = validator.validate(ast);
    const typeWarning = result.warnings.find(
      (w) => w.code === 'INVALID_PORT_TYPE' && w.message.includes('badIn')
    );
    expect(typeWarning).toBeDefined();
    expect(typeWarning!.message).toContain('FAKE_TYPE');
  });

  it('should not warn for valid port types', async () => {
    const { validator } = await import('../../src/validator');

    const ast = makeBaseWorkflow({
      nodeTypes: [
        {
          type: 'NodeType',
          functionName: 'proc',
          name: 'proc',
          inputs: {
            execute: { name: 'execute', dataType: 'STEP', isControlFlow: true },
            data: { name: 'data', dataType: 'STRING' },
          },
          outputs: {
            onSuccess: { name: 'onSuccess', dataType: 'STEP', isControlFlow: true },
            onFailure: { name: 'onFailure', dataType: 'STEP', isControlFlow: true },
            result: { name: 'result', dataType: 'NUMBER' },
          },
        },
      ],
    });

    const result = validator.validate(ast);
    const typeWarnings = result.warnings.filter((w) => w.code === 'INVALID_PORT_TYPE');
    expect(typeWarnings).toHaveLength(0);
  });
});
