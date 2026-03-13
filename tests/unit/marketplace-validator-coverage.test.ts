/**
 * Coverage tests for marketplace validator export target rules (lines 108-128).
 * Covers TGT-001 (name/file required) and TGT-002 (unique names) validation.
 */

import { validatePackage } from '../../src/marketplace/validator';
import type { TMarketplaceManifest } from '../../src/marketplace/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeValidManifest(overrides: Partial<TMarketplaceManifest> = {}): TMarketplaceManifest {
  return {
    manifestVersion: 2,
    name: 'flow-weaver-pack-test',
    version: '1.0.0',
    nodeTypes: [
      {
        name: 'testNode',
        description: 'A test node',
        file: 'dist/test.js',
        functionName: 'testNode',
        isAsync: false,
        inputs: {},
        outputs: {},
        visuals: { color: '#ff0000' },
      },
    ],
    workflows: [],
    patterns: [],
    ...overrides,
  };
}

function makeValidPackageJson(): Record<string, unknown> {
  return {
    name: 'flow-weaver-pack-test',
    version: '1.0.0',
    keywords: ['flow-weaver-marketplace-pack'],
    flowWeaver: { engineVersion: '>=0.20.0' },
    peerDependencies: { '@synergenius/flow-weaver': '>=0.20.0' },
  };
}

describe('marketplace validator export target rules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-validator-test-'));
    // Write a valid package.json and README
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(makeValidPackageJson()));
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TGT-001: reports error when export target has no name', async () => {
    const manifest = makeValidManifest({
      exportTargets: [
        { name: '', file: 'dist/target.js' },
      ],
    });

    const result = await validatePackage(tmpDir, manifest);

    const tgt001 = result.issues.filter((i) => i.code === 'TGT-001');
    expect(tgt001.length).toBeGreaterThanOrEqual(1);
    expect(tgt001.some((i) => i.message.includes('must have a "name"'))).toBe(true);
  });

  it('TGT-001: reports error when export target has no file', async () => {
    const manifest = makeValidManifest({
      exportTargets: [
        { name: 'my-target', file: '' },
      ],
    });

    const result = await validatePackage(tmpDir, manifest);

    const tgt001 = result.issues.filter((i) => i.code === 'TGT-001');
    expect(tgt001.length).toBeGreaterThanOrEqual(1);
    expect(tgt001.some((i) => i.message.includes('must have a "file"'))).toBe(true);
  });

  it('TGT-001: reports error for unnamed export target referencing name in message', async () => {
    const manifest = makeValidManifest({
      exportTargets: [
        { name: '', file: '' },
      ],
    });

    const result = await validatePackage(tmpDir, manifest);

    const tgt001 = result.issues.filter((i) => i.code === 'TGT-001');
    // Should have both name and file errors
    expect(tgt001.length).toBeGreaterThanOrEqual(2);
    // The file error for an unnamed target should say "(unnamed)"
    expect(tgt001.some((i) => i.message.includes('(unnamed)'))).toBe(true);
  });

  it('TGT-002: reports error for duplicate export target names', async () => {
    const manifest = makeValidManifest({
      exportTargets: [
        { name: 'duplicate-target', file: 'dist/target-a.js' },
        { name: 'duplicate-target', file: 'dist/target-b.js' },
      ],
    });

    const result = await validatePackage(tmpDir, manifest);

    const tgt002 = result.issues.filter((i) => i.code === 'TGT-002');
    expect(tgt002).toHaveLength(1);
    expect(tgt002[0].message).toContain('Duplicate export target name');
    expect(tgt002[0].message).toContain('duplicate-target');
    expect(tgt002[0].severity).toBe('error');
  });

  it('passes validation with valid export targets', async () => {
    const manifest = makeValidManifest({
      exportTargets: [
        { name: 'target-a', file: 'dist/target-a.js' },
        { name: 'target-b', file: 'dist/target-b.js' },
      ],
    });

    const result = await validatePackage(tmpDir, manifest);

    const targetIssues = result.issues.filter(
      (i) => i.code === 'TGT-001' || i.code === 'TGT-002'
    );
    expect(targetIssues).toHaveLength(0);
  });
});
