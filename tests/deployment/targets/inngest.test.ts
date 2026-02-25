/**
 * Inngest export target tests.
 *
 * Covers: generate (basic + docs), generateMultiWorkflow, generateNodeTypeService,
 * generateBundle, deploy instructions, Inngest ID sanitization, and handler content.
 */

import { describe, it, expect } from 'vitest';
import { InngestTarget } from '../../../src/deployment/targets/inngest.js';
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
  outputDir: '/tmp/inngest-output',
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
  outputDir: '/tmp/inngest-nt-output',
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

describe('InngestTarget', () => {
  const target = new InngestTarget();

  // ── Single workflow generate ──

  describe('generate (basic)', () => {
    it('should create an Inngest function with step.run wrapping', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('inngest.createFunction');
      expect(handler.content).toContain("step.run('execute-workflow'");
      expect(handler.content).toContain('processOrder(true, params)');
    });

    it('should set Inngest client with sanitized service ID', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("id: 'process-order'");
    });

    it('should use event name based on workflow', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("event: 'fw/process-order.execute'");
    });

    it('should import the workflow module', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("import { processOrder } from './workflow.js'");
    });

    it('should export a serve handler', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('export const handler = serve(');
      expect(handler.content).toContain('export default handler');
    });

    it('should not include express or docs routes in basic mode', async () => {
      const artifacts = await target.generate(baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).not.toContain("import express from 'express'");
      expect(handler.content).not.toContain('/api/docs');
    });

    it('should sanitize camelCase names into kebab-case IDs', async () => {
      const artifacts = await target.generate({
        ...baseOptions,
        workflowName: 'myComplexWorkflowName',
        displayName: 'myComplexWorkflowName',
      });
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      // camelCase -> kebab-case conversion
      expect(handler.content).toContain('my-complex-workflow-name');
    });
  });

  describe('generate (with docs)', () => {
    const docsOptions = { ...baseOptions, includeDocs: true };

    it('should include express app with docs routes', async () => {
      const artifacts = await target.generate(docsOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("import express from 'express'");
      expect(handler.content).toContain("app.get('/api/docs'");
      expect(handler.content).toContain("app.get('/api/openapi.json'");
    });

    it('should generate openapi.ts spec file', async () => {
      const artifacts = await target.generate(docsOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts');
      expect(openapi).toBeDefined();
      expect(openapi!.content).toContain('openApiSpec');
    });

    it('should include swagger UI in docs handler', async () => {
      const artifacts = await target.generate(docsOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('swagger-ui');
    });

    it('should export express app as handler in docs mode', async () => {
      const artifacts = await target.generate(docsOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('export const handler = app');
      expect(handler.content).toContain('export default app');
    });

    it('should add express to package.json dependencies', async () => {
      const artifacts = await target.generate(docsOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.dependencies.express).toBeDefined();
      expect(parsed.devDependencies['@types/express']).toBeDefined();
    });

    it('should contain x-inngest-events in the OpenAPI spec', async () => {
      const artifacts = await target.generate(docsOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('x-inngest-events');
      expect(openapi.content).toContain('fw/process-order.execute');
    });
  });

  // ── Multi-workflow ──

  describe('generateMultiWorkflow', () => {
    it('should produce Inngest function definitions for each workflow', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('fn_validateInput');
      expect(handler.content).toContain('fn_sendEmail');
      expect(handler.content).toContain("event: 'fw/validate-input.execute'");
      expect(handler.content).toContain("event: 'fw/send-email.execute'");
    });

    it('should import workflows from ./workflows/ directory', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain(
        "import { validateInput } from './workflows/validate-input.js'"
      );
      expect(handler.content).toContain(
        "import { sendEmail } from './workflows/send-email.js'"
      );
    });

    it('should register all functions with serve()', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('fn_validateInput, fn_sendEmail');
    });

    it('should include direct invocation endpoint for each workflow', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('/api/invoke/:workflowName');
      expect(handler.content).toContain("'validate-input': validateInput");
      expect(handler.content).toContain("'send-email': sendEmail");
    });

    it('should include /api/functions, /api/docs, /api/openapi.json routes', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("app.get('/api/functions'");
      expect(handler.content).toContain("app.get('/api/docs'");
      expect(handler.content).toContain("app.get('/api/openapi.json'");
    });

    it('should generate OpenAPI spec', async () => {
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

    it('should return workflowNames in artifacts', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      expect(artifacts.workflowNames).toEqual(['validate-input', 'send-email']);
      expect(artifacts.entryPoint).toBe('handler.ts');
    });

    it('should import function registry and builtin functions', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("import { functionRegistry } from './runtime/function-registry.js'");
      expect(handler.content).toContain("import './runtime/builtin-functions.js'");
    });

    it('should include express and @types/express in package.json', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.dependencies.express).toBeDefined();
      expect(parsed.dependencies.inngest).toBeDefined();
      expect(parsed.devDependencies['@types/express']).toBeDefined();
    });
  });

  // ── Node type service ──

  describe('generateNodeTypeService', () => {
    it('should create Inngest functions for each node type', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('fn_fetchData');
      expect(handler.content).toContain('fn_transformData');
      expect(handler.content).toContain("event: 'fw/fetch-data.execute'");
      expect(handler.content).toContain("event: 'fw/transform-data.execute'");
    });

    it('should use step.run with execute-node-type label', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("step.run('execute-node-type'");
    });

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

    it('should include direct invocation endpoint for node types', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('/api/nodes/:nodeTypeName');
      expect(handler.content).toContain("'FetchData': fetchData");
      expect(handler.content).toContain("'TransformData': transformData");
    });

    it('should generate OpenAPI spec for node types', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const openapi = artifacts.files.find((f) => f.relativePath === 'openapi.ts')!;
      expect(openapi.content).toContain('/api/FetchData');
      expect(openapi.content).toContain('/api/TransformData');
    });

    it('should generate node type content files', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const ntFiles = artifacts.files.filter((f) => f.relativePath.startsWith('node-types/'));
      expect(ntFiles.length).toBe(2);
    });

    it('should return nodeTypeNames in artifacts', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      expect(artifacts.nodeTypeNames).toEqual(['FetchData', 'TransformData']);
    });
  });

  // ── Bundle ──

  describe('generateBundle', () => {
    it('should create Inngest functions for exposed items only', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      // Exposed items get Inngest functions
      expect(handler.content).toContain('fn_processOrder');
      expect(handler.content).toContain('fn_validator');
      // Non-exposed items should NOT get Inngest function definitions
      expect(handler.content).not.toContain('fn_internalHelper');
      expect(handler.content).not.toContain('fn_logger');
    });

    it('should import all items with code (exposed and non-exposed)', async () => {
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
      expect(handler.content).toContain(
        "import { logger } from './node-types/logger.js'"
      );
    });

    it('should only expose flagged items in direct invocation maps', async () => {
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

    it('should include direct invocation endpoints for workflows and nodes', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("app.post('/api/workflows/:name'");
      expect(handler.content).toContain("app.post('/api/nodes/:name'");
    });

    it('should include /api/functions, /api/docs, /api/openapi.json routes', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("app.get('/api/functions'");
      expect(handler.content).toContain("app.get('/api/docs'");
      expect(handler.content).toContain("app.get('/api/openapi.json'");
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
      expect(handler.content).toContain("'SharedNT': shared_nodeType");
    });

    it('should include npm dependencies in package.json', async () => {
      const npmNodeTypes: BundleNodeType[] = [
        {
          name: 'npm/react-window/areEqual',
          functionName: 'areEqual',
          expose: true,
          inputs: {},
          outputs: {},
        },
        {
          name: 'npm/@scope/utils/helper',
          functionName: 'helper',
          expose: true,
          inputs: {},
          outputs: {},
        },
      ];
      const artifacts = await target.generateBundle([], npmNodeTypes, baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.dependencies['react-window']).toBe('*');
      expect(parsed.dependencies['@scope/utils']).toBe('*');
    });

    it('should handle empty workflows and node types', async () => {
      const artifacts = await target.generateBundle([], [], baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('// No workflows');
      expect(handler.content).toContain('// No node types');
    });

    it('should return correct metadata', async () => {
      const artifacts = await target.generateBundle(
        bundleWorkflows,
        bundleNodeTypes,
        baseOptions
      );
      expect(artifacts.target).toBe('inngest');
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

    it('should include inngest dependency', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.dependencies.inngest).toBeDefined();
    });

    it('should include dev and serve scripts', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.scripts.dev).toContain('inngest-cli');
      expect(parsed.scripts.serve).toContain('tsx handler.ts');
    });

    it('should set main to handler.js', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.main).toBe('handler.js');
    });

    it('should not include express in basic mode', async () => {
      const artifacts = await target.generate(baseOptions);
      const pkg = artifacts.files.find((f) => f.relativePath === 'package.json')!;
      const parsed = JSON.parse(pkg.content);
      expect(parsed.dependencies.express).toBeUndefined();
    });
  });

  // ── Content file generation ──

  describe('content file generation', () => {
    it('should skip workflows without code in multi-workflow', async () => {
      const mixed: CompiledWorkflow[] = [
        { name: 'has-code', functionName: 'hasCode', code: 'export function hasCode() {}' },
        { name: 'no-code', functionName: 'noCode' },
      ];
      const artifacts = await target.generateMultiWorkflow(mixed, baseOptions);
      const wfFiles = artifacts.files.filter((f) => f.relativePath.startsWith('workflows/'));
      expect(wfFiles.length).toBe(1);
    });

    it('should include actual code in workflow content files', async () => {
      const artifacts = await target.generateMultiWorkflow(multiWorkflows, baseOptions);
      const wf = artifacts.files.find((f) => f.relativePath === 'workflows/validate-input.ts')!;
      expect(wf.content).toBe('export function validateInput() {}');
      expect(wf.type).toBe('workflow');
    });

    it('should include actual code in node type content files', async () => {
      const artifacts = await target.generateNodeTypeService(nodeTypes, nodeTypeExportOptions);
      const nt = artifacts.files.find((f) => f.relativePath === 'node-types/fetchdata.ts')!;
      expect(nt.content).toBe('export function fetchData() {}');
      expect(nt.type).toBe('nodeType');
    });
  });

  // ── Bundle runtime files ──

  describe('bundle runtime files', () => {
    it('should generate function registry with metadata', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, bundleNodeTypes, baseOptions);
      const registry = artifacts.files.find((f) => f.relativePath === 'runtime/function-registry.ts')!;
      expect(registry.content).toContain("name: 'process-order'");
      expect(registry.content).toContain("type: 'workflow'");
      expect(registry.content).toContain("name: 'Validator'");
      expect(registry.content).toContain("type: 'nodeType'");
      expect(registry.content).toContain('exposed: true');
      expect(registry.content).toContain('exposed: false');
    });

    it('should generate runtime types module', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, bundleNodeTypes, baseOptions);
      const types = artifacts.files.find((f) => f.relativePath === 'runtime/types.ts')!;
      expect(types.content.length).toBeGreaterThan(0);
    });
  });

  // ── Bundle partial content ──

  describe('bundle with partial content', () => {
    it('should handle only workflows', async () => {
      const artifacts = await target.generateBundle(bundleWorkflows, [], baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain("import { processOrder }");
      expect(handler.content).toContain('// No node types');
    });

    it('should handle only node types', async () => {
      const artifacts = await target.generateBundle([], bundleNodeTypes, baseOptions);
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      expect(handler.content).toContain('// No workflows');
      expect(handler.content).toContain("import { validator }");
    });

    it('should skip npm node types from content file generation', async () => {
      const npmNodeTypes: BundleNodeType[] = [
        { name: 'npm/lodash/get', functionName: 'get', expose: true, inputs: {}, outputs: {} },
        { name: 'Local', functionName: 'local', expose: true, code: 'export function local() {}', inputs: {}, outputs: {} },
      ];
      const artifacts = await target.generateBundle([], npmNodeTypes, baseOptions);
      const ntFiles = artifacts.files.filter((f) => f.relativePath.startsWith('node-types/'));
      expect(ntFiles.length).toBe(1);
      expect(ntFiles[0].relativePath).toBe('node-types/local.ts');
    });
  });

  // ── Inngest ID sanitization edge cases ──

  describe('ID sanitization edge cases', () => {
    it('should handle special characters in workflow names', async () => {
      const artifacts = await target.generate({
        ...baseOptions,
        workflowName: 'my_special$name',
        displayName: 'my_special$name',
      });
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      // Special chars replaced with hyphens
      expect(handler.content).toContain("id: 'my-special-name'");
    });

    it('should handle names starting with numbers', async () => {
      const artifacts = await target.generate({
        ...baseOptions,
        workflowName: '123workflow',
        displayName: '123workflow',
      });
      const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts')!;
      // Function vars get underscore prefix for numbers
      expect(handler.content).toContain('fn__123workflow');
    });
  });

  // ── Deploy instructions ──

  describe('getDeployInstructions', () => {
    it('should mention Inngest in the title', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.title).toContain('Inngest');
    });

    it('should include Inngest CLI in prerequisites', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.prerequisites.some((p) => p.includes('inngest-cli'))).toBe(true);
    });

    it('should include local test steps with dev server info', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.localTestSteps).toBeDefined();
      expect(instructions.localTestSteps!.some((s) => s.includes('8288'))).toBe(true);
    });

    it('should include links to Inngest docs', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.links).toBeDefined();
      expect(instructions.links!.some((l) => l.url.includes('inngest.com'))).toBe(true);
    });

    it('should include Node.js 18+ prerequisite', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.prerequisites.some((p) => p.includes('Node.js'))).toBe(true);
    });

    it('should include npm install in the steps', async () => {
      const artifacts = await target.generate(baseOptions);
      const instructions = target.getDeployInstructions(artifacts);
      expect(instructions.steps).toContain('npm install');
    });
  });
});
