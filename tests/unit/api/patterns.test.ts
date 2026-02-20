import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  TPatternAST,
  TNodeTypeAST,
  TWorkflowAST,
  TNodeInstanceAST,
  TConnectionAST,
} from '../../../src/ast/types.js';

// ─── Mock AnnotationParser ──────────────────────────────────────────────────
const mockAnnotationParserParse = vi.fn();
vi.mock('../../../src/parser.js', () => {
  return {
    AnnotationParser: class MockAnnotationParser {
      parse(...args: unknown[]) {
        return mockAnnotationParserParse(...args);
      }
    },
  };
});

// ─── Mock glob ──────────────────────────────────────────────────────────────
const mockGlob = vi.fn();
vi.mock('glob', () => ({
  glob: (...args: unknown[]) => mockGlob(...args),
}));

import {
  listPatterns,
  applyPattern,
  generateNodeTypeCode,
  findWorkflows,
  extractPattern,
} from '../../../src/api/patterns.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makePattern(overrides?: Partial<TPatternAST>): TPatternAST {
  return {
    type: 'Pattern',
    sourceFile: '/test/pattern.ts',
    name: 'test-pattern',
    description: 'A test pattern',
    nodeTypes: [],
    instances: [
      { type: 'NodeInstance', id: 'a', nodeType: 'process', config: {} },
      { type: 'NodeInstance', id: 'b', nodeType: 'transform', config: {} },
    ],
    connections: [{ type: 'Connection' as const, from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } }],
    inputPorts: { data: { description: 'Input data' } },
    outputPorts: { result: { description: 'Output result' } },
    ...overrides,
  };
}

function makeNodeType(overrides?: Partial<TNodeTypeAST>): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: 'process',
    functionName: 'process',
    inputs: {
      execute: { direction: 'input' },
      data: { direction: 'input', label: 'Input data', tsType: 'string' },
    },
    outputs: {
      onSuccess: { direction: 'output' },
      onFailure: { direction: 'output' },
      result: { direction: 'output', label: 'Result value', tsType: 'number' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'always',
    isAsync: false,
    ...overrides,
  } as TNodeTypeAST;
}

const TARGET_CONTENT = [
  '/**',
  ' * @flowWeaver workflow',
  ' * @node proc1 process',
  ' */',
  'function testWorkflow() {}',
].join('\n');

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('listPatterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no patterns found', () => {
    mockAnnotationParserParse.mockReturnValue({
      patterns: [],
      workflows: [],
      nodeTypes: [],
      errors: [],
    });

    const result = listPatterns('/test/empty.ts');
    expect(result).toEqual([]);
  });

  it('returns structured pattern info', () => {
    mockAnnotationParserParse.mockReturnValue({
      patterns: [makePattern()],
      workflows: [],
      nodeTypes: [],
      errors: [],
    });

    const result = listPatterns('/test/pattern.ts');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test-pattern');
    expect(result[0].description).toBe('A test pattern');
    expect(result[0].inputPorts).toEqual([{ name: 'IN.data', description: 'Input data' }]);
    expect(result[0].outputPorts).toEqual([{ name: 'OUT.result', description: 'Output result' }]);
    expect(result[0].nodes).toEqual(['a', 'b']);
  });

  it('returns multiple patterns from one file', () => {
    mockAnnotationParserParse.mockReturnValue({
      patterns: [makePattern({ name: 'pattern-1' }), makePattern({ name: 'pattern-2' })],
      workflows: [],
      nodeTypes: [],
      errors: [],
    });

    const result = listPatterns('/test/multi.ts');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('pattern-1');
    expect(result[1].name).toBe('pattern-2');
  });

  it('propagates parse errors', () => {
    mockAnnotationParserParse.mockImplementation(() => {
      throw new Error('File not found');
    });

    expect(() => listPatterns('/test/missing.ts')).toThrow('File not found');
  });
});

