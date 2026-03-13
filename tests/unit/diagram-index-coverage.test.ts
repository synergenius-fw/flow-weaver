/**
 * Coverage for src/diagram/index.ts uncovered lines:
 * - lines 32-41: fileToSVG, workflowToHTML
 * - lines 121-144: renderByFormat, workflowToASCII, sourceToASCII, fileToASCII
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the parser
vi.mock('../../src/parser.js', () => ({
  parser: {
    parse: vi.fn(),
    parseFromString: vi.fn(),
  },
}));

// Mock internal diagram modules
vi.mock('../../src/diagram/geometry.js', () => ({
  buildDiagramGraph: vi.fn(() => ({
    nodes: [],
    edges: [],
    width: 100,
    height: 100,
  })),
}));

vi.mock('../../src/diagram/renderer.js', () => ({
  renderSVG: vi.fn(() => '<svg></svg>'),
}));

vi.mock('../../src/diagram/html-viewer.js', () => ({
  wrapSVGInHTML: vi.fn(
    (svg: string, opts: any) => `<html>${svg}</html>`,
  ),
}));

vi.mock('../../src/diagram/ascii-renderer.js', () => ({
  renderASCII: vi.fn(() => 'ASCII output'),
  renderASCIICompact: vi.fn(() => 'COMPACT output'),
  renderText: vi.fn(() => 'TEXT output'),
}));

import { parser } from '../../src/parser.js';
import { buildDiagramGraph } from '../../src/diagram/geometry.js';
import { renderSVG } from '../../src/diagram/renderer.js';
import { wrapSVGInHTML } from '../../src/diagram/html-viewer.js';
import { renderASCII, renderASCIICompact, renderText } from '../../src/diagram/ascii-renderer.js';

import {
  fileToSVG,
  workflowToHTML,
  sourceToHTML,
  fileToHTML,
  workflowToASCII,
  sourceToASCII,
  fileToASCII,
  sourceToSVG,
} from '../../src/diagram/index.js';

import type { TWorkflowAST } from '../../src/ast/types.js';

const mockedParse = vi.mocked(parser.parse);
const mockedParseFromString = vi.mocked(parser.parseFromString);

function makeAST(name = 'TestWorkflow'): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: '/test.ts',
    name,
    functionName: name,
    nodeTypes: [
      {
        type: 'NodeType',
        functionName: 'myNode',
        description: 'A test node',
        inputs: { in1: { name: 'in1', dataType: 'string' } },
        outputs: { out1: { name: 'out1', dataType: 'number' } },
        functionText: 'function myNode() {}',
      } as any,
    ],
    instances: [
      { id: 'myNode1', nodeType: 'myNode' } as any,
    ],
    connections: [],
    startPorts: { input: { name: 'input', dataType: 'string', tsType: 'string' } as any },
    exitPorts: { output: { name: 'output', dataType: 'number', tsType: 'number' } as any },
    imports: [],
  };
}

describe('fileToSVG', () => {
  it('parses a file and renders SVG', () => {
    const ast = makeAST();
    mockedParse.mockReturnValueOnce({ workflows: [ast] } as any);

    const result = fileToSVG('/path/to/workflow.ts');
    expect(result).toBe('<svg></svg>');
    expect(mockedParse).toHaveBeenCalledWith('/path/to/workflow.ts');
    expect(buildDiagramGraph).toHaveBeenCalled();
    expect(renderSVG).toHaveBeenCalled();
  });
});

describe('workflowToHTML', () => {
  it('renders AST to HTML with node source map', () => {
    const ast = makeAST('MyFlow');
    const result = workflowToHTML(ast);
    expect(result).toContain('<html>');
    expect(wrapSVGInHTML).toHaveBeenCalledWith(
      '<svg></svg>',
      expect.objectContaining({ title: 'MyFlow' }),
    );
  });

  it('uses workflowName option for title when provided', () => {
    const ast = makeAST('MyFlow');
    workflowToHTML(ast, { workflowName: 'CustomTitle' });
    expect(wrapSVGInHTML).toHaveBeenCalledWith(
      '<svg></svg>',
      expect.objectContaining({ title: 'CustomTitle' }),
    );
  });
});

describe('sourceToHTML', () => {
  it('parses source and renders HTML', () => {
    const ast = makeAST();
    mockedParseFromString.mockReturnValueOnce({ workflows: [ast] } as any);

    const result = sourceToHTML('const x = 1;');
    expect(result).toContain('<html>');
  });

  it('throws when workflow not found by name', () => {
    const ast = makeAST('Alpha');
    mockedParseFromString.mockReturnValueOnce({ workflows: [ast] } as any);

    expect(() => sourceToHTML('code', { workflowName: 'Beta' })).toThrow(
      'Workflow "Beta" not found',
    );
  });

  it('throws when no workflows in source', () => {
    mockedParseFromString.mockReturnValueOnce({ workflows: [] } as any);
    expect(() => sourceToHTML('code')).toThrow('No workflows found');
  });
});

describe('fileToHTML', () => {
  it('parses a file and renders HTML', () => {
    const ast = makeAST();
    mockedParse.mockReturnValueOnce({ workflows: [ast] } as any);

    const result = fileToHTML('/path.ts');
    expect(result).toContain('<html>');
  });
});

// ── ASCII / Text convenience functions (lines 120-145) ──

describe('workflowToASCII', () => {
  it('renders ASCII by default', () => {
    const ast = makeAST();
    const result = workflowToASCII(ast);
    expect(buildDiagramGraph).toHaveBeenCalled();
    // Default format is 'ascii' via the ?? operator
    expect(typeof result).toBe('string');
  });

  it('renders ascii-compact format', () => {
    const ast = makeAST();
    workflowToASCII(ast, { format: 'ascii-compact' as any });
    expect(renderASCIICompact).toHaveBeenCalled();
  });

  it('renders text format', () => {
    const ast = makeAST();
    workflowToASCII(ast, { format: 'text' as any });
    expect(renderText).toHaveBeenCalled();
  });
});

describe('sourceToASCII', () => {
  it('parses source and renders ASCII', () => {
    const ast = makeAST();
    mockedParseFromString.mockReturnValueOnce({ workflows: [ast] } as any);

    const result = sourceToASCII('const x = 1;');
    expect(typeof result).toBe('string');
    expect(mockedParseFromString).toHaveBeenCalled();
  });

  it('selects named workflow', () => {
    const ast1 = makeAST('First');
    const ast2 = makeAST('Second');
    mockedParseFromString.mockReturnValueOnce({ workflows: [ast1, ast2] } as any);

    sourceToASCII('code', { workflowName: 'Second' });
    // Should not throw
  });
});

describe('fileToASCII', () => {
  it('parses a file and renders ASCII', () => {
    const ast = makeAST();
    mockedParse.mockReturnValueOnce({ workflows: [ast] } as any);

    const result = fileToASCII('/path.ts');
    expect(typeof result).toBe('string');
    expect(mockedParse).toHaveBeenCalledWith('/path.ts');
  });
});

// ── buildNodeSourceMap coverage (lines 67-98) ──

describe('workflowToHTML node source map', () => {
  it('builds port info for instances with matching node types', () => {
    const ast = makeAST();
    workflowToHTML(ast);

    const lastCall = vi.mocked(wrapSVGInHTML).mock.calls.at(-1)!;
    const opts = lastCall[1] as any;
    expect(opts.nodeSources).toBeDefined();
    // Should have entries for myNode1, Start, Exit
    expect(opts.nodeSources['myNode1']).toBeDefined();
    expect(opts.nodeSources['Start']).toBeDefined();
    expect(opts.nodeSources['Exit']).toBeDefined();
  });

  it('omits Start/Exit when no start/exit ports', () => {
    const ast = makeAST();
    ast.startPorts = {};
    ast.exitPorts = {};
    workflowToHTML(ast);

    const lastCall = vi.mocked(wrapSVGInHTML).mock.calls.at(-1)!;
    const opts = lastCall[1] as any;
    expect(opts.nodeSources['Start']).toBeUndefined();
    expect(opts.nodeSources['Exit']).toBeUndefined();
  });

  it('skips instances with unknown node types', () => {
    const ast = makeAST();
    ast.instances = [{ id: 'orphan1', nodeType: 'nonExistent' } as any];
    workflowToHTML(ast);

    const lastCall = vi.mocked(wrapSVGInHTML).mock.calls.at(-1)!;
    const opts = lastCall[1] as any;
    expect(opts.nodeSources['orphan1']).toBeUndefined();
  });
});
