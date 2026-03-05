/**
 * CI/CD: Docker Pipeline template
 *
 * Generates a Flow Weaver workflow for building and pushing Docker images:
 * checkout → docker-login → docker-build → docker-push
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
  registry: {
    type: 'select',
    label: 'Container Registry',
    default: 'ghcr',
    options: [
      { value: 'ghcr', label: 'GitHub Container Registry (ghcr.io)' },
      { value: 'dockerhub', label: 'Docker Hub' },
      { value: 'ecr', label: 'AWS ECR' },
      { value: 'gcr', label: 'Google Container Registry' },
    ],
  },
};

export const cicdDockerTemplate: WorkflowTemplate = {
  id: 'cicd-docker',
  name: 'CI/CD: Docker Pipeline',
  description: 'Build and push Docker images to a container registry',
  category: 'automation',
  configSchema,

  generate: (opts: WorkflowTemplateOptions): string => {
    const name = opts.workflowName || 'dockerPipeline';
    const registry = (opts.config?.registry as string) || 'ghcr';

    const registrySecrets: Record<string, string> = {
      ghcr: ' * @secret GITHUB_TOKEN - GitHub token for ghcr.io',
      dockerhub: ' * @secret DOCKER_USERNAME - Docker Hub username\n * @secret DOCKER_PASSWORD - Docker Hub password',
      ecr: ' * @secret AWS_ACCESS_KEY_ID - AWS access key\n * @secret AWS_SECRET_ACCESS_KEY - AWS secret key',
      gcr: ' * @secret GCR_KEY - Google Cloud service account key',
    };

    const registryConnect: Record<string, string> = {
      ghcr: ' * @connect secret:GITHUB_TOKEN -> login.token',
      dockerhub: ' * @connect secret:DOCKER_USERNAME -> login.username\n * @connect secret:DOCKER_PASSWORD -> login.password',
      ecr: ' * @connect secret:AWS_ACCESS_KEY_ID -> login.accessKey\n * @connect secret:AWS_SECRET_ACCESS_KEY -> login.secretKey',
      gcr: ' * @connect secret:GCR_KEY -> login.serviceAccountKey',
    };

    return `/** @flowWeaver nodeType
 * @expression
 * @label Checkout code
 */
function checkout(): { repo: string } { return { repo: '.' }; }

/** @flowWeaver nodeType
 * @expression
 * @label Docker login
 */
function dockerLogin(${registry === 'dockerhub' ? 'username: string = \'\', password: string = \'\'' : registry === 'ecr' ? 'accessKey: string = \'\', secretKey: string = \'\'' : registry === 'gcr' ? 'serviceAccountKey: string = \'\'' : 'token: string = \'\''}): { loggedIn: boolean } { return { loggedIn: true }; }

/** @flowWeaver nodeType
 * @expression
 * @label Docker build
 */
function dockerBuild(): { imageTag: string } { return { imageTag: 'latest' }; }

/** @flowWeaver nodeType
 * @expression
 * @label Docker push
 */
function dockerPush(): { digest: string } { return { digest: 'sha256:abc123' }; }

/**
 * @flowWeaver workflow
 * @trigger push branches="main" paths="Dockerfile,src/**"
 * @trigger tag pattern="v*"
 * @runner ubuntu-latest
${registrySecrets[registry]}
 *
 * @node co checkout [job: "build"] [position: 270 0]
 * @node login dockerLogin [job: "build"] [position: 540 0]
 * @node build dockerBuild [job: "build"] [position: 810 0]
 * @node push dockerPush [job: "build"] [position: 1080 0]
 *
 * @path Start -> co -> login -> build -> push -> Exit
 * @position Start 0 0
 * @position Exit 1350 0
${registryConnect[registry]}
 * @connect push.digest -> Exit.imageDigest
 *
 * @param execute [order:-1] - Execute
 * @param params [order:0] - Params
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 * @returns imageDigest [order:0] - Docker image digest
 */
export async function ${name}(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean; imageDigest: string | null }> {
  // @flow-weaver-body-start
  throw new Error('Compile with: npx flow-weaver compile <this-file>');
  // @flow-weaver-body-end
  return { onSuccess: false, onFailure: true, imageDigest: null };
}
`;
  },
};
