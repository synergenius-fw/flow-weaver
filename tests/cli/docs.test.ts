/**
 * Tests for docs commands (list, read, search)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the docs module
vi.mock('../../src/docs/index.js', () => ({
  listTopics: vi.fn(),
  readTopic: vi.fn(),
  readTopicStructured: vi.fn(),
  searchDocs: vi.fn(),
}));

vi.mock('../../src/cli/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    newline: vi.fn(),
    section: vi.fn(),
  },
}));

import { docsListCommand, docsReadCommand, docsSearchCommand } from '../../src/cli/commands/docs';
import { listTopics, readTopic, readTopicStructured, searchDocs } from '../../src/docs/index.js';
import { logger } from '../../src/cli/utils/logger.js';

let origExit: typeof process.exit;
let origStdoutWrite: typeof process.stdout.write;
let stdoutChunks: string[];

beforeEach(() => {
  vi.clearAllMocks();
  origExit = process.exit;
  origStdoutWrite = process.stdout.write;
  process.exit = vi.fn() as never;
  stdoutChunks = [];
  process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.exit = origExit;
  process.stdout.write = origStdoutWrite;
});

// -- docsListCommand --

describe('docsListCommand', () => {
  it('should exit(1) when no topics are found', async () => {
    vi.mocked(listTopics).mockReturnValue([]);

    await docsListCommand({});

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('No documentation topics'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should output JSON when --json is set', async () => {
    vi.mocked(listTopics).mockReturnValue([
      { slug: 'getting-started', description: 'How to get started' },
      { slug: 'syntax', description: 'Annotation syntax reference' },
    ]);

    await docsListCommand({ json: true });

    const output = stdoutChunks.join('');
    const parsed = JSON.parse(output);
    expect(parsed.topics).toHaveLength(2);
    expect(parsed.topics[0].slug).toBe('getting-started');
  });

  it('should display formatted list in human-readable mode', async () => {
    vi.mocked(listTopics).mockReturnValue([
      { slug: 'getting-started', description: 'How to get started' },
      { slug: 'syntax', description: 'Annotation syntax reference' },
    ]);

    await docsListCommand({});

    expect(logger.section).toHaveBeenCalledWith('Flow Weaver Documentation');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('getting-started'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('syntax'));
  });
});

// -- docsReadCommand --

describe('docsReadCommand', () => {
  it('should output JSON when --json is set and topic exists', async () => {
    vi.mocked(readTopicStructured).mockReturnValue({
      slug: 'syntax',
      title: 'Syntax',
      sections: [{ heading: 'Overview', content: 'Some content' }],
    });

    await docsReadCommand('syntax', { json: true });

    const output = stdoutChunks.join('');
    const parsed = JSON.parse(output);
    expect(parsed.slug).toBe('syntax');
    expect(parsed.sections).toHaveLength(1);
  });

  it('should exit(1) when --json is set and topic does not exist', async () => {
    vi.mocked(readTopicStructured).mockReturnValue(null);

    await docsReadCommand('nonexistent', { json: true });

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown topic'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should output topic content to stdout in normal mode', async () => {
    vi.mocked(readTopic).mockReturnValue({
      slug: 'syntax',
      content: '# Syntax Reference\n\nUse annotations to define nodes.',
    });

    await docsReadCommand('syntax', {});

    const output = stdoutChunks.join('');
    expect(output).toContain('# Syntax Reference');
  });

  it('should pass compact option through to readTopic', async () => {
    vi.mocked(readTopic).mockReturnValue({
      slug: 'syntax',
      content: 'compact content',
    });

    await docsReadCommand('syntax', { compact: true });

    expect(readTopic).toHaveBeenCalledWith('syntax', true);
  });

  it('should exit(1) when topic does not exist in normal mode', async () => {
    vi.mocked(readTopic).mockReturnValue(null);

    try {
      await docsReadCommand('nonexistent', {});
    } catch {
      // mocked process.exit doesn't halt, so the function may throw
    }

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown topic'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

// -- docsSearchCommand --

describe('docsSearchCommand', () => {
  it('should output JSON when --json is set', async () => {
    vi.mocked(searchDocs).mockReturnValue([
      { slug: 'syntax', heading: 'Node Types', excerpt: 'Define node types...' },
    ]);

    await docsSearchCommand('node', { json: true });

    const output = stdoutChunks.join('');
    const parsed = JSON.parse(output);
    expect(parsed.query).toBe('node');
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].slug).toBe('syntax');
  });

  it('should show "no results" message when search has no matches', async () => {
    vi.mocked(searchDocs).mockReturnValue([]);

    await docsSearchCommand('xyzzyqwerty', {});

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('No results found'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('xyzzyqwerty'));
  });

  it('should display search results in human-readable mode', async () => {
    vi.mocked(searchDocs).mockReturnValue([
      { slug: 'syntax', heading: 'Node Types', excerpt: 'Define node types using annotations.' },
      { slug: 'getting-started', heading: 'Setup', excerpt: 'Install and configure.' },
    ]);

    await docsSearchCommand('node', {});

    expect(logger.section).toHaveBeenCalledWith(expect.stringContaining('node'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[syntax]'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[getting-started]'));
  });

  it('should deduplicate results by slug+heading', async () => {
    vi.mocked(searchDocs).mockReturnValue([
      { slug: 'syntax', heading: 'Node Types', excerpt: 'First occurrence' },
      { slug: 'syntax', heading: 'Node Types', excerpt: 'Duplicate' },
      { slug: 'syntax', heading: 'Workflows', excerpt: 'Different heading' },
    ]);

    await docsSearchCommand('types', {});

    // Count calls that contain [syntax] and a heading
    const logCalls = vi.mocked(logger.log).mock.calls.map((c) => c[0]);
    const resultLines = logCalls.filter((l) => l.includes('[syntax]'));
    // Two unique keys: syntax:Node Types, syntax:Workflows
    expect(resultLines).toHaveLength(2);
  });

  it('should limit output to 15 results', async () => {
    const manyResults = Array.from({ length: 20 }, (_, i) => ({
      slug: `topic-${i}`,
      heading: `Section ${i}`,
      excerpt: `Excerpt ${i}`,
    }));
    vi.mocked(searchDocs).mockReturnValue(manyResults);

    await docsSearchCommand('all', {});

    const logCalls = vi.mocked(logger.log).mock.calls.map((c) => c[0]);
    const resultLines = logCalls.filter((l) => l.match(/\[topic-\d+\]/));
    expect(resultLines.length).toBeLessThanOrEqual(15);
  });
});
