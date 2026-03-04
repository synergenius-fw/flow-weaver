/**
 * CI/CD: Multi-Environment Deploy template
 *
 * Generates a pipeline with staging → production promotion:
 * test → deploy-staging → deploy-production (with environment protection)
 */

import type { WorkflowTemplate, WorkflowTemplateOptions, ConfigSchema } from '../../../cli/templates/index';

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
  environments: {
    type: 'string',
    label: 'Environments',
    description: 'Comma-separated environment names',
    default: 'staging,production',
  },
};

export const cicdMultiEnvTemplate: WorkflowTemplate = {
  id: 'cicd-multi-env',
  name: 'CI/CD: Multi-Environment',
  description: 'Multi-environment deployment pipeline with staging and production stages',
  category: 'automation',
  configSchema,

  generate: (opts: WorkflowTemplateOptions): string => {
    const name = opts.workflowName || 'multiEnvPipeline';
    const envs = ((opts.config?.environments as string) || 'staging,production')
      .split(',')
      .map((e) => e.trim());

    const envAnnotations = envs
      .map((env) => ` * @environment ${env} url="https://${env}.example.com"`)
      .join('\n');

    let x = 270;
    const nodeAnnotations: string[] = [];
    const pathParts: string[] = ['Start'];

    // Test job
    nodeAnnotations.push(` * @node co checkout [job: "test"] [position: ${x} 0]`);
    pathParts.push('co');
    x += 270;
    nodeAnnotations.push(` * @node test npmTest [job: "test"] [position: ${x} 0]`);
    pathParts.push('test');
    x += 270;
    nodeAnnotations.push(` * @node build npmBuild [job: "build"] [position: ${x} 0]`);
    pathParts.push('build');
    x += 270;

    // Deploy jobs for each environment
    for (const env of envs) {
      const id = `deploy_${env.replace(/[^a-zA-Z0-9]/g, '_')}`;
      nodeAnnotations.push(` * @node ${id} deploySsh [job: "deploy-${env}"] [environment: "${env}"] [position: ${x} 0]`);
      pathParts.push(id);
      x += 270;
    }

    pathParts.push('Exit');

    return `/** @flowWeaver nodeType
 * @expression
 * @label Checkout code
 */
function checkout(): { repo: string } { return { repo: '.' }; }

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

/** @flowWeaver nodeType
 * @expression
 * @label Deploy via SSH
 */
function deploySsh(sshKey: string = ''): { result: string } { return { result: 'deployed' }; }

/**
 * @flowWeaver workflow
 * @trigger push branches="main"
 * @runner ubuntu-latest
 * @secret DEPLOY_KEY - SSH deployment key
${envAnnotations}
 * @cache npm key="package-lock.json"
 * @artifact dist path="dist/" retention=3
 *
${nodeAnnotations.join('\n')}
 *
 * @path ${pathParts.join(' -> ')}
 * @position Start 0 0
 * @position Exit ${x} 0
 * @connect secret:DEPLOY_KEY -> ${`deploy_${envs[0].replace(/[^a-zA-Z0-9]/g, '_')}`}.sshKey
${envs.slice(1).map((env) => ` * @connect secret:DEPLOY_KEY -> deploy_${env.replace(/[^a-zA-Z0-9]/g, '_')}.sshKey`).join('\n')}
 *
 * @param execute [order:-1] - Execute
 * @param params [order:0] - Params
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 * @returns summary [order:0] - Deployment summary
 */
export async function ${name}(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean; summary: string | null }> {
  // @flow-weaver-body-start
  throw new Error('Compile with: npx flow-weaver compile <this-file>');
  // @flow-weaver-body-end
  return { onSuccess: false, onFailure: true, summary: null };
}
`;
  },
};
