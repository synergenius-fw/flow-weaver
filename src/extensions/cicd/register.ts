/**
 * CI/CD extension self-registration module.
 *
 * Importing this module registers all CI/CD functionality through
 * the existing extension registries: tag handlers, validation rules,
 * documentation topics, init use cases, and scaffold templates.
 *
 * Loaded as a side-effect import from src/extensions/index.ts.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { tagHandlerRegistry } from '../../parser/tag-registry.js';
import { validationRuleRegistry } from '../../api/validation-registry.js';
import { registerPackDocTopics } from '../../docs/index.js';
import { registerPackUseCase } from '../../cli/commands/init-personas.js';
import { registerWorkflowTemplates } from '../../cli/templates/index.js';

import { cicdTagHandler } from './tag-handler.js';
import { isCICDWorkflow } from './detection.js';
import { getCICDValidationRules } from './rules.js';

import { cicdTestDeployTemplate } from './templates/cicd-test-deploy.js';
import { cicdDockerTemplate } from './templates/cicd-docker.js';
import { cicdMultiEnvTemplate } from './templates/cicd-multi-env.js';
import { cicdMatrixTemplate } from './templates/cicd-matrix.js';

// ── Tag handlers ────────────────────────────────────────────────────────────

tagHandlerRegistry.register(
  [
    'secret', 'runner', 'cache', 'artifact', 'environment', 'matrix',
    'service', 'concurrency', 'job', 'stage', 'variables',
    'before_script', 'tags', 'includes', '_cicdTrigger',
  ],
  'cicd',
  'workflow',
  cicdTagHandler,
);

// ── Validation rules ────────────────────────────────────────────────────────

validationRuleRegistry.register({
  name: 'CI/CD Rules',
  namespace: 'cicd',
  detect: isCICDWorkflow,
  getRules: getCICDValidationRules,
});

// ── Documentation ───────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerPackDocTopics([
  {
    slug: 'cicd',
    name: 'CI/CD Pipeline Workflows',
    description: 'Building CI/CD pipelines with Flow Weaver annotations and exporting to GitHub Actions or GitLab CI',
    keywords: ['cicd', 'pipeline', 'github-actions', 'gitlab-ci', 'deploy', 'secret', 'runner'],
    presets: ['authoring', 'full', 'ops'],
    absoluteFile: path.resolve(__dirname, 'docs/cicd.md'),
  },
]);

// ── Init use case ───────────────────────────────────────────────────────────

registerPackUseCase(
  {
    id: 'cicd',
    name: 'CI/CD Pipeline',
    description: 'GitHub Actions, GitLab CI, and deployment workflows',
  },
  ['cicd-test-deploy', 'cicd-docker', 'cicd-multi-env', 'cicd-matrix'],
);

// ── Scaffold templates ──────────────────────────────────────────────────────

registerWorkflowTemplates([
  cicdTestDeployTemplate,
  cicdDockerTemplate,
  cicdMultiEnvTemplate,
  cicdMatrixTemplate,
]);