describe('applyPattern', () => {
  it('inserts node and connection annotations into workflow', () => {
    const result = applyPattern({
      patternAST: makePattern(),
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(),
    });

    expect(result.modifiedContent).toContain('@node a process');
    expect(result.modifiedContent).toContain('@node b transform');
    expect(result.modifiedContent).toContain('@connect a.onSuccess -> b.execute');
    expect(result.nodesAdded).toBe(2);
    expect(result.connectionsAdded).toBe(1);
  });

  it('applies prefix to node IDs and connections', () => {
    const result = applyPattern({
      patternAST: makePattern(),
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(),
      prefix: 'retry',
    });

    expect(result.modifiedContent).toContain('@node retry_a process');
    expect(result.modifiedContent).toContain('@node retry_b transform');
    expect(result.modifiedContent).toContain('@connect retry_a.onSuccess -> retry_b.execute');
  });

  it('detects node type conflicts', () => {
    const pattern = makePattern({
      nodeTypes: [makeNodeType({ name: 'process' }), makeNodeType({ name: 'newType' })],
    });

    const result = applyPattern({
      patternAST: pattern,
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(['process']),
    });

    expect(result.conflicts).toEqual(['process']);
    expect(result.nodeTypesAdded).toEqual(['newType']);
  });

  it('generates node type functions for non-conflicting types', () => {
    const pattern = makePattern({
      nodeTypes: [makeNodeType({ name: 'brandNew' })],
    });

    const result = applyPattern({
      patternAST: pattern,
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(),
    });

    expect(result.nodeTypesAdded).toEqual(['brandNew']);
    expect(result.modifiedContent).toContain('function brandNew(');
  });

  it('does not generate node type functions for conflicting types', () => {
    const pattern = makePattern({
      nodeTypes: [makeNodeType({ name: 'process' })],
    });

    const result = applyPattern({
      patternAST: pattern,
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(['process']),
    });

    expect(result.nodeTypesAdded).toEqual([]);
    // Should not contain a generated function for 'process'
    expect(result.modifiedContent).not.toContain('function process(');
  });

  it('produces wiring instructions for IN/OUT connections', () => {
    const pattern = makePattern({
      connections: [
        { type: 'Connection' as const, from: { node: 'IN', port: 'data' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection' as const, from: { node: 'b', port: 'onSuccess' }, to: { node: 'OUT', port: 'result' } },
        { type: 'Connection' as const, from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
      ],
    });

    const result = applyPattern({
      patternAST: pattern,
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(),
    });

    expect(result.wiringInstructions).toHaveLength(2);
    expect(result.wiringInstructions[0]).toContain('IN.data');
    expect(result.wiringInstructions[1]).toContain('OUT.result');
    // Only the internal connection should be a connect declaration
    expect(result.connectionsAdded).toBe(1);
  });

  it('includes position declarations for nodes with coordinates', () => {
    const pattern = makePattern({
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'process', config: { x: 100, y: 200 } },
        { type: 'NodeInstance', id: 'b', nodeType: 'transform', config: {} },
      ],
    });

    const result = applyPattern({
      patternAST: pattern,
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(),
    });

    expect(result.modifiedContent).toContain('@position a 100 200');
  });

  it('WU10: produces wiringOperations as fw_modify_batch operations', () => {
    const pattern = makePattern({
      connections: [
        { type: 'Connection' as const, from: { node: 'IN', port: 'data' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection' as const, from: { node: 'b', port: 'onSuccess' }, to: { node: 'OUT', port: 'result' } },
        { type: 'Connection' as const, from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
      ],
    });

    const result = applyPattern({
      patternAST: pattern,
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(),
    });

    // Should have wiringOperations alongside wiringInstructions
    expect(result.wiringOperations).toBeDefined();
    expect(result.wiringOperations).toHaveLength(2);

    // Each operation should be a structured fw_modify_batch operation
    for (const op of result.wiringOperations) {
      expect(op.operation).toBe('addConnection');
      expect(op.params).toBeDefined();
      expect(op.params.from).toBeDefined();
      expect(op.params.to).toBeDefined();
      // from/to should be in "node.port" format
      expect(op.params.from).toContain('.');
      expect(op.params.to).toContain('.');
    }

    // IN connection: from placeholder to a.execute
    expect(result.wiringOperations[0].params.to).toBe('a.execute');
    expect(result.wiringOperations[0].params.from).toContain('data');

    // OUT connection: from b.onSuccess to placeholder
    expect(result.wiringOperations[1].params.from).toBe('b.onSuccess');
    expect(result.wiringOperations[1].params.to).toContain('result');
  });

  it('WU10: wiringOperations should use prefix when provided', () => {
    const pattern = makePattern({
      connections: [
        { type: 'Connection' as const, from: { node: 'IN', port: 'data' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection' as const, from: { node: 'b', port: 'onSuccess' }, to: { node: 'OUT', port: 'result' } },
      ],
    });

    const result = applyPattern({
      patternAST: pattern,
      targetContent: TARGET_CONTENT,
      targetNodeTypes: new Set(),
      prefix: 'retry',
    });

    expect(result.wiringOperations).toHaveLength(2);
    expect(result.wiringOperations[0].params.to).toBe('retry_a.execute');
    expect(result.wiringOperations[1].params.from).toBe('retry_b.onSuccess');
  });

  it('throws when target has no @flowWeaver workflow', () => {
    expect(() =>
      applyPattern({
        patternAST: makePattern(),
        targetContent: '// no workflow annotation here',
        targetNodeTypes: new Set(),
      })
    ).toThrow('No @flowWeaver workflow found');
  });

  it('strips @autoConnect from target when pattern adds internal connections', () => {
    const autoConnectTarget = [
      '/**',
      ' * @flowWeaver workflow',
      ' * @autoConnect',
      ' * @node proc1 process',
      ' */',
      'function testWorkflow() {}',
    ].join('\n');

    const result = applyPattern({
      patternAST: makePattern(), // has internal connection: a.onSuccess -> b.execute
      targetContent: autoConnectTarget,
      targetNodeTypes: new Set(),
    });

    // @autoConnect should be stripped since pattern adds explicit @connect
    expect(result.modifiedContent).not.toContain('@autoConnect');
    // Internal connection should be present
    expect(result.modifiedContent).toContain('@connect a.onSuccess -> b.execute');
    // Should inform user via wiring instructions
    expect(result.wiringInstructions.some((w) => w.includes('@autoConnect was removed'))).toBe(true);
  });

  it('preserves @autoConnect when pattern has no internal connections (only IN/OUT wiring)', () => {
    const autoConnectTarget = [
      '/**',
      ' * @flowWeaver workflow',
      ' * @autoConnect',
      ' * @node proc1 process',
      ' */',
      'function testWorkflow() {}',
    ].join('\n');

    const patternWithOnlyBoundary = makePattern({
      connections: [
        { type: 'Connection' as const, from: { node: 'IN', port: 'data' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection' as const, from: { node: 'b', port: 'onSuccess' }, to: { node: 'OUT', port: 'result' } },
      ],
    });

    const result = applyPattern({
      patternAST: patternWithOnlyBoundary,
      targetContent: autoConnectTarget,
      targetNodeTypes: new Set(),
    });

    // @autoConnect should be preserved — no internal @connect lines were added
    expect(result.modifiedContent).toContain('@autoConnect');
    expect(result.connectionsAdded).toBe(0);
  });
});

describe('generateNodeTypeCode', () => {
  it('generates function with correct name', () => {
    const code = generateNodeTypeCode(makeNodeType({ name: 'myProcessor' }));
    expect(code).toContain('function myProcessor(');
  });

  it('includes @flowWeaver nodeType annotation', () => {
    const code = generateNodeTypeCode(makeNodeType());
    expect(code).toContain('@flowWeaver nodeType');
  });

  it('includes @label when present', () => {
    const code = generateNodeTypeCode(makeNodeType({ label: 'My Processor' }));
    expect(code).toContain('@label My Processor');
  });

  it('skips execute input and onSuccess/onFailure outputs in annotations', () => {
    const code = generateNodeTypeCode(makeNodeType());
    expect(code).toContain('@input data');
    expect(code).toContain('@output result');
    expect(code).not.toContain('@input execute');
    expect(code).not.toContain('@output onSuccess');
    expect(code).not.toContain('@output onFailure');
  });

  it('generates execute parameter and standard return fields', () => {
    const code = generateNodeTypeCode(makeNodeType());
    expect(code).toContain('execute: boolean');
    expect(code).toContain('onSuccess: true');
    expect(code).toContain('onFailure: false');
  });

  it('includes custom input params and output fields', () => {
    const code = generateNodeTypeCode(makeNodeType());
    expect(code).toContain('data: string');
    expect(code).toContain('result: null');
  });

  it('should use functionText when available instead of generating stub', () => {
    const originalCode = `/**
 * @flowWeaver nodeType
 * @expression
 * @label Uppercase
 * @input text
 * @output result
 */
function uppercase(text: string): string {
  return text.toUpperCase();
}`;

    const code = generateNodeTypeCode(
      makeNodeType({
        name: 'uppercase',
        functionText: originalCode,
      })
    );

    expect(code).toContain('text.toUpperCase()');
    expect(code).toContain('@expression');
    expect(code).not.toContain('onSuccess: true'); // Should NOT be a stub
  });

  it('should fall back to stub when functionText is undefined', () => {
    const code = generateNodeTypeCode(makeNodeType());
    expect(code).toContain('onSuccess: true');
    expect(code).toContain('execute: boolean');
  });
});

// ─── findWorkflows Tests ────────────────────────────────────────────────────

describe('findWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no files found', async () => {
    mockGlob.mockResolvedValue([]);

    const result = await findWorkflows('/test/dir');
    expect(result).toEqual([]);
  });

  it('returns workflows from files containing @flowWeaver workflow', async () => {
    mockGlob.mockResolvedValue(['/test/dir/a.ts', '/test/dir/b.ts']);
    mockAnnotationParserParse.mockImplementation((filePath: string) => {
      if (filePath === '/test/dir/a.ts') {
        return {
          patterns: [],
          workflows: [
            {
              name: 'myWorkflow',
              functionName: 'myWorkflow',
              instances: [
                { id: 'n1', nodeType: 'process', config: {} },
                { id: 'n2', nodeType: 'transform', config: {} },
              ],
              connections: [
                { from: { node: 'n1', port: 'onSuccess' }, to: { node: 'n2', port: 'execute' } },
              ],
            },
          ],
          nodeTypes: [],
          errors: [],
        };
      }
      return { patterns: [], workflows: [], nodeTypes: [], errors: [] };
    });

    const result = await findWorkflows('/test/dir');
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('/test/dir/a.ts');
    expect(result[0].workflows).toHaveLength(1);
    expect(result[0].workflows[0].name).toBe('myWorkflow');
    expect(result[0].workflows[0].nodeCount).toBe(2);
    expect(result[0].workflows[0].connectionCount).toBe(1);
  });

  it('skips files that fail to parse', async () => {
    mockGlob.mockResolvedValue(['/test/dir/good.ts', '/test/dir/bad.ts']);
    mockAnnotationParserParse.mockImplementation((filePath: string) => {
      if (filePath === '/test/dir/bad.ts') {
        throw new Error('Parse error');
      }
      return {
        patterns: [],
        workflows: [
          {
            name: 'wf',
            functionName: 'wf',
            instances: [],
            connections: [],
          },
        ],
        nodeTypes: [],
        errors: [],
      };
    });

    const result = await findWorkflows('/test/dir');
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('/test/dir/good.ts');
  });

  it('passes custom glob pattern', async () => {
    mockGlob.mockResolvedValue([]);

    await findWorkflows('/test/dir', 'src/**/*.workflow.ts');
    expect(mockGlob).toHaveBeenCalledWith('src/**/*.workflow.ts', {
      cwd: '/test/dir',
      absolute: true,
    });
  });

  it('uses default pattern when none specified', async () => {
    mockGlob.mockResolvedValue([]);

    await findWorkflows('/test/dir');
    expect(mockGlob).toHaveBeenCalledWith('**/*.ts', { cwd: '/test/dir', absolute: true });
  });

  it('returns multiple workflows from a single file', async () => {
    mockGlob.mockResolvedValue(['/test/dir/multi.ts']);
    mockAnnotationParserParse.mockReturnValue({
      patterns: [],
      workflows: [
        { name: 'wf1', functionName: 'wf1', instances: [], connections: [] },
        {
          name: 'wf2',
          functionName: 'wf2',
          instances: [{ id: 'a', nodeType: 'x', config: {} }],
          connections: [],
        },
      ],
      nodeTypes: [],
      errors: [],
    });

    const result = await findWorkflows('/test/dir');
    expect(result).toHaveLength(1);
    expect(result[0].workflows).toHaveLength(2);
    expect(result[0].workflows[0].nodeCount).toBe(0);
    expect(result[0].workflows[1].nodeCount).toBe(1);
  });
});

// ─── extractPattern Tests ───────────────────────────────────────────────────

describe('extractPattern', () => {
  function makeWorkflowAST(overrides?: Partial<TWorkflowAST>): TWorkflowAST {
    return {
      type: 'Workflow',
      sourceFile: '/test/workflow.ts',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      nodeTypes: [],
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'process', config: {} },
        { type: 'NodeInstance', id: 'b', nodeType: 'transform', config: {} },
        { type: 'NodeInstance', id: 'c', nodeType: 'output', config: {} },
      ] as TNodeInstanceAST[],
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
        { from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as TConnectionAST[],
      ...overrides,
    } as TWorkflowAST;
  }

  it('extracts a pattern with correct internal connections', () => {
    const result = extractPattern({
      workflowAST: makeWorkflowAST(),
      nodeTypes: [],
      nodeIds: ['a', 'b'],
    });

    expect(result.patternName).toBe('extracted_a_b');
    expect(result.nodes).toEqual(['a', 'b']);
    expect(result.internalConnectionCount).toBe(1);
    expect(result.patternCode).toContain('@connect a.onSuccess -> b.execute');
  });

  it('identifies IN boundary connections', () => {
    const result = extractPattern({
      workflowAST: makeWorkflowAST(),
      nodeTypes: [],
      nodeIds: ['a', 'b'],
    });

    expect(result.inputPorts).toContain('execute');
    expect(result.patternCode).toContain('IN.execute');
  });

  it('identifies OUT boundary connections', () => {
    const result = extractPattern({
      workflowAST: makeWorkflowAST(),
      nodeTypes: [],
      nodeIds: ['a', 'b'],
    });

    expect(result.outputPorts).toContain('execute');
    expect(result.patternCode).toContain('OUT.execute');
  });

  it('uses custom name when provided', () => {
    const result = extractPattern({
      workflowAST: makeWorkflowAST(),
      nodeTypes: [],
      nodeIds: ['a', 'b'],
      name: 'my-custom-pattern',
    });

    expect(result.patternName).toBe('my-custom-pattern');
    expect(result.patternCode).toContain('@name my-custom-pattern');
  });

  it('throws when nodes are not found', () => {
    expect(() =>
      extractPattern({
        workflowAST: makeWorkflowAST(),
        nodeTypes: [],
        nodeIds: ['a', 'missing'],
      })
    ).toThrow('Nodes not found: missing');
  });

  it('includes node type functions for used types', () => {
    const result = extractPattern({
      workflowAST: makeWorkflowAST(),
      nodeTypes: [makeNodeType({ name: 'process' }), makeNodeType({ name: 'unused' })],
      nodeIds: ['a'],
    });

    expect(result.patternCode).toContain('function process(');
    expect(result.patternCode).not.toContain('function unused(');
  });

  it('includes positions for nodes that have them', () => {
    const workflow = makeWorkflowAST({
      instances: [
        { type: 'NodeInstance', id: 'a', nodeType: 'process', config: { x: 100, y: 200 } },
        { type: 'NodeInstance', id: 'b', nodeType: 'transform', config: {} },
      ] as TNodeInstanceAST[],
    });

    const result = extractPattern({
      workflowAST: workflow,
      nodeTypes: [],
      nodeIds: ['a', 'b'],
    });

    expect(result.patternCode).toContain('@position a 100 200');
  });

  it('generates valid pattern annotation block', () => {
    const result = extractPattern({
      workflowAST: makeWorkflowAST(),
      nodeTypes: [],
      nodeIds: ['a'],
    });

    expect(result.patternCode).toContain('@flowWeaver pattern');
    expect(result.patternCode).toContain('@node a process');
    expect(result.patternCode).toContain('function patternPlaceholder() {}');
  });

  it('should preserve functionText in extracted node types', () => {
    const nodeTypeWithText = makeNodeType({
      name: 'process',
      functionText:
        'function process(execute: boolean, data: string) { return { onSuccess: true, onFailure: false, result: data.toUpperCase() }; }',
    });

    const result = extractPattern({
      workflowAST: makeWorkflowAST(),
      nodeTypes: [nodeTypeWithText],
      nodeIds: ['a'],
    });

    expect(result.patternCode).toContain('data.toUpperCase()');
  });
});
