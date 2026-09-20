import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocTopic {
  slug: string;
  name: string;
  description: string;
  keywords: string[];
}

export interface DocContent {
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  content: string;
}

export interface DocSection {
  heading: string;
  level: number;
  content: string;
  codeBlocks: string[];
}

export interface DocStructured {
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  sections: DocSection[];
}

export interface SearchResult {
  topic: string;
  slug: string;
  section: string;
  heading: string;
  excerpt: string;
  relevance: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function getDocsDir(): string {
  // Resolve docs/reference relative to the package root.
  // In development: src/docs/index.ts -> ../../docs/reference
  // In dist: dist/docs/index.js -> ../../docs/reference
  const thisFile = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(thisFile), '..', '..');
  return path.join(packageRoot, 'docs', 'reference');
}

interface Frontmatter {
  name: string;
  description: string;
  keywords: string[];
}

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return {
      frontmatter: { name: '', description: '', keywords: [] },
      body: raw,
    };
  }

  const fmBlock = fmMatch[1];
  const body = fmMatch[2];

  let name = '';
  let description = '';
  let keywords: string[] = [];

  for (const line of fmBlock.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      name = nameMatch[1].trim();
      continue;
    }
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      description = descMatch[1].trim();
      continue;
    }
    const kwMatch = line.match(/^keywords:\s*\[(.+)\]$/);
    if (kwMatch) {
      keywords = kwMatch[1].split(',').map((k) => k.trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
  }

  return { frontmatter: { name, description, keywords }, body };
}

function splitSections(body: string): DocSection[] {
  const lines = body.split('\n');
  const sections: DocSection[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];

  function flush() {
    if (currentHeading || currentLines.length > 0) {
      const content = currentLines.join('\n').trim();
      const codeBlocks: string[] = [];
      const codeRe = /```[\s\S]*?```/g;
      let m: RegExpExecArray | null;
      while ((m = codeRe.exec(content)) !== null) {
        codeBlocks.push(m[0]);
      }
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        content,
        codeBlocks,
      });
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all available documentation topics, including pack-contributed ones.
 */
export function listTopics(): DocTopic[] {
  const docsDir = getDocsDir();
  const coreTopics: DocTopic[] = [];

  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
    for (const file of files) {
      const raw = fs.readFileSync(path.join(docsDir, file), 'utf-8');
      const { frontmatter } = parseFrontmatter(raw);
      coreTopics.push({
        slug: file.replace(/\.md$/, ''),
        name: frontmatter.name,
        description: frontmatter.description,
        keywords: frontmatter.keywords,
      });
    }
  }

  // Append pack-contributed topics (no slug collisions with core)
  const coreSlugs = new Set(coreTopics.map((t) => t.slug));
  for (const packTopic of packDocTopics) {
    if (!coreSlugs.has(packTopic.slug)) {
      coreTopics.push({
        slug: packTopic.slug,
        name: packTopic.name,
        description: packTopic.description,
        keywords: packTopic.keywords,
      });
    }
  }

  return coreTopics;
}

/**
 * Read a single documentation topic.
 * Checks core docs first, then falls back to pack-contributed topics.
 * @param slug - Topic slug (filename without .md)
 * @param compact - If true, return a compact LLM-friendly version
 */
