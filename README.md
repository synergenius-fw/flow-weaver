# @synergenius/flow-weaver

[![License: ELv2-based](https://img.shields.io/badge/License-ELv2--based-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)

**Workflow compiler for AI agents.** LLMs create, validate, iterate, and test workflows programmatically — humans review them visually. The compiler outputs standalone TypeScript with zero runtime dependencies.

Flow Weaver turns standard TypeScript functions into executable workflow graphs using JSDoc annotations. No YAML. No JSON configs. No drag-and-drop. Just TypeScript with full type safety, IDE autocomplete, and compile-time validation — in a format that AI agents can read, write, and reason about. The compiled output is plain TypeScript that runs anywhere with no dependency on Flow Weaver.

## Why Flow Weaver?

**AI agents are great at generating code. They're terrible at generating reliable systems.**

Flow Weaver bridges this gap. Instead of generating monolithic scripts, an AI agent builds a typed, validated workflow graph — node by node — where every connection is type-checked, every required input is enforced, and every error path is explicit.

The development loop — steps 1–4 run autonomously with zero human intervention:

1. **AI creates** — the agent scaffolds a workflow from templates or builds one from scratch using 35+ MCP tools
2. **Compiler validates** — 15+ validation passes catch missing connections, type mismatches, unreachable paths, and agent-specific safety issues
3. **AI iterates** — validation errors include fix suggestions; the agent corrects and re-validates in a loop until the workflow compiles clean
4. **AI tests** — deterministic mock providers enable reproducible testing without real API calls
5. **Human reviews** — only at the end: the visual editor renders the workflow as an interactive graph for approval

This isn't a framework that happens to work with AI. It's a compiler built from the ground up for the agent-first development loop — and the compiled code is yours, with no runtime lock-in.

## Quick Start

### Install

```bash
npm install @synergenius/flow-weaver
```

### Define a workflow

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

### Compile and run

```bash
npx flow-weaver compile data-pipeline.ts    # generates executable code in-place
npx flow-weaver run data-pipeline.ts --params '{"rawData": "Hello World"}'
```

The compiler fills in the function body while preserving your code outside the generated markers.

## AI-Native Development with MCP

Flow Weaver ships an MCP server with 35+ tools that let Claude Code (or any MCP-compatible agent) build workflows without leaving the terminal:

```bash
npx flow-weaver mcp-server    # auto-registers with Claude Code
```

What an AI agent can do:

| Capability | MCP Tools |
|-----------|-----------|
| **Build** | `fw_scaffold`, `fw_modify`, `fw_modify_batch`, `fw_add_node`, `fw_connect` |
| **Validate** | `fw_validate` (with friendly error hints), `fw_doctor` |
| **Understand** | `fw_describe` (json/text/mermaid), `fw_query` (10 query types), `fw_diff` |
| **Test** | `fw_execute_workflow` (with trace), `fw_compile` |
| **Visualize** | `fw_diagram` (SVG), `fw_get_state`, `fw_focus_node` |
| **Deploy** | `fw_export` (Lambda, Vercel, Cloudflare, Inngest), `fw_compile --target inngest` |
| **Reuse** | `fw_list_patterns`, `fw_apply_pattern`, `fw_extract_pattern` |
| **Extend** | `fw_market_search`, `fw_market_install` |

The agent reads validation errors, understands what's wrong, and fixes it — in a loop — until the workflow compiles clean.

## Agent Workflow Templates

Flow Weaver has first-class support for building AI agent workflows — the kind where an LLM reasons, calls tools, and loops until done:

```bash
# Scaffold a tool-calling agent with memory and error handling
npx flow-weaver create workflow ai-agent my-agent.ts --provider openai --model gpt-4o

# ReAct pattern (Thought -> Action -> Observation loop)
npx flow-weaver create workflow ai-react react-agent.ts

# RAG pipeline (Retrieve -> Augment -> Generate)
npx flow-weaver create workflow ai-rag rag-pipeline.ts

# Durable agent with per-step retries (compiles to Inngest)
npx flow-weaver create workflow ai-agent-durable durable-agent.ts
```

**12 workflow templates** cover common patterns:

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

**12 node templates** for common node types: `llm-call`, `tool-executor`, `conversation-memory`, `prompt-template`, `json-extractor`, `human-approval`, `agent-router`, `rag-retriever`, `validator`, `transformer`, `http`, `aggregator`.

## Agent-Aware Validation

The validator understands AI agent patterns and enforces safety rules:

```
AGENT_LLM_MISSING_ERROR_HANDLER    LLM node's onFailure is unconnected — add error handling
AGENT_UNGUARDED_TOOL_EXECUTOR      Tool executor has no human-approval upstream — add a gate
AGENT_MISSING_MEMORY_IN_LOOP       Agent loop has LLM but no memory — conversations will be stateless
AGENT_LLM_NO_FALLBACK              LLM failure goes directly to Exit — add retry or fallback logic
AGENT_TOOL_NO_OUTPUT_HANDLING      Tool executor outputs are all unconnected — results are discarded
```

These aren't generic linting rules. The validator detects LLM, tool-executor, human-approval, and memory nodes via multi-signal heuristics (port signatures, annotations, naming patterns) and applies domain-specific checks.

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

Mock human approvals, fast-forward delays, and simulate external events — all configurable via `globalThis.__fw_mock_config__`.

## Scoped Ports: Agent Loops Without Cycles

Most workflow engines either ban loops (DAG-only) or allow arbitrary cycles (hard to reason about). Flow Weaver introduces **scoped ports** — a way to express iteration patterns without graph cycles:

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

The scope's output ports become callback parameters, and input ports become return values. This enables:
- Agent reasoning loops (LLM -> tools -> memory -> LLM)
- ForEach over collections
- Map/reduce patterns
- Nested sub-workflows

All while keeping the graph acyclic and statically analyzable.

## Multi-Target Compilation

Same workflow source, multiple deployment targets:

```bash
# Plain TypeScript (default)
flow-weaver compile workflow.ts

# Inngest durable functions (per-node step.run, retries, cron)
flow-weaver compile workflow.ts --target inngest --retries 3 --cron "0 9 * * *"

# Serverless exports
flow-weaver export workflow.ts --target lambda --output deploy/
flow-weaver export workflow.ts --target vercel --output deploy/
flow-weaver export workflow.ts --target cloudflare --output deploy/

# HTTP server with OpenAPI docs
flow-weaver serve ./workflows --port 3000 --swagger
```

Inngest compilation wraps each node in `step.run()` for individual durability, parallelizes independent nodes with `Promise.all()`, and generates typed Zod event schemas.

## Visual Human-in-the-Loop

Workflows compile from code, but humans review them visually:

```bash
# Generate SVG diagram
flow-weaver diagram workflow.ts -o workflow.svg --theme dark

# Describe structure for quick review
flow-weaver describe workflow.ts --format text

# Semantic diff between versions
flow-weaver diff workflow-v1.ts workflow-v2.ts
```

The Flow Weaver Studio provides a full visual editor with bidirectional sync — changes in the code update the canvas, changes on the canvas update the code. 80+ plugins handle canvas rendering, state management, minimap, undo/redo, and more.

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
| `@synergenius/flow-weaver/built-in-nodes` | delay, waitForEvent, invokeWorkflow |
| `@synergenius/flow-weaver/diagram` | SVG diagram layout and rendering |
| `@synergenius/flow-weaver/describe` | Programmatic workflow description |
| `@synergenius/flow-weaver/doc-metadata` | Documentation metadata extractors |

## CLI Reference

```bash
# Core
flow-weaver compile <file>           # Compile to TypeScript or Inngest
flow-weaver validate <file>          # Validate without compiling
flow-weaver run <file>               # Execute a workflow
flow-weaver dev <file>               # Watch + compile + run
flow-weaver describe <file>          # Structure output (json/text/mermaid)
flow-weaver diagram <file>           # Generate SVG diagram
flow-weaver diff <f1> <f2>           # Semantic workflow comparison

# Setup
flow-weaver init [directory]         # Create new project
flow-weaver create workflow <t> <f>  # Scaffold from template
flow-weaver create node <name> <f>   # Scaffold node type
flow-weaver templates                # List available templates
flow-weaver doctor                   # Check project compatibility
flow-weaver grammar                  # Output annotation grammar (EBNF/railroad)

# Deploy
flow-weaver serve [directory]        # HTTP server with Swagger UI
flow-weaver export <file>            # Export to Lambda/Vercel/Cloudflare/Inngest
flow-weaver openapi <directory>      # Generate OpenAPI spec

# Patterns
flow-weaver pattern list <path>      # List reusable patterns
flow-weaver pattern apply <p> <t>    # Apply pattern to workflow
flow-weaver pattern extract <src>    # Extract pattern from nodes

# Docs
flow-weaver docs                     # List documentation topics
flow-weaver docs read <topic>        # Read a topic
flow-weaver docs search <query>      # Search documentation

# Marketplace
flow-weaver market search [query]    # Search npm for packages
flow-weaver market install <pkg>     # Install a package
flow-weaver market list              # List installed packages

# IDE
flow-weaver mcp-server               # Start MCP server for Claude Code
flow-weaver listen                   # Stream editor events
```

## Built-in Nodes

| Node | Purpose |
|------|---------|
| `delay` | Sleep for a duration (ms, s, m, h, d). Mockable for fast testing. |
| `waitForEvent` | Wait for an external event with optional field matching and timeout. Maps to Inngest `step.waitForEvent()` for zero-cost durable pauses. |
| `invokeWorkflow` | Invoke another workflow by ID with payload and timeout. Maps to Inngest `step.invoke()`. |

## STEP Port Architecture

Every node follows a consistent contract:

```typescript
function nodeName(
  execute: boolean,    // Control input — should this node run?
  ...inputs            // Data inputs (typed)
): {
  onSuccess: boolean;  // Success control output
  onFailure: boolean;  // Failure control output
  ...outputs           // Data outputs (typed)
}
```

Expression nodes (`@expression`) skip the control flow boilerplate — inputs and outputs map directly to the TypeScript signature.

## Marketplace

Distribute node types, workflows, and patterns as npm packages:

```bash
flow-weaver market init my-nodes          # Scaffold a package
flow-weaver market pack                   # Validate and generate manifest
flow-weaver market publish                # Publish to npm
flow-weaver market install flowweaver-pack-openai   # Install
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Development

```bash
npm run build         # Build
npm run watch         # Watch mode
npm run typecheck     # Type check
npm run docs          # Generate API docs
```

## License

Custom license based on the Elastic License 2.0. See [LICENSE](./LICENSE) for full terms.

- **Free to use** — any individual or organization can install, run, and compile workflows
- **Free to host internally** for organizations with 15 or fewer people
- **Commercial license required** to host internally for organizations with more than 15 people — contact support@synergenius.pt
- **External hosting prohibited** — cannot be provided as a hosted/managed service to third parties without a commercial license
- **Output is unrestricted** — compiled workflows, generated code, and deployment artifacts are yours
