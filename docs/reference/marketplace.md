---
name: Marketplace
description: Create, publish, install, and manage Flow Weaver marketplace packages and external plugins
keywords: [marketplace, market, package, publish, install, search, npm, flowweaver-pack, plugin, init, manifest, node types, patterns, workflows, component, area, sandbox]
---

# Marketplace

The Flow Weaver marketplace is an npm-based ecosystem for sharing reusable node types, workflows, and patterns. Packages follow the `flowweaver-pack-*` naming convention and are discoverable via npm search.

## Overview

| What | Purpose |
|------|---------|
| **Node types** | Reusable `@flowWeaver nodeType` functions |
| **Workflows** | Complete `@flowWeaver workflow` exports |
| **Patterns** | Reusable `@flowWeaver pattern` fragments |

A single package can contain any combination of these.

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
flow-weaver market install flowweaver-pack-openai
flow-weaver market install flowweaver-pack-openai@1.0.0
```

After installation, the package's node types, workflows, and patterns are available for use in your workflows via `@fwImport`.

### List Installed

```bash
flow-weaver market list
```

Shows all installed `flowweaver-pack-*` packages with their available node types, workflows, and patterns.

---

## Creating Packages

### Scaffold

Create a new marketplace package:

```bash
flow-weaver market init openai
```

This creates a `flowweaver-pack-openai/` directory with:
- `package.json` — Configured with `flowweaver-pack` keyword
- `src/` — Source directory for node types, workflows, and patterns
- `tsconfig.json` — TypeScript configuration

Options:

```bash
flow-weaver market init openai --description "OpenAI nodes for Flow Weaver" --author "Your Name"
flow-weaver market init openai -y  # Skip prompts
```

### Package Structure

```
flowweaver-pack-openai/
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

- Package name must start with `flowweaver-pack-`
- Must include `flowweaver-pack` keyword in `package.json`
- All exported node types must have proper annotations
- All exported workflows must validate successfully
- No conflicting node type names
- Proper TypeScript compilation
- Manifest generation succeeds

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
