/**
 * Extractor for grammar rule documentation.
 *
 * Generates EBNF text and terminal definitions from the Chevrotain parsers
 * so the jsdoc-grammar.md reference doc stays in sync with source code.
 */

import {
  getAllGrammars,
  serializedToEBNF,
  type GrammarCollection,
} from '../../chevrotain-parser/grammar-diagrams.js';

export interface TGrammarGroupDoc {
  /** Grammar group name matching GrammarCollection keys */
  name: keyof GrammarCollection;
  /** EBNF text for this group */
  ebnf: string;
}

export interface TTerminalDoc {
  name: string;
  pattern: string;
  description: string;
}

/**
 * Extract EBNF for all grammar groups.
 */
export function extractGrammarEBNF(): TGrammarGroupDoc[] {
  const grammars = getAllGrammars();
  const groups: TGrammarGroupDoc[] = [];

  for (const [name, productions] of Object.entries(grammars)) {
    const ebnf = serializedToEBNF(productions);
    if (ebnf.trim()) {
      groups.push({ name: name as keyof GrammarCollection, ebnf });
    }
  }

  return groups;
}

/**
 * Extract terminal pattern definitions for the Terminals section of docs.
 *
 * These are the key token patterns from tokens.ts that users need to know.
 */
export function extractTerminals(): TTerminalDoc[] {
  return [
    {
      name: 'IDENTIFIER',
      pattern: '[a-zA-Z_$] [a-zA-Z0-9_$\\/-]*',
      description:
        'IDENTIFIER supports `/` and `-` to accommodate npm package naming conventions (e.g., `npm/react-window/areEqual`).',
    },
    {
      name: 'INTEGER',
      pattern: '"-"? [0-9]+',
      description: 'Signed integer literal.',
    },
    {
      name: 'STRING',
      pattern: `'"' { any character except '"' or '\\', or escape sequence } '"'`,
      description: 'Double-quoted string with escape sequences.',
    },
    {
      name: 'TEXT',
      pattern: 'any characters to end of line',
      description: 'Free-form text to end of line (used in descriptions).',
    },
  ];
}
