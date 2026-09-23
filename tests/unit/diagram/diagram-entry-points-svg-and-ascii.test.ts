/**
 * The diagram entry points: which renderer each format reaches, and how a
 * workflow is picked out of a file with several.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the parser
vi.mock('../../../src/parser/annotation-parser.js', () => ({
  parser: {
    parse: vi.fn(),
    parseFromString: vi.fn(),
  },
}));

// Mock internal diagram modules
vi.mock('../../../src/diagram/geometry.js', () => ({
  buildDiagramGraph: vi.fn(() => ({
    nodes: [],
    edges: [],
    width: 100,
    height: 100,
  })),
}));

vi.mock('../../../src/diagram/spine.js', () => ({
  renderSpineSVG: vi.fn(() => '<svg></svg>'),
}));

vi.mock('../../../src/diagram/ascii-renderer.js', () => ({
  renderASCII: vi.fn(() => 'ASCII output'),
  renderASCIICompact: vi.fn(() => 'COMPACT output'),
  renderText: vi.fn(() => 'TEXT output'),
}));

import { parser } from '../../../src/parser/annotation-parser.js';
import { buildDiagramGraph } from '../../../src/diagram/geometry.js';
import { renderSpineSVG } from '../../../src/diagram/spine.js';
import { renderASCIICompact, renderText } from '../../../src/diagram/ascii-renderer.js';

import {
  fileToSVG,
  sourceToSVG,
  workflowToSVG,
  workflowToASCII,
  sourceToASCII,
  fileToASCII,
} from '../../../src/diagram/index.js';

import type { TWorkflowAST } from '../../../src/ast/types.js';

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

describe('workflowToSVG', () => {
  it('draws the spine, passing the title options through', () => {
    const ast = makeAST('MyFlow');
    expect(workflowToSVG(ast, { theme: 'dark', title: false, subtitle: 'proj' })).toBe('<svg></svg>');
    expect(renderSpineSVG).toHaveBeenCalledWith(ast, { theme: 'dark', title: false, subtitle: 'proj' });
  });
});

describe('fileToSVG', () => {
  it('parses a file and draws the spine', () => {
    const ast = makeAST();
    mockedParse.mockReturnValueOnce({ workflows: [ast] } as any);

    const result = fileToSVG('/path/to/workflow.ts');
    expect(result).toBe('<svg></svg>');
    expect(mockedParse).toHaveBeenCalledWith('/path/to/workflow.ts');
    expect(renderSpineSVG).toHaveBeenCalledWith(ast, expect.anything());
  });
});

describe('sourceToSVG', () => {
  it('picks the named workflow', () => {
    const ast1 = makeAST('Alpha');
    const ast2 = makeAST('Beta');
    mockedParseFromString.mockReturnValueOnce({ workflows: [ast1, ast2] } as any);

    sourceToSVG('code', { workflowName: 'Beta' });
    expect(renderSpineSVG).toHaveBeenLastCalledWith(ast2, expect.anything());
  });

  it('throws when workflow not found by name', () => {
    const ast = makeAST('Alpha');
    mockedParseFromString.mockReturnValueOnce({ workflows: [ast] } as any);

    expect(() => sourceToSVG('code', { workflowName: 'Beta' })).toThrow(
      'Workflow "Beta" not found',
    );
  });

  it('throws when no workflows in source', () => {
    mockedParseFromString.mockReturnValueOnce({ workflows: [] } as any);
    expect(() => sourceToSVG('code')).toThrow('No workflows found');
  });
});

// ── ASCII / Text convenience functions ──

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
