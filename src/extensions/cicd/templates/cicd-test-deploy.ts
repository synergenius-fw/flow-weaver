/**
 * CI/CD: Test and Deploy template
 *
 * Generates a Flow Weaver workflow for a standard CI/CD pipeline:
 * checkout → setup → install → test → build → deploy
 *
 * Exports to GitHub Actions or GitLab CI via `fw_export`.
 */

import type { WorkflowTemplate, WorkflowTemplateOptions, ConfigSchema } from '../../../cli/templates/index';

const configSchema: ConfigSchema = {
  platform: {
    type: 'select',
    label: 'CI/CD Platform',
    description: 'Target CI/CD platform for export',
    default: 'github-actions',
    options: [
      { value: 'github-actions', label: 'GitHub Actions' },
      { value: 'gitlab-ci', label: 'GitLab CI' },
    ],
  },
  nodeVersion: {
    type: 'string',
    label: 'Node.js Version',
    default: '20',
    description: 'Node.js version for setup-node step',
  },
  deployTarget: {
    type: 'select',
    label: 'Deploy Method',
    default: 'ssh',
    options: [
      { value: 'ssh', label: 'SSH Deploy' },
      { value: 's3', label: 'AWS S3' },
      { value: 'none', label: 'No deploy (test only)' },
    ],
  },
};

export const cicdTestDeployTemplate: WorkflowTemplate = {
  id: 'cicd-test-deploy',
  name: 'CI/CD: Test and Deploy',
  description: 'Standard test-and-deploy pipeline with checkout, setup, test, build, and deploy stages',
  category: 'automation',
  configSchema,

  generate: (opts: WorkflowTemplateOptions): string => {
    const name = opts.workflowName || 'ciPipeline';
    const deployTarget = (opts.config?.deployTarget as string) || 'ssh';
    const hasDeploy = deployTarget !== 'none';

    const deployNodeType = deployTarget === 'ssh' ? 'deploySsh' : 'deployS3';
    const deployNode = hasDeploy
      ? `\n * @node deploy ${deployNodeType} [job: "deploy"] [environment: "production"] [position: 1620 0]`
      : '';
    const deployPath = hasDeploy ? ' -> deploy' : '';
    const deploySecret = deployTarget === 'ssh'
      ? '\n * @secret DEPLOY_KEY - SSH key for deployment'
      : deployTarget === 's3'
        ? '\n * @secret AWS_ACCESS_KEY_ID - AWS access key\n * @secret AWS_SECRET_ACCESS_KEY - AWS secret key'
        : '';
    const deployConnect = deployTarget === 'ssh'
      ? '\n * @connect secret:DEPLOY_KEY -> deploy.sshKey'
      : deployTarget === 's3'
        ? '\n * @connect secret:AWS_ACCESS_KEY_ID -> deploy.accessKey\n * @connect secret:AWS_SECRET_ACCESS_KEY -> deploy.secretKey'
        : '';
    const deployReturns = hasDeploy ? '\n * @returns deployResult [order:3] - Deploy result' : '';
    const deployConnect2 = hasDeploy ? '\n * @connect deploy.result -> Exit.deployResult' : '';

    const deployStub = hasDeploy
      ? deployTarget === 'ssh'
        ? `
/** @flowWeaver nodeType
 * @expression
 * @label Deploy via SSH
 */
function deploySsh(sshKey: string = ''): { result: string } { return { result: 'deployed' }; }
`
        : `
/** @flowWeaver nodeType
 * @expression
 * @label Deploy to S3
 */
function deployS3(accessKey: string = '', secretKey: string = ''): { result: string } { return { result: 'deployed' }; }
`
      : '';

    const stageAnnotations = hasDeploy
      ? ` * @stage test\n * @stage build\n * @stage deploy\n`
      : ` * @stage test\n * @stage build\n`;
    const jobAnnotations = hasDeploy
      ? ` * @job test retry=1\n * @job build timeout="10m"\n * @job deploy allow_failure=false\n`
      : ` * @job test retry=1\n * @job build timeout="10m"\n`;

    return `/** @flowWeaver nodeType
 * @expression
 * @label Checkout code
 */
function checkout(): { repo: string } { return { repo: '.' }; }

/** @flowWeaver nodeType
 * @expression
 * @label Setup Node.js
 */
function setupNode(): { nodeVersion: string } { return { nodeVersion: '20' }; }

/** @flowWeaver nodeType
 * @expression
 * @label Install dependencies
 */
function npmInstall(npmToken: string = ''): { installed: boolean } { return { installed: true }; }

/** @flowWeaver nodeType
 * @expression
 * @label Run tests
 */
function npmTest(): { exitCode: number } { return { exitCode: 0 }; }

/** @flowWeaver nodeType
 * @expression
 * @label Build project
 */
function npmBuild(): { output: string } { return { output: 'dist/' }; }
${deployStub}
/**
 * @flowWeaver workflow
 * @trigger push branches="main"
 * @trigger pull_request branches="main"
 * @runner ubuntu-latest
 * @secret NPM_TOKEN - npm auth token${deploySecret}
 * @cache npm key="package-lock.json"
 *
${stageAnnotations}${jobAnnotations} *
 * @node co checkout [job: "test"] [position: 270 0]
 * @node setup setupNode [job: "test"] [position: 540 0]
 * @node install npmInstall [job: "test"] [position: 810 0]
 * @node test npmTest [job: "test"] [position: 1080 0]
 * @node build npmBuild [job: "build"] [position: 1350 0]${deployNode}
 *
 * @path Start -> co -> setup -> install -> test -> build${deployPath} -> Exit
 * @position Start 0 0
 * @position Exit ${hasDeploy ? '1890' : '1620'} 0
 * @connect secret:NPM_TOKEN -> install.npmToken${deployConnect}
 * @connect build.output -> Exit.buildOutput${deployConnect2}
 *
 * @param execute [order:-1] - Execute
 * @param params [order:0] - Params
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 * @returns buildOutput [order:0] - Build output path${deployReturns}
 */
export async function ${name}(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean; buildOutput: string | null${hasDeploy ? '; deployResult: string | null' : ''} }> {
  // @flow-weaver-body-start
  throw new Error('Compile with: npx flow-weaver compile <this-file>');
  // @flow-weaver-body-end
  return { onSuccess: false, onFailure: true, buildOutput: null${hasDeploy ? ', deployResult: null' : ''} };
}
`;
  },
};
