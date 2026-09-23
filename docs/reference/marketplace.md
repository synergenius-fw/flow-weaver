---
name: Marketplace
description: Create, publish, install, and manage Flow Weaver marketplace packages
keywords: [marketplace, market, package, pack, publish, install, search, npm, flow-weaver-pack, manifest, manifestVersion, node types, workflows, cliEntrypoint, cliCommands, mcpEntrypoint, mcpTools, exportTargets, tagHandlers, serializerExport, validationRuleSets, initContributions, docs, engineVersion, authoring, extend, grammar, custom tags, deploy namespace]
---

# Marketplace

The Flow Weaver marketplace is an npm-based ecosystem for sharing reusable node types and workflows. A pack is an npm package that carries a `flowweaver.manifest.json` and the `flow-weaver-marketplace-pack` keyword — that is how one is recognised, installed or on a registry. By convention packs are named `flow-weaver-pack-*` (or `@scope/flow-weaver-pack-*`), which makes them easy to find; a pack named otherwise, as an organisation's policy may require, works the same and is found the same way.

## Overview

| What | Purpose | Declared |
|------|---------|----------|
| **Node types** | Reusable `@flowWeaver nodeType` functions | Generated from source |
| **Workflows** | Complete `@flowWeaver workflow` exports | Generated from source |
| **Export targets** | Deployment targets for `fw export` | `exportTargets` in the manifest |
| **Tag handlers** | New JSDoc tags, parsed into a namespace of the workflow's deploy data — see [Extending the grammar](#extending-the-grammar-with-a-pack) | `tagHandlers` |
| **CLI commands** | `fw <pack> <command>` | `cliEntrypoint` + `cliCommands` |
| **MCP tools** | Tools added to `fw mcp-server` | `mcpEntrypoint` + `mcpTools` |
| **Validation rules, docs, init templates** | See [Pack Contributions](#pack-contributions) | `validationRuleSets`, `docs`, `initContributions` |

A single package can contain any combination of these.

`fw console` shows the packs installed in a project and everything each one contributes, exports a workflow through a pack's target, searches the marketplace, and — when the open project is itself a pack — runs the `market pack` validation and shows the manifest it would write. See [Console](console).

## Export Target Packs

Flow Weaver core ships no export target. Every target comes from a pack's `exportTargets` manifest field, resolved from `node_modules` each time `fw export`, `fw compile --target` or `fw_export` runs. Find target packs with `fw market search`, install one, and its target name becomes valid for `--target`. What a target generates, and any annotations it reads, is documented by the pack itself — once installed, its topics appear in `fw docs`.

Without a target pack installed, `fw export` and `fw_export` return `INVALID_TARGET` for every name, and `fw compile --target <name>` reports `Unknown compile target: <name>. No custom targets registered.`

---

## Using Packages

### Search

Find packs on every registry your npm uses:

```bash
fw market search openai
fw market search            # Browse all packages
fw market search llm --limit 5
```

The search reads `.npmrc` the way `npm install` does — the user's file, then the project's — and asks the default registry and every scoped one (`@acme:registry=https://npm.internal.com/`), each with its own token (`//npm.internal.com/:_authToken=…`). A private pack is found wherever an install would find it; the output names each registry searched and whether it answered. `fw_market_search` and the console's marketplace page do the same.

A registry that is not in `.npmrc` can be asked directly, by its search URL:

```bash
fw market search openai --registry https://npm.internal.com/-/v1/search
```

### Install

Install a package:

```bash
fw market install flow-weaver-pack-openai
fw market install flow-weaver-pack-openai@1.0.0
```

After installation, the package's node types and workflows are available for use in your workflows via `@fwImport`.

### List Installed

```bash
fw market list
```

Shows every installed pack — any package under `node_modules` with a `flowweaver.manifest.json` — with its node types and workflows.

---

## Creating Packages

A pack is written like any project that uses Flow Weaver, plus a manifest. The loop is: scaffold, write node types, build, `fw market pack`, try it from a project, publish.

### Scaffold

```bash
fw market init openai
fw market init openai --description "OpenAI nodes for Flow Weaver" --author "Your Name"
fw market init openai -y  # Skip prompts
```

This creates `flow-weaver-pack-openai/` (the prefix is added when missing):

```
flow-weaver-pack-openai/
  src/
    index.ts                # barrel: re-exports node-types, workflows
    node-types/
      index.ts
      sample.ts             # one @flowWeaver nodeType to start from
    workflows/index.ts
  package.json              # keyword flow-weaver-marketplace-pack, flowWeaver.engineVersion,
                            # peerDependency on @synergenius/flow-weaver, scripts build / pack / prepublishOnly
  tsconfig.json             # ESM, declarations, src → dist
  README.md
  .gitignore
```

Everything the manifest points at is a **compiled** file under `dist/`, so `npm run build` (`tsc`) comes before `fw market pack`; `prepublishOnly` runs both.

### Write node types

A node type in a pack is exactly a node type anywhere else — see [Concepts](concepts). Two things matter more in a pack:

- Every `@flowWeaver nodeType` function under `src/` becomes an entry in the manifest, named after its function. Helpers a node calls must not carry the annotation, and two node types may not share a name (`UNIT-002`).
- Give each one `@description`, and a `@color`, `@icon` or `@tag`; a workflow author sees these in the console and in `fw market list`, and `fw market pack` warns when they are missing (`PKG-008`, `PKG-009`).

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Chat Completion
 * @description One turn against a chat model
 * @color purple
 * @icon smartToy
 * @tag openai
 */
export async function chatCompletion(prompt: string, model: string): Promise<{ text: string }> {
  // ...
}
```

A workflow uses it with `@fwImport chatCompletion chatCompletion from "flow-weaver-pack-openai"` and then `@node ask chatCompletion`; ports come from the function's signature, read from the pack's `.d.ts`.

### Validate & Pack

```bash
npm run build
fw market pack
fw market pack --verbose  # Show parse warnings
```

This scans `src/**/*.ts` for `@flowWeaver` annotations, validates the package against the [marketplace rules](#marketplace-validation-rules), and writes `flowweaver.manifest.json`.

Only `nodeTypes` and `workflows` are derived from source. Every other manifest field is hand-written and carried over unchanged from the existing `flowweaver.manifest.json` each time `market pack` runs; `name`, `version` and `description` come from `package.json`, and `engineVersion` and `categories` from its `flowWeaver` block.

`fw console` opened on the pack's directory does the same without writing: the *This pack* page shows the manifest it would produce, the rules over it, and what writing it would change.

### Try it from a project

Before publishing, install the pack into a project the way a user will, and use it:

```bash
cd ../my-project
npm install ../flow-weaver-pack-openai     # or: npm link flow-weaver-pack-openai
fw market list                             # the pack, its node types and what it contributes
fw console                                 # Packs shows the pack's page, with its node types in the Step pane
```

The manifest's `file` paths are resolved inside `node_modules/<pack>/`, so a handler, rule set or target only loads when `dist/` was built and is in `files`.

### Publish

```bash
fw market publish
fw market publish --dry-run  # Preview without publishing
fw market publish --tag beta # Publish with dist-tag
```

`fw market publish` runs the pack validation first and refuses on an error-level issue. A private registry works as it does for `npm publish`: `publishConfig.registry` in `package.json`, or the scope's registry in `.npmrc`.

---

## Marketplace Validation Rules

`fw market pack` and `fw market publish` check the package beyond ordinary workflow validation. An error blocks publishing; a warning is reported.

| Code | Severity | Says |
|------|----------|------|
| `PKG-001` | error | `package.json` keywords must include `flow-weaver-marketplace-pack` — this is what identifies a pack on a registry |
| `PKG-002` | error | `flowWeaver.engineVersion` must be set in `package.json` |
| `PKG-003` | error | `peerDependencies` must include `@synergenius/flow-weaver` |
| `PKG-004` | error | The package must not be `private` |
| `PKG-005` | warning | The name should follow `flow-weaver-pack-*` — the convention that makes a pack easy to find; a pack named otherwise still packs, installs and loads |
| `PKG-006` | error | At least one node type, workflow or export target |
| `PKG-007` | warning | `README.md` should exist |
| `PKG-008` | warning | A node type should have a description |
| `PKG-009` | warning | A node type should have visuals (`@color`, `@icon` or `@tag`) |
| `UNIT-001` | error | Every workflow in the pack must validate |
| `UNIT-002` | error | Node type names must be unique within the pack |
| `TGT-001` / `TGT-002` | error | An export target needs `name` and `file`; names are unique |
| `HND-001` | warning | A tag handler has no `serializerExport`: its tags are dropped whenever annotations are regenerated — see [Extending the grammar](#extending-the-grammar-with-a-pack) |
| `HND-002` | error | A tag handler must declare `tags`, `namespace` and `file` |

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
| `initContributions` | `fw init` | Use cases and templates offered during project setup; see [Init contributions](#init-contributions) |
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
| `generate(options)` | yes | `fw export` for a single workflow; `fw_export` when the target has no `generateBundle` — targets that read the workflow AST rather than compiled code |
| `generateBundle(workflows, nodeTypes, options)` | no | `fw export --multi`; `fw_export` whenever the target defines it. Receives the selected workflows and node types, each with an `expose` flag saying whether it gets an HTTP endpoint |
| `getDeployInstructions(artifacts)` | yes | After generation; returns `{ title, steps, prerequisites, localTestSteps?, links? }` |
| `deploySchema`, `nodeTypeDeploySchema` | no | Declare the `@deploy` keys the target accepts, for validation and editor autocomplete |
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

### Init contributions

```json
{
  "initContributions": {
    "useCase": { "id": "audio", "name": "Audio pipelines", "description": "Record, trim and publish audio" },
    "templates": ["audio-record", "audio-publish"]
  }
}
```

`fw init` offers the use case among its prompts and, when it is picked, the listed templates. The templates themselves are read from a `templates.js` beside the manifest (`<pack>/templates.js`), which exports `workflowTemplates: WorkflowTemplate[]` — the same shape as the core templates listed in [Scaffold](scaffold); only the ids named in `templates` are taken.

---

## Extending the grammar with a pack

A pack can teach the parser new JSDoc tags — for example `@secret`, `@runner`, `@matrix` — because the data a tag carries is meant for the pack's own consumers: its export target, its validation rules, its CLI. A pack can also read generic `[key: "value"]` bracket attributes on `@node`: core parses any bracket attribute it does not itself define into `nodeInstance.attributes` verbatim and gives it no meaning, so a pack reads that map and interprets its own keys (for example `[runner: "ubuntu-latest"]`). What a pack cannot add: new structural tags like `@path`, or new port syntax; those stay in core so every tool reads a workflow the same way.

The pieces, all declared under `tagHandlers` in the manifest and resolved from one compiled file:

| Piece | Direction | Required |
|-------|-----------|----------|
| handler (`TTagHandlerFn`) | tag line → data in `deploy.<namespace>` | yes |
| serializer (`TTagSerializerFn`) | `deploy.<namespace>` → tag lines | in practice yes: without it, regeneration drops the tags (`HND-001`) |
| validation rule set | rules that run when `detect(ast)` says the workflow uses the namespace | when the tags have rules |

### Where the data goes

A handled tag writes into the deploy map under the handler's namespace. In the AST that is `workflow.options.deploy[namespace]` for a workflow block and `nodeType.deploy[namespace]` for a node type block; the parser also mirrors each namespace to `options.<namespace>` so a pack's own code can read it with a typed name. Everything else reads it from there: the console shows it on the step card as *pack tags*, an export target receives it as `deploy`, and the pack's rules see it in `ast`.

### Writing a handler

```typescript
import type { TTagHandlerFn } from '@synergenius/flow-weaver/api';

export const audioTagHandler: TTagHandlerFn = (tagName, comment, ctx) => {
  // tagName: the tag without '@', e.g. "region"
  // comment: everything after the tag on that line
  // ctx.deploy: the deploy map for your namespace (mutate it directly)
  // ctx.warnings: push parser warnings here

  const value = comment.trim();
  if (!value) {
    ctx.warnings.push(`Empty @${tagName} tag`);
    return;
  }
  if (tagName === 'region') ctx.deploy['region'] = value;
  if (tagName === 'memory') ctx.deploy['memory'] = Number(value);
};
```

The handler receives one call per tag occurrence, in source order, and may be called for several tags (`tags` in the manifest). Push a warning rather than throwing: a warning reaches `fw validate` and the console; a throw aborts the parse of that file.

### Writing the serializer

The compiler regenerates a workflow's JSDoc block from the AST on `fw compile` and after every `fw_modify`. Core knows how to write its own tags; for a namespace it does not know, it calls the pack's serializer with the namespace's data and writes whatever lines come back. A pack without one loses its tags the first time the block is regenerated — silently, until the export target notices its data is gone.

```typescript
import type { TTagSerializerFn } from '@synergenius/flow-weaver/api';

// The inverse of the handler: every line the handler understands, emitted from the data it produced.
export const audioSerializer: TTagSerializerFn = (deploy) => {
  const lines: string[] = [];
  if (typeof deploy.region === 'string') lines.push(` * @region ${deploy.region}`);
  if (typeof deploy.memory === 'number') lines.push(` * @memory ${deploy.memory}`);
  return lines;
};
```

Each returned string is a whole comment line including the leading ` * `. Emit in a stable order so a regenerated file diffs cleanly. The round trip — parse, regenerate, parse again, equal — is worth a test in the pack.

### Declaring handlers in the manifest

```json
{
  "manifestVersion": 2,
  "tagHandlers": [
    {
      "tags": ["region", "memory"],
      "namespace": "audio",
      "scope": "both",
      "file": "dist/tag-handler.js",
      "exportName": "audioTagHandler",
      "serializerExport": "audioSerializer"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `tags` | Tag names this handler processes (without the `@` prefix) |
| `namespace` | Key in the deploy map where parsed data is stored; also the `options.<namespace>` mirror |
| `scope` | `workflow` for workflow-level tags, `nodeType` for node type tags, `both` for either |
| `file` | Relative path to the compiled JS file exporting the handler (and the serializer) |
| `exportName` | Named export of the handler (omit for `default`) |
| `serializerExport` | Named export of the serializer, from the same `file` |

A handler scoped to `workflow` only runs for tags inside `@flowWeaver workflow` blocks; `nodeType` only inside `@flowWeaver nodeType` blocks. A tag in the wrong scope is consumed with a warning and not handled.

### Validation rules for the tags

Rules that only make sense when the namespace is in use — a declared secret nobody reads, a job name used twice — are a rule set: a `detect` predicate and a lazy `getRules`, from one compiled file.

```typescript
import type { TValidationRule, TWorkflowAST } from '@synergenius/flow-weaver/ast';

export function detect(ast: TWorkflowAST): boolean {
  return ast.options?.deploy?.audio !== undefined;
}

export function getRules(): TValidationRule[] {
  return [{
    name: 'AUDIO_REGION_UNKNOWN',
    validate(ast) {
      const region = ast.options?.deploy?.audio?.region;
      return typeof region === 'string' && !['eu', 'us'].includes(region)
        ? [{ type: 'error', code: 'AUDIO_REGION_UNKNOWN', message: `Unknown region "${region}"; use eu or us` }]
        : [];
    },
  }];
}
```

```json
{
  "validationRuleSets": [
    { "name": "Audio rules", "namespace": "audio", "file": "dist/rules.js", "detectExport": "detect", "rulesExport": "getRules" }
  ]
}
```

A rule returns `TValidationError`s: `type` (`error` | `warning`), a `code` prefixed with the pack's namespace so it never collides with core's, a `message` that says what to change, and optionally `node`. They run inside `fw validate`, `fw_validate` and the console's Issues pane exactly like core rules, and an `error` blocks `fw compile`. Document each code in one of the pack's [documentation topics](#documentation-topics) so `fw_docs` can explain it.

### How discovery works

When `parseWorkflow()` is called with a `projectDir` (the CLI and the console always pass one), the parser scans `node_modules` for packs with a `flowweaver.manifest.json`, imports each handler `file`, and registers the handler, the serializer and the rule sets. The scan runs once per project directory per process. A `file` that fails to import — most often because the pack was not built — is skipped without an error: if a pack's tags come back as `Unknown annotation` warnings, check that its `dist/` exists.

---

## Related Topics

- [CLI Reference](cli-reference) — Full marketplace command flags
- [Scaffold](scaffold) — Template system for node types and workflows
- [Concepts](concepts) — Core workflow fundamentals
