---
name: Deployment
description: Export workflows through target packs, serve them over HTTP, generate OpenAPI specs, and export multi-workflow services
keywords: [deploy, export, target, serve, openapi, swagger, serverless, multi-workflow, durable-steps, webhook, http, cors, packs, marketplace, dry-run]
---

# Deployment

The compiled output is plain TypeScript with no runtime dependency on Flow Weaver, so it runs wherever TypeScript runs. Beyond that, three paths exist: export platform-specific boilerplate through a target pack, serve workflows over HTTP with `fw serve`, or generate an OpenAPI spec for whatever hosts them.

## Export Targets

Flow Weaver core ships no export target. A target is provided by a pack — its `exportTargets` manifest entry names the target and the class that generates files — and is discovered from the current project's `node_modules` each time `fw export` runs.

```bash
fw market search <what you need>      # find a target pack
npm install <pack>                     # or: fw market install <pack>
fw export workflow.ts --target <name> --output dist/
```

- `--dry-run` lists the files that would be written and previews the handler without touching disk
- `--durable-steps` is handed to the target as a target option; a target that supports per-node durability uses it
- `--production` compiles without trace instrumentation
- An unknown target name returns `INVALID_TARGET` naming the installed targets; with no target pack installed that list is empty

What a target generates, the deploy instructions it prints, and any annotations it reads (`@deploy` keys, platform-specific tags) are documented by the pack. Once installed, the pack's topics appear in `fw docs`. Writing a target is covered in [Marketplace](marketplace).

---

## Multi-Workflow Export

Export all workflows in a file as a **unified service** with routing, function registry, and optional API documentation:

```bash
fw export workflows.ts --target <name> --output dist/ --multi
```

### Features

- **Unified routing** — Single entry point dispatches to the correct workflow
- **Function registry** — All workflows registered and callable by name
- **API docs** — Add `--docs` to include Swagger UI at `/docs` and OpenAPI spec at `/openapi.json`

```bash
fw export workflows.ts --target <name> --output api/ --multi --docs
```

### Selecting Workflows

Export a subset of workflows from a multi-workflow file:

```bash
fw export workflows.ts --target <name> --output dist/ --multi --workflows validatePipeline,enrichPipeline
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

## Deployment Checklist

1. **Validate** — Run `fw validate workflow.ts --strict` before deploying
2. **Production compile** — Use `--production` to strip debug instrumentation
3. **Test locally** — Use `fw serve` or `fw run` with mocks
4. **Export** — Generate platform-specific code with `fw export --target <name>`
5. **Deploy** — Follow the instructions the target prints with the generated output

---

## Related Topics

- [Marketplace](marketplace) — Finding target packs and writing an export target
- [CLI Reference](cli-reference) — Full command flags for export, serve, openapi
- [Compilation](compilation) — Compile targets and target options
- [Built-in Nodes](built-in-nodes) — Mock system for local testing
