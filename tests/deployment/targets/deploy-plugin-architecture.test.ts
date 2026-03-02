/**
 * Tests for the Export Target Plugin Architecture (Changes 2, 4, 5, 7)
 *
 * Covers:
 * - DeploySchema on all 6 targets (Change 2)
 * - resolveActionMapping() priority: @deploy → NODE_ACTION_MAP → undefined (Change 4)
 * - ExportTargetRegistry lazy factory + getDeploySchemas() (Change 5)
 * - Inngest @deploy config consumption with CLI fallback (Change 7)
 * - createTargetRegistry() lazy factory registration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ExportTargetRegistry,
  type DeploySchema,
  type ExportTarget,
} from '../../../src/deployment/targets/base';
import { LambdaTarget } from '../../../src/deployment/targets/lambda';
import { VercelTarget } from '../../../src/deployment/targets/vercel';
import { CloudflareTarget } from '../../../src/deployment/targets/cloudflare';
import { InngestTarget } from '../../../src/deployment/targets/inngest';
import { GitHubActionsTarget } from '../../../src/deployment/targets/github-actions';
import { GitLabCITarget } from '../../../src/deployment/targets/gitlab-ci';
import { BaseCICDTarget, NODE_ACTION_MAP, type CICDStep } from '../../../src/deployment/targets/cicd-base';
import { createTargetRegistry, getSupportedTargetNames } from '../../../src/deployment/index';

// Temp workflow file for Inngest tests that need durableSteps
const tmpDir = path.join(os.tmpdir(), 'fw-deploy-test');
const tmpWorkflowFile = path.join(tmpDir, 'test-workflow.ts');

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(tmpWorkflowFile, `
/**
 * @flowWeaver workflow
 * @node a doWork [position: 0 0]
 * @path Start -> a -> Exit
 * @param execute - Execute
 * @param params - Params
 * @returns onSuccess - On Success
 * @returns onFailure - On Failure
 */
export async function testWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: false, onFailure: true };
}

/** @flowWeaver nodeType
 * @expression
 * @label Do Work
 */
