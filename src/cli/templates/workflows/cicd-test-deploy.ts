/**
 * CI/CD: Test and Deploy template
 *
 * Generates a Flow Weaver workflow for a standard CI/CD pipeline:
 * checkout → setup → install → test → build → deploy
 *
 * Exports to GitHub Actions or GitLab CI via `fw_export`.
 */

import type { WorkflowTemplate, WorkflowTemplateOptions, ConfigSchema } from '../index';

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

    const deployNode = hasDeploy
      ? `\n * @node deploy deploy-${deployTarget} [job: "deploy" environment: "production"] [position: 1620 0]`
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

    return `/**
 * @flowWeaver workflow
 * @trigger push branches="main"
 * @trigger pull_request branches="main"
 * @runner ubuntu-latest
 * @secret NPM_TOKEN - npm auth token${deploySecret}
 * @cache npm key="package-lock.json"
 *
 * @node co checkout [job: "test"] [position: 270 0]
 * @node setup setup-node [job: "test"] [position: 540 0]
 * @node install npm-install [job: "test"] [position: 810 0]
 * @node test npm-test [job: "test"] [position: 1080 0]
 * @node build npm-build [job: "build"] [position: 1350 0]${deployNode}
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
