import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateManifest } from '../../src/marketplace/manifest.js';

/**
 * `fw market pack` derives nodeTypes, workflows and patterns from source and
 * must carry every hand-written extension field across. Losing cliCommands or
 * mcpTools is not cosmetic: pack-commands.ts and pack-tools.ts refuse to load
 * a pack whose list is empty, so a regenerated manifest would silently switch
 * the pack's commands and tools off.
 */
describe('generateManifest preserves hand-written extension fields', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-pack-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'flow-weaver-pack-example', version: '1.2.3', keywords: ['flow-weaver-marketplace-pack'] }),
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps every extension field an author declared in the existing manifest', async () => {
    const declared = {
      manifestVersion: 2,
      name: 'flow-weaver-pack-example',
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      tagHandlers: [{ tags: ['secret'], namespace: 'example', scope: 'both', file: 'dist/tags.js' }],
      validationRuleSets: [{ name: 'example', namespace: 'example', file: 'dist/rules.js' }],
      exportTargets: [{ name: 'example', file: 'dist/target.js' }],
      docs: [{ slug: 'example', name: 'Example', file: 'docs/example.md' }],
      initContributions: { templates: ['example'] },
      cliEntrypoint: 'dist/cli.js',
      cliCommands: [{ name: 'hello', description: 'Say hello' }],
      mcpEntrypoint: 'dist/mcp.js',
      mcpTools: [{ name: 'fw_example_hello', description: 'Say hello over MCP' }],
    };
    fs.writeFileSync(path.join(dir, 'flowweaver.manifest.json'), JSON.stringify(declared));

    const { manifest, errors } = await generateManifest({ directory: dir });

    expect(errors).toEqual([]);
    for (const field of [
      'tagHandlers',
      'validationRuleSets',
      'exportTargets',
      'docs',
      'initContributions',
      'cliEntrypoint',
      'cliCommands',
      'mcpEntrypoint',
      'mcpTools',
    ] as const) {
      expect(manifest[field]).toEqual(declared[field]);
    }
    // Derived identity still comes from package.json, not the stale manifest.
    expect(manifest.version).toBe('1.2.3');
  });

  it('adds nothing when there is no existing manifest', async () => {
    const { manifest } = await generateManifest({ directory: dir });
    expect(manifest.cliCommands).toBeUndefined();
    expect(manifest.mcpTools).toBeUndefined();
  });
});
