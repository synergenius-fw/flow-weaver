---
name: CLI Reference
description: Complete reference for all Flow Weaver CLI commands, flags, and options
keywords: [cli, commands, compile, validate, run, watch, dev, serve, export, diagram, diff, doctor, init, migrate, marketplace, plugin, grammar, changelog, openapi, pattern, create, templates]
---

# CLI Reference

Complete reference for all `flow-weaver` CLI commands.

## Quick Reference

| Command | Description |
|---------|-------------|
| `compile` | Compile workflow files to TypeScript |
| `validate` | Validate without compiling |
| `describe` | Output workflow structure (JSON/text/mermaid) |
| `run` | Execute a workflow directly |
| `watch` | Recompile on file changes |
| `dev` | Watch + compile + run in one command |
| `serve` | HTTP server exposing workflows as endpoints |
| `diagram` | Generate SVG diagram |
| `diff` | Semantic diff between two workflows |
| `doctor` | Check project environment |
| `init` | Create a new project |
| `create` | Create workflows/nodes from templates |
| `templates` | List available templates |
| `pattern` | Work with reusable patterns |
| `export` | Export as serverless function |
| `openapi` | Generate OpenAPI specification |
| `migrate` | Migrate to current syntax |
| `grammar` | Output annotation grammar |
| `changelog` | Generate changelog from git |
| `market` | Marketplace packages |
| `plugin` | External plugins |
| `docs` | Browse reference documentation |
| `ui` | Send commands to the editor |
| `listen` | Stream editor events |
| `mcp-server` | Start MCP server |

---

## Core Commands

### compile

Compile workflow files to TypeScript. Inserts generated code into marker sections in the source file — user code outside markers is preserved.

```bash
flow-weaver compile <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file or directory | in-place |
| `-p, --production` | No debug events | `false` |
| `-s, --source-map` | Generate source maps | `false` |
| `--verbose` | Verbose output | `false` |
| `--dry-run` | Preview without writing | `false` |
| `-w, --workflow-name <name>` | Specific workflow name | all |
| `-f, --format <format>` | Module format: `esm`, `cjs`, `auto` | `auto` |
| `--strict` | Type coercion warnings become errors | `false` |
| `--inline-runtime` | Force inline runtime | `false` |
| `--clean` | Omit redundant @param/@returns | `false` |
| `--target <target>` | `typescript` or `inngest` | `typescript` |
| `--cron <schedule>` | Cron schedule (Inngest only) | — |
| `--serve` | Generate serve() handler | `false` |
| `--framework <name>` | `next`, `express`, `hono`, `fastify`, `remix` | — |
| `--typed-events` | Generate Zod event schemas | `false` |
| `--retries <n>` | Retries per function (Inngest only) | — |
| `--timeout <duration>` | Function timeout (e.g. `"30m"`) | — |

**Examples:**
```bash
flow-weaver compile my-workflow.ts
flow-weaver compile '**/*.ts' -o .output
flow-weaver compile my-workflow.ts --format cjs
flow-weaver compile workflow.ts --target inngest --serve --framework next
flow-weaver compile workflow.ts --production --clean
```

> See also: [Compilation](compilation) for details on targets and Inngest integration.

---

### validate

Validate workflow files without compiling. Reports errors and warnings with suggestions.

```bash
flow-weaver validate <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--verbose` | Verbose output | `false` |
| `-q, --quiet` | Suppress warnings | `false` |
| `--json` | Output as JSON | `false` |
| `-w, --workflow-name <name>` | Specific workflow name | all |
| `--strict` | Type coercion warnings become errors | `false` |

**Examples:**
```bash
flow-weaver validate my-workflow.ts
flow-weaver validate '**/*.ts' --verbose
flow-weaver validate workflow.ts --json --strict
```

---

### describe

Output workflow structure in LLM-friendly formats.

```bash
flow-weaver describe <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <format>` | `json`, `text`, `mermaid`, `paths` | `json` |
| `-n, --node <id>` | Focus on a specific node | — |
| `--compile` | Also update runtime markers | `false` |
| `-w, --workflow-name <name>` | Specific workflow name | all |

**Examples:**
```bash
flow-weaver describe workflow.ts
flow-weaver describe workflow.ts --format mermaid
flow-weaver describe workflow.ts --node validator
flow-weaver describe workflow.ts --format paths
```

---

### run

Execute a workflow file directly. Compiles in memory and runs immediately.

```bash
flow-weaver run <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-w, --workflow <name>` | Specific workflow name | — |
| `--params <json>` | Input parameters as JSON string | — |
| `--params-file <path>` | Path to JSON file with parameters | — |
| `-p, --production` | No trace events | `false` |
| `-t, --trace` | Include execution trace events | `false` |
| `--json` | Output result as JSON | `false` |
| `--timeout <ms>` | Execution timeout in milliseconds | — |
| `--mocks <json>` | Mock config for built-in nodes as JSON | — |
| `--mocks-file <path>` | Path to JSON file with mock config | — |

**Examples:**
```bash
flow-weaver run workflow.ts --params '{"amount": 500}'
flow-weaver run workflow.ts --params-file input.json --trace
flow-weaver run workflow.ts --mocks '{"fast": true, "events": {"app/approved": {"status": "ok"}}}'
flow-weaver run workflow.ts --timeout 30000 --json
```

> See also: [Built-in Nodes](built-in-nodes) for mock configuration details.

---

## Development Commands

### watch

Watch workflow files and recompile on changes.

```bash
flow-weaver watch <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file or directory | in-place |
| `-p, --production` | No debug events | `false` |
| `-s, --source-map` | Generate source maps | `false` |
| `--verbose` | Verbose output | `false` |
| `-w, --workflow-name <name>` | Specific workflow name | all |
| `-f, --format <format>` | `esm`, `cjs`, `auto` | `auto` |

