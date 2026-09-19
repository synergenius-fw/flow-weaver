---
name: MCP Tools
description: Every tool the Flow Weaver MCP server exposes, what each is for, which to prefer, and how large their results are
keywords: [mcp, tools, fw_run, fw_resume, fw_runs, fw_docs, fw_validate, fw_describe, fw_query, fw_diagram, fw_compile, fw_modify, fw_scaffold, fw_debug_workflow, fw_market_search, fw_context, mcp-server, mcp-setup, Claude Code, Cursor, assistant, tokens]
---

# MCP Tools

`fw mcp-server --stdio` exposes 35 tools and one prompt. Every tool definition is sent to the assistant on every turn — about 27 KB, or roughly 6,700 tokens, before any work happens — so this page also says which tools to reach for and which results are large.

- Register with an editor: `fw mcp-setup` (Claude Code, Cursor, VS Code, Windsurf, Codex, OpenClaw)
- Every result is JSON: `{ success: true, data }` or `{ success: false, error: { code, message } }`. The one exception is `fw_context`, whose result is the bundle itself as markdown
- Paths are resolved from the server's working directory; pass absolute paths when in doubt
- Sizes below are measured on a 3-node workflow; they scale with the workflow

## Choosing a tool

| Need | Use | Not |
|------|-----|-----|
| Is this file valid? | `fw_validate` (~100 B) | `fw_describe` |
| What nodes and connections are there? | `fw_query` with one query type (~300 B) | `fw_describe` (~2.3 KB) |
| Show the graph in chat | `fw_diagram` with `format: "ascii-compact"` (~240 B) | The default `svg` (markup, not readable) |
| Look something up | `fw_docs` with `action: "search"`, then `read` with `compact: true` | The `authoring`, `ops` and `full` presets of `fw_context` (75–195 KB) |
| Run a workflow | `fw_run`, then `fw_resume` if it pauses | `fw_workflow_run` (returns the raw continuation) |
| Change structure | `fw_modify_batch` for several edits, `fw_modify` for one | Rewriting the annotations by hand |
| Create a workflow | Write the file (node type functions + workflow stub), then `fw_validate` | A generator; there is none |

## Running workflows

| Tool | Arguments | Returns | Notes |
|------|-----------|---------|-------|
| `fw_run` | `filePath`, `workflowName?`, `params?` | `completed` + `result`, or `waiting` + `runId` + `gate` | Gate inputs are named by port. ~300–400 B |
| `fw_resume` | `runId`, one of `answer` / `reject` | Same shape | Control ports are filled in for you |
| `fw_runs` | `runId?`, `filePath?` | One run, or a list newest first | Re-read a pause without resuming |
| `fw_workflow_run` | `filePath`, `params?`, `workflowName?`, `runId?`, `bundleDigest?` | `{ kind, gate, continuation }` | For coordinators. The continuation is ~800 tokens per gate and must be sent back verbatim |
| `fw_workflow_resume` | `runId`, `filePath`, `continuation`, `gateId`, `resolution`, `bundleDigest`, … | Same | For coordinators |

See [Durable Gates](durable-gates) for what a gate is and the `answer` rules.

## Inspecting a workflow

| Tool | Arguments | Returns | Notes |
|------|-----------|---------|-------|
| `fw_validate` | `filePath`, `workflowName?`, `draft?` | `{ valid, errors, warnings }` | Cheapest check. Each item is `{ message, severity, code, nodeId? }` plus one of `hint` (a tool call to make next) or `fix`. `draft` suppresses `STUB_NODE` errors for unimplemented nodes |
| `fw_query` | `filePath`, `query`, `nodeId?`, `workflowName?` | Depends on `query` | `nodes`, `connections`, `deps`, `dependents`, `data-deps`, `execution-order`, `isolated`, `dead-ends`, `disconnected-outputs`, `node-types`. Ask one question, get one answer |
| `fw_describe` | `filePath`, `format?`, `node?`, `workflowName?` | Full structure + validation | `json` (default), `text`, `mermaid`, `paths`, `ascii`, `ascii-compact`. Everything at once; ~2 KB+ |
| `fw_diagram` | `filePath` or `source`, `format?`, `theme?`, `outputPath?` | Diagram | `svg` (default), `html`, `ascii` (~2 KB), `ascii-compact` (~240 B), `text`. Use `ascii-compact` in chat |
| `fw_diff` | `file1`, `file2`, `format?`, `workflowName?` | Semantic diff | `text` (default, ~3 KB box drawing) or `json` |
| `fw_find_workflows` | `directory`, `pattern?` | Files with `@flowWeaver workflow` and their metadata | Glob, default `**/*.ts`; ~500 ms per directory tree |

## Creating and editing

