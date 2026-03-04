---
name: CI/CD Pipelines
description: Build GitHub Actions and GitLab CI pipelines with workflow annotations
keywords: [cicd, github-actions, gitlab-ci, pipeline, secret, runner, cache, artifact, environment, matrix, service, concurrency, trigger, job, deploy]
---

# CI/CD Pipelines

Flow Weaver can generate native CI/CD pipeline configurations from annotated TypeScript workflows. The output is platform-native YAML (GitHub Actions or GitLab CI) with no runtime dependency on Flow Weaver. You model your pipeline as a workflow graph, annotate it with CI/CD-specific tags, and export.

```bash
flow-weaver export pipeline.ts --target github-actions --output .github/workflows/
```

The generated YAML maps directly to the target platform's native syntax. Jobs, steps, secrets, caches, services, matrix strategies, and triggers all translate to their platform equivalents.

## Quick Start

```bash
# 1. Scaffold a CI/CD template
flow-weaver scaffold --template cicd-test-deploy --output pipeline.ts

# 2. Validate the pipeline structure
flow-weaver validate pipeline.ts

# 3. Export to GitHub Actions
flow-weaver export pipeline.ts --target github-actions --output .github/workflows/
```

Four CI/CD templates are available: `cicd-test-deploy` (standard test + deploy), `cicd-docker` (build and push container images), `cicd-matrix` (test across Node versions and OSes), and `cicd-multi-env` (staging + production deployment).

---

## CI/CD Annotations

These annotations are placed inside `@flowWeaver workflow` JSDoc blocks alongside the standard `@node`, `@connect`, and `@path` annotations.

### @trigger (CI/CD mode)

Defines when the pipeline runs. When the value is `push`, `pull_request`, `dispatch`, `tag`, or `schedule`, the parser treats it as a CI/CD trigger rather than an Inngest event trigger.

```
@trigger push branches="main,develop"
@trigger pull_request branches="main" types="opened,synchronize"
@trigger tag pattern="v*"
@trigger dispatch
@trigger schedule cron="0 9 * * 1"
```

Attributes: `branches`, `paths`, `paths-ignore`, `types`, `pattern`, `cron`. For `dispatch` triggers, use `input_<name>` attributes to declare workflow_dispatch inputs.

### @secret

Declares a secret the pipeline needs access to. Secrets are wired to node inputs via `@connect secret:NAME -> node.port`.

```
@secret NPM_TOKEN - NPM authentication token
@secret DEPLOY_KEY scope="deploy" platform="github" - SSH deploy key
```

Attributes: `scope` (limits which jobs see it), `platform` (restrict to `github`, `gitlab`, or `all`).

### @runner

Sets the runner or machine image for the pipeline.

```
@runner ubuntu-latest
@runner self-hosted
```

### @cache

Configures dependency caching.

```
@cache npm key="package-lock.json"
@cache npm key="package-lock.json" path="~/.npm"
```

The `strategy` value (first argument) maps to platform-specific cache actions. `key` specifies the cache hash file, `path` overrides the cache directory.

### @artifact

Declares build artifacts passed between jobs.

```
@artifact dist path="dist/" retention=5
@artifact coverage path="coverage/"
```

Attributes: `path` (required, the directory or file to upload), `retention` (days to keep, optional).

### @environment

Configures deployment environments with optional protection rules.

```
@environment production url="https://app.example.com" reviewers=2
@environment staging
```

Attributes: `url` (environment URL shown in GitHub/GitLab), `reviewers` (number of required approvals).

### @matrix

Defines a test matrix for parallel execution across combinations.

```
@matrix node="18,20,22" os="ubuntu-latest,macos-latest"
@matrix include node="22" os="windows-latest"
@matrix exclude node="18" os="macos-latest"
```

Each key-value pair becomes a matrix dimension. Values are comma-separated. Use `include` or `exclude` prefixes to add or remove specific combinations.

### @service

Declares service containers that run alongside pipeline jobs (databases, caches, etc.).

```
@service postgres image="postgres:16" env="POSTGRES_PASSWORD=test" ports="5432:5432"
@service redis image="redis:7" ports="6379:6379"
```

Attributes: `image` (required), `env` (comma-separated `K=V` pairs), `ports` (comma-separated port mappings).

### @concurrency

Controls concurrent pipeline runs.

```
@concurrency deploy cancel-in-progress=true
@concurrency ci-${{ github.ref }}
```

