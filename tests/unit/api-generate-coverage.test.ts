/**
 * Coverage tests for src/api/generate.ts
 * Targets lines 503-505 (missing workflow dep warning) and 679-688
 * (recursive local workflow dependency generation in generateWorkflowFunction).
 */

import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

function makeNodeType(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
    functionText: `function ${name}(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }`,
    ...overrides,
  };
}

describe('generate.ts coverage', () => {
  it('emits WARNING comment when local workflow dep AST is not found in allWorkflows', () => {
    // A node with variant IMPORTED_WORKFLOW from the same sourceFile
    // but no matching workflow in allWorkflows
    const localWorkflowNode = makeNodeType('subWorkflow', {
      variant: 'IMPORTED_WORKFLOW',
      sourceLocation: { file: 'main.ts', line: 1, column: 0 },
    });

    const mainWorkflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'mainWorkflow',
      functionName: 'mainWorkflow',
      sourceFile: 'main.ts',
      nodeTypes: [localWorkflowNode],
      instances: [
        { type: 'NodeInstance', id: 'sub', nodeType: 'subWorkflow' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'sub', port: 'execute' } },
        { type: 'Connection', from: { node: 'sub', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    // Pass allWorkflows with only the main workflow (missing subWorkflow)
    const code = generateCode(mainWorkflow, {
      production: true,
      allWorkflows: [mainWorkflow],
    });

    expect(code).toContain('// WARNING: Could not find workflow AST for subWorkflow');
  });

  it('generates recursive local workflow dependencies in generateWorkflowFunction', () => {
    // mainWorkflow uses subA as a node type. subA uses subB as a node type.
    // Both subA and subB are IMPORTED_WORKFLOW from the same file.
    const subBNode = makeNodeType('subB', {
      variant: 'IMPORTED_WORKFLOW',
      sourceLocation: { file: 'main.ts', line: 1, column: 0 },
    });

    const subANode = makeNodeType('subA', {
      variant: 'IMPORTED_WORKFLOW',
      sourceLocation: { file: 'main.ts', line: 10, column: 0 },
    });

    const subBWorkflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'subB',
      functionName: 'subB',
      sourceFile: 'main.ts',
      nodeTypes: [makeNodeType('helperNode')],
      instances: [
        { type: 'NodeInstance', id: 'helper', nodeType: 'helperNode' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'helper', port: 'execute' } },
        { type: 'Connection', from: { node: 'helper', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    const subAWorkflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'subA',
      functionName: 'subA',
      sourceFile: 'main.ts',
      nodeTypes: [subBNode],
      instances: [
        { type: 'NodeInstance', id: 'bInst', nodeType: 'subB' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'bInst', port: 'execute' } },
        { type: 'Connection', from: { node: 'bInst', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    const mainWorkflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'mainWorkflow',
      functionName: 'mainWorkflow',
      sourceFile: 'main.ts',
      nodeTypes: [subANode],
      instances: [
        { type: 'NodeInstance', id: 'aInst', nodeType: 'subA' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'aInst', port: 'execute' } },
        { type: 'Connection', from: { node: 'aInst', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      imports: [],
    };

    // Provide all workflows so recursive resolution works
    const code = generateCode(mainWorkflow, {
      production: true,
      allWorkflows: [mainWorkflow, subAWorkflow, subBWorkflow],
    });

    // Both sub-workflows should be generated as local dependencies
    expect(code).toContain('function subA(');
    expect(code).toContain('function subB(');
    // And the main workflow should also be there
    expect(code).toContain('function mainWorkflow(');
  });
});
