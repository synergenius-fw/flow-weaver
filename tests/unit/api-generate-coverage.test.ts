/**
 * Coverage for api/generate.ts:
 * - Missing workflow AST warning for local workflow node (lines 503-505)
 * - generateWorkflowFunction producing inline code for local deps (lines 679-688)
 */
import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

function makeNodeType(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { value: { dataType: 'NUMBER', optional: true } },
    outputs: { result: { dataType: 'NUMBER' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    ...overrides,
  };
}

function makeWorkflowAST(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'mainFlow',
    functionName: 'mainFlow',
    sourceFile: 'test.ts',
    nodeTypes: [],
    instances: [],
    connections: [],
    scopes: {},
    startPorts: { input: { dataType: 'NUMBER' } },
    exitPorts: { result: { dataType: 'NUMBER' } },
    imports: [],
    ...overrides,
  };
}

describe('generateCode: missing local workflow AST warning', () => {
  it('emits a WARNING comment when a local workflow node has no matching AST in allWorkflows', () => {
    // Create a workflow that references a local workflow node type, but the allWorkflows
    // array does not contain the referenced workflow. This hits lines 502-505.
    const missingWorkflowNode = makeNodeType('childWorkflow', {
      variant: 'IMPORTED_WORKFLOW',
      sourceLocation: { file: 'test.ts' },
    });

    const processorNode = makeNodeType('processor');

    const ast = makeWorkflowAST({
      nodeTypes: [processorNode, missingWorkflowNode],
      instances: [
        { type: 'NodeInstance', id: 'proc1', nodeType: 'processor' },
        { type: 'NodeInstance', id: 'child1', nodeType: 'childWorkflow' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'proc1', port: 'value' } },
        { type: 'Connection', from: { node: 'proc1', port: 'result' }, to: { node: 'child1', port: 'value' } },
        { type: 'Connection', from: { node: 'child1', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
    });

    // allWorkflows is empty, so the referenced childWorkflow won't be found
    const code = generateCode(ast, {
      production: false,
      allWorkflows: [],
      moduleFormat: 'esm',
    });

    expect(code).toContain('WARNING: Could not find workflow AST for childWorkflow');
  });
});

describe('generateCode: local workflow dependency generation via generateWorkflowFunction', () => {
  it('inlines a local workflow dependency found in allWorkflows', () => {
    // The child workflow is in the same source file and used as a node instance.
    // When the child AST is provided in allWorkflows, lines 679-688 should generate it.
    const childNodeType = makeNodeType('childProcessor');
    const childWorkflowAST = makeWorkflowAST({
      name: 'childFlow',
      functionName: 'childFlow',
      sourceFile: 'test.ts',
      nodeTypes: [childNodeType],
      instances: [
        { type: 'NodeInstance', id: 'cp1', nodeType: 'childProcessor' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'cp1', port: 'value' } },
        { type: 'Connection', from: { node: 'cp1', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
    });

    const childWorkflowNodeType = makeNodeType('childFlow', {
      variant: 'IMPORTED_WORKFLOW',
      sourceLocation: { file: 'test.ts' },
    });

    const mainAST = makeWorkflowAST({
      nodeTypes: [childWorkflowNodeType],
      instances: [
        { type: 'NodeInstance', id: 'child1', nodeType: 'childFlow' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'input' }, to: { node: 'child1', port: 'value' } },
        { type: 'Connection', from: { node: 'child1', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
    });

    const code = generateCode(mainAST, {
      production: false,
      allWorkflows: [mainAST, childWorkflowAST],
      moduleFormat: 'esm',
    });

    // The child workflow function should be inlined in the output
    expect(code).toContain('childFlow');
    // Should NOT contain the warning since the child was found
    expect(code).not.toContain('WARNING: Could not find workflow AST for childFlow');
  });
});
