/**
 * Installed packs as the console reads them: the namespace, whether the
 * engine is new enough, which pack a resolved file came from, and the
 * manifest turned into something a person can scan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { describePacks, engineCompatible, packForFile, packForSpecifier, packageOfSpecifier, packNamespace, type InstalledRef } from '../../../src/console/packs';

let project: string;

function fakePack(name: string, manifest: Record<string, unknown>, version = '1.2.3'): void {
  const dir = path.join(project, 'node_modules', ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  fs.writeFileSync(path.join(dir, 'flowweaver.manifest.json'), JSON.stringify({ manifestVersion: 2, name, version, nodeTypes: [], workflows: [], patterns: [], ...manifest }));
}

beforeAll(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-packs-'));
  fakePack('@acme/flow-weaver-pack-audio', {
    description: 'Audio nodes',
    engineVersion: '>=0.1.0',
    nodeTypes: [{ name: 'trim', functionName: 'trimAudio', description: 'Trim a clip', file: 'dist/trim.js', isAsync: false,
      inputs: { clip: { dataType: 'OBJECT' }, seconds: { dataType: 'NUMBER', optional: true, description: 'How much' } },
      outputs: { clip: { dataType: 'OBJECT' } }, visuals: { color: 'purple', icon: 'contentCut' } }],
    exportTargets: [{ name: 'audio-cloud', description: 'Deploy to Audio Cloud', file: 'dist/target.js' }],
    tagHandlers: [{ tags: ['bitrate', 'codec'], namespace: 'audio', scope: 'both', file: 'dist/tags.js' }],
    validationRuleSets: [{ name: 'Audio rules', namespace: 'audio', file: 'dist/rules.js' }],
    docs: [{ slug: 'audio-recording', name: 'Audio Recording', file: 'docs/recording.md' }],
    cliEntrypoint: 'dist/cli.js',
    cliCommands: [{ name: 'replay', description: 'Replay a recording', arguments: [{ syntax: '<recording>' }], options: [{ flags: '--speed <n>', description: 'Speed' }] }],
    mcpEntrypoint: 'dist/mcp.js',
    mcpTools: [{ name: 'fw_audio_replay', description: 'Replay' }],
  });
  fakePack('flow-weaver-pack-future', { engineVersion: '>=99.0.0', cliCommands: [{ name: 'x', description: 'no entrypoint, so not offered' }] }, '0.0.1');
  // A pack named the way an organisation names things: a pack all the same.
  fakePack('@acme/pipelines', { description: 'Pipelines, named by policy' }, '3.0.0');
});
afterAll(() => { fs.rmSync(project, { recursive: true, force: true }); });

describe('packNamespace', () => {
  it('drops the scope and the prefix', () => {
    expect(packNamespace('@acme/flow-weaver-pack-audio')).toBe('audio');
    expect(packNamespace('flow-weaver-pack-example')).toBe('example');
  });
});

const installed: InstalledRef[] = [
  { name: '@acme/pipelines', path: '/p/node_modules/@acme/pipelines' },
  { name: 'flow-weaver-pack-example', path: 'C:\\p\\node_modules\\flow-weaver-pack-example' },
];

describe('packForFile', () => {
  it('names the installed pack a resolved file sits under, whatever the pack is called, on either separator', () => {
    expect(packForFile('/p/node_modules/@acme/pipelines/dist/trim.js', installed)).toBe('@acme/pipelines');
    expect(packForFile('C:\\p\\node_modules\\flow-weaver-pack-example\\dist\\job.js', installed)).toBe('flow-weaver-pack-example');
  });

  it("answers null for the project's own files and for dependencies that are not packs", () => {
    expect(packForFile('/p/src/flow.ts', installed)).toBeNull();
    expect(packForFile('/p/node_modules/flow-weaver-pack-not-installed/index.js', installed)).toBeNull();
    expect(packForFile('/p/node_modules/@acme/pipelines-extra/index.js', installed)).toBeNull();
  });
});

describe('packForSpecifier', () => {
  it('reads the package out of a specifier', () => {
    expect(packageOfSpecifier('@acme/pipelines/dist/trim.js')).toBe('@acme/pipelines');
    expect(packageOfSpecifier('flow-weaver-pack-example')).toBe('flow-weaver-pack-example');
    expect(packageOfSpecifier('./utils')).toBeNull();
  });

  it('names the installed pack an @fwImport specifier points into, and nothing else', () => {
    expect(packForSpecifier('@acme/pipelines/dist/trim.js', installed)).toBe('@acme/pipelines');
    expect(packForSpecifier('flow-weaver-pack-example', installed)).toBe('flow-weaver-pack-example');
    expect(packForSpecifier('lodash', installed)).toBeNull();
    expect(packForSpecifier('@acme/flow-weaver-pack-audio/x', installed)).toBeNull();
    expect(packForSpecifier(undefined, installed)).toBeNull();
  });
});

describe('engineCompatible', () => {
  it('reads the ranges packs actually use', () => {
    expect(engineCompatible('>=0.17.7', '0.37.6')).toBe(true);
    expect(engineCompatible('>=99.0.0', '0.37.6')).toBe(false);
    expect(engineCompatible('^0.37.0', '0.37.6')).toBe(true);
    expect(engineCompatible('^0.36.0', '0.37.6')).toBe(false);
    expect(engineCompatible('~0.37.1', '0.37.6')).toBe(true);
    expect(engineCompatible('0.37.6', '0.37.6')).toBe(true);
    expect(engineCompatible(undefined, '0.37.6')).toBe(true);
  });

  it('does not guess at a range it cannot read', () => {
    expect(engineCompatible('>=0.1.0 <1.0.0 || 2.x', '0.37.6')).toBeNull();
  });
});

describe('describePacks', () => {
  it('turns the manifests into views, by namespace', async () => {
    const packs = await describePacks(project);
    expect(packs.map((p) => p.namespace)).toEqual(['audio', 'future', 'pipelines']);
    expect(packs[2]).toMatchObject({ name: '@acme/pipelines', version: '3.0.0', description: 'Pipelines, named by policy' });
    const audio = packs[0];
    expect(audio).toMatchObject({ name: '@acme/flow-weaver-pack-audio', version: '1.2.3', compatible: true, description: 'Audio nodes' });
    expect(audio.nodeTypes[0]).toMatchObject({ name: 'trim', color: 'purple', icon: 'contentCut' });
    expect(audio.nodeTypes[0].inputs).toEqual([
      { name: 'clip', type: 'object', optional: false, description: '' },
      { name: 'seconds', type: 'number', optional: true, description: 'How much' },
    ]);
    expect(audio.exportTargets).toEqual([{ name: 'audio-cloud', description: 'Deploy to Audio Cloud' }]);
    expect(audio.tagHandlers).toEqual([{ tags: ['bitrate', 'codec'], namespace: 'audio', scope: 'both' }]);
    expect(audio.cliCommands).toEqual([{ name: 'replay', description: 'Replay a recording', usage: 'fw audio replay <recording>', flags: [{ flag: '--speed <n>', description: 'Speed', default: '' }] }]);
    expect(audio.mcpTools).toEqual([{ name: 'fw_audio_replay', description: 'Replay' }]);
    expect(audio.docs[0].slug).toBe('audio-recording');
  });

  it('marks a pack that wants a newer engine, and offers no commands without an entrypoint', async () => {
    const future = (await describePacks(project))[1];
    expect(future.compatible).toBe(false);
    expect(future.engineVersion).toBe('>=99.0.0');
    expect(future.cliCommands).toEqual([]);
  });

  it('is empty for a project with no node_modules', async () => {
    expect(await describePacks(path.join(project, 'nowhere'))).toEqual([]);
  });
});
