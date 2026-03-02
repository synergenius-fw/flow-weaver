/**
 * Base CI/CD Export Target
 *
 * Shared logic for generating CI/CD pipeline files (GitHub Actions, GitLab CI).
 * Unlike serverless targets, CI/CD targets produce native YAML that runs without
 * any FW runtime dependency.
 *
 * Key responsibilities:
 * - Build job graph from AST (group nodes by @job, compute dependencies)
 * - Resolve secret wiring (secret: pseudo-node connections → job env vars)
 * - Inject artifact upload/download steps between jobs
 * - Generate SECRETS_SETUP.md documentation
 */

import type {
  TWorkflowAST,
  TNodeInstanceAST,
  TCICDSecret,
  TCICDCache,
  TCICDArtifact,
  TCICDTrigger,
  TCICDService,
  TCICDMatrix,
  TCICDEnvironment,
} from '../../ast/types';
import {
  BaseExportTarget,
  type ExportOptions,
  type ExportArtifacts,
  type DeployInstructions,
  type GeneratedFile,
  type MultiWorkflowArtifacts,
  type CompiledWorkflow,
  type NodeTypeArtifacts,
  type NodeTypeInfo,
  type NodeTypeExportOptions,
  type BundleArtifacts,
  type BundleWorkflow,
  type BundleNodeType,
} from './base.js';

// ---------------------------------------------------------------------------
// CI/CD-Specific Types
// ---------------------------------------------------------------------------

export interface CICDStep {
  /** Node instance ID */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Node type (used for action mapping) */
  nodeType: string;
  /** Environment variables for this step */
  env?: Record<string, string>;
}

export interface CICDJob {
  /** Job identifier (from [job: "name"]) */
  id: string;
  /** Human-readable job name */
  name: string;
  /** Runner label (from @runner or job-level override) */
  runner?: string;
  /** Jobs that must complete before this one */
  needs: string[];
  /** Steps in execution order */
  steps: CICDStep[];
  /** Deployment environment (from [environment: "name"]) */
  environment?: string;
  /** Secret names used by this job */
  secrets: string[];
  /** Matrix strategy */
  matrix?: TCICDMatrix;
  /** Sidecar services */
  services?: TCICDService[];
  /** Cache configuration */
  cache?: TCICDCache;
  /** Artifacts to upload after this job */
  uploadArtifacts?: TCICDArtifact[];
  /** Artifact names to download before this job */
  downloadArtifacts?: string[];
}

// ---------------------------------------------------------------------------
// Node-to-Action Mapping Table
// ---------------------------------------------------------------------------

export interface ActionMapping {
  /** GitHub Actions `uses:` value */
  githubAction?: string;
  /** GitHub Actions `with:` defaults */
  githubWith?: Record<string, string>;
  /** GitLab CI script commands */
  gitlabScript?: string[];
  /** GitLab CI image override */
  gitlabImage?: string;
  /** Human-readable step name */
  label?: string;
}

/**
 * Default mapping from FW node types to CI/CD platform actions.
 * Unknown node types fall back to a TODO placeholder.
 */
export const NODE_ACTION_MAP: Record<string, ActionMapping> = {
  checkout: {
    githubAction: 'actions/checkout@v4',
    gitlabScript: ['echo "Checkout handled by GitLab CI runner"'],
    label: 'Checkout code',
  },
  'setup-node': {
    githubAction: 'actions/setup-node@v4',
    githubWith: { 'node-version': '20' },
    gitlabImage: 'node:20',
    label: 'Setup Node.js',
  },
  'setup-python': {
    githubAction: 'actions/setup-python@v5',
    githubWith: { 'python-version': '3.12' },
    gitlabImage: 'python:3.12',
    label: 'Setup Python',
  },
  'npm-install': {
    githubAction: undefined,
    gitlabScript: ['npm ci'],
    label: 'Install dependencies',
  },
  'npm-test': {
    githubAction: undefined,
    gitlabScript: ['npm test'],
    label: 'Run tests',
  },
  'npm-build': {
    githubAction: undefined,
    gitlabScript: ['npm run build'],
    label: 'Build',
  },
  'docker-build': {
    githubAction: 'docker/build-push-action@v6',
    githubWith: { push: 'false' },
    gitlabScript: ['docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .'],
    label: 'Build Docker image',
  },
  'docker-push': {
    githubAction: 'docker/build-push-action@v6',
    githubWith: { push: 'true' },
    gitlabScript: ['docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA'],
    label: 'Push Docker image',
  },
  'docker-login': {
    githubAction: 'docker/login-action@v3',
    gitlabScript: ['echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin $CI_REGISTRY'],
    label: 'Docker login',
  },
  'shell-command': {
    githubAction: undefined,
    gitlabScript: ['echo "TODO: Add shell command"'],
    label: 'Run command',
  },
  'deploy-ssh': {
    githubAction: undefined,
    gitlabScript: ['echo "TODO: Configure SSH deployment"'],
    label: 'Deploy via SSH',
  },
  'deploy-s3': {
    githubAction: 'aws-actions/configure-aws-credentials@v4',
    gitlabScript: ['aws s3 sync dist/ s3://$S3_BUCKET/'],
    label: 'Deploy to S3',
  },
  'slack-notify': {
    githubAction: 'slackapi/slack-github-action@v1',
    gitlabScript: ['curl -X POST -H "Content-type: application/json" --data "{\"text\":\"Pipeline complete\"}" $SLACK_WEBHOOK_URL'],
    label: 'Send Slack notification',
  },
  'health-check': {
    githubAction: undefined,
    gitlabScript: ['curl --retry 10 --retry-delay 5 --retry-all-errors $HEALTH_CHECK_URL'],
    label: 'Health check',
  },
  'wait-for-url': {
    githubAction: undefined,
    gitlabScript: ['for i in $(seq 1 30); do curl -sf $WAIT_URL && exit 0; sleep 10; done; exit 1'],
    label: 'Wait for URL',
  },
};