The first argument is the concurrency group name. `cancel-in-progress` cancels queued runs when a new one starts.

### @job

Configures per-job settings. The first argument is the job name (must match a `[job: "name"]` used on `@node` declarations). Remaining arguments are key=value pairs.

```
@job build retry=2 timeout="10m"
@job test-unit coverage='/Coverage: (\d+)%/' reports="junit=test-results.xml"
@job test-e2e allow_failure=true timeout="30m"
@job deploy rules="$CI_COMMIT_BRANCH == main" tags="production" extends=".deploy-base"
@job lint runner="macos-latest"
```

Supported keys:

| Key | Type | Description |
|-----|------|-------------|
| `retry` | number | Maximum retry count on failure |
| `allow_failure` | boolean | Job can fail without failing the pipeline |
| `timeout` | string | Job timeout duration ("5m", "1h", "1h30m") |
| `runner` | string | Runner override for this specific job |
| `tags` | comma-list | Runner selection tags (e.g. "docker,linux") |
| `coverage` | string | Coverage regex pattern (GitLab CI) |
| `reports` | comma-list | Report declarations as type=path (e.g. "junit=results.xml") |
| `rules` | string | Conditional execution rule (e.g. "$CI_COMMIT_BRANCH == main") |
| `extends` | string | GitLab CI template to extend (e.g. ".deploy-base") |
| `before_script` | comma-list | Setup commands before main script |
| `variables` | comma-list | Environment variables as KEY=VALUE pairs |

Multiple `@job` annotations for the same job name are merged. You can split attributes across lines:

```
@job deploy retry=2
@job deploy tags="production"
```

### @stage

Declares pipeline stages for GitLab CI. When present, jobs are grouped into named stages instead of the default one-job-per-stage behavior.

```
@stage test
@stage build
@stage deploy
```

Jobs are assigned to stages by name prefix matching: a job named `test-unit` matches stage `test`, `build-docker` matches stage `build`. Jobs that don't match any stage by prefix are assigned by dependency depth (depth 0 gets the first stage, depth 1 the second, etc.).

Stage ordering follows declaration order.

### @variables

Sets workflow-level environment variables applied to all jobs as defaults. Jobs with explicit variables (via `@job`) are not overwritten.

```
@variables NODE_ENV="production" CI="true"
```

### @before_script

Sets workflow-level setup commands run before each job's main script. Applied as defaults to jobs without their own `before_script`.

```
@before_script "npm ci"
```

### @tags

Sets workflow-level runner tags applied to all jobs as defaults. Jobs with explicit tags (via `@job`) are not overwritten.

```
@tags docker linux
```

In GitHub Actions, tags translate to `runs-on: [self-hosted, tag1, tag2]`. In GitLab CI, they become `tags: [tag1, tag2]`.

### @includes

Declares external configuration files to include (GitLab CI feature). Ignored for GitHub Actions export.

```
@includes local="ci/shared-templates.yml"
@includes template="Auto-DevOps.gitlab-ci.yml"
@includes remote="https://example.com/ci.yml"
@includes project="other-group/other-project" file="ci/shared.yml" ref="main"
```

---

## Wiring Secrets with secret:NAME

Secrets are pseudo-nodes in the connection graph. They don't correspond to real node instances. Instead, `secret:NAME` acts as a source that provides the secret value to a node's input port.

```typescript
/**
 * @flowWeaver workflow
 * @secret NPM_TOKEN - NPM auth token
 * @node publish npmPublish [job: "publish"]
 * @connect secret:NPM_TOKEN -> publish.token
 */
```

This generates the equivalent of:

```yaml
# GitHub Actions
env:
  TOKEN: ${{ secrets.NPM_TOKEN }}

# GitLab CI
variables:
  TOKEN: $NPM_TOKEN
```

The target port name is converted to an environment variable name (camelCase becomes UPPER_SNAKE_CASE). The validation rules `CICD_SECRET_NOT_DECLARED` and `CICD_SECRET_UNUSED` catch mismatches between `@secret` declarations and `@connect secret:NAME` references.

---

## Job Grouping

By default, each node becomes its own job. Use the `[job: "name"]` attribute on `@node` to group nodes into the same job. Nodes with the same job name become sequential steps within that job.

```
@node checkout gitCheckout [job: "test"]
@node setup setupNode [job: "test"]
@node install npmInstall [job: "test"]
@node test npmTest [job: "test"]
@node deploy deploySsh [job: "deploy"]
```