function doWork(): {} { return {}; }
`);
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Change 2: DeploySchema on all 6 targets
// ---------------------------------------------------------------------------

describe('DeploySchema on targets', () => {
  it('Lambda target should declare memory, runtime, timeout', () => {
    const target = new LambdaTarget();
    expect(target.deploySchema).toBeDefined();
    expect(target.deploySchema!.memory.type).toBe('number');
    expect(target.deploySchema!.runtime.type).toBe('string');
    expect(target.deploySchema!.timeout.type).toBe('number');
  });

  it('Vercel target should declare maxDuration, memory, regions', () => {
    const target = new VercelTarget();
    expect(target.deploySchema).toBeDefined();
    expect(target.deploySchema!.maxDuration.type).toBe('number');
    expect(target.deploySchema!.memory.type).toBe('number');
    expect(target.deploySchema!.regions.type).toBe('string[]');
  });

  it('Cloudflare target should declare compatDate', () => {
    const target = new CloudflareTarget();
    expect(target.deploySchema).toBeDefined();
    expect(target.deploySchema!.compatDate.type).toBe('string');
  });

  it('Inngest target should declare durableSteps, framework, serve, retries, triggerEvent', () => {
    const target = new InngestTarget();
    expect(target.deploySchema).toBeDefined();
    expect(target.deploySchema!.durableSteps.type).toBe('boolean');
    expect(target.deploySchema!.framework.type).toBe('string');
    expect(target.deploySchema!.serve.type).toBe('boolean');
    expect(target.deploySchema!.retries.type).toBe('number');
    expect(target.deploySchema!.triggerEvent.type).toBe('string');
  });

  it('GitHub Actions target should declare runner and nodeType schemas', () => {
    const target = new GitHubActionsTarget();
    expect(target.deploySchema).toBeDefined();
    expect(target.deploySchema!.runner.type).toBe('string');

    expect(target.nodeTypeDeploySchema).toBeDefined();
    expect(target.nodeTypeDeploySchema!.action.type).toBe('string');
    expect(target.nodeTypeDeploySchema!.with.type).toBe('string');
    expect(target.nodeTypeDeploySchema!.label.type).toBe('string');
  });

  it('GitLab CI target should declare runner and nodeType schemas', () => {
    const target = new GitLabCITarget();
    expect(target.deploySchema).toBeDefined();
    expect(target.deploySchema!.runner.type).toBe('string');

    expect(target.nodeTypeDeploySchema).toBeDefined();
    expect(target.nodeTypeDeploySchema!.script.type).toBe('string[]');
    expect(target.nodeTypeDeploySchema!.image.type).toBe('string');
    expect(target.nodeTypeDeploySchema!.label.type).toBe('string');
  });

  it('all deploySchema fields should have descriptions', () => {
    const targets: ExportTarget[] = [
      new LambdaTarget(),
      new VercelTarget(),
      new CloudflareTarget(),
      new InngestTarget(),
      new GitHubActionsTarget(),
      new GitLabCITarget(),
    ];

    for (const target of targets) {
      if (target.deploySchema) {
        for (const [key, field] of Object.entries(target.deploySchema)) {
          expect(field.description, `${target.name}.deploySchema.${key} missing description`).toBeTruthy();
        }
      }
      if (target.nodeTypeDeploySchema) {
        for (const [key, field] of Object.entries(target.nodeTypeDeploySchema)) {
          expect(field.description, `${target.name}.nodeTypeDeploySchema.${key} missing description`).toBeTruthy();
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Change 4: resolveActionMapping()
// ---------------------------------------------------------------------------

describe('resolveActionMapping()', () => {
  // We need to access the protected method — create a test subclass
  class TestCICDTarget extends BaseCICDTarget {
    readonly name = 'test-cicd';
    readonly description = 'Test CI/CD target';

    async generate() {
      return { files: [], target: this.name, workflowName: '', entryPoint: '' };
    }

    getDeployInstructions() {
      return { title: '', steps: [], prerequisites: [] };
    }

    // Expose protected method for testing
    public $resolveActionMapping(step: CICDStep, targetName: string) {
      return this.resolveActionMapping(step, targetName);
    }
  }

  const target = new TestCICDTarget();

  it('should return NODE_ACTION_MAP entry for known node types', () => {
    const step: CICDStep = { id: 'step1', name: 'checkout', nodeType: 'checkout' };
    const result = target.$resolveActionMapping(step, 'github-actions');

    expect(result).toBeDefined();
    expect(result!.githubAction).toBe('actions/checkout@v4');
    expect(result!.label).toBe('Checkout code');
  });

  it('should return undefined for unknown node types without @deploy', () => {
    const step: CICDStep = { id: 'step1', name: 'custom', nodeType: 'my-custom-node' };
    const result = target.$resolveActionMapping(step, 'github-actions');

    expect(result).toBeUndefined();
  });

  it('should prioritize @deploy annotation over NODE_ACTION_MAP', () => {
    const step: CICDStep = {
      id: 'step1',
      name: 'checkout',
      nodeType: 'checkout',
      nodeTypeDeploy: {
        'github-actions': {
          action: 'my-org/custom-checkout@v1',
          label: 'Custom checkout',
        },
      },
    };
    const result = target.$resolveActionMapping(step, 'github-actions');

    expect(result).toBeDefined();
    expect(result!.githubAction).toBe('my-org/custom-checkout@v1');
    expect(result!.label).toBe('Custom checkout');
  });

  it('should use @deploy for one target but fallback for another', () => {
    const step: CICDStep = {
      id: 'step1',
      name: 'checkout',
      nodeType: 'checkout',
      nodeTypeDeploy: {
        'github-actions': {
          action: 'my-org/custom-checkout@v1',
        },
      },
    };

    // GitHub Actions uses @deploy
    const ghResult = target.$resolveActionMapping(step, 'github-actions');
    expect(ghResult!.githubAction).toBe('my-org/custom-checkout@v1');

    // GitLab CI falls back to NODE_ACTION_MAP (no @deploy for gitlab-ci)
    const glResult = target.$resolveActionMapping(step, 'gitlab-ci');
    expect(glResult!.gitlabScript).toEqual(['echo "Checkout handled by GitLab CI runner"']);
  });

  it('should parse @deploy with parameter as JSON string', () => {
    const step: CICDStep = {
      id: 'step1',
      name: 'setup-node',
      nodeType: 'setup-node',
      nodeTypeDeploy: {
        'github-actions': {
          action: 'actions/setup-node@v4',
          with: '{"node-version":"20"}',
        },
      },
    };
    const result = target.$resolveActionMapping(step, 'github-actions');

    expect(result!.githubAction).toBe('actions/setup-node@v4');
    expect(result!.githubWith).toEqual({ 'node-version': '20' });
  });

  it('should handle @deploy gitlab-ci with script as string array', () => {
    const step: CICDStep = {
      id: 'step1',
      name: 'custom',
      nodeType: 'custom',
      nodeTypeDeploy: {
        'gitlab-ci': {
          script: ['npm ci', 'npm test'],
          image: 'node:20',
        },
      },
    };
    const result = target.$resolveActionMapping(step, 'gitlab-ci');

    expect(result!.gitlabScript).toEqual(['npm ci', 'npm test']);
    expect(result!.gitlabImage).toBe('node:20');
  });

  it('should handle @deploy gitlab-ci with script as single string', () => {
    const step: CICDStep = {
      id: 'step1',
      name: 'custom',
      nodeType: 'custom',
      nodeTypeDeploy: {
        'gitlab-ci': {
          script: 'npm test',
        },
      },
    };
    const result = target.$resolveActionMapping(step, 'gitlab-ci');

    expect(result!.gitlabScript).toEqual(['npm test']);
  });

  it('should use step.name as label fallback when @deploy has no label', () => {
    const step: CICDStep = {
      id: 'step1',
      name: 'My Custom Step',
      nodeType: 'custom',
      nodeTypeDeploy: {
        'github-actions': {
          action: 'my-org/action@v1',
        },
      },
    };
    const result = target.$resolveActionMapping(step, 'github-actions');

    expect(result!.label).toBe('My Custom Step');
  });
});

// ---------------------------------------------------------------------------
// Change 5: ExportTargetRegistry lazy factory + getDeploySchemas()
// ---------------------------------------------------------------------------

describe('ExportTargetRegistry lazy factory', () => {
  it('should support register(name, factory) API', () => {
    const registry = new ExportTargetRegistry();
    let instantiated = false;

    registry.register('test', () => {
      instantiated = true;
      return new LambdaTarget();
    });

    expect(instantiated).toBe(false);
    expect(registry.getNames()).toEqual(['test']);
  });

  it('should instantiate target lazily on first get()', () => {
    const registry = new ExportTargetRegistry();
    let count = 0;

    registry.register('lazy', () => {
      count++;
      return new LambdaTarget();
    });

    expect(count).toBe(0);

    const target1 = registry.get('lazy');
    expect(count).toBe(1);
    expect(target1).toBeDefined();

    // Second get() returns cached instance
    const target2 = registry.get('lazy');
    expect(count).toBe(1);
    expect(target2).toBe(target1);
  });

  it('should still support legacy register(target) API', () => {
    const registry = new ExportTargetRegistry();
    const target = new LambdaTarget();

    registry.register(target);

    expect(registry.get('lambda')).toBe(target);
    expect(registry.getNames()).toContain('lambda');
  });

  it('should instantiate all targets on getAll()', () => {
    const registry = new ExportTargetRegistry();
    let count = 0;

    registry.register('a', () => { count++; return new LambdaTarget(); });
    registry.register('b', () => { count++; return new VercelTarget(); });

    expect(count).toBe(0);

    const all = registry.getAll();
    expect(count).toBe(2);
    expect(all.length).toBe(2);
  });

  it('getDeploySchemas() should return schemas from all targets with deploySchema', () => {
    const registry = new ExportTargetRegistry();
    registry.register('lambda', () => new LambdaTarget());
    registry.register('vercel', () => new VercelTarget());
    registry.register('inngest', () => new InngestTarget());

    const schemas = registry.getDeploySchemas();

    expect(schemas.lambda).toBeDefined();
    expect(schemas.lambda.memory.type).toBe('number');
    expect(schemas.vercel).toBeDefined();
    expect(schemas.vercel.maxDuration.type).toBe('number');
    expect(schemas.inngest).toBeDefined();
    expect(schemas.inngest.durableSteps.type).toBe('boolean');
  });

  it('getDeploySchemas() should exclude targets without deploySchema', () => {
    const registry = new ExportTargetRegistry();

    // Create a target with no deploySchema
    const noSchemaTarget: ExportTarget = {
      name: 'no-schema',
      description: 'No schema',
      generate: async () => ({ files: [], target: 'no-schema', workflowName: '', entryPoint: '' }),
      getDeployInstructions: () => ({ title: '', steps: [], prerequisites: [] }),
    };

    registry.register(noSchemaTarget);
    registry.register('lambda', () => new LambdaTarget());

    const schemas = registry.getDeploySchemas();

    expect(schemas['no-schema']).toBeUndefined();
    expect(schemas.lambda).toBeDefined();
  });
});

describe('createTargetRegistry()', () => {
  it('should register all 6 built-in targets', () => {
    const registry = createTargetRegistry();
    const names = registry.getNames();

    expect(names).toContain('lambda');
    expect(names).toContain('vercel');
    expect(names).toContain('cloudflare');
    expect(names).toContain('inngest');
    expect(names).toContain('github-actions');
    expect(names).toContain('gitlab-ci');
    expect(names.length).toBe(6);
  });

  it('should lazily instantiate targets', () => {
    const registry = createTargetRegistry();

    // Getting a specific target should work
    const lambda = registry.get('lambda');
    expect(lambda).toBeDefined();
    expect(lambda!.name).toBe('lambda');

    const gh = registry.get('github-actions');
    expect(gh).toBeDefined();
    expect(gh!.name).toBe('github-actions');
  });

  it('should return undefined for unregistered targets', () => {
    const registry = createTargetRegistry();
    expect(registry.get('firebase')).toBeUndefined();
  });

  it('getSupportedTargetNames() should match registry names', () => {
    const names = getSupportedTargetNames();
    const registry = createTargetRegistry();

    expect(names.sort()).toEqual(registry.getNames().sort());
  });
});

// ---------------------------------------------------------------------------
// Change 7: Inngest @deploy config consumption
// ---------------------------------------------------------------------------

describe('Inngest @deploy config consumption', () => {
  const target = new InngestTarget();

  it('should use durableSteps from @deploy annotation via targetOptions.deploy', async () => {
    const artifacts = await target.generate({
      sourceFile: tmpWorkflowFile,
      workflowName: 'testWorkflow',
      displayName: 'test-workflow',
      outputDir: '/tmp/test',
      targetOptions: {
        deploy: {
          inngest: { durableSteps: true },
        },
      },
    });

    const handler = artifacts.files.find(f => f.relativePath === 'handler.ts');
    expect(handler).toBeDefined();
    // Durable steps mode uses deep generator: createFunction directly from AST
    expect(handler!.content).toContain('createFunction');
    expect(handler!.content).toContain('Inngest');
    // Should import node type functions directly
    expect(handler!.content).toContain('doWork');
  });

  it('should use durableSteps from CLI flag as fallback', async () => {
    const artifacts = await target.generate({
      sourceFile: tmpWorkflowFile,
      workflowName: 'testWorkflow',
      displayName: 'test-workflow',
      outputDir: '/tmp/test',
      targetOptions: {
        durableSteps: true,
      },
    });

    const handler = artifacts.files.find(f => f.relativePath === 'handler.ts');
    expect(handler).toBeDefined();
    // Durable steps mode should produce different output than shallow mode
    expect(handler!.content).toContain('createFunction');
    expect(handler!.content).toContain('doWork');
  });

  it('should default to non-durable (shallow) mode when no @deploy or CLI flag', async () => {
    const artifacts = await target.generate({
      sourceFile: tmpWorkflowFile,
      workflowName: 'testWorkflow',
      displayName: 'test-workflow',
      outputDir: '/tmp/test',
    });

    const handler = artifacts.files.find(f => f.relativePath === 'handler.ts');
    expect(handler).toBeDefined();
    // Shallow mode uses template with step.run('execute-workflow', ...) wrapper
    expect(handler!.content).toContain('step.run');
    expect(handler!.content).toContain("'execute-workflow'");
  });

  it('should produce deep generator output when @deploy inngest durableSteps=true', async () => {
    // Write a workflow with @deploy inngest annotation
    const deployWorkflowFile = path.join(tmpDir, 'deploy-inngest.ts');
    fs.writeFileSync(deployWorkflowFile, `
/**
 * @flowWeaver workflow
 * @deploy inngest durableSteps=true
 * @node a doWork [position: 0 0]
 * @path Start -> a -> Exit
 * @param execute - Execute
 * @param params - Params
 * @returns onSuccess - On Success
 * @returns onFailure - On Failure
 */
export async function deployInngestWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: false, onFailure: true };
}

/** @flowWeaver nodeType
 * @expression
 * @label Do Work
 */
function doWork(): {} { return {}; }
`);

    // Simulate the MCP tool passing @deploy config through targetOptions
    const artifacts = await target.generate({
      sourceFile: deployWorkflowFile,
      workflowName: 'deployInngestWorkflow',
      displayName: 'deploy-inngest-workflow',
      outputDir: '/tmp/test',
      targetOptions: {
        deploy: {
          inngest: { durableSteps: true },
        },
      },
    });

    const handler = artifacts.files.find(f => f.relativePath === 'handler.ts');
    expect(handler).toBeDefined();
    // Deep generator creates Inngest function from AST, importing node types directly
    expect(handler!.content).toContain('createFunction');
    expect(handler!.content).toContain('doWork');
  });
});
