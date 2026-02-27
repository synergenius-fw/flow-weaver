/**
 * LLM context bundle builder.
 *
 * Composes Flow Weaver documentation, annotation grammar, and a profile-specific
 * preamble into a single markdown document suitable for LLM consumption.
 */

import { readTopic, listTopics } from '../docs/index.js';
import { getAllGrammars, serializedToEBNF } from '../chevrotain-parser/grammar-diagrams.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextProfile = 'standalone' | 'assistant';
export type ContextPreset = 'core' | 'authoring' | 'full' | 'ops';

export interface ContextOptions {
  preset?: ContextPreset;
  profile?: ContextProfile;
  /** Explicit topic slugs. Overrides the preset's topic list. */
  topics?: string[];
  /** Extra topic slugs appended to the preset. */
  addTopics?: string[];
  /** Include EBNF grammar section. Default true. */
  includeGrammar?: boolean;
}

export interface ContextResult {
  content: string;
  topicCount: number;
  lineCount: number;
  topicSlugs: string[];
  profile: ContextProfile;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const PRESETS: Record<ContextPreset, string[]> = {
  core: ['concepts', 'jsdoc-grammar', 'tutorial'],
  authoring: [
    'concepts',
    'jsdoc-grammar',
    'advanced-annotations',
    'built-in-nodes',
    'scaffold',
    'node-conversion',
    'patterns',
  ],
  ops: [
    'cli-reference',
    'compilation',
    'deployment',
    'export-interface',
    'debugging',
    'error-codes',
  ],
  full: [
    'concepts',
    'tutorial',
    'jsdoc-grammar',
    'advanced-annotations',
    'built-in-nodes',
    'cli-reference',
    'compilation',
    'debugging',
    'deployment',
    'error-codes',
    'export-interface',
    'iterative-development',
    'marketplace',
    'node-conversion',
    'patterns',
    'scaffold',
  ],
};

export const PRESET_NAMES = Object.keys(PRESETS) as ContextPreset[];

// ---------------------------------------------------------------------------
// Preambles
// ---------------------------------------------------------------------------

const STANDALONE_PREAMBLE = `# Flow Weaver Reference

Flow Weaver is a TypeScript workflow compiler. You write plain .ts files with
JSDoc annotations (@flowWeaver nodeType, @flowWeaver workflow, @input, @output,
@connect, @node, @scope). The compiler parses these annotations, validates the
graph, and generates executable code inline. The source file is the workflow:
no JSON configs, no YAML, no separate graph files.

Key concepts: node types define reusable processing steps with typed input/output
ports. Workflows instantiate nodes and connect their ports. Start and Exit are
implicit boundary nodes. The compiler handles execution ordering, type checking,
and code generation.`;

function buildAssistantPreamble(): string {
  const allSlugs = listTopics().map((t) => t.slug);
  return `# Flow Weaver Context

You have Flow Weaver MCP tools available (fw_ prefix). Use them to create,
modify, validate, compile, and inspect workflows without manual file editing.

For documentation not included below, call fw_docs(action="read", topic="<slug>").
Available topic slugs: ${allSlugs.join(', ')}.

Tool quick reference:
- fw_create_model: Build workflow from structured description (steps + flow path)
- fw_implement_node: Replace a declare stub with a real function body
- fw_modify / fw_modify_batch: Add/remove nodes, connections, rename, reposition
- fw_validate: Check for errors after any change
- fw_describe: Inspect structure. Use format "text" for readable, "json" for data
- fw_diagram: Visualize. Prefer format "ascii-compact" in chat contexts
- fw_compile: Generate executable TypeScript from annotations
- fw_docs: Look up reference docs by topic slug
- fw_scaffold: Create from templates (sequential, foreach, ai-agent, etc.)

File conventions: .ts extension, camelCase node names, PascalCase workflow names.`;
}

// ---------------------------------------------------------------------------
// Topic resolution
// ---------------------------------------------------------------------------

export function resolveTopics(
  preset: ContextPreset,
  explicit?: string[],
  add?: string[]
): string[] {
  const base = explicit ?? PRESETS[preset];
  const combined = add ? [...base, ...add] : base;
  // Deduplicate while preserving order
  return [...new Set(combined)];
}

// ---------------------------------------------------------------------------
// Grammar builder
// ---------------------------------------------------------------------------

function buildGrammarSection(): string {
  const grammars = getAllGrammars();
  const allProductions = [
    ...grammars.port,
    ...grammars.node,
    ...grammars.connect,
    ...grammars.position,
    ...grammars.scope,
  ];
  const ebnf = serializedToEBNF(allProductions);
  return `## JSDoc Annotation Grammar (EBNF)\n\n\`\`\`ebnf\n${ebnf}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildContext(options: ContextOptions = {}): ContextResult {
  const profile = options.profile ?? 'standalone';
  const preset = options.preset ?? 'core';
  const includeGrammar = options.includeGrammar ?? true;

  const topicSlugs = resolveTopics(preset, options.topics, options.addTopics);

  const sections: string[] = [];

  // Preamble
  if (profile === 'standalone') {
    sections.push(STANDALONE_PREAMBLE);
  } else {
    sections.push(buildAssistantPreamble());
  }

  // Grammar
  if (includeGrammar) {
    sections.push(buildGrammarSection());
  }

  // Topics
  let topicCount = 0;
  const includedSlugs: string[] = [];

  for (const slug of topicSlugs) {
    const doc = readTopic(slug, true);
    if (!doc) continue;

    // Compact mode prepends "# Name\ndescription\n" which duplicates our heading.
    // Strip the leading heading block so we can use our own consistent ## heading.
    // Then bump all remaining headings down one level so they nest under our ##.
    let body = doc.content;
    if (body.startsWith('# ')) {
      const lines = body.split('\n');
      // Skip the "# Name" line and the description line that follows it
      let startLine = 1;
      if (lines.length > 1 && lines[1].trim() && !lines[1].startsWith('#')) {
        startLine = 2;
      }
      body = lines.slice(startLine).join('\n').replace(/^\n+/, '');
    }
    // Bump all headings down one level (# -> ##, ## -> ###, etc.)
    // so they nest under our ## topic heading. Only transform outside code blocks.
    const bodyLines = body.split('\n');
    let inCode = false;
    for (let i = 0; i < bodyLines.length; i++) {
      if (bodyLines[i].trimStart().startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (!inCode && bodyLines[i].match(/^#{1,5}\s/)) {
        bodyLines[i] = '##' + bodyLines[i];
      }
    }
    body = bodyLines.join('\n');

    const heading = doc.name || slug;
    sections.push(`## ${heading}\n\n${body}`);
    topicCount++;
    includedSlugs.push(slug);
  }

  const content = sections.join('\n\n---\n\n');
  const lineCount = content.split('\n').length;

  return {
    content,
    topicCount,
    lineCount,
    topicSlugs: includedSlugs,
    profile,
  };
}
