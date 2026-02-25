/**
 * Tests for the BaseExportTarget abstract class and ExportTargetRegistry.
 *
 * Creates a minimal concrete subclass to exercise all the protected utility
 * methods that every real target inherits: file generation, OpenAPI spec
 * builders, README generation, runtime scaffolding, etc.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  BaseExportTarget,
  ExportTargetRegistry,
  type ExportOptions,
  type ExportArtifacts,
  type MultiWorkflowArtifacts,
  type NodeTypeArtifacts,
  type BundleArtifacts,
  type CompiledWorkflow,
  type NodeTypeInfo,
  type NodeTypeExportOptions,
  type BundleWorkflow,
  type BundleNodeType,
  type DeployInstructions,
  type GeneratedFile,
} from '../../../src/deployment/targets/base';

// ── Concrete test subclass ──────────────────────────────────────────

class TestTarget extends BaseExportTarget {
  readonly name = 'test';
  readonly description = 'Test target';

  async generate(options: ExportOptions): Promise<ExportArtifacts> {
    return {
      files: [this.createFile(options.outputDir, 'handler.ts', '// handler', 'handler')],
      target: this.name,
      workflowName: options.workflowName,
      entryPoint: 'handler.ts',
    };
  }

  async generateMultiWorkflow(
    workflows: CompiledWorkflow[],
    options: ExportOptions
  ): Promise<MultiWorkflowArtifacts> {
    return {
      files: [],
      target: this.name,
      workflowName: options.workflowName,
      entryPoint: 'handler.ts',
      workflowNames: workflows.map((w) => w.name),
    };
  }

  async generateNodeTypeService(
    nodeTypes: NodeTypeInfo[],
    options: NodeTypeExportOptions
  ): Promise<NodeTypeArtifacts> {
    return {
      files: [],
      target: this.name,
      workflowName: options.serviceName,
      entryPoint: 'handler.ts',
      nodeTypeNames: nodeTypes.map((nt) => nt.name),
    };
  }

  async generateBundle(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: ExportOptions
  ): Promise<BundleArtifacts> {
    return {
      files: [],
      target: this.name,
      workflowName: options.workflowName,
      entryPoint: 'handler.ts',
    };
  }

  getDeployInstructions(): DeployInstructions {
    return {
      title: 'Deploy to Test',
      steps: ['npm install', 'npm run deploy'],
      prerequisites: ['Node.js 20+'],
    };
  }

  // Expose protected methods for testing
  public $generatePackageJson = this.generatePackageJson.bind(this);
  public $generateTsConfig = this.generateTsConfig.bind(this);
  public $createFile = this.createFile.bind(this);
  public $generateBundleContentFiles = this.generateBundleContentFiles.bind(this);
  public $generateWorkflowContentFiles = this.generateWorkflowContentFiles.bind(this);
  public $generateNodeTypeContentFiles = this.generateNodeTypeContentFiles.bind(this);
  public $getWorkflowImport = this.getWorkflowImport.bind(this);
  public $generateNodeTypeOpenAPI = this.generateNodeTypeOpenAPI.bind(this);
  public $generateConsolidatedOpenAPI = this.generateConsolidatedOpenAPI.bind(this);
  public $generateBundleOpenAPI = this.generateBundleOpenAPI.bind(this);
  public $generateReadme = this.generateReadme.bind(this);
  public $generateRuntimeFiles = this.generateRuntimeFiles.bind(this);
  public $generateFunctionRegistryContent = this.generateFunctionRegistryContent.bind(this);
}

// ── Fixtures ────────────────────────────────────────────────────────

const outputDir = '/tmp/test-output';

const sampleNodeTypes: NodeTypeInfo[] = [
  {
    name: 'FetchData',
    functionName: 'fetchData',
    description: 'Fetches data from an API',
    inputs: {
      url: { dataType: 'STRING', label: 'URL' },
      headers: { dataType: 'OBJECT', label: 'Headers', optional: true },
      execute: { dataType: 'STEP' },
    },
    outputs: {
      data: { dataType: 'OBJECT', label: 'Response data' },
      status: { dataType: 'NUMBER', label: 'HTTP status' },
      onSuccess: { dataType: 'STEP' },
    },
    code: 'export function fetchData() {}',
  },
  {
    name: 'TransformData',
    functionName: 'transformData',
    description: 'Transforms data',
    inputs: {
      input: { dataType: 'ANY', label: 'Input' },
    },
    outputs: {
      result: { dataType: 'ANY', label: 'Result' },
    },
    code: 'export function transformData() {}',
  },
];

const sampleWorkflows: CompiledWorkflow[] = [
  {
    name: 'validate-input',
    functionName: 'validateInput',
    description: 'Validates user input',
    code: 'export function validateInput() {}',
  },
  {
    name: 'send-email',
    functionName: 'sendEmail',
    description: 'Sends notification emails',
    code: 'export function sendEmail() {}',
  },
];

const sampleBundleWorkflows: BundleWorkflow[] = [
  { ...sampleWorkflows[0], expose: true },
  { ...sampleWorkflows[1], expose: false },
];

const sampleBundleNodeTypes: BundleNodeType[] = [
  { ...sampleNodeTypes[0], expose: true },
  { ...sampleNodeTypes[1], expose: false },
];

// ── Tests ───────────────────────────────────────────────────────────

describe('BaseExportTarget', () => {
  const target = new TestTarget();

  describe('generatePackageJson', () => {
    it('should produce valid JSON with fw- prefix on name', () => {
      const json = target.$generatePackageJson({ name: 'my-workflow' });
      const pkg = JSON.parse(json);

      expect(pkg.name).toBe('fw-my-workflow');
      expect(pkg.version).toBe('1.0.0');
      expect(pkg.type).toBe('module');
    });

    it('should use provided description', () => {
      const json = target.$generatePackageJson({
        name: 'wf',
        description: 'Custom description',
      });
      const pkg = JSON.parse(json);

      expect(pkg.description).toBe('Custom description');
    });

    it('should generate default description when none provided', () => {
      const json = target.$generatePackageJson({ name: 'wf' });
      const pkg = JSON.parse(json);

      expect(pkg.description).toBe('Flow Weaver workflow: wf');
    });

    it('should use custom main entry point', () => {
      const json = target.$generatePackageJson({ name: 'wf', main: 'dist/handler.js' });
      const pkg = JSON.parse(json);

      expect(pkg.main).toBe('dist/handler.js');
    });

    it('should default main to index.js', () => {
      const json = target.$generatePackageJson({ name: 'wf' });
      const pkg = JSON.parse(json);

      expect(pkg.main).toBe('index.js');
    });

    it('should merge custom scripts', () => {
      const json = target.$generatePackageJson({
        name: 'wf',
        scripts: { build: 'tsc', deploy: 'sls deploy' },
      });
      const pkg = JSON.parse(json);

      expect(pkg.scripts.build).toBe('tsc');
      expect(pkg.scripts.deploy).toBe('sls deploy');
    });

    it('should always include typescript in devDependencies', () => {
      const json = target.$generatePackageJson({ name: 'wf' });
      const pkg = JSON.parse(json);

      expect(pkg.devDependencies.typescript).toBe('^5.0.0');
    });

    it('should merge custom devDependencies with typescript', () => {
      const json = target.$generatePackageJson({
        name: 'wf',
        devDependencies: { '@types/node': '^20.0.0' },
      });
      const pkg = JSON.parse(json);

      expect(pkg.devDependencies.typescript).toBe('^5.0.0');
      expect(pkg.devDependencies['@types/node']).toBe('^20.0.0');
    });

    it('should include custom dependencies', () => {
      const json = target.$generatePackageJson({
        name: 'wf',
        dependencies: { inngest: '^3.0.0' },
      });
      const pkg = JSON.parse(json);

      expect(pkg.dependencies.inngest).toBe('^3.0.0');
    });
  });

  describe('generateTsConfig', () => {
    it('should produce valid JSON with sensible defaults', () => {
      const json = target.$generateTsConfig();
      const config = JSON.parse(json);

      expect(config.compilerOptions.target).toBe('ES2022');
      expect(config.compilerOptions.module).toBe('NodeNext');
      expect(config.compilerOptions.moduleResolution).toBe('NodeNext');
      expect(config.compilerOptions.outDir).toBe('./dist');
      expect(config.compilerOptions.strict).toBe(true);
      expect(config.compilerOptions.esModuleInterop).toBe(true);
      expect(config.compilerOptions.skipLibCheck).toBe(true);
      expect(config.include).toEqual(['**/*.ts']);
    });

    it('should accept custom outDir', () => {
      const json = target.$generateTsConfig({ outDir: './build' });
      const config = JSON.parse(json);

      expect(config.compilerOptions.outDir).toBe('./build');
    });

    it('should accept custom module format', () => {
      const json = target.$generateTsConfig({ module: 'ESNext' });
      const config = JSON.parse(json);

      expect(config.compilerOptions.module).toBe('ESNext');
    });

    it('should accept custom moduleResolution', () => {
      const json = target.$generateTsConfig({ moduleResolution: 'Bundler' });
      const config = JSON.parse(json);

      expect(config.compilerOptions.moduleResolution).toBe('Bundler');
    });

    it('should include types when provided', () => {
      const json = target.$generateTsConfig({ types: ['@cloudflare/workers-types'] });
      const config = JSON.parse(json);

      expect(config.compilerOptions.types).toEqual(['@cloudflare/workers-types']);
    });

    it('should not include types key when not provided', () => {
      const json = target.$generateTsConfig();
      const config = JSON.parse(json);

      expect(config.compilerOptions.types).toBeUndefined();
    });
  });

  describe('createFile', () => {
    it('should build correct GeneratedFile with absolute path', () => {
      const file = target.$createFile('/out', 'src/handler.ts', '// code', 'handler');

      expect(file.relativePath).toBe('src/handler.ts');
      expect(file.absolutePath).toBe(path.join('/out', 'src/handler.ts'));
      expect(file.content).toBe('// code');
      expect(file.type).toBe('handler');
    });

    it('should handle nested relative paths', () => {
      const file = target.$createFile('/out', 'a/b/c.ts', '', 'other');

      expect(file.absolutePath).toBe(path.join('/out', 'a/b/c.ts'));
    });
  });

  describe('generateBundleContentFiles', () => {
    it('should create workflow and node type files from items with code', () => {
      const files = target.$generateBundleContentFiles(
        sampleBundleWorkflows,
        sampleBundleNodeTypes,
        outputDir
      );

      // Both workflows have code
      const wfFiles = files.filter((f) => f.type === 'workflow');
      expect(wfFiles.length).toBe(2);
      expect(wfFiles[0].relativePath).toBe('workflows/validate-input.ts');
      expect(wfFiles[1].relativePath).toBe('workflows/send-email.ts');

      // Both node types have code
      const ntFiles = files.filter((f) => f.type === 'nodeType');
      expect(ntFiles.length).toBe(2);
      // filenames are lowercased functionName
      expect(ntFiles[0].relativePath).toBe('node-types/fetchdata.ts');
      expect(ntFiles[1].relativePath).toBe('node-types/transformdata.ts');
    });

    it('should skip items without code', () => {
      const noCodeWorkflows: BundleWorkflow[] = [
        { name: 'no-code', functionName: 'noCode', expose: true },
      ];
      const files = target.$generateBundleContentFiles(noCodeWorkflows, [], outputDir);

      expect(files.length).toBe(0);
    });

    it('should use custom directory names', () => {
      const files = target.$generateBundleContentFiles(
        [sampleBundleWorkflows[0]],
        [sampleBundleNodeTypes[0]],
        outputDir,
        'wf',
        'nt'
      );

      expect(files.some((f) => f.relativePath.startsWith('wf/'))).toBe(true);
      expect(files.some((f) => f.relativePath.startsWith('nt/'))).toBe(true);
    });
  });

  describe('generateWorkflowContentFiles', () => {
    it('should create files for workflows with code', () => {
      const files = target.$generateWorkflowContentFiles(sampleWorkflows, outputDir);

      expect(files.length).toBe(2);
      expect(files[0].relativePath).toBe('workflows/validate-input.ts');
      expect(files[0].type).toBe('workflow');
      expect(files[1].relativePath).toBe('workflows/send-email.ts');
    });

    it('should skip workflows without code', () => {
      const noCode: CompiledWorkflow[] = [
        { name: 'empty', functionName: 'empty' },
      ];
      const files = target.$generateWorkflowContentFiles(noCode, outputDir);

      expect(files.length).toBe(0);
    });

    it('should use a custom workflow directory name', () => {
      const files = target.$generateWorkflowContentFiles(sampleWorkflows, outputDir, 'src/wf');

      expect(files[0].relativePath).toBe('src/wf/validate-input.ts');
    });
  });

  describe('generateNodeTypeContentFiles', () => {
    it('should create files for node types with code', () => {
      const files = target.$generateNodeTypeContentFiles(sampleNodeTypes, outputDir);

      expect(files.length).toBe(2);
      // filenames use lowercase functionName
      expect(files[0].relativePath).toBe('node-types/fetchdata.ts');
      expect(files[1].relativePath).toBe('node-types/transformdata.ts');
      expect(files[0].type).toBe('nodeType');
    });

    it('should skip node types without code', () => {
      const noCode: NodeTypeInfo[] = [
        { name: 'NoCode', functionName: 'noCode', inputs: {}, outputs: {} },
      ];
      const files = target.$generateNodeTypeContentFiles(noCode, outputDir);

      expect(files.length).toBe(0);
    });

    it('should use a custom node type directory name', () => {
      const files = target.$generateNodeTypeContentFiles(sampleNodeTypes, outputDir, 'src/nodes');

      expect(files[0].relativePath).toBe('src/nodes/fetchdata.ts');
    });
  });

  describe('getWorkflowImport', () => {
    it('should return a relative JS import without extension', () => {
      const imp = target.$getWorkflowImport('workflow.ts');

      expect(imp).toBe('./workflow.js');
    });

    it('should handle paths with directories (uses basename)', () => {
      const imp = target.$getWorkflowImport('/some/dir/my-flow.ts');

      expect(imp).toBe('./my-flow.js');
    });

    it('should handle .js extension', () => {
      const imp = target.$getWorkflowImport('handler.js');

      expect(imp).toBe('./handler.js');
    });
  });

  describe('generateNodeTypeOpenAPI', () => {
    it('should produce a valid OpenAPI 3.0.3 spec', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'My Service',
        version: '2.0.0',
      }) as Record<string, unknown>;

      expect(spec.openapi).toBe('3.0.3');
      const info = spec.info as Record<string, unknown>;
      expect(info.title).toBe('My Service');
      expect(info.version).toBe('2.0.0');
      expect((info.description as string)).toContain('2 endpoints');
    });

    it('should create a POST path for each node type', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, unknown>;

      expect(paths['/api/FetchData']).toBeDefined();
      expect(paths['/api/TransformData']).toBeDefined();
    });

    it('should skip STEP ports from request/response schemas', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      // FetchData has an 'execute' STEP input that should be excluded
      const fetchBody = paths['/api/FetchData'].post.requestBody as Record<string, unknown>;
      const content = fetchBody.content as Record<string, Record<string, Record<string, unknown>>>;
      const properties = content['application/json'].schema.properties as Record<string, unknown>;

      expect(properties['execute']).toBeUndefined();
      expect(properties['url']).toBeDefined();
      expect(properties['headers']).toBeDefined();

      // FetchData has an 'onSuccess' STEP output that should be excluded from responses
      const responseBody = (paths['/api/FetchData'].post.responses as Record<string, unknown>)['200'] as Record<string, unknown>;
      const resContent = responseBody.content as Record<string, Record<string, Record<string, unknown>>>;
      const resultProps = resContent['application/json'].schema.properties as Record<string, Record<string, unknown>>;
      const resultObjProps = resultProps.result.properties as Record<string, unknown>;

      expect(resultObjProps['onSuccess']).toBeUndefined();
      expect(resultObjProps['data']).toBeDefined();
      expect(resultObjProps['status']).toBeDefined();
    });

    it('should mark non-optional inputs as required', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      const fetchBody = paths['/api/FetchData'].post.requestBody as Record<string, unknown>;
      const content = fetchBody.content as Record<string, Record<string, Record<string, unknown>>>;
      const schema = content['application/json'].schema as Record<string, unknown>;
      const required = schema.required as string[];

      expect(required).toContain('url');
      // headers is optional
      expect(required).not.toContain('headers');
    });

    it('should include an /api/openapi.json endpoint', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, unknown>;

      expect(paths['/api/openapi.json']).toBeDefined();
    });

    it('should use default base URL when none provided', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const servers = spec.servers as Array<Record<string, unknown>>;

      expect(servers[0].url).toBe('/');
    });

    it('should use custom base URL when provided', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'Test',
        version: '1.0.0',
        baseUrl: 'https://api.example.com',
      }) as Record<string, unknown>;
      const servers = spec.servers as Array<Record<string, unknown>>;

      expect(servers[0].url).toBe('https://api.example.com');
    });

    it('should map data types to JSON schema types', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      const fetchBody = paths['/api/FetchData'].post.requestBody as Record<string, unknown>;
      const content = fetchBody.content as Record<string, Record<string, Record<string, unknown>>>;
      const properties = content['application/json'].schema.properties as Record<string, Record<string, unknown>>;

      expect(properties['url'].type).toBe('string');
      expect(properties['headers'].type).toBe('object');
    });

    it('should include tsType extension when present', () => {
      const nodeTypesWithTsType: NodeTypeInfo[] = [
        {
          name: 'Typed',
          functionName: 'typed',
          inputs: { data: { dataType: 'OBJECT', tsType: 'MyInterface', label: 'data' } },
          outputs: {},
        },
      ];

      const spec = target.$generateNodeTypeOpenAPI(nodeTypesWithTsType, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      const body = paths['/api/Typed'].post.requestBody as Record<string, unknown>;
      const content = body.content as Record<string, Record<string, Record<string, unknown>>>;
      const properties = content['application/json'].schema.properties as Record<string, Record<string, unknown>>;

      expect(properties['data']['x-ts-type']).toBe('MyInterface');
    });

    it('should include tags in the spec', () => {
      const spec = target.$generateNodeTypeOpenAPI(sampleNodeTypes, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const tags = spec.tags as Array<Record<string, string>>;

      expect(tags.some((t) => t.name === 'node-types')).toBe(true);
      expect(tags.some((t) => t.name === 'documentation')).toBe(true);
    });
  });

  describe('generateConsolidatedOpenAPI', () => {
    it('should produce a valid OpenAPI spec for workflows', () => {
      const spec = target.$generateConsolidatedOpenAPI(sampleWorkflows, {
        title: 'Workflows API',
        version: '1.0.0',
      }) as Record<string, unknown>;

      expect(spec.openapi).toBe('3.0.3');
      const info = spec.info as Record<string, unknown>;
      expect(info.title).toBe('Workflows API');
      expect((info.description as string)).toContain('2 workflows');
    });

    it('should create POST endpoints for each workflow', () => {
      const spec = target.$generateConsolidatedOpenAPI(sampleWorkflows, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, unknown>;

      expect(paths['/api/validate-input']).toBeDefined();
      expect(paths['/api/send-email']).toBeDefined();
    });

    it('should include /api/functions and /api/openapi.json endpoints', () => {
      const spec = target.$generateConsolidatedOpenAPI(sampleWorkflows, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, unknown>;

      expect(paths['/api/functions']).toBeDefined();
      expect(paths['/api/openapi.json']).toBeDefined();
    });

    it('should include FunctionReference component schema', () => {
      const spec = target.$generateConsolidatedOpenAPI(sampleWorkflows, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const components = spec.components as Record<string, Record<string, unknown>>;

      expect(components.schemas.FunctionReference).toBeDefined();
    });

    it('should include workflow, functions, and documentation tags', () => {
      const spec = target.$generateConsolidatedOpenAPI(sampleWorkflows, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const tags = spec.tags as Array<Record<string, string>>;

      const tagNames = tags.map((t) => t.name);
      expect(tagNames).toContain('workflows');
      expect(tagNames).toContain('functions');
      expect(tagNames).toContain('documentation');
    });

    it('should use description fallback when workflow has no description', () => {
      const noDescWorkflows: CompiledWorkflow[] = [
        { name: 'bare', functionName: 'bare' },
      ];
      const spec = target.$generateConsolidatedOpenAPI(noDescWorkflows, {
        title: 'Test',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const post = paths['/api/bare'].post;

      expect(post.description).toBe('Execute the bare workflow');
    });
  });

  describe('generateBundleOpenAPI', () => {
    it('should only include exposed workflows and node types', () => {
      const spec = target.$generateBundleOpenAPI(
        sampleBundleWorkflows,
        sampleBundleNodeTypes,
        { title: 'Bundle', version: '1.0.0' }
      ) as Record<string, unknown>;
      const paths = spec.paths as Record<string, unknown>;

      // validate-input is exposed, send-email is not
      expect(paths['/api/workflows/validate-input']).toBeDefined();
      expect(paths['/api/workflows/send-email']).toBeUndefined();

      // FetchData is exposed, TransformData is not
      expect(paths['/api/nodes/FetchData']).toBeDefined();
      expect(paths['/api/nodes/TransformData']).toBeUndefined();
    });

    it('should include functions and openapi.json endpoints', () => {
      const spec = target.$generateBundleOpenAPI([], [], {
        title: 'Bundle',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, unknown>;

      expect(paths['/api/functions']).toBeDefined();
      expect(paths['/api/openapi.json']).toBeDefined();
    });

    it('should build accurate description from exposed counts', () => {
      const spec = target.$generateBundleOpenAPI(
        sampleBundleWorkflows,
        sampleBundleNodeTypes,
        { title: 'Bundle', version: '1.0.0' }
      ) as Record<string, unknown>;
      const info = spec.info as Record<string, unknown>;

      expect((info.description as string)).toContain('1 workflow');
      expect((info.description as string)).toContain('1 node type');
    });

    it('should pluralize correctly for multiple exposed items', () => {
      const multiExposed: BundleWorkflow[] = [
        { name: 'a', functionName: 'a', expose: true },
        { name: 'b', functionName: 'b', expose: true },
      ];
      const spec = target.$generateBundleOpenAPI(multiExposed, [], {
        title: 'B',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const info = spec.info as Record<string, unknown>;

      expect((info.description as string)).toContain('2 workflows');
    });

    it('should only add tags for non-empty groups', () => {
      // No exposed node types
      const spec = target.$generateBundleOpenAPI(
        [{ name: 'w', functionName: 'w', expose: true }],
        [],
        { title: 'B', version: '1.0.0' }
      ) as Record<string, unknown>;
      const tags = spec.tags as Array<Record<string, string>>;
      const tagNames = tags.map((t) => t.name);

      expect(tagNames).toContain('workflows');
      expect(tagNames).not.toContain('node-types');
      expect(tagNames).toContain('functions');
      expect(tagNames).toContain('documentation');
    });

    it('should skip STEP ports in exposed node type schemas', () => {
      const spec = target.$generateBundleOpenAPI([], sampleBundleNodeTypes, {
        title: 'B',
        version: '1.0.0',
      }) as Record<string, unknown>;
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      const fetchBody = paths['/api/nodes/FetchData'].post.requestBody as Record<string, unknown>;
      const content = fetchBody.content as Record<string, Record<string, Record<string, unknown>>>;
      const properties = content['application/json'].schema.properties as Record<string, unknown>;

      expect(properties['execute']).toBeUndefined();
      expect(properties['url']).toBeDefined();
    });
  });

  describe('generateReadme', () => {
    it('should include title with workflow name and target', () => {
      const instructions: DeployInstructions = {
        title: 'Deploy to Lambda',
        steps: [],
        prerequisites: [],
      };
      const readme = target.$generateReadme(instructions, 'my-workflow', 'Lambda');

      expect(readme).toContain('# Deploy my-workflow to Lambda');
    });

    it('should render prerequisites section', () => {
      const instructions: DeployInstructions = {
        title: 'Deploy',
        steps: [],
        prerequisites: ['Node.js 20+', 'AWS CLI'],
      };
      const readme = target.$generateReadme(instructions, 'wf', 'Lambda');

      expect(readme).toContain('## Prerequisites');
      expect(readme).toContain('- Node.js 20+');
      expect(readme).toContain('- AWS CLI');
    });

    it('should render numbered deployment steps', () => {
      const instructions: DeployInstructions = {
        title: 'Deploy',
        steps: ['npm install', 'npm run build'],
        prerequisites: [],
      };
      const readme = target.$generateReadme(instructions, 'wf', 'Target');

      expect(readme).toContain('1. `npm install`');
      expect(readme).toContain('2. `npm run build`');
    });

    it('should render indented sub-steps as inline code', () => {
      const instructions: DeployInstructions = {
        title: 'Deploy',
        steps: ['npm install', '  cd dist'],
        prerequisites: [],
      };
      const readme = target.$generateReadme(instructions, 'wf', 'Target');

      expect(readme).toContain('`cd dist`');
    });

    it('should render local test steps in a code block', () => {
      const instructions: DeployInstructions = {
        title: 'Deploy',
        steps: [],
        prerequisites: [],
        localTestSteps: ['npm run dev', 'curl localhost:3000'],
      };
      const readme = target.$generateReadme(instructions, 'wf', 'Target');

      expect(readme).toContain('## Local Testing');
      expect(readme).toContain('```bash');
      expect(readme).toContain('npm run dev');
      expect(readme).toContain('curl localhost:3000');
    });

    it('should render links section', () => {
      const instructions: DeployInstructions = {
        title: 'Deploy',
        steps: [],
        prerequisites: [],
        links: [{ label: 'AWS Docs', url: 'https://aws.amazon.com' }],
      };
      const readme = target.$generateReadme(instructions, 'wf', 'Target');

      expect(readme).toContain('## Useful Links');
      expect(readme).toContain('[AWS Docs](https://aws.amazon.com)');
    });

    it('should include generated branding footer', () => {
      const instructions: DeployInstructions = {
        title: 'Deploy',
        steps: [],
        prerequisites: [],
      };
      const readme = target.$generateReadme(instructions, 'wf', 'Target');

      expect(readme).toContain('Flow Weaver');
      expect(readme).toContain('---');
    });

    it('should omit empty sections', () => {
      const instructions: DeployInstructions = {
        title: 'Deploy',
        steps: [],
        prerequisites: [],
      };
      const readme = target.$generateReadme(instructions, 'wf', 'Target');

      expect(readme).not.toContain('## Prerequisites');
      expect(readme).not.toContain('## Deployment Steps');
      expect(readme).not.toContain('## Local Testing');
      expect(readme).not.toContain('## Useful Links');
    });
  });

  describe('generateRuntimeFiles', () => {
    it('should generate three runtime files', () => {
      const files = target.$generateRuntimeFiles(outputDir, sampleBundleWorkflows, sampleBundleNodeTypes);

      expect(files.length).toBe(3);
      const paths = files.map((f) => f.relativePath);
      expect(paths).toContain('runtime/function-registry.ts');
      expect(paths).toContain('runtime/builtin-functions.ts');
      expect(paths).toContain('runtime/parameter-resolver.ts');
    });

    it('should type all runtime files as "other"', () => {
      const files = target.$generateRuntimeFiles(outputDir, [], []);

      for (const f of files) {
        expect(f.type).toBe('other');
      }
    });

    it('should include workflow and nodeType metadata in function registry', () => {
      const files = target.$generateRuntimeFiles(outputDir, sampleBundleWorkflows, sampleBundleNodeTypes);
      const registry = files.find((f) => f.relativePath === 'runtime/function-registry.ts')!;

      expect(registry.content).toContain("name: 'validate-input'");
      expect(registry.content).toContain("type: 'workflow'");
      expect(registry.content).toContain("name: 'FetchData'");
      expect(registry.content).toContain("type: 'nodeType'");
    });

    it('should include expose flag in registry entries', () => {
      const files = target.$generateRuntimeFiles(outputDir, sampleBundleWorkflows, sampleBundleNodeTypes);
      const registry = files.find((f) => f.relativePath === 'runtime/function-registry.ts')!;

      expect(registry.content).toContain('exposed: true');
      expect(registry.content).toContain('exposed: false');
    });
  });

  describe('generateFunctionRegistryContent', () => {
    it('should produce valid TypeScript for an empty registry', () => {
      const content = target.$generateFunctionRegistryContent([], []);

      expect(content).toContain('const functions: FunctionInfo[]');
      expect(content).toContain('export const functionRegistry');
    });

    it('should list all workflows and node types', () => {
      const content = target.$generateFunctionRegistryContent(
        sampleBundleWorkflows,
        sampleBundleNodeTypes
      );

      expect(content).toContain("name: 'validate-input'");
      expect(content).toContain("name: 'send-email'");
      expect(content).toContain("name: 'FetchData'");
      expect(content).toContain("name: 'TransformData'");
    });
  });
});

describe('ExportTargetRegistry', () => {
  it('should register and retrieve a target by name', () => {
    const registry = new ExportTargetRegistry();
    const target = new TestTarget();

    registry.register(target);
    expect(registry.get('test')).toBe(target);
  });

  it('should return undefined for unregistered targets', () => {
    const registry = new ExportTargetRegistry();

    expect(registry.get('nope')).toBeUndefined();
  });

  it('should return all registered targets', () => {
    const registry = new ExportTargetRegistry();
    const t1 = new TestTarget();
    registry.register(t1);

    expect(registry.getAll()).toEqual([t1]);
  });

  it('should return all registered target names', () => {
    const registry = new ExportTargetRegistry();
    registry.register(new TestTarget());

    expect(registry.getNames()).toEqual(['test']);
  });

  it('should overwrite a target when re-registered with the same name', () => {
    const registry = new ExportTargetRegistry();
    const t1 = new TestTarget();
    const t2 = new TestTarget();

    registry.register(t1);
    registry.register(t2);

    expect(registry.get('test')).toBe(t2);
    expect(registry.getAll().length).toBe(1);
  });
});
