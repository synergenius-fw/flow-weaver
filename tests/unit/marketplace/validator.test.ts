import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TMarketplaceManifest } from '../../../src/marketplace/types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockParseWorkflow = vi.fn();
const mockValidateWorkflow = vi.fn();
vi.mock('../../../src/api/index.js', () => ({
  parseWorkflow: (...args: unknown[]) => mockParseWorkflow(...args),
  validateWorkflow: (...args: unknown[]) => mockValidateWorkflow(...args),
}));

import * as fs from 'fs';
import { validatePackage } from '../../../src/marketplace/validator.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeManifest(overrides?: Partial<TMarketplaceManifest>): TMarketplaceManifest {
  return {
    manifestVersion: 1,
    name: 'flowweaver-pack-test',
    version: '1.0.0',
    nodeTypes: [
      {
        name: 'myNode',
        description: 'A test node',
        functionName: 'myNode',
        file: 'dist/myNode.js',
        isAsync: false,
        inputs: { execute: { dataType: 'trigger' } },
        outputs: { onSuccess: { dataType: 'trigger' } },
        visuals: { color: '#ff0000', icon: 'bolt' },
      },
    ],
    workflows: [],
    patterns: [],
    ...overrides,
  };
}

function makePackageJson(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'flowweaver-pack-test',
    version: '1.0.0',
    keywords: ['flowweaver-marketplace-pack'],
    flowWeaver: { engineVersion: '>=0.9.0' },
    peerDependencies: { '@synergenius/flow-weaver': '>=0.9.0' },
    ...overrides,
  };
}

