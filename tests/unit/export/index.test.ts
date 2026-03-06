/**
 * Tests for the export orchestrator (src/export/index.ts)
 *
 * Covers exportWorkflow (single and multi mode), getSupportedTargets,
 * and the orchestrator's delegation to the target registry.
 *
 * Target-specific file generation (handler content, config shapes, etc.)
 * is tested in the individual target test files under tests/unit/deployment/targets/.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// Shared mock parse function that tests can reconfigure
const mockParseFn = vi.fn();

// Mock target that tests can inspect and reconfigure
const mockGenerateFn = vi.fn();
const mockGenerateBundleFn = vi.fn();

const mockTarget = {
  name: 'lambda',
  description: 'AWS Lambda',
  generate: mockGenerateFn,
  generateBundle: mockGenerateBundleFn,
  getDeployInstructions: vi.fn().mockReturnValue({ title: '', steps: [], prerequisites: [] }),
};

// Mock registry returned by createTargetRegistry
const mockRegistry = {
  get: vi.fn().mockReturnValue(mockTarget),
  getNames: vi.fn().mockImplementation(() => ['lambda', 'vercel', 'cloudflare', 'inngest', 'github-actions', 'gitlab-ci']),
};

// Mock fs before importing the module under test
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

// Mock the annotation parser. Use a class-like constructor that delegates to mockParseFn.
vi.mock('../../../src/parser.js', () => {
  class MockAnnotationParser {
    async loadPackHandlers(_dir: string) { /* no-op in tests */ }
    parse(...args: any[]) {
      return mockParseFn(...args);
    }
  }
  return { AnnotationParser: MockAnnotationParser };
});

// Mock the compile workflow function
vi.mock('../../../src/api/compile.js', () => ({
  compileWorkflow: vi.fn().mockResolvedValue(undefined),
}));

// Mock the branding module
vi.mock('../../../src/generated-branding.js', () => ({
  getGeneratedBranding: () => ({
    header: (cmd?: string) => cmd ? `// Generated -- ${cmd}` : '// Generated',
    markdown: '*Generated*',
  }),
}));

// Mock the deployment module to provide a controlled target registry
vi.mock('../../../src/deployment/index.js', () => ({
  createTargetRegistry: vi.fn().mockResolvedValue(mockRegistry),
}));

import * as fs from 'fs';
import { compileWorkflow } from '../../../src/api/compile.js';
import {
  exportWorkflow,
  getSupportedTargets,
  type ExportOptions,
} from '../../../src/export/index.js';

const mockedFs = vi.mocked(fs);

// Helper: create a minimal parse result with N workflows
function makeParseMock(workflows: Array<{ name: string; functionName: string; description?: string; nodeTypes?: string[] }>) {
  return {
    workflows: workflows.map((w) => ({
      ...w,
      type: 'Workflow' as const,
      sourceFile: '/test/input.ts',
      nodeTypes: w.nodeTypes ?? [],
      instances: [],
      connections: [],
      startPorts: {},
      exitPorts: {},
      imports: [],
    })),
    nodeTypes: [],
  };
}

/** Set up the default "one workflow" parse result */
function setDefaultParseResult() {
  mockParseFn.mockReturnValue(
    makeParseMock([{ name: 'testWorkflow', functionName: 'testWorkflow', description: 'A test workflow' }])
  );
}

/** Default single-workflow artifacts returned by the mock target */
function makeDefaultSingleArtifacts(workflowName = 'testWorkflow') {
  return {
    target: 'lambda',
    workflowName,
    entryPoint: 'handler.ts',
    files: [
      {
        relativePath: 'handler.ts',
        absolutePath: '/test/output/handler.ts',
        content: `// lambda handler for ${workflowName}\nimport { ${workflowName} } from './workflow.js';`,
        type: 'handler' as const,
      },
      {
        relativePath: 'template.yaml',
        absolutePath: '/test/output/template.yaml',
        content: `Description: ${workflowName}\nName: ${workflowName}`,
        type: 'config' as const,
      },
      {
        relativePath: 'package.json',
        absolutePath: '/test/output/package.json',
        content: JSON.stringify({ name: `fw-${workflowName}`, devDependencies: { '@types/aws-lambda': '^8.0.0' } }),
        type: 'package' as const,
      },
      {
        relativePath: 'tsconfig.json',
        absolutePath: '/test/output/tsconfig.json',
        content: JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
        type: 'config' as const,
      },
    ],
  };
}

