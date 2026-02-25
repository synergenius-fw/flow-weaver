/**
 * AWS Lambda export target tests.
 *
 * Covers: generate (basic + docs), generateMultiWorkflow, generateNodeTypeService,
 * generateBundle, deploy instructions, and handler content assertions.
 */

import { describe, it, expect } from 'vitest';
import { LambdaTarget } from '../../../src/deployment/targets/lambda.js';
import type {
  ExportOptions,
  CompiledWorkflow,
  NodeTypeInfo,
  NodeTypeExportOptions,
  BundleWorkflow,
  BundleNodeType,
} from '../../../src/deployment/targets/base.js';

// ── Fixtures ──────────────────────────────────────────────────────────

const baseOptions: ExportOptions = {
  sourceFile: '/path/to/workflow.ts',
  workflowName: 'processOrder',
  displayName: 'process-order',
  outputDir: '/tmp/lambda-output',
  description: 'Processes incoming orders',
};

const multiWorkflows: CompiledWorkflow[] = [
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

const nodeTypes: NodeTypeInfo[] = [
  {
    name: 'FetchData',
    functionName: 'fetchData',
    description: 'Fetches data from an API',
    inputs: {
      url: { dataType: 'STRING', label: 'URL' },
      headers: { dataType: 'OBJECT', label: 'Headers', optional: true },
    },
    outputs: {
      data: { dataType: 'OBJECT', label: 'Response data' },
      status: { dataType: 'NUMBER', label: 'HTTP status' },
    },
    code: 'export function fetchData() {}',
  },
  {
    name: 'TransformData',
    functionName: 'transformData',
    description: 'Transforms data',
    inputs: {
      execute: { dataType: 'STEP' },
      input: { dataType: 'ANY', label: 'Input' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      result: { dataType: 'ANY', label: 'Result' },
    },
    code: 'export function transformData() {}',
  },
];

const nodeTypeExportOptions: NodeTypeExportOptions = {
  sourceFile: '/path/to/node-types.ts',
  serviceName: 'data-service',
  outputDir: '/tmp/lambda-nt-output',
};

const bundleWorkflows: BundleWorkflow[] = [
  {
    name: 'process-order',
    functionName: 'processOrder',
    expose: true,
    code: 'export function processOrder() {}',
  },
  {
    name: 'internal-helper',
    functionName: 'internalHelper',
    expose: false,
    code: 'export function internalHelper() {}',
  },
];

const bundleNodeTypes: BundleNodeType[] = [
  {
    name: 'Validator',
    functionName: 'validator',
    expose: true,
    code: 'export function validator() {}',
    inputs: { value: { dataType: 'ANY' } },
    outputs: { valid: { dataType: 'BOOLEAN' } },
  },
  {
    name: 'Logger',
    functionName: 'logger',
    expose: false,
    code: 'export function logger() {}',
    inputs: { message: { dataType: 'STRING' } },
    outputs: {},
  },
];

// ── Tests ─────────────────────────────────────────────────────────────

describe('LambdaTarget', () => {
  const target = new LambdaTarget();

  // ── Single workflow generate ──

  describe('generate (basic)', () => {
    it('should produce a handler with API Gateway V2 types', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts');
      expect(handler).toBeDefined();
      expect(handler!.content).toContain('APIGatewayProxyEventV2');
      expect(handler!.content).toContain('APIGatewayProxyResultV2');
      expect(handler!.content).toContain('Context');
    });

    it('should import the workflow function', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("import { processOrder } from './workflow.js'");
    });

    it('should call the workflow function with parsed body', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('processOrder(true, body)');
      expect(handler.content).toContain('JSON.parse(event.body');
    });

    it('should use context.awsRequestId for request tracking', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('context.awsRequestId');
    });

    it('should set callbackWaitsForEmptyEventLoop to false', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('context.callbackWaitsForEmptyEventLoop = false');
    });

    it('should generate SAM template', async () => {
      const artifacts = await target.generate(baseOptions);
      const sam = artifacts.files.find((f) => f.relativePath === 'template.yaml');
      expect(sam).toBeDefined();
      expect(sam!.content).toContain('AWS::Serverless::Function');
      expect(sam!.content).toContain('process-order');
    });

    it('should generate package.json with aws-lambda types', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.devDependencies['@types/aws-lambda']).toBeDefined();
      expect(parsed.scripts.deploy).toContain('sam deploy');
    });

    it('should NOT generate openapi.ts when docs are disabled', async () => {
      const artifacts = await target.generate(baseOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts');
      expect(openapi).toBeUndefined();
    });
  });

  describe('generate (with docs)', () => {
    const docsOptions = { ...baseOptions, includeDocs: true };

    it('should generate openapi.ts spec file', async () => {
      const artifacts = await target.generate(docsOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts');
      expect(openapi).toBeDefined();
      expect(openapi!.content).toContain('openApiSpec');
    });

    it('should add /docs and /openapi.json routes to handler', async () => {
      const artifacts = await target.generate(docsOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('/openapi.json');
      expect(handler.content).toContain('/docs');
      expect(handler.content).toContain('swagger-ui');
    });

    it('should use SAM template with docs endpoints', async () => {
      const artifacts = await target.generate(docsOptions);
      const sam = artifacts.files.find((f) => f.relativePath === 'template.yaml')!;
      expect(sam.content).toContain('/docs');
      expect(sam.content).toContain('/openapi.json');
    });
  });

  // ── Multi-workflow ──

  describe('generateMultiWorkflow', () => {
    it('should produce a handler with per-workflow imports', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain(
        "import { validateInput } from './workflows/validate-input.js'"
      );
      expect(handler.content).toContain(
        "import { sendEmail } from './workflows/send-email.js'"
      );
    });

    it('should map workflow names to handler functions', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("'validate-input': validateInput");
      expect(handler.content).toContain("'send-email': sendEmail");
    });

    it('should route to workflows via /api/{name}', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('/api/');
    });

    it('should generate consolidated OpenAPI spec', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('validate-input');
      expect(openapi.content).toContain('send-email');
    });

    it('should generate SAM template for multi-workflow', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const sam = artifacts.files.find((f) => f.relativePath === 'template.yaml')!;
      expect(sam.content).toContain('AWS::Serverless::Function');
      expect(sam.content).toContain('2'); // workflow count
    });

    it('should produce workflow content files', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const wfFiles = artifacts.files.filter((f) => f.relativePath.startsWith('workflows/'));
      expect(wfFiles.length).toBe(2);
    });

    it('should return workflowNames in artifacts', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      expect(artifacts.workflowNames).toEqual(['validate-input', 'send-email']);
    });
  });

  // ── Node type service ──

  describe('generateNodeTypeService', () => {
    it('should import node types with lowercase paths', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain(
        "import { fetchData } from './node-types/fetchdata.js'"
      );
      expect(handler.content).toContain(
        "import { transformData } from './node-types/transformdata.js'"
      );
    });

    it('should map node type names to handler functions', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("'FetchData': fetchData");
      expect(handler.content).toContain("'TransformData': transformData");
    });

    it('should generate OpenAPI spec for node types', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('/api/FetchData');
      expect(openapi.content).toContain('/api/TransformData');
    });

    it('should generate SAM template for node type service', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const sam = artifacts.files.find((f) => f.relativePath === 'template.yaml')!;
      expect(sam.content).toContain('AWS::Serverless::Function');
      expect(sam.content).toContain('data-service');
    });

    it('should produce node-type content files', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const ntFiles = artifacts.files.filter((f) => f.relativePath.startsWith('node-types/'));
      expect(ntFiles.length).toBe(2);
      expect(ntFiles.map((f) => f.relativePath)).toContain('node-types/fetchdata.ts');
      expect(ntFiles.map((f) => f.relativePath)).toContain('node-types/transformdata.ts');
    });

    it('should return nodeTypeNames in artifacts', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      expect(artifacts.nodeTypeNames).toEqual(['FetchData', 'TransformData']);
    });
  });

  // ── Bundle ──

  describe('generateBundle', () => {
    it('should import all workflows and node types with code', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain(
        "import { processOrder } from './workflows/process-order.js'"
      );
      expect(handler.content).toContain(
        "import { internalHelper } from './workflows/internal-helper.js'"
      );
      expect(handler.content).toContain(
        "import { validator } from './node-types/validator.js'"
      );
    });

    it('should only expose flagged items in handler maps', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("'process-order': processOrder");
      expect(handler.content).toContain("'Validator': validator");
      expect(handler.content).not.toContain("'internal-helper': internalHelper");
      expect(handler.content).not.toContain("'Logger': logger");
    });

    it('should generate OpenAPI spec for exposed items only', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('/api/workflows/process-order');
      expect(openapi.content).toContain('/api/nodes/Validator');
      expect(openapi.content).not.toContain('/api/workflows/internal-helper');
    });

    it('should generate SAM template for bundle', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const sam = artifacts.files.find((f) => f.relativePath === 'template.yaml')!;
      expect(sam.content).toContain('AWS::Serverless::Function');
      expect(sam.content).toContain('/api/{proxy+}');
    });

    it('should include runtime files', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const runtimePaths = artifacts.files
        .filter((f) => f.relativePath.startsWith('runtime/'))
        .map((f) => f.relativePath);
      expect(runtimePaths).toContain('runtime/types.ts');
      expect(runtimePaths).toContain('runtime/function-registry.ts');
      expect(runtimePaths).toContain('runtime/builtin-functions.ts');
      expect(runtimePaths).toContain('runtime/parameter-resolver.ts');
    });

    it('should generate content files for workflows and node types', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const wfFiles = artifacts.files.filter((f) => f.relativePath.startsWith('workflows/'));
      const ntFiles = artifacts.files.filter((f) => f.relativePath.startsWith('node-types/'));
      expect(wfFiles.length).toBe(2);
      expect(ntFiles.length).toBe(2);
    });

    it('should handle name collisions with aliases', async () => {
      const collidingWorkflows: BundleWorkflow[] = [
        { name: 'shared', functionName: 'shared', expose: true, code: 'export function shared() {}' },
      ];
      const collidingNodeTypes: BundleNodeType[] = [
        {
          name: 'SharedNT',
          functionName: 'shared',
          expose: true,
          code: 'export function shared() {}',
          inputs: {},
          outputs: {},
        },
      ];
      const artifacts = await target.generateBundle(
        collidingWorkflows,
        collidingNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('shared as shared_nodeType');
    });

    it('should skip npm node types from content files', async () => {
      const npmNodeTypes: BundleNodeType[] = [
        {
          name: 'npm/lodash/get',
          functionName: 'get',
          expose: true,
          inputs: {},
          outputs: {},
        },
        {
          name: 'LocalNode',
          functionName: 'localNode',
          expose: true,
          code: 'export function localNode() {}',
          inputs: {},
          outputs: {},
        },
      ];
      const artifacts = await target.generateBundle([], npmNodeTypes, baseOptions);
      const ntFiles = artifacts.files.filter((f) => f.relativePath.startsWith('node-types/'));
      expect(ntFiles.length).toBe(1);
      expect(ntFiles[0].relativePath).toBe('node-types/localnode.ts');
    });

    it('should handle empty workflows and node types', async () => {
      const artifacts = await target.generateBundle([], [], baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('// No workflows');
      expect(handler.content).toContain('// No node types');
    });

    it('should return correct metadata in artifacts', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      expect(artifacts.target).toBe('lambda');
      expect(artifacts.entryPoint).toBe('handler.ts');
      expect(artifacts.workflowNames).toEqual(['process-order', 'internal-helper']);
      expect(artifacts.nodeTypeNames).toEqual(['Validator', 'Logger']);
    });
  });

  // ── Package.json details ──

  describe('package.json contents', () => {
    it('should use fw- prefix for the package name', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.name).toBe('fw-process-order');
    });

    it('should set type to module', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.type).toBe('module');
    });

    it('should include sam deploy in scripts', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.scripts.deploy).toContain('sam deploy');
    });

    it('should include typescript in devDependencies', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.devDependencies.typescript).toBeDefined();
    });
  });

  // ── Handler error handling ──

  describe('handler error handling', () => {
    it('should return 500 status for execution errors', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('statusCode: 500');
      expect(handler.content).toContain('error instanceof Error');
    });

    it('should include execution time in response headers', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('X-Execution-Time');
      expect(handler.content).toContain('executionTime');
    });
  });

  // ── Content file generation ──

  describe('content file generation', () => {
    it('should skip workflows without code', async () => {
      const mixed: CompiledWorkflow[] = [
        { name: 'has-code', functionName: 'hasCode', code: 'export function hasCode() {}' },
        { name: 'no-code', functionName: 'noCode' },
      ];
      const artifacts = await target.generateMultiWorkflow(mixed, baseOptions);
      const wfFiles = artifacts.files.filter((f) => f.relativePath.startsWith('workflows/'));
      expect(wfFiles.length).toBe(1);
    });

    it('should include the actual code content in workflow files', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const wf = artifacts.files.find((f) => f.relativePath === 'workflows/validate-input.ts')!;
      expect(wf.content).toBe('export function validateInput() {}');
    });
  });

  // ── Bundle runtime ──

  describe('bundle runtime files', () => {
    it('should generate function registry with workflow and node type metadata', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, bundleNodeTypes, baseOptions);
      const registry = artifacts.files.find((f) => f.relativePath === 'runtime/function-registry.ts')!;
      expect(registry.content).toContain("name: 'process-order'");
      expect(registry.content).toContain("type: 'workflow'");
      expect(registry.content).toContain("name: 'Validator'");
      expect(registry.content).toContain("type: 'nodeType'");
    });

    it('should generate runtime types module', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, bundleNodeTypes, baseOptions);
      const types = artifacts.files.find((f) => f.relativePath === 'runtime/types.ts')!;
      expect(types.content.length).toBeGreaterThan(0);
    });
  });

  // ── Bundle partial content ──

  describe('bundle with partial content', () => {
    it('should handle bundle with only workflows', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, [], baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("import { processOrder }");
      expect(handler.content).toContain('// No node types');
    });

    it('should handle bundle with only node types', async () => {
      const artifacts = await target.generateBundle([], bundleNodeTypes, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('// No workflows');
      expect(handler.content).toContain("import { validator }");
    });
  });

  // ── Deploy instructions ──

  describe('getDeployInstructions', () => {
    it('should include SAM CLI prerequisite', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.prerequisites.some((p) => p.includes('SAM CLI'))).toBe(true);
    });

    it('should include AWS CLI prerequisite', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.prerequisites.some((p) => p.includes('AWS CLI'))).toBe(true);
    });

    it('should include local test steps', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.localTestSteps).toBeDefined();
      expect(instructions.localTestSteps!.some((s) => s.includes('127.0.0.1:3000'))).toBe(true);
    });

    it('should include links to AWS docs', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.links).toBeDefined();
      expect(instructions.links!.some((l) => l.url.includes('aws.amazon.com'))).toBe(true);
    });

    it('should include npm install in the steps', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.steps).toContain('npm install');
    });
  });
});
