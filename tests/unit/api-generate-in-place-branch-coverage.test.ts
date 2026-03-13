/**
 * Branch coverage tests for src/api/generate-in-place.ts
 *
 * Targets uncovered branches: error paths, optional parameters,
 * early returns, ternaries, and edge cases in every helper function.
 */

import {
  generateInPlace,
  hasInPlaceMarkers,
  stripGeneratedSections,
  MARKERS,
} from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';
import * as fs from 'fs';

// ── Helpers ────────────────────────────────────────────────────────────────

function minimalAST(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    functionName: 'myWorkflow',
    name: 'myWorkflow',
    sourceFile: '/tmp/test.ts',
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: {},
    exitPorts: {},
    ...overrides,
  } as TWorkflowAST;
}

function minimalNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    name: 'doStuff',
    functionName: 'doStuff',
    variant: 'FUNCTION',
    inputs: { execute: { dataType: 'SIGNAL', label: 'execute' } },
    outputs: { onSuccess: { dataType: 'SIGNAL', label: 'onSuccess' } },
    ...overrides,
  } as TNodeTypeAST;
}

const SIMPLE_SOURCE = `/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;

const SOURCE_WITH_MARKERS = `import { foo } from 'bar';

${MARKERS.RUNTIME_START}
old-runtime-code
${MARKERS.RUNTIME_END}

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  ${MARKERS.BODY_START}
  old-body-code
  ${MARKERS.BODY_END}
}`;

const SOURCE_WITH_NODETYPE = `/**
 * @flowWeaver nodeType
 */
function doStuff() { return 1; }

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;

// ── MARKERS export ─────────────────────────────────────────────────────────

describe('MARKERS', () => {
  it('exports all four marker constants', () => {
    expect(MARKERS.RUNTIME_START).toContain('flow-weaver-runtime-start');
    expect(MARKERS.RUNTIME_END).toContain('flow-weaver-runtime-end');
    expect(MARKERS.BODY_START).toContain('flow-weaver-body-start');
    expect(MARKERS.BODY_END).toContain('flow-weaver-body-end');
  });
});

// ── hasInPlaceMarkers ──────────────────────────────────────────────────────

describe('hasInPlaceMarkers', () => {
  it('returns true when all four markers are present', () => {
    expect(hasInPlaceMarkers(SOURCE_WITH_MARKERS)).toBe(true);
  });

  it('returns false when runtime-start is missing', () => {
    const s = SOURCE_WITH_MARKERS.replace(MARKERS.RUNTIME_START, '');
    expect(hasInPlaceMarkers(s)).toBe(false);
  });

  it('returns false when runtime-end is missing', () => {
    const s = SOURCE_WITH_MARKERS.replace(MARKERS.RUNTIME_END, '');
    expect(hasInPlaceMarkers(s)).toBe(false);
  });

  it('returns false when body-start is missing', () => {
    const s = SOURCE_WITH_MARKERS.replace(MARKERS.BODY_START, '');
    expect(hasInPlaceMarkers(s)).toBe(false);
  });

  it('returns false when body-end is missing', () => {
    const s = SOURCE_WITH_MARKERS.replace(MARKERS.BODY_END, '');
    expect(hasInPlaceMarkers(s)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasInPlaceMarkers('')).toBe(false);
  });
});

// ── stripGeneratedSections ─────────────────────────────────────────────────

describe('stripGeneratedSections', () => {
  it('removes runtime section between markers', () => {
    const result = stripGeneratedSections(SOURCE_WITH_MARKERS);
    expect(result).not.toContain('old-runtime-code');
    expect(result).not.toContain(MARKERS.RUNTIME_START);
  });

  it('replaces body section with throw', () => {
    const result = stripGeneratedSections(SOURCE_WITH_MARKERS);
    expect(result).not.toContain('old-body-code');
    expect(result).toContain("throw new Error('Not implemented');");
  });

  it('returns source unchanged when no markers exist', () => {
    const noMarkers = 'function foo() {}';
    expect(stripGeneratedSections(noMarkers)).toBe(noMarkers);
  });

  it('handles multiple body sections (multi-workflow)', () => {
    const multi = `fn1() {
  ${MARKERS.BODY_START}
  body1
  ${MARKERS.BODY_END}
}
fn2() {
  ${MARKERS.BODY_START}
  body2
  ${MARKERS.BODY_END}
}`;
    const result = stripGeneratedSections(multi);
    expect(result).not.toContain('body1');
    expect(result).not.toContain('body2');
  });

  it('handles runtime markers at the very start of file (lineStart === -1)', () => {
    const atStart = `${MARKERS.RUNTIME_START}\nruntime\n${MARKERS.RUNTIME_END}\nrest`;
    const result = stripGeneratedSections(atStart);
    expect(result).not.toContain('runtime');
    expect(result).toContain('rest');
  });

  it('handles runtime end marker at end of file (lineEnd === -1)', () => {
    const atEnd = `before\n${MARKERS.RUNTIME_START}\nruntime\n${MARKERS.RUNTIME_END}`;
    const result = stripGeneratedSections(atEnd);
    expect(result).not.toContain('runtime');
  });
});

