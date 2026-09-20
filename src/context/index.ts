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
// the start of a session, so it has to be the map (the model, the tool loop,
// and which topic answers which task), not the reference itself. The bundle
// appends every other topic's name and size, and the assistant reads those
// on demand with fw_docs. The larger presets exist for callers that really
// want a self-contained dump. They begin with the same map.
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
    'library',
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
    'library',
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

// Three lines on purpose: this text is in every bundle, on every session
// start. The tool loop, the topic map, and the loading instructions all live
// in the orientation topic and the closing topic list. Repeating them here
// only costs tokens.
const ASSISTANT_PREAMBLE = `# Flow Weaver Context

You have the Flow Weaver MCP tools (fw_ prefix). This bundle is the map, not
the reference. The list at the end names every topic it leaves out, with its
size and how to load one.`;

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
    ...grammars.scope,
  ];
  const ebnf = serializedToEBNF(allProductions);
  return `## JSDoc Annotation Grammar (EBNF)\n\n\`\`\`ebnf\n${ebnf}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Topic body preparation
// ---------------------------------------------------------------------------

/**
 * Sections that only point at other topics. A topic read on its own needs
 * them. A bundle does not, because it ends with its own list of every topic
 * and the orientation map says when to read each. In `full` they added a
 * fourth copy of the topic list.
 */
const NAVIGATION_HEADINGS = /^(related topics|next steps|see also)$/i;

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;

/**
 * Turns a compact topic into a section body that nests under the bundle's
 * own `## <name>` heading: the compact header and the doc's own H1 go (they
 * would repeat the section heading), trailing navigation sections go, and
 * every remaining heading moves one level down. Code blocks are untouched.
 */
function prepareTopicBody(content: string): string {
  let lines = content.split('\n');

  // Compact mode prepends "# Name\ndescription\n". Drop that header.
  if (lines[0]?.startsWith('# ')) {
    let startLine = 1;
    if (lines.length > 1 && lines[1].trim() && !lines[1].startsWith('#')) {
      startLine = 2;
    }
    lines = lines.slice(startLine);
  }
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();

  // Most docs open with their own H1, which would become a second heading
  // with the same text directly under ours.
  if (lines[0]?.match(/^#\s/)) {
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  }

  const out: string[] = [];
  let inCode = false;
  let skipUntilLevel = 0; // >0 while inside a navigation section being dropped
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode;
      if (skipUntilLevel === 0) out.push(line);
      continue;
    }
    if (inCode) {
      if (skipUntilLevel === 0) out.push(line);
      continue;
    }
    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      if (skipUntilLevel > 0 && level <= skipUntilLevel) skipUntilLevel = 0;
      if (skipUntilLevel === 0 && NAVIGATION_HEADINGS.test(heading[2])) {
        skipUntilLevel = level;
        continue;
      }
      if (skipUntilLevel === 0) out.push('#' + line);
      continue;
    }
    if (skipUntilLevel === 0) out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
  sections.push(profile === 'standalone' ? STANDALONE_PREAMBLE : ASSISTANT_PREAMBLE);

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
    const heading = doc.name || slug;
    sections.push(`## ${heading}\n\n${prepareTopicBody(doc.content)}`);
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
    // A topic the bundle already points at by slug (the orientation map does
    // this for nearly all of them) needs only its size here; repeating its
    // description was a second copy of the map. A topic nothing mentions —
    // a pack topic, or one the map skips — keeps its description.
    const bundleText = sections.join('\n');
    const rows = availableTopics.map((t) => {
      const size = `${Math.max(1, Math.round(t.compactBytes / 1024))} KB`;
      const mentioned = bundleText.includes(`\`${t.slug}\``);
      return mentioned || !t.description
        ? `- \`${t.slug}\` (${size})`
        : `- \`${t.slug}\`: ${t.description} (${size})`;
    });
    const how =
      profile === 'assistant'
        ? 'Read one with fw_docs(action="read", topic="<slug>", compact=true). Search first with fw_docs(action="search", query="...").'
        : 'Read one with `fw docs <slug> --compact`, or fw_docs(action="read", topic="<slug>", compact=true) once MCP tools are connected.';
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
