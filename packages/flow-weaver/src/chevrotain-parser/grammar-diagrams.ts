/**
 * @module chevrotain-parser/grammar-diagrams
 *
 * Generates railroad diagrams for all JSDoc grammars using Chevrotain.
 */

import { createSyntaxDiagramsCode, ISerializedGast } from 'chevrotain';
import { getPortGrammar } from './port-parser';
import { getNodeGrammar } from './node-parser';
import { getConnectGrammar } from './connect-parser';
import { getPositionGrammar } from './position-parser';
import { getScopeGrammar } from './scope-parser';
import { getPathGrammar } from './path-parser';

// =============================================================================
// EBNF Text Generation
// =============================================================================

// Type for Chevrotain's serialized GAST rule structure
interface ISerializedGastItem {
  type: string;
  name?: string;
  pattern?: string;
  terminalLabel?: string;
  definition?: ISerializedGastItem[];
  separator?: { name?: string };
}

export function serializedToEBNF(productions: ISerializedGast[]): string {
  const lines: string[] = [];

  for (const prod of productions) {
    if (prod.type === 'Rule') {
      // Access rule properties with type assertion
      const rule = prod as ISerializedGast & { name?: string; definition?: ISerializedGastItem[] };
      if (rule.definition && rule.name) {
        const body = definitionToEBNF(rule.definition);
        lines.push(`${rule.name} ::= ${body}`);
      }
    }
  }

  return lines.join('\n\n');
}

function definitionToEBNF(definition: ISerializedGastItem[]): string {
  return definition.map((item) => itemToEBNF(item)).join(' ');
}

function itemToEBNF(item: ISerializedGastItem): string {
  switch (item.type) {
    case 'Terminal':
      const pattern = item.pattern || '';

      // Show readable patterns for known tokens
      if (pattern.startsWith('@')) {
        return `"${pattern.replace('\\b', '')}"`;
      }

      // Punctuation
      const punctuation: Record<string, string> = {
        '->': '"->"',
        ':': '":"',
        ',': '","',
        '=': '"="',
        '-': '"-"',
        '\\.': '"."',
        '\\[': '"["',
        '\\]': '"]"',
        '\\(': '"("',
        '\\)': '")"',
      };
      if (punctuation[pattern]) return punctuation[pattern];

      // Keywords
      if (pattern === 'scope:') return '"scope:"';
      if (pattern === 'order:') return '"order:"';
      if (pattern === 'placement:') return '"placement:"';
      if (pattern === 'label:') return '"label:"';
      if (pattern === 'expr:') return '"expr:"';
      if (pattern === 'portOrder:') return '"portOrder:"';
      if (pattern === 'pullExecution:') return '"pullExecution:"';
      if (pattern === 'minimized\\b') return '"minimized"';
      if (pattern === 'TOP\\b') return '"TOP"';
      if (pattern === 'BOTTOM\\b') return '"BOTTOM"';

      // Identifier pattern - use semantic name if available
      if (pattern === '[a-zA-Z_$][a-zA-Z0-9_$]*') {
        const semanticName = item.terminalLabel || 'IDENTIFIER';
        return semanticName;
      }

      // Integer pattern
      if (pattern === '-?\\d+') {
        return item.terminalLabel || 'INTEGER';
      }

      // String literal
      if (pattern.includes('(?:[^"\\\\]|\\\\.)*')) {
        return item.terminalLabel || 'STRING';
      }

      // Fallback
      return item.terminalLabel || item.name || 'unknown';

    case 'NonTerminal':
      return `<${item.name || 'unknown'}>`;

    case 'Alternation':
      const alts = (item.definition || []).map((alt: ISerializedGastItem) => {
        if (alt.type === 'Alternative' && alt.definition) {
          return definitionToEBNF(alt.definition);
        }
        return itemToEBNF(alt);
      });
      return `( ${alts.join(' | ')} )`;

    case 'Option':
      return `[ ${definitionToEBNF(item.definition || [])} ]`;

    case 'Repetition':
      return `{ ${definitionToEBNF(item.definition || [])} }`;

    case 'RepetitionMandatory':
      return `${definitionToEBNF(item.definition || [])}+`;

    case 'RepetitionMandatoryWithSeparator':
      const sepName = item.separator?.name || ',';
      return `${definitionToEBNF(item.definition || [])} { "${sepName === 'Comma' ? ',' : sepName}" ${definitionToEBNF(item.definition || [])} }`;

    case 'RepetitionWithSeparator':
      const sep = item.separator?.name || ',';
      return `[ ${definitionToEBNF(item.definition || [])} { "${sep === 'Comma' ? ',' : sep}" ${definitionToEBNF(item.definition || [])} } ]`;

    default:
      return `/* ${item.type} */`;
  }
}

// =============================================================================
// Types
// =============================================================================

