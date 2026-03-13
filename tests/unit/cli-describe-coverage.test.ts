/**
 * Coverage for cli/commands/describe.ts:
 * - Lines 335-388: formatTextOutput with scoped node types (scopeNames branch)
 * - Lines 442-444: formatDescribeOutput with 'ascii' and 'ascii-compact' formats
 */
import { describe, it, expect, vi } from 'vitest';
import {
  formatTextOutput,
  formatDescribeOutput,
  describeWorkflow,
  type DescribeOutput,
} from '../../src/cli/commands/describe';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

// Mock the diagram modules since they pull in heavy dependencies
vi.mock('../../src/diagram/geometry', () => ({
  buildDiagramGraph: vi.fn(() => ({ nodes: [], edges: [] })),
}));
vi.mock('../../src/diagram/ascii-renderer', () => ({
  renderASCII: vi.fn(() => 'ASCII_OUTPUT'),
  renderASCIICompact: vi.fn(() => 'ASCII_COMPACT_OUTPUT'),
}));

function makeScopeAST(): TWorkflowAST {
  return {
    type: 'Workflow',
    functionName: 'testWorkflow',
    nodeTypes: [
      {
        type: 'NodeType',
        functionName: 'ForEach',
        scopes: ['processItem'],
        inputs: {
          execute: { dataType: 'STEP', isControlFlow: true },
          items: { dataType: 'ARRAY' },
          success: { dataType: 'STEP', isControlFlow: true, scope: 'processItem' },
          result: { dataType: 'STRING', scope: 'processItem' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          start: { dataType: 'STEP', isControlFlow: true, scope: 'processItem' },
          item: { dataType: 'STRING', scope: 'processItem' },
        },
      },
    ] as TNodeTypeAST[],
    instances: [
      { type: 'NodeInstance', id: 'Start', nodeType: 'Start' },
      { type: 'NodeInstance', id: 'Exit', nodeType: 'Exit' },
      { type: 'NodeInstance', id: 'loop', nodeType: 'ForEach' },
      { type: 'NodeInstance', id: 'child1', nodeType: 'Processor' },
    ],
    connections: [
      { type: 'Connection', from: { node: 'Start', port: 'onSuccess' }, to: { node: 'loop', port: 'execute' } },
      { type: 'Connection', from: { node: 'loop', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
    ],
    macros: [],
    scopes: {
      'loop.processItem': ['child1'],
    },
  } as unknown as TWorkflowAST;
}

describe('formatTextOutput: scoped node branch', () => {
  it('should display scope info with sends, receives, and children', () => {
    const ast = makeScopeAST();
    const output = describeWorkflow(ast) as DescribeOutput;
    const text = formatTextOutput(ast, output);

    expect(text).toContain('Scope "processItem"');
    expect(text).toContain('Sends to children');
    expect(text).toContain('Receives from children');
    expect(text).toContain('Children: child1');
  });
});

describe('formatDescribeOutput: ascii formats', () => {
  it('should return ASCII output for "ascii" format', () => {
    const ast = makeScopeAST();
    const output = describeWorkflow(ast) as DescribeOutput;
    const result = formatDescribeOutput(ast, output, 'ascii');
    expect(result).toBe('ASCII_OUTPUT');
  });

  it('should return ASCII compact output for "ascii-compact" format', () => {
    const ast = makeScopeAST();
    const output = describeWorkflow(ast) as DescribeOutput;
    const result = formatDescribeOutput(ast, output, 'ascii-compact');
    expect(result).toBe('ASCII_COMPACT_OUTPUT');
  });
});