**Examples:**
```bash
flow-weaver watch my-workflow.ts
flow-weaver watch 'src/**/*.ts' -o dist
```

---

### dev

Watch, compile, and run workflow on changes. Combines `watch` + `run` into a single command for rapid iteration.

```bash
flow-weaver dev <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--params <json>` | Input parameters as JSON string | — |
| `--params-file <path>` | Path to JSON file with parameters | — |
| `-w, --workflow <name>` | Specific workflow name | — |
| `-p, --production` | No trace events | `false` |
| `-f, --format <format>` | `esm`, `cjs`, `auto` | `auto` |
| `--clean` | Omit redundant annotations | `false` |
| `--once` | Run once then exit | `false` |
| `--json` | Output result as JSON | `false` |
| `--target <target>` | `typescript` or `inngest` | `typescript` |
| `--framework <framework>` | Framework for serve handler (Inngest only) | `express` |
| `--port <port>` | Port for dev server (Inngest only) | `3000` |

**Examples:**
```bash
flow-weaver dev workflow.ts --params '{"input": "hello"}'
flow-weaver dev workflow.ts --once --json
flow-weaver dev workflow.ts --target inngest --port 8080
```

---

### serve

Start an HTTP server exposing workflows as REST endpoints. Supports hot reload, CORS, and Swagger UI.