const DIR = '/fake/package';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupFs(pkg: Record<string, unknown> | null, readmeExists = true) {
  const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
  const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;

  existsSyncMock.mockImplementation((p: string) => {
    if (p.endsWith('package.json')) return pkg !== null;
    if (p.endsWith('README.md')) return readmeExists;
    // Workflow source files: return false by default (override per-test)
    return false;
  });

  readFileSyncMock.mockImplementation((p: string) => {
    if (p.endsWith('package.json') && pkg) return JSON.stringify(pkg);
    throw new Error(`ENOENT: ${p}`);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validatePackage', () => {
  // ── PKG-000: package.json must exist ─────────────────────────────────────

  describe('PKG-000: package.json existence', () => {
    it('returns PKG-000 error when package.json is missing', async () => {
      setupFs(null);
      const result = await validatePackage(DIR, makeManifest());

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: 'PKG-000',
        severity: 'error',
        message: 'package.json not found',
      });
    });

    it('does not check other rules when package.json is missing', async () => {
      setupFs(null);
      const manifest = makeManifest({ nodeTypes: [], workflows: [], patterns: [] });
      const result = await validatePackage(DIR, manifest);

      // Only PKG-000, not PKG-006 for empty manifest
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('PKG-000');
    });
  });

  // ── PKG-005: Package name pattern ────────────────────────────────────────

  describe('PKG-005: package name format', () => {
    it('accepts unscoped flowweaver-pack-* names', async () => {
      setupFs(makePackageJson({ name: 'flowweaver-pack-openai' }));
      const result = await validatePackage(DIR, makeManifest());

      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain('PKG-005');
    });

    it('accepts scoped @org/flowweaver-pack-* names', async () => {
      setupFs(makePackageJson({ name: '@myorg/flowweaver-pack-openai' }));
      const result = await validatePackage(DIR, makeManifest());

      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain('PKG-005');
    });

    it('rejects names that do not match the pattern', async () => {
      setupFs(makePackageJson({ name: 'my-cool-package' }));
      const result = await validatePackage(DIR, makeManifest());

      const pkg005 = result.issues.find((i) => i.code === 'PKG-005');
      expect(pkg005).toBeDefined();
      expect(pkg005!.severity).toBe('error');
    });

    it('rejects missing name', async () => {
      setupFs(makePackageJson({ name: undefined }));
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-005')).toBeDefined();
    });
  });

  // ── PKG-001: keywords must include marketplace keyword ───────────────────

  describe('PKG-001: marketplace keyword', () => {
    it('passes when keywords include flowweaver-marketplace-pack', async () => {
      setupFs(makePackageJson());
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-001')).toBeUndefined();
    });

    it('fails when keywords array is missing', async () => {
      setupFs(makePackageJson({ keywords: undefined }));
      const result = await validatePackage(DIR, makeManifest());

      const issue = result.issues.find((i) => i.code === 'PKG-001');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
    });

    it('fails when keywords do not include the marketplace keyword', async () => {
      setupFs(makePackageJson({ keywords: ['something-else'] }));
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-001')).toBeDefined();
    });
  });

  // ── PKG-002: engineVersion ───────────────────────────────────────────────

  describe('PKG-002: engine version', () => {
    it('passes when flowWeaver.engineVersion is set', async () => {
      setupFs(makePackageJson());
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-002')).toBeUndefined();
    });

    it('fails when flowWeaver section is missing', async () => {
      setupFs(makePackageJson({ flowWeaver: undefined }));
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-002')).toBeDefined();
    });

    it('fails when flowWeaver.engineVersion is empty', async () => {
      setupFs(makePackageJson({ flowWeaver: {} }));
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-002')).toBeDefined();
    });
  });

  // ── PKG-003: peerDependencies ────────────────────────────────────────────

  describe('PKG-003: peer dependency on @synergenius/flow-weaver', () => {
    it('passes when peerDependencies includes @synergenius/flow-weaver', async () => {
      setupFs(makePackageJson());
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-003')).toBeUndefined();
    });

    it('fails when peerDependencies is missing', async () => {
      setupFs(makePackageJson({ peerDependencies: undefined }));
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-003')).toBeDefined();
    });

    it('fails when peerDependencies does not include flow-weaver', async () => {
      setupFs(makePackageJson({ peerDependencies: { 'some-other-pkg': '^1.0.0' } }));
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-003')).toBeDefined();
    });
  });

  // ── PKG-004: private flag ────────────────────────────────────────────────

  describe('PKG-004: private flag', () => {
    it('passes when private is not set', async () => {
      setupFs(makePackageJson());
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-004')).toBeUndefined();
    });

    it('passes when private is false', async () => {
      setupFs(makePackageJson({ private: false }));
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-004')).toBeUndefined();
    });

    it('fails when private is true', async () => {
      setupFs(makePackageJson({ private: true }));
      const result = await validatePackage(DIR, makeManifest());

      const issue = result.issues.find((i) => i.code === 'PKG-004');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
    });
  });

  // ── PKG-007: README.md ───────────────────────────────────────────────────

  describe('PKG-007: README.md existence', () => {
    it('passes when README.md exists', async () => {
      setupFs(makePackageJson(), true);
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-007')).toBeUndefined();
    });

    it('warns when README.md is missing', async () => {
      setupFs(makePackageJson(), false);
      const result = await validatePackage(DIR, makeManifest());

      const issue = result.issues.find((i) => i.code === 'PKG-007');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('does not block validity when README.md is missing (warning only)', async () => {
      setupFs(makePackageJson(), false);
      const result = await validatePackage(DIR, makeManifest());

      // PKG-007 is a warning, so valid should still be true
      expect(result.valid).toBe(true);
    });
  });

  // ── PKG-006: at least one unit ───────────────────────────────────────────

  describe('PKG-006: minimum one unit', () => {
    it('passes with at least one node type', async () => {
      setupFs(makePackageJson());
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-006')).toBeUndefined();
    });

    it('passes with only a workflow', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [],
        workflows: [{
          name: 'myWorkflow',
          file: 'dist/myWorkflow.js',
          functionName: 'myWorkflow',
          startPorts: {},
          exitPorts: {},
          nodeCount: 2,
          connectionCount: 1,
        }],
      });
      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'PKG-006')).toBeUndefined();
    });

    it('passes with only a pattern', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [],
        patterns: [{
          name: 'myPattern',
          file: 'src/myPattern.ts',
          inputPorts: { data: { dataType: 'string' } },
          outputPorts: {},
          nodeCount: 1,
        }],
      });
      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'PKG-006')).toBeUndefined();
    });

    it('fails when nodeTypes, workflows, and patterns are all empty', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({ nodeTypes: [], workflows: [], patterns: [] });
      const result = await validatePackage(DIR, manifest);

      const issue = result.issues.find((i) => i.code === 'PKG-006');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
      expect(result.valid).toBe(false);
    });
  });

  // ── UNIT-002: unique node type names ─────────────────────────────────────

  describe('UNIT-002: unique node type names', () => {
    it('passes when all node type names are unique', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [
          { name: 'alpha', functionName: 'alpha', file: 'dist/a.js', isAsync: false, inputs: {}, outputs: {} },
          { name: 'beta', functionName: 'beta', file: 'dist/b.js', isAsync: false, inputs: {}, outputs: {} },
        ],
      });
      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'UNIT-002')).toBeUndefined();
    });

    it('reports an error for duplicate node type names', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [
          { name: 'alpha', functionName: 'alpha1', file: 'dist/a1.js', isAsync: false, inputs: {}, outputs: {} },
          { name: 'alpha', functionName: 'alpha2', file: 'dist/a2.js', isAsync: false, inputs: {}, outputs: {} },
        ],
      });
      const result = await validatePackage(DIR, manifest);

      const issue = result.issues.find((i) => i.code === 'UNIT-002');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
      expect(issue!.message).toContain('alpha');
    });
  });

  // ── PKG-008: node type descriptions ──────────────────────────────────────

  describe('PKG-008: node type descriptions', () => {
    it('passes when all node types have descriptions', async () => {
      setupFs(makePackageJson());
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-008')).toBeUndefined();
    });

    it('warns when a node type is missing a description', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [
          { name: 'bare', functionName: 'bare', file: 'dist/bare.js', isAsync: false, inputs: {}, outputs: {} },
        ],
      });
      const result = await validatePackage(DIR, manifest);

      const issue = result.issues.find((i) => i.code === 'PKG-008');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
      expect(issue!.message).toContain('bare');
    });
  });

  // ── PKG-009: node type visuals ───────────────────────────────────────────

  describe('PKG-009: node type visuals', () => {
    it('passes when node types have visuals', async () => {
      setupFs(makePackageJson());
      const result = await validatePackage(DIR, makeManifest());

      expect(result.issues.find((i) => i.code === 'PKG-009')).toBeUndefined();
    });

    it('warns when visuals are missing entirely', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [
          { name: 'plain', description: 'desc', functionName: 'plain', file: 'dist/p.js', isAsync: false, inputs: {}, outputs: {} },
        ],
      });
      const result = await validatePackage(DIR, manifest);

      const issue = result.issues.find((i) => i.code === 'PKG-009');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('warns when visuals object has no color, icon, or tags', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [
          {
            name: 'empty-visuals',
            description: 'desc',
            functionName: 'emptyVisuals',
            file: 'dist/ev.js',
            isAsync: false,
            inputs: {},
            outputs: {},
            visuals: {},
          },
        ],
      });
      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'PKG-009')).toBeDefined();
    });

    it('passes when visuals has at least a color', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [
          {
            name: 'colored',
            description: 'desc',
            functionName: 'colored',
            file: 'dist/c.js',
            isAsync: false,
            inputs: {},
            outputs: {},
            visuals: { color: '#00ff00' },
          },
        ],
      });
      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'PKG-009')).toBeUndefined();
    });

    it('passes when visuals has tags only', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [
          {
            name: 'tagged',
            description: 'desc',
            functionName: 'tagged',
            file: 'dist/t.js',
            isAsync: false,
            inputs: {},
            outputs: {},
            visuals: { tags: [{ label: 'AI' }] },
          },
        ],
      });
      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'PKG-009')).toBeUndefined();
    });
  });

  // ── UNIT-003: pattern ports ──────────────────────────────────────────────

  describe('UNIT-003: pattern ports', () => {
    it('passes when a pattern has input ports', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [],
        patterns: [{
          name: 'inputOnly',
          file: 'src/inputOnly.ts',
          inputPorts: { data: { dataType: 'string' } },
          outputPorts: {},
          nodeCount: 1,
        }],
      });
      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'UNIT-003')).toBeUndefined();
    });

    it('passes when a pattern has output ports', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [],
        patterns: [{
          name: 'outputOnly',
          file: 'src/outputOnly.ts',
          inputPorts: {},
          outputPorts: { result: { dataType: 'number' } },
          nodeCount: 1,
        }],
      });
      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'UNIT-003')).toBeUndefined();
    });

    it('fails when a pattern has no ports at all', async () => {
      setupFs(makePackageJson());
      const manifest = makeManifest({
        nodeTypes: [],
        patterns: [{
          name: 'noports',
          file: 'src/noports.ts',
          inputPorts: {},
          outputPorts: {},
          nodeCount: 1,
        }],
      });
      const result = await validatePackage(DIR, manifest);

      const issue = result.issues.find((i) => i.code === 'UNIT-003');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
      expect(issue!.message).toContain('noports');
    });
  });

  // ── UNIT-001: workflow validation ────────────────────────────────────────

  describe('UNIT-001: workflow validation', () => {
    it('reports error when a workflow has validation errors', async () => {
      const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
      const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;

      existsSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        if (p.endsWith('README.md')) return true;
        // The workflow source file: dist/wf.js -> src/wf.ts
        if (p.endsWith('src/wf.ts')) return true;
        return false;
      });
      readFileSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return JSON.stringify(makePackageJson());
        throw new Error(`ENOENT: ${p}`);
      });

      const fakeAst = { type: 'Workflow' };
      mockParseWorkflow.mockResolvedValue({ ast: fakeAst, errors: [] });
      mockValidateWorkflow.mockReturnValue({
        errors: [{ message: 'unreachable node "x"' }],
        warnings: [],
      });

      const manifest = makeManifest({
        nodeTypes: [],
        workflows: [{
          name: 'badWorkflow',
          file: 'dist/wf.js',
          functionName: 'badWorkflow',
          startPorts: {},
          exitPorts: {},
          nodeCount: 3,
          connectionCount: 2,
        }],
      });

      const result = await validatePackage(DIR, manifest);

      const issue = result.issues.find((i) => i.code === 'UNIT-001');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
      expect(issue!.message).toContain('badWorkflow');
      expect(issue!.message).toContain('unreachable node "x"');
    });

    it('skips workflows whose source file does not exist', async () => {
      setupFs(makePackageJson());
      mockParseWorkflow.mockReset();

      const manifest = makeManifest({
        nodeTypes: [],
        workflows: [{
          name: 'missingFile',
          file: 'dist/missing.js',
          functionName: 'missingFile',
          startPorts: {},
          exitPorts: {},
          nodeCount: 1,
          connectionCount: 0,
        }],
      });

      const result = await validatePackage(DIR, manifest);

      // parseWorkflow should not be called
      expect(mockParseWorkflow).not.toHaveBeenCalled();
      expect(result.issues.find((i) => i.code === 'UNIT-001')).toBeUndefined();
    });

    it('skips workflows that have parse errors (reported elsewhere)', async () => {
      const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
      const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;

      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return JSON.stringify(makePackageJson());
        throw new Error(`ENOENT: ${p}`);
      });

      mockParseWorkflow.mockResolvedValue({
        ast: null,
        errors: [{ message: 'syntax error' }],
      });

      const manifest = makeManifest({
        nodeTypes: [],
        workflows: [{
          name: 'parseError',
          file: 'dist/pe.js',
          functionName: 'parseError',
          startPorts: {},
          exitPorts: {},
          nodeCount: 0,
          connectionCount: 0,
        }],
      });

      const result = await validatePackage(DIR, manifest);

      // validateWorkflow should not be called if parse had errors
      expect(mockValidateWorkflow).not.toHaveBeenCalled();
      expect(result.issues.find((i) => i.code === 'UNIT-001')).toBeUndefined();
    });

    it('silently catches parse exceptions', async () => {
      const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
      const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;

      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return JSON.stringify(makePackageJson());
        throw new Error(`ENOENT: ${p}`);
      });

      mockParseWorkflow.mockRejectedValue(new Error('kaboom'));

      const manifest = makeManifest({
        nodeTypes: [],
        workflows: [{
          name: 'crashWorkflow',
          file: 'dist/crash.js',
          functionName: 'crashWorkflow',
          startPorts: {},
          exitPorts: {},
          nodeCount: 0,
          connectionCount: 0,
        }],
      });

      const result = await validatePackage(DIR, manifest);

      // Should not throw, and no UNIT-001 issue
      expect(result.issues.find((i) => i.code === 'UNIT-001')).toBeUndefined();
    });

    it('passes workflows with no validation errors', async () => {
      const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
      const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;

      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return JSON.stringify(makePackageJson());
        throw new Error(`ENOENT: ${p}`);
      });

      mockParseWorkflow.mockResolvedValue({ ast: { type: 'Workflow' }, errors: [] });
      mockValidateWorkflow.mockReturnValue({ errors: [], warnings: [] });

      const manifest = makeManifest({
        nodeTypes: [],
        workflows: [{
          name: 'goodWorkflow',
          file: 'dist/good.js',
          functionName: 'goodWorkflow',
          startPorts: {},
          exitPorts: {},
          nodeCount: 2,
          connectionCount: 1,
        }],
      });

      const result = await validatePackage(DIR, manifest);

      expect(result.issues.find((i) => i.code === 'UNIT-001')).toBeUndefined();
    });
  });

  // ── Overall validity ─────────────────────────────────────────────────────

  describe('overall validity', () => {
    it('returns valid=true when no errors exist', async () => {
      setupFs(makePackageJson());
      const result = await validatePackage(DIR, makeManifest());

      expect(result.valid).toBe(true);
      // There should be no error-level issues
      expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('returns valid=false when any error exists', async () => {
      setupFs(makePackageJson({ name: 'bad-name' }));
      const result = await validatePackage(DIR, makeManifest());

      expect(result.valid).toBe(false);
    });

    it('returns valid=true when only warnings exist', async () => {
      setupFs(makePackageJson(), false); // no README
      const result = await validatePackage(DIR, makeManifest());

      // PKG-007 is a warning
      expect(result.issues.some((i) => i.code === 'PKG-007')).toBe(true);
      expect(result.valid).toBe(true);
    });

    it('collects issues from both package.json and manifest checks', async () => {
      setupFs(makePackageJson({ private: true }), false);
      const manifest = makeManifest({
        nodeTypes: [
          { name: 'noDesc', functionName: 'noDesc', file: 'dist/nd.js', isAsync: false, inputs: {}, outputs: {} },
        ],
      });
      const result = await validatePackage(DIR, manifest);

      const codes = result.issues.map((i) => i.code);
      // PKG-004 from package.json, PKG-007 from README, PKG-008 from description, PKG-009 from visuals
      expect(codes).toContain('PKG-004');
      expect(codes).toContain('PKG-007');
      expect(codes).toContain('PKG-008');
      expect(codes).toContain('PKG-009');
    });
  });
});
