/**
 * Safety-net tests: Flow Weaver must NEVER generate imports from an external runtime package.
 *
 * Design principle: generated code is self-contained with zero runtime dependencies.
 * The runtime (GeneratedExecutionContext, CancellationError, types) is always inlined.
 *
 * These tests cover both APIs:
 *   - generateInPlace() (in-place compilation into source files)
 *   - generateCode()    (standalone file generation, including bundle mode)
 */

import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { generateInPlace, MARKERS } from '../../src/api/generate-in-place';
import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
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

function makeMinimalAST(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  const nodeA = makeNodeType('nodeA');
  return {
    type: 'Workflow',
    name: 'myWorkflow',
    functionName: 'myWorkflow',
    sourceFile: 'test.ts',
    nodeTypes: [nodeA],
    instances: [{ type: 'NodeInstance', id: 'a', nodeType: 'nodeA' }],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: 'a', port: 'execute' },
      },
      {
        type: 'Connection',
        from: { node: 'Start', port: 'value' },
        to: { node: 'a', port: 'value' },
      },
      {
        type: 'Connection',
        from: { node: 'a', port: 'onSuccess' },
        to: { node: 'Exit', port: 'onSuccess' },
      },
      {
        type: 'Connection',
        from: { node: 'a', port: 'result' },
        to: { node: 'Exit', port: 'result' },
      },
    ],
    startPorts: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
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

function makeSourceWithNodeType(): string {
  return `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect Start.value -> a.value
 * @connect a.onSuccess -> Exit.onSuccess
 * @connect a.result -> Exit.result
 */
export async function myWorkflow(
  execute: boolean = true,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}`;
}

const EXTERNAL_RUNTIME_IMPORT = '@synergenius/flow-weaver/runtime';

// Helper to detect ANY form of external runtime import
function assertNoExternalRuntimeImport(code: string): void {
  expect(code).not.toContain(EXTERNAL_RUNTIME_IMPORT);
  // Also check for require()-style imports
  expect(code).not.toContain(`require('${EXTERNAL_RUNTIME_IMPORT}')`);
}

// Helper to verify inline runtime is present
function assertInlineRuntimePresent(code: string): void {
  // The inline runtime embeds the GeneratedExecutionContext class directly
  expect(code).toContain('class GeneratedExecutionContext');
  expect(code).toContain('CancellationError');
}

// ---------------------------------------------------------------------------
// generateInPlace — always inlines runtime
// ---------------------------------------------------------------------------

describe('generateInPlace: no external runtime imports', () => {
  it('never generates external runtime imports in dev mode', () => {
    const source = makeSourceWithNodeType();
    const ast = makeMinimalAST();
    const result = generateInPlace(source, ast, { production: false });

    assertNoExternalRuntimeImport(result.code);
    expect(result.code).toContain(MARKERS.RUNTIME_START);
    expect(result.code).toContain(MARKERS.RUNTIME_END);
  });

  it('never generates external runtime imports in production mode', () => {
    const source = makeSourceWithNodeType();
    const ast = makeMinimalAST();
    const result = generateInPlace(source, ast, { production: true });

    assertNoExternalRuntimeImport(result.code);
  });

  it('always inlines runtime with default options', () => {
    const source = makeSourceWithNodeType();
    const ast = makeMinimalAST();
    const result = generateInPlace(source, ast);

    assertNoExternalRuntimeImport(result.code);
    expect(result.code).toContain(MARKERS.RUNTIME_START);
  });

  it('generated code contains GeneratedExecutionContext usage in function body', () => {
    const source = makeSourceWithNodeType();
    const ast = makeMinimalAST();
    const result = generateInPlace(source, ast);

    // The body uses new GeneratedExecutionContext(...)
    expect(result.code).toContain('new GeneratedExecutionContext(');
  });

  it('generated code contains CancellationError usage in error handlers', () => {
    const source = makeSourceWithNodeType();
    const ast = makeMinimalAST();
    const result = generateInPlace(source, ast);

    // Error handlers use CancellationError.isCancellationError
    expect(result.code).toContain('CancellationError.isCancellationError');
  });

  it('works with CJS module format without external imports', () => {
    const source = makeSourceWithNodeType();
    const ast = makeMinimalAST();
    const result = generateInPlace(source, ast, { moduleFormat: 'cjs' });

    assertNoExternalRuntimeImport(result.code);
  });
});

// ---------------------------------------------------------------------------
// generateCode — standalone generation always inlines runtime
// ---------------------------------------------------------------------------

