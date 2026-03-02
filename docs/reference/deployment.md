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
npm install @synergenius/flowweaver-pack-lambda
npm install @synergenius/flowweaver-pack-vercel
npm install @synergenius/flowweaver-pack-cloudflare
npm install @synergenius/flowweaver-pack-inngest

# CI/CD targets
npm install @synergenius/flowweaver-pack-github-actions
npm install @synergenius/flowweaver-pack-gitlab-ci
```

The `export` command automatically discovers installed packs — no configuration needed.

---

## Export Targets

The `export` command generates platform-specific handler code, configuration files, and deploy instructions.

```bash
flow-weaver export <input> --target <target> --output <dir>
```

### AWS Lambda

```bash
flow-weaver export workflow.ts --target lambda --output dist/
```

Generates:
- `handler.ts` — Lambda handler with API Gateway event parsing
- `package.json` — Dependencies
- Deploy instructions for AWS CLI or SAM

### Vercel

```bash
flow-weaver export workflow.ts --target vercel --output api/
```

Generates:
- `api/workflow.ts` — Vercel serverless function
- `vercel.json` — Route configuration

### Cloudflare Workers

```bash
flow-weaver export workflow.ts --target cloudflare --output worker/
```

Generates:
- `worker.ts` — Cloudflare Worker handler
- `wrangler.toml` — Wrangler configuration

### Inngest

```bash
flow-weaver export workflow.ts --target inngest --output dist/
```

Generates:
- Inngest function with event triggers
- Serve handler for your framework

Add `--durable-steps` for per-node `step.run()` durability:

```bash
flow-weaver export workflow.ts --target inngest --output dist/ --durable-steps
```

### GitHub Actions

```bash
flow-weaver export workflow.ts --target github-actions --output .github/workflows/
```

Generates:
- GitHub Actions workflow YAML with jobs mapped from workflow nodes
- Proper step ordering and dependency configuration

### GitLab CI

```bash
flow-weaver export workflow.ts --target gitlab-ci --output .
```

Generates:
- `.gitlab-ci.yml` with stages and jobs mapped from workflow nodes
- Pipeline configuration with proper stage ordering

---

## Multi-Workflow Export

Export all workflows in a file as a **unified service** with routing, function registry, and optional API documentation:

```bash
flow-weaver export workflows.ts --target lambda --output dist/ --multi
```

### Features

- **Unified routing** — Single entry point dispatches to the correct workflow
- **Function registry** — All workflows registered and callable by name
- **API docs** — Add `--docs` to include Swagger UI at `/docs` and OpenAPI spec at `/openapi.json`

```bash
flow-weaver export workflows.ts --target vercel --output api/ --multi --docs
```

### Selecting Workflows

Export a subset of workflows from a multi-workflow file:

```bash
flow-weaver export workflows.ts --target lambda --output dist/ --multi --workflows validatePipeline,enrichPipeline
```

---

## HTTP Serve Mode

Run workflows as HTTP endpoints locally or in production with `flow-weaver serve`:

```bash
flow-weaver serve [directory] [options]
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
flow-weaver serve ./workflows
```

Production server:
```bash
flow-weaver serve ./workflows --production --precompile --no-watch --port 8080
```

With Swagger UI:
```bash
flow-weaver serve ./workflows --swagger
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
flow-weaver openapi <directory> [options]
```

The specification is derived from workflow `@param` and `@returns` annotations.

### Options

```bash
# JSON output (default)
flow-weaver openapi ./workflows --output api-spec.json

# YAML output
flow-weaver openapi ./workflows --format yaml --output api-spec.yaml

# With server URL
flow-weaver openapi ./workflows --server https://api.example.com --title "My API" --version "2.0.0"
```

### Generated Spec

Each workflow becomes an endpoint with:
- **Path** — `POST /workflow-name`
- **Request body** — JSON schema from `@param` types
- **Response** — JSON schema from `@returns` types
- **Description** — From `@description` or JSDoc comment text

---

## Dev Mode with Inngest

For Inngest development, `flow-weaver dev` starts a local dev server with the Inngest Dev Server:

```bash
flow-weaver dev workflow.ts --target inngest --port 8080 --framework express
```

This:
1. Compiles the workflow with Inngest target
2. Starts a local HTTP server with the serve handler
3. Watches for file changes and recompiles automatically

---

## Deployment Checklist

1. **Validate** — Run `flow-weaver validate workflow.ts --strict` before deploying
2. **Production compile** — Use `--production` to strip debug instrumentation
3. **Test locally** — Use `flow-weaver serve` or `flow-weaver run` with mocks
4. **Export** — Generate platform-specific code with `flow-weaver export`
5. **Deploy** — Follow platform-specific instructions in the generated output

---

## Related Topics

- [CLI Reference](cli-reference) — Full command flags for export, serve, openapi
- [Compilation](compilation) — Inngest target details and serve handlers
- [Built-in Nodes](built-in-nodes) — Mock system for local testing
- [Concepts](concepts) — Core workflow fundamentals
