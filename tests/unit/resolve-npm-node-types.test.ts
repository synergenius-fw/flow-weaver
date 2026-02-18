import { describe, it, expect, vi } from 'vitest';
import { resolveNpmNodeTypes } from '../../src/parser';
import * as npmPackages from '../../src/npm-packages';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

describe('resolveNpmNodeTypes', () => {
  it('should resolve stub npm node types using getPackageExports', () => {
    // Mock getPackageExports to return test data
    const mockPackageExports: npmPackages.TNpmNodeType[] = [
      {
        name: 'npm/test-package/format',
        variant: 'FUNCTION',
        category: 'NPM Packages',
        function: 'format',
        label: 'format',
        importSource: 'test-package',
        ports: [
          { name: 'execute', defaultLabel: 'Execute', type: 'STEP', direction: 'INPUT' },
          { name: 'date', defaultLabel: 'Date', type: 'OBJECT', direction: 'INPUT' },
          { name: 'formatStr', defaultLabel: 'FormatStr', type: 'STRING', direction: 'INPUT' },
          { name: 'result', defaultLabel: 'Result', type: 'STRING', direction: 'OUTPUT' },
          { name: 'onSuccess', defaultLabel: 'On Success', type: 'STEP', direction: 'OUTPUT' },
          { name: 'onFailure', defaultLabel: 'On Failure', type: 'STEP', direction: 'OUTPUT' },
        ],
        synchronicity: 'SYNC',
        description: 'format from test-package',
      },
    ];

    vi.spyOn(npmPackages, 'getPackageExports').mockReturnValue(mockPackageExports);

    // Create a stub npm node type (as created by parser from @fwImport annotation)
    const stubNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/test-package/format',
      functionName: 'format',
      importSource: 'test-package',
      variant: 'FUNCTION',
      inputs: {},
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      executeWhen: 'CONJUNCTION',
      isAsync: false,
    };

    const ast: TWorkflowAST = {
      type: 'Workflow',
      sourceFile: '/test/workflow.ts',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes: [stubNodeType],
      instances: [],
      connections: [],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
      imports: [],
    };

    const resolved = resolveNpmNodeTypes(ast, '/test');

    // Find the resolved node type
    const resolvedNodeType = resolved.nodeTypes.find(
      (nt) => nt.importSource === 'test-package'
    );

    expect(resolvedNodeType).toBeDefined();
    // Should now have proper inputs from mocked .d.ts data
    expect(resolvedNodeType!.inputs).toHaveProperty('execute');
    expect(resolvedNodeType!.inputs).toHaveProperty('date');
    expect(resolvedNodeType!.inputs).toHaveProperty('formatStr');
    expect(resolvedNodeType!.inputs['formatStr']).toMatchObject({
      dataType: 'STRING',
    });
    // Should have outputs from mocked .d.ts data
    expect(resolvedNodeType!.outputs).toHaveProperty('result');
    expect(resolvedNodeType!.outputs['result']).toMatchObject({
      dataType: 'STRING',
    });
    expect(resolvedNodeType!.outputs).toHaveProperty('onSuccess');
    expect(resolvedNodeType!.outputs).toHaveProperty('onFailure');

    vi.restoreAllMocks();
  });

  it('should preserve non-npm node types unchanged', () => {
    vi.spyOn(npmPackages, 'getPackageExports').mockReturnValue([]);

    const localNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'LocalNode',
      functionName: 'localNode',
      variant: 'FUNCTION',
      inputs: { execute: { dataType: 'STEP' }, customInput: { dataType: 'STRING' } },
      outputs: { onSuccess: { dataType: 'STEP' }, customOutput: { dataType: 'NUMBER' } },
      hasSuccessPort: true,
      hasFailurePort: false,
      executeWhen: 'CONJUNCTION',
      isAsync: false,
    };

    const ast: TWorkflowAST = {
      type: 'Workflow',
      sourceFile: '/test/workflow.ts',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes: [localNodeType],
      instances: [],
      connections: [],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
      imports: [],
    };

    const resolved = resolveNpmNodeTypes(ast, '/test');

    // Local node type should be unchanged (no importSource = not npm node)
    const resolvedNodeType = resolved.nodeTypes.find((nt) => nt.name === 'LocalNode');
    expect(resolvedNodeType).toEqual(localNodeType);

    vi.restoreAllMocks();
  });

  it('should keep stub when package cannot be resolved', () => {
    // Mock getPackageExports to return empty array (package not found)
    vi.spyOn(npmPackages, 'getPackageExports').mockReturnValue([]);

    const stubNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/nonexistent-package/func',
      functionName: 'func',
      importSource: 'nonexistent-package',
      variant: 'FUNCTION',
      inputs: {},
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      executeWhen: 'CONJUNCTION',
      isAsync: false,
    };

    const ast: TWorkflowAST = {
      type: 'Workflow',
      sourceFile: '/test/workflow.ts',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes: [stubNodeType],
      instances: [],
      connections: [],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
      imports: [],
    };

    const resolved = resolveNpmNodeTypes(ast, '/test');

    // Should keep the stub unchanged
    const resolvedNodeType = resolved.nodeTypes.find(
      (nt) => nt.importSource === 'nonexistent-package'
    );
    expect(resolvedNodeType).toEqual(stubNodeType);

    vi.restoreAllMocks();
  });

  it('should return empty workflow unchanged', () => {
    const ast: TWorkflowAST = {
      type: 'Workflow',
      sourceFile: '/test/workflow.ts',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes: [],
      instances: [],
      connections: [],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
      imports: [],
    };

    const resolved = resolveNpmNodeTypes(ast, '/test');
    expect(resolved).toEqual(ast);
  });

  it('should set isAsync correctly from package exports', () => {
    const mockPackageExports: npmPackages.TNpmNodeType[] = [
      {
        name: 'npm/async-package/fetchData',
        variant: 'FUNCTION',
        category: 'NPM Packages',
        function: 'fetchData',
        label: 'fetchData',
        importSource: 'async-package',
        ports: [
          { name: 'execute', defaultLabel: 'Execute', type: 'STEP', direction: 'INPUT' },
          { name: 'url', defaultLabel: 'Url', type: 'STRING', direction: 'INPUT' },
          { name: 'result', defaultLabel: 'Result', type: 'STRING', direction: 'OUTPUT' },
          { name: 'onSuccess', defaultLabel: 'On Success', type: 'STEP', direction: 'OUTPUT' },
          { name: 'onFailure', defaultLabel: 'On Failure', type: 'STEP', direction: 'OUTPUT' },
        ],
        synchronicity: 'ASYNC',
        description: 'fetchData from async-package',
      },
    ];

    vi.spyOn(npmPackages, 'getPackageExports').mockReturnValue(mockPackageExports);

    const stubNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/async-package/fetchData',
      functionName: 'fetchData',
      importSource: 'async-package',
      variant: 'FUNCTION',
      inputs: {},
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      executeWhen: 'CONJUNCTION',
      isAsync: false, // Stub defaults to sync
    };

    const ast: TWorkflowAST = {
      type: 'Workflow',
      sourceFile: '/test/workflow.ts',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes: [stubNodeType],
      instances: [],
      connections: [],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
      imports: [],
    };

    const resolved = resolveNpmNodeTypes(ast, '/test');
    const resolvedNodeType = resolved.nodeTypes.find(
      (nt) => nt.importSource === 'async-package'
    );

    // Should be updated to async based on package export
    expect(resolvedNodeType?.isAsync).toBe(true);

    vi.restoreAllMocks();
  });

  it('should match by functionName when name differs', () => {
    const mockPackageExports: npmPackages.TNpmNodeType[] = [
      {
        name: 'npm/my-package/myFunc',
        variant: 'FUNCTION',
        category: 'NPM Packages',
        function: 'myFunc', // This is what we match against functionName
        label: 'myFunc',
        importSource: 'my-package',
        ports: [
          { name: 'execute', defaultLabel: 'Execute', type: 'STEP', direction: 'INPUT' },
          { name: 'input1', defaultLabel: 'Input1', type: 'STRING', direction: 'INPUT' },
          { name: 'result', defaultLabel: 'Result', type: 'NUMBER', direction: 'OUTPUT' },
          { name: 'onSuccess', defaultLabel: 'On Success', type: 'STEP', direction: 'OUTPUT' },
          { name: 'onFailure', defaultLabel: 'On Failure', type: 'STEP', direction: 'OUTPUT' },
        ],
        synchronicity: 'SYNC',
        description: 'myFunc from my-package',
      },
    ];

    vi.spyOn(npmPackages, 'getPackageExports').mockReturnValue(mockPackageExports);

    // Stub with different name but matching functionName
    const stubNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'customName', // Different from npm/my-package/myFunc
      functionName: 'myFunc', // Matches the function field
      importSource: 'my-package',
      variant: 'FUNCTION',
      inputs: {},
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      executeWhen: 'CONJUNCTION',
      isAsync: false,
    };

    const ast: TWorkflowAST = {
      type: 'Workflow',
      sourceFile: '/test/workflow.ts',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes: [stubNodeType],
      instances: [],
      connections: [],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
      imports: [],
    };

    const resolved = resolveNpmNodeTypes(ast, '/test');
    const resolvedNodeType = resolved.nodeTypes.find(
      (nt) => nt.importSource === 'my-package'
    );

    // Should have resolved ports because functionName matched
    expect(resolvedNodeType).toBeDefined();
    expect(resolvedNodeType!.inputs).toHaveProperty('input1');
    expect(resolvedNodeType!.outputs['result'].dataType).toBe('NUMBER');

    vi.restoreAllMocks();
  });
});
