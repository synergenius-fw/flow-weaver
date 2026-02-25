/**
 * Vercel export target tests.
 *
 * Covers: generate (basic + docs), generateMultiWorkflow, generateNodeTypeService,
 * generateBundle, deploy instructions, and handler content assertions.
 */

import { describe, it, expect } from 'vitest';
import { VercelTarget } from '../../../src/deployment/targets/vercel.js';
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
  outputDir: '/tmp/vercel-output',
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
  outputDir: '/tmp/vercel-nt-output',
};

const bundleWorkflows: BundleWorkflow[] = [
  {
    name: 'process-order',
    functionName: 'processOrder',
    description: 'Process an order',
    expose: true,
    code: 'export function processOrder() {}',
  },
  {
    name: 'internal-helper',
    functionName: 'internalHelper',
    description: 'Internal helper, not exposed',
    expose: false,
    code: 'export function internalHelper() {}',
  },
];

const bundleNodeTypes: BundleNodeType[] = [
  {
    name: 'Validator',
    functionName: 'validator',
    description: 'Validates input',
    expose: true,
    code: 'export function validator() {}',
    inputs: { value: { dataType: 'ANY' } },
    outputs: { valid: { dataType: 'BOOLEAN' } },
  },
  {
    name: 'Logger',
    functionName: 'logger',
    description: 'Logs data (internal)',
    expose: false,
    code: 'export function logger() {}',
    inputs: { message: { dataType: 'STRING' } },
    outputs: {},
  },
];

// ── Tests ─────────────────────────────────────────────────────────────

