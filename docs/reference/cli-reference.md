---
name: CLI Reference
description: Complete reference for all Flow Weaver CLI commands, flags, and options
keywords: [cli, commands, compile, validate, strip, run, watch, dev, serve, export, diagram, diff, doctor, init, migrate, marketplace, plugin, grammar, changelog, openapi, pattern, create, templates, context, modify, implement, status]
---

# CLI Reference

Complete reference for all `fw` CLI commands.

`fw` is the CLI command. `flow-weaver` also works as an alias.

## Quick Reference

| Command | Description |
|---------|-------------|
| `compile` | Compile workflow files to TypeScript |
| `validate` | Validate without compiling |
| `strip` | Remove generated code from compiled files |
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
| `modify` | Add/remove/rename nodes, connections, positions, and labels |
| `implement` | Replace stub node with function skeleton |
| `status` | Report implementation progress |
| `context` | Generate LLM context bundle |
| `docs` | Browse reference documentation |
| `ui` | Send commands to the editor |
| `listen` | Stream editor events |
| `mcp-server` | Start MCP server |

---

## Core Commands

### compile

Compile workflow files to TypeScript. Inserts generated code into marker sections in the source file — user code outside markers is preserved.

```bash
fw compile <input> [options]
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
fw compile my-workflow.ts
fw compile '**/*.ts' -o .output
fw compile my-workflow.ts --format cjs
fw compile workflow.ts --target inngest --serve --framework next
fw compile workflow.ts --production --clean
```

> See also: [Compilation](compilation) for details on targets and Inngest integration.

---

### validate

Validate workflow files without compiling. Reports errors and warnings with suggestions.

```bash
fw validate <input> [options]
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
fw validate my-workflow.ts
fw validate '**/*.ts' --verbose
fw validate workflow.ts --json --strict
```

---

### strip

Remove generated code from compiled workflow files. Deletes the runtime section and replaces each workflow body with a `throw new Error('Not implemented')` placeholder. Useful for committing clean source files to version control.

```bash
fw strip <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output directory | in-place |
| `--dry-run` | Preview without writing | `false` |
| `--verbose` | Verbose output | `false` |

**Examples:**
```bash
fw strip my-workflow.ts
fw strip '**/*.ts' --dry-run
fw strip my-workflow.ts -o cleaned/
```

---

### describe

Output workflow structure in LLM-friendly formats.

```bash
fw describe <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <format>` | `json`, `text`, `mermaid`, `paths` | `json` |
| `-n, --node <id>` | Focus on a specific node | — |
| `--compile` | Also update runtime markers | `false` |
| `-w, --workflow-name <name>` | Specific workflow name | all |

**Examples:**
```bash
fw describe workflow.ts
fw describe workflow.ts --format mermaid
fw describe workflow.ts --node validator
fw describe workflow.ts --format paths
```

---

### run

Execute a workflow file directly. Compiles in memory and runs immediately.

```bash
fw run <input> [options]
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
| `-d, --debug` | Start in step-through debug mode | `false` |
| `--checkpoint` | Enable checkpointing to disk after each node | `false` |
| `--resume [file]` | Resume from a checkpoint file (auto-detects latest if no file given) | — |
| `-b, --breakpoint <nodeIds...>` | Set initial breakpoints (repeatable) | — |

**Examples:**
```bash
fw run workflow.ts --params '{"amount": 500}'
fw run workflow.ts --params-file input.json --trace
fw run workflow.ts --mocks '{"fast": true, "events": {"app/approved": {"status": "ok"}}}'
fw run workflow.ts --timeout 30000 --json
fw run workflow.ts --debug
fw run workflow.ts --checkpoint
fw run workflow.ts --resume
fw run workflow.ts --debug --breakpoint processData --breakpoint validate
```

> See also: [Built-in Nodes](built-in-nodes) for mock configuration details, [Debugging](debugging) for debug REPL commands and checkpoint details.

---

## Development Commands

### watch

Watch workflow files and recompile on changes.

