import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  generateCode,
  generateImportStatement,
  generateFunctionExportKeyword,
  generateModuleExports,
} from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');
const MOCK_OTHER_FILE = path.join(os.tmpdir(), 'other-file.ts');

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

describe('generate npm package imports', () => {
  it('node with importSource generates import from package name', () => {
    const nodeType = makeNodeType({
      name: 'format',
      functionName: 'format',
      importSource: 'date-fns',
      sourceLocation: { file: '/some/node_modules/date-fns/dist/index.d.ts', line: 1, column: 0 },
    });
    const ast = makeWorkflow([nodeType]);
    const code = generateCode(ast) as string;

    expect(code).toContain("import { format } from 'date-fns';");
  });

  it('no .generated suffix in import path for npm packages', () => {
    const nodeType = makeNodeType({
      name: 'format',
      functionName: 'format',
      importSource: 'date-fns',
      sourceLocation: { file: '/some/node_modules/date-fns/dist/index.d.ts', line: 1, column: 0 },
    });
    const ast = makeWorkflow([nodeType]);
    const code = generateCode(ast) as string;

    expect(code).not.toContain('.generated');
    expect(code).toContain("from 'date-fns'");
  });

  it('function text is NOT inlined for npm package nodes', () => {
    const nodeType = makeNodeType({
      name: 'format',
      functionName: 'format',
      importSource: 'date-fns',
      functionText: undefined, // explicitly undefined
      sourceLocation: { file: '/some/node_modules/date-fns/dist/index.d.ts', line: 1, column: 0 },
    });
    const ast = makeWorkflow([nodeType]);
    const code = generateCode(ast) as string;

    // Should not contain "declare function" or any inlined function body
    expect(code).not.toContain('declare function');
  });

  it('multiple imports from same package are grouped', () => {
    const nodeA = makeNodeType({
      name: 'fnA',
      functionName: 'fnA',
      importSource: 'my-lib',
      sourceLocation: { file: '/nm/my-lib/index.d.ts', line: 1, column: 0 },
    });
    const nodeB = makeNodeType({
      name: 'fnB',
      functionName: 'fnB',
      importSource: 'my-lib',
      sourceLocation: { file: '/nm/my-lib/index.d.ts', line: 2, column: 0 },
    });
    const ast = makeWorkflow([nodeA, nodeB], {
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'fnA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'fnB' },
      ],
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'a', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'a', port: 'onSuccess' },
          to: { node: 'b', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'b', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        },
      ],
    });
    const code = generateCode(ast) as string;

    // Should have a single grouped import
    expect(code).toContain("import { fnA, fnB } from 'my-lib';");
  });

  it('npm imports coexist with relative file imports', () => {
    const npmNode = makeNodeType({
      name: 'npmFn',
      functionName: 'npmFn',
      importSource: 'external-pkg',
      sourceLocation: { file: '/nm/external-pkg/index.d.ts', line: 1, column: 0 },
    });
    const relativeNode = makeNodeType({
      name: 'localFn',
      functionName: 'localFn',
      variant: 'FUNCTION',
      sourceLocation: { file: MOCK_OTHER_FILE, line: 1, column: 0 },
      functionText:
        'function localFn(execute: boolean, x: number) { return { onSuccess: true, onFailure: false, result: x }; }',
    });
    const ast = makeWorkflow([npmNode, relativeNode], {
      instances: [
        { type: 'NodeInstance', id: 'n', nodeType: 'npmFn' },
        { type: 'NodeInstance', id: 'l', nodeType: 'localFn' },
      ],
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'n', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'n', port: 'onSuccess' },
          to: { node: 'l', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'l', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        },
      ],
    });
    const code = generateCode(ast) as string;

    // Should have both npm and relative imports
    expect(code).toContain("from 'external-pkg'");
    expect(code).toContain("from './other-file.generated'");
  });
});

describe('module format helpers', () => {
  describe('generateImportStatement', () => {
    it('generates ESM import for esm format', () => {
      const result = generateImportStatement(['foo', 'bar'], 'my-package', 'esm');
      expect(result).toBe("import { foo, bar } from 'my-package';");
    });

    it('generates CJS require for cjs format', () => {
      const result = generateImportStatement(['foo', 'bar'], 'my-package', 'cjs');
      expect(result).toBe("const { foo, bar } = require('my-package');");
    });
  });

  describe('generateFunctionExportKeyword', () => {
    it('returns "export " for esm format', () => {
      expect(generateFunctionExportKeyword('esm')).toBe('export ');
    });

    it('returns "" for cjs format (no inline export)', () => {
      expect(generateFunctionExportKeyword('cjs')).toBe('');
    });
  });

  describe('generateModuleExports', () => {
    it('generates module.exports for single function', () => {
      const result = generateModuleExports(['myWorkflow']);
      expect(result).toBe('module.exports = { myWorkflow };');
    });

    it('generates module.exports for multiple functions', () => {
      const result = generateModuleExports(['workflowA', 'workflowB']);
      expect(result).toBe('module.exports = { workflowA, workflowB };');
    });
  });
});

describe('generate code with moduleFormat option', () => {
  it('generates ESM imports by default', () => {
    const nodeType = makeNodeType({
      name: 'format',
      functionName: 'format',
      importSource: 'date-fns',
      sourceLocation: { file: '/node_modules/date-fns/dist/index.d.ts', line: 1, column: 0 },
    });
    const ast = makeWorkflow([nodeType]);
    const code = generateCode(ast) as string;

    expect(code).toContain("import { format } from 'date-fns';");
    expect(code).toContain('export async function testWorkflow');
    expect(code).not.toContain('module.exports');
    expect(code).not.toContain('require(');
  });

  it('generates CJS require/exports with moduleFormat: cjs', () => {
    const nodeType = makeNodeType({
      name: 'format',
      functionName: 'format',
      importSource: 'date-fns',
      sourceLocation: { file: '/node_modules/date-fns/dist/index.d.ts', line: 1, column: 0 },
    });
    const ast = makeWorkflow([nodeType]);
    const code = generateCode(ast, { moduleFormat: 'cjs' }) as string;

    expect(code).toContain("const { format } = require('date-fns');");
    expect(code).toContain('async function testWorkflow');
    expect(code).not.toContain('export async function');
    expect(code).toContain('module.exports = { testWorkflow }');
  });

  it('generates ESM imports with explicit moduleFormat: esm', () => {
    const nodeType = makeNodeType({
      name: 'format',
      functionName: 'format',
      importSource: 'date-fns',
      sourceLocation: { file: '/node_modules/date-fns/dist/index.d.ts', line: 1, column: 0 },
    });
    const ast = makeWorkflow([nodeType]);
    const code = generateCode(ast, { moduleFormat: 'esm' }) as string;

    expect(code).toContain("import { format } from 'date-fns';");
    expect(code).toContain('export async function testWorkflow');
  });
});
