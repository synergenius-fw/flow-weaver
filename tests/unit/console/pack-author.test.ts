/**
 * A pack opened as the project: recognised as one, its manifest generated
 * and validated the way `fw market pack` does, and the difference from the
 * committed manifest said in words.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { detectPackProject, checkPackProject, manifestChanges } from '../../../src/console/author';
import { writeManifest } from '../../../src/marketplace/manifest';
import type { TMarketplaceManifest } from '../../../src/marketplace/types';

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-author-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'flow-weaver-pack-demo', version: '0.1.0', description: 'A demo pack', keywords: ['flow-weaver-marketplace-pack'],
    flowWeaver: { engineVersion: '>=0.1.0' },
  }));
  fs.mkdirSync(path.join(dir, 'src', 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'nodes', 'double.ts'), `
/**
 * Doubles a number.
 * @flowWeaver nodeType
 * @expression
 */
export function double(n: number): { doubled: number } {
  return { doubled: n * 2 };
}
`);
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('detectPackProject', () => {
  it('recognises a pack by name or keyword', () => {
    expect(detectPackProject(dir)).toEqual({ isPack: true, name: 'flow-weaver-pack-demo', version: '0.1.0' });
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-notpack-'));
    fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: 'my-app', keywords: ['flow-weaver-marketplace-pack'] }));
    expect(detectPackProject(other).isPack).toBe(true);
    fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: 'my-app' }));
    expect(detectPackProject(other).isPack).toBe(false);
    fs.rmSync(other, { recursive: true, force: true });
  });

  it('recognises a pack by its manifest alone', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-manifestpack-'));
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: '@acme/pipelines', version: '1.0.0' }));
    fs.writeFileSync(path.join(d, 'flowweaver.manifest.json'), JSON.stringify({ manifestVersion: 2, name: '@acme/pipelines', version: '1.0.0', nodeTypes: [], workflows: [], patterns: [] }));
    expect(detectPackProject(d)).toEqual({ isPack: true, name: '@acme/pipelines', version: '1.0.0' });
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('is not a pack without a package.json', () => {
    expect(detectPackProject(os.tmpdir()).isPack).toBe(false);
  });
});

describe('checkPackProject', () => {
  it('generates the manifest from source and validates it, without writing', async () => {
    const check = await checkPackProject(dir);
    expect(check.name).toBe('flow-weaver-pack-demo');
    expect(check.manifest.nodeTypes.map((n) => n.name)).toEqual(['double']);
    expect(check.manifest.nodeTypes[0].outputs).toEqual([{ name: 'doubled', type: 'number', optional: false, description: '' }]);
    expect(check.hasManifest).toBe(false);
    expect(check.changes).toEqual(['No flowweaver.manifest.json yet; fw market pack writes it.']);
    expect(fs.existsSync(path.join(dir, 'flowweaver.manifest.json'))).toBe(false);
    expect(check.issues.every((i) => typeof i.code === 'string')).toBe(true);
  }, 60000);

  it('says what writing would change once a manifest exists', async () => {
    const first = await checkPackProject(dir);
    // Commit the manifest as it stands, then change the source.
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    writeManifest(dir, { manifestVersion: 2, name: first.name, version: first.version, description: 'A demo pack', nodeTypes: [], workflows: [], patterns: [] });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...raw, version: '0.2.0' }));
    const second = await checkPackProject(dir);
    expect(second.hasManifest).toBe(true);
    expect(second.changes).toEqual(['version 0.1.0 → 0.2.0', 'node type double added']);
  }, 60000);
});

describe('manifestChanges', () => {
  const base = (over: Partial<TMarketplaceManifest> = {}): TMarketplaceManifest => ({
    manifestVersion: 2, name: 'p', version: '1.0.0', nodeTypes: [], workflows: [], patterns: [], ...over,
  });
  const nt = (name: string, out = 'x') => ({ name, functionName: name, file: 'f', isAsync: false, inputs: {}, outputs: { [out]: { dataType: 'STRING' as const } } });

  it('notices a node type whose ports changed', () => {
    expect(manifestChanges(base({ nodeTypes: [nt('a')] }), base({ nodeTypes: [nt('a', 'y')] }))).toEqual(['node type a changed']);
  });

  it('is empty when nothing would change', () => {
    expect(manifestChanges(base({ nodeTypes: [nt('a')] }), base({ nodeTypes: [nt('a')] }))).toEqual([]);
  });

  it('lists removals', () => {
    expect(manifestChanges(base({ workflows: [{ name: 'w', functionName: 'w', file: 'f', startPorts: {}, exitPorts: {}, nodeCount: 1 }] }), base())).toEqual(['workflow w removed']);
  });
});
