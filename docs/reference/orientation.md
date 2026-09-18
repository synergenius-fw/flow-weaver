---
name: Orientation
description: The Flow Weaver model on one page, the tool loop, and which topic to read for which task — start here and load the rest on demand
keywords: [orientation, start, overview, mental model, getting started, map, which topic, first, basics, workflow, nodeType, annotations, tools, loop]
---

# Orientation

Flow Weaver compiles workflows you describe with JSDoc annotations into plain TypeScript functions. This page is the map: what the pieces are, how to work on them with the tools, and which reference topic to open next. Read it once; load other topics only when a task needs them.

## The model

- A **node type** is a plain function annotated `@flowWeaver nodeType @expression`, and that one line is the whole annotation. Ports are inferred from the signature: each parameter is an input port, each field of the returned object an output port (a primitive return is one port, `result`). Add `@input`/`@output`/`@label` only to override the inference — a description, a rename, an order, a display label — never to restate it. Throwing marks the node failed and propagates the error out of the workflow call. Normal mode, with an `execute: boolean` first parameter and `onSuccess`/`onFailure` in the return, exists for the cases that need it: routing a failure to another node or to `Exit.onFailure`, returning data alongside a failure, a boolean branch, a scope owner, a durable gate or effect.
- A **workflow** is an exported function annotated `@flowWeaver workflow` with the signature `(execute, params)`. `@param` declares the `Start` ports, `@returns` the `Exit` ports.
- Inside a workflow, `@node <id> <nodeType>` declares an instance and `@path Start -> a -> b -> Exit` wires the route: control flow between the steps, and every data port to the nearest earlier step with an output of the same name, `Exit` included. `@connect a.port -> b.port` wires one port explicitly, for the cases where names differ; an explicit connection always wins.
- The workflow's function body is a stub. The compiler generates it from the annotations and only ever rewrites the marker sections, so hand-written code around them survives.
- Built-in node types need no import: `delay`, `invokeWorkflow`, `waitForEvent`, `waitForAgent`. The last two are **durable gates** — the run pauses, hands back a continuation, and resumes later. In a workflow with a gate, an `@expression` node is pure automatically; only a normal-mode pure node needs `@durablePure`, and gates and effects need `@durableGate`/`@durableEffect`.
- The compiled output has no runtime dependency on Flow Weaver.
- Nodes take direct parameters; workflows take a `params` object. That is the mistake made most often.

## The loop

| To | Use | Note |
|----|-----|------|
| Check a file | `fw_validate` | Cheapest call; run it after every change |
| Answer one question about structure | `fw_query` with one `query` type | ~300 B |
| See everything about a file | `fw_describe` | Larger; prefer `fw_query` |
| Show the graph in chat | `fw_diagram` with `format: "ascii-compact"` | The default `svg` is not readable |
| Create a workflow | Write the file: one `@flowWeaver nodeType` function per step, then the `@flowWeaver workflow` stub | `tutorial` walks through it; `fw_scaffold` starts from a template |
| Change structure | `fw_modify_batch` (several edits) or `fw_modify` (one) | Rewrites annotations only; re-validate afterwards |
| Run a workflow | `fw_run`, then `fw_resume` if it pauses at a gate | `fw run` on the CLI refuses gated workflows |
| Look something up | `fw_docs` `search`, then `read` with `compact: true` | Search first; a topic can be large |

## What to read next

| When you need to | Read |
|------------------|------|
| Write or fix an annotation | `jsdoc-grammar` |
| Understand a validation error | `error-codes` — search it; never read it whole |
| Use expressions, pull execution, merge strategies, fan-out, colours and icons | `advanced-annotations` |
| Use `delay`, `invokeWorkflow`, or mocks | `built-in-nodes` |
| Pause a workflow for approval, input, or an AI agent | `durable-gates` |
| Know every MCP tool, its arguments and result sizes | `mcp-tools` |
| Find a CLI flag | `cli-reference` |
| Compile to something other than TypeScript | `compilation` |
| Export, serve over HTTP, or generate OpenAPI | `deployment` |
| Install, write, or extend a pack | `marketplace` |
| Loop over items with scoped ports | `export-interface` |
| Turn an existing function into a node | `node-conversion` |
| Reuse a fragment across workflows | `patterns` |
| Start from a template | `scaffold` |
| Step through execution | `debugging` |
| Cancel a run | `cancellation` |
| Walk from an empty file to a running workflow | `tutorial` |
| Read the long-form reference behind this page | `concepts` |

## Rules of thumb

- Read topics with `compact: true`; it keeps headings, tables, lists and code and drops the prose
- Never load the `full` context preset, and never read `error-codes` whole
- Use absolute file paths in tool calls
- Node ids and workflow function names are camelCase
- After `fw_modify` or a hand edit, run `fw_validate` before anything else
- `fw_modify` never compiles a file that was not already compiled in place; `fw_compile` and `fw_run` do that
