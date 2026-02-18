/**
 * Tests for export targets
 */

import { describe, it, expect } from 'vitest';
import { LambdaTarget } from '../../../src/deployment/targets/lambda';
import { VercelTarget } from '../../../src/deployment/targets/vercel';
import { CloudflareTarget } from '../../../src/deployment/targets/cloudflare';
import { InngestTarget } from '../../../src/deployment/targets/inngest';
import {
  ExportTargetRegistry,
  type ExportOptions,
  type BundleNodeType,
} from '../../../src/deployment/targets/base';

const baseOptions: ExportOptions = {
  sourceFile: '/path/to/workflow.ts',
  workflowName: 'myWorkflow',
  displayName: 'myWorkflow',
  outputDir: '/output',
  description: 'Test workflow',
};

describe('LambdaTarget', () => {
  const target = new LambdaTarget();

  it('should have correct name and description', () => {
    expect(target.name).toBe('lambda');
    expect(target.description).toContain('Lambda');
  });

  it('should generate handler file', async () => {
    const artifacts = await target.generate(baseOptions);

    const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts');
    expect(handler).toBeDefined();
    expect(handler?.content).toContain('APIGatewayProxyEventV2');
    expect(handler?.content).toContain('myWorkflow');
    expect(handler?.type).toBe('handler');
  });

  it('should generate SAM template', async () => {
    const artifacts = await target.generate(baseOptions);

    const template = artifacts.files.find((f) => f.relativePath === 'template.yaml');
    expect(template).toBeDefined();
    expect(template?.content).toContain('AWS::Serverless::Function');
    expect(template?.content).toContain('myWorkflow');
    expect(template?.type).toBe('config');
  });

  it('should generate package.json', async () => {
    const artifacts = await target.generate(baseOptions);

    const pkg = artifacts.files.find((f) => f.relativePath === 'package.json');
    expect(pkg).toBeDefined();

    const parsed = JSON.parse(pkg!.content);
    expect(parsed.name).toBe('fw-myWorkflow');
    expect(parsed.devDependencies['@types/aws-lambda']).toBeDefined();
    expect(pkg?.type).toBe('package');
  });

  it('should generate tsconfig.json', async () => {
    const artifacts = await target.generate(baseOptions);

    const tsconfig = artifacts.files.find((f) => f.relativePath === 'tsconfig.json');
    expect(tsconfig).toBeDefined();

    const parsed = JSON.parse(tsconfig!.content);
    expect(parsed.compilerOptions.target).toBe('ES2022');
    expect(tsconfig?.type).toBe('config');
  });

  it('should return correct entry point', async () => {
    const artifacts = await target.generate(baseOptions);

    expect(artifacts.entryPoint).toBe('handler.ts');
    expect(artifacts.target).toBe('lambda');
    expect(artifacts.workflowName).toBe('myWorkflow');
  });

  it('should provide deploy instructions', async () => {
    const artifacts = await target.generate(baseOptions);
    const instructions = target.getDeployInstructions(artifacts);

    expect(instructions.title).toContain('Lambda');
    expect(instructions.prerequisites.length).toBeGreaterThan(0);
    expect(instructions.steps.length).toBeGreaterThan(0);
    expect(instructions.links?.length).toBeGreaterThan(0);
  });

  it('should include npm dependencies in bundle package.json', async () => {
    const npmNodeTypes: BundleNodeType[] = [
      {
        name: 'npm/react-window/areEqual',
        functionName: 'areEqual',
        expose: true,
        inputs: { a: { dataType: 'ANY' }, b: { dataType: 'ANY' } },
        outputs: { result: { dataType: 'BOOLEAN' } },
      },
      {
        name: 'npm/@scope/utils/helper',
        functionName: 'helper',
        expose: true,
        inputs: { value: { dataType: 'ANY' } },
        outputs: { result: { dataType: 'ANY' } },
      },
      {
        name: 'localNodeType',
        functionName: 'localNodeType',
        expose: true,
        code: 'export function localNodeType() {}',
        inputs: { execute: { dataType: 'STEP' } },
        outputs: { onSuccess: { dataType: 'STEP' } },
      },
    ];

    const artifacts = await target.generateBundle([], npmNodeTypes, {
      ...baseOptions,
      displayName: 'test-npm-deps',
    });

    const pkg = artifacts.files.find((f) => f.relativePath === 'package.json');
    expect(pkg).toBeDefined();

    const parsed = JSON.parse(pkg!.content);
    expect(parsed.dependencies['react-window']).toBe('*');
    expect(parsed.dependencies['@scope/utils']).toBe('*');
    // Local node types should NOT appear in dependencies
    expect(parsed.dependencies['localNodeType']).toBeUndefined();
  });
});

