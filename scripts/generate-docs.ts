#!/usr/bin/env tsx
/**
 * Auto-generate data-driven sections in docs/reference/ markdown files.
 *
 * Reads source data (validation codes, templates, grammar) and injects
 * the generated content between <!-- AUTO:START id --> / <!-- AUTO:END id --> markers.
 * Hand-written prose outside markers is preserved.
 *
 * Usage:
 *   npx tsx scripts/generate-docs.ts           # update docs in-place
 *   npx tsx scripts/generate-docs.ts --check   # verify docs are up-to-date (CI)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ── Source data imports ────────────────────────────────────────────────

import { VALIDATION_CODES } from '../src/doc-metadata/extractors/error-codes.js';
import { extractTerminals } from '../src/doc-metadata/extractors/grammar-rules.js';
import { workflowTemplates, nodeTemplates } from '../src/cli/templates/index.js';
import {
  ALL_ANNOTATIONS,
  PORT_MODIFIERS,
  NODE_MODIFIERS,
} from '../src/doc-metadata/extractors/annotations.js';
import type { TAnnotationDoc, TAnnotationModifierDoc } from '../src/doc-metadata/types.js';

// ── Paths ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.resolve(__dirname, '..', 'docs', 'reference');

// ── Friendly-errors cross-check ──────────────────────────────────────

async function crossCheckFriendlyErrors(): Promise<void> {
  // Dynamic import to avoid issues if the file doesn't exist
  try {
    const { getFriendlyError } = await import('../src/friendly-errors.js');
    const missing: string[] = [];
    for (const code of VALIDATION_CODES) {
      const friendly = getFriendlyError({ code: code.code, message: 'test', node: 'test' });
      if (!friendly) {
        missing.push(code.code);
      }
    }
    if (missing.length > 0) {
      console.warn(
        `⚠ ${missing.length} validation code(s) have no friendly-error mapping:\n  ${missing.join(', ')}`
      );
    }
  } catch {
    // Ignore — friendly-errors may not be importable in all contexts
  }
}

// ── Section generators ───────────────────────────────────────────────

function generateErrorSummaryTable(): string {
  const errors = VALIDATION_CODES.filter((c) => c.severity === 'error');
  const lines = ['| Code | Short Description |', '| --- | --- |'];
  for (const e of errors) {
    lines.push(`| ${e.code} | ${e.description} |`);
  }
  return lines.join('\n');
}

function generateWarningSummaryTable(): string {
  const warnings = VALIDATION_CODES.filter((c) => c.severity === 'warning');
  const lines = ['| Code | Short Description |', '| --- | --- |'];
  for (const w of warnings) {
    lines.push(`| ${w.code} | ${w.description} |`);
  }
  return lines.join('\n');
}

function generateWorkflowTemplatesTable(): string {
  const lines = ['| Template | Description |', '|----------|-------------|'];
  for (const t of workflowTemplates) {
    lines.push(`| \`${t.id}\` | ${t.description} |`);
  }
  return lines.join('\n');
}

function generateNodeTemplatesTable(): string {
  const lines = ['| Template | Description |', '|----------|-------------|'];
  for (const t of nodeTemplates) {
    lines.push(`| \`${t.id}\` | ${t.description} |`);
  }
  return lines.join('\n');
}

function generateDefaultNodeTemplate(): string {
  // The default is 'processor' — read from create.ts default value
  return '- `--template T` / `-t T` - Use specific template (default: processor)';
}

function generateJsdocGrammarFull(): string {
  const lines: string[] = [];

  // ── JSDoc Block Structure ────────────────────────────────────────────
  lines.push('## JSDoc Block Structure');
  lines.push('');
  lines.push(
    'All Flow Weaver annotations live inside standard JSDoc `/** ... */` blocks placed directly above a `function` declaration. The parser recognizes three block types based on the `@flowWeaver` tag value.'
  );
  lines.push('');
  lines.push('```');
  lines.push('jsdocBlock     ::= "/**" { tagLine } "*/"');
  lines.push('tagLine        ::= "*" "@" TAG_NAME [ tagContent ]');
  lines.push('```');
  lines.push('');

  // ── Block Types (from @flowWeaver marker) ────────────────────────────
  const marker = ALL_ANNOTATIONS.find((a) => a.name === '@flowWeaver');
  if (marker?.ebnf) {
    lines.push('## Block Types');
    lines.push('');
    lines.push('```');
    lines.push(marker.ebnf);
    lines.push('```');
    lines.push('');
  }

  // ── Node Type Block Overview ─────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Node Type Tags');
  lines.push('');
  lines.push(
    'A `@flowWeaver nodeType` block accepts these tags (order does not matter):'
  );
  lines.push('');
  lines.push('```');
  lines.push('nodeTypeBlock  ::= "@flowWeaver nodeType"');
  lines.push('                   [ "@expression" ]');
  lines.push('                   [ "@name" TEXT ]');
  lines.push('                   [ "@label" TEXT ]');
  lines.push('                   [ "@description" TEXT ]');
  lines.push('                   [ "@scope" IDENTIFIER ]');
  lines.push('                   [ "@executeWhen" IDENTIFIER ]');
  lines.push('                   [ "@pullExecution" IDENTIFIER ]');
  lines.push('                   [ "@color" TEXT ]');
  lines.push('                   [ "@icon" TEXT ]');
  lines.push('                   { "@tag" IDENTIFIER [ STRING ] }');
  lines.push('                   { inputTag }');
  lines.push('                   { outputTag }');
  lines.push('                   { stepTag }');
  lines.push('```');
  lines.push('');

  // ── Port Tags Section ───────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Port Tags (Input / Output / Step)');
  lines.push('');
  lines.push('These are parsed by the Chevrotain port grammar.');
  lines.push('');

  const portAnnotations = ALL_ANNOTATIONS.filter((a) => a.category === 'port');
  for (const ann of portAnnotations) {
    emitAnnotationSection(lines, ann);
  }

  // ── Shared Clauses ──────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Shared Clauses');
  lines.push('');
  lines.push('```');
  lines.push('scopeClause    ::= "scope:" IDENTIFIER');
  lines.push('');
  lines.push('metadataBracket ::= "[" metadataAttr { "," metadataAttr } "]"');
  lines.push('');
  lines.push('metadataAttr   ::= orderAttr | placementAttr | typeAttr | mergeStrategyAttr');
  lines.push('');
  lines.push('orderAttr      ::= "order:" INTEGER');
  lines.push('placementAttr  ::= "placement:" ( "TOP" | "BOTTOM" )');
  lines.push('typeAttr       ::= "type:" IDENTIFIER');
  lines.push('mergeStrategyAttr ::= "mergeStrategy:" IDENTIFIER');
  lines.push('');
  lines.push('descriptionClause ::= "-" TEXT');
  lines.push('```');
  lines.push('');
  lines.push('Metadata brackets can be repeated: `@input name [order:1] [placement:TOP]`');
  lines.push('');

  // ── Workflow Tags Section ───────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Workflow Tags');
  lines.push('');
  lines.push('A `@flowWeaver workflow` block accepts these tags:');
  lines.push('');
  lines.push('```');
  lines.push('workflowBlock  ::= "@flowWeaver workflow"');
  lines.push('                   [ "@name" TEXT ]');
  lines.push('                   [ "@description" TEXT ]');
  lines.push('                   [ "@strictTypes" [ "false" ] ]');
  lines.push('                   [ "@autoConnect" ]');
  lines.push('                   { fwImportTag }');
  lines.push('                   { "@param" paramTag }');
  lines.push('                   { ( "@returns" | "@return" ) returnsTag }');
  lines.push('                   { nodeTag }');
  lines.push('                   { connectTag }');
  lines.push('                   { pathTag }');
  lines.push('                   { mapTag }');
  lines.push('                   { fanOutTag }');
  lines.push('                   { fanInTag }');
  lines.push('                   { positionTag }');
  lines.push('                   { scopeTag }');
  lines.push('```');
  lines.push('');

  // Emit each workflow annotation with ebnf
  const workflowOrder = [
    '@strictTypes', '@autoConnect', '@fwImport', '@node', '@connect', '@path',
    '@position', '@scope', '@map', '@fanOut', '@fanIn',
    '@param', '@returns',
    '@trigger', '@cancelOn', '@retries', '@timeout', '@throttle',
  ];

  for (const tagName of workflowOrder) {
    // For @scope and @strictTypes in workflow context, find the right entry
    let ann: TAnnotationDoc | undefined;
    if (tagName === '@scope') {
      ann = ALL_ANNOTATIONS.find(
        (a) => a.name === tagName && a.category === 'workflow'
      );
    } else {
      ann = ALL_ANNOTATIONS.find((a) => a.name === tagName);
    }
    if (ann) {
      emitAnnotationSection(lines, ann);
    }
  }

  // ── Pattern Tags Section ────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Pattern Tags');
  lines.push('');
  lines.push(
    'A `@flowWeaver pattern` block defines a reusable partial workflow with boundary ports:'
  );
  lines.push('');
  lines.push('```');
  lines.push('patternBlock   ::= "@flowWeaver pattern"');
  lines.push('                   [ "@name" TEXT ]');
  lines.push('                   [ "@description" TEXT ]');
  lines.push('                   { nodeTag }');
  lines.push('                   { positionTag }');
  lines.push('                   { connectTag }');
  lines.push('                   { portTag }');
  lines.push('```');
  lines.push('');

  const patternAnnotations = ALL_ANNOTATIONS.filter((a) => a.category === 'pattern');
  // Emit @port IN (which has the EBNF), skip @port OUT (shares the same rule)
  const portIn = patternAnnotations.find((a) => a.name === '@port IN');
  if (portIn) {
    emitAnnotationSection(lines, {
      ...portIn,
      name: '@port',
      description:
        'Pattern ports define the boundary connections (IN for inputs, OUT for outputs) that are wired when the pattern is applied to a workflow.',
      examples: [
        ...(portIn.examples || []),
        ...(patternAnnotations.find((a) => a.name === '@port OUT')?.examples || []),
      ],
    });
  }

  // ── Port Modifiers Table ────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Port Modifiers');
  lines.push('');
  lines.push('Attributes in square brackets after port name.');
  lines.push('');
  emitModifiersTable(lines, PORT_MODIFIERS);
  lines.push('');

  // ── Node Instance Modifiers Table ───────────────────────────────────
  lines.push('## Node Instance Modifiers');
  lines.push('');
  lines.push('Attributes in `@node` declaration brackets.');
  lines.push('');
  emitModifiersTable(lines, NODE_MODIFIERS);
  lines.push('');

  // ── Terminals ───────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Terminals');
  lines.push('');
  lines.push(generateTerminals());

  return lines.join('\n');
}