This produces two jobs: `test` (4 steps) and `deploy` (1 step). Job dependencies are inferred from the connection graph between nodes in different jobs.

---

## Node-to-Action Mapping

Common node types map to platform-specific actions automatically:

| Node Type | GitHub Actions | GitLab CI |
|-----------|---------------|-----------|
| `checkout` / `gitCheckout` | `actions/checkout@v4` | `git checkout` |
| `setupNode` | `actions/setup-node@v4` | image selection |
| `npmInstall` | `npm ci` run step | `npm ci` script |
| `npmTest` | `npm test` run step | `npm test` script |
| `npmBuild` | `npm run build` run step | `npm run build` script |

Custom node types generate shell `run:` steps. Use `@deploy github-actions action="custom/action@v1"` to override the mapping for a specific node.

---

## Complete Example

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 */
declare function gitCheckout(): { path: string };

/** @flowWeaver nodeType
 * @expression
 */
declare function setupNode(version: string): { ready: boolean };

/** @flowWeaver nodeType
 * @expression
 */
declare function npmInstall(): { installed: boolean };

/** @flowWeaver nodeType
 * @expression
 */
declare function npmTest(): { passed: boolean };

/** @flowWeaver nodeType
 * @expression
 */
declare function npmBuild(): { output: string };

/** @flowWeaver nodeType
 * @expression
 */
declare function deploySsh(sshKey: string): { result: string };

/**
 * Test and deploy pipeline
 *
 * @flowWeaver workflow
 * @trigger push branches="main"
 * @trigger pull_request branches="main"
 * @runner ubuntu-latest
 * @secret DEPLOY_KEY - SSH key for production deploy
 * @cache npm key="package-lock.json"
 * @artifact dist path="dist/" retention=5
 * @tags docker linux
 * @variables NODE_ENV="production"
 * @before_script "npm ci"
 *
 * @stage test
 * @stage build
 * @stage deploy
 *
 * @job test retry=1 coverage='/Coverage: (\d+)%/' reports="junit=test-results.xml"
 * @job build retry=2 timeout="10m"
 * @job deploy allow_failure=false rules="$CI_COMMIT_BRANCH == main"
 *
 * @node co gitCheckout [job: "test"]
 * @node setup setupNode [job: "test"]
 * @node install npmInstall [job: "test"]
 * @node test npmTest [job: "test"]
 * @node build npmBuild [job: "build"]
 * @node deploy deploySsh [job: "deploy"] [environment: "production"]
 *
 * @path Start -> co -> setup -> install -> test -> Exit
 * @connect install.installed -> build.execute
 * @connect build.output -> deploy.execute
 * @connect secret:DEPLOY_KEY -> deploy.sshKey
 *
 * @param execute - Run the pipeline
 * @returns result - Pipeline result
 */
export function ciPipeline(execute: boolean): { result: string } {
  throw new Error('stub');
}
```

Export:

```bash
flow-weaver export pipeline.ts --target github-actions --output .github/workflows/
```

---

## Validation Rules

Nine CI/CD-specific validation rules run automatically when the workflow contains CI/CD annotations:

| Rule | Severity | What it catches |
|------|----------|-----------------|
| `CICD_SECRET_NOT_DECLARED` | error | `@connect secret:X` used but no `@secret X` declared |
| `CICD_SECRET_UNUSED` | warning | `@secret X` declared but never wired via `@connect secret:X` |
| `CICD_TRIGGER_MISSING` | warning | No trigger annotations, pipeline would never run automatically |
| `CICD_JOB_MISSING_RUNNER` | warning | No `@runner` and jobs have no explicit runner |
| `CICD_ARTIFACT_CROSS_JOB` | warning | Data flows between jobs but no `@artifact` declared |
| `CICD_CIRCULAR_JOB_DEPS` | error | Job dependency cycle detected |
| `CICD_MATRIX_WITH_ENVIRONMENT` | warning | `@matrix` with `@environment` triggers N approval prompts |
| `CICD_JOB_CONFIG_ORPHAN` | warning | `@job X` references a job not used by any node |
| `CICD_STAGE_ORPHAN` | warning | `@stage X` declared but no job matches by name prefix |

---

## Related Topics

- [Deployment](deployment) — Full export target reference (serverless + CI/CD)
- [JSDoc Grammar](jsdoc-grammar) — Formal annotation syntax including CI/CD tags
- [Scaffold](scaffold) — CI/CD template options
- [Concepts](concepts) — Core workflow fundamentals
