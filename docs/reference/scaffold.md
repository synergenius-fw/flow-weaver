---
name: Flow Weaver Scaffold
description: Scaffold workflows and nodes from templates using CLI commands
keywords: [scaffold, templates, create, generate, workflow, node, sequential, foreach, ai-agent]
---

# Quick Start

Use the `fw create` command to scaffold workflows and nodes from templates, or `fw init` to create a new project.

## Create a Project

```bash
fw init [directory] [options]
```

Creates a new Flow Weaver project with recommended structure, dependencies, and a starter workflow.

Options:
- `--name <name>` / `-n` - Project name (defaults to directory name)
- `--template <template>` / `-t` - Workflow template (default: `simple`)
- `--format <format>` / `-f` - Module format: `esm` or `cjs` (default: `esm`)
- `--yes` / `-y` - Skip prompts, use defaults
- `--install` / `--no-install` - Run or skip npm install
- `--git` / `--no-git` - Initialize or skip git repo
- `--force` - Overwrite existing files

```bash
fw init my-project
fw init --template ai-agent -y
fw init my-project --format cjs --no-git
```

## Create Workflow

```bash
fw create workflow <template> <file> [options]
```

Options:
- `--async` / `-a` - Generate async workflow
- `--line N` / `-l N` - Insert at specific line (default: append to end)
- `--preview` / `-p` - Preview generated code without writing
- `--provider <provider>` - LLM provider: `openai`, `anthropic`, `ollama`, `mock`
- `--model <model>` - Model identifier (e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`)
- `--name <name>` - Override the derived workflow function name
- `--nodes <names>` - Comma-separated node names (e.g., `"fetch,parse,store"`)
- `--input <name>` - Custom input port name (default: `data`)
- `--output <name>` - Custom output port name (default: `result`)
- `--config <json>` - Additional configuration as JSON

```bash
fw create workflow ai-agent agent.ts --provider openai --model gpt-4o
fw create workflow sequential pipeline.ts --nodes "fetch,parse,store" --async
```

## Create Node

```bash
fw create node <name> <file> [--template T] [--line N] [--preview]
```

Options:
<!-- AUTO:START default_node_template -->
- `--template T` / `-t T` - Use specific template (default: processor)
<!-- AUTO:END default_node_template -->
- `--line N` / `-l N` - Insert at specific line
- `--preview` / `-p` - Preview generated code without writing
- `--strategy <strategy>` - Template strategy (e.g., `mock`, `callback`, `webhook`)
- `--config <json>` - Additional configuration

## List Templates

```bash
fw templates [--json]
```

# Available Templates

## Workflow Templates

<!-- AUTO:START workflow_templates_table -->
| Template | Description |
|----------|-------------|
| `sequential` | Linear pipeline: validate -> transform -> output |
| `foreach` | Batch processing with iteration over arrays |
| `conditional` | Route data based on conditions with branching paths |
| `ai-agent` | Stateful LLM agent with explicit reasoning loop and tool execution |
| `ai-react` | Reasoning + Acting agent with explicit thought process |
| `ai-rag` | Retrieval-Augmented Generation for knowledge-based Q&A |
| `ai-chat` | Conversational AI with memory management |
| `aggregator` | Combine multiple data sources into one output |
| `webhook` | HTTP-triggered workflow with request/response handling |
| `error-handler` | Try/catch/retry pattern with error recovery |
<!-- AUTO:END workflow_templates_table -->

## Node Templates

<!-- AUTO:START node_templates_table -->
| Template | Description |
|----------|-------------|
| `validator` | Input validation with success/failure routing |
| `transformer` | Data transformation and mapping |
| `http` | Make HTTP requests to external APIs |
| `aggregator` | Combine multiple inputs into a single output |
| `llm-call` | Provider-agnostic LLM API call with tool support |
| `tool-executor` | Executes tool calls from LLM response |
| `conversation-memory` | Stores and retrieves conversation history |
| `prompt-template` | Interpolate variables into a prompt template string |
| `json-extractor` | Extract structured JSON from LLM text output |
| `human-approval` | Pause workflow and wait for human approval |
| `agent-router` | Route to different handlers based on a classification result |
| `rag-retriever` | Retrieve relevant documents via vector similarity search |
<!-- AUTO:END node_templates_table -->

# Examples

## Scaffold a workflow
```bash
fw create workflow sequential my-workflow.ts
fw validate my-workflow.ts
```

## Scaffold an AI agent
```bash
fw create workflow ai-agent agent.ts
```

## Add a node to existing file
```bash
fw create node validateInput my-workflow.ts -t validator
fw create node callLLM my-workflow.ts -t llm-call
```

## Insert at specific line
```bash
fw create workflow sequential my-file.ts --line 10
```

## Preview before writing
```bash
fw create workflow foreach my-workflow.ts --preview
fw create node myValidator file.ts -t validator --preview
```

# After Scaffolding

1. **Customize** - Replace TODO comments with your logic
2. **Validate** - Run `fw validate <file>`
3. **Compile** - Run `fw compile <file>`

See `fw docs iterative-development` for step-by-step workflow building.

## Related Topics

- `cli-reference` — Full command reference including all `create` and `init` flags
- `tutorial` — Step-by-step guide building a workflow from scratch
- `marketplace` — Install pre-built node types from the marketplace
