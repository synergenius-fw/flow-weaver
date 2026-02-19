---
description: Create a new Flow Weaver workflow with proper setup
argument-hint: [template] <file> [options]
---

First, use the Skill tool to invoke:

1. flow-weaver:flow-weaver-concepts
2. flow-weaver:flow-weaver-scaffold (for template reference)

Then guide the user through workflow creation with the following questionnaire-driven approach:

## Step 1: Understand the User's Goal

Ask the user what their workflow should do. If they haven't specified:

1. **What is the workflow's purpose?** (e.g., "process CSV files", "call an API and transform results", "validate and route data")
2. **What topology fits best?**
   - **Sequential** - Linear pipeline (A -> B -> C)
   - **Conditional** - Branch based on conditions (if/else routing)
   - **ForEach** - Process items in a collection
   - **Aggregator** - Combine multiple data sources
   - **Error Handler** - Try/catch/retry pattern
   - **AI Agent** - LLM with tool calling

## Step 2: Determine Node Structure

Ask about the processing steps:

3. **How many processing steps?** (e.g., 3 nodes: validate, transform, output)
4. **What should each node be named?** (use descriptive function names like `fetchData`, `parseResponse`, `storeResult`)
5. **What are the inputs and outputs?** (main data flowing through the pipeline)

## Step 3: Generate the Workflow

Based on answers, use one of two approaches:

### Approach A: Template + Customize (when a template matches)

If the topology maps to a template, scaffold it with customization:

```
Use fw_scaffold tool with:
- template: "sequential" (or matching template)
- filePath: <target file>
- name: <workflow function name>
- config: { nodes: ["fetchData", "parseResponse", "storeResult"], input: "rawData", output: "processedData" }
```

Then use `fw_modify` or `fw_modify_batch` to adjust:

- Add/remove nodes
- Rewire connections
- Set positions

### Approach B: Build from Scratch (for custom topologies)

1. Create the file with `fw_scaffold` using the closest template
2. Use `fw_modify_batch` to reshape:
   - Remove default nodes that don't fit
   - Add custom nodes
   - Wire connections appropriately

## Step 4: Validate and Report

1. Use `fw_validate` to check the workflow
2. Use `fw_describe` to show the structure
3. Report:
   - File path created/modified
   - Workflow function name
   - Node count and names
   - Next steps:
     - Customize TODO comments with actual logic
     - Run `flow-weaver compile <file>` to generate executable
     - Test with `fw_execute_workflow` tool

## Available Templates

| Template | Topology | Best For |
|---|---|---|
| sequential | Linear pipeline | ETL, data processing, validation chains |
| foreach | Batch iteration | Processing collections, bulk operations |
| conditional | If/else branching | Routing, filtering, decision trees |
| ai-agent | LLM + tools | AI assistants, chatbots |
| ai-react | ReAct loop | Reasoning agents |
| ai-rag | RAG pipeline | Knowledge retrieval |
| ai-chat | Conversation | Chat interfaces |
| ai-agent-durable | Durable AI agent | Inngest-ready AI agents |
| ai-pipeline-durable | Durable pipeline | Inngest-ready data pipelines |
| aggregator | Multi-source merge | Data aggregation |
| webhook | HTTP handler | API endpoints |
| error-handler | Try/catch/retry | Fault-tolerant operations |

## Examples

```bash
# Template-based with customization
/fw-create sequential ./etl-pipeline.ts --nodes "extract,transform,load" --input "source" --output "loaded"

# Sequential starting point
/fw-create sequential ./my-workflow.ts

# AI agent
/fw-create ai-agent ./agent.ts --async

# No template specified - questionnaire mode
/fw-create ./my-workflow.ts
```

## Key Principle

Don't just wrap templates - understand the user's intent and generate a workflow that matches their actual use case. Use `fw_modify_batch` to make multiple adjustments in a single operation for efficiency.
