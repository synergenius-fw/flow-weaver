/**
 * Coverage for chevrotain-parser/grammar-diagrams.ts uncovered lines:
 * - Lines 135-139: RepetitionWithSeparator and default/unknown GAST types in itemToEBNF
 * - Lines 318-325: generateGrammarDiagramFor function
 */
import { describe, it, expect } from 'vitest';
import {
  serializedToEBNF,
  generateGrammarDiagramFor,
  getAllGrammars,
} from '../../src/chevrotain-parser/grammar-diagrams.js';

describe('serializedToEBNF handles RepetitionWithSeparator (lines 135-136)', () => {
  it('renders RepetitionWithSeparator with Comma separator', () => {
    const productions = [
      {
        type: 'Rule',
        name: 'TestRule',
        definition: [
          {
            type: 'RepetitionWithSeparator',
            separator: { name: 'Comma' },
            definition: [
              { type: 'Terminal', name: 'Identifier', pattern: '[a-zA-Z_$][a-zA-Z0-9_$]*' },
            ],
          },
        ],
      },
    ];

    const result = serializedToEBNF(productions as any);
    expect(result).toContain('TestRule ::=');
    // RepetitionWithSeparator wraps in [ ... { "," ... } ]
    expect(result).toContain('[');
    expect(result).toContain('","');
    expect(result).toContain(']');
  });

  it('renders RepetitionWithSeparator with non-Comma separator', () => {
    const productions = [
      {
        type: 'Rule',
        name: 'PipeRule',
        definition: [
          {
            type: 'RepetitionWithSeparator',
            separator: { name: 'Pipe' },
            definition: [
              { type: 'Terminal', name: 'Value', pattern: '[a-zA-Z_$][a-zA-Z0-9_$]*' },
            ],
          },
        ],
      },
    ];

    const result = serializedToEBNF(productions as any);
    expect(result).toContain('PipeRule ::=');
    expect(result).toContain('"Pipe"');
  });

  it('renders RepetitionWithSeparator with no separator name', () => {
    const productions = [
      {
        type: 'Rule',
        name: 'NoSepRule',
        definition: [
          {
            type: 'RepetitionWithSeparator',
            definition: [
              { type: 'Terminal', name: 'Item', pattern: '[a-zA-Z_$][a-zA-Z0-9_$]*' },
            ],
          },
        ],
      },
    ];

    const result = serializedToEBNF(productions as any);
    expect(result).toContain('NoSepRule ::=');
    // Falls back to ',' when separator?.name is undefined, then ',' === 'Comma' is false
    // so it uses ',' literally
    expect(result).toContain('","');
  });
});

describe('serializedToEBNF handles unknown GAST type (lines 138-139)', () => {
  it('wraps unknown type in a comment', () => {
    const productions = [
      {
        type: 'Rule',
        name: 'UnknownRule',
        definition: [
          { type: 'SomeFutureGASTType' },
        ],
      },
    ];

    const result = serializedToEBNF(productions as any);
    expect(result).toContain('UnknownRule ::=');
    expect(result).toContain('/* SomeFutureGASTType */');
  });
});

describe('generateGrammarDiagramFor (lines 318-325)', () => {
  it('generates HTML for a specific grammar', () => {
    const html = generateGrammarDiagramFor('port');
    expect(html).toContain('<h1');
    expect(html).toContain('Port Grammar');
    expect(html).toContain('<div id="diagrams"');
  });

  it('generates HTML for the connect grammar', () => {
    const html = generateGrammarDiagramFor('connect');
    expect(html).toContain('Connect Grammar');
  });

  it('generates HTML for the node grammar', () => {
    const html = generateGrammarDiagramFor('node');
    expect(html).toContain('Node Grammar');
  });
});
