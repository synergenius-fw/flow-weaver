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
export function searchDocs(query: string): SearchResult[] {
  const topics = listTopics();
  const docsDir = getDocsDir();
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);
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

      // Exact phrase match in content
      if (sectionLower.includes(queryLower)) {
        relevance += 10;
      }

      // Individual term matches
      for (const term of queryTerms) {
        if (headingLower.includes(term)) relevance += 5;
        if (sectionLower.includes(term)) relevance += 2;
      }

      // Keyword bonus
      if (keywordMatch) relevance += 3;

      if (relevance > 0) {
        // Build excerpt: find matching lines
        const lines = section.content.split('\n');
        const matchingLines: string[] = [];
        for (const line of lines) {
          if (queryTerms.some((term) => line.toLowerCase().includes(term))) {
            matchingLines.push(line.trim());
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

function buildCompactContent(frontmatter: Frontmatter, body: string): string {
  const lines = body.split('\n');
  const output: string[] = [];

  // Header
  output.push(`# ${frontmatter.name}`);
  output.push(frontmatter.description);
  output.push('');

  let inCodeBlock = false;
  let inTable = false;

  for (const line of lines) {
    // Track code blocks - always include them
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      output.push(line);
      continue;
    }
    if (inCodeBlock) {
      output.push(line);
      continue;
    }

    // Include headings
    if (line.match(/^#{1,6}\s/)) {
      output.push('');
      output.push(line);
      continue;
    }

    // Include table content
    if (line.trim().startsWith('|')) {
      inTable = true;
      output.push(line);
      continue;
    }
    if (inTable && !line.trim().startsWith('|')) {
      inTable = false;
    }

    // Skip prose paragraphs (non-empty lines that aren't headings, code, or tables)
    // But keep list items and blockquotes
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ') || line.trim().startsWith('> ')) {
      output.push(line);
      continue;
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
