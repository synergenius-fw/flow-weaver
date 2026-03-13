/**
 * Coverage tests for marketplace registry discovery functions (lines 243-281).
 * Covers discoverDocTopics and discoverInitContributions.
 *
 * Strategy: create a real temp directory structure with manifest files
 * so listInstalledPackages picks them up naturally.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  discoverDocTopics,
  discoverInitContributions,
} from '../../src/marketplace/registry';
import type { TMarketplaceManifest } from '../../src/marketplace/types';

function makeManifest(overrides: Partial<TMarketplaceManifest> = {}): TMarketplaceManifest {
  return {
    manifestVersion: 2,
    name: 'flow-weaver-pack-test',
    version: '1.0.0',
    nodeTypes: [],
    workflows: [],
    patterns: [],
    ...overrides,
  };
}

describe('marketplace registry discovery', () => {
  let tmpDir: string;

  function installPackage(name: string, manifest: TMarketplaceManifest, version?: string) {
    const pkgDir = path.join(tmpDir, 'node_modules', name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'flowweaver.manifest.json'),
      JSON.stringify(manifest)
    );
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name, version: version ?? manifest.version })
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-registry-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('discoverDocTopics', () => {
    it('returns empty array when no packages have docs', async () => {
      installPackage('flow-weaver-pack-nodocs', makeManifest({ name: 'flow-weaver-pack-nodocs' }));

      const topics = await discoverDocTopics(tmpDir);
      expect(topics).toEqual([]);
    });

    it('discovers doc topics from installed packages', async () => {
      installPackage(
        'flow-weaver-pack-docs',
        makeManifest({
          name: 'flow-weaver-pack-docs',
          docs: [
            {
              slug: 'getting-started',
              name: 'Getting Started',
              description: 'Intro guide',
              file: 'docs/getting-started.md',
            },
            {
              slug: 'advanced',
              name: 'Advanced Usage',
              file: 'docs/advanced.md',
            },
          ],
        })
      );

      const topics = await discoverDocTopics(tmpDir);

      expect(topics).toHaveLength(2);
      expect(topics[0]).toMatchObject({
        slug: 'getting-started',
        name: 'Getting Started',
        description: 'Intro guide',
        packageName: 'flow-weaver-pack-docs',
      });
      expect(topics[0].absoluteFile).toContain('getting-started.md');
      expect(topics[1].slug).toBe('advanced');
    });

    it('aggregates docs from multiple packages', async () => {
      installPackage(
        'flow-weaver-pack-a',
        makeManifest({
          name: 'flow-weaver-pack-a',
          docs: [{ slug: 'topic-a', name: 'Topic A', file: 'docs/a.md' }],
        })
      );
      installPackage(
        'flow-weaver-pack-b',
        makeManifest({
          name: 'flow-weaver-pack-b',
          docs: [{ slug: 'topic-b', name: 'Topic B', file: 'docs/b.md' }],
        })
      );

      const topics = await discoverDocTopics(tmpDir);

      expect(topics).toHaveLength(2);
      const names = topics.map((t) => t.packageName).sort();
      expect(names).toEqual(['flow-weaver-pack-a', 'flow-weaver-pack-b']);
    });
  });

  describe('discoverInitContributions', () => {
    it('returns empty array when no packages have init contributions', async () => {
      installPackage('flow-weaver-pack-noinit', makeManifest({ name: 'flow-weaver-pack-noinit' }));

      const contributions = await discoverInitContributions(tmpDir);
      expect(contributions).toEqual([]);
    });

    it('discovers init contributions from installed packages', async () => {
      installPackage(
        'flow-weaver-pack-init',
        makeManifest({
          name: 'flow-weaver-pack-init',
          initContributions: {
            useCase: {
              id: 'ai-pipeline',
              name: 'AI Pipeline',
              description: 'Build AI data pipelines',
            },
            templates: ['template-ai-basic', 'template-ai-advanced'],
          },
        })
      );

      const contributions = await discoverInitContributions(tmpDir);

      expect(contributions).toHaveLength(1);
      expect(contributions[0]).toMatchObject({
        useCase: {
          id: 'ai-pipeline',
          name: 'AI Pipeline',
          description: 'Build AI data pipelines',
        },
        templates: ['template-ai-basic', 'template-ai-advanced'],
        packageName: 'flow-weaver-pack-init',
      });
    });

    it('skips packages without initContributions', async () => {
      installPackage(
        'flow-weaver-pack-nocontrib',
        makeManifest({ name: 'flow-weaver-pack-nocontrib' })
      );
      installPackage(
        'flow-weaver-pack-withcontrib',
        makeManifest({
          name: 'flow-weaver-pack-withcontrib',
          initContributions: {
            useCase: {
              id: 'data-ops',
              name: 'Data Ops',
              description: 'Data operations',
            },
          },
        })
      );

      const contributions = await discoverInitContributions(tmpDir);

      expect(contributions).toHaveLength(1);
      expect(contributions[0].packageName).toBe('flow-weaver-pack-withcontrib');
    });
  });
});
