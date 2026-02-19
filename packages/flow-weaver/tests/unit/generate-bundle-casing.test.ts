/**
 * Tests for file path casing in bundle generation.
 *
 * When generating bundles with externalNodeTypes, the import paths
 * should use lowercase file names to match the bundle file naming convention.
 */

import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');
const MOCK_OTHER_MODULE = path.join(os.tmpdir(), 'other-module.ts');
const MOCK_SUB_WORKFLOW = path.join(os.tmpdir(), 'sub-workflow.ts');

function makeNodeType(overrides: Partial<TNodeTypeAST>): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: overrides.name || 'testFn',
    functionName: overrides.functionName || overrides.name || 'testFn',
    inputs: overrides.inputs || { execute: { dataType: 'STEP' } },
    outputs: overrides.outputs || {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      result: { dataType: 'STRING' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    expression: true,
    inferred: true,
    ...overrides,
  };
}

function makeWorkflow(nodeTypes: TNodeTypeAST[], overrides?: Partial<TWorkflowAST>): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: MOCK_FILE,
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes,
    instances: [{ type: 'NodeInstance', id: 'n1', nodeType: nodeTypes[0]?.name || 'testFn' }],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: 'n1', port: 'execute' },
      },
      {
        type: 'Connection',
        from: { node: 'n1', port: 'onSuccess' },
        to: { node: 'Exit', port: 'onSuccess' },
      },
    ],
    startPorts: {
      execute: { dataType: 'STEP' },
      input: { dataType: 'STRING' },
    },
    exitPorts: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      output: { dataType: 'STRING' },
    },
    imports: [],
    ...overrides,
  };
}

describe('Bundle generation casing', () => {
  describe('externalNodeTypes imports (local functions)', () => {
    it('should lowercase file paths in external node type imports', () => {
      // Local node type with camelCase name
      const nodeType = makeNodeType({
        name: 'DoubleValue',
        functionName: 'DoubleValue',
        sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
        functionText: 'function DoubleValue(execute: boolean, x: number) { return { onSuccess: true, onFailure: false, result: x * 2 }; }',
      });
      const ast = makeWorkflow([nodeType]);

      // Generate code with externalNodeTypes pointing to lowercase files
      const code = generateCode(ast, {
        externalNodeTypes: { 'DoubleValue': '../node-types/doublevalue.js' },
        externalRuntimePath: '../runtime/types.js',
      }) as string;

      // Import path should use the provided path (lowercase)
      expect(code).toContain("from '../node-types/doublevalue.js'");
      // Should NOT contain the original casing in the import path
      expect(code).not.toContain("from '../node-types/DoubleValue.js'");
    });

    it('should lowercase _impl function names in imports', () => {
      const nodeType = makeNodeType({
        name: 'DoubleValue',
        functionName: 'DoubleValue',
        sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
        functionText: 'function DoubleValue(execute: boolean, x: number) { return { onSuccess: true, onFailure: false, result: x * 2 }; }',
      });
      const ast = makeWorkflow([nodeType]);

      const code = generateCode(ast, {
        externalNodeTypes: { 'DoubleValue': '../node-types/doublevalue.js' },
        externalRuntimePath: '../runtime/types.js',
      }) as string;

      // _impl name should be lowercase
      expect(code).toContain('doublevalue_impl as DoubleValue');
      // Should NOT use original case for _impl
      expect(code).not.toContain('DoubleValue_impl');
    });

    it('should preserve original function name after "as" keyword', () => {
      const nodeType = makeNodeType({
        name: 'CamelCaseNode',
        functionName: 'CamelCaseNode',
        sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
        functionText: 'function CamelCaseNode(execute: boolean) { return { onSuccess: true, onFailure: false, result: "ok" }; }',
      });
      const ast = makeWorkflow([nodeType]);

      const code = generateCode(ast, {
        externalNodeTypes: { 'CamelCaseNode': '../node-types/camelcasenode.js' },
        externalRuntimePath: '../runtime/types.js',
      }) as string;

      // Should import lowercase_impl but alias to original case
      expect(code).toContain('camelcasenode_impl as CamelCaseNode');
    });
  });

  describe('imported node functions (from other source files)', () => {
    it('should lowercase file paths for imported nodes in bundle mode', () => {
      // Node imported from a different source file
      const nodeType = makeNodeType({
        name: 'ProcessData',
        functionName: 'ProcessData',
        variant: 'FUNCTION',
        sourceLocation: { file: MOCK_OTHER_MODULE, line: 1, column: 0 },
      });
      const ast = makeWorkflow([nodeType]);

      const code = generateCode(ast, {
        externalRuntimePath: '../runtime/types.js',
      }) as string;

      // In bundle mode, should generate lowercase import path
      expect(code).toContain("from '../node-types/processdata.js'");
      expect(code).not.toContain("from '../node-types/ProcessData.js'");
    });

    it('should lowercase _impl function names for imported nodes', () => {
      const nodeType = makeNodeType({
        name: 'ProcessData',
        functionName: 'ProcessData',
        variant: 'FUNCTION',
        sourceLocation: { file: MOCK_OTHER_MODULE, line: 1, column: 0 },
      });
      const ast = makeWorkflow([nodeType]);

      const code = generateCode(ast, {
        externalRuntimePath: '../runtime/types.js',
      }) as string;

      // Should use lowercase_impl aliased to original name
      expect(code).toContain('processdata_impl as ProcessData');
      expect(code).not.toContain('ProcessData_impl');
    });
  });

  describe('workflow imports (not node types)', () => {
    it('should NOT lowercase workflow imports (they use function names as-is)', () => {
      // Workflow imported from another file (not a node type function)
      const nodeType = makeNodeType({
        name: 'SubWorkflow',
        functionName: 'SubWorkflow',
        variant: 'IMPORTED_WORKFLOW',
        sourceLocation: { file: MOCK_SUB_WORKFLOW, line: 1, column: 0 },
      });
      const ast = makeWorkflow([nodeType]);

      const code = generateCode(ast, {
        externalRuntimePath: '../runtime/types.js',
      }) as string;

      // Workflows are imported directly by name (no _impl wrapper)
      // The path uses the workflow name as-is
      expect(code).toContain("from './SubWorkflow.js'");
    });
  });
});