```bash
fw watch <input> [options]
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
fw watch my-workflow.ts
fw watch 'src/**/*.ts' -o dist
```

---

### dev

Watch, compile, and run workflow on changes. Combines `watch` + `run` into a single command for rapid iteration.

```bash
fw dev <input> [options]
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
fw dev workflow.ts --params '{"input": "hello"}'
fw dev workflow.ts --once --json
fw dev workflow.ts --target inngest --port 8080
```

---

### serve

Start an HTTP server exposing workflows as REST endpoints. Supports hot reload, CORS, and Swagger UI.

```bash
fw serve [directory] [options]
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
fw serve ./workflows
fw serve ./workflows --port 8080 --swagger
fw serve --production --precompile --no-watch
```

> See also: [Deployment](deployment) for production serving and export.

---

### listen

Connect to the editor and stream integration events as JSON lines.

```bash
fw listen [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-s, --server <url>` | Editor URL | `http://localhost:9000` |

---

## Visualization

### diagram

Generate SVG diagram of a workflow.

```bash
fw diagram <input> [options]
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
fw diagram workflow.ts
fw diagram workflow.ts --theme light -o diagram.svg
fw diagram workflow.ts --no-port-labels --width 1200
```

---

### grammar

Output the JSDoc annotation grammar as HTML railroad diagrams or EBNF text.

```bash
fw grammar [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <format>` | `html` or `ebnf` | `html` |
| `-o, --output <path>` | Write to file | stdout |

**Examples:**
```bash
fw grammar
fw grammar --format ebnf
fw grammar -o grammar.html
```

---

## Analysis

### diff

Compare two workflow files semantically. Reports node type changes, instance changes, connection changes, and breaking changes.

```bash
fw diff <file1> <file2> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <format>` | `text`, `json`, `compact` | `text` |
| `-w, --workflow-name <name>` | Specific workflow | all |
| `--exit-zero` | Exit 0 even with differences | `false` |

**Examples:**
```bash
fw diff workflow-v1.ts workflow-v2.ts
fw diff workflow-v1.ts workflow-v2.ts --format json
fw diff old.ts new.ts --exit-zero  # for CI pipelines
```

---

### doctor

Check project environment and configuration for Flow Weaver compatibility.