describe('generateCode: no external runtime imports', () => {
  const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');

  function makeBundleNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
    return {
      type: 'NodeType',
      name: 'addNumbers',
      functionName: 'addNumbers',
      inputs: {
        execute: { dataType: 'STEP' },
        a: { dataType: 'NUMBER' },
        b: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
      expression: false,
      inferred: false,
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText:
        'function addNumbers(execute: boolean, a: number, b: number) { return { onSuccess: true, onFailure: false, result: a + b }; }',
      ...overrides,
    };
  }

  function makeBundleWorkflow(nodeTypes: TNodeTypeAST[], overrides?: Partial<TWorkflowAST>): TWorkflowAST {
    return {
      type: 'Workflow',
      sourceFile: MOCK_FILE,
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes,
      instances: [
        {
          type: 'NodeInstance',
          id: 'n1',
          nodeType: nodeTypes[0]?.name || 'addNumbers',
        },
      ],
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

  it('inlines runtime in default (non-bundle) mode', () => {
    const nodeType = makeBundleNodeType();
    const ast = makeBundleWorkflow([nodeType]);

    const code = generateCode(ast) as unknown as string;

    assertNoExternalRuntimeImport(code);
    assertInlineRuntimePresent(code);
  });

  it('inlines runtime in production mode', () => {
    const nodeType = makeBundleNodeType();
    const ast = makeBundleWorkflow([nodeType]);

    const code = generateCode(ast, { production: true }) as unknown as string;

    assertNoExternalRuntimeImport(code);
    assertInlineRuntimePresent(code);
  });

  it('inlines runtime in dev mode', () => {
    const nodeType = makeBundleNodeType();
    const ast = makeBundleWorkflow([nodeType]);

    const code = generateCode(ast, { production: false }) as unknown as string;

    assertNoExternalRuntimeImport(code);
    assertInlineRuntimePresent(code);
  });

  it('inlines runtime in CJS module format', () => {
    const nodeType = makeBundleNodeType();
    const ast = makeBundleWorkflow([nodeType]);

    const code = generateCode(ast, {
      moduleFormat: 'cjs',
    }) as unknown as string;

    assertNoExternalRuntimeImport(code);
    assertInlineRuntimePresent(code);
  });
});

// ---------------------------------------------------------------------------
// Bundle mode — must work with inline runtime (no externalRuntimePath needed)
// ---------------------------------------------------------------------------

describe('generateCode: bundle mode with inline runtime', () => {
  const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');

  function makeBundleNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
    return {
      type: 'NodeType',
      name: 'addNumbers',
      functionName: 'addNumbers',
      inputs: {
        execute: { dataType: 'STEP' },
        a: { dataType: 'NUMBER' },
        b: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
      expression: false,
      inferred: false,
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText:
        'function addNumbers(execute: boolean, a: number, b: number) { return { onSuccess: true, onFailure: false, result: a + b }; }',
      ...overrides,
    };
  }

  function makeBundleWorkflow(nodeTypes: TNodeTypeAST[], overrides?: Partial<TWorkflowAST>): TWorkflowAST {
    return {
      type: 'Workflow',
      sourceFile: MOCK_FILE,
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes,
      instances: [
        {
          type: 'NodeInstance',
          id: 'n1',
          nodeType: nodeTypes[0]?.name || 'addNumbers',
        },
      ],
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

  it('bundle mode still uses _impl imports from node-types directory', () => {
    const nodeType = makeBundleNodeType();
    const ast = makeBundleWorkflow([nodeType]);

    const code = generateCode(ast, {
      externalNodeTypes: { addNumbers: '../node-types/addnumbers.js' },
      bundleMode: true,
    }) as unknown as string;

    // Bundle mode import pattern preserved
    expect(code).toContain('addnumbers_impl as addNumbers');
    expect(code).toContain('../node-types/addnumbers.js');
    // But runtime is ALWAYS inlined
    assertNoExternalRuntimeImport(code);
    assertInlineRuntimePresent(code);
  });

  it('bundle mode uses positional args for regular nodes', () => {
    const nodeType = makeBundleNodeType();
    const ast = makeBundleWorkflow([nodeType]);

    const code = generateCode(ast, {
      externalNodeTypes: { addNumbers: '../node-types/addnumbers.js' },
      bundleMode: true,
    }) as unknown as string;

    // Positional args: addNumbers(n1_execute, n1_a, n1_b)
    expect(code).toMatch(/addNumbers\(n1_execute,\s*n1_a,\s*n1_b\)/);
    expect(code).not.toMatch(/addNumbers\(n1_execute,\s*\{/);
  });

  it('bundle mode expression nodes omit execute', () => {
    const nodeType = makeBundleNodeType({
      name: 'multiply',
      functionName: 'multiply',
      expression: true,
      functionText: 'function multiply(a: number, b: number) { return { result: a * b }; }',
    });
    const ast = makeBundleWorkflow([nodeType]);

    const code = generateCode(ast, {
      externalNodeTypes: { multiply: '../node-types/multiply.js' },
      bundleMode: true,
    }) as unknown as string;

    // Expression nodes: no execute param
    expect(code).toMatch(/multiply\(n1_a,\s*n1_b\)/);
    expect(code).not.toMatch(/multiply\(n1_execute/);
    // Runtime still inlined
    assertNoExternalRuntimeImport(code);
  });

  it('bundle mode imports workflows from sibling files', () => {
    const importedWorkflow: TNodeTypeAST = {
      type: 'NodeType',
      name: 'subWorkflow',
      functionName: 'subWorkflow',
      variant: 'IMPORTED_WORKFLOW',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
      sourceLocation: { file: '/other/sub-workflow.ts', line: 1, column: 0 },
    };

    const ast = makeBundleWorkflow([importedWorkflow], {
      instances: [{ type: 'NodeInstance', id: 'n1', nodeType: 'subWorkflow' }],
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'n1', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'Start', port: 'a' },
          to: { node: 'n1', port: 'input' },
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
    });

    const code = generateCode(ast, {
      bundleMode: true,
    }) as unknown as string;

    // Bundle mode workflow imports
    expect(code).toContain('./subWorkflow');
    // Runtime still inlined
    assertNoExternalRuntimeImport(code);
  });

  it('non-bundle mode uses .generated imports', () => {
    const importedNode: TNodeTypeAST = {
      type: 'NodeType',
      name: 'addNumbers',
      functionName: 'addNumbers',
      inputs: {
        execute: { dataType: 'STEP' },
        a: { dataType: 'NUMBER' },
        b: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
      sourceLocation: { file: '/other/math-utils.ts', line: 1, column: 0 },
      functionText:
        'function addNumbers(execute: boolean, a: number, b: number) { return { onSuccess: true, onFailure: false, result: a + b }; }',
    };

    const ast = makeBundleWorkflow([importedNode]);

    // Non-bundle mode (no bundleMode flag)
    const code = generateCode(ast) as unknown as string;

    // Non-bundle mode uses .generated import paths
    expect(code).toContain('math-utils.generated');
    // Runtime still inlined
    assertNoExternalRuntimeImport(code);
  });
});

// ---------------------------------------------------------------------------
// Debug infrastructure — always works with inline runtime
// ---------------------------------------------------------------------------

describe('Debug infrastructure with inline runtime', () => {
  it('dev mode reads debugger services from the explicit runtime', () => {
    const source = makeSourceWithNodeType();
    const ast = makeMinimalAST();
    const result = generateInPlace(source, ast, { production: false });

    expect(result.code).toContain('runtime.services.debugger');
    expect(result.code).not.toContain('__flowWeaverDebugger__');
    // But it comes from inline runtime, never external import
    assertNoExternalRuntimeImport(result.code);
  });

  it('production mode omits debug infrastructure', () => {
    const source = makeSourceWithNodeType();
    const ast = makeMinimalAST();
    const result = generateInPlace(source, ast, { production: true });

    expect(result.code).not.toContain('__flowWeaverDebugger__');
    assertNoExternalRuntimeImport(result.code);
  });

  it('dev mode generateCode includes debug types inline', () => {
    const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');
    const nodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'addNumbers',
      functionName: 'addNumbers',
      inputs: {
        execute: { dataType: 'STEP' },
        a: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText:
        'function addNumbers(execute: boolean, a: number) { return { onSuccess: true, onFailure: false, result: a }; }',
    };

    const ast: TWorkflowAST = {
      type: 'Workflow',
      sourceFile: MOCK_FILE,
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes: [nodeType],
      instances: [{ type: 'NodeInstance', id: 'n1', nodeType: 'addNumbers' }],
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
          from: { node: 'n1', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        },
        {
          type: 'Connection',
          from: { node: 'n1', port: 'result' },
          to: { node: 'Exit', port: 'result' },
        },
      ],
      startPorts: { execute: { dataType: 'STEP' }, a: { dataType: 'NUMBER' } },
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      imports: [],
    };

    const code = generateCode(ast, { production: false }) as unknown as string;

    assertNoExternalRuntimeImport(code);
    assertInlineRuntimePresent(code);
  });
});