/** Default multi-workflow bundle artifacts returned by the mock target */
function makeDefaultBundleArtifacts(workflowNames: string[]) {
  return {
    target: 'lambda',
    workflowName: 'input-service',
    workflowNames,
    entryPoint: 'handler.ts',
    files: [
      {
        relativePath: 'handler.ts',
        absolutePath: '/test/output/handler.ts',
        content: `// multi handler\n${workflowNames.map((n) => `import { ${n} } from './workflows/${n}.js';`).join('\n')}`,
        type: 'handler' as const,
      },
      {
        relativePath: 'package.json',
        absolutePath: '/test/output/package.json',
        content: JSON.stringify({ name: 'fw-input-service' }),
        type: 'package' as const,
      },
    ],
  };
}

describe('export/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: input file exists
    mockedFs.existsSync.mockReturnValue(true);
    // Default: readFileSync returns compiled code
    mockedFs.readFileSync.mockReturnValue('// compiled workflow code');
    // Default: parser returns one workflow
    setDefaultParseResult();
    // Default: registry returns mock target
    mockRegistry.get.mockReturnValue(mockTarget);
    mockRegistry.getNames.mockImplementation(() => ['lambda', 'vercel', 'cloudflare', 'inngest', 'github-actions', 'gitlab-ci']);
    // Default: mock target generate returns single artifacts
    mockGenerateFn.mockResolvedValue(makeDefaultSingleArtifacts());
    // Default: mock target generateBundle returns bundle artifacts
    mockGenerateBundleFn.mockResolvedValue(makeDefaultBundleArtifacts(['wfA', 'wfB']));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────
  // getSupportedTargets
  // ──────────────────────────────────────────────────
  describe('getSupportedTargets', () => {
    it('returns installed targets from the registry', async () => {
      const targets = await getSupportedTargets();
      expect(targets).toEqual(['lambda', 'vercel', 'cloudflare', 'inngest', 'github-actions', 'gitlab-ci']);
    });

    it('returns a fresh array on each call', async () => {
      const a = await getSupportedTargets();
      const b = await getSupportedTargets();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  // ──────────────────────────────────────────────────
  // exportWorkflow -- single workflow mode
  // ──────────────────────────────────────────────────
  describe('exportWorkflow (single)', () => {
    const baseOptions: ExportOptions = {
      target: 'lambda',
      input: '/test/input.ts',
      output: '/test/output',
    };

    it('throws when target is not installed', async () => {
      mockRegistry.get.mockReturnValue(undefined);
      mockRegistry.getNames.mockReturnValue([]);

      await expect(exportWorkflow(baseOptions)).rejects.toThrow('No export targets installed');
    });

    it('throws when target is unknown but others are installed', async () => {
      mockRegistry.get.mockReturnValue(undefined);
      mockRegistry.getNames.mockReturnValue(['vercel']);

      await expect(exportWorkflow({ ...baseOptions, target: 'lambda' })).rejects.toThrow('Unknown target "lambda"');
    });

    it('throws when input file does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      await expect(exportWorkflow(baseOptions)).rejects.toThrow('Input file not found');
    });

    it('throws when no workflows are found in the file', async () => {
      mockParseFn.mockReturnValue(makeParseMock([]));

      await expect(exportWorkflow(baseOptions)).rejects.toThrow('No workflows found');
    });

    it('throws when a specific workflow name is not found', async () => {
      await expect(
        exportWorkflow({ ...baseOptions, workflow: 'nonexistent' })
      ).rejects.toThrow('Workflow "nonexistent" not found');
    });

    it('selects the first workflow when no name is specified', async () => {
      mockParseFn.mockReturnValue(
        makeParseMock([
          { name: 'first', functionName: 'first' },
          { name: 'second', functionName: 'second' },
        ])
      );
      mockGenerateFn.mockResolvedValue(makeDefaultSingleArtifacts('first'));

      const result = await exportWorkflow(baseOptions);
      expect(result.workflow).toBe('first');
    });

    it('selects a workflow by name', async () => {
      mockParseFn.mockReturnValue(
        makeParseMock([
          { name: 'first', functionName: 'first' },
          { name: 'second', functionName: 'second' },
        ])
      );
      mockGenerateFn.mockResolvedValue(makeDefaultSingleArtifacts('second'));

      const result = await exportWorkflow({ ...baseOptions, workflow: 'second' });
      expect(result.workflow).toBe('second');
    });

    it('selects a workflow by functionName', async () => {
      mockParseFn.mockReturnValue(
        makeParseMock([
          { name: 'myWorkflow', functionName: 'myWorkflowFn' },
        ])
      );
      mockGenerateFn.mockResolvedValue(makeDefaultSingleArtifacts('myWorkflow'));

      const result = await exportWorkflow({ ...baseOptions, workflow: 'myWorkflowFn' });
      expect(result.workflow).toBe('myWorkflow');
    });

    it('delegates to target.generate() with correct options', async () => {
      await exportWorkflow({ ...baseOptions, production: true, durableSteps: true });

      expect(mockGenerateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceFile: path.resolve(baseOptions.input),
          workflowName: 'testWorkflow',
          displayName: 'testWorkflow',
          outputDir: path.resolve(baseOptions.output),
          description: 'A test workflow',
          production: true,
          targetOptions: expect.objectContaining({ durableSteps: true }),
        })
      );
    });

    it('defaults production to true', async () => {
      await exportWorkflow(baseOptions);

      expect(mockGenerateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          production: true,
        })
      );
    });

    it('returns files mapped with full output paths', async () => {
      const result = await exportWorkflow(baseOptions);

      expect(result.files.length).toBeGreaterThan(0);
      for (const file of result.files) {
        expect(path.isAbsolute(file.path)).toBe(true);
      }
    });

    it('includes compiled workflow.ts when handler references it', async () => {
      const result = await exportWorkflow(baseOptions);
      const workflowFile = result.files.find((f) => f.path.endsWith('workflow.ts'));
      expect(workflowFile).toBeDefined();
      expect(workflowFile!.content).toBe('// compiled workflow code');
    });

    it('calls compileWorkflow to produce compiled output', async () => {
      await exportWorkflow(baseOptions);

      expect(compileWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          write: true,
          inPlace: true,
          generate: { production: true },
        })
      );
    });

    it('includes description from the parsed workflow', async () => {
      const result = await exportWorkflow(baseOptions);
      expect(result.description).toBe('A test workflow');
    });

    it('returns target in result', async () => {
      const result = await exportWorkflow(baseOptions);
      expect(result.target).toBe('lambda');
    });

    // Dry-run mode
    it('does not write files in dry-run mode', async () => {
      const result = await exportWorkflow({ ...baseOptions, dryRun: true });

      expect(result.files.length).toBeGreaterThan(0);
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('cleans up temp directory in dry-run mode', async () => {
      await exportWorkflow({ ...baseOptions, dryRun: true });

      expect(mockedFs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('fw-export-dryrun'),
        expect.objectContaining({ recursive: true, force: true })
      );
    });

    it('writes files to disk when not in dry-run mode', async () => {
      await exportWorkflow(baseOptions);

      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });

    it('creates parent directories when writing files', async () => {
      await exportWorkflow(baseOptions);

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true })
      );
    });

    // Handler that does NOT reference workflow import should skip compilation
    it('does not compile when handler does not import workflow', async () => {
      mockGenerateFn.mockResolvedValue({
        target: 'lambda',
        workflowName: 'testWorkflow',
        entryPoint: 'handler.ts',
        files: [
          {
            relativePath: 'handler.ts',
            absolutePath: '/test/output/handler.ts',
            content: '// standalone handler with no workflow import',
            type: 'handler' as const,
          },
        ],
      });

      const result = await exportWorkflow(baseOptions);
      expect(compileWorkflow).not.toHaveBeenCalled();
      const workflowFile = result.files.find((f) => f.path.endsWith('workflow.ts'));
      expect(workflowFile).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────
  // exportWorkflow with multi flag
  // ──────────────────────────────────────────────────
  describe('exportWorkflow (multi mode)', () => {
    const multiOptions: ExportOptions = {
      target: 'lambda',
      input: '/test/input.ts',
      output: '/test/output',
      multi: true,
    };

    beforeEach(() => {
      mockParseFn.mockReturnValue(
        makeParseMock([
          { name: 'wfA', functionName: 'wfA', description: 'Workflow A' },
          { name: 'wfB', functionName: 'wfB', description: 'Workflow B' },
        ])
      );
      mockGenerateBundleFn.mockResolvedValue(makeDefaultBundleArtifacts(['wfA', 'wfB']));
    });

    it('throws when input file does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await expect(exportWorkflow(multiOptions)).rejects.toThrow('Input file not found');
    });

    it('throws when no workflows are found', async () => {
      mockParseFn.mockReturnValue(makeParseMock([]));
      await expect(exportWorkflow(multiOptions)).rejects.toThrow('No workflows found');
    });

    it('throws when specified workflow names are not found', async () => {
      await expect(
        exportWorkflow({ ...multiOptions, workflows: ['nonexistent'] })
      ).rejects.toThrow('None of the requested workflows found');
    });

    it('filters workflows when specific names are provided', async () => {
      mockGenerateBundleFn.mockResolvedValue(makeDefaultBundleArtifacts(['wfA']));

      const result = await exportWorkflow({ ...multiOptions, workflows: ['wfA'] });
      expect(result.workflows).toEqual(['wfA']);
    });

    it('filters workflows by functionName too', async () => {
      mockGenerateBundleFn.mockResolvedValue(makeDefaultBundleArtifacts(['wfB']));

      const result = await exportWorkflow({ ...multiOptions, workflows: ['wfB'] });
      expect(result.workflows).toEqual(['wfB']);
    });

    it('exports all workflows when no filter is specified', async () => {
      const result = await exportWorkflow(multiOptions);
      expect(result.workflows).toEqual(['wfA', 'wfB']);
    });

    it('delegates to target.generateBundle() with bundle items', async () => {
      await exportWorkflow(multiOptions);

      expect(mockGenerateBundleFn).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'wfA', functionName: 'wfA', expose: true }),
          expect.objectContaining({ name: 'wfB', functionName: 'wfB', expose: true }),
        ]),
        [], // empty node types array
        expect.objectContaining({
          sourceFile: path.resolve(multiOptions.input),
          production: true,
        })
      );
    });

    it('throws when target does not support multi-workflow export', async () => {
      const targetWithoutBundle = { ...mockTarget, generateBundle: undefined };
      mockRegistry.get.mockReturnValue(targetWithoutBundle);

      await expect(exportWorkflow(multiOptions)).rejects.toThrow(
        'does not support multi-workflow export'
      );
    });

    it('sets service name from input filename', async () => {
      const result = await exportWorkflow(multiOptions);
      expect(result.workflow).toContain('input-service');
    });

    it('returns workflows array', async () => {
      const result = await exportWorkflow(multiOptions);
      expect(result.workflows).toBeDefined();
      expect(result.workflows).toContain('wfA');
      expect(result.workflows).toContain('wfB');
    });

    it('returns files from the target bundle artifacts', async () => {
      const result = await exportWorkflow(multiOptions);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.target).toBe('lambda');
    });

    // Dry-run mode for multi
    it('does not write files in dry-run mode', async () => {
      const result = await exportWorkflow({ ...multiOptions, dryRun: true });
      expect(result.files.length).toBeGreaterThan(0);
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('writes files to disk when not in dry-run mode', async () => {
      await exportWorkflow(multiOptions);
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });
  });
});