```bash
fw doctor [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

---

## Code Generation

### init

Create a new Flow Weaver project with recommended structure.

```bash
fw init [directory] [options]
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
fw init my-project
fw init --template ai-agent -y
fw init my-project --format cjs --no-git
```

---

### create workflow

Create a workflow from a template. Appends to existing files.

```bash
fw create workflow <template> <file> [options]
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
fw create workflow sequential my-workflow.ts
fw create workflow ai-agent agent.ts --provider openai --model gpt-4o
fw create workflow foreach pipeline.ts --nodes "fetch,parse,store" --async
```

---

### create node

Create a node type from a template. Appends to existing files.

```bash
fw create node <name> <file> [options]
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
fw create node myProcessor my-workflow.ts
fw create node apiClient my-workflow.ts --template http
fw create node checker my-workflow.ts --template validator
```

---

### modify

Modify workflow structure programmatically. Parses the file, applies the operation, and regenerates the JSDoc annotations in place. Useful for scripting, CI pipelines, and the genesis self-evolution system.

#### modify addNode

```bash
fw modify addNode --file <path> --nodeId <id> --nodeType <type>
```

Adds a new node instance to the workflow. Auto-positions to the right of the rightmost existing node. Warns if the node type isn't defined in the file.

#### modify removeNode

```bash
fw modify removeNode --file <path> --nodeId <id>
```

Removes a node instance and all connections attached to it.

#### modify addConnection

```bash
fw modify addConnection --file <path> --from <node.port> --to <node.port>
```

Adds a connection between two ports. Both nodes must exist. Port names are validated against the node type definition when available.

#### modify removeConnection

```bash
fw modify removeConnection --file <path> --from <node.port> --to <node.port>
```

Removes an existing connection.

#### modify renameNode

```bash
fw modify renameNode --file <path> --oldId <id> --newId <id>
```

Renames a node instance and updates all connections that reference it.

#### modify setPosition

```bash
fw modify setPosition --file <path> --nodeId <id> --x <number> --y <number>
```

Sets the canvas position of a node instance.

#### modify setLabel

```bash
fw modify setLabel --file <path> --nodeId <id> --label <text>
```

Sets the display label for a node instance.


**Examples:**
```bash
fw modify addNode --file workflow.ts --nodeId validator --nodeType validateInput
fw modify addConnection --file workflow.ts --from Start.data --to validator.input
fw modify removeNode --file workflow.ts --nodeId oldStep
fw modify removeConnection --file workflow.ts --from a.output --to b.input
fw modify renameNode --file workflow.ts --oldId step1 --newId validateStep
fw modify setPosition --file workflow.ts --nodeId step1 --x 200 --y 100
fw modify setLabel --file workflow.ts --nodeId step1 --label "Validate Input"
```

---

### implement

Replace a stub node (`declare function`) with a real function skeleton containing the correct signature, JSDoc annotations, and return type.

```bash
fw implement <input> <node> [options]
fw implement <input> --nodeId <id> [options]
```

The node can be specified as a positional argument or with the `--nodeId` flag.

| Flag | Description | Default |
|------|-------------|---------|
| `-w, --workflow <name>` | Specific workflow name | — |
| `--nodeId <id>` | Node to implement (alternative to positional arg) | — |
| `-p, --preview` | Preview without writing | `false` |

**Examples:**
```bash
fw implement workflow.ts validateInput
fw implement workflow.ts --nodeId validateInput
fw implement workflow.ts myNode --preview
```

---

### status

Report implementation progress for stub workflows. Shows which nodes are implemented vs still declared as stubs.

```bash
fw status <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-w, --workflow <name>` | Specific workflow name | — |
| `--json` | Output as JSON | `false` |

---

### templates

List available workflow and node templates.

```bash
fw templates [options]
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
fw pattern list <path> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

---

### pattern apply

Apply a reusable pattern to a workflow file.

```bash
fw pattern apply <pattern-file> <target-file> [options]
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
fw pattern extract <source-file> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--nodes <nodes>` | Comma-separated node IDs **(required)** | — |
| `-o, --output <file>` | Output file **(required)** | — |
| `-n, --name <name>` | Pattern name | — |
| `-p, --preview` | Preview without writing | `false` |

**Examples:**
```bash
fw pattern extract workflow.ts --nodes a,b -o extracted.ts
fw pattern extract workflow.ts --nodes validator,transformer -o validate-transform.ts --name validateTransform
```

> See also: [Patterns](patterns) for the full pattern system guide.

---

## Deployment

### export

Export workflow as a serverless function for cloud platforms.

```bash
fw export <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --target <target>` | Target from installed packs (e.g. `lambda`, `vercel`, `cloudflare`, `inngest`, `github-actions`, `gitlab-ci`) **(required)** | — |
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
fw export workflow.ts --target vercel --output api/
fw export workflows.ts --target lambda --output dist/ --multi --docs
fw export workflow.ts --target inngest --output dist/ --durable-steps
fw export workflow.ts --target cloudflare --output worker/
```

> Available targets depend on installed `flow-weaver-pack-*` packages (the package names stay as-is). See [Deployment](deployment) for installation instructions and target-specific details.

---

### openapi

Generate OpenAPI specification from workflows in a directory.

```bash
fw openapi <directory> [options]
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
fw openapi ./workflows --output api-spec.json
fw openapi ./workflows --format yaml --server https://api.example.com
```

---

## Migration

### migrate

Migrate workflow files to current syntax via parse-regenerate round-trip. Adds defaults for missing fields and transforms edge cases.

```bash
fw migrate <glob> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Preview without writing | `false` |
| `--diff` | Show semantic diff before/after | `false` |

