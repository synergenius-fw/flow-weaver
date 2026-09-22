---
name: CLI Reference
description: Complete reference for all Flow Weaver CLI commands, flags, and options
keywords: [cli, commands, compile, validate, strip, run, watch, dev, serve, export, diagram, diff, doctor, init, migrate, marketplace, grammar, openapi, agents, create, templates, context, modify, implement, status]
---

# CLI Reference

Complete reference for all `fw` CLI commands.

`fw` is the CLI command. `flow-weaver` also works as an alias.

## Quick Reference

<!-- AUTO:START cli_quick_reference -->
| Command | Description |
|---------|-------------|
| `compile` | Compile workflow files to TypeScript |
| `strip` | Remove generated code from compiled workflow files |
| `describe` | Output workflow structure in LLM-friendly formats (JSON, text, mermaid) |
| `diagram` | Draw a workflow: its spine as an SVG, or text for a terminal |
| `artifact` | Hand a workflow to a person: the brief as a page or a PDF, or the spine as an SVG |
| `diff` | Compare two workflow files semantically |
| `validate` | Validate workflow files without compiling |
| `doctor` | Check project environment and configuration for flow-weaver compatibility |
| `agents` | The agent profiles that answer agent gates in this project, and whether each is ready |
| `init` | Create a new flow-weaver project |
| `watch` | Watch workflow files and recompile on changes |
| `dev` | Watch, compile, and run workflow on changes |
| `mcp-server` | Start MCP server for Claude Code integration |
| `mcp-setup` | Configure MCP server for AI coding tools (Claude, Cursor, VS Code, Windsurf, Codex, OpenClaw) |
| `create` | Create workflows or nodes from templates |
| `modify` | Modify workflow structure |
| `templates` | List available templates |
| `grammar` | Output JSDoc annotation grammar (@input, @output, @connect, @node, @scope) as HTML railroad diagrams or EBNF text |
| `run` | Execute a workflow file directly |
| `serve` | Serve the workflows as HTTP endpoints. Gated runs pause, resume and stream over the same API |
| `console` | Open the local operator console: workflows as processes, issues, code, live runs and gates |
| `export` | Export a workflow to a target provided by an installed pack |
| `openapi` | Generate OpenAPI specification from workflows |
| `migrate` | Migrate workflow files to current syntax via parse → regenerate round-trip |
| `status` | Report implementation progress for stub workflows |
| `implement` | Replace a stub node with a real function skeleton |
| `docs` | Browse reference documentation |
| `context` | Generate LLM context bundle from documentation and grammar |
| `market` | Discover, install, and publish marketplace packages |
<!-- AUTO:END cli_quick_reference -->

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
| `-w, --workflow <name>` | Specific workflow name | all |
| `-f, --format <format>` | Module format: `esm`, `cjs`, `auto` | `auto` |
| `--strict` | Type coercion warnings become errors | `false` |
| `--clean` | Omit redundant @param/@returns | `false` |
| `--target <target>` | `typescript`, or a target registered by an installed pack | `typescript` |
| `--cron <schedule>` | Cron schedule; overrides `@trigger cron=` for a pack target | — |
| `--serve` | Generate serve() handler | `false` |
| `--framework <name>` | `next`, `express`, `hono`, `fastify`, `remix` | — |
| `--typed-events` | Generate Zod event schemas | `false` |
| `--retries <n>` | Retries per function; overrides `@retries` for a pack target | — |
| `--timeout <duration>` | Function timeout (e.g. `"30m"`) | — |

**Examples:**
```bash
fw compile my-workflow.ts
fw compile '**/*.ts' -o .output
fw compile my-workflow.ts --format cjs
fw compile workflow.ts --target <pack-target> --serve --framework next
fw compile workflow.ts --production --clean
```

> See also: [Compilation](compilation) for details on targets and target options.

`--target` other than `typescript` needs a pack that provides it; core ships none, and an unknown name reports `Unknown compile target: <name>. No custom targets registered.` The `--cron`, `--serve`, `--framework`, `--typed-events`, `--retries` and `--timeout` flags are handed to the pack target; the default `typescript` target does not use them.

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
| `-w, --workflow <name>` | Specific workflow name | all |
| `--strict` | Type coercion warnings become errors | `false` |

