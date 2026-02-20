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
};

/**
 * Process a single markdown file: replace content between AUTO markers.
 * Returns the new content (does not write).
 */
function processFile(content: string, filePath: string): string {
  const lines = content.split('\n');
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

  const original = fs.readFileSync(filePath, 'utf-8');
  const updated = processFile(original, filePath);
  const basename = path.basename(filePath);

  if (original !== updated) {
    if (checkMode) {
      console.error(`✗ ${basename} is out of date. Run "npm run generate:docs" to update.`);
      stale = true;
    } else {
      fs.writeFileSync(filePath, updated);
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
