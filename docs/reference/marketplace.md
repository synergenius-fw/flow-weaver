---
name: Marketplace
description: Create, publish, install, and manage Flow Weaver marketplace packages and external plugins
keywords: [marketplace, market, package, pack, publish, install, search, npm, flow-weaver-pack, plugin, init, manifest, manifestVersion, node types, patterns, workflows, cliEntrypoint, cliCommands, mcpEntrypoint, mcpTools, exportTargets, tagHandlers, validationRuleSets, docs, engineVersion, component, area, sandbox]
---

# Marketplace

The Flow Weaver marketplace is an npm-based ecosystem for sharing reusable node types, workflows, and patterns. Packages follow the `flow-weaver-pack-*` naming convention and are discoverable via npm search.

## Overview

| What | Purpose | Declared |
|------|---------|----------|
| **Node types** | Reusable `@flowWeaver nodeType` functions | Generated from source |
| **Workflows** | Complete `@flowWeaver workflow` exports | Generated from source |
| **Patterns** | Reusable `@flowWeaver pattern` fragments | Generated from source |
| **Export targets** | Deployment targets for `fw export` | `exportTargets` in the manifest |
| **Tag handlers** | Custom JSDoc annotations | `tagHandlers` |
| **CLI commands** | `fw <pack> <command>` | `cliEntrypoint` + `cliCommands` |
| **MCP tools** | Tools added to `fw mcp-server` | `mcpEntrypoint` + `mcpTools` |
| **Validation rules, docs, init templates, device handlers** | See [Pack Contributions](#pack-contributions) | `validationRuleSets`, `docs`, `initContributions`, `deviceHandlers` |

A single package can contain any combination of these.

## Export Target Packs

Flow Weaver core ships no export target. Every target comes from a pack's `exportTargets` manifest field, resolved from `node_modules` each time `fw export`, `fw compile --target` or `fw_export` runs. Find target packs with `fw market search`, install one, and its target name becomes valid for `--target`. What a target generates, and any annotations it reads, is documented by the pack itself — once installed, its topics appear in `fw docs`.

Without a target pack installed, `fw export` and `fw_export` return `INVALID_TARGET` for every name, and `fw compile --target <name>` reports `Unknown compile target: <name>. No custom targets registered.`

---

## Using Packages

### Search

Find packages on npm:

```bash
fw market search openai
fw market search            # Browse all packages
fw market search llm --limit 5
```

For private registries:

```bash
fw market search openai --registry https://npm.internal.com
```

### Install

Install a package:

```bash
fw market install flow-weaver-pack-openai
fw market install flow-weaver-pack-openai@1.0.0
```

After installation, the package's node types, workflows, and patterns are available for use in your workflows via `@fwImport`.

### List Installed

```bash
fw market list
```

Shows all installed `flow-weaver-pack-*` packages with their available node types, workflows, and patterns.

---

## Creating Packages

### Scaffold

Create a new marketplace package:

```bash
fw market init openai
```

This creates a `flow-weaver-pack-openai/` directory with:
- `package.json` — Configured with `flow-weaver-marketplace-pack` keyword
- `src/` — Source directory for node types, workflows, and patterns
- `tsconfig.json` — TypeScript configuration

Options:

```bash
fw market init openai --description "OpenAI nodes for Flow Weaver" --author "Your Name"
fw market init openai -y  # Skip prompts
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
fw market pack
fw market pack --verbose  # Show parse warnings
```

This:
1. Scans all TypeScript files for `@flowWeaver` annotations
2. Validates against 12 marketplace-specific rules
3. Generates `flowweaver.manifest.json` with metadata about all exports

Only `nodeTypes`, `workflows` and `patterns` are derived from source. Every other manifest field is hand-written and carried over unchanged from the existing `flowweaver.manifest.json` each time `market pack` runs; `name`, `version` and `description` come from `package.json`, and `engineVersion` and `categories` from its `flowWeaver` block.

### Publish

Publish to npm:

```bash
fw market publish
fw market publish --dry-run  # Preview without publishing
fw market publish --tag beta # Publish with dist-tag
```

---

## Marketplace Validation Rules

The `market pack` command validates packages against additional rules beyond standard workflow validation:

- Package name must start with `flow-weaver-pack-`
- Must include `flow-weaver-marketplace-pack` keyword in `package.json`
- All exported node types must have proper annotations
- All exported workflows must validate successfully
- No conflicting node type names
- Proper TypeScript compilation
- Manifest generation succeeds

---

## Pack Contributions

Beyond node types, a pack extends Flow Weaver through hand-written fields in `flowweaver.manifest.json` (`manifestVersion: 2`). Installed packs are found by scanning `node_modules` for a `flowweaver.manifest.json`; each field below is read by a specific loader at a specific moment.

| Field | Loaded by | When |
|-------|-----------|------|
| `tagHandlers` | The parser | Every parse with a `projectDir`; see [Custom Tag Handlers](#custom-tag-handlers) |
| `validationRuleSets` | The parser | Every parse with a `projectDir`; each set's `detect` decides whether its rules apply |
| `exportTargets` | `fw export` / `fw_export` | Per call; an unknown target name lists the installed ones |
| `cliEntrypoint` + `cliCommands` | The CLI | At startup; commands appear as `fw <namespace> <command>` |
| `mcpEntrypoint` + `mcpTools` | `fw mcp-server` | At server start, after the core tools |
| `initContributions` | `fw init` | Use cases and templates offered during project setup |
| `deviceHandlers` | `fw connect` | Device connection handlers |
| `docs` | `fw docs`, `fw_docs`, `fw context`, `fw_context` | At command or server start; topics list, read and search like core topics |
| `engineVersion` | CLI and MCP loaders | A pack requiring a newer Flow Weaver still loads, with a warning on stderr |

### CLI commands

Both fields are required; a pack with `cliEntrypoint` but an empty `cliCommands` is skipped.

```json
{
  "cliEntrypoint": "dist/cli.js",
  "cliCommands": [
    {
      "name": "replay",
      "description": "Replay a recording",
      "arguments": [{ "syntax": "<recording>", "description": "Recording file" }],
      "options": [{ "flags": "--speed <n>", "description": "Playback speed", "default": 1 }]
    }
  ]
}
```

- The namespace is the npm name without its scope and the `flow-weaver-pack-` prefix: `@acme/flow-weaver-pack-audio` → `fw audio replay`
- The entrypoint is imported lazily, only when one of its commands runs
- It exports `handleCommandV2(name, context)` where `context` is `{ args, options, cwd }` — Flow Weaver owns the parsing, so a pack never reads `process.argv`. The older `handleCommand(name, args)` is still accepted; `printHelp()` is optional

### MCP tools

Both fields are required; `mcpTools` is the list the server uses to decide whether to import the entrypoint at all, so declare every tool the entrypoint registers.

```json
{
  "mcpEntrypoint": "dist/mcp.js",
  "mcpTools": [{ "name": "fw_audio_replay", "description": "Replay a recording" }]
}
```

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function registerMcpTools(mcp: McpServer): Promise<void> {
  mcp.tool('fw_audio_replay', 'Replay a recording', { recording: z.string() }, async (args) => {
    // …
  });
}
```

- Pack tools are registered after the core tools, so a name collision with a core tool is the pack's to avoid; prefix with the pack namespace
- Every tool definition is sent to the assistant on every turn — keep descriptions short (see [MCP Tools](mcp-tools))
- A failing import is reported on stderr and the server keeps running without that pack

### Export targets

```json
{
  "exportTargets": [{ "name": "audio-cloud", "description": "Deploy to Audio Cloud", "file": "dist/target.js", "exportName": "AudioCloudTarget" }]
}
```

Targets are resolved per call from the current working directory's `node_modules`, so `fw_export` with no target packs installed returns `INVALID_TARGET` for every name. `file` is the compiled module; `exportName` names the class export (the default export when omitted). The class is instantiated lazily with no constructor arguments. What each target generates is described in [Deployment](deployment).

#### Writing an export target

A target is a class implementing `ExportTarget` from `@synergenius/flow-weaver/deployment`. Extending `BaseExportTarget` from the same module gives you `createFile`, `generatePackageJson`, `generateTsConfig`, the OpenAPI builders and `generateReadme`.

| Member | Required | Called by |
|--------|----------|-----------|
| `name`, `description` | yes | Always |
| `generate(options)` | yes | `fw export` for a single workflow; `fw_export` when the target has no `generateBundle` — targets that read the workflow AST rather than compiled code, such as CI/CD pipelines |
| `generateBundle(workflows, nodeTypes, options)` | no | `fw export --multi`; `fw_export` whenever the target defines it. Receives the selected workflows and node types, each with an `expose` flag saying whether it gets an HTTP endpoint |
| `getDeployInstructions(artifacts)` | yes | After generation; returns `{ title, steps, prerequisites, localTestSteps?, links? }` |
| `deploySchema`, `nodeTypeDeploySchema` | no | Declare the `@deploy` keys the target accepts, for validation and Studio autocomplete |
| `generateMultiWorkflow`, `generateNodeTypeService` | no | Declared on the interface; neither `fw export` nor `fw_export` calls them |

`options` is an `ExportOptions`: `sourceFile`, `workflowName`, `displayName`, `outputDir`, and optionally `description`, `production`, `includeDocs`, `multi`, `workflows`, and `targetOptions` — `{ durableSteps: true }` when requested; `fw_export` also passes the workflow's `@deploy` block as `deploy`.

Both generators return artifacts of the shape `{ files, target, workflowName, entryPoint, warnings? }`, where each file is `{ relativePath, absolutePath, content, type }` and `type` is one of `handler`, `config`, `workflow`, `nodeType`, `package`, `other`. The caller writes the files unless `--dry-run` (CLI) or `preview` (MCP) was requested, then prints the deploy instructions.

### Documentation topics

```json
{
  "docs": [
    {
      "slug": "audio-recording",
      "name": "Audio Recording",
      "description": "Recording, trimming and replaying audio in a workflow",
      "keywords": ["audio", "record", "replay"],
      "presets": ["authoring"],
      "file": "docs/recording.md"
    }
  ]
}
```

- `file` is relative to the package root and is plain Markdown; frontmatter is optional — when the file has none, `name`, `description` and `keywords` come from the manifest
- The topic appears in `fw docs`, `fw_docs list`/`read`/`search` and, for each preset named in `presets`, in `fw context` and `fw_context`
- A slug that collides with a core topic is ignored; a `file` that does not exist is skipped with a note on stderr

---

## Custom Tag Handlers

Tag handlers let packs extend the parser with custom JSDoc annotations. When the parser encounters a tag it doesn't recognize natively, it delegates to registered pack handlers before emitting "Unknown annotation" warnings.

A pack that introduces platform- or pipeline-specific annotations registers a handler for each tag it owns; the parsed data lands in the pack's deploy namespace, where the pack's export target reads it.

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
      "tags": ["region", "memory"],
      "namespace": "audio",
      "scope": "both",
      "file": "dist/tag-handler.js",
      "exportName": "audioTagHandler"
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
fw plugin init my-plugin
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
fw plugin init my-plugin --area sidebar
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