function emitAnnotationSection(lines: string[], ann: TAnnotationDoc): void {
  lines.push(`### ${ann.name}`);
  lines.push('');

  if (ann.ebnf) {
    lines.push('```');
    lines.push(ann.ebnf);
    lines.push('```');
    lines.push('');
  }

  lines.push(ann.description);
  lines.push('');

  if (ann.examples && ann.examples.length > 0) {
    lines.push('**Examples:**');
    lines.push('');
    lines.push('```');
    for (const ex of ann.examples) {
      lines.push(ex);
    }
    lines.push('```');
    lines.push('');
  }
}

function emitModifiersTable(lines: string[], modifiers: TAnnotationModifierDoc[]): void {
  lines.push('| Modifier | Syntax | Description |');
  lines.push('|----------|--------|-------------|');
  for (const m of modifiers) {
    lines.push(`| \`${m.name}\` | \`${m.syntax}\` | ${m.description} |`);
  }
}

function generateTerminals(): string {
  const terminals = extractTerminals();
  const maxName = Math.max(...terminals.map((t) => t.name.length));
  const codeLines = terminals.map(
    (t) => `${t.name.padEnd(maxName)} ::= ${t.pattern}`
  );

  // Find the description of IDENTIFIER for the note below the code block
  const idTerminal = terminals.find((t) => t.name === 'IDENTIFIER');
  const note = idTerminal ? `\n${idTerminal.description}` : '';

  return '```\n' + codeLines.join('\n') + '\n```' + note;
}

