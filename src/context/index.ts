/**
 * LLM context bundle builder.
 *
 * Composes Flow Weaver documentation, annotation grammar, and a profile-specific
 * preamble into a single markdown document suitable for LLM consumption.
 */

import { readTopic, listTopics, getPackDocTopics } from '../docs/index.js';
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
  /**
   * Every topic the bundle did not include, with its compact size, so a
   * caller can decide what to load next without listing first. Pack topics
   * are included once loaded.
   */
  availableTopics: Array<{ slug: string; description: string; compactBytes: number }>;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

// `core` is deliberately one short topic. It is what every persona loads at
// the start of a session, so it has to be the map — the model, the tool loop,
// and which topic answers which task — not the reference itself. The bundle
// appends every other topic's name and size, and the assistant reads those
// on demand with fw_docs. The larger presets exist for callers that really
// want a self-contained dump; they begin with the same map.
export const PRESETS: Record<ContextPreset, string[]> = {
  core: ['orientation'],
  authoring: [
    'orientation',
    'concepts',
    'jsdoc-grammar',
    'advanced-annotations',
    'built-in-nodes',
    'durable-gates',
    'scaffold',
    'node-conversion',
    'patterns',
  ],
  ops: [
    'orientation',
    'cli-reference',
    'mcp-tools',
    'compilation',
    'deployment',
    'export-interface',
    'debugging',
    'error-codes',
  ],
  full: [
    'orientation',
    'concepts',
    'tutorial',
    'jsdoc-grammar',
    'advanced-annotations',
    'built-in-nodes',
    'durable-gates',
    'cancellation',
    'cli-reference',
    'mcp-tools',
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

// Short on purpose: this text is in every bundle, on every session start.
// The tool loop and the topic map live in the orientation topic; this only
// says how to use the bundle.
function buildAssistantPreamble(): string {
  return `# Flow Weaver Context

You have Flow Weaver MCP tools (fw_ prefix). Write the workflow file
yourself (node type functions plus a @flowWeaver workflow stub), then work
through the tools: fw_validate after every change, fw_modify to restructure,
fw_query or fw_describe to inspect, fw_diagram (ascii-compact) to show,
fw_run and fw_resume to execute.

This bundle is a starting point, not the whole reference. When a task needs
more, search first — fw_docs(action="search", query="...") — then read one
topic: fw_docs(action="read", topic="<slug>", compact=true). The list at the
end names every topic not included here, with its size.

File conventions: .ts files; node ids and workflow function names in camelCase.`;
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

  // Append pack doc topics that declare this preset
  const packSlugs = getPackDocTopics()
    .filter((t) => t.presets?.includes(preset))
    .map((t) => t.slug);

  const combined = [...base, ...packSlugs, ...(add ?? [])];
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

  // The map of what was left out. Sizes are measured now rather than written
  // into a topic, so they stay true as the documentation changes and cover
  // pack topics too. This is what makes loading progressive: the reader sees
  // the cost of each next step before taking it.
  const included = new Set(includedSlugs);
  const availableTopics = listTopics()
    .filter((t) => !included.has(t.slug))
    .map((t) => ({
      slug: t.slug,
      description: t.description,
      compactBytes: readTopic(t.slug, true)?.content.length ?? 0,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  if (availableTopics.length > 0) {
    const rows = availableTopics.map(
      (t) => `- \`${t.slug}\` — ${t.description} (${Math.max(1, Math.round(t.compactBytes / 1024))} KB)`,
    );
    const how =
      profile === 'assistant'
        ? 'Load one with fw_docs(action="read", topic="<slug>", compact=true); search first with fw_docs(action="search", query="...").'
        : 'Load one with `fw docs <slug> --compact`, or fw_docs(action="read", topic="<slug>", compact=true) once MCP tools are connected.';
    sections.push(`## Other topics, load on demand\n\n${how}\n\n${rows.join('\n')}`);
  }

  const content = sections.join('\n\n---\n\n');
  const lineCount = content.split('\n').length;

  return {
    content,
    topicCount,
    lineCount,
    topicSlugs: includedSlugs,
    profile,
    availableTopics,
  };
}