// ---------------------------------------------------------------------------
// Base CI/CD Target
// ---------------------------------------------------------------------------

export abstract class BaseCICDTarget extends BaseExportTarget {
  /**
   * CI/CD targets don't compile workflows — they read the AST and generate YAML.
   * The generate() method must be implemented by each platform target.
   */

  // Not used by CI/CD targets (they don't produce serverless handlers)
  async generateMultiWorkflow(
    _workflows: CompiledWorkflow[],
    _options: ExportOptions,
  ): Promise<MultiWorkflowArtifacts> {
    throw new Error('CI/CD targets use generate() with AST, not generateMultiWorkflow()');
  }

  async generateNodeTypeService(
    _nodeTypes: NodeTypeInfo[],
    _options: NodeTypeExportOptions,
  ): Promise<NodeTypeArtifacts> {
    throw new Error('CI/CD targets do not export node types as services');
  }

  async generateBundle(
    _workflows: BundleWorkflow[],
    _nodeTypes: BundleNodeType[],
    _options: ExportOptions,
  ): Promise<BundleArtifacts> {
    throw new Error('CI/CD targets use generate() with AST, not generateBundle()');
  }

  // ---------------------------------------------------------------------------
  // Shared CI/CD Logic
  // ---------------------------------------------------------------------------

  /**
   * Build the job graph from the workflow AST.
   * Groups nodes by their [job: "name"] attribute and computes dependencies
   * from connections between nodes in different jobs.
   */
  protected buildJobGraph(ast: TWorkflowAST): CICDJob[] {
    // Group instances by job
    const jobMap = new Map<string, TNodeInstanceAST[]>();
    const defaultRunner = ast.options?.runner;

    for (const inst of ast.instances) {
      const jobName = inst.job || 'default';
      if (!jobMap.has(jobName)) jobMap.set(jobName, []);
      jobMap.get(jobName)!.push(inst);
    }

    // Build node -> job lookup
    const nodeJob = new Map<string, string>();
    for (const inst of ast.instances) {
      nodeJob.set(inst.id, inst.job || 'default');
    }

    // Build job dependency graph from connections
    const jobDeps = new Map<string, Set<string>>();
    for (const conn of ast.connections) {
      if (conn.from.node.startsWith('secret:')) continue;
      if (conn.from.node === 'Start' || conn.to.node === 'Exit') continue;

      const fromJob = nodeJob.get(conn.from.node);
      const toJob = nodeJob.get(conn.to.node);

      if (fromJob && toJob && fromJob !== toJob) {
        if (!jobDeps.has(toJob)) jobDeps.set(toJob, new Set());
        jobDeps.get(toJob)!.add(fromJob);
      }
    }

    // Convert to CICDJob array
    const jobs: CICDJob[] = [];
    for (const [jobId, instances] of jobMap) {
      // Determine environment from first instance with one
      const environment = instances.find((i) => i.environment)?.environment;

      const steps: CICDStep[] = instances.map((inst) => ({
        id: inst.id,
        name: inst.config?.label || inst.id,
        nodeType: inst.nodeType,
      }));

      const needs = jobDeps.get(jobId)
        ? Array.from(jobDeps.get(jobId)!)
        : [];

      jobs.push({
        id: jobId,
        name: jobId,
        runner: defaultRunner,
        needs,
        steps,
        environment,
        secrets: [],
      });
    }

    // Topologically sort jobs so dependencies come first
    return this.topoSortJobs(jobs);
  }