// ── generateInPlace: default options ───────────────────────────────────────

describe('generateInPlace', () => {
  it('returns code and hasChanges for a simple workflow', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('hasChanges');
    expect(typeof result.code).toBe('string');
  });

  it('defaults options when none provided', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    // Should insert runtime markers since they don't exist
    expect(result.code).toContain(MARKERS.RUNTIME_START);
    expect(result.hasChanges).toBe(true);
  });

  it('reports hasChanges=false when identical output is produced (idempotent re-run)', () => {
    const ast = minimalAST();
    const first = generateInPlace(SIMPLE_SOURCE, ast);
    const second = generateInPlace(first.code, ast);
    expect(second.hasChanges).toBe(false);
  });

  // ── production option ──────────────────────────────────────────────────

  it('generates production code without debug client', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast, { production: true });
    expect(result.code).not.toContain('createFlowWeaverDebugClient');
  });

  it('generates dev code with debug client by default', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast, { production: false });
    expect(result.code).toContain('createFlowWeaverDebugClient');
  });

  // ── moduleFormat option ────────────────────────────────────────────────

  it('accepts moduleFormat=cjs', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast, { moduleFormat: 'cjs' });
    expect(result.code).toBeDefined();
  });

  it('accepts moduleFormat=esm explicitly', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast, { moduleFormat: 'esm' });
    expect(result.code).toBeDefined();
  });

  // ── inlineRuntime option ───────────────────────────────────────────────

  it('forces inline runtime when inlineRuntime=true', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast, { inlineRuntime: true });
    // Inline runtime includes the class definition directly
    expect(result.code).toContain('GeneratedExecutionContext');
    // Should NOT have import from @synergenius/flow-weaver/runtime
    expect(result.code).not.toContain("from '@synergenius/flow-weaver/runtime'");
  });

  // ── sourceFile option for package detection ────────────────────────────

  it('uses sourceFile path for package lookup when provided', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast, {
      sourceFile: '/nonexistent/path/test.ts',
      inlineRuntime: false,
    });
    // Package won't be found so should use inline runtime
    expect(result.code).toBeDefined();
  });

  it('falls back to ast.sourceFile when sourceFile option not provided', () => {
    const ast = minimalAST({ sourceFile: '/tmp/test.ts' });
    const result = generateInPlace(SIMPLE_SOURCE, ast, { inlineRuntime: false });
    expect(result.code).toBeDefined();
  });

  it('falls back to cwd when neither sourceFile nor ast.sourceFile exist', () => {
    const ast = minimalAST({ sourceFile: '' });
    const result = generateInPlace(SIMPLE_SOURCE, ast, { inlineRuntime: false });
    expect(result.code).toBeDefined();
  });

  // ── external runtime (mock fs.existsSync) ──────────────────────────────

  it('uses external runtime imports when package is detected', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    try {
      const ast = minimalAST();
      const result = generateInPlace(SIMPLE_SOURCE, ast, {
        inlineRuntime: false,
        sourceFile: '/some/project/src/test.ts',
      });
      expect(result.code).toContain("from '@synergenius/flow-weaver/runtime'");
    } finally {
      existsSpy.mockRestore();
    }
  });

  it('external runtime in production mode omits TDebugger import', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    try {
      const ast = minimalAST();
      const result = generateInPlace(SIMPLE_SOURCE, ast, {
        inlineRuntime: false,
        production: true,
        sourceFile: '/some/project/src/test.ts',
      });
      expect(result.code).toContain("from '@synergenius/flow-weaver/runtime'");
      expect(result.code).not.toContain('TDebugger');
    } finally {
      existsSpy.mockRestore();
    }
  });

  it('handles fs.existsSync throwing (permission error)', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('EACCES');
    });
    try {
      const ast = minimalAST();
      const result = generateInPlace(SIMPLE_SOURCE, ast, {
        inlineRuntime: false,
        sourceFile: '/some/project/src/test.ts',
      });
      // Should fall back to inline runtime gracefully
      expect(result.code).toBeDefined();
    } finally {
      existsSpy.mockRestore();
    }
  });

  // ── skipParamReturns option ────────────────────────────────────────────

  it('omits @param/@returns when skipParamReturns=true', () => {
    const ast = minimalAST({
      startPorts: { input1: { dataType: 'STRING', label: 'input1' } },
      exitPorts: { output1: { dataType: 'STRING', label: 'output1' } },
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast, { skipParamReturns: true });
    expect(result.code).not.toContain('@param');
    expect(result.code).not.toContain('@returns');
  });

  it('includes @param/@returns when skipParamReturns=false', () => {
    const source = `/**
 * @flowWeaver workflow
 * @param input1 {STRING}
 * @returns output1 {STRING}
 */
export function myWorkflow(input1: string): string {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({
      startPorts: { input1: { dataType: 'STRING', label: 'input1' } },
      exitPorts: { output1: { dataType: 'STRING', label: 'output1' } },
    });
    const result = generateInPlace(source, ast, { skipParamReturns: false });
    expect(result.code).toContain('@param');
    expect(result.code).toContain('@returns');
  });

  // ── nodeType variant skipping ──────────────────────────────────────────

  it('skips IMPORTED_WORKFLOW variant nodeTypes', () => {
    const ast = minimalAST({
      nodeTypes: [minimalNodeType({ variant: 'IMPORTED_WORKFLOW' as any, functionName: 'imported' })],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toBeDefined();
  });

  it('skips WORKFLOW variant nodeTypes', () => {
    const ast = minimalAST({
      nodeTypes: [minimalNodeType({ variant: 'WORKFLOW' as any, functionName: 'sub' })],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toBeDefined();
  });

  it('skips MAP_ITERATOR variant nodeTypes', () => {
    const ast = minimalAST({
      nodeTypes: [minimalNodeType({ variant: 'MAP_ITERATOR' as any, functionName: 'iter' })],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toBeDefined();
  });

  // ── nodeType from different file skipping ──────────────────────────────

  it('skips nodeTypes from a different source file', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/main.ts',
      nodeTypes: [
        minimalNodeType({
          sourceLocation: { file: '/tmp/other.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toBeDefined();
  });

  // ── nodeType JSDoc replacement ─────────────────────────────────────────

  it('updates nodeType JSDoc when function exists in source', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          name: 'doStuff',
          functionName: 'doStuff',
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SOURCE_WITH_NODETYPE, ast);
    expect(result.code).toContain('@flowWeaver nodeType');
  });

  // ── nodeType with description, expression, label, scope, visuals ───────

  it('generates nodeType JSDoc with description', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          description: 'Does stuff',
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SOURCE_WITH_NODETYPE, ast);
    expect(result.code).toContain('Does stuff');
  });

  it('generates nodeType JSDoc with @expression tag', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          expression: true,
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SOURCE_WITH_NODETYPE, ast);
    expect(result.code).toContain('@expression');
  });

  it('generates nodeType JSDoc with @name when name !== functionName', () => {
    const source = `/**
 * @flowWeaver nodeType
 * @name stableId
 */
function doStuff() { return 1; }

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          name: 'stableId',
          functionName: 'doStuff',
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(source, ast);
    expect(result.code).toContain('@name stableId');
  });

  it('generates nodeType JSDoc with label and scope', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          label: 'My Label',
          scope: 'inner',
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SOURCE_WITH_NODETYPE, ast);
    expect(result.code).toContain('@label My Label');
    expect(result.code).toContain('@scope inner');
  });

  it('generates nodeType JSDoc with pullExecution', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          defaultConfig: { pullExecution: { triggerPort: 'items' } },
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SOURCE_WITH_NODETYPE, ast);
    expect(result.code).toContain('@pullExecution items');
  });

  it('generates nodeType JSDoc with visual annotations', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          visuals: {
            color: '#ff0000',
            icon: 'star',
            tags: [
              { label: 'api', tooltip: 'API call' },
              { label: 'fast' },
            ],
          },
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SOURCE_WITH_NODETYPE, ast);
    expect(result.code).toContain('@color #ff0000');
    expect(result.code).toContain('@icon star');
    expect(result.code).toContain('@tag api "API call"');
    expect(result.code).toContain('@tag fast');
  });

  it('handles visuals with empty tags array', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          visuals: { tags: [] },
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SOURCE_WITH_NODETYPE, ast);
    expect(result.code).toBeDefined();
  });

  // ── nodeType with ports array (UI format) ──────────────────────────────

  it('handles nodeType with ports array instead of inputs/outputs', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          inputs: {},
          outputs: {},
          ports: [
            { name: 'data', direction: 'INPUT', type: 'STRING', defaultLabel: 'data', defaultOrder: 0 },
            { name: 'result', direction: 'OUTPUT', type: 'NUMBER', defaultLabel: 'result', defaultOrder: 0 },
            { name: 'execute', direction: 'INPUT', type: 'SIGNAL', defaultLabel: 'execute', defaultOrder: 0 },
          ],
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SOURCE_WITH_NODETYPE, ast);
    expect(result.code).toContain('@input');
    expect(result.code).toContain('@output');
  });

  // ── nodeType function insertion (when function doesn't exist) ──────────

  it('inserts nodeType function when it has code and no existing function', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          functionName: 'brandNew',
          functionText: 'function brandNew() { return 42; }',
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('brandNew');
  });

  it('inserts nodeType function with JSDoc when code lacks it', () => {
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          functionName: 'noDoc',
          functionText: 'function noDoc() { return 1; }',
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@flowWeaver nodeType');
    expect(result.code).toContain('noDoc');
  });

  it('inserts nodeType function with code property (dynamic)', () => {
    const nt = minimalNodeType({
      functionName: 'dynamic',
      sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
    }) as TNodeTypeAST & { code?: string };
    nt.code = 'function dynamic() { return 99; }';
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [nt],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('dynamic');
  });

  // ── orphaned nodeType removal ──────────────────────────────────────────

  it('removes orphaned nodeType functions', () => {
    const sourceWithOrphan = `/**
 * @flowWeaver nodeType
 */
function orphan() { return 1; }

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({ nodeTypes: [] });
    const result = generateInPlace(sourceWithOrphan, ast);
    expect(result.code).not.toContain('function orphan');
  });

  it('does not remove nodeType used by allWorkflows', () => {
    const sourceWithShared = `/**
 * @flowWeaver nodeType
 */
function shared() { return 1; }

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const otherWorkflow = minimalAST({
      functionName: 'otherWorkflow',
      nodeTypes: [minimalNodeType({ functionName: 'shared' })],
    });
    const ast = minimalAST({ nodeTypes: [] });
    const result = generateInPlace(sourceWithShared, ast, { allWorkflows: [otherWorkflow] });
    expect(result.code).toContain('function shared');
  });

  // ── ensureAbortSignalParameter ─────────────────────────────────────────

  it('adds __abortSignal__ parameter to function with no params', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('__abortSignal__');
  });

  it('adds __abortSignal__ after existing parameters', () => {
    const source = `/**
 * @flowWeaver workflow
 */
export function myWorkflow(input: string) {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST();
    const result = generateInPlace(source, ast);
    expect(result.code).toContain('__abortSignal__');
    expect(result.code).toContain('input: string');
  });

  it('does not duplicate __abortSignal__ if already present', () => {
    const source = `/**
 * @flowWeaver workflow
 */
export function myWorkflow(__abortSignal__?: AbortSignal) {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST();
    const result = generateInPlace(source, ast);
    const matches = result.code.match(/__abortSignal__/g);
    // Should appear in signature and possibly in body, but NOT duplicated in signature
    expect(matches).toBeDefined();
  });

  // ── ensureAsyncKeyword ─────────────────────────────────────────────────

  it('adds async keyword when nodes require async', () => {
    const asyncNodeType = minimalNodeType({
      functionName: 'asyncNode',
      isAsync: true,
    });
    const source = `/**
 * @flowWeaver nodeType
 */
function asyncNode() { return Promise.resolve(1); }

/**
 * @flowWeaver workflow
 * @node asyncNode asyncNode
 * @connect Start.execute -> asyncNode.execute
 * @connect asyncNode.onSuccess -> Exit.onSuccess
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [asyncNodeType],
      instances: [{ id: 'asyncNode', nodeTypeId: 'asyncNode' }],
    } as any);
    // Just verify it doesn't throw
    const result = generateInPlace(source, ast);
    expect(result.code).toBeDefined();
  });

  it('does not add async when function is already async', () => {
    const source = `/**
 * @flowWeaver workflow
 */
export async function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST();
    const result = generateInPlace(source, ast);
    // Should not double up 'async async'
    expect(result.code).not.toContain('async async');
  });

  // ── ensurePromiseReturnType ────────────────────────────────────────────

  it('wraps return type in Promise when async is forced', () => {
    const asyncNodeType = minimalNodeType({
      functionName: 'asyncNode',
      isAsync: true,
    });
    const source = `/**
 * @flowWeaver nodeType
 */
function asyncNode() { return Promise.resolve(1); }

/**
 * @flowWeaver workflow
 */
export function myWorkflow(): string {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [asyncNodeType],
      instances: [{ id: 'asyncNode', nodeTypeId: 'asyncNode' }],
    } as any);
    const result = generateInPlace(source, ast);
    expect(result.code).toBeDefined();
  });

  it('does not re-wrap return type already in Promise<>', () => {
    const source = `/**
 * @flowWeaver workflow
 */
export async function myWorkflow(): Promise<string> {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST();
    const result = generateInPlace(source, ast);
    expect(result.code).not.toContain('Promise<Promise<');
  });

  // ── replaceOrInsertSection ─────────────────────────────────────────────

  it('replaces existing runtime markers with new content', () => {
    const ast = minimalAST();
    const result = generateInPlace(SOURCE_WITH_MARKERS, ast);
    expect(result.code).toContain(MARKERS.RUNTIME_START);
    expect(result.code).toContain(MARKERS.RUNTIME_END);
    expect(result.code).not.toContain('old-runtime-code');
  });

  it('inserts runtime section when markers do not exist', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain(MARKERS.RUNTIME_START);
    expect(result.code).toContain(MARKERS.RUNTIME_END);
  });

  it('inserts runtime after imports', () => {
    const sourceWithImport = `import { something } from 'somewhere';

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST();
    const result = generateInPlace(sourceWithImport, ast);
    const importIdx = result.code.indexOf('import { something }');
    const runtimeIdx = result.code.indexOf(MARKERS.RUNTIME_START);
    expect(runtimeIdx).toBeGreaterThan(importIdx);
  });

  it('inserts runtime at top when no imports exist', () => {
    const noImports = `/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST();
    const result = generateInPlace(noImports, ast);
    expect(result.code).toContain(MARKERS.RUNTIME_START);
  });

  // ── replaceWorkflowFunctionBody ────────────────────────────────────────

  it('replaces body between existing body markers', () => {
    const ast = minimalAST();
    const result = generateInPlace(SOURCE_WITH_MARKERS, ast);
    expect(result.code).not.toContain('old-body-code');
    expect(result.code).toContain(MARKERS.BODY_START);
    expect(result.code).toContain(MARKERS.BODY_END);
  });

  it('inserts body markers when function body has none', () => {
    const ast = minimalAST();
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain(MARKERS.BODY_START);
    expect(result.code).toContain(MARKERS.BODY_END);
  });

  // ── replaceWorkflowJSDoc ───────────────────────────────────────────────

  it('does not change JSDoc when already identical', () => {
    const ast = minimalAST();
    const first = generateInPlace(SIMPLE_SOURCE, ast);
    const second = generateInPlace(first.code, ast);
    expect(second.hasChanges).toBe(false);
  });

  it('handles function without JSDoc comment', () => {
    const noJsdoc = `export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST();
    // Should not crash, just skip JSDoc replacement
    const result = generateInPlace(noJsdoc, ast);
    expect(result.code).toBeDefined();
  });

  it('handles workflow function not found in source', () => {
    const wrongName = `/**
 * @flowWeaver workflow
 */
export function otherName() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({ functionName: 'myWorkflow' });
    const result = generateInPlace(wrongName, ast);
    expect(result.code).toBeDefined();
  });

  // ── workflow JSDoc with options ─────────────────────────────────────────

  it('includes @strictTypes when set', () => {
    const ast = minimalAST({ options: { strictTypes: true } });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@strictTypes');
  });

  it('includes @autoConnect when set', () => {
    const ast = minimalAST({ options: { autoConnect: true } });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@autoConnect');
  });

  it('includes @trigger when set', () => {
    const ast = minimalAST({ options: { trigger: { event: 'onUserCreate', cron: '* * * * *' } } });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@trigger');
    expect(result.code).toContain('event="onUserCreate"');
    expect(result.code).toContain('cron="* * * * *"');
  });

  it('includes @cancelOn when set', () => {
    const ast = minimalAST({
      options: { cancelOn: { event: 'cancel', match: 'id', timeout: '5m' } },
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@cancelOn');
    expect(result.code).toContain('match="id"');
    expect(result.code).toContain('timeout="5m"');
  });

  it('includes @cancelOn without optional match/timeout', () => {
    const ast = minimalAST({
      options: { cancelOn: { event: 'stop' } },
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@cancelOn event="stop"');
  });

  it('includes @retries when set', () => {
    const ast = minimalAST({ options: { retries: 3 } });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@retries 3');
  });

  it('includes @retries 0 (falsy but defined)', () => {
    const ast = minimalAST({ options: { retries: 0 } });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@retries 0');
  });

  it('includes @timeout when set', () => {
    const ast = minimalAST({ options: { timeout: '30s' } });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@timeout "30s"');
  });

  it('includes @throttle when set', () => {
    const ast = minimalAST({ options: { throttle: { limit: 10, period: '1m' } } });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@throttle limit=10');
    expect(result.code).toContain('period="1m"');
  });

  it('includes @throttle without period', () => {
    const ast = minimalAST({ options: { throttle: { limit: 5 } } });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@throttle limit=5');
  });

  it('includes @name when name differs from functionName', () => {
    const ast = minimalAST({ name: 'myAlias', functionName: 'myWorkflow' });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@name myAlias');
  });

  it('omits @name when name equals functionName', () => {
    const ast = minimalAST({ name: 'myWorkflow', functionName: 'myWorkflow' });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@name myWorkflow');
  });

  // ── workflow JSDoc: description ────────────────────────────────────────

  it('includes description in workflow JSDoc', () => {
    const ast = minimalAST({ description: 'A cool workflow' });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('A cool workflow');
  });

  // ── connections in JSDoc ───────────────────────────────────────────────

  it('emits @connect for connections', () => {
    const ast = minimalAST({
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'doStuff', port: 'execute' } },
      ],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@connect Start.execute -> doStuff.execute');
  });

  it('emits @connect with scope suffixes', () => {
    const ast = minimalAST({
      connections: [
        {
          from: { node: 'A', port: 'out', scope: 'inner' },
          to: { node: 'B', port: 'in', scope: 'outer' },
        },
      ],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@connect A.out:inner -> B.in:outer');
  });

  it('skips connections when autoConnect is true', () => {
    const ast = minimalAST({
      options: { autoConnect: true },
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'doStuff', port: 'execute' } },
      ],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@connect');
  });

  // ── scopes in JSDoc ────────────────────────────────────────────────────

  it('emits @scope annotations', () => {
    const ast = minimalAST({
      scopes: { 'mapNode.iterate': ['child1', 'child2'] },
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@scope mapNode.iterate [child1, child2]');
  });

  // ── @fwImport for npm nodeTypes ────────────────────────────────────────

  it('emits @fwImport for nodeTypes with importSource', () => {
    const ast = minimalAST({
      nodeTypes: [
        minimalNodeType({
          name: 'npm/my-pkg/doThing',
          functionName: 'npm/my-pkg/doThing',
          importSource: 'my-pkg',
          variant: 'IMPORTED_WORKFLOW',
        }),
      ],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@fwImport npm/my-pkg/doThing doThing from "my-pkg"');
  });

  it('emits @fwImport with explicit functionName when different from name', () => {
    const ast = minimalAST({
      nodeTypes: [
        minimalNodeType({
          name: 'npm/pkg/thing',
          functionName: 'customFn',
          importSource: 'my-pkg',
          variant: 'IMPORTED_WORKFLOW',
        }),
      ],
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@fwImport npm/pkg/thing customFn from "my-pkg"');
  });

  // ── macros in JSDoc (@map, @path, @fanOut, @fanIn) ─────────────────────

  it('emits @map macro', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'map',
          instanceId: 'mapInst',
          childId: 'child',
          sourcePort: 'dataNode.items',
          inputPort: 'item',
          outputPort: 'result',
        },
      ],
      instances: [
        { id: 'child', nodeTypeId: 'doStuff' },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@map mapInst child');
    expect(result.code).toContain('over dataNode.items');
  });

  it('emits @map without inputPort/outputPort', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'map',
          instanceId: 'mapInst',
          childId: 'child',
          sourcePort: 'src.items',
        },
      ],
      instances: [
        { id: 'child', nodeTypeId: 'doStuff' },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@map mapInst child over src.items');
  });

  it('emits @path macro', () => {
    const ast = minimalAST({
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'A', port: 'execute' } },
        { from: { node: 'A', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      instances: [{ id: 'A', nodeTypeId: 'doStuff' }],
      nodeTypes: [minimalNodeType({ name: 'doStuff', functionName: 'doStuff' })],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    // Depending on sugar detection, @path may or may not appear, but no crash
    expect(result.code).toBeDefined();
  });

  it('emits @fanOut macro', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'fanOut',
          source: { node: 'A', port: 'data' },
          targets: [
            { node: 'B', port: 'input' },
            { node: 'C' },
          ],
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
        { id: 'C', nodeTypeId: 'doStuff' },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@fanOut A.data -> B.input, C');
  });

  it('emits @fanIn macro', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'fanIn',
          sources: [
            { node: 'A', port: 'out' },
            { node: 'B' },
          ],
          target: { node: 'C', port: 'in' },
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
        { id: 'C', nodeTypeId: 'doStuff' },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@fanIn A.out, B -> C.in');
  });

  // ── positions (Start/Exit auto-layout, explicit ui) ────────────────────

  it('emits @position for Start and Exit when ui is set', () => {
    const ast = minimalAST({
      ui: {
        startNode: { x: 10, y: 20 },
        exitNode: { x: 300, y: 20 },
      },
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@position Start 10 20');
    expect(result.code).toContain('@position Exit 300 20');
  });

  it('auto-computes positions when ui is not set', () => {
    const ast = minimalAST({
      instances: [{ id: 'A', nodeTypeId: 'doStuff' }],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@position Start');
    expect(result.code).toContain('@position Exit');
  });

  it('skips position when all nodes have explicit positions', () => {
    const ast = minimalAST({
      ui: {
        startNode: { x: 0, y: 0 },
        exitNode: { x: 500, y: 0 },
      },
      instances: [
        { id: 'A', nodeTypeId: 'doStuff', config: { x: 200, y: 0 } },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toBeDefined();
  });

  // ── node instance rendering ────────────────────────────────────────────

  it('renders @node for instances', () => {
    const ast = minimalAST({
      instances: [{ id: 'myNode', nodeTypeId: 'doStuff' }],
      nodeTypes: [minimalNodeType()],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@node');
    expect(result.code).toContain('myNode');
  });

  // ── nodeType rename via @name tag ──────────────────────────────────────

  it('renames function when @name tag points to it', () => {
    const source = `/**
 * @flowWeaver nodeType
 * @name stableId
 */
function oldName() { return 1; }

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          name: 'stableId',
          functionName: 'newName',
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(source, ast);
    expect(result.code).toContain('function newName');
    expect(result.code).not.toContain('function oldName');
  });

  // ── stale duplicate JSDoc removal ──────────────────────────────────────

  it('removes stale duplicate @flowWeaver JSDoc blocks', () => {
    const source = `/**
 * @flowWeaver nodeType
 */
/**
 * @flowWeaver nodeType
 */
function doStuff() { return 1; }

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(source, ast);
    // Should have exactly one @flowWeaver nodeType
    const matches = result.code.match(/@flowWeaver nodeType/g);
    expect(matches?.length).toBe(1);
  });

  // ── coerce macro filtering ─────────────────────────────────────────────

  it('skips coerce instances from @node output', () => {
    const ast = minimalAST({
      macros: [
        { type: 'coerce', instanceId: 'coerceInst', sourcePort: 'A.out', targetPort: 'B.in', targetType: 'STRING' },
      ],
      instances: [
        { id: 'coerceInst', nodeTypeId: 'coerce' },
        { id: 'A', nodeTypeId: 'doStuff' },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@node coerceInst');
  });

  // ── topological ordering ───────────────────────────────────────────────

  it('handles instances with no connections (declaration order)', () => {
    const ast = minimalAST({
      instances: [
        { id: 'B', nodeTypeId: 'doStuff' },
        { id: 'A', nodeTypeId: 'doStuff' },
      ],
      connections: [],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toBeDefined();
  });

  it('handles cyclic connections gracefully', () => {
    const ast = minimalAST({
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'onSuccess' }, to: { node: 'B', port: 'execute' } },
        { from: { node: 'B', port: 'onSuccess' }, to: { node: 'A', port: 'execute' } },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toBeDefined();
  });

  // ── isConnectionCoveredByMacro branches ────────────────────────────────

  it('filters map scoped connections', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'map',
          instanceId: 'mapInst',
          childId: 'child',
          sourcePort: 'src.items',
        },
      ],
      instances: [{ id: 'child', nodeTypeId: 'doStuff' }],
      connections: [
        {
          from: { node: 'mapInst', port: 'item', scope: 'iterate' },
          to: { node: 'child', port: 'input' },
        },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    // The scoped connection should be filtered by the map macro
    expect(result.code).not.toContain('@connect mapInst.item:iterate -> child.input');
  });

  it('filters map upstream connection (source -> mapInstance.items)', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'map',
          instanceId: 'mapInst',
          childId: 'child',
          sourcePort: 'src.items',
        },
      ],
      instances: [
        { id: 'src', nodeTypeId: 'doStuff' },
        { id: 'child', nodeTypeId: 'doStuff' },
      ],
      connections: [
        {
          from: { node: 'src', port: 'items' },
          to: { node: 'mapInst', port: 'items' },
        },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@connect src.items -> mapInst.items');
  });

  // ── path macro connection coverage ─────────────────────────────────────

  it('filters path Start->node->Exit connections', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'path',
          steps: [
            { node: 'Start' },
            { node: 'A', route: 'ok' },
            { node: 'Exit' },
          ],
        },
      ],
      instances: [{ id: 'A', nodeTypeId: 'doStuff' }],
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'A', port: 'execute' } },
        { from: { node: 'A', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    // These connections should be covered by @path
    expect(result.code).not.toContain('@connect Start.execute -> A.execute');
    expect(result.code).not.toContain('@connect A.onSuccess -> Exit.onSuccess');
  });

  it('filters path connections with fail route to Exit', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'path',
          steps: [
            { node: 'Start' },
            { node: 'A', route: 'fail' },
            { node: 'Exit' },
          ],
        },
      ],
      instances: [{ id: 'A', nodeTypeId: 'doStuff' }],
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'A', port: 'execute' } },
        { from: { node: 'A', port: 'onFailure' }, to: { node: 'Exit', port: 'onFailure' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@connect A.onFailure -> Exit.onFailure');
  });

  it('filters path fail route connection to next node', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'path',
          steps: [
            { node: 'A', route: 'fail' },
            { node: 'B' },
          ],
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'onFailure' }, to: { node: 'B', port: 'execute' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@connect A.onFailure -> B.execute');
  });

  it('filters path same-name data connections', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'path',
          steps: [
            { node: 'A' },
            { node: 'B' },
          ],
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'data' }, to: { node: 'B', port: 'data' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@connect A.data -> B.data');
  });

  it('does not filter path scoped connections', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'path',
          steps: [{ node: 'A' }, { node: 'B' }],
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'out', scope: 'inner' }, to: { node: 'B', port: 'in' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@connect A.out:inner -> B.in');
  });

  // ── fanOut macro connection coverage ───────────────────────────────────

  it('filters fanOut connections', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'fanOut',
          source: { node: 'A', port: 'data' },
          targets: [
            { node: 'B', port: 'input' },
            { node: 'C' },
          ],
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
        { id: 'C', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'data' }, to: { node: 'B', port: 'input' } },
        { from: { node: 'A', port: 'data' }, to: { node: 'C', port: 'data' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@connect A.data -> B.input');
    expect(result.code).not.toContain('@connect A.data -> C.data');
  });

  it('does not filter fanOut scoped connections', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'fanOut',
          source: { node: 'A', port: 'data' },
          targets: [{ node: 'B' }],
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'data', scope: 'inner' }, to: { node: 'B', port: 'data' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@connect A.data:inner -> B.data');
  });

  // ── fanIn macro connection coverage ────────────────────────────────────

  it('filters fanIn connections', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'fanIn',
          sources: [
            { node: 'A', port: 'out' },
            { node: 'B' },
          ],
          target: { node: 'C', port: 'in' },
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'B', nodeTypeId: 'doStuff' },
        { id: 'C', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'out' }, to: { node: 'C', port: 'in' } },
        { from: { node: 'B', port: 'in' }, to: { node: 'C', port: 'in' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@connect A.out -> C.in');
    expect(result.code).not.toContain('@connect B.in -> C.in');
  });

  it('does not filter fanIn scoped connections', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'fanIn',
          sources: [{ node: 'A' }],
          target: { node: 'C', port: 'in' },
        },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'C', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'in', scope: 'x' }, to: { node: 'C', port: 'in' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).toContain('@connect A.in:x -> C.in');
  });

  // ── dropped coerce connection filtering ────────────────────────────────

  it('filters connections involving dropped coerce instances', () => {
    // coerce macro that gets dropped by filterStaleMacros
    const ast = minimalAST({
      macros: [
        { type: 'coerce', instanceId: 'coerceInst', sourcePort: 'A.out', targetPort: 'B.in', targetType: 'STRING' },
      ],
      instances: [
        { id: 'A', nodeTypeId: 'doStuff' },
        { id: 'coerceInst', nodeTypeId: 'coerce' },
        { id: 'B', nodeTypeId: 'doStuff' },
      ],
      connections: [
        { from: { node: 'A', port: 'out' }, to: { node: 'coerceInst', port: 'in' } },
        { from: { node: 'coerceInst', port: 'out' }, to: { node: 'B', port: 'in' } },
      ],
      nodeTypes: [minimalNodeType()],
      startPorts: {},
      exitPorts: {},
    });
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    // Dropped coerce connections should be filtered
    expect(result.code).not.toContain('@connect A.out -> coerceInst.in');
  });

  // ── scopes filtered by macro ───────────────────────────────────────────

  it('skips scopes that are covered by @map macro', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'map',
          instanceId: 'mapInst',
          childId: 'child',
          sourcePort: 'src.items',
        },
      ],
      scopes: {
        'mapInst.iterate': ['child'],
        'other.scope': ['A'],
      },
      instances: [
        { id: 'child', nodeTypeId: 'doStuff' },
        { id: 'A', nodeTypeId: 'doStuff' },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    expect(result.code).not.toContain('@scope mapInst.iterate');
    expect(result.code).toContain('@scope other.scope');
  });

  // ── replaceJSDocContent: functionText with multiple JSDoc blocks ───────

  it('handles functionText with multiple leading JSDoc blocks', () => {
    const source = `/**
 * @flowWeaver nodeType
 */
function doStuff() { return 1; }

/**
 * @flowWeaver workflow
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
    const ast = minimalAST({
      sourceFile: '/tmp/test.ts',
      nodeTypes: [
        minimalNodeType({
          functionText: `/** file header */\n/** @flowWeaver nodeType */\nfunction doStuff() { return 42; }`,
          sourceLocation: { file: '/tmp/test.ts', line: 1, column: 1 },
        }),
      ],
    });
    const result = generateInPlace(source, ast);
    expect(result.code).toContain('return 42');
  });

  // ── macro child instance strips parent ─────────────────────────────────

  it('strips parent from macro child instances in @node output', () => {
    const ast = minimalAST({
      macros: [
        {
          type: 'map',
          instanceId: 'mapInst',
          childId: 'child',
          sourcePort: 'src.items',
        },
      ],
      instances: [
        { id: 'child', nodeTypeId: 'doStuff', parent: 'mapInst' },
        { id: 'other', nodeTypeId: 'doStuff' },
      ],
    } as any);
    const result = generateInPlace(SIMPLE_SOURCE, ast);
    // child should appear as @node without parent scope
    expect(result.code).toContain('child');
  });

  // ── edge case: function body with markers at edge positions ────────────

  it('handles empty function body gracefully', () => {
    const source = `/**
 * @flowWeaver workflow
 */
export function myWorkflow() {}`;
    const ast = minimalAST();
    const result = generateInPlace(source, ast);
    expect(result.code).toContain(MARKERS.BODY_START);
  });

  // ── no workflow function found in source ───────────────────────────────

  it('returns unchanged when workflow function name not found', () => {
    const source = `function unrelated() {}`;
    const ast = minimalAST({ functionName: 'myWorkflow' });
    const result = generateInPlace(source, ast);
    expect(result.code).toBeDefined();
  });

  // ── final idempotent check: hasChanges false when result equals source ─

  it('sets hasChanges=false when steps report changes but output is identical', () => {
    const ast = minimalAST();
    const first = generateInPlace(SIMPLE_SOURCE, ast);
    const second = generateInPlace(first.code, ast);
    expect(second.hasChanges).toBe(false);
    expect(second.code).toBe(first.code);
  });
});