describe('VercelTarget', () => {
  const target = new VercelTarget();

  it('should have correct name and description', () => {
    expect(target.name).toBe('vercel');
    expect(target.description).toContain('Vercel');
  });

  it('should generate handler under api/ directory', async () => {
    const artifacts = await target.generate(baseOptions);

    const handler = artifacts.files.find((f) => f.relativePath === 'api/myWorkflow.ts');
    expect(handler).toBeDefined();
    expect(handler?.content).toContain('VercelRequest');
    expect(handler?.content).toContain('VercelResponse');
    expect(handler?.content).toContain('myWorkflow');
  });

  it('should generate vercel.json', async () => {
    const artifacts = await target.generate(baseOptions);

    const config = artifacts.files.find((f) => f.relativePath === 'vercel.json');
    expect(config).toBeDefined();

    const parsed = JSON.parse(config!.content);
    expect(parsed.functions).toBeDefined();
    expect(parsed.functions['api/myWorkflow.ts']).toBeDefined();
  });

  it('should support custom maxDuration', async () => {
    const artifacts = await target.generate({
      ...baseOptions,
      targetOptions: { maxDuration: 120 },
    });

    const handler = artifacts.files.find((f) => f.relativePath === 'api/myWorkflow.ts');
    expect(handler?.content).toContain('maxDuration: 120');
  });

  it('should return correct entry point', async () => {
    const artifacts = await target.generate(baseOptions);

    expect(artifacts.entryPoint).toBe('api/myWorkflow.ts');
    expect(artifacts.target).toBe('vercel');
  });

  it('should provide deploy instructions', async () => {
    const artifacts = await target.generate(baseOptions);
    const instructions = target.getDeployInstructions(artifacts);

    expect(instructions.title).toContain('Vercel');
    expect(instructions.prerequisites.some((p) => p.includes('Vercel CLI'))).toBe(true);
  });
});

describe('CloudflareTarget', () => {
  const target = new CloudflareTarget();

  it('should have correct name and description', () => {
    expect(target.name).toBe('cloudflare');
    expect(target.description).toContain('Cloudflare');
  });

  it('should generate index.ts handler', async () => {
    const artifacts = await target.generate(baseOptions);

    const handler = artifacts.files.find((f) => f.relativePath === 'index.ts');
    expect(handler).toBeDefined();
    expect(handler?.content).toContain('fetch');
    expect(handler?.content).toContain('Request');
    expect(handler?.content).toContain('Response');
    expect(handler?.content).toContain('myWorkflow');
  });

  it('should generate wrangler.toml', async () => {
    const artifacts = await target.generate(baseOptions);

    const config = artifacts.files.find((f) => f.relativePath === 'wrangler.toml');
    expect(config).toBeDefined();
    expect(config?.content).toContain('name = "myWorkflow"');
    expect(config?.content).toContain('main = "dist/index.js"');
  });

  it('should generate package.json with wrangler', async () => {
    const artifacts = await target.generate(baseOptions);

    const pkg = artifacts.files.find((f) => f.relativePath === 'package.json');
    expect(pkg).toBeDefined();

    const parsed = JSON.parse(pkg!.content);
    expect(parsed.devDependencies.wrangler).toBeDefined();
    expect(parsed.devDependencies['@cloudflare/workers-types']).toBeDefined();
    expect(parsed.scripts.deploy).toBe('wrangler deploy');
  });

  it('should generate tsconfig with Cloudflare types', async () => {
    const artifacts = await target.generate(baseOptions);

    const tsconfig = artifacts.files.find((f) => f.relativePath === 'tsconfig.json');
    const parsed = JSON.parse(tsconfig!.content);

    expect(parsed.compilerOptions.types).toContain('@cloudflare/workers-types');
    expect(parsed.compilerOptions.moduleResolution).toBe('Bundler');
  });

  it('should return correct entry point', async () => {
    const artifacts = await target.generate(baseOptions);

    expect(artifacts.entryPoint).toBe('index.ts');
    expect(artifacts.target).toBe('cloudflare');
  });

  it('should provide deploy instructions', async () => {
    const artifacts = await target.generate(baseOptions);
    const instructions = target.getDeployInstructions(artifacts);

    expect(instructions.title).toContain('Cloudflare');
    expect(instructions.prerequisites.some((p) => p.includes('Wrangler'))).toBe(true);
  });
});

