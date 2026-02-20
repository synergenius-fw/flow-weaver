/**
 * TDD Test: Bundle mode import and calling conventions.
 *
 * In bundle mode (externalRuntimePath is set):
 *   - ALL node types import _impl (positional args with execute)
 *   - Calls use: nodeFunction(execute, param1, param2, ...)
 *   - The wrapper (params object) is only for HTTP entry points
 *
 * In non-bundle mode:
 *   - Regular nodes: nodeFunction(execute, param1, param2, ...)
 *   - Expression nodes: nodeFunction(param1, param2, ...) (no execute)
 */

import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');

function makeNodeType(overrides: Partial<TNodeTypeAST>): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: overrides.name || 'testFn',
    functionName: overrides.functionName || overrides.name || 'testFn',
    inputs: overrides.inputs || {
      execute: { dataType: 'STEP' },
      a: { dataType: 'NUMBER' },
      b: { dataType: 'NUMBER' },
    },
    outputs: overrides.outputs || {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    expression: false, // Regular node with execute param
    inferred: false,
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
        from: { node: 'Start', port: 'a' },
        to: { node: 'n1', port: 'a' },
      },
      {
        type: 'Connection',
        from: { node: 'Start', port: 'b' },
        to: { node: 'n1', port: 'b' },
      },
      {
        type: 'Connection',
        from: { node: 'n1', port: 'onSuccess' },
        to: { node: 'Exit', port: 'onSuccess' },
      },
      {
        type: 'Connection',
        from: { node: 'n1', port: 'result' },
        to: { node: 'Exit', port: 'result' },
      },
    ],
    startPorts: {
      execute: { dataType: 'STEP' },
      a: { dataType: 'NUMBER' },
      b: { dataType: 'NUMBER' },
    },
    exitPorts: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      result: { dataType: 'NUMBER' },
    },
    imports: [],
    ...overrides,
  };
}

describe('Bundle mode calling conventions', () => {
  it('should use positional args with execute in bundle mode for regular nodes', () => {
    const nodeType = makeNodeType({
      name: 'addNumbers',
      functionName: 'addNumbers',
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText: 'function addNumbers(execute: boolean, a: number, b: number) { return { onSuccess: true, onFailure: false, result: a + b }; }',
    });
    const ast = makeWorkflow([nodeType]);

    // Generate in bundle mode (externalRuntimePath is set)
    const code = generateCode(ast, {
      externalNodeTypes: { 'addNumbers': '../node-types/addnumbers.js' },
      externalRuntimePath: '../runtime/types.js',
    }) as unknown as string;

    // In bundle mode, imports _impl and calls with positional args: addNumbers(n1_execute, n1_a, n1_b)
    expect(code).toMatch(/addNumbers\(n1_execute,\s*n1_a,\s*n1_b\)/);
    // Should NOT use params object
    expect(code).not.toMatch(/addNumbers\(n1_execute,\s*\{/);
  });

  it('should use positional args in non-bundle mode for regular nodes', () => {
    const nodeType = makeNodeType({
      name: 'addNumbers',
      functionName: 'addNumbers',
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText: 'function addNumbers(execute: boolean, a: number, b: number) { return { onSuccess: true, onFailure: false, result: a + b }; }',
    });
    const ast = makeWorkflow([nodeType]);

    // Generate in NON-bundle mode (no externalRuntimePath)
    const code = generateCode(ast) as unknown as string;

    // In non-bundle mode, should call with positional args: addNumbers(n1_execute, n1_a, n1_b)
    expect(code).toMatch(/addNumbers\(n1_execute,\s*n1_a,\s*n1_b\)/);
    // Should NOT use params object
    expect(code).not.toMatch(/addNumbers\(n1_execute,\s*\{/);
  });

  it('should include execute in bundle mode for expression nodes (_impl has execute)', () => {
    const nodeType = makeNodeType({
      name: 'multiply',
      functionName: 'multiply',
      expression: true, // Expression node
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText: 'function multiply(a: number, b: number) { return { result: a * b }; }',
    });
    const ast = makeWorkflow([nodeType]);

    // Generate in bundle mode
    const code = generateCode(ast, {
      externalNodeTypes: { 'multiply': '../node-types/multiply.js' },
      externalRuntimePath: '../runtime/types.js',
    }) as unknown as string;

    // Expression nodes in bundle mode import _impl which has NO execute param
    // (expression _impl preserves original function signature)
    // So call should be: multiply(n1_a, n1_b) — without execute
    expect(code).toMatch(/multiply\(n1_a,\s*n1_b\)/);
    // Should NOT have execute before data args
    expect(code).not.toMatch(/multiply\(n1_execute/);
  });

  it('should omit execute in non-bundle mode for expression nodes', () => {
    const nodeType = makeNodeType({
      name: 'multiply',
      functionName: 'multiply',
      expression: true, // Expression node
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText: 'function multiply(a: number, b: number) { return { result: a * b }; }',
    });
    const ast = makeWorkflow([nodeType]);

    // Generate in NON-bundle mode
    const code = generateCode(ast) as unknown as string;

    // Expression nodes in non-bundle mode import original function (no execute)
    expect(code).toMatch(/multiply\(n1_a,\s*n1_b\)/);
    // Should NOT have execute before data args
    expect(code).not.toMatch(/multiply\(true,\s*n1_a/);
  });
});
