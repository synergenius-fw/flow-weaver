# Flow Weaver

[![npm version](https://img.shields.io/npm/v/@synergenius/flow-weaver?style=flat)](https://www.npmjs.com/package/@synergenius/flow-weaver)
[![npm downloads](https://img.shields.io/npm/dw/@synergenius/flow-weaver?style=flat)](https://www.npmjs.com/package/@synergenius/flow-weaver)
[![CI](https://img.shields.io/github/actions/workflow/status/synergenius-fw/flow-weaver/ci.yml?branch=main&style=flat)](https://github.com/synergenius-fw/flow-weaver/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/moraispgsi/305430ef59a51d0a58eb61fefdfbe634/raw/flow-weaver-test-count.json&style=flat)](https://github.com/synergenius-fw/flow-weaver/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/synergenius-fw/flow-weaver?style=flat)](https://codecov.io/gh/synergenius-fw/flow-weaver)
[![License: Flow Weaver Library License](https://img.shields.io/badge/License-Flow%20Weaver%20Library-blue?style=flat)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat)](https://nodejs.org)

**Build AI agent workflows visually. Ship them as your own code.**

Design agent workflows in the Studio, in TypeScript, or let AI build them for you. The compiler validates everything with 20+ rule categories. The output is standalone TypeScript you deploy anywhere, zero runtime dependency on Flow Weaver.

*Got an AGENTS.md or runbook? [Convert it to a typed workflow →](https://flowweaver.ai/services/md-converter)*

[**flowweaver.ai**](https://flowweaver.ai) · [**Open the Studio**](https://flowweaver.ai/studio) · [**Docs**](https://flowweaver.ai/docs) · [**Discord**](https://discord.gg/6Byh3ur2bk) · [**npm**](https://www.npmjs.com/package/@synergenius/flow-weaver)

---

## Your AGENTS.md is a workflow waiting to happen

You already wrote the steps, the branching logic, the edge cases. But it's a markdown file. It doesn't run, doesn't validate, and you can't see the full flow at a glance.

**Paste this:**

```markdown
# Code Review Agent

### 1. Analyze diff
Send the PR diff to an LLM for security, quality, and style review.

### 2. Classify severity
Critical (must fix) · Warning (should fix) · Suggestion (nice to have).

### 3. Route
Critical issues → request changes. Otherwise → approve with comments.
```

**Get this:**

<a href="https://htmlpreview.github.io/?https://github.com/synergenius-fw/flow-weaver/blob/main/docs/images/code-review-agent.html">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/code-review-agent-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/code-review-agent-light.svg">
  <img alt="Code Review Agent workflow diagram generated from AGENTS.md" src="docs/images/code-review-agent-dark.svg" width="100%">
</picture>
</a>

<sup>Click the diagram to open the interactive version (zoom, pan, inspect nodes).</sup>

The converter extracts the steps and decision points from your markdown and produces typed TypeScript plus a visual diagram. You can run it, test it, deploy it.

[**Try the converter →**](https://flowweaver.ai/services/md-converter) &ensp; Works with AGENTS.md, CLAUDE.md, Cursor rules, runbooks, SOPs, and any process doc.

---

## Try It

**In the browser.** Open the [Cloud Studio](https://flowweaver.ai/studio), sign up, and start building. No install required.

**From the terminal.**

```bash
npm install @synergenius/flow-weaver
npx fw init my-project
cd my-project
npx fw run workflows/example.ts --params '{"input": "value"}'
```

`fw` is the CLI command. `flow-weaver` also works as an alias.

## How It Works

**Generate.** Let AI build it for you, design visually in the Studio, or write annotated TypeScript by hand. All three stay in sync.

**Validate.** The compiler catches wiring errors, type mismatches, missing handlers, unreachable paths, and agent-specific mistakes before anything runs. Not at runtime, not in production.

**Own.** Compiled output is plain TypeScript with zero imports from Flow Weaver. Clean git diffs, standard testing, no license obligations on the output. If Flow Weaver disappeared tomorrow, your agents would still run.

## Three Ways to Build

**Studio.** A visual IDE that combines a full code editor with a graph builder. Write and refactor workflows in code or compose them on the canvas. Both representations stay synchronized: editing either one updates the other instantly.

**TypeScript.** Define workflows in plain TypeScript by annotating functions with JSDoc. The compiler derives an executable workflow graph with static typing and compile-time validation. No YAML, no JSON configuration, no runtime layer. Remove the annotations and you keep a clean TypeScript file with zero dependencies.

**AI Agents.** Connect Claude Code, Cursor, or OpenClaw and let agents scaffold, compile, fix validation errors, and iterate until the workflow works. Agents can also test with mock AI responses and generate diagrams for review.

## Quick Start

Workflows are plain TypeScript. Annotations declare the graph structure:

```typescript
// data-pipeline.ts

/**
 * @flowWeaver nodeType
 * @input rawData - string
 * @output cleaned - string
 * @output wordCount - number
 */
function processText(execute: boolean, rawData: string) {
  if (!execute) return { onSuccess: false, onFailure: false, cleaned: '', wordCount: 0 };
  const cleaned = rawData.trim().toLowerCase();
  return { onSuccess: true, onFailure: false, cleaned, wordCount: cleaned.split(/\s+/).length };
}

/**
 * @flowWeaver workflow
 * @node processor processText
 * @connect Start.rawData -> processor.rawData
 * @connect processor.cleaned -> Exit.cleaned
 * @connect processor.wordCount -> Exit.wordCount
 */
export async function dataPipeline(
  execute: boolean,
  params: { rawData: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; cleaned: string; wordCount: number }> {
  throw new Error('Not compiled');
}
```

```bash
npx fw compile data-pipeline.ts    # generates executable code in-place
npx fw run data-pipeline.ts --params '{"rawData": "Hello World"}'
```

The compiler fills in the function body while preserving your code outside the generated markers.

## AI-Native Development with MCP

Flow Weaver includes an MCP server with 48 tools for Claude Code, Cursor, OpenClaw, or any MCP-compatible agent:

```bash
npx fw mcp-server    # auto-registers with Claude Code
```

| Capability | MCP Tools |
|-----------|-----------|
| **Build** | `fw_scaffold`, `fw_modify`, `fw_modify_batch`, `fw_add_node`, `fw_connect` |
| **Model** | `fw_create_model`, `fw_workflow_status`, `fw_implement_node` |
| **Validate** | `fw_validate` (with friendly error hints), `fw_doctor` |
| **Understand** | `fw_describe` (json/text/mermaid), `fw_query` (10 query types), `fw_diff` |
| **Test** | `fw_execute_workflow` (with trace), `fw_compile` |
| **Visualize** | `fw_diagram` (SVG/HTML), `fw_get_state`, `fw_focus_node` |
| **Deploy** | `fw_export` (Lambda, Vercel, Cloudflare, Inngest, GitHub Actions, GitLab CI — via packs), `fw_compile --target inngest` |
| **Reuse** | `fw_list_patterns`, `fw_apply_pattern`, `fw_extract_pattern` |
| **Extend** | `fw_market_search`, `fw_market_install` |

## Model-Driven Workflows

Design first, implement later. Describe the workflow shape (nodes, ports, execution path) and the compiler generates a valid skeleton with `declare function` stubs:

```bash
# Via MCP: fw_create_model with nodes, inputs/outputs, and execution path
# Via CLI:
npx fw status my-workflow.ts      # shows stub vs implemented progress
npx fw implement my-workflow.ts processData   # scaffolds a node body
```

The graph is valid before any node has a real implementation. Fill in node bodies incrementally, check `status` to track progress. The architect defines the shape, developers fill in the logic.

## Agent Workflow Templates

Built-in templates for AI agent workflows:

```bash
npx fw create workflow ai-agent my-agent.ts --provider openai --model gpt-4o
npx fw create workflow ai-react react-agent.ts
npx fw create workflow ai-rag rag-pipeline.ts
npx fw create workflow ai-agent-durable durable-agent.ts
```

**12 workflow templates:**

| Template | What it builds |
|----------|---------------|
| `ai-agent` | Tool-calling agent with explicit loop and termination semantics |
| `ai-react` | ReAct agent (Thought -> Action -> Observation) |
| `ai-rag` | Retrieval-Augmented Generation pipeline |
| `ai-chat` | Stateful conversational AI with memory |
| `ai-agent-durable` | Durable agent pipeline with Inngest step-level retries |
| `ai-pipeline-durable` | Multi-step AI pipeline with durability |
| `sequential` | Linear data pipeline |
| `foreach` | Iteration over collections |
| `conditional` | Branching logic |
| `aggregator` | Multi-source aggregation |
| `webhook` | HTTP event handler |
| `error-handler` | Error recovery pattern |

Plus **12 node templates** for common building blocks: `llm-call`, `tool-executor`, `conversation-memory`, `prompt-template`, `json-extractor`, `human-approval`, `agent-router`, `rag-retriever`, `validator`, `transformer`, `http`, `aggregator`.

## Compile-Time Validation

The validator understands AI agent patterns and enforces safety rules:

```
AGENT_LLM_MISSING_ERROR_HANDLER    LLM node's onFailure is unconnected, add error handling
AGENT_UNGUARDED_TOOL_EXECUTOR      Tool executor has no human-approval upstream, add a gate
AGENT_MISSING_MEMORY_IN_LOOP       Agent loop has LLM but no memory, conversations will be stateless
AGENT_LLM_NO_FALLBACK              LLM failure goes directly to Exit, add retry or fallback logic
AGENT_TOOL_NO_OUTPUT_HANDLING      Tool executor outputs are all unconnected, results are discarded
```

These are not generic lint rules. The validator identifies LLM, tool-executor, human-approval, and memory nodes by port signatures, annotations, and naming patterns, then applies agent-specific checks.

## Deterministic Agent Testing

Test LLM workflows without real API calls:

```typescript
import { createMockLlmProvider, createRecordingProvider, loadRecording } from '@synergenius/flow-weaver/testing';

// Mock: deterministic responses for CI
const mock = createMockLlmProvider([
  { content: 'I need to search for that.', toolCalls: [{ name: 'search', args: { q: 'test' } }] },
  { content: 'Based on the results, the answer is 42.' },
]);

// Record: capture real LLM calls, replay later
const recorder = createRecordingProvider(realProvider);
// ... run workflow ...
saveRecording(recorder.getRecording(), 'fixtures/agent-session.json');

// Replay: reproducible tests from recorded sessions
const replay = loadRecording('fixtures/agent-session.json');
```

Mock human approvals, fast-forward delays, and simulate external events. Configured via `globalThis.__fw_mock_config__`.

## Scoped Ports: Agent Loops Without Graph Cycles

Most workflow engines either ban loops entirely (DAG-only) or allow arbitrary cycles that are hard to reason about. Flow Weaver takes a third path: **scoped ports** express iteration while keeping the graph acyclic and statically analyzable.

```typescript
/**
 * @flowWeaver workflow
 * @node agent llmCall
 * @node tools toolExecutor
 * @node memory conversationMemory
 * @scope agent, tools, memory           // these nodes iterate together
 * @connect agent.toolCalls -> tools.calls
 * @connect tools.results -> memory.input
 * @connect memory.history -> agent.context
 */
```

The scope's output ports become callback parameters, and input ports become return values. Agent reasoning loops, ForEach over collections, map/reduce patterns, and nested sub-workflows all work without introducing graph cycles.

## Deploy Anywhere

Same workflow source, multiple deployment targets. Export targets are provided by marketplace packs — install the ones you need:

```bash
npm install @synergenius/flow-weaver-pack-lambda @synergenius/flow-weaver-pack-vercel \
  @synergenius/flow-weaver-pack-cloudflare @synergenius/flow-weaver-pack-inngest \
  @synergenius/flow-weaver-pack-github-actions @synergenius/flow-weaver-pack-gitlab-ci
```

```bash
# Plain TypeScript (default)
fw compile workflow.ts

# Inngest durable functions (per-node step.run, retries, cron)
fw compile workflow.ts --target inngest --retries 3 --cron "0 9 * * *"

# Serverless exports
fw export workflow.ts --target lambda --output deploy/
fw export workflow.ts --target vercel --output deploy/
fw export workflow.ts --target cloudflare --output deploy/

# CI/CD pipelines
fw export workflow.ts --target github-actions --output .github/workflows/
fw export workflow.ts --target gitlab-ci --output .

# HTTP server with OpenAPI docs
fw serve ./workflows --port 3000 --swagger
```

Both the default TypeScript target and Inngest target parallelize independent nodes with `Promise.all()`. Inngest additionally wraps each node in `step.run()` for individual durability and generates typed Zod event schemas.

## Diagram Generation

Generate SVG or interactive HTML diagrams from any workflow:

```bash
fw diagram workflow.ts -o workflow.svg --theme dark
fw diagram workflow.ts -o workflow.html --format html
```

Customize node appearance with annotations:

```typescript
/**
 * @flowWeaver nodeType
 * @color blue
 * @icon database
 */
```

Named colors: `blue`, `purple`, `green`, `cyan`, `orange`, `pink`, `red`, `yellow`. Icons include `api`, `database`, `shield`, `brain`, `cloud`, `search`, `code`, and 60+ more from Material Design 3. The interactive HTML viewer supports zoom/pan, click-to-inspect nodes, and port-level hover with connection tracing.

## API

```typescript
import {
  parseWorkflow,      // Parse workflow file to AST
  compileWorkflow,    // Parse + validate + generate in one step
  validateWorkflow,   // Validate AST (returns errors and warnings)
  generateCode,       // Generate code from AST
  generateInPlace,    // Regenerate only the compiled markers in-place
} from '@synergenius/flow-weaver';

// Full compilation
const { code, ast, errors } = await compileWorkflow('workflow.ts');

// Step by step
const { ast } = await parseWorkflow('workflow.ts');
const { errors, warnings } = validateWorkflow(ast);
const code = generateCode(ast);
```

### Package Exports

| Import Path | Purpose |
|-------------|---------|
| `@synergenius/flow-weaver` | Parse, validate, compile, generate, AST types, builders, diff, patterns |
| `@synergenius/flow-weaver/runtime` | Execution context, errors, function registry for generated code |
| `@synergenius/flow-weaver/testing` | Mock LLM/approval providers, recording/replay, assertions, token tracking |
| `@synergenius/flow-weaver/built-in-nodes` | delay, waitForEvent, waitForAgent, invokeWorkflow |
| `@synergenius/flow-weaver/diagram` | SVG/HTML diagram layout and rendering |
| `@synergenius/flow-weaver/ast` | AST types and utilities |
| `@synergenius/flow-weaver/api` | Programmatic workflow manipulation API |
| `@synergenius/flow-weaver/diff` | Semantic workflow diffing |
| `@synergenius/flow-weaver/deployment` | Deployment base classes, registry, and CI/CD utilities |
| `@synergenius/flow-weaver/marketplace` | Marketplace package utilities |
| `@synergenius/flow-weaver/editor` | Editor completions and suggestions |
| `@synergenius/flow-weaver/browser` | JSDoc port sync for browser environments |
| `@synergenius/flow-weaver/describe` | Programmatic workflow description |
| `@synergenius/flow-weaver/doc-metadata` | Documentation metadata extractors |

## CLI Reference

```bash
# Core
fw compile <file>           # Compile to TypeScript or Inngest
fw validate <file>          # Validate without compiling
fw run <file>               # Execute a workflow
fw dev <file>               # Watch + compile + run
fw strip <file>             # Remove generated code sections
fw describe <file>          # Structure output (json/text/mermaid)
fw diagram <file>           # Generate SVG or interactive HTML diagram
fw diff <f1> <f2>           # Semantic workflow comparison

# Model-driven
fw status <file>            # Show stub vs implemented progress
fw implement <file> <node>  # Scaffold a node body from its stub

# Scaffolding
fw init [directory]         # Create new project
fw create workflow <t> <f>  # Scaffold from template
fw create node <name> <f>   # Scaffold node type
fw templates                # List available templates
fw doctor                   # Check project compatibility
fw grammar                  # Output annotation grammar (EBNF/railroad)

# Deploy
fw serve [directory]        # HTTP server with Swagger UI
fw export <file>            # Export to Lambda/Vercel/Cloudflare/Inngest/GitHub Actions/GitLab CI (via packs)
fw openapi <directory>      # Generate OpenAPI spec

# Patterns
fw pattern list <path>      # List reusable patterns
fw pattern apply <p> <t>    # Apply pattern to workflow
fw pattern extract <src>    # Extract pattern from nodes

# Docs
fw docs                     # List documentation topics
fw docs read <topic>        # Read a topic
fw docs search <query>      # Search documentation

# Marketplace
fw market search [query]    # Search npm for packages
fw market install <pkg>     # Install a package
fw market list              # List installed packages
fw market init <name>       # Scaffold a marketplace package
fw market pack              # Validate and generate manifest
fw market publish           # Publish to npm

# Editor / IDE
fw mcp-server               # Start MCP server for Claude Code
fw listen                   # Stream editor events
fw changelog                # Generate changelog from git history
fw migrate <glob>           # Run migration transforms on workflow files
fw plugin init <name>       # Scaffold an external plugin
```

## Built-in Nodes

| Node | Purpose |
|------|---------|
| `delay` | Sleep for a duration (ms, s, m, h, d). Mockable for fast testing. |
| `waitForEvent` | Wait for an external event with optional field matching and timeout. Maps to Inngest `step.waitForEvent()` for zero-cost durable pauses. |
| `waitForAgent` | Pause execution and wait for an external agent to provide a result. Supports multi-step human-in-the-loop and agent delegation patterns. |
| `invokeWorkflow` | Invoke another workflow by ID with payload and timeout. Maps to Inngest `step.invoke()`. |

## STEP Port Architecture

Every node follows a consistent contract:

```typescript
function nodeName(
  execute: boolean,    // Control: should this node run?
  ...inputs            // Data inputs (typed)
): {
  onSuccess: boolean;  // Success control output
  onFailure: boolean;  // Failure control output
  ...outputs           // Data outputs (typed)
}
```

Expression nodes (`@expression`) skip the control flow boilerplate. Inputs and outputs map directly to the TypeScript signature.

## Flow Weaver Cloud

[flowweaver.ai](https://flowweaver.ai) is the hosted platform that adds collaboration, managed deployments, and team features on top of everything the CLI provides.

What the cloud adds:

- **Browser-based Studio** with real-time collaborative editing
- **One-click deployment** of any workflow as an HTTP endpoint
- **Execution logs** for every workflow run, with input/output history
- **Visual debugger** for step-through node inspection (Pro)
- **Version history** and workflow snapshots (Pro)
- **AI Chat assistant** for building and debugging workflows (Pro)
- **Organization workspaces** with team management (Business)

Three tiers: **Free** (3 workflows, 1 deployment, 100 executions/month), **Pro** at 9 EUR/month (25 workflows, 10k executions), and **Business** at 29 EUR/month (unlimited workflows, 100k executions). See [flowweaver.ai/pricing](https://flowweaver.ai/pricing) for details.

The CLI remains fully functional for local development. The cloud adds the parts that are hard to do alone: team collaboration, always-on endpoints, and operational visibility.

## Community

- [Discord](https://discord.gg/6Byh3ur2bk)
- [GitHub Discussions](https://github.com/synergenius-fw/flow-weaver/discussions)
- [X / Twitter](https://x.com/flowweaver_ai)
- [Website](https://flowweaver.ai)

## Development

```bash
npm run build         # Build
npm run watch         # Watch mode
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run typecheck     # Type check
npm run docs          # Generate API docs
```

## License

Licensed under the Flow Weaver Library License. See [LICENSE](./LICENSE) for full terms.

- **Free to use**: install, run, and compile workflows in any organization
- **Free to host internally** for organizations with 15 or fewer people
- **Commercial license required** to host internally for 16+ people (contact support@synergenius.pt)
- **External hosting prohibited** without a commercial license
- **Output is unrestricted**: compiled workflows, generated code, and deployment artifacts are yours
