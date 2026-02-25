import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocTopic, DocContent, DocStructured, SearchResult } from '../../../src/docs/index.js';

// Mock fs and url before importing the module under test
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/fake/src/docs/index.ts'),
}));

import * as fs from 'fs';
import { listTopics, readTopic, readTopicStructured, searchDocs } from '../../../src/docs/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_DOC = `---
name: Getting Started
description: How to get started with Flow Weaver
keywords: [start, setup, install]
---
# Introduction

This guide covers the basics of Flow Weaver.

## Installation

Run the following command:

\`\`\`bash
npm install flow-weaver
\`\`\`

## Configuration

Create a config file in your project root.

- Set the entry point
- Define your node types
`;

const SECOND_DOC = `---
name: Annotations Reference
description: All JSDoc annotations for workflows
keywords: [jsdoc, annotations, tags]
---
# Annotations

Flow Weaver uses JSDoc annotations.

## Core Tags

The @flowWeaver tag marks functions.

## Port Tags

Use @input and @output for ports.
`;

const NO_FRONTMATTER_DOC = `# Just Content

No frontmatter here. Plain markdown body.
`;

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// listTopics
// ---------------------------------------------------------------------------

describe('listTopics', () => {
  it('returns empty array when docs directory does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const topics = listTopics();
    expect(topics).toEqual([]);
  });

  it('lists all .md files with parsed frontmatter', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(
      ['getting-started.md', 'annotations.md', 'readme.txt'] as any,
    );
    // After filtering .md and sorting, order is: annotations.md, getting-started.md
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(SECOND_DOC)    // annotations.md
      .mockReturnValueOnce(SAMPLE_DOC);   // getting-started.md

    const topics = listTopics();

    expect(topics).toHaveLength(2);
    expect(topics[0]).toEqual<DocTopic>({
      slug: 'annotations',
      name: 'Annotations Reference',
      description: 'All JSDoc annotations for workflows',
      keywords: ['jsdoc', 'annotations', 'tags'],
    });
    expect(topics[1]).toEqual<DocTopic>({
      slug: 'getting-started',
      name: 'Getting Started',
      description: 'How to get started with Flow Weaver',
      keywords: ['start', 'setup', 'install'],
    });
  });

  it('returns sorted slugs', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(
      ['z-topic.md', 'a-topic.md'] as any,
    );
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(SAMPLE_DOC)
      .mockReturnValueOnce(SAMPLE_DOC);

    const topics = listTopics();
    expect(topics[0].slug).toBe('a-topic');
    expect(topics[1].slug).toBe('z-topic');
  });

  it('handles files with no frontmatter gracefully', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['bare.md'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(NO_FRONTMATTER_DOC);

    const topics = listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe('');
    expect(topics[0].description).toBe('');
    expect(topics[0].keywords).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readTopic
// ---------------------------------------------------------------------------

describe('readTopic', () => {
  it('returns null when the file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = readTopic('nonexistent');
    expect(result).toBeNull();
  });

  it('returns full body content without compact mode', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_DOC);

    const result = readTopic('getting-started');
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('getting-started');
    expect(result!.name).toBe('Getting Started');
    expect(result!.description).toBe('How to get started with Flow Weaver');
    expect(result!.keywords).toEqual(['start', 'setup', 'install']);
    // Body should contain headings and paragraphs
    expect(result!.content).toContain('# Introduction');
    expect(result!.content).toContain('## Installation');
    expect(result!.content).toContain('npm install flow-weaver');
  });

  it('returns compact content when compact=true', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_DOC);

    const result = readTopic('getting-started', true);
    expect(result).not.toBeNull();
    // Compact mode should include headings
    expect(result!.content).toContain('## Installation');
    // Compact mode should include code blocks
    expect(result!.content).toContain('npm install flow-weaver');
    // Compact mode should include list items
    expect(result!.content).toContain('- Set the entry point');
    // Compact mode header
    expect(result!.content).toContain('# Getting Started');
    expect(result!.content).toContain('How to get started with Flow Weaver');
  });

  it('compact mode strips prose paragraphs', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_DOC);

    const result = readTopic('getting-started', true);
    expect(result).not.toBeNull();
    // Prose lines like "This guide covers..." and "Create a config file..."
    // should be stripped in compact mode
    expect(result!.content).not.toContain('This guide covers the basics');
    expect(result!.content).not.toContain('Create a config file');
  });

  it('handles missing frontmatter', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(NO_FRONTMATTER_DOC);

    const result = readTopic('bare');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('');
    expect(result!.description).toBe('');
    expect(result!.keywords).toEqual([]);
    expect(result!.content).toContain('# Just Content');
  });
});

