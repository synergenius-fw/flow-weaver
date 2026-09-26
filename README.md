# Flow Weaver

[![npm version](https://img.shields.io/npm/v/@synergenius/flow-weaver?style=flat)](https://www.npmjs.com/package/@synergenius/flow-weaver)
[![CI](https://img.shields.io/github/actions/workflow/status/synergenius-fw/flow-weaver/ci.yml?branch=main&style=flat)](https://github.com/synergenius-fw/flow-weaver/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?style=flat)](https://nodejs.org)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue?style=flat)](./LICENSE)

**A deterministic TypeScript workflow compiler. You describe a workflow with JSDoc annotations. It compiles to a standalone TypeScript function you own.**

Flow Weaver turns annotated functions into an execution graph and generates the workflow body in place. The compiled file imports nothing from Flow Weaver: it is plain TypeScript you can read, review and keep, and it is yours under any licence you like. The code that calls it hands it one small object, the runtime, and the compiled file exports the helper that builds it. Running what the compiler produced needs nothing from the package, gates included.

Workflows are plain `.ts` files, so everything you already do with code applies: Git, code review, tests, linting, CI. Build them by hand the way you write JSDoc, or drive the whole compiler through MCP tools from Claude Code, Cursor, VS Code, Windsurf, or any MCP-compatible editor.

## Install

Requires Node.js **22+**.

```bash
npm install @synergenius/flow-weaver
```

This installs the `fw` CLI, the MCP server, the local console, and the library, all in one package.

## Quick start

```bash
npx fw init my-project        # a project: a workflow, a runner that calls it, the config
cd my-project && npm install
npm start                     # run the compiled workflow
npx fw console --open         # see it as a process; run it, and answer its gates, from the browser
```

On any workflow file:

```bash
npx fw validate src/my-project-workflow.ts
npx fw run src/my-project-workflow.ts --params '{"data":{"message":"hi"}}'   # no compile needed to try it
npx fw compile src/my-project-workflow.ts                                    # generate the standalone body in place
```

Run `fw --help` or `fw <command> --help` for full options.

## How workflows are defined

A **node type** is a plain function annotated `@flowWeaver nodeType`. Its ports are inferred from the signature: each parameter is an input, each field of the returned object an output. Most node types are pure `@expression` functions.

A **workflow** is an exported function annotated `@flowWeaver workflow`. `@param` declares its inputs (`Start`), `@returns` its outputs (`Exit`), `@node` creates instances, and `@path` wires the route, connecting each data port to the nearest earlier step with a matching output. The body is a stub. The compiler fills it in between markers and leaves everything else untouched.

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @input name - Name to greet
 * @output message - Greeting message
 */
function greet(name: string): string {
  return `Hello, ${name}!`;
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input message - Text to transform
 * @output result - Uppercased text
 */
function shout(message: string): string {
  return message.toUpperCase();
}

/**
 * @flowWeaver workflow
 * @param name - Name to greet
 * @returns result - Uppercased greeting
 * @node greeter greet
 * @node transform shout
 * @path Start -> greeter -> transform -> Exit
 */
export function greeting(
  execute: boolean,
  params: { name: string },
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('generated body was not installed');
}
```

That is a complete workflow. `fw compile` reads the annotations, builds the graph, and installs the real body.

## The local console

`fw console` opens a local web app over a project's workflows. Every workflow appears as a process, with its issues and code, live runs with each step's values, gates answered from a form built from the port's type, a step-through debugger, and a semantic diff between versions. Runs you start there use the same coordinator the MCP tools and `fw serve` use, so a run paused for approval can be answered from the browser, from an assistant, or over HTTP, interchangeably.

```bash
fw console --open
```

Its Project page is the front door: the project's HTTP server with Start, Stop and its logs, the declared endpoints, the agent profiles, the editors that have the MCP server, the environment checks, and every run waiting for a person. It binds to `127.0.0.1:4311` and re-reads files as you save them.

## AI-native editing

The MCP server exposes the full compiler, validator, debugger, and diagram surface to any MCP-compatible editor. Scaffold, add nodes, wire connections, validate, compile, run, and diff, all through conversation.

```bash
fw mcp-setup     # register the server with Claude, Cursor, VS Code, Windsurf, Codex, or OpenClaw
fw mcp-server    # or start it manually
```

## Durable workflows

A **gate** is a node where the run stops and hands control to something outside it: a person approving (`@durableGate approval`), an external system answering (`waitForEvent`), or an AI agent doing a task (`waitForAgent`). The run returns a continuation and the process is free to exit. Later, any process resumes from exactly that node with the answer. `fw create workflow approval <file>` writes one to start from.

Paused runs live in a store: the project's `.fw/runs` directory (the project being the nearest folder with a `package.json`), or a store of your own behind a nine-method interface. `fw console`, `fw serve`, the MCP tools and your own code through `createLocalCoordinator` can all drive the same runs, so a gate reached anywhere is answered anywhere. (`fw run` is for workflows without gates. It has nowhere to keep a run between one gate and the next.) A host with no package at all works too: the compiled file throws a `DurableGateYield` carrying the continuation, and exports `acceptContinuation` to take it back later. See `fw docs library`.

An agent gate can be answered without anyone watching: a **profile** in `.flowweaver/agents.yaml` names a model (Anthropic, any OpenAI-compatible server including a local one, or the Claude Code CLI) and the environment variable that holds its key. The model gets the gate's inputs and one tool shaped from the gate's output type, and the run resumes with what it returns. `fw agents --init` writes the starter file. The console's Agents page edits it with a form.

## Workflows as endpoints

A workflow declares its route, and `fw serve` mounts it:

```typescript
/**
 * @flowWeaver workflow
 * @http POST /reviews
 * @http GET /reviews/:path
 * @param path - The file
 * @param text - Its contents
 * @returns report - The review
 */
export async function reviewFile(
  execute: boolean,
  params: { path: string; text: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; report: string }> {
  throw new Error('generated body was not installed');
}
```

Parameters bind from the path, the query or the JSON body. The answer is the workflow's return ports: `200` on success, `422` on the failure path, `202` with a `Location` to poll when a gate pauses the run. An `Idempotency-Key` makes a retry the same run. A `callback` route posts the final response to the caller. `/openapi.json` describes all of it.

The same handler mounts in your own server (Node, Express, Fastify, or a fetch host) from `@synergenius/flow-weaver/server`:

```typescript
import { createServer } from 'node:http';
import { createWorkflowApi } from '@synergenius/flow-weaver/server';

const api = createWorkflowApi({ dir: './workflows', token: process.env.FW_SERVE_TOKEN });
createServer(api.node()).listen(3000);   // or, in Express: app.use('/api', api.express())
```

## Using it as a library

The compiled file imports nothing from the package. The code that *calls* it needs one object, the runtime, and the compiled file exports the helper that builds it:

```typescript
import { greeting, createWorkflowRuntime } from './my-workflow';

const runtime = createWorkflowRuntime({ runId: 'run-1', workflowId: 'greeting' });
const result = await greeting(true, { name: 'Alice' }, runtime);
// result.result === 'HELLO, ALICE!'
```

The package exports the same `createWorkflowRuntime`, built from the same source, for code that already depends on it. Parse, validate, compile, query, and diff are all available programmatically from `@synergenius/flow-weaver/api`. `@synergenius/flow-weaver/coordinator` starts and resumes gated runs from code and takes a run store of your own. `@synergenius/flow-weaver/server` is the HTTP handler behind `fw serve`. See `fw docs library` for the full surface and entry points.

## CLI reference

| Command | Description |
|---------|-------------|
| `fw init` | Scaffold a new project |
| `fw validate` | Validate workflows without compiling |
| `fw compile` / `fw strip` | Compile workflows to standalone TypeScript, or remove the generated code |
| `fw run` | Execute a workflow without gates directly |
| `fw watch` / `fw dev` | Recompile (and run) on file changes |
| `fw console` | Open the local operator console |
| `fw agents` | The agent profiles that answer agent gates, and a starter file |
| `fw describe` | Output workflow structure (JSON, text, Mermaid, ASCII) |
| `fw diagram` | Draw a workflow as an SVG or terminal diagram |
| `fw artifact` | Export a workflow as a shareable page, PDF, or SVG |
| `fw diff` | Semantic diff between two workflow versions |
| `fw modify` | Programmatic graph mutations |
| `fw create` / `fw templates` | Create workflows or nodes from templates |
| `fw status` / `fw implement` | Report which stub nodes are still unimplemented, and replace a stub with a real function |
| `fw migrate` | Rewrite workflow files in the current syntax |
| `fw serve` | Serve the workflows' declared routes and run resources over HTTP, where gated runs pause and resume |
| `fw export` / `fw openapi` | Export to a deploy target, or generate an OpenAPI spec |
| `fw market` | Discover, install, and publish marketplace packs |
| `fw doctor` | Check the project environment |
| `fw mcp-server` / `fw mcp-setup` | Start or configure the MCP server |
| `fw docs` / `fw grammar` | Browse the bundled reference documentation, or print the annotation grammar |
| `fw context` | Build a context bundle of the docs for an LLM |

## Extending with packs

Node types, deploy targets, CLI commands, and MCP tools are contributed by npm packages ("packs"). Discover, install, and publish them with `fw market`, or build your own. See `fw docs marketplace`.

## Documentation

Reference documentation ships with the CLI:

```bash
fw docs list             # list all topics
fw docs tutorial         # first-workflow walkthrough
fw docs concepts         # the core model
fw docs jsdoc-grammar    # annotation syntax
fw docs search <query>   # search across all docs
```

Upgrading between versions: [MIGRATION.md](./MIGRATION.md) explains how `fw migrate` rewrites workflow files in the current syntax.

## Project status

Flow Weaver is in **beta**. The compiler, validator, CLI, console, and MCP tools are stable and thoroughly tested. CI runs the full test suite on Linux for every push and pull request, and a smoke test installs the packed CLI on Linux, macOS, and Windows on every push to `main`. Breaking changes may still occur between minor versions during beta, so pin your version if stability matters.

## Community

Built and maintained by [Ricardo Morais](https://github.com/moraispgsi). Found a bug or have a question? [Open an issue](https://github.com/synergenius-fw/flow-weaver/issues) or start a [Discussion](https://github.com/synergenius-fw/flow-weaver/discussions).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Flow Weaver is licensed under the [Apache License 2.0](./LICENSE).

What the compiler produces is yours. Compiled workflows, generated code and diagrams, including the execution engine the compiler copies into each compiled file, may be used, modified and distributed under any terms you choose, without attribution. See [NOTICE](./NOTICE).

Support and enterprise agreements: support@synergenius.pt.
