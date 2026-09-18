import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listTopics, readTopic, searchDocs } from '../../../src/docs/index.js';
import { loadPackDocTopics } from '../../../src/docs/pack-topics.js';
import { buildContext } from '../../../src/context/index.js';

/**
 * A pack's `docs` manifest field must surface in the same registry the core
 * topics use, so an assistant reading `fw_docs` sees pack documentation
 * without knowing packs exist.
 *
 * The registry is process-global, keyed by slug, and keeps the first path it
 * is given. The pack is therefore created once for the whole file: a fresh
 * directory per test would leave the registry pointing at a deleted file.
 */
describe('loadPackDocTopics', () => {
  let projectDir: string;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-pack-docs-'));
    const packDir = path.join(projectDir, 'node_modules', 'flow-weaver-pack-doctest');
    fs.mkdirSync(path.join(packDir, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(packDir, 'package.json'),
      JSON.stringify({ name: 'flow-weaver-pack-doctest', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(packDir, 'flowweaver.manifest.json'),
      JSON.stringify({
        manifestVersion: 2,
        name: 'flow-weaver-pack-doctest',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
        docs: [
          {
            slug: 'doctest-topic',
            name: 'Doctest Topic',
            description: 'A topic contributed by a pack',
            keywords: ['doctestkeyword'],
            presets: ['ops'],
            file: 'docs/doctest.md',
          },
          { slug: 'doctest-missing', name: 'Missing', file: 'docs/does-not-exist.md' },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(packDir, 'docs', 'doctest.md'),
      '# Doctest Topic\n\n## Using it\n\nCall doctestkeyword first.\n',
    );
  });

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  it('registers declared topics so they list, read and search like core topics', async () => {
    const offered = await loadPackDocTopics(projectDir);
    expect(offered).toBe(1);

    const listed = listTopics().find((t) => t.slug === 'doctest-topic');
    expect(listed).toMatchObject({
      name: 'Doctest Topic',
      description: 'A topic contributed by a pack',
      keywords: ['doctestkeyword'],
    });

    const doc = readTopic('doctest-topic');
    expect(doc?.content).toContain('Call doctestkeyword first.');

    expect(searchDocs('doctestkeyword').some((r) => r.slug === 'doctest-topic')).toBe(true);
  });

  it('skips a topic whose file is missing and says so on stderr', async () => {
    await loadPackDocTopics(projectDir);
    expect(listTopics().some((t) => t.slug === 'doctest-missing')).toBe(false);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('doctest-missing'));
  });

  it('does not duplicate a topic when called again', async () => {
    await loadPackDocTopics(projectDir);
    const before = listTopics().filter((t) => t.slug === 'doctest-topic').length;
    await loadPackDocTopics(projectDir);
    expect(listTopics().filter((t) => t.slug === 'doctest-topic').length).toBe(before);
    expect(before).toBe(1);
  });

  it('adds the topic to the fw_context presets it names', async () => {
    await loadPackDocTopics(projectDir);
    expect(buildContext({ preset: 'ops' }).topicSlugs).toContain('doctest-topic');
    expect(buildContext({ preset: 'core' }).topicSlugs).not.toContain('doctest-topic');
  });

  it('returns 0 when the project has no node_modules', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-no-packs-'));
    try {
      expect(await loadPackDocTopics(empty)).toBe(0);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
