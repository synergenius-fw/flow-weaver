/**
 * Tests that BaseCICDTarget.buildJobGraph() and resolveActionMapping()
 * produce correct job graphs from real CI/CD template ASTs.
 *
 * Uses a concrete test subclass of BaseCICDTarget since the real targets
 * (github-actions, gitlab-ci) are marketplace packs.
 */

import { describe, it, expect } from 'vitest';
import { parser } from '../../../src/parser';
import { workflowTemplates } from '../../../src/cli/templates/index';
import {
  BaseCICDTarget,
  NODE_ACTION_MAP,
  type CICDJob,
  type CICDStep,
} from '../../../src/deployment/targets/cicd-base';
import type {
  ExportOptions,
  ExportArtifacts,
  DeployInstructions,
} from '../../../src/deployment/targets/base';

/** Minimal concrete subclass to access protected methods */
class TestCICDTarget extends BaseCICDTarget {
  readonly name = 'test-cicd';
  readonly description = 'Test CI/CD target';

  async generate(_options: ExportOptions): Promise<ExportArtifacts> {
    return { files: [], target: this.name, workflowName: '', entryPoint: '' };
  }

  getDeployInstructions(_artifacts: ExportArtifacts): DeployInstructions {
    return { title: '', steps: [], prerequisites: [] };
  }

  /** Expose protected methods for testing */
  public testBuildJobGraph(ast: Parameters<BaseCICDTarget['buildJobGraph']>[0]) {
    return this.buildJobGraph(ast);
  }

  public testResolveActionMapping(
    step: CICDStep,
    targetName: string,
  ) {
    return this.resolveActionMapping(step, targetName);
  }

  public testResolveJobSecrets(
    jobs: CICDJob[],
    ast: Parameters<BaseCICDTarget['resolveJobSecrets']>[1],
    renderSecretRef: (name: string) => string,
  ) {
    return this.resolveJobSecrets(jobs, ast, renderSecretRef);
  }
}

const target = new TestCICDTarget();

describe('CI/CD job graph from templates', () => {
  const CICD_TEMPLATES = ['cicd-test-deploy', 'cicd-docker', 'cicd-matrix', 'cicd-multi-env'];

  for (const templateId of CICD_TEMPLATES) {
    describe(templateId, () => {
      const template = workflowTemplates.find((t) => t.id === templateId)!;
      const code = template.generate({ workflowName: 'testPipeline' });
      const result = parser.parseFromString(code);
      const ast = result.workflows[0];

      it('should build a non-empty job graph', () => {
        const jobs = target.testBuildJobGraph(ast);
        expect(jobs.length).toBeGreaterThan(0);
      });

      it('should have unique job IDs', () => {
        const jobs = target.testBuildJobGraph(ast);
        const ids = jobs.map((j) => j.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('should resolve action mappings for all steps', () => {
        const jobs = target.testBuildJobGraph(ast);
        for (const job of jobs) {
          for (const step of job.steps) {
            const mapping = target.testResolveActionMapping(step, 'github-actions');
            // Every CI/CD template step should map to a known action
            expect(mapping).toBeDefined();
            expect(mapping!.label).toBeDefined();
          }
        }
      });

      it('should have valid job dependency references', () => {
        const jobs = target.testBuildJobGraph(ast);
        const jobIds = new Set(jobs.map((j) => j.id));
        for (const job of jobs) {
          for (const dep of job.needs) {
            expect(jobIds.has(dep)).toBe(true);
          }
        }
      });

      it('should topologically sort jobs (dependencies before dependents)', () => {
        const jobs = target.testBuildJobGraph(ast);
        const seen = new Set<string>();
        for (const job of jobs) {
          for (const dep of job.needs) {
            expect(seen.has(dep)).toBe(true);
          }
          seen.add(job.id);
        }
      });
    });
  }
});

describe('resolveJobSecrets', () => {
  it('should wire secret connections into job.secrets and step.env', () => {
    const template = workflowTemplates.find((t) => t.id === 'cicd-test-deploy')!;
    const code = template.generate({ workflowName: 'testPipeline' });
    const result = parser.parseFromString(code);
    const ast = result.workflows[0];

    const jobs = target.testBuildJobGraph(ast);
    target.testResolveJobSecrets(jobs, ast, (name) => `\${{ secrets.${name} }}`);

    // Check that at least one job has secrets wired
    const jobsWithSecrets = jobs.filter((j) => j.secrets.length > 0);

    // The cicd-test-deploy template declares secrets, so they should be wired
    if (ast.options?.cicd?.secrets && ast.options.cicd.secrets.length > 0) {
      expect(jobsWithSecrets.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveActionMapping camelCase normalization', () => {
  const camelToKebab: [string, string][] = [
    ['checkout', 'checkout'],
    ['setupNode', 'setup-node'],
    ['npmInstall', 'npm-install'],
    ['npmTest', 'npm-test'],
    ['npmBuild', 'npm-build'],
    ['dockerBuild', 'docker-build'],
    ['dockerPush', 'docker-push'],
    ['dockerLogin', 'docker-login'],
    ['shellCommand', 'shell-command'],
    ['deploySsh', 'deploy-ssh'],
    ['deployS3', 'deploy-s3'],
    ['slackNotify', 'slack-notify'],
    ['healthCheck', 'health-check'],
    ['waitForUrl', 'wait-for-url'],
  ];

  for (const [camel, kebab] of camelToKebab) {
    it(`should resolve ${camel} -> ${kebab}`, () => {
      const step: CICDStep = { id: 'test', name: 'Test', nodeType: camel };
      const mapping = target.testResolveActionMapping(step, 'github-actions');
      expect(mapping).toBeDefined();
      expect(mapping).toBe(NODE_ACTION_MAP[kebab]);
    });
  }

  it('should return undefined for unknown node types', () => {
    const step: CICDStep = { id: 'test', name: 'Test', nodeType: 'customProcessor' };
    const mapping = target.testResolveActionMapping(step, 'github-actions');
    expect(mapping).toBeUndefined();
  });

  it('should prefer @deploy annotation over NODE_ACTION_MAP', () => {
    const step: CICDStep = {
      id: 'test',
      name: 'Test',
      nodeType: 'checkout',
      nodeTypeDeploy: {
        'github-actions': {
          action: 'actions/checkout@v5',
          label: 'Custom checkout',
        },
      },
    };
    const mapping = target.testResolveActionMapping(step, 'github-actions');
    expect(mapping?.githubAction).toBe('actions/checkout@v5');
    expect(mapping?.label).toBe('Custom checkout');
  });
});