| Tool | Arguments | Returns | Notes |
|------|-----------|---------|-------|
| `fw_modify` | `filePath`, `operation`, `params`, `workflowName?`, `preview?` | Updated file + validation | `addNode`, `removeNode`, `renameNode`, `addConnection`, `removeConnection`, `setNodePosition`, `setNodeLabel`. Rewrites the JSDoc annotations only; a file that was already compiled in place is recompiled so its body stays consistent |
| `fw_modify_batch` | `filePath`, `operations`, `workflowName?`, `preview?` | Same | One parse/write/validate cycle for many operations. An `addConnection` that already exists is skipped with a warning, not an error |
| `fw_scaffold` | `template`, `filePath`, `name?`, `config?`, `preview?` | New workflow or node from a template | Templates are listed in [Scaffold](scaffold) |
| `fw_list_templates` | `type?` | Template catalogue (~4 KB) | Same content as the Scaffold topic |
| `fw_migrate` | `glob`, `dryRun?` | Files rewritten to current syntax | Parse → regenerate round-trip; use `dryRun` first |
| `fw_compile` | `filePath`, `write?`, `production?`, `target?`, … | Compiled output path or code | Only marker sections are regenerated. `cron`, `serve`, `framework`, `typedEvents`, `retries`, `timeout` are handed to a pack target; the default `typescript` target does not use them |
| `fw_export` | `filePath`, `target`, `outputDir?`, `preview?`, … | Deployment files | Targets come from installed packs; with none installed every target is `INVALID_TARGET` |

## Patterns

| Tool | Arguments | Returns |
|------|-----------|---------|
| `fw_list_patterns` | `filePath` | Patterns defined in a file |
| `fw_extract_pattern` | `sourceFile`, `nodes`, `name`, `outputFile?` | A reusable pattern from selected nodes; boundary ports are inferred |
| `fw_apply_pattern` | `patternFile`, `targetFile`, `patternName?`, `prefix?`, `preview?` | Pattern instantiated into a workflow |

See [Patterns](patterns).

## Debugging

Six tools share one in-memory session; the session ends with the server process and cannot resume a gate.

| Tool | Arguments | Notes |
|------|-----------|-------|
| `fw_debug_workflow` | `filePath`, `params?`, `breakpoints?`, `workflowName?` | Starts a session paused before the first node; returns `debugId` |
| `fw_debug_step` | `debugId` | Execute one node |
| `fw_debug_continue` | `debugId`, `toBreakpoint?` | Run to completion or next breakpoint |
| `fw_debug_inspect` | `debugId`, `nodeId?` | Variables without advancing |
| `fw_debug_set_variable` | `debugId`, `nodeId`, `portName`, `value`, `executionIndex?` | Override a value for downstream nodes |
| `fw_debug_breakpoint` | `debugId`, `action`, `nodeId?` | `add`, `remove`, `list` |
| `fw_list_debug_sessions` | — | Active sessions |

See [Debugging](debugging).

## Documentation and environment

| Tool | Arguments | Returns | Notes |
|------|-----------|---------|-------|
| `fw_docs` | `action` (`list` / `read` / `search`), `topic?`, `query?`, `compact?`, `limit?` | Topics, one topic, or matching sections | `list` returns slug, name and description (~4 KB for 20 topics). `search` returns the 8 best sections by default (`limit` up to 20, `total` says how many matched), each with an excerpt of at most 300 characters; `read` with `compact: true` drops prose and keeps headings, tables, lists, and code. Topics declared by installed packs are included |
| `fw_context` | `preset?`, `profile?`, `topics?`, `addTopics?`, `includeGrammar?` | The orientation bundle as markdown, ending with every other topic and its size | `core` (default) is the `orientation` topic plus the on-demand topic list, ~6 KB — the intended session start. `authoring` ≈ 75 KB, `ops` ≈ 100 KB, `full` ≈ 195 KB bundle whole references; prefer reading single topics with `fw_docs`. `includeGrammar` appends the generated EBNF (~3 KB), which `jsdoc-grammar` already covers |
| `fw_list_resources` | `type?` | Icons, colors, tags (~3.7 KB) | Same content as the Available Colors / Icons sections of [Advanced Annotations](advanced-annotations) |
| `fw_doctor` | `directory?` | Environment checks | Node version, config, dependencies |
| `fw_market_search` | `query`, `limit?`, `registryUrl?` | npm packages tagged as Flow Weaver packs | |
| `fw_market_install` | `package` | Installs via npm | Pack tools register on the next server start |
| `fw_market_list` | — | Installed packs and what they contribute | |

## The no-code prompt

The server also publishes one prompt, `flow-weaver-nocode`. It instructs the assistant to build workflows from plain-language descriptions by writing the workflow file itself, then `fw_validate` → `fw_diagram`, showing step summaries and ASCII diagrams instead of code unless asked.

## Related Topics

- [Durable Gates](durable-gates) — Running and resuming gated workflows
- [CLI Reference](cli-reference) — `mcp-server` and `mcp-setup`; most tools mirror a CLI command
- [Debugging](debugging) — The debug session tools in context
- [Scaffold](scaffold) — Template catalogue behind `fw_scaffold`
- [Patterns](patterns) — The pattern tools in context
