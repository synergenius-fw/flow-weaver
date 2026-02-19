---
description: Analyze and explain how workflows function
argument-hint: <analysis-question>
---

**USE CASE**: Understand workflow behavior, execution flow, dependencies, architecture - for onboarding, documentation, debugging, optimization.

First, use the Skill tool to invoke skills:

1. flow-weaver:flow-weaver-concepts
2. flow-weaver:flow-weaver-export-interface

Then explain: $ARGUMENTS

## Analysis Types

### 1. Workflow Overview

**Purpose**: Understand what a workflow does at high level

Process:

- Read the source file
- Analyze:
  - Export interface (@param/@returns annotations)
  - Node count and types (@node annotations)
  - Execution model (sync/async based on function keyword)
  - Purpose based on naming and structure
- Present summary:
  - What the workflow does
  - Key inputs and outputs
  - Main processing steps
  - Any notable patterns

### 2. Execution Flow

**Purpose**: Understand order of execution and control flow

Process:

- Read @connect annotations to trace connections
- Trace execution path:
  - Start from Start node
  - Follow STEP connections
  - Identify branches and loops
  - Note data flow through non-STEP connections
- Present:
  - Execution sequence
  - Control flow branches
  - Data flow paths
  - Parallel vs sequential execution

### 3. Dependency Analysis

**Purpose**: Understand what a node or export depends on

Process:

- Read the source file for @node definitions
- Analyze imports and external dependencies
- Trace connection chains
- Present:
  - Dependency tree/graph
  - Execution order implications
  - Performance considerations

### 4. Architecture Analysis

**Purpose**: Understand overall structure and design patterns

Process:

- Read the workflow file to list all exports
- For each export:
  - Get node count and complexity
  - Check dependencies
  - Identify relationships
- Present:
  - Architecture overview
  - Design patterns used
  - Complexity hotspots

### 5. Generated Code Analysis

**Purpose**: Understand the actual execution code

Process:

- Read the compiled source file (compilation modifies the file in-place)
- Analyze:
  - How node functions are embedded
  - Actual function signatures
  - Runtime behavior
- Present findings with code snippets

## Analysis Workflow

1. **Understand the Question**: What specifically needs explaining?
2. **Gather Information**:
   - Use `flow-weaver describe <file>` to get workflow structure as JSON
   - Read source files for implementation details
   - Check generated files for runtime behavior
3. **Analyze**: Process the gathered information
4. **Present**: Start high-level, add details as needed

### CLI Commands for Analysis

```bash
flow-weaver describe <file>                    # JSON structure
flow-weaver describe <file> --format text      # Human-readable
flow-weaver describe <file> --format mermaid   # Mermaid diagram
flow-weaver describe <file> --node <id>        # Focus on specific node
```

## Example Usage

- /fw-explain "What does the processData export do?"
- /fw-explain "Show me the execution flow of this workflow"
- /fw-explain "What's the overall architecture of this workflow file?"