// ── Marker injection engine ──────────────────────────────────────────

const MARKER_START = /^<!-- AUTO:START (\S+) -->$/;
const MARKER_END = /^<!-- AUTO:END (\S+) -->$/;

type SectionGenerator = () => string;

const sectionGenerators: Record<string, SectionGenerator> = {
  error_summary_table: generateErrorSummaryTable,
  warning_summary_table: generateWarningSummaryTable,
  workflow_templates_table: generateWorkflowTemplatesTable,
  node_templates_table: generateNodeTemplatesTable,
  default_node_template: generateDefaultNodeTemplate,
  terminals: generateTerminals,
  jsdoc_grammar_full: generateJsdocGrammarFull,
};

/**
 * Process a single markdown file: replace content between AUTO markers.
 * Returns the new content (does not write).
 */
function processFile(content: string, filePath: string): string {
  // Normalize CRLF → LF for consistent regex matching (Windows compat)
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const output: string[] = [];
  let inSection: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const startMatch = line.match(MARKER_START);
    if (startMatch) {
      const sectionId = startMatch[1];
      output.push(line); // Keep the marker
      inSection = sectionId;

      // Generate and inject the content
      const generator = sectionGenerators[sectionId];
      if (!generator) {
        console.warn(`⚠ Unknown section "${sectionId}" in ${path.basename(filePath)}`);
        // Keep existing content until END marker
        continue;
      }

      const generated = generator();
      output.push(generated);
      continue;
    }

    const endMatch = line.match(MARKER_END);
    if (endMatch) {
      if (inSection !== endMatch[1]) {
        console.warn(
          `⚠ Mismatched markers: expected END for "${inSection}" but found "${endMatch[1]}" in ${path.basename(filePath)}`
        );
      }
      output.push(line); // Keep the END marker
      inSection = null;
      continue;
    }

    // If we're inside a section, skip the old content (it's been replaced)
    if (inSection !== null) {
      continue;
    }

    output.push(line);
  }

  if (inSection !== null) {
    console.warn(`⚠ Unclosed marker "${inSection}" in ${path.basename(filePath)}`);
  }

  return output.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────

const checkMode = process.argv.includes('--check');

const docFiles = [
  path.join(docsDir, 'error-codes.md'),
  path.join(docsDir, 'scaffold.md'),
  path.join(docsDir, 'jsdoc-grammar.md'),
];

let stale = false;

for (const filePath of docFiles) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠ Doc file not found: ${filePath}`);
    continue;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const useCRLF = raw.includes('\r\n');
  const original = raw.replace(/\r\n/g, '\n');
  const updated = processFile(raw, filePath);
  const basename = path.basename(filePath);

  if (original !== updated) {
    if (checkMode) {
      console.error(`✗ ${basename} is out of date. Run "npm run generate:docs" to update.`);
      stale = true;
    } else {
      fs.writeFileSync(filePath, useCRLF ? updated.replace(/\n/g, '\r\n') : updated);
      console.log(`✓ Updated ${basename}`);
    }
  } else {
    console.log(`· ${basename} is up to date`);
  }
}

// Always run cross-check (non-blocking)
await crossCheckFriendlyErrors();

if (checkMode && stale) {
  process.exit(1);
}
