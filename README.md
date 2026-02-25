# @synergenius/flow-weaver

[![npm version](https://img.shields.io/npm/v/@synergenius/flow-weaver.svg)](https://www.npmjs.com/package/@synergenius/flow-weaver)
[![License: Flow Weaver Library License](https://img.shields.io/badge/License-Flow%20Weaver%20Library-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)

**Build AI agent workflows visually. Ship them as your own code.**

Design agent workflows in the Studio, in TypeScript, or let AI build them for you. Everything compiles to standalone functions you deploy anywhere — no runtime dependency on Flow Weaver.

## Three Ways to Build

**Studio** — Drag, drop, connect. The visual editor renders your workflow as an interactive graph with bidirectional sync: canvas changes write code, code changes update the canvas. 80+ plugins handle rendering, state, minimap, undo/redo, and more.

**TypeScript** — Annotate plain functions with JSDoc tags. The compiler turns them into executable workflow graphs with full type safety, IDE autocomplete, and compile-time validation. No YAML, no JSON configs.

**AI Agents** — Connect Claude Code, Cursor, or OpenClaw and they scaffold, validate, and ship workflows using 30+ MCP tools. The agent reads validation errors, fixes issues, and re-validates until the workflow compiles clean. The development loop (steps 1-4 are fully autonomous):

1. **Agent creates** — scaffolds from templates, builds from a model, or writes from scratch
2. **Compiler validates** — 15+ validation passes catch missing connections, type mismatches, unreachable paths
3. **Agent iterates** — validation errors include fix suggestions, the agent corrects and re-validates
4. **Agent tests** — deterministic mock providers for reproducible testing without real API calls
5. **Human reviews** — visual editor or SVG diagram for final approval

## Quick Start

```bash
npm install @synergenius/flow-weaver
```

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
npx flow-weaver compile data-pipeline.ts    # generates executable code in-place
npx flow-weaver run data-pipeline.ts --params '{"rawData": "Hello World"}'
```

The compiler fills in the function body while preserving your code outside the generated markers.

## AI-Native Development with MCP

Flow Weaver includes an MCP server for Claude Code, Cursor, OpenClaw, or any MCP-compatible agent:

```bash
npx flow-weaver mcp-server    # auto-registers with Claude Code
```

| Capability | MCP Tools |
|-----------|-----------|
| **Build** | `fw_scaffold`, `fw_modify`, `fw_modify_batch`, `fw_add_node`, `fw_connect` |
| **Model** | `fw_create_model`, `fw_workflow_status`, `fw_implement_node` |
| **Validate** | `fw_validate` (with friendly error hints), `fw_doctor` |
| **Understand** | `fw_describe` (json/text/mermaid), `fw_query` (10 query types), `fw_diff` |
| **Test** | `fw_execute_workflow` (with trace), `fw_compile` |
| **Visualize** | `fw_diagram` (SVG/HTML), `fw_get_state`, `fw_focus_node` |
| **Deploy** | `fw_export` (Lambda, Vercel, Cloudflare, Inngest), `fw_compile --target inngest` |
| **Reuse** | `fw_list_patterns`, `fw_apply_pattern`, `fw_extract_pattern` |
| **Extend** | `fw_market_search`, `fw_market_install` |

## Model-Driven Workflows

Design first, implement later. An agent (or a human) describes the workflow shape — nodes, ports, execution path — and the compiler generates a structurally valid skeleton with `declare function` stubs:

```bash
# Via MCP: fw_create_model with nodes, inputs/outputs, and execution path
# Via CLI:
npx flow-weaver status my-workflow.ts      # shows stub vs implemented progress
npx flow-weaver implement my-workflow.ts processData   # scaffolds a node body
```

The graph is valid before any node has a real implementation. Developers fill in node bodies incrementally, checking `status` to track progress. This separates architecture from implementation — the architect defines the shape, developers fill in the logic.

## Agent Workflow Templates

Built-in templates for AI agent workflows (LLM reasoning, tool calling, looping):

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

Not generic lint rules. The validator identifies LLM, tool-executor, human-approval, and memory nodes by port signatures, annotations, and naming patterns, then applies agent-specific checks.

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

## Scoped Ports: Agent Loops Without Cycles

Most workflow engines either ban loops (DAG-only) or allow arbitrary cycles (hard to reason about). Flow Weaver uses **scoped ports** to express iteration without graph cycles:

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

The scope's output ports become callback parameters, and input ports become return values. This enables agent reasoning loops, ForEach over collections, map/reduce patterns, and nested sub-workflows — all while keeping the graph acyclic and statically analyzable.

## Diagram Generation

Generate SVG or interactive HTML diagrams from any workflow:

```bash
flow-weaver diagram workflow.ts -o workflow.svg --theme dark
flow-weaver diagram workflow.ts -o workflow.html --format html
```

Customize node appearance with annotations:

```typescript
/**
 * @flowWeaver nodeType
 * @color blue
 * @icon database
 */
```

Named colors: `blue`, `purple`, `green`, `cyan`, `orange`, `pink`, `red`, `yellow`. Icons include `api`, `database`, `shield`, `brain`, `cloud`, `search`, `code`, and 60+ more from Material Design 3.

The interactive HTML viewer supports zoom/pan, click-to-inspect nodes, port-level hover with connection tracing, and works standalone or embedded in an iframe.

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

Both the default TypeScript target and Inngest target parallelize independent nodes with `Promise.all()`. Inngest additionally wraps each node in `step.run()` for individual durability and generates typed Zod event schemas.

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
| `@synergenius/flow-weaver/deployment` | Multi-target deployment generators |
| `@synergenius/flow-weaver/marketplace` | Marketplace package utilities |
| `@synergenius/flow-weaver/editor` | Editor completions and suggestions |
| `@synergenius/flow-weaver/browser` | JSDoc port sync for browser environments |
| `@synergenius/flow-weaver/describe` | Programmatic workflow description |
| `@synergenius/flow-weaver/doc-metadata` | Documentation metadata extractors |

## CLI Reference

```bash
# Core
flow-weaver compile <file>           # Compile to TypeScript or Inngest
flow-weaver validate <file>          # Validate without compiling
flow-weaver run <file>               # Execute a workflow
flow-weaver dev <file>               # Watch + compile + run
flow-weaver strip <file>             # Remove generated code sections
flow-weaver describe <file>          # Structure output (json/text/mermaid)
flow-weaver diagram <file>           # Generate SVG or interactive HTML diagram
flow-weaver diff <f1> <f2>           # Semantic workflow comparison

# Model-driven
flow-weaver status <file>            # Show stub vs implemented progress
flow-weaver implement <file> <node>  # Scaffold a node body from its stub

# Scaffolding
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
flow-weaver market init <name>       # Scaffold a marketplace package
flow-weaver market pack              # Validate and generate manifest
flow-weaver market publish           # Publish to npm

# Editor / IDE
flow-weaver mcp-server               # Start MCP server for Claude Code
flow-weaver listen                   # Stream editor events
flow-weaver changelog                # Generate changelog from git history
flow-weaver migrate <glob>           # Run migration transforms on workflow files
flow-weaver plugin init <name>       # Scaffold an external plugin
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

Licensed under the Flow Weaver Library License. See [LICENSE](./LICENSE) for full terms.

- **Free to use**: install, run, and compile workflows in any organization
- **Free to host internally** for organizations with 15 or fewer people
- **Commercial license required** to host internally for 16+ people (contact support@synergenius.pt)
- **External hosting prohibited** without a commercial license
- **Output is unrestricted**: compiled workflows, generated code, and deployment artifacts are yours