```bash
flow-weaver serve [directory] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Server port | `3000` |
| `-H, --host <host>` | Server host | `0.0.0.0` |
| `--no-watch` | Disable file watching | watch enabled |
| `--production` | No trace events | `false` |
| `--precompile` | Precompile all workflows on startup | `false` |
| `--cors <origin>` | CORS origin | `*` |
| `--swagger` | Enable Swagger UI at `/docs` | `false` |

**Examples:**
```bash
flow-weaver serve ./workflows
flow-weaver serve ./workflows --port 8080 --swagger
flow-weaver serve --production --precompile --no-watch
```

> See also: [Deployment](deployment) for production serving and export.

---

### listen

Connect to the editor and stream integration events as JSON lines.

```bash
flow-weaver listen [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-s, --server <url>` | Editor URL | `http://localhost:9000` |

---

## Visualization

### diagram

Generate SVG diagram of a workflow.

```bash
flow-weaver diagram <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --theme <theme>` | `dark` or `light` | `dark` |
| `-w, --width <pixels>` | SVG width in pixels | auto |
| `-p, --padding <pixels>` | Canvas padding in pixels | auto |
| `--no-port-labels` | Hide data type labels on ports | shown |
| `--workflow-name <name>` | Specific workflow | all |
| `-o, --output <file>` | Write SVG to file | stdout |

**Examples:**
```bash
flow-weaver diagram workflow.ts
flow-weaver diagram workflow.ts --theme light -o diagram.svg
flow-weaver diagram workflow.ts --no-port-labels --width 1200
```

---

### grammar

Output the JSDoc annotation grammar as HTML railroad diagrams or EBNF text.

```bash
flow-weaver grammar [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <format>` | `html` or `ebnf` | `html` |
| `-o, --output <path>` | Write to file | stdout |

**Examples:**
```bash
flow-weaver grammar
flow-weaver grammar --format ebnf
flow-weaver grammar -o grammar.html
```

---

## Analysis

### diff

Compare two workflow files semantically. Reports node type changes, instance changes, connection changes, and breaking changes.

```bash
flow-weaver diff <file1> <file2> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <format>` | `text`, `json`, `compact` | `text` |
| `-w, --workflow-name <name>` | Specific workflow | all |
| `--exit-zero` | Exit 0 even with differences | `false` |

**Examples:**
```bash
flow-weaver diff workflow-v1.ts workflow-v2.ts
flow-weaver diff workflow-v1.ts workflow-v2.ts --format json
flow-weaver diff old.ts new.ts --exit-zero  # for CI pipelines
```

---

### doctor

Check project environment and configuration for flow-weaver compatibility.

```bash
flow-weaver doctor [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

---

## Code Generation

### init

Create a new flow-weaver project with recommended structure.

```bash
flow-weaver init [directory] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --name <name>` | Project name | directory name |
| `-t, --template <template>` | Workflow template | `simple` |
| `-f, --format <format>` | `esm` or `cjs` | `esm` |
| `-y, --yes` | Skip prompts, use defaults | `false` |
| `--install` | Run npm install | — |
| `--no-install` | Skip npm install | — |
| `--git` | Initialize git repo | — |
| `--no-git` | Skip git init | — |
| `--force` | Overwrite existing files | `false` |
| `--json` | Output as JSON | `false` |

**Examples:**
```bash
flow-weaver init my-project
flow-weaver init --template ai-agent -y
flow-weaver init my-project --format cjs --no-git
```

---

### create workflow

Create a workflow from a template. Appends to existing files.

```bash
flow-weaver create workflow <template> <file> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-l, --line <number>` | Insert at specific line | end of file |
| `-a, --async` | Generate async workflow | `false` |
| `-p, --preview` | Preview without writing | `false` |
| `--provider <provider>` | LLM provider: `openai`, `anthropic`, `ollama`, `mock` | — |
| `--model <model>` | Model identifier | — |
| `--config <json>` | Configuration as JSON | — |
| `--name <name>` | Override workflow function name | derived |
| `--nodes <names>` | Comma-separated node names | — |
| `--input <name>` | Custom input port name | `data` |
| `--output <name>` | Custom output port name | `result` |

**Examples:**
```bash
flow-weaver create workflow sequential my-workflow.ts
flow-weaver create workflow ai-agent agent.ts --provider openai --model gpt-4o
flow-weaver create workflow foreach pipeline.ts --nodes "fetch,parse,store" --async
```

---

### create node

Create a node type from a template. Appends to existing files.

```bash
flow-weaver create node <name> <file> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-l, --line <number>` | Insert at specific line | end of file |
| `-t, --template <template>` | Node template | `processor` |
| `-p, --preview` | Preview without writing | `false` |
| `--strategy <strategy>` | Template strategy (e.g. `mock`, `callback`, `webhook`) | — |
| `--config <json>` | Additional configuration | — |

**Examples:**
```bash
flow-weaver create node myProcessor my-workflow.ts
flow-weaver create node apiClient my-workflow.ts --template http
flow-weaver create node checker my-workflow.ts --template validator
```

---

### templates

List available workflow and node templates.

```bash
flow-weaver templates [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

> See also: [Scaffold](scaffold) for template details.

---

## Patterns

### pattern list

List patterns in a file or directory.

```bash
flow-weaver pattern list <path> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

---

### pattern apply

Apply a reusable pattern to a workflow file.

```bash
flow-weaver pattern apply <pattern-file> <target-file> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --preview` | Preview without writing | `false` |
| `--prefix <prefix>` | Prefix for node IDs (conflict avoidance) | — |
| `-n, --name <name>` | Specific pattern name | — |

---

### pattern extract

Extract a pattern from selected workflow nodes.

```bash
flow-weaver pattern extract <source-file> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--nodes <nodes>` | Comma-separated node IDs **(required)** | — |
| `-o, --output <file>` | Output file **(required)** | — |
| `-n, --name <name>` | Pattern name | — |
| `-p, --preview` | Preview without writing | `false` |

**Examples:**
```bash
flow-weaver pattern extract workflow.ts --nodes a,b -o extracted.ts
flow-weaver pattern extract workflow.ts --nodes validator,transformer -o validate-transform.ts --name validateTransform
```

> See also: [Patterns](patterns) for the full pattern system guide.

---

## Deployment

### export

Export workflow as a serverless function for cloud platforms.

```bash
flow-weaver export <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --target <target>` | `lambda`, `vercel`, `cloudflare`, `inngest` **(required)** | — |
| `-o, --output <path>` | Output directory **(required)** | — |
| `-w, --workflow <name>` | Specific workflow | — |
| `-p, --production` | Production mode | `true` |
| `--dry-run` | Preview without writing | `false` |
| `--multi` | Export all workflows as single service | `false` |
| `--workflows <names>` | Comma-separated workflow subset (with `--multi`) | all |
| `--docs` | Include API documentation routes | `false` |
| `--durable-steps` | Per-node Inngest steps (Inngest only) | `false` |

**Examples:**
```bash
flow-weaver export workflow.ts --target vercel --output api/
flow-weaver export workflows.ts --target lambda --output dist/ --multi --docs
flow-weaver export workflow.ts --target inngest --output dist/ --durable-steps
flow-weaver export workflow.ts --target cloudflare --output worker/
```

> See also: [Deployment](deployment) for target-specific details.

---

### openapi

Generate OpenAPI specification from workflows in a directory.

```bash
flow-weaver openapi <directory> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file | stdout |
| `--title <title>` | API title | `Flow Weaver API` |
| `--version <version>` | API version | `1.0.0` |
| `--description <desc>` | API description | — |
| `-f, --format <format>` | `json` or `yaml` | `json` |
| `--server <url>` | Server URL | — |

**Examples:**
```bash
flow-weaver openapi ./workflows --output api-spec.json
flow-weaver openapi ./workflows --format yaml --server https://api.example.com
```

---

## Migration

### migrate

Migrate workflow files to current syntax via parse-regenerate round-trip. Adds defaults for missing fields and transforms edge cases.

```bash
flow-weaver migrate <glob> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Preview without writing | `false` |
| `--diff` | Show semantic diff before/after | `false` |

Ignores `**/node_modules/**` and `**/*.generated.ts`.

**Examples:**
```bash
flow-weaver migrate '**/*.ts'
flow-weaver migrate 'src/**/*.ts' --dry-run
flow-weaver migrate '**/*.ts' --diff
```

---

## Marketplace

### market init

Scaffold a new marketplace package.

```bash
flow-weaver market init <name> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-d, --description <desc>` | Package description | — |
| `-a, --author <author>` | Author name | — |
| `-y, --yes` | Skip prompts | `false` |

---

### market pack

Validate and generate `flowweaver.manifest.json`.

```bash
flow-weaver market pack [directory] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |
| `--verbose` | Show parse warnings | `false` |

---

### market publish

Pack and publish to npm.

```bash
flow-weaver market publish [directory] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Preview without publishing | `false` |
| `--tag <tag>` | npm dist-tag | — |

---

### market install

Install a marketplace package.

```bash
flow-weaver market install <package> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

---

### market search

Search npm for marketplace packages.

```bash
flow-weaver market search [query] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-l, --limit <number>` | Max results | `20` |
| `-r, --registry <url>` | Custom registry URL | public npm |
| `--json` | Output as JSON | `false` |

---

### market list

List installed marketplace packages.

```bash
flow-weaver market list [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

> See also: [Marketplace](marketplace) for the full package lifecycle guide.

---

## Plugins

### plugin init

Scaffold a new external plugin with component area and optional system module.

```bash
flow-weaver plugin init <name> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-a, --area <area>` | `sidebar`, `main`, `toolbar`, `modal`, `panel` | `panel` |
| `--no-system` | Skip generating a system module | system included |
| `-p, --preview` | Preview without writing | `false` |
| `--force` | Overwrite existing files | `false` |

**Examples:**
```bash
flow-weaver plugin init my-plugin
flow-weaver plugin init my-plugin --area sidebar --no-system
```

---

## Documentation

### docs list

List available documentation topics.

```bash
flow-weaver docs [list] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |
| `--compact` | Compact output | `false` |

---

### docs read

Read a documentation topic.

```bash
flow-weaver docs read <topic> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |
| `--compact` | LLM-friendly version (strips prose) | `false` |

---

### docs search

Search across all documentation.

```bash
flow-weaver docs search <query> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

**Examples:**
```bash
flow-weaver docs
flow-weaver docs read error-codes
flow-weaver docs read scaffold --compact
flow-weaver docs search "missing workflow"
```

---

## Editor Integration

### ui focus-node

Select and center a node in the editor.

```bash
flow-weaver ui focus-node <nodeId> [options]
```

### ui add-node

Add a node type at viewport center.

```bash
flow-weaver ui add-node <nodeTypeName> [options]
```

### ui open-workflow

Open a workflow file in the editor.

```bash
flow-weaver ui open-workflow <filePath> [options]
```

### ui get-state

Return current workflow state from the editor.

```bash
flow-weaver ui get-state [options]
```

### ui batch

Execute a batch of commands with auto-snapshot rollback.

```bash
flow-weaver ui batch <json> [options]
```

All UI commands accept:

| Flag | Description | Default |
|------|-------------|---------|
| `-s, --server <url>` | Editor URL | `http://localhost:9000` |

---

## System

### mcp-server

Start MCP server for Claude Code integration.

```bash
flow-weaver mcp-server [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-s, --server <url>` | Editor URL | `http://localhost:9000` |
| `--stdio` | Run in MCP stdio mode | `false` |

---

### changelog

Generate changelog from git history, categorized by file path.

```bash
flow-weaver changelog [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--last-tag` | From last git tag to HEAD | `false` |
| `--since <date>` | Date-based range | — |
| `-r, --range <range>` | Custom git range | — |

**Examples:**
```bash
flow-weaver changelog --last-tag
flow-weaver changelog --range v0.1.0..HEAD
flow-weaver changelog --since 2024-01-01
```

---

## Global Flag

| Flag | Description |
|------|-------------|
| `-v, --version` | Output the current version |

---

## Related Topics

- [Concepts](concepts) — Fundamental workflow concepts
- [Compilation](compilation) — Compilation targets and Inngest integration
- [Deployment](deployment) — Export, serve, and OpenAPI
- [Built-in Nodes](built-in-nodes) — delay, waitForEvent, invokeWorkflow, and mocks
- [Scaffold](scaffold) — Template details
- [Marketplace](marketplace) — Package ecosystem
- [Advanced Annotations](advanced-annotations) — Pull execution, merge strategies, and more
