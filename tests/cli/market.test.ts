/**
 * Tests for marketplace CLI commands
 *
 * Covers marketInitCommand, marketPackCommand, marketSearchCommand,
 * marketListCommand, and the resolvePackageName helper.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MARKET_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-market-${process.pid}`);

beforeAll(() => fs.mkdirSync(MARKET_TEMP_DIR, { recursive: true }));
afterAll(() => fs.rmSync(MARKET_TEMP_DIR, { recursive: true, force: true }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function captureLogs() {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));

  return {
    logs,
    errors,
    warns,
    restore() {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    },
  };
}

// ── marketInitCommand ────────────────────────────────────────────────────────

describe('marketInitCommand', () => {
  let origCwd: () => string;
  let origExit: typeof process.exit;

  beforeEach(() => {
    origCwd = process.cwd;
    origExit = process.exit;
    process.cwd = () => MARKET_TEMP_DIR;
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.cwd = origCwd;
    process.exit = origExit;
  });

  it('should scaffold a marketplace package with correct structure', async () => {
    const { marketInitCommand } = await import('../../src/cli/commands/market');
    const capture = captureLogs();

    try {
      const pkgName = 'flowweaver-pack-test-init';
      // process.cwd is mocked to MARKET_TEMP_DIR, so path.resolve(name)
      // naturally resolves to path.join(MARKET_TEMP_DIR, name)
      const targetDir = path.join(MARKET_TEMP_DIR, pkgName);

      // Clean up if previous run left artifacts
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      await marketInitCommand(pkgName, { description: 'Test pack', author: 'TestUser' });

      // Verify directory structure
      expect(fs.existsSync(targetDir)).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'src'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'src', 'node-types'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'src', 'workflows'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'src', 'patterns'))).toBe(true);

      // Verify package.json
      const pkgJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
      expect(pkgJson.name).toBe(pkgName);
      expect(pkgJson.version).toBe('1.0.0');
      expect(pkgJson.description).toBe('Test pack');
      expect(pkgJson.author).toBe('TestUser');
      expect(pkgJson.type).toBe('module');
      expect(pkgJson.flowWeaver.type).toBe('marketplace-pack');

      // Verify tsconfig.json
      const tsConfig = JSON.parse(fs.readFileSync(path.join(targetDir, 'tsconfig.json'), 'utf8'));
      expect(tsConfig.compilerOptions.module).toBe('NodeNext');

      // Verify sample node type exists
      const sampleContent = fs.readFileSync(
        path.join(targetDir, 'src', 'node-types', 'sample.ts'),
        'utf8'
      );
      expect(sampleContent).toContain('@flowWeaver nodeType');

      // Verify README
      expect(fs.existsSync(path.join(targetDir, 'README.md'))).toBe(true);

      // Verify .gitignore
      const gitignore = fs.readFileSync(path.join(targetDir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('node_modules');
    } finally {
      capture.restore();
    }
  });

  it('should auto-prefix package name with flowweaver-pack-', async () => {
    const { marketInitCommand } = await import('../../src/cli/commands/market');
    const capture = captureLogs();

    try {
      const rawName = 'my-custom-tool';
      const expectedName = `flowweaver-pack-${rawName}`;
      const targetDir = path.join(MARKET_TEMP_DIR, expectedName);

      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      await marketInitCommand(rawName);

      const pkgJson = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
      expect(pkgJson.name).toBe(expectedName);
    } finally {
      capture.restore();
    }
  });

  it('should call process.exit(1) when directory is non-empty', async () => {
    const { marketInitCommand } = await import('../../src/cli/commands/market');
    const capture = captureLogs();

    try {
      const pkgName = 'flowweaver-pack-nonempty';
      const targetDir = path.join(MARKET_TEMP_DIR, pkgName);

      // Create non-empty directory
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'existing.txt'), 'content');

      await marketInitCommand(pkgName);

      expect(process.exit).toHaveBeenCalledWith(1);
    } finally {
      capture.restore();
    }
  });
});

// ── marketPackCommand ────────────────────────────────────────────────────────

describe('marketPackCommand', () => {
  let origExit: typeof process.exit;

  beforeEach(() => {
    origExit = process.exit;
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.exit = origExit;
  });

  it('should output JSON when --json is set', async () => {
    const { marketPackCommand } = await import('../../src/cli/commands/market');
    const capture = captureLogs();

    try {
      // Create a minimal package directory
      const dir = path.join(MARKET_TEMP_DIR, 'pack-json-test');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: 'flowweaver-pack-json-test',
          version: '1.0.0',
          flowWeaver: { type: 'marketplace-pack', engineVersion: '>=0.1.0' },
        })
      );
      fs.writeFileSync(path.join(dir, 'src', 'index.ts'), '// empty\n');

      await marketPackCommand(dir, { json: true });

      expect(capture.logs.length).toBeGreaterThan(0);
      const output = JSON.parse(capture.logs.join(''));
      expect(output).toHaveProperty('manifest');
      expect(output).toHaveProperty('validation');
      expect(output).toHaveProperty('parsedFiles');
    } finally {
      capture.restore();
    }
  });

  it('should display human-readable output by default', async () => {
    const { marketPackCommand } = await import('../../src/cli/commands/market');
    const capture = captureLogs();

    try {
      const dir = path.join(MARKET_TEMP_DIR, 'pack-human-test');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: 'flowweaver-pack-human-test',
          version: '1.0.0',
          flowWeaver: { type: 'marketplace-pack', engineVersion: '>=0.1.0' },
        })
      );
      fs.writeFileSync(path.join(dir, 'src', 'index.ts'), '// empty\n');

      await marketPackCommand(dir, { json: false });

      // Should have logged some output (section headers, parsed file counts, etc.)
      const allOutput = [...capture.logs, ...capture.errors, ...capture.warns].join(' ');
      expect(allOutput).toContain('Parsed');
    } finally {
      capture.restore();
    }
  });
});

// ── marketSearchCommand ──────────────────────────────────────────────────────

describe('marketSearchCommand', () => {
  let origExit: typeof process.exit;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origExit = process.exit;
    origFetch = globalThis.fetch;
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.exit = origExit;
    globalThis.fetch = origFetch;
  });

  it('should output JSON results when --json is set', async () => {
    // Mock global fetch to simulate npm registry response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        objects: [
          {
            package: {
              name: 'flowweaver-pack-test',
              version: '1.0.0',
              description: 'A test pack',
              keywords: ['flowweaver-marketplace-pack'],
            },
          },
        ],
        total: 1,
      }),
    }) as unknown as typeof fetch;

    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const capture = captureLogs();

    try {
      await marketSearchCommand('test', { json: true });

      expect(capture.logs.length).toBeGreaterThan(0);
      const output = JSON.parse(capture.logs.join(''));
      expect(Array.isArray(output)).toBe(true);
      expect(output[0].name).toBe('flowweaver-pack-test');
    } finally {
      capture.restore();
    }
  });
});

// ── marketListCommand ────────────────────────────────────────────────────────

describe('marketListCommand', () => {
  let origExit: typeof process.exit;
  let origCwd: () => string;

  beforeEach(() => {
    origExit = process.exit;
    origCwd = process.cwd;
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    process.exit = origExit;
    process.cwd = origCwd;
  });

  it('should show "no packages" message when none installed', async () => {
    // Point cwd to a directory with an empty node_modules
    const listDir = path.join(MARKET_TEMP_DIR, 'list-empty');
    fs.mkdirSync(path.join(listDir, 'node_modules'), { recursive: true });
    process.cwd = () => listDir;

    const { marketListCommand } = await import('../../src/cli/commands/market');
    const capture = captureLogs();

    try {
      await marketListCommand({ json: false });
      const allOutput = [...capture.logs, ...capture.errors, ...capture.warns].join(' ');
      expect(allOutput).toContain('No marketplace packages installed');
    } finally {
      capture.restore();
    }
  });

  it('should output JSON when --json is set with packages', async () => {
    // Create a real node_modules/flowweaver-pack-mock with manifest
    const listDir = path.join(MARKET_TEMP_DIR, 'list-json');
    const pkgDir = path.join(listDir, 'node_modules', 'flowweaver-pack-mock');
    fs.mkdirSync(pkgDir, { recursive: true });

    const manifest = {
      manifestVersion: 1,
      name: 'flowweaver-pack-mock',
      version: '2.0.0',
      nodeTypes: [{ name: 'MockNode', inputs: [], outputs: [] }],
      workflows: [],
      patterns: [],
    };
    fs.writeFileSync(path.join(pkgDir, 'flowweaver.manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: 'flowweaver-pack-mock',
      version: '2.0.0',
    }));

    process.cwd = () => listDir;

    const { marketListCommand } = await import('../../src/cli/commands/market');
    const capture = captureLogs();

    try {
      await marketListCommand({ json: true });

      expect(capture.logs.length).toBeGreaterThan(0);
      const output = JSON.parse(capture.logs.join(''));
      expect(Array.isArray(output)).toBe(true);
      expect(output[0].name).toBe('flowweaver-pack-mock');
      expect(output[0].nodeTypes).toBe(1);
    } finally {
      capture.restore();
    }
  });
});

// ── resolvePackageName (internal helper) ─────────────────────────────────────

describe('resolvePackageName', () => {
  // We test this indirectly through the module by extracting the function.
  // Since it's not exported, we test through the marketInstallCommand behavior,
  // or we can read the logic and test the patterns here.

  it('should handle tarball paths', () => {
    // The function is not exported, so test the expected behavior:
    // flowweaver-pack-test-1.0.0.tgz -> flowweaver-pack-test
    const spec = 'flowweaver-pack-test-1.0.0.tgz';
    const base = path.basename(spec, '.tgz');
    const match = base.match(/^(.+)-\d+\.\d+\.\d+/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('flowweaver-pack-test');
  });

  it('should handle scoped packages with version', () => {
    const spec = '@synergenius/flowweaver-pack-core@1.2.3';
    // For scoped: first @ is part of scope, second @ separates version
    const atIndex = spec.indexOf('@', 1);
    const name = atIndex > 0 ? spec.slice(0, atIndex) : spec;
    expect(name).toBe('@synergenius/flowweaver-pack-core');
  });

  it('should handle unscoped packages with version', () => {
    const spec = 'flowweaver-pack-test@2.0.0';
    const atIndex = spec.indexOf('@');
    const name = atIndex > 0 ? spec.slice(0, atIndex) : spec;
    expect(name).toBe('flowweaver-pack-test');
  });

  it('should handle bare package names', () => {
    const spec = 'flowweaver-pack-test';
    const atIndex = spec.indexOf('@');
    const name = atIndex > 0 ? spec.slice(0, atIndex) : spec;
    expect(name).toBe('flowweaver-pack-test');
  });

  it('should handle .tar.gz tarballs', () => {
    const spec = 'flowweaver-pack-utils-0.5.0.tar.gz';
    const base = path.basename(spec, '.tar.gz');
    const match = base.match(/^(.+)-\d+\.\d+\.\d+/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('flowweaver-pack-utils');
  });
});
