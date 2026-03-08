---
name: Marketplace
description: Create, publish, install, and manage Flow Weaver marketplace packages and external plugins
keywords: [marketplace, market, package, publish, install, search, npm, flow-weaver-pack, plugin, init, manifest, node types, patterns, workflows, component, area, sandbox]
---

# Marketplace

The Flow Weaver marketplace is an npm-based ecosystem for sharing reusable node types, workflows, and patterns. Packages follow the `flow-weaver-pack-*` naming convention and are discoverable via npm search.

## Overview

| What | Purpose |
|------|---------|
| **Node types** | Reusable `@flowWeaver nodeType` functions |
| **Workflows** | Complete `@flowWeaver workflow` exports |
| **Patterns** | Reusable `@flowWeaver pattern` fragments |
| **Export targets** | Deployment targets for `flow-weaver export` |

A single package can contain any combination of these.

## Official Export Target Packs

Flow Weaver provides 6 official export target packs:

| Package | Target name | Description |
|---------|-------------|-------------|
| `@synergenius/flow-weaver-pack-lambda` | `lambda` | AWS Lambda + API Gateway |
| `@synergenius/flow-weaver-pack-vercel` | `vercel` | Vercel serverless functions |
| `@synergenius/flow-weaver-pack-cloudflare` | `cloudflare` | Cloudflare Workers |
| `@synergenius/flow-weaver-pack-inngest` | `inngest` | Inngest durable functions |
| `@synergenius/flow-weaver-pack-github-actions` | `github-actions` | GitHub Actions CI/CD pipelines |
| `@synergenius/flow-weaver-pack-gitlab-ci` | `gitlab-ci` | GitLab CI/CD pipelines |

Install with:

```bash
npm install @synergenius/flow-weaver-pack-lambda
```

See [Deployment](deployment) for target-specific usage details.

---

## Using Packages

### Search

Find packages on npm:

```bash
flow-weaver market search openai
flow-weaver market search            # Browse all packages
flow-weaver market search llm --limit 5
```

For private registries:

```bash
flow-weaver market search openai --registry https://npm.internal.com
```

### Install

Install a package:

```bash
flow-weaver market install flow-weaver-pack-openai
flow-weaver market install flow-weaver-pack-openai@1.0.0
```

After installation, the package's node types, workflows, and patterns are available for use in your workflows via `@fwImport`.

### List Installed

```bash
flow-weaver market list
```

Shows all installed `flow-weaver-pack-*` packages with their available node types, workflows, and patterns.

---

## Creating Packages

### Scaffold

Create a new marketplace package:

```bash
flow-weaver market init openai
```

This creates a `flow-weaver-pack-openai/` directory with:
- `package.json` — Configured with `flowweaver-marketplace-pack` keyword
- `src/` — Source directory for node types, workflows, and patterns
- `tsconfig.json` — TypeScript configuration

Options:

```bash
flow-weaver market init openai --description "OpenAI nodes for Flow Weaver" --author "Your Name"
flow-weaver market init openai -y  # Skip prompts
```

### Package Structure

```
flow-weaver-pack-openai/
  src/
    nodes/
      chat-completion.ts    # @flowWeaver nodeType functions
      embeddings.ts
    workflows/
      rag-pipeline.ts       # @flowWeaver workflow functions
    patterns/
      retry-with-backoff.ts # @flowWeaver pattern functions
  package.json
  tsconfig.json
```

### Validate & Pack

Validate your package and generate the manifest:

```bash
flow-weaver market pack
flow-weaver market pack --verbose  # Show parse warnings
```

This:
1. Scans all TypeScript files for `@flowWeaver` annotations
2. Validates against 12 marketplace-specific rules
3. Generates `flowweaver.manifest.json` with metadata about all exports

### Publish

Publish to npm:

```bash
flow-weaver market publish
flow-weaver market publish --dry-run  # Preview without publishing
flow-weaver market publish --tag beta # Publish with dist-tag
```

---

## Marketplace Validation Rules

The `market pack` command validates packages against additional rules beyond standard workflow validation:

- Package name must start with `flow-weaver-pack-`
- Must include `flowweaver-marketplace-pack` keyword in `package.json`
- All exported node types must have proper annotations
- All exported workflows must validate successfully
- No conflicting node type names
- Proper TypeScript compilation
- Manifest generation succeeds

---

## Custom Tag Handlers