**Examples:**
```bash
fw validate my-workflow.ts
fw validate '**/*.ts' --verbose
fw validate workflow.ts --json --strict
```

#### JSON output contract

With `--json`, the command prints a single JSON object to stdout and sets a
non-zero exit code when any file has errors. This is the stable machine-readable
contract for editor integrations and other tooling.

```jsonc
{
  "valid": false,           // true when totalErrors === 0
  "totalFiles": 1,
  "validFiles": 0,
  "totalErrors": 2,
  "totalWarnings": 1,
  "results": [
    {
      "file": "/abs/path/to/workflow.ts",  // absolute path
      "valid": false,
      "errors": [
        {
          "message": "Node \"Add\" has unconnected required input port \"x\".",
          "severity": "error",
          "code": "MISSING_REQUIRED_INPUT",   // optional, stable rule id
          "nodeId": "Add",                     // optional, offending node
          "location": {                        // optional, see below
            "file": "/abs/path/to/workflow.ts",
            "line": 33,                        // 1-based
            "column": 0                        // 0-based
          },
          "docUrl": "https://..."              // optional, when available
        }
      ],
      "warnings": [ /* same item shape, severity: "warning" */ ]
    }
  ]
}
```

Notes for consumers:

- **`location` is optional.** It is present when the validator can resolve the
  offending annotation to a source position, and **omitted entirely** (never
  `null`) otherwise. Test for it with an `in` check or a truthiness guard, e.g.
  `if (finding.location) { ... }`.
- **`line` is 1-based, `column` is 0-based.** Editors expecting 0-based lines
  (such as the Language Server Protocol) must subtract one from `line`.
- **Paths are absolute.** Both the top-level `results[].file` and
  `location.file` are absolute; resolve against the workspace root as needed.
- **`code` is a stable rule identifier** (e.g. `MISSING_REQUIRED_INPUT`) suitable
  for filtering or suppression. `message` is human-facing and may change wording.

Parse-level failures (malformed source that never reaches AST construction)
appear as findings without `location` or `code`.

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
| `-f, --format <format>` | `json`, `text`, `mermaid`, `paths`, `ascii`, `ascii-compact` | `json` |
| `-n, --node <id>` | Focus on a specific node | — |
| `--compile` | Also update runtime markers | `false` |
| `-w, --workflow <name>` | Specific workflow name | all |

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
| `-s, --stream` | Stream trace events in real time | `false` |
| `--json` | Output result as JSON | `false` |
| `--timeout <ms>` | Execution timeout in milliseconds | — |
| `--mocks <json>` | Mock config as JSON: `gates` (answers by node id), `events`, `agents`, `invocations`, `fast` | — |
| `--mocks-file <path>` | Path to JSON file with mock config | — |
| `-d, --debug` | Start in step-through debug mode | `false` |
| `-b, --breakpoint <nodeIds...>` | Set initial breakpoints (repeatable) | — |

**Examples:**
```bash
fw run workflow.ts --params '{"amount": 500}'
fw run workflow.ts --params-file input.json --trace
fw run workflow.ts --mocks '{"fast": true, "events": {"app/approved": {"status": "ok"}}}'
fw run workflow.ts --timeout 30000 --json
fw run workflow.ts --debug
fw run workflow.ts --debug --breakpoint processData --breakpoint validate
```

> See also: [Built-in Nodes](built-in-nodes) for mock configuration details and [Debugging](debugging) for live debug REPL commands.

**Gated workflows are refused.** A workflow containing `waitForEvent`, `waitForAgent`, or any `@durableGate` node yields a continuation instead of finishing, and `fw run` is not a coordinator that can persist one:

```
✗ Workflow execution failed: a workflow graph with durable gates requires
  coordinator-verified whole-bundle identity before execution
```