export interface GrammarCollection {
  port: ISerializedGast[];
  node: ISerializedGast[];
  connect: ISerializedGast[];
  position: ISerializedGast[];
  scope: ISerializedGast[];
  path: ISerializedGast[];
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get all grammar productions as serialized GAST (Grammar AST).
 */
export function getAllGrammars(): GrammarCollection {
  return {
    port: getPortGrammar(),
    node: getNodeGrammar(),
    connect: getConnectGrammar(),
    position: getPositionGrammar(),
    scope: getScopeGrammar(),
    path: getPathGrammar(),
  };
}

/**
 * Generate standalone HTML with railroad diagrams for all grammars.
 * Uses Chevrotain's createSyntaxDiagramsCode which returns a complete HTML page.
 */
export function generateGrammarDiagrams(): string {
  const grammars = getAllGrammars();

  // Combine all grammars for unified diagram
  const allProductions = [
    ...grammars.port,
    ...grammars.node,
    ...grammars.connect,
    ...grammars.position,
    ...grammars.scope,
    ...grammars.path,
  ];

  // createSyntaxDiagramsCode returns a complete HTML document
  const html = createSyntaxDiagramsCode(allProductions);

  // Generate EBNF text
  const ebnf = serializedToEBNF(allProductions);

  // Inject custom styling and header into the generated HTML
  const customStyles = `
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
    background-color: #f8f9fa !important;
  }
  h1.grammar-title {
    text-align: center;
    color: #333;
    margin-bottom: 0.5rem;
    font-size: 2rem;
  }
  .back-link {
    display: block;
    text-align: center;
    margin-bottom: 2rem;
    color: #4a90d9;
    text-decoration: none;
  }
  .back-link:hover { text-decoration: underline; }
  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 0;
    border-bottom: 2px solid #ddd;
  }
  .tab {
    padding: 0.75rem 1.5rem;
    cursor: pointer;
    background: #e9ecef;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    font-size: 1rem;
    color: #666;
  }
  .tab:hover { background: #dee2e6; }
  .tab.active {
    background: #fff;
    border-bottom-color: #4a90d9;
    color: #333;
    font-weight: 500;
  }
  .tab-content { display: none; padding: 1rem 0; }
  .tab-content.active { display: block; }
  .ebnf-container {
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 1.5rem;
    border-radius: 8px;
    overflow-x: auto;
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.9rem;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .ebnf-container .rule-name { color: #569cd6; }
  .ebnf-container .terminal { color: #ce9178; }
  .ebnf-container .nonterminal { color: #4ec9b0; }
  .ebnf-container .operator { color: #d4d4d4; }
</style>
`;

  // Escape HTML first, then apply syntax highlighting
  const escaped = ebnf.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Use placeholders to avoid regex conflicts
  const ebnfHtml = escaped
    .replace(/"([^"]+)"/g, '___TERM_START___$1___TERM_END___')
    .replace(/&lt;(\w+)&gt;/g, '___NT_START___$1___NT_END___')
    .replace(/^(\w+)\s*::=/gm, '___RULE_START___$1___RULE_END___ ::=')
    .replace(/___TERM_START___/g, '<span class="terminal">"')
    .replace(/___TERM_END___/g, '"</span>')
    .replace(/___NT_START___/g, '<span class="nonterminal">&lt;')
    .replace(/___NT_END___/g, '&gt;</span>')
    .replace(/___RULE_START___/g, '<span class="rule-name">')
    .replace(/___RULE_END___/g, '</span>');

  const header = `
<h1 class="grammar-title">Flow Weaver JSDoc Grammar</h1>
<a href="index.html" class="back-link">← Back to API Documentation</a>
<div class="tabs">
  <button class="tab active" onclick="showTab('diagrams')">Railroad Diagrams</button>
  <button class="tab" onclick="showTab('ebnf')">EBNF Text</button>
</div>
<div id="ebnf" class="tab-content">
  <div class="ebnf-container">${ebnfHtml}</div>
</div>
<script>
function showTab(id) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  event.target.classList.add('active');
}
</script>
`;

  // Insert styles after existing style block, header before diagrams
  return html
    .replace('</style>', `</style>${customStyles}`)
    .replace('<div id="diagrams"', `${header}<div id="diagrams" class="tab-content active"`);
}

/**
 * Generate diagram HTML for a specific grammar.
 */
export function generateGrammarDiagramFor(grammarName: keyof GrammarCollection): string {
  const grammars = getAllGrammars();
  const grammar = grammars[grammarName];
  const html = createSyntaxDiagramsCode(grammar);

  const title = grammarName.charAt(0).toUpperCase() + grammarName.slice(1);
  const header = `<h1 style="text-align:center;color:#333">${title} Grammar</h1>`;

  return html.replace('<div id="diagrams"', `${header}<div id="diagrams"`);
}
