---
name: Flow Weaver Scaffold
description: Scaffold workflows and nodes from templates using CLI commands
---

# Quick Start

Use the `flow-weaver create` command to scaffold workflows and nodes from templates.

## Create Workflow

```bash
flow-weaver create workflow <template> <file> [--async] [--line N] [--preview]
```

Options:
- `--async` / `-a` - Generate async workflow
- `--line N` / `-l N` - Insert at specific line (default: append to end)
- `--preview` / `-p` - Preview generated code without writing

## Create Node

```bash
flow-weaver create node <name> <file> [--template T] [--line N] [--preview]
```

Options:
- `--template T` / `-t T` - Use specific template (default: validator)
- `--line N` / `-l N` - Insert at specific line
- `--preview` / `-p` - Preview generated code without writing

## List Templates

```bash
flow-weaver templates [--json]
```

# Available Templates

## Workflow Templates

| Template | Description |
|----------|-------------|
| `sequential` | Linear pipeline: validate → transform → output |
| `foreach` | Batch iteration with scoped ports |
| `conditional` | Route data based on conditions |
| `ai-agent` | Stateful LLM agent with tool execution |
| `ai-react` | Reasoning + Acting agent loop |
| `ai-rag` | Retrieval-Augmented Generation pipeline |
| `ai-chat` | Conversational AI with memory |
| `ai-agent-durable` | Durable AI agent (Inngest-ready) |
| `ai-pipeline-durable` | Durable data pipeline (Inngest-ready) |
| `aggregator` | Combine multiple data sources |
| `webhook` | HTTP-triggered request/response |
| `error-handler` | Try/catch/retry with error recovery |

## Node Templates

| Template | Description |
|----------|-------------|
| `validator` | Input validation with success/failure routing |
| `transformer` | Data transformation and mapping |
| `http` | HTTP request with method, headers, body |
| `aggregator` | Combine multiple inputs |
| `llm-call` | Provider-agnostic LLM API call with tool support |
| `tool-executor` | Execute tool calls from LLM response |
| `conversation-memory` | Store and retrieve conversation history |
| `prompt-template` | Interpolate variables into prompt strings |
| `json-extractor` | Extract structured JSON from LLM text |
| `human-approval` | Pause workflow for human approval |
| `agent-router` | Route to handlers based on classification |
| `rag-retriever` | Retrieve documents via vector similarity |

# Examples

## Scaffold a workflow
```bash
flow-weaver create workflow sequential my-workflow.ts
flow-weaver validate my-workflow.ts
```

## Scaffold an AI agent
```bash
flow-weaver create workflow ai-agent agent.ts
```

## Add a node to existing file
```bash
flow-weaver create node validateInput my-workflow.ts -t validator
flow-weaver create node callLLM my-workflow.ts -t llm-call
```

## Insert at specific line
```bash
flow-weaver create workflow sequential my-file.ts --line 10
```

## Preview before writing
```bash
flow-weaver create workflow foreach my-workflow.ts --preview
flow-weaver create node myValidator file.ts -t validator --preview
```

# After Scaffolding

1. **Customize** - Replace TODO comments with your logic
2. **Validate** - Run `flow-weaver validate <file>`
3. **Compile** - Run `flow-weaver compile <file>`

See `flow-weaver:flow-weaver-iterative-development` for step-by-step workflow building.
