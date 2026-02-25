/**
 * Tests for the export orchestrator (src/export/index.ts)
 *
 * Covers exportWorkflow, exportMultiWorkflow, getSupportedTargets,
 * and the internal handler/config generation logic for each target platform.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// Shared mock parse function that tests can reconfigure
const mockParseFn = vi.fn();

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

// Mock the Inngest deep generator
vi.mock('../../../src/generator/inngest.js', () => ({
  generateInngestFunction: vi.fn().mockReturnValue('// inngest deep handler code'),
}));

// Mock the templates with simple stubs that use the placeholder tokens
vi.mock('../../../src/export/templates.js', () => ({
  LAMBDA_TEMPLATE: `{{GENERATED_HEADER}}\n{{WORKFLOW_IMPORT}}\n// lambda handler for {{FUNCTION_NAME}}`,
  VERCEL_TEMPLATE: `{{GENERATED_HEADER}}\n{{WORKFLOW_IMPORT}}\nexport const config = { maxDuration: {{MAX_DURATION}} };\n// vercel handler for {{FUNCTION_NAME}}`,
  CLOUDFLARE_TEMPLATE: `{{GENERATED_HEADER}}\n{{WORKFLOW_IMPORT}}\n// cloudflare handler for {{FUNCTION_NAME}}`,
  INNGEST_TEMPLATE: `{{GENERATED_HEADER}}\n{{WORKFLOW_IMPORT}}\n// inngest handler for {{FUNCTION_NAME}}`,
  SAM_TEMPLATE: `Description: {{WORKFLOW_DESCRIPTION}}\nPath: /{{WORKFLOW_PATH}}\nName: {{WORKFLOW_NAME}}`,
}));

import * as fs from 'fs';
import { compileWorkflow } from '../../../src/api/compile.js';
import { generateInngestFunction } from '../../../src/generator/inngest.js';
import {
  exportWorkflow,
  exportMultiWorkflow,
  getSupportedTargets,
  type ExportOptions,
  type ExportTarget,
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

describe('export/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: input file exists
    mockedFs.existsSync.mockReturnValue(true);
    // Default: readFileSync returns compiled code
    mockedFs.readFileSync.mockReturnValue('// compiled workflow code');
    // Default: parser returns one workflow
    setDefaultParseResult();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────
  // getSupportedTargets
  // ──────────────────────────────────────────────────
  describe('getSupportedTargets', () => {
    it('returns all four supported targets', () => {
      const targets = getSupportedTargets();
      expect(targets).toEqual(['lambda', 'vercel', 'cloudflare', 'inngest']);
    });

    it('returns a fresh array on each call', () => {
      const a = getSupportedTargets();
      const b = getSupportedTargets();
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

      const result = await exportWorkflow({ ...baseOptions, workflow: 'second' });
      expect(result.workflow).toBe('second');
    });

    it('selects a workflow by functionName', async () => {
      mockParseFn.mockReturnValue(
        makeParseMock([
          { name: 'myWorkflow', functionName: 'myWorkflowFn' },
        ])
      );

      const result = await exportWorkflow({ ...baseOptions, workflow: 'myWorkflowFn' });
      expect(result.workflow).toBe('myWorkflow');
    });

    // Target-specific file generation
    describe.each<ExportTarget>(['lambda', 'vercel', 'cloudflare', 'inngest'])('target: %s', (target) => {
      it(`generates files for ${target} target`, async () => {
        const result = await exportWorkflow({ ...baseOptions, target });

        expect(result.target).toBe(target);
        expect(result.files.length).toBeGreaterThan(0);
        expect(result.workflow).toBe('testWorkflow');
      });

      it(`writes files to disk when not in dry-run mode`, async () => {
        await exportWorkflow({ ...baseOptions, target });

        expect(mockedFs.writeFileSync).toHaveBeenCalled();
      });
    });

    it('generates handler.ts for lambda target', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'lambda' });
      const handlerFile = result.files.find((f) => f.path.endsWith('handler.ts'));
      expect(handlerFile).toBeDefined();
      expect(handlerFile!.content).toContain('lambda handler');
    });

    it('generates api/<name>.ts for vercel target', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'vercel' });
      const handlerFile = result.files.find((f) => f.path.includes('api/'));
      expect(handlerFile).toBeDefined();
    });

    it('generates index.ts for cloudflare target', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'cloudflare' });
      const handlerFile = result.files.find((f) => f.path.endsWith('index.ts'));
      expect(handlerFile).toBeDefined();
    });

    it('generates handler.ts for inngest target', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'inngest' });
      const handlerFile = result.files.find((f) => f.path.endsWith('handler.ts'));
      expect(handlerFile).toBeDefined();
    });

    // Config files per target
    it('generates SAM template.yaml for lambda', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'lambda' });
      const samFile = result.files.find((f) => f.path.endsWith('template.yaml'));
      expect(samFile).toBeDefined();
      expect(samFile!.content).toContain('testWorkflow');
    });

    it('generates vercel.json for vercel', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'vercel' });
      const configFile = result.files.find((f) => f.path.endsWith('vercel.json'));
      expect(configFile).toBeDefined();
      const parsed = JSON.parse(configFile!.content);
      expect(parsed.functions).toBeDefined();
    });

    it('generates wrangler.toml for cloudflare', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'cloudflare' });
      const configFile = result.files.find((f) => f.path.endsWith('wrangler.toml'));
      expect(configFile).toBeDefined();
      expect(configFile!.content).toContain('testWorkflow');
    });

    it('generates package.json for lambda', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'lambda' });
      const pkgFile = result.files.find((f) => f.path.endsWith('package.json'));
      expect(pkgFile).toBeDefined();
      const pkg = JSON.parse(pkgFile!.content);
      expect(pkg.name).toBe('fw-testWorkflow');
      expect(pkg.devDependencies['@types/aws-lambda']).toBeDefined();
    });

    it('generates package.json for cloudflare with wrangler', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'cloudflare' });
      const pkgFile = result.files.find((f) => f.path.endsWith('package.json'));
      expect(pkgFile).toBeDefined();
      const pkg = JSON.parse(pkgFile!.content);
      expect(pkg.devDependencies.wrangler).toBeDefined();
    });

    it('generates package.json for inngest with inngest dependency', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'inngest' });
      const pkgFile = result.files.find((f) => f.path.endsWith('package.json'));
      expect(pkgFile).toBeDefined();
      const pkg = JSON.parse(pkgFile!.content);
      expect(pkg.dependencies.inngest).toBeDefined();
    });

    it('generates tsconfig.json for lambda', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'lambda' });
      const tscFile = result.files.find((f) => f.path.endsWith('tsconfig.json'));
      expect(tscFile).toBeDefined();
      const tsc = JSON.parse(tscFile!.content);
      expect(tsc.compilerOptions.target).toBe('ES2022');
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

    // Production mode
    it('passes production flag to compile', async () => {
      await exportWorkflow({ ...baseOptions, production: true });

      expect(compileWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          generate: { production: true },
        })
      );
    });

    it('defaults production to true for compilation', async () => {
      await exportWorkflow(baseOptions);

      expect(compileWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          generate: { production: true },
        })
      );
    });

    // Durable steps (inngest only)
    it('uses deep generator when durableSteps is true for inngest', async () => {
      await exportWorkflow({ ...baseOptions, target: 'inngest', durableSteps: true });

      expect(generateInngestFunction).toHaveBeenCalled();
    });

    it('does not use deep generator when durableSteps is false for inngest', async () => {
      await exportWorkflow({ ...baseOptions, target: 'inngest', durableSteps: false });

      expect(generateInngestFunction).not.toHaveBeenCalled();
    });

    // Workflow result shape
    it('includes description from the parsed workflow', async () => {
      const result = await exportWorkflow(baseOptions);
      expect(result.description).toBe('A test workflow');
    });

    it('includes compiled workflow.ts in the output files', async () => {
      const result = await exportWorkflow(baseOptions);
      const workflowFile = result.files.find((f) => f.path.endsWith('workflow.ts'));
      expect(workflowFile).toBeDefined();
      expect(workflowFile!.content).toBe('// compiled workflow code');
    });

    // Vercel handler import path adjustments
    it('generates vercel handler with parent-relative import for workflow', async () => {
      const result = await exportWorkflow({ ...baseOptions, target: 'vercel' });
      const handlerFile = result.files.find((f) => f.path.includes('api/'));
      expect(handlerFile).toBeDefined();
      expect(handlerFile!.content).toContain('../workflow.js');
    });
  });

  // ──────────────────────────────────────────────────
  // exportWorkflow with multi flag delegates
  // ──────────────────────────────────────────────────
  describe('exportWorkflow (multi delegation)', () => {
    it('delegates to exportMultiWorkflow when multi is true', async () => {
      mockParseFn.mockReturnValue(
        makeParseMock([
          { name: 'wf1', functionName: 'wf1' },
          { name: 'wf2', functionName: 'wf2' },
        ])
      );

      const result = await exportWorkflow({
        target: 'lambda',
        input: '/test/input.ts',
        output: '/test/output',
        multi: true,
      });

      // Multi export returns workflows array
      expect(result.workflows).toBeDefined();
      expect(result.workflows).toContain('wf1');
      expect(result.workflows).toContain('wf2');
    });
  });

  // ──────────────────────────────────────────────────
  // exportMultiWorkflow
  // ──────────────────────────────────────────────────
  describe('exportMultiWorkflow', () => {
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
    });

    it('throws when input file does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await expect(exportMultiWorkflow(multiOptions)).rejects.toThrow('Input file not found');
    });

    it('throws when no workflows are found', async () => {
      mockParseFn.mockReturnValue(makeParseMock([]));
      await expect(exportMultiWorkflow(multiOptions)).rejects.toThrow('No workflows found');
    });

    it('throws when specified workflow names are not found', async () => {
      await expect(
        exportMultiWorkflow({ ...multiOptions, workflows: ['nonexistent'] })
      ).rejects.toThrow('None of the requested workflows found');
    });

    it('filters workflows when specific names are provided', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, workflows: ['wfA'] });
      expect(result.workflows).toEqual(['wfA']);
    });

    it('filters workflows by functionName too', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, workflows: ['wfB'] });
      expect(result.workflows).toEqual(['wfB']);
    });

    it('exports all workflows when no filter is specified', async () => {
      const result = await exportMultiWorkflow(multiOptions);
      expect(result.workflows).toEqual(['wfA', 'wfB']);
    });

    it('compiles each workflow individually', async () => {
      await exportMultiWorkflow(multiOptions);
      expect(compileWorkflow).toHaveBeenCalledTimes(2);
    });

    it('creates output directories', async () => {
      await exportMultiWorkflow(multiOptions);
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('workflows'),
        expect.objectContaining({ recursive: true })
      );
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('runtime'),
        expect.objectContaining({ recursive: true })
      );
    });

    // Multi target generation
    describe.each<ExportTarget>(['lambda', 'vercel', 'cloudflare', 'inngest'])('multi target: %s', (target) => {
      it(`generates files for ${target} multi-workflow export`, async () => {
        const result = await exportMultiWorkflow({ ...multiOptions, target });
        expect(result.target).toBe(target);
        expect(result.files.length).toBeGreaterThan(0);
      });

      it(`generates an openapi.ts file for ${target}`, async () => {
        const result = await exportMultiWorkflow({ ...multiOptions, target });
        const openapiFile = result.files.find((f) => f.path.endsWith('openapi.ts'));
        expect(openapiFile).toBeDefined();
        expect(openapiFile!.content).toContain('openApiSpec');
      });
    });

    it('generates OpenAPI spec with paths for each workflow', async () => {
      const result = await exportMultiWorkflow(multiOptions);
      expect(result.openApiSpec).toBeDefined();
      const spec = result.openApiSpec as any;
      expect(spec.openapi).toBe('3.0.3');
      expect(spec.paths['/api/wfA']).toBeDefined();
      expect(spec.paths['/api/wfB']).toBeDefined();
    });

    it('includes functions endpoint in OpenAPI spec', async () => {
      const result = await exportMultiWorkflow(multiOptions);
      const spec = result.openApiSpec as any;
      expect(spec.paths['/api/functions']).toBeDefined();
      expect(spec.paths['/api/functions'].get.operationId).toBe('list_functions');
    });

    it('sets service name from input filename', async () => {
      const result = await exportMultiWorkflow(multiOptions);
      expect(result.workflow).toContain('input-service');
    });

    // Lambda multi specifics
    it('generates SAM template for lambda multi', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, target: 'lambda' });
      const samFile = result.files.find((f) => f.path.endsWith('template.yaml'));
      expect(samFile).toBeDefined();
      expect(samFile!.content).toContain('multi-workflow service');
    });

    it('generates lambda handler with workflow map', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, target: 'lambda' });
      const handlerFile = result.files.find((f) => f.path.endsWith('handler.ts'));
      expect(handlerFile).toBeDefined();
      expect(handlerFile!.content).toContain('wfA');
      expect(handlerFile!.content).toContain('wfB');
    });

    // Vercel multi specifics
    it('generates vercel handler under api/ directory', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, target: 'vercel' });
      const handlerFile = result.files.find((f) => f.path.includes('api/'));
      expect(handlerFile).toBeDefined();
    });

    it('generates vercel.json for multi', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, target: 'vercel' });
      const configFile = result.files.find((f) => f.path.endsWith('vercel.json'));
      expect(configFile).toBeDefined();
    });

    // Cloudflare multi specifics
    it('generates index.ts for cloudflare multi', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, target: 'cloudflare' });
      const handlerFile = result.files.find((f) => f.path.endsWith('index.ts'));
      expect(handlerFile).toBeDefined();
    });

    it('generates wrangler.toml for cloudflare multi', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, target: 'cloudflare' });
      const configFile = result.files.find((f) => f.path.endsWith('wrangler.toml'));
      expect(configFile).toBeDefined();
      expect(configFile!.content).toContain('input-service');
    });

    // Inngest multi specifics
    it('generates inngest handler with function definitions', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, target: 'inngest' });
      const handlerFile = result.files.find((f) => f.path.endsWith('handler.ts'));
      expect(handlerFile).toBeDefined();
      expect(handlerFile!.content).toContain('createFunction');
      expect(handlerFile!.content).toContain('inngest');
    });

    it('generates inngest package.json with express dependency', async () => {
      const result = await exportMultiWorkflow({ ...multiOptions, target: 'inngest' });
      const pkgFile = result.files.find((f) => f.path.endsWith('package.json'));
      expect(pkgFile).toBeDefined();
      const pkg = JSON.parse(pkgFile!.content);
      expect(pkg.dependencies.express).toBeDefined();
      expect(pkg.dependencies.inngest).toBeDefined();
    });

    // Dry-run mode for multi
    it('does not write files in dry-run mode', async () => {
      await exportMultiWorkflow({ ...multiOptions, dryRun: true });
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('cleans up temp directory in dry-run mode', async () => {
      await exportMultiWorkflow({ ...multiOptions, dryRun: true });
      expect(mockedFs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('fw-export-multi-dryrun'),
        expect.objectContaining({ recursive: true, force: true })
      );
    });

    it('writes files to disk when not in dry-run mode', async () => {
      await exportMultiWorkflow(multiOptions);
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });

    // Error handling during compilation in multi mode
    it('cleans up temp dir even when compilation fails in dry-run', async () => {
      vi.mocked(compileWorkflow).mockRejectedValueOnce(new Error('compile failed'));

      await expect(exportMultiWorkflow({ ...multiOptions, dryRun: true })).rejects.toThrow('compile failed');
      expect(mockedFs.rmSync).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────
  // OpenAPI multi-workflow spec structure
  // ──────────────────────────────────────────────────
  describe('multi-workflow OpenAPI spec', () => {
    beforeEach(() => {
      mockParseFn.mockReturnValue(
        makeParseMock([
          { name: 'alpha', functionName: 'alpha', description: 'Alpha workflow' },
          { name: 'beta', functionName: 'beta' },
        ])
      );
    });

    it('includes tags for workflows and functions', async () => {
      const result = await exportMultiWorkflow({
        target: 'lambda',
        input: '/test/input.ts',
        output: '/test/output',
        multi: true,
      });
      const spec = result.openApiSpec as any;
      expect(spec.tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'workflows' }),
          expect.objectContaining({ name: 'functions' }),
        ])
      );
    });

    it('uses workflow description when available', async () => {
      const result = await exportMultiWorkflow({
        target: 'lambda',
        input: '/test/input.ts',
        output: '/test/output',
        multi: true,
      });
      const spec = result.openApiSpec as any;
      expect(spec.paths['/api/alpha'].post.description).toBe('Alpha workflow');
    });

    it('uses fallback description when none provided', async () => {
      const result = await exportMultiWorkflow({
        target: 'lambda',
        input: '/test/input.ts',
        output: '/test/output',
        multi: true,
      });
      const spec = result.openApiSpec as any;
      expect(spec.paths['/api/beta'].post.description).toContain('Execute the beta workflow');
    });

    it('generates correct operationIds', async () => {
      const result = await exportMultiWorkflow({
        target: 'lambda',
        input: '/test/input.ts',
        output: '/test/output',
        multi: true,
      });
      const spec = result.openApiSpec as any;
      expect(spec.paths['/api/alpha'].post.operationId).toBe('execute_alpha');
      expect(spec.paths['/api/beta'].post.operationId).toBe('execute_beta');
    });

    it('includes standard response codes for each workflow', async () => {
      const result = await exportMultiWorkflow({
        target: 'lambda',
        input: '/test/input.ts',
        output: '/test/output',
        multi: true,
      });
      const spec = result.openApiSpec as any;
      const responses = spec.paths['/api/alpha'].post.responses;
      expect(responses['200']).toBeDefined();
      expect(responses['404']).toBeDefined();
      expect(responses['500']).toBeDefined();
    });

    it('includes request body schema for each workflow', async () => {
      const result = await exportMultiWorkflow({
        target: 'lambda',
        input: '/test/input.ts',
        output: '/test/output',
        multi: true,
      });
      const spec = result.openApiSpec as any;
      const requestBody = spec.paths['/api/alpha'].post.requestBody;
      expect(requestBody.required).toBe(true);
      expect(requestBody.content['application/json']).toBeDefined();
    });
  });
});