Tag handlers let packs extend the parser with custom JSDoc annotations. When the parser encounters a tag it doesn't recognize natively, it delegates to registered pack handlers before emitting "Unknown annotation" warnings.

The CI/CD pack (`flow-weaver-pack-cicd`) is the primary example: it registers handlers for `@secret`, `@runner`, `@cache`, `@artifact`, and other CI/CD tags.

### Writing a handler

A tag handler is a function matching the `TTagHandlerFn` signature:

```typescript
import type { TTagHandlerFn } from '@synergenius/flow-weaver/api';

export const myHandler: TTagHandlerFn = (tagName, comment, ctx) => {
  // tagName: the tag without '@', e.g. "secret"
  // comment: everything after the tag on that line
  // ctx.deploy: the deploy map for your namespace (mutate it directly)
  // ctx.warnings: push parser warnings here

  const value = comment.trim();
  if (!value) {
    ctx.warnings.push(`Empty @${tagName} tag`);
    return;
  }

  const items = (ctx.deploy['items'] as string[]) ?? [];
  items.push(value);
  ctx.deploy['items'] = items;
};
```

The handler receives one call per tag occurrence. Parsed data goes into `ctx.deploy`, which maps to `workflow.deploy[namespace]` or `nodeType.deploy[namespace]` in the final AST.

### Declaring handlers in the manifest

Add a `tagHandlers` entry to your `flowweaver.manifest.json`:

```json
{
  "manifestVersion": 2,
  "tagHandlers": [
    {
      "tags": ["secret", "runner", "cache"],
      "namespace": "cicd",
      "scope": "both",
      "file": "dist/tag-handler.js",
      "exportName": "cicdTagHandler"
    }
  ]
}
```

Fields:

| Field | Description |
|-------|-------------|
| `tags` | Tag names this handler processes (without the `@` prefix) |
| `namespace` | Key in the deploy map where parsed data is stored |
| `scope` | `workflow` for workflow-level tags, `nodeType` for node type tags, `both` for either |
| `file` | Relative path to the compiled JS file exporting the handler |
| `exportName` | Named export from the file (omit for `default` export) |

### Handler scope

A handler scoped to `workflow` only runs for tags inside `@flowWeaver workflow` blocks. A handler scoped to `nodeType` only runs inside `@flowWeaver nodeType` blocks. Use `both` when your tags are valid in either context.

If a tag appears in the wrong scope, the parser emits a warning and skips the handler call.

### How discovery works

When `parseWorkflow()` is called with a `projectDir` option (or when the CLI runs from a project directory), the parser scans `node_modules` for installed packs with a `flowweaver.manifest.json`. It reads the `tagHandlers` array from each manifest, dynamically imports the handler files, and registers them in the `TagHandlerRegistry`. This scan runs once per project directory and is cached for subsequent parse calls.

---

## External Plugins

Plugins extend the Flow Weaver Studio IDE with custom UI components, system logic, and integrations.

### Scaffold a Plugin

```bash
flow-weaver plugin init my-plugin
```

Options:

| Flag | Description | Default |
|------|-------------|---------|
| `-a, --area <area>` | Component area | `panel` |
| `--no-system` | Skip system module | included |
| `-p, --preview` | Preview without writing | `false` |
| `--force` | Overwrite existing | `false` |

### Component Areas

Plugins register React components in specific areas of the Studio IDE:

| Area | Location |
|------|----------|
| `sidebar` | Left sidebar panel |
| `main` | Main content area |
| `toolbar` | Top toolbar |
| `modal` | Modal dialog |
| `panel` | Bottom or side panel |

### Plugin Structure

```bash
flow-weaver plugin init my-plugin --area sidebar
```

Generates:
```
my-plugin/
  src/
    index.ts          # Plugin manifest and registration
    component.tsx     # React component for the area
    system.ts         # System module (event handlers, state)
  package.json
```

### Capability Sandboxing

Plugins declare required capabilities. The runtime enforces access controls:

| Capability | Allows |
|------------|--------|
| `filesystem` | Read/write workflow files |
| `network` | HTTP requests |
| `process` | Spawn processes |
| `interop` | Communicate with other plugins |

---

## Related Topics

- [CLI Reference](cli-reference) — Full marketplace and plugin command flags
- [Patterns](patterns) — Creating and sharing reusable patterns
- [Scaffold](scaffold) — Template system for node types and workflows
- [Concepts](concepts) — Core workflow fundamentals