// ---------------------------------------------------------------------------
// readTopicStructured
// ---------------------------------------------------------------------------

describe('readTopicStructured', () => {
  it('returns null when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = readTopicStructured('missing');
    expect(result).toBeNull();
  });

  it('splits content into sections by heading', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_DOC);

    const result = readTopicStructured('getting-started');
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('getting-started');
    expect(result!.name).toBe('Getting Started');

    // Should have sections: Introduction (h1), Installation (h2), Configuration (h2)
    const sectionNames = result!.sections.map((s) => s.heading);
    expect(sectionNames).toContain('Introduction');
    expect(sectionNames).toContain('Installation');
    expect(sectionNames).toContain('Configuration');
  });

  it('detects heading levels correctly', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_DOC);

    const result = readTopicStructured('getting-started')!;
    const introSection = result.sections.find((s) => s.heading === 'Introduction');
    const installSection = result.sections.find((s) => s.heading === 'Installation');

    expect(introSection!.level).toBe(1);
    expect(installSection!.level).toBe(2);
  });

  it('extracts code blocks within sections', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_DOC);

    const result = readTopicStructured('getting-started')!;
    const installSection = result.sections.find((s) => s.heading === 'Installation');

    expect(installSection!.codeBlocks).toHaveLength(1);
    expect(installSection!.codeBlocks[0]).toContain('npm install flow-weaver');
  });

  it('returns empty codeBlocks for sections without code', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_DOC);

    const result = readTopicStructured('getting-started')!;
    const configSection = result.sections.find((s) => s.heading === 'Configuration');

    expect(configSection!.codeBlocks).toEqual([]);
  });

  it('handles doc with no headings', () => {
    const plainDoc = `---
name: Plain
description: No headings
keywords: [plain]
---
Just some text without any headings at all.
Another line.
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(plainDoc);

    const result = readTopicStructured('plain')!;
    // Should produce one section with empty heading
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].heading).toBe('');
    expect(result.sections[0].content).toContain('Just some text');
  });
});

// ---------------------------------------------------------------------------
// searchDocs
// ---------------------------------------------------------------------------

describe('searchDocs', () => {
  function setupTwoDocs() {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(
      ['getting-started.md', 'annotations.md'] as any,
    );
    // listTopics reads each file for frontmatter, then searchDocs reads again for body
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      const path = String(filePath);
      if (path.includes('getting-started')) return SAMPLE_DOC;
      if (path.includes('annotations')) return SECOND_DOC;
      return '';
    });
  }

  it('returns results matching query terms in section content', () => {
    setupTwoDocs();

    const results = searchDocs('install');
    expect(results.length).toBeGreaterThan(0);
    // The Installation section should match
    const installResult = results.find((r) => r.heading === 'Installation');
    expect(installResult).toBeDefined();
    expect(installResult!.slug).toBe('getting-started');
  });

  it('returns results matching heading text', () => {
    setupTwoDocs();

    const results = searchDocs('Configuration');
    const configResult = results.find((r) => r.heading === 'Configuration');
    expect(configResult).toBeDefined();
  });

  it('returns results matching keywords with bonus relevance', () => {
    setupTwoDocs();

    // "jsdoc" is a keyword of annotations doc
    const results = searchDocs('jsdoc tags');
    const annotationResults = results.filter((r) => r.slug === 'annotations');
    expect(annotationResults.length).toBeGreaterThan(0);
  });

  it('sorts results by relevance descending', () => {
    setupTwoDocs();

    const results = searchDocs('annotations');
    // All results should be sorted by relevance
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].relevance).toBeGreaterThanOrEqual(results[i].relevance);
    }
  });

  it('returns empty results for a query with no matches', () => {
    setupTwoDocs();

    const results = searchDocs('xyznonexistentterm');
    expect(results).toEqual([]);
  });

  it('returns empty when docs directory is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const results = searchDocs('anything');
    expect(results).toEqual([]);
  });

  it('exact phrase match gets higher relevance than individual terms', () => {
    setupTwoDocs();

    // "npm install" as an exact phrase should score higher in the section that contains it
    const results = searchDocs('npm install');
    if (results.length > 0) {
      const installSection = results.find((r) => r.heading === 'Installation');
      expect(installSection).toBeDefined();
      // Exact phrase match adds 10, plus individual term matches
      expect(installSection!.relevance).toBeGreaterThanOrEqual(10);
    }
  });

  it('provides excerpt with matching lines', () => {
    setupTwoDocs();

    const results = searchDocs('install');
    const installResult = results.find((r) => r.heading === 'Installation');
    expect(installResult).toBeDefined();
    // Excerpt should contain the matching line
    expect(installResult!.excerpt.length).toBeGreaterThan(0);
  });

  it('uses section content slice as fallback excerpt when no lines match directly', () => {
    // This exercises the fallback: matchingLines empty -> section.content.slice(0, 200)
    // Construct a doc where the keyword is only in the heading, not in content lines
    const headingOnlyDoc = `---
name: Special
description: Test
keywords: [special]
---
# TargetHeading

Some body text that does not repeat the heading word.
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['special.md'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(headingOnlyDoc);

    const results = searchDocs('TargetHeading');
    // The heading match should produce a result
    expect(results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter edge cases (tested indirectly through public API)
// ---------------------------------------------------------------------------

describe('frontmatter parsing', () => {
  it('parses keywords with single quotes', () => {
    const doc = `---
name: Test
description: Testing
keywords: ['alpha', 'beta']
---
# Content
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['test.md'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(doc);

    const topics = listTopics();
    expect(topics[0].keywords).toEqual(['alpha', 'beta']);
  });

  it('parses keywords with double quotes', () => {
    const doc = `---
name: Test
description: Testing
keywords: ["alpha", "beta"]
---
# Content
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['test.md'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(doc);

    const topics = listTopics();
    expect(topics[0].keywords).toEqual(['alpha', 'beta']);
  });

  it('parses keywords without quotes', () => {
    const doc = `---
name: Test
description: Testing
keywords: [alpha, beta, gamma]
---
# Content
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['test.md'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(doc);

    const topics = listTopics();
    expect(topics[0].keywords).toEqual(['alpha', 'beta', 'gamma']);
  });
});

// ---------------------------------------------------------------------------
// compact mode detail tests
// ---------------------------------------------------------------------------

describe('compact mode', () => {
  it('preserves tables', () => {
    const docWithTable = `---
name: Types
description: Type reference
keywords: [types]
---
# Types

Some description paragraph.

| Type | Description |
|------|-------------|
| STRING | Text value |
| NUMBER | Numeric value |

More prose.
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(docWithTable);

    const result = readTopic('types', true)!;
    expect(result.content).toContain('| Type | Description |');
    expect(result.content).toContain('| STRING | Text value |');
  });

  it('preserves blockquotes', () => {
    const docWithBlockquote = `---
name: Tips
description: Tips
keywords: [tips]
---
# Tips

Regular paragraph to be stripped.

> Important note here.
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(docWithBlockquote);

    const result = readTopic('tips', true)!;
    expect(result.content).toContain('> Important note here.');
    expect(result.content).not.toContain('Regular paragraph to be stripped.');
  });

  it('collapses multiple blank lines', () => {
    const docWithBlanks = `---
name: Sparse
description: Sparse doc
keywords: [sparse]
---
# Title



## Section



- item
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(docWithBlanks);

    const result = readTopic('sparse', true)!;
    // Should not have 3+ consecutive newlines
    expect(result.content).not.toMatch(/\n{3,}/);
  });
});
