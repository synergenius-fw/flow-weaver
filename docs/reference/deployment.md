---
name: Deployment
description: Export workflows to serverless platforms, HTTP serve mode, OpenAPI generation, and multi-workflow services
keywords: [deploy, export, lambda, vercel, cloudflare, inngest, github-actions, gitlab-ci, serve, openapi, swagger, serverless, multi-workflow, durable-steps, webhook, http, cors, packs, marketplace]
---

# Deployment

Flow Weaver workflows can be deployed as serverless functions, HTTP endpoints, durable event-driven functions, or CI/CD pipelines. This guide covers all deployment options.

## Installing Export Target Packs

Export targets are provided by marketplace packs. Install the ones you need:

```bash
# Serverless targets
npm install @synergenius/flow-weaver-pack-lambda
npm install @synergenius/flow-weaver-pack-vercel
npm install @synergenius/flow-weaver-pack-cloudflare
npm install @synergenius/flow-weaver-pack-inngest

# CI/CD targets
npm install @synergenius/flow-weaver-pack-github-actions
npm install @synergenius/flow-weaver-pack-gitlab-ci
```

The `export` command automatically discovers installed packs — no configuration needed.

---

## Export Targets

The `export` command generates platform-specific handler code, configuration files, and deploy instructions.

```bash
fw export <input> --target <target> --output <dir>
```

### AWS Lambda

```bash
fw export workflow.ts --target lambda --output dist/
```

Generates:
- `handler.ts` — Lambda handler with API Gateway event parsing
- `package.json` — Dependencies
- Deploy instructions for AWS CLI or SAM

### Vercel

```bash
fw export workflow.ts --target vercel --output api/
```

Generates:
- `api/workflow.ts` — Vercel serverless function
- `vercel.json` — Route configuration

### Cloudflare Workers

```bash
fw export workflow.ts --target cloudflare --output worker/
```

Generates:
- `worker.ts` — Cloudflare Worker handler
- `wrangler.toml` — Wrangler configuration

### Inngest

```bash
fw export workflow.ts --target inngest --output dist/
```

Generates:
- Inngest function with event triggers
- Serve handler for your framework

Add `--durable-steps` for per-node `step.run()` durability:

```bash
fw export workflow.ts --target inngest --output dist/ --durable-steps
```

### GitHub Actions

```bash
fw export workflow.ts --target github-actions --output .github/workflows/
```

Generates:
- GitHub Actions workflow YAML with jobs mapped from workflow nodes
- Proper step ordering and dependency configuration

### GitLab CI

```bash
fw export workflow.ts --target gitlab-ci --output .
```

Generates:
- `.gitlab-ci.yml` with stages and jobs mapped from workflow nodes
- Pipeline configuration with proper stage ordering

---

## CI/CD Pipeline Export

CI/CD export works differently from serverless export. Instead of generating a handler that runs your workflow at request time, it reads the workflow graph and produces native pipeline YAML. The generated file has no runtime dependency on Flow Weaver.

Use CI/CD-specific annotations (`@secret`, `@runner`, `@cache`, `@artifact`, `@environment`, `@matrix`, `@service`, `@concurrency`) alongside `@node` and `@connect` to define pipeline structure. The `[job: "name"]` attribute on `@node` groups nodes into jobs. Triggers use `@trigger push`, `@trigger pull_request`, etc.

Secrets are wired as pseudo-node connections: `@connect secret:TOKEN -> node.port`. The export target renders these as platform-native secret references (`${{ secrets.TOKEN }}` for GitHub, `$NPM_TOKEN` for GitLab).

```bash
# GitHub Actions
fw export pipeline.ts --target github-actions --output .github/workflows/

# GitLab CI
fw export pipeline.ts --target gitlab-ci --output .
```

See the [CI/CD Pipelines](cicd) topic for the complete annotation reference, validation rules, and full examples.

---

## Multi-Workflow Export

Export all workflows in a file as a **unified service** with routing, function registry, and optional API documentation:

```bash
fw export workflows.ts --target lambda --output dist/ --multi
```

### Features

- **Unified routing** — Single entry point dispatches to the correct workflow
- **Function registry** — All workflows registered and callable by name
- **API docs** — Add `--docs` to include Swagger UI at `/docs` and OpenAPI spec at `/openapi.json`

```bash
fw export workflows.ts --target vercel --output api/ --multi --docs
```

### Selecting Workflows

Export a subset of workflows from a multi-workflow file:

```bash
fw export workflows.ts --target lambda --output dist/ --multi --workflows validatePipeline,enrichPipeline
```

---

## HTTP Serve Mode

Run workflows as HTTP endpoints locally or in production with `fw serve`:

```bash
fw serve [directory] [options]
```

### Features

| Feature | Flag | Default |
|---------|------|---------|
| **Hot reload** | `--no-watch` to disable | enabled |
| **CORS** | `--cors <origin>` | `*` |
| **Swagger UI** | `--swagger` | disabled |
| **Precompilation** | `--precompile` | disabled |
| **Production mode** | `--production` | disabled |

### Examples

Development server with hot reload:
```bash
fw serve ./workflows
```

Production server:
```bash
fw serve ./workflows --production --precompile --no-watch --port 8080
```

With Swagger UI:
```bash
fw serve ./workflows --swagger
# Open http://localhost:3000/docs for API documentation
```

### Endpoints

Each workflow becomes a POST endpoint:
```
POST /workflow-name
Content-Type: application/json

{ "param1": "value1", "param2": "value2" }
```

---

## OpenAPI Generation

Generate an OpenAPI specification from all workflows in a directory:

```bash
fw openapi <directory> [options]
```

The specification is derived from workflow `@param` and `@returns` annotations.

### Options

```bash
# JSON output (default)
fw openapi ./workflows --output api-spec.json

# YAML output
fw openapi ./workflows --format yaml --output api-spec.yaml

# With server URL
fw openapi ./workflows --server https://api.example.com --title "My API" --version "2.0.0"
```

### Generated Spec

Each workflow becomes an endpoint with:
- **Path** — `POST /workflow-name`
- **Request body** — JSON schema from `@param` types
- **Response** — JSON schema from `@returns` types
- **Description** — From `@description` or JSDoc comment text

---

## Dev Mode with Inngest

For Inngest development, `fw dev` starts a local dev server with the Inngest Dev Server:

```bash
fw dev workflow.ts --target inngest --port 8080 --framework express
```

This:
1. Compiles the workflow with Inngest target
2. Starts a local HTTP server with the serve handler
3. Watches for file changes and recompiles automatically

---

## Deployment Checklist

1. **Validate** — Run `fw validate workflow.ts --strict` before deploying
2. **Production compile** — Use `--production` to strip debug instrumentation
3. **Test locally** — Use `fw serve` or `fw run` with mocks
4. **Export** — Generate platform-specific code with `fw export`
5. **Deploy** — Follow platform-specific instructions in the generated output

---

## Related Topics

- [CI/CD Pipelines](cicd) — CI/CD annotation reference, secret wiring, job grouping, validation rules
- [CLI Reference](cli-reference) — Full command flags for export, serve, openapi
- [Compilation](compilation) — Inngest target details and serve handlers
- [Built-in Nodes](built-in-nodes) — Mock system for local testing
- [Concepts](concepts) — Core workflow fundamentals