Ignores `**/node_modules/**` and `**/*.generated.ts`.

**Examples:**
```bash
fw migrate '**/*.ts'
fw migrate 'src/**/*.ts' --dry-run
fw migrate '**/*.ts' --diff
```

---

## Marketplace

### market init

Scaffold a new marketplace package.

```bash
fw market init <name> [options]
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
fw market pack [directory] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |
| `--verbose` | Show parse warnings | `false` |

---

### market publish

Pack and publish to npm.

```bash
fw market publish [directory] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Preview without publishing | `false` |
| `--tag <tag>` | npm dist-tag | — |

---

### market install

Install a marketplace package.

```bash
fw market install <package> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

---

### market search

Search npm for marketplace packages.

```bash
fw market search [query] [options]
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
fw market list [options]
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
fw plugin init <name> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-a, --area <area>` | `sidebar`, `main`, `toolbar`, `modal`, `panel` | `panel` |
| `--no-system` | Skip generating a system module | system included |
| `-p, --preview` | Preview without writing | `false` |
| `--force` | Overwrite existing files | `false` |

**Examples:**
```bash
fw plugin init my-plugin
fw plugin init my-plugin --area sidebar --no-system
```

---

## Documentation

### docs list

List available documentation topics.

```bash
fw docs [list] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |
| `--compact` | Compact output | `false` |

---

### docs read

Read a documentation topic.

```bash
fw docs read <topic> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |
| `--compact` | LLM-friendly version (strips prose) | `false` |

---

### docs search

Search across all documentation.

```bash
fw docs search <query> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | `false` |

**Examples:**
```bash
fw docs
fw docs read error-codes
fw docs read scaffold --compact
fw docs search "missing workflow"
```

---

### context

Generate a self-contained LLM context bundle from documentation and annotation grammar. Two profiles control the output format: `standalone` produces a complete reference for pasting into any LLM, `assistant` produces a leaner version that assumes MCP tools are available.

```bash
fw context [preset] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--profile <profile>` | `standalone` or `assistant` | `standalone` |
| `--topics <slugs>` | Comma-separated topic slugs (overrides preset) | — |
| `--add <slugs>` | Extra topic slugs on top of preset | — |
| `--no-grammar` | Omit EBNF grammar section | grammar included |
| `-o, --output <path>` | Write to file instead of stdout | stdout |
| `--list` | List available presets and exit | — |

Built-in presets: `core` (concepts, grammar, tutorial), `authoring` (concepts, grammar, annotations, built-in nodes, scaffold, node-conversion, patterns), `ops` (CLI, compilation, deployment, export, debugging, error-codes), `full` (all 16 topics).

**Examples:**
```bash
fw context core | pbcopy
fw context full -o .flow-weaver-context.md
fw context authoring --profile assistant
fw context --topics concepts,jsdoc-grammar,error-codes
fw context core --add error-codes
fw context --list
```

---

## Editor Integration

### ui focus-node

Select and center a node in the editor.

```bash
fw ui focus-node <nodeId> [options]
```

### ui add-node

Add a node type at viewport center.

```bash
fw ui add-node <nodeTypeName> [options]
```

### ui open-workflow

Open a workflow file in the editor.

```bash
fw ui open-workflow <filePath> [options]
```

### ui get-state

Return current workflow state from the editor.

```bash
fw ui get-state [options]
```

### ui batch

Execute a batch of commands with auto-snapshot rollback.

```bash
fw ui batch <json> [options]
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
fw mcp-server [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-s, --server <url>` | Editor URL | `http://localhost:9000` |
| `--stdio` | Run in MCP stdio mode | `false` |

---

### changelog

Generate changelog from git history, categorized by file path.

```bash
fw changelog [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--last-tag` | From last git tag to HEAD | `false` |
| `--since <date>` | Date-based range | — |
| `-r, --range <range>` | Custom git range | — |

**Examples:**
```bash
fw changelog --last-tag
fw changelog --range v0.1.0..HEAD
fw changelog --since 2024-01-01
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