  /**
   * Topologically sort jobs so that dependencies come first.
   */
  private topoSortJobs(jobs: CICDJob[]): CICDJob[] {
    const jobMap = new Map(jobs.map((j) => [j.id, j]));
    const visited = new Set<string>();
    const sorted: CICDJob[] = [];

    function visit(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      const job = jobMap.get(id);
      if (!job) return;
      for (const dep of job.needs) {
        visit(dep);
      }
      sorted.push(job);
    }

    for (const job of jobs) {
      visit(job.id);
    }

    return sorted;
  }

  /**
   * Map secret:NAME connections to the jobs that need them.
   * Populates job.secrets and step.env for each secret connection.
   */
  protected resolveJobSecrets(
    jobs: CICDJob[],
    ast: TWorkflowAST,
    renderSecretRef: (name: string) => string,
  ): void {
    // Build node -> job lookup
    const nodeJob = new Map<string, string>();
    for (const inst of ast.instances) {
      nodeJob.set(inst.id, inst.job || 'default');
    }

    // Build step lookup
    const stepMap = new Map<string, CICDStep>();
    for (const job of jobs) {
      for (const step of job.steps) {
        stepMap.set(step.id, step);
      }
    }

    // Process secret connections
    for (const conn of ast.connections) {
      if (!conn.from.node.startsWith('secret:')) continue;

      const secretName = conn.from.node.substring(7);
      const targetNode = conn.to.node;
      const targetPort = conn.to.port;
      const jobId = nodeJob.get(targetNode);

      if (!jobId) continue;

      const job = jobs.find((j) => j.id === jobId);
      if (!job) continue;

      // Add secret to job
      if (!job.secrets.includes(secretName)) {
        job.secrets.push(secretName);
      }

      // Add env var to the step
      const step = stepMap.get(targetNode);
      if (step) {
        step.env = step.env || {};
        // Convert port name to env var (e.g., npmToken -> NPM_TOKEN or use secret name directly)
        step.env[targetPort.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '')] =
          renderSecretRef(secretName);
      }
    }
  }

  /**
   * Add artifact upload/download steps between jobs.
   */
  protected injectArtifactSteps(jobs: CICDJob[], artifacts: TCICDArtifact[]): void {
    if (artifacts.length === 0) return;

    // For each job that has dependencies, check if any dependency produces artifacts
    for (const job of jobs) {
      if (job.needs.length === 0) continue;

      // Check if any needed job produces artifacts
      const neededJobs = jobs.filter((j) => job.needs.includes(j.id));
      for (const needed of neededJobs) {
        // Find artifacts that match the producing job
        const jobArtifacts = artifacts.filter(
          (a) => !a.name || needed.steps.some((s) => s.nodeType === a.name),
        );

        if (jobArtifacts.length > 0) {
          needed.uploadArtifacts = (needed.uploadArtifacts || []).concat(jobArtifacts);
          job.downloadArtifacts = (job.downloadArtifacts || []).concat(
            jobArtifacts.map((a) => a.name),
          );
        }
      }
    }
  }

  /**
   * Generate SECRETS_SETUP.md with per-secret setup instructions.
   */
  protected generateSecretsDoc(secrets: TCICDSecret[], platform: string): string {
    if (secrets.length === 0) return '';

    const lines: string[] = [
      '# Secrets Setup Guide',
      '',
      `This workflow requires ${secrets.length} secret(s) to be configured.`,
      '',
    ];

    for (const secret of secrets) {
      lines.push(`## ${secret.name}`);
      if (secret.description) {
        lines.push(`> ${secret.description}`);
      }
      lines.push('');

      if (platform === 'github-actions' || secret.platform === 'all' || secret.platform === 'github' || !secret.platform) {
        lines.push('**GitHub Actions:**');
        lines.push('1. Go to your repository on GitHub');
        lines.push('2. Navigate to Settings > Secrets and variables > Actions');
        lines.push('3. Click "New repository secret"');
        lines.push(`4. Name: \`${secret.name}\``);
        lines.push('5. Paste your secret value and click "Add secret"');
        lines.push('');
      }

      if (platform === 'gitlab-ci' || secret.platform === 'all' || secret.platform === 'gitlab' || !secret.platform) {
        lines.push('**GitLab CI:**');
        lines.push('1. Go to your project on GitLab');
        lines.push('2. Navigate to Settings > CI/CD > Variables');
        lines.push('3. Click "Add variable"');
        lines.push(`4. Key: \`${secret.name}\``);
        lines.push('5. Paste your secret value');
        lines.push('6. Check "Mask variable" and optionally "Protect variable"');
        lines.push('7. Click "Add variable"');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}