export function readTopic(slug: string, compact?: boolean): DocContent | null {
  // Try core docs first
  const docsDir = getDocsDir();
  const coreFilePath = path.join(docsDir, `${slug}.md`);
  if (fs.existsSync(coreFilePath)) {
    const raw = fs.readFileSync(coreFilePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const content = compact ? buildCompactContent(frontmatter, body) : body.trim();
    return {
      slug,
      name: frontmatter.name,
      description: frontmatter.description,
      keywords: frontmatter.keywords,
      content,
    };
  }

  // Check pack-contributed topics
  const packTopic = packDocTopics.find((t) => t.slug === slug);
  if (packTopic && fs.existsSync(packTopic.filePath)) {
    const raw = fs.readFileSync(packTopic.filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const content = compact
      ? buildCompactContent(
          { name: frontmatter.name || packTopic.name, description: frontmatter.description || packTopic.description, keywords: frontmatter.keywords.length > 0 ? frontmatter.keywords : packTopic.keywords },
          body,
        )
      : body.trim();
    return {
      slug,
      name: frontmatter.name || packTopic.name,
      description: frontmatter.description || packTopic.description,
      keywords: frontmatter.keywords.length > 0 ? frontmatter.keywords : packTopic.keywords,
      content,
    };
  }

  return null;
}

/**
 * Read a topic and return structured sections (for JSON output).
 */
export function readTopicStructured(slug: string): DocStructured | null {
  const docsDir = getDocsDir();
  const filePath = path.join(docsDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const sections = splitSections(body);

  return {
    slug,
    name: frontmatter.name,
    description: frontmatter.description,
    keywords: frontmatter.keywords,
    sections,
  };
}

/**
 * Search across all documentation topics.
 * Returns matching sections with context.
 */
/** Words that carry no meaning in a search and would otherwise match every section. */
const STOP_WORDS = new Set(['a', 'an', 'the', 'as', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'how', 'do', 'i', 'my', 'is', 'it', 'be', 'can', 'from', 'that', 'this', 'add', 'use', 'using']);

export function searchDocs(query: string): SearchResult[] {
  const topics = listTopics();
  const docsDir = getDocsDir();
  const queryLower = query.toLowerCase().trim();
  const allTerms = queryLower.split(/\s+/).filter(Boolean);
  // Drop the filler unless that would drop everything ("how to" is still a search).
  const meaningful = allTerms.filter((t) => !STOP_WORDS.has(t));
  const queryTerms = meaningful.length ? meaningful : allTerms;
  // With several terms, a section that has only one of them is noise: it must
  // cover at least half. One term matches wherever it appears, as before.
  const needed = Math.max(1, Math.ceil(queryTerms.length / 2));
  const results: SearchResult[] = [];

  for (const topic of topics) {
    // Check keywords match
    const keywordMatch = topic.keywords.some((kw) =>
      queryTerms.some((term) => kw.toLowerCase().includes(term))
    );

    // Resolve the file path: core topics live in docsDir, pack topics have their own path
    const packTopic = packDocTopics.find((p) => p.slug === topic.slug);
    const filePath = packTopic ? packTopic.filePath : path.join(docsDir, `${topic.slug}.md`);
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const { body } = parseFrontmatter(raw);
    const sections = splitSections(body);

    for (const section of sections) {
      const sectionLower = section.content.toLowerCase();
      const headingLower = section.heading.toLowerCase();

      // Calculate relevance
      let relevance = 0;
      const topicLower = `${topic.name} ${topic.slug}`.toLowerCase();

      // Exact phrase match in content
      if (sectionLower.includes(queryLower)) {
        relevance += 10;
      }

      // Individual term matches: a heading that names the thing outranks a
      // body that mentions it; the topic's own name counts too.
      let matched = 0;
      for (const term of queryTerms) {
        const inHeading = headingLower.includes(term);
        const inBody = sectionLower.includes(term);
        if (inHeading) relevance += 6;
        if (inBody) relevance += 2;
        if (topicLower.includes(term)) relevance += 2;
        if (inHeading || inBody) matched++;
      }

      // Keyword bonus
      if (keywordMatch) relevance += 3;

      // Sections covering more of the query come first; too little coverage is left out.
      if (matched < needed) relevance = 0;
      else if (queryTerms.length > 1) relevance = Math.round(relevance * (0.5 + matched / (2 * queryTerms.length)));

      if (relevance > 0) {
        // Build excerpt: find matching lines
        const lines = section.content.split('\n');
        const matchingLines: string[] = [];
        for (const line of lines) {
          if (queryTerms.some((term) => line.toLowerCase().includes(term))) {
            matchingLines.push(collapseTableRow(line).trim());
            if (matchingLines.length >= 3) break;
          }
        }

        results.push({
          topic: topic.name,
          slug: topic.slug,
          section: section.heading,
          heading: section.heading,
          excerpt: matchingLines.join('\n') || section.content.slice(0, 200),
          relevance,
        });
      }
    }
  }

  // Sort by relevance descending
  results.sort((a, b) => b.relevance - a.relevance);
  return results;
}

// ---------------------------------------------------------------------------
// Pack-contributed doc topics
// ---------------------------------------------------------------------------

/** Registered pack doc topics. Populated by registerPackDocTopics(). */
const packDocTopics: Array<{
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  presets: string[];
  filePath: string;
}> = [];

/**
 * Register doc topics from installed pack manifests.
 * These appear alongside core topics in listTopics() and readTopic().
 */
export function registerPackDocTopics(
  topics: Array<{
    slug: string;
    name: string;
    description?: string;
    keywords?: string[];
    presets?: string[];
    absoluteFile: string;
  }>,
): void {
  for (const t of topics) {
    // Avoid duplicates (same slug)
    if (packDocTopics.some((p) => p.slug === t.slug)) continue;
    packDocTopics.push({
      slug: t.slug,
      name: t.name,
      description: t.description ?? '',
      keywords: t.keywords ?? [],
      presets: t.presets ?? [],
      filePath: t.absoluteFile,
    });
  }
}

/**
 * List pack-contributed doc topics. Used internally by listTopics() and readTopic().
 */
export function getPackDocTopics(): typeof packDocTopics {
  return packDocTopics;
}

// ---------------------------------------------------------------------------
// Compact mode builder
// ---------------------------------------------------------------------------

/**
 * Removes the padding that aligns a markdown table for human readers: runs of
 * spaces inside a row, and the long dash runs of a separator row. Rendering
 * is unchanged and nothing is lost; in the error-codes topic that padding was
 * 42% of the file.
 */
export function collapseTableRow(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return line;
  if (/^[|\s:-]+$/.test(trimmed)) return trimmed.replace(/-{4,}/g, '---').replace(/ {2,}/g, ' ');
  return trimmed.replace(/ {2,}/g, ' ');
}

const LIST_ITEM_RE = /^\s*(?:[-*]\s|\d+\.\s|>\s?)/;

/**
 * Compact mode keeps the parts of a topic an assistant can use as reference
 * — headings, tables, lists, blockquotes, code — and drops explanatory prose.
 * A list item that wraps onto indented continuation lines is kept whole;
 * cutting it at the first line used to leave half sentences. A heading whose
 * section was entirely prose is dropped rather than left dangling, because
 * an empty heading tells the reader nothing and costs a line.
 */
function buildCompactContent(frontmatter: Frontmatter, body: string): string {
  const lines = body.split('\n');
  const output: string[] = [];

  // Header
  output.push(`# ${frontmatter.name}`);
  output.push(frontmatter.description);
  output.push('');

  let inCodeBlock = false;
  let inListItem = false;

  for (const line of lines) {
    // Track code blocks - always include them
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      inListItem = false;
      output.push(line);
      continue;
    }
    if (inCodeBlock) {
      output.push(line);
      continue;
    }

    if (line.trim() === '') {
      inListItem = false;
      continue;
    }

    // Include headings
    if (line.match(/^#{1,6}\s/)) {
      inListItem = false;
      output.push('');
      output.push(line);
      continue;
    }

    // Include table content, without its alignment padding
    if (line.trim().startsWith('|')) {
      inListItem = false;
      output.push(collapseTableRow(line));
      continue;
    }

    // Keep list items and blockquotes, with the indented lines a wrapped
    // item continues on.
    if (LIST_ITEM_RE.test(line)) {
      inListItem = true;
      output.push(line);
      continue;
    }
    if (inListItem && /^\s{2,}\S/.test(line)) {
      output.push(line);
      continue;
    }

    // Anything else is a prose paragraph: skipped.
    inListItem = false;
  }

  return dropEmptyHeadings(output).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Drops a heading that has nothing under it: the next non-blank line is a
 * heading of the same or a higher level, or there is no next line. Runs
 * bottom-up so a parent whose only children were dropped goes too. Headings
 * inside code blocks are not headings.
 */
function dropEmptyHeadings(lines: string[]): string[] {
  const headingLevel: Array<number | null> = [];
  let inCode = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode;
      headingLevel.push(null);
      continue;
    }
    const m = !inCode ? line.match(/^(#{1,6})\s/) : null;
    headingLevel.push(m ? m[1].length : null);
  }

  const keep = lines.map(() => true);
  for (let i = lines.length - 1; i >= 0; i--) {
    const level = headingLevel[i];
    if (level === null) continue;
    let j = i + 1;
    while (j < lines.length && (!keep[j] || lines[j].trim() === '')) j++;
    const next = j < lines.length ? headingLevel[j] : null;
    if (j >= lines.length || (next !== null && next <= level)) keep[i] = false;
  }
  return lines.filter((_, i) => keep[i]);
}