describe('InngestTarget', () => {
  const target = new InngestTarget();

  it('should have correct name and description', () => {
    expect(target.name).toBe('inngest');
    expect(target.description).toContain('Inngest');
  });

  it('should generate handler file with Inngest patterns', async () => {
    const artifacts = await target.generate(baseOptions);

    const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts');
    expect(handler).toBeDefined();
    expect(handler?.content).toContain('Inngest');
    expect(handler?.content).toContain('createFunction');
    expect(handler?.content).toContain('step.run');
    expect(handler?.content).toContain('myWorkflow');
    expect(handler?.type).toBe('handler');
  });

  it('should generate package.json with inngest dependency', async () => {
    const artifacts = await target.generate(baseOptions);

    const pkg = artifacts.files.find((f) => f.relativePath === 'package.json');
    expect(pkg).toBeDefined();

    const parsed = JSON.parse(pkg!.content);
    expect(parsed.name).toBe('fw-myWorkflow');
    expect(parsed.dependencies.inngest).toBeDefined();
    expect(pkg?.type).toBe('package');
  });

  it('should generate tsconfig.json', async () => {
    const artifacts = await target.generate(baseOptions);

    const tsconfig = artifacts.files.find((f) => f.relativePath === 'tsconfig.json');
    expect(tsconfig).toBeDefined();

    const parsed = JSON.parse(tsconfig!.content);
    expect(parsed.compilerOptions.target).toBe('ES2022');
    expect(tsconfig?.type).toBe('config');
  });

  it('should return correct entry point', async () => {
    const artifacts = await target.generate(baseOptions);

    expect(artifacts.entryPoint).toBe('handler.ts');
    expect(artifacts.target).toBe('inngest');
    expect(artifacts.workflowName).toBe('myWorkflow');
  });

  it('should provide deploy instructions', async () => {
    const artifacts = await target.generate(baseOptions);
    const instructions = target.getDeployInstructions(artifacts);

    expect(instructions.title).toContain('Inngest');
    expect(instructions.prerequisites.length).toBeGreaterThan(0);
    expect(instructions.steps.length).toBeGreaterThan(0);
    expect(instructions.links?.length).toBeGreaterThan(0);
  });

  it('should generate event-driven function with correct event name', async () => {
    const artifacts = await target.generate(baseOptions);

    const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts');
    expect(handler?.content).toContain('fw/my-workflow.execute');
    expect(handler?.content).toContain("id: 'my-workflow'");
  });

  it('should include express in docs mode', async () => {
    const artifacts = await target.generate({
      ...baseOptions,
      includeDocs: true,
    });

    const pkg = artifacts.files.find((f) => f.relativePath === 'package.json');
    const parsed = JSON.parse(pkg!.content);
    expect(parsed.dependencies.express).toBeDefined();

    const handler = artifacts.files.find((f) => f.relativePath === 'handler.ts');
    expect(handler?.content).toContain('express');
    expect(handler?.content).toContain('/api/docs');
    expect(handler?.content).toContain('/api/openapi.json');
  });

  it('should include npm dependencies in bundle package.json', async () => {
    const npmNodeTypes: BundleNodeType[] = [
      {
        name: 'npm/react-window/areEqual',
        functionName: 'areEqual',
        expose: true,
        inputs: { a: { dataType: 'ANY' }, b: { dataType: 'ANY' } },
        outputs: { result: { dataType: 'BOOLEAN' } },
      },
      {
        name: 'npm/@scope/utils/helper',
        functionName: 'helper',
        expose: true,
        inputs: { value: { dataType: 'ANY' } },
        outputs: { result: { dataType: 'ANY' } },
      },
      {
        name: 'localNodeType',
        functionName: 'localNodeType',
        expose: true,
        code: 'export function localNodeType() {}',
        inputs: { execute: { dataType: 'STEP' } },
        outputs: { onSuccess: { dataType: 'STEP' } },
      },
    ];

    const artifacts = await target.generateBundle([], npmNodeTypes, {
      ...baseOptions,
      displayName: 'test-npm-deps',
    });

    const pkg = artifacts.files.find((f) => f.relativePath === 'package.json');
    expect(pkg).toBeDefined();

    const parsed = JSON.parse(pkg!.content);
    expect(parsed.dependencies['react-window']).toBe('*');
    expect(parsed.dependencies['@scope/utils']).toBe('*');
    expect(parsed.dependencies['localNodeType']).toBeUndefined();
  });
});

describe('ExportTargetRegistry', () => {
  it('should register and retrieve targets', () => {
    const registry = new ExportTargetRegistry();
    const target = new LambdaTarget();

    registry.register(target);

    expect(registry.get('lambda')).toBe(target);
  });

  it('should return undefined for unknown target', () => {
    const registry = new ExportTargetRegistry();

    expect(registry.get('unknown')).toBeUndefined();
  });

  it('should get all registered targets', () => {
    const registry = new ExportTargetRegistry();
    registry.register(new LambdaTarget());
    registry.register(new VercelTarget());
    registry.register(new CloudflareTarget());

    const all = registry.getAll();

    expect(all.length).toBe(3);
  });

  it('should get all target names', () => {
    const registry = new ExportTargetRegistry();
    registry.register(new LambdaTarget());
    registry.register(new VercelTarget());

    const names = registry.getNames();

    expect(names).toContain('lambda');
    expect(names).toContain('vercel');
  });
});