Drive such a workflow with the `fw_run` / `fw_resume` MCP tools (see [mcp-server](#mcp-server)) or from code via `executeWorkflow`. `--mocks` does not resolve a gate. See [Durable Gates](durable-gates).

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
| `-w, --workflow <name>` | Specific workflow name | all |
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
| `--target <target>` | `typescript`, or a target registered by an installed pack | `typescript` |
| `--framework <framework>` | Framework for the serve handler (pack targets) | `express` |
| `--port <port>` | Port for the dev server (pack targets) | `3000` |

**Examples:**
```bash
fw dev workflow.ts --params '{"input": "hello"}'
fw dev workflow.ts --once --json
fw dev workflow.ts --target <pack-target> --port 8080
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

### console

Open the local operator console: every workflow in the project as a process, its validation issues on the steps that carry them, the code behind each step, and runs live — including answering a durable gate from the page.

```bash
fw console [directory] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port | `4311` |
| `-H, --host <host>` | Host to bind | `127.0.0.1` |
| `--open` | Open the browser once listening | `false` |
| `--no-watch` | Do not reload when project files change | watch enabled |

**Examples:**
```bash
fw console
fw console ./workflows --open
```

Runs started here stream real execution events, so the process lights up step by step and a paused gate offers a form built from the port's TypeScript type. Runs live in the same store as `fw_run` and `fw_resume` (`~/.fw/runs`, or `FW_RUNS_DIR`): a gate reached in the console can be answered by an assistant over MCP and the other way round, a run waiting at a gate survives a restart of the console, and effects get receipts. The step trace is kept beside the record, so a run opened later still shows what each step did; a segment resumed over MCP keeps no trace, and the console says so rather than guessing. The console binds to localhost and re-reads a file as you save it.

> See also: [Durable Gates](durable-gates) for what pauses a run and how it resumes.

---

### agents

The agent profiles that answer agent gates in this project, and whether each is ready. A profile is ready when its provider is configured and the environment variable naming its key is set; the listing says which of those is missing rather than failing at the gate.

```bash
fw agents [directory] [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--init` | Write the starter `.flowweaver/agents.yaml` | `false` |
| `--force` | With `--init`: replace an existing file | `false` |
| `--json` | Output as JSON | `false` |

**Examples:**
```bash
fw agents
fw agents --init
```

> See also: [Durable Gates](durable-gates) for the `agents.yaml` format and how a profile is matched to a gate.

---

## Visualization

### diagram

Draw a workflow. `svg` is the spine the console shows — steps in run order, the control flow as lanes beside them (failure arms, loop bodies, steps read on demand) — as a vector image for a slide or a document. The text formats are for a terminal or a chat.

```bash
fw diagram <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --theme <theme>` | `dark` or `light` | `dark` |
| `-w, --workflow <name>` | Specific workflow | first |
| `-f, --format <format>` | `svg` (the spine as a vector image), `ascii`, `ascii-compact`, `text` | `svg` |
| `-o, --output <file>` | Write output to file | stdout |

**Examples:**
```bash
fw diagram workflow.ts
fw diagram workflow.ts --theme light -o diagram.svg
fw diagram workflow.ts --format ascii-compact
```

---

### artifact

Hand a workflow to a person who will not open the code.

```bash
fw artifact <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-k, --kind <kind>` | `brief` — the brief as a page: the graph first, large, each step clickable for what it does, what it reads and where its failure goes, then what goes in, what comes out and where a person or an agent is needed; `pdf` — a one-page overview (the graph beside what goes in, what comes out, the pauses and the failure arms) followed by every step in detail; `svg` — the spine as a vector image | `brief` |
| `-t, --theme <theme>` | `light` or `dark` | `light` |
| `-w, --workflow <name>` | Specific workflow | first |
| `--subtitle <text>` | Shown under the title | the folder name |
| `--browser <path>` | Browser to print the PDF with | the one found, or `FW_BROWSER` |
| `-o, --output <file>` | Write to a file; the brief and the SVG go to stdout otherwise | a PDF is written beside the workflow |

The PDF is printed by a Chromium-family browser already on the machine — Chrome, Chromium, Edge or Brave, found where the platform installs them, or named with `FW_BROWSER`. Without one the command says so; the HTML brief prints to PDF from any browser's print dialog. `fw console`'s Share menu produces the same three files.

**Examples:**
```bash
fw artifact workflow.ts -o workflow.brief.html
fw artifact workflow.ts --kind pdf
fw artifact workflow.ts --kind svg --theme dark -o workflow.svg
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
| `-w, --workflow <name>` | Specific workflow | all |
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

Also reports **Running services**: the `fw` processes alive on this machine (`mcp-server`, `serve`, `console`), each with its install, its client and its last activity, from the records they keep in `~/.fw/services/`. An MCP server running from a different install than the one checked is a warning. `fw_doctor` returns the same under `services`.

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

Adds a new node instance to the workflow. Warns if the node type isn't defined in the file.

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

## Deployment

### export

Export a workflow through a target provided by an installed pack. Flow Weaver core ships no export target; install one with `fw market search` / `fw market install`, then pass its name to `--target`.

```bash
fw export <input> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --target <target>` | Target name registered by an installed pack **(required)** | — |
| `-o, --output <path>` | Output directory **(required)** | — |
| `-w, --workflow <name>` | Specific workflow | — |
| `-p, --production` | Production mode | `true` |
| `--dry-run` | Preview without writing | `false` |
| `--multi` | Export all workflows as single service | `false` |
| `--workflows <names>` | Comma-separated workflow subset (with `--multi`) | all |
| `--docs` | Include API documentation routes | `false` |
| `--durable-steps` | Per-node durable steps; handed to the target as an option | `false` |

**Examples:**
```bash
fw export workflow.ts --target <name> --output dist/
fw export workflows.ts --target <name> --output api/ --multi --docs
fw export workflow.ts --target <name> --output dist/ --durable-steps
fw export workflow.ts --target <name> --output dist/ --dry-run
```

> Available targets depend on the installed packs (any package with a `flowweaver.manifest.json`; the package names stay as-is). See [Deployment](deployment) for installation instructions and target-specific details.

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

### docs topic

Read a documentation topic by passing its slug directly.

```bash
fw docs <topic> [options]
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
fw docs error-codes
fw docs scaffold --compact
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

Built-in presets: `core` (the `orientation` map alone, plus the list of every other topic to read on demand), `authoring` (orientation, concepts, grammar, annotations, built-in nodes, durable gates, scaffold, node-conversion), `ops` (orientation, library, CLI, MCP tools, compilation, deployment, export-interface, debugging, error-codes), `full` (all 20 topics).

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

## System

### mcp-server

Start MCP server for Claude Code integration.

```bash
fw mcp-server [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--stdio` | Run in MCP stdio mode | `false` |

**Running workflows over MCP.** Two tool families execute workflows; pick by who is calling.

| Tool | For | Notes |
|------|-----|-------|
| `fw_run` | AI assistants | Runs to completion or pauses at a gate, returning `{ runId, gate }` with inputs named by port |
| `fw_resume` | AI assistants | Continues a paused run with `answer` or `reject`; control ports are filled in |
| `fw_runs` | AI assistants | Lists runs, or inspects one |
| `fw_workflow_run` | Coordinators | Stateless; returns the raw continuation envelope |
| `fw_workflow_resume` | Coordinators | Stateless; requires the envelope, `gateId`, full resolution, and `bundleDigest` |

The `fw_run` family stores runs under `~/.fw/runs/<runId>/` (`FW_RUNS_DIR` overrides). Results carry no trace events or continuation. See [Durable Gates](durable-gates).

The full list of 35 tools, with which to prefer and how large their results are, is in [MCP Tools](mcp-tools).

---

### mcp-setup

Configure Flow Weaver's MCP server for supported AI coding tools.

```bash
fw mcp-setup [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--tool <tools...>` | Configure specific tools: Claude, Cursor, VS Code, Windsurf, Codex, or OpenClaw | — |
| `--all` | Configure all detected tools without prompting | `false` |
| `--list` | List detected tools without configuring | `false` |

---

## Global Flag

| Flag | Description |
|------|-------------|
| `-v, --version` | Output the current version |

---

## Related Topics

- [Concepts](concepts) — Fundamental workflow concepts
- [Compilation](compilation) — Compile targets and target options
- [Deployment](deployment) — Export, serve, and OpenAPI
- [Built-in Nodes](built-in-nodes) — delay, waitForEvent, invokeWorkflow, and mocks
- [Scaffold](scaffold) — Template details
- [Marketplace](marketplace) — Package ecosystem
- [Advanced Annotations](advanced-annotations) — Pull execution, merge strategies, and more