describe('VercelTarget', () => {
  const target = new VercelTarget();

  // ── Single workflow generate ──

  describe('generate (basic)', () => {
    it('should produce a handler under api/ using Vercel types', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts');
      expect(handler).toBeDefined();
      expect(handler!.content).toContain('VercelRequest');
      expect(handler!.content).toContain('VercelResponse');
      expect(handler!.content).toContain("import { processOrder } from '../workflow.js'");
    });

    it('should call the workflow function with body params', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain('processOrder(true, params)');
    });

    it('should set default maxDuration to 60', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain('maxDuration: 60');
    });

    it('should reject non-POST with 405', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain("req.method !== 'POST'");
      expect(handler.content).toContain('METHOD_NOT_ALLOWED');
      expect(handler.content).toContain('.status(405)');
    });

    it('should use x-vercel-id for request tracking', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain("req.headers['x-vercel-id']");
    });

    it('should include generated-by header', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain('Generated by Flow Weaver');
    });

    it('should configure runtime in vercel.json', async () => {
      const artifacts = await target.generate(baseOptions);
      const config = artifacts.files.find((f) => f.relativePath === 'vercel.json')!;
      const parsed = JSON.parse(config.content);
      expect(parsed.functions['api/process-order.ts'].memory).toBe(1024);
      expect(parsed.functions['api/process-order.ts'].maxDuration).toBe(60);
    });

    it('should NOT generate docs handlers when includeDocs is false', async () => {
      const artifacts = await target.generate(baseOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'api/openapi.ts');
      const docs = artifacts.files.find((f) => f.relativePath === 'api/docs.ts');
      expect(openapi).toBeUndefined();
      expect(docs).toBeUndefined();
    });

    it('should generate a README', async () => {
      const artifacts = await target.generate(baseOptions);
      const readme = artifacts.files.find((f) => f.relativePath === 'README.md');
      expect(readme).toBeDefined();
      expect(readme!.content).toContain('Vercel');
    });

    it('should generate package.json with @vercel/node', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.devDependencies['@vercel/node']).toBeDefined();
      expect(parsed.scripts.deploy).toBe('vercel deploy');
    });
  });

  describe('generate (with docs)', () => {
    const docsOptions = { ...baseOptions, includeDocs: true };

    it('should generate openapi.ts spec file', async () => {
      const artifacts = await target.generate(docsOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts');
      expect(openapi).toBeDefined();
      expect(openapi!.content).toContain('openApiSpec');
      expect(openapi!.content).toContain('3.0.3');
    });

    it('should generate api/openapi.ts handler', async () => {
      const artifacts = await target.generate(docsOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/openapi.ts');
      expect(handler).toBeDefined();
      expect(handler!.content).toContain("import { openApiSpec } from '../openapi.js'");
    });

    it('should generate api/docs.ts handler with Swagger UI', async () => {
      const artifacts = await target.generate(docsOptions);
      const docs = artifacts.files.find((f) => f.relativePath === 'api/docs.ts');
      expect(docs).toBeDefined();
      expect(docs!.content).toContain('swagger-ui');
      expect(docs!.content).toContain('process-order');
    });

    it('should configure docs handlers in vercel.json', async () => {
      const artifacts = await target.generate(docsOptions);
      const config = artifacts.files.find((f) => f.relativePath === 'vercel.json')!;
      const parsed = JSON.parse(config.content);
      expect(parsed.functions['api/openapi.ts']).toBeDefined();
      expect(parsed.functions['api/docs.ts']).toBeDefined();
      expect(parsed.functions['api/openapi.ts'].maxDuration).toBe(10);
    });
  });

  describe('generate (custom maxDuration)', () => {
    it('should use custom maxDuration from targetOptions', async () => {
      const artifacts = await target.generate({
        ...baseOptions,
        targetOptions: { maxDuration: 300 },
      });
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain('maxDuration: 300');
    });
  });

  // ── Multi-workflow ──

  describe('generateMultiWorkflow', () => {
    it('should use catch-all route handler [workflow].ts', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts');
      expect(handler).toBeDefined();
    });

    it('should import workflows from ../workflows/ directory', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts')!;
      expect(handler.content).toContain(
        "import { validateInput } from '../workflows/validate-input.js'"
      );
      expect(handler.content).toContain(
        "import { sendEmail } from '../workflows/send-email.js'"
      );
    });

    it('should map workflows to function handlers', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts')!;
      expect(handler.content).toContain("'validate-input': validateInput");
      expect(handler.content).toContain("'send-email': sendEmail");
    });

    it('should handle special routes: openapi.json, docs, functions', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts')!;
      expect(handler.content).toContain("workflowName === 'openapi.json'");
      expect(handler.content).toContain("workflowName === 'docs'");
      expect(handler.content).toContain("workflowName === 'functions'");
    });

    it('should import function registry', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts')!;
      expect(handler.content).toContain("import { functionRegistry } from '../runtime/function-registry.js'");
    });

    it('should generate consolidated OpenAPI spec', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('validate-input');
      expect(openapi.content).toContain('send-email');
    });

    it('should produce workflow content files', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const wfFiles = artifacts.files.filter((f) => f.relativePath.startsWith('workflows/'));
      expect(wfFiles.length).toBe(2);
    });

    it('should configure vercel.json for catch-all handler', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const config = artifacts.files.find((f) => f.relativePath === 'vercel.json')!;
      const parsed = JSON.parse(config.content);
      expect(parsed.functions['api/[workflow].ts']).toBeDefined();
    });

    it('should return workflowNames in artifacts', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      expect(artifacts.workflowNames).toEqual(['validate-input', 'send-email']);
      expect(artifacts.entryPoint).toBe('api/[workflow].ts');
    });

    it('should support custom maxDuration for multi-workflow', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, {
        ...baseOptions,
        targetOptions: { maxDuration: 120 },
      });
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts')!;
      expect(handler.content).toContain('maxDuration: 120');
    });
  });

  // ── Node type service ──

  describe('generateNodeTypeService', () => {
    it('should use catch-all route handler [nodeType].ts', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[nodeType].ts');
      expect(handler).toBeDefined();
    });

    it('should import node types with lowercase paths from ../node-types/', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[nodeType].ts')!;
      expect(handler.content).toContain(
        "import { fetchData } from '../node-types/fetchdata.js'"
      );
      expect(handler.content).toContain(
        "import { transformData } from '../node-types/transformdata.js'"
      );
    });

    it('should map node type names to handlers', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[nodeType].ts')!;
      expect(handler.content).toContain("'FetchData': fetchData");
      expect(handler.content).toContain("'TransformData': transformData");
    });

    it('should handle openapi.json and docs special routes', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[nodeType].ts')!;
      expect(handler.content).toContain("nodeTypeName === 'openapi.json'");
      expect(handler.content).toContain("nodeTypeName === 'docs'");
    });

    it('should generate OpenAPI spec for node types', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('/api/FetchData');
      expect(openapi.content).toContain('/api/TransformData');
    });

    it('should return 404 for unknown node types', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[nodeType].ts')!;
      expect(handler.content).toContain('not found');
      expect(handler.content).toContain('availableNodeTypes');
    });

    it('should generate node-type content files', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const ntFiles = artifacts.files.filter((f) => f.relativePath.startsWith('node-types/'));
      expect(ntFiles.length).toBe(2);
      expect(ntFiles.map((f) => f.relativePath)).toContain('node-types/fetchdata.ts');
    });

    it('should set nodeTypeNames in result', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      expect(artifacts.nodeTypeNames).toEqual(['FetchData', 'TransformData']);
      expect(artifacts.entryPoint).toBe('api/[nodeType].ts');
    });
  });

  // ── Bundle ──

  describe('generateBundle', () => {
    it('should use [...path].ts catch-all handler', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts');
      expect(handler).toBeDefined();
    });

    it('should import all workflows and node types with code', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain(
        "import { processOrder } from '../workflows/process-order.js'"
      );
      expect(handler.content).toContain(
        "import { internalHelper } from '../workflows/internal-helper.js'"
      );
      expect(handler.content).toContain(
        "import { validator } from '../node-types/validator.js'"
      );
    });

    it('should only expose flagged items', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain("'process-order': processOrder");
      expect(handler.content).toContain("'Validator': validator");
      // Not exposed
      expect(handler.content).not.toContain("'internal-helper': internalHelper");
      expect(handler.content).not.toContain("'Logger': logger");
    });

    it('should route workflows via pathParts[1] === workflows', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain("pathParts[1] === 'workflows'");
      expect(handler.content).toContain("pathParts[1] === 'nodes'");
    });

    it('should handle special routes: openapi.json, docs, functions', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain("pathParts[1] === 'openapi.json'");
      expect(handler.content).toContain("pathParts[1] === 'docs'");
      expect(handler.content).toContain("pathParts[1] === 'functions'");
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
      expect(openapi.content).not.toContain('/api/nodes/Logger');
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

    it('should generate workflow and node-type content files', async () => {
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

    it('should return correct metadata', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      expect(artifacts.target).toBe('vercel');
      expect(artifacts.entryPoint).toBe('api/[...path].ts');
      expect(artifacts.workflowNames).toEqual(['process-order', 'internal-helper']);
      expect(artifacts.nodeTypeNames).toEqual(['Validator', 'Logger']);
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
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain('shared as shared_nodeType');
      expect(handler.content).toContain("'SharedNT': shared_nodeType");
    });

    it('should handle empty workflows and node types', async () => {
      const artifacts = await target.generateBundle([], [], baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain('// No workflows');
      expect(handler.content).toContain('// No node types');
    });

    it('should use custom maxDuration from targetOptions', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        { ...baseOptions, targetOptions: { maxDuration: 180 } }
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain('maxDuration: 180');
    });

    it('should configure vercel.json for catch-all handler', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const config = artifacts.files.find((f) => f.relativePath === 'vercel.json')!;
      const parsed = JSON.parse(config.content);
      expect(parsed.functions['api/[...path].ts']).toBeDefined();
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

    it('should use custom description when provided', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.description).toBe('Processes incoming orders');
    });

    it('should use default description when none provided', async () => {
      const opts = { ...baseOptions, description: undefined };
      const artifacts = await target.generate(opts);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.description).toContain('Flow Weaver workflow');
    });

    it('should include dev and deploy scripts', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.scripts.dev).toBe('vercel dev');
      expect(parsed.scripts.deploy).toBe('vercel deploy');
    });
  });

  // ── Handler error handling ──

  describe('handler error handling', () => {
    it('should return 500 with EXECUTION_ERROR on failure', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain('EXECUTION_ERROR');
      expect(handler.content).toContain('error instanceof Error');
      expect(handler.content).toContain('.status(500)');
    });

    it('should track execution time in response', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain('Date.now()');
      expect(handler.content).toContain('X-Execution-Time');
      expect(handler.content).toContain('executionTime');
    });

    it('should include X-Request-Id in response headers', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain("setHeader('X-Request-Id'");
    });

    it('should return 404 for unknown workflows in multi-workflow handler', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts')!;
      expect(handler.content).toContain('not found');
      expect(handler.content).toContain('availableWorkflows');
      expect(handler.content).toContain('.status(404)');
    });

    it('should return 405 for non-POST in multi-workflow handler', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts')!;
      expect(handler.content).toContain('METHOD_NOT_ALLOWED');
      expect(handler.content).toContain('.status(405)');
    });

    it('should return 404 and 405 in bundle handler', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, bundleNodeTypes, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain('.status(404)');
      expect(handler.content).toContain('.status(405)');
      expect(handler.content).toContain('.status(500)');
    });
  });

  // ── OpenAPI spec structure ──

  describe('OpenAPI spec structure', () => {
    it('should generate valid OpenAPI 3.0.3 spec in docs mode', async () => {
      const artifacts = await target.generate({ ...baseOptions, includeDocs: true });
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('"openapi": "3.0.3"');
      expect(openapi.content).toContain(`${baseOptions.displayName} API`);
    });

    it('should set Vercel API routes as server URL', async () => {
      const artifacts = await target.generate({ ...baseOptions, includeDocs: true });
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('Vercel API routes');
    });

    it('should include node type input/output schemas, excluding STEP ports', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('"url"');
      expect(openapi.content).toContain('"string"');
      expect(openapi.content).not.toContain('"execute"');
      expect(openapi.content).not.toContain('"onSuccess"');
    });

    it('should include multi-workflow service description in OpenAPI spec', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('Multi-workflow service with 2 workflows');
    });

    it('should include functions endpoint in multi-workflow OpenAPI spec', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('/api/functions');
    });

    it('should include bundle description with exposed counts in OpenAPI spec', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, bundleNodeTypes, baseOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('1 workflow');
      expect(openapi.content).toContain('1 node type');
    });

    it('should set baseUrl to /api for multi-workflow OpenAPI', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('"/api"');
    });
  });

  // ── Workflow and node type content files ──

  describe('content file generation', () => {
    it('should include actual code in workflow content files', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const wf = artifacts.files.find((f) => f.relativePath === 'workflows/validate-input.ts')!;
      expect(wf.content).toBe('export function validateInput() {}');
      expect(wf.type).toBe('workflow');
    });

    it('should skip workflows without code', async () => {
      const mixed: CompiledWorkflow[] = [
        { name: 'has-code', functionName: 'hasCode', code: 'export function hasCode() {}' },
        { name: 'no-code', functionName: 'noCode' },
      ];
      const artifacts = await target.generateMultiWorkflow(mixed, baseOptions);
      const wfFiles = artifacts.files.filter((f) => f.relativePath.startsWith('workflows/'));
      expect(wfFiles.length).toBe(1);
      expect(wfFiles[0].relativePath).toBe('workflows/has-code.ts');
    });

    it('should skip node types without code', async () => {
      const mixed: NodeTypeInfo[] = [
        { name: 'WithCode', functionName: 'withCode', inputs: {}, outputs: {}, code: 'export function withCode() {}' },
        { name: 'NoCode', functionName: 'noCode', inputs: {}, outputs: {} },
      ];
      const artifacts = await target.generateNodeTypeService(mixed, nodeTypeExportOptions);
      const ntFiles = artifacts.files.filter((f) => f.relativePath.startsWith('node-types/'));
      expect(ntFiles.length).toBe(1);
    });

    it('should include code in node type content files', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const nt = artifacts.files.find((f) => f.relativePath === 'node-types/fetchdata.ts')!;
      expect(nt.content).toBe('export function fetchData() {}');
      expect(nt.type).toBe('nodeType');
    });
  });

  // ── File absolute paths ──

  describe('file paths', () => {
    it('should set absolute paths based on outputDir', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.absolutePath).toBe('/tmp/vercel-output/api/process-order.ts');
    });

    it('should set absolute paths for nested workflow files', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const wf = artifacts.files.find((f) => f.relativePath === 'workflows/validate-input.ts')!;
      expect(wf.absolutePath).toBe('/tmp/vercel-output/workflows/validate-input.ts');
    });
  });

  // ── Bundle runtime and edge cases ──

  describe('bundle runtime files', () => {
    it('should generate function registry with metadata', async () => {
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

  describe('bundle with partial content', () => {
    it('should handle only workflows in a bundle', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, [], baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain("import { processOrder }");
      expect(handler.content).toContain('// No node types');
    });

    it('should handle only node types in a bundle', async () => {
      const artifacts = await target.generateBundle([], bundleNodeTypes, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain('// No workflows');
      expect(handler.content).toContain("import { validator }");
    });

    it('should handle items with no code', async () => {
      const noCode: BundleWorkflow[] = [
        { name: 'empty', functionName: 'empty', expose: true },
      ];
      const artifacts = await target.generateBundle(noCode, [], baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain('// No workflows');
    });

    it('should skip npm node types from content file generation', async () => {
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
  });

  // ── Vercel-specific handler config ──

  describe('Vercel handler config', () => {
    it('should set runtime to nodejs20.x in single workflow handler', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/process-order.ts')!;
      expect(handler.content).toContain("runtime: 'nodejs20.x'");
    });

    it('should set runtime in multi-workflow handler', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[workflow].ts')!;
      expect(handler.content).toContain("runtime: 'nodejs20.x'");
    });

    it('should set runtime in node type handler', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[nodeType].ts')!;
      expect(handler.content).toContain("runtime: 'nodejs20.x'");
    });

    it('should set runtime in bundle handler', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, bundleNodeTypes, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'api/[...path].ts')!;
      expect(handler.content).toContain("runtime: 'nodejs20.x'");
    });

    it('should configure vercel.json memory for multi-workflow', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const config = artifacts.files.find((f) => f.relativePath === 'vercel.json')!;
      const parsed = JSON.parse(config.content);
      expect(parsed.functions['api/[workflow].ts'].memory).toBe(1024);
    });

    it('should configure vercel.json memory for node type service', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const config = artifacts.files.find((f) => f.relativePath === 'vercel.json')!;
      const parsed = JSON.parse(config.content);
      expect(parsed.functions['api/[nodeType].ts'].memory).toBe(1024);
    });

    it('should propagate maxDuration to vercel.json in custom config', async () => {
      const artifacts = await target.generate({
        ...baseOptions,
        targetOptions: { maxDuration: 300 },
      });
      const config = artifacts.files.find((f) => f.relativePath === 'vercel.json')!;
      const parsed = JSON.parse(config.content);
      expect(parsed.functions['api/process-order.ts'].maxDuration).toBe(300);
    });
  });

  // ── Deploy instructions ──

  describe('getDeployInstructions', () => {
    it('should include Vercel CLI prerequisite', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.prerequisites.some((p) => p.includes('Vercel CLI'))).toBe(true);
    });

    it('should include local test steps with port 3000', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.localTestSteps).toBeDefined();
      expect(instructions.localTestSteps!.some((s) => s.includes('3000'))).toBe(true);
    });

    it('should include vercel deploy as a step', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.steps).toContain('vercel deploy');
    });

    it('should include npm install in the steps', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.steps).toContain('npm install');
    });

    it('should include links to Vercel docs', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.links).toBeDefined();
      expect(instructions.links!.some((l) => l.url.includes('vercel.com'))).toBe(true);
    });

    it('should include Vercel account prerequisite', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.prerequisites.some((p) => p.includes('Vercel account'))).toBe(true);
    });
  });
});
