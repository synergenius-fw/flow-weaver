/**
 * CI/CD: Matrix Testing template
 *
 * Generates a pipeline with matrix strategy for testing across
 * multiple Node.js versions and/or operating systems.
 */

import type { WorkflowTemplate, WorkflowTemplateOptions, ConfigSchema } from '../index';

const configSchema: ConfigSchema = {
  platform: {
    type: 'select',
    label: 'CI/CD Platform',
    default: 'github-actions',
    options: [
      { value: 'github-actions', label: 'GitHub Actions' },
      { value: 'gitlab-ci', label: 'GitLab CI' },
    ],
  },
  versions: {
    type: 'string',
    label: 'Node.js Versions',
    description: 'Comma-separated versions to test',
    default: '18,20,22',
  },
  operatingSystems: {
    type: 'string',
    label: 'Operating Systems',
    description: 'Comma-separated OS labels',
    default: 'ubuntu-latest',
  },
};

export const cicdMatrixTemplate: WorkflowTemplate = {
  id: 'cicd-matrix',
  name: 'CI/CD: Matrix Testing',
  description: 'Test across multiple Node.js versions and operating systems',
  category: 'automation',
  configSchema,

  generate: (opts: WorkflowTemplateOptions): string => {
    const name = opts.workflowName || 'matrixTest';
    const versions = ((opts.config?.versions as string) || '18,20,22')
      .split(',')
      .map((v) => v.trim());
    const oses = ((opts.config?.operatingSystems as string) || 'ubuntu-latest')
      .split(',')
      .map((o) => o.trim());

    const matrixNode = ` * @matrix node="${versions.join(',')}" os="${oses.join(',')}"`;

    return `/**
 * @flowWeaver workflow
 * @trigger push branches="main"
 * @trigger pull_request branches="main"
 * @runner ubuntu-latest
${matrixNode}
 * @cache npm key="package-lock.json"
 *
 * @node co checkout [job: "test"] [position: 270 0]
 * @node setup setup-node [job: "test"] [position: 540 0]
 * @node install npm-install [job: "test"] [position: 810 0]
 * @node lint shell-command [job: "test"] [position: 1080 0]
 * @node test npm-test [job: "test"] [position: 1350 0]
 *
 * @path Start -> co -> setup -> install -> lint -> test -> Exit
 * @position Start 0 0
 * @position Exit 1620 0
 * @connect test.exitCode -> Exit.testResult
 *
 * @param execute [order:-1] - Execute
 * @param params [order:0] - Params
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 * @returns testResult [order:0] - Test result
 */
export async function ${name}(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean; testResult: string | null }> {
  // @flow-weaver-body-start
  throw new Error('Compile with: npx flow-weaver compile <this-file>');
  // @flow-weaver-body-end
  return { onSuccess: false, onFailure: true, testResult: null };
}
`;
  },
};
