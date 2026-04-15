# Flow Weaver

[![npm version](https://img.shields.io/npm/v/@synergenius/flow-weaver?style=flat)](https://www.npmjs.com/package/@synergenius/flow-weaver)
[![npm downloads](https://img.shields.io/npm/dw/@synergenius/flow-weaver?style=flat)](https://www.npmjs.com/package/@synergenius/flow-weaver)
[![CI](https://img.shields.io/github/actions/workflow/status/synergenius-fw/flow-weaver/ci.yml?branch=main&style=flat)](https://github.com/synergenius-fw/flow-weaver/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/moraispgsi/305430ef59a51d0a58eb61fefdfbe634/raw/flow-weaver-test-count.json&style=flat)](https://github.com/synergenius-fw/flow-weaver/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/synergenius-fw/flow-weaver?style=flat)](https://codecov.io/gh/synergenius-fw/flow-weaver)
[![r/FlowWeaver](https://img.shields.io/badge/Reddit-r%2FFlowWeaver-FF4500?logo=reddit&logoColor=white)](https://reddit.com/r/FlowWeaver)
[![License: Flow Weaver Library License](https://img.shields.io/badge/License-Flow%20Weaver%20Library-blue?style=flat)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?style=flat)](https://nodejs.org)

**Design agent workflows in conversation. The compiled output is yours.**

[**flowweaver.ai**](https://flowweaver.ai) · [**Studio**](https://flowweaver.ai/studio) · [**Features**](https://flowweaver.ai/features) · [**Discord**](https://discord.gg/6Byh3ur2bk) · [**npm**](https://www.npmjs.com/package/@synergenius/flow-weaver)

---

Flow Weaver is a TypeScript workflow compiler. Define workflows with JSDoc annotations in your existing codebase, compile to standalone TypeScript functions with zero runtime dependencies, and deploy to any serverless target. The compiled output has no dependency on Flow Weaver. You own it.

Build AI agent workflows, data pipelines, or automation scripts through natural language using MCP tools in Claude Code, Cursor, Windsurf, VS Code, JetBrains, Codex, or any MCP-compatible editor. Or write them by hand with annotations the same way you write JSDoc today.

## About me & my vision

Hey, I am [Ricardo Morais](https://linkedin.com/in/moraispgsi), the project's founder and owner. 

I have always wondered why Visual Programming never took off. After understanding why I tried to address most of the concerns from the development community:
  - No lock-in: code is compiled and yours, not dependent on this library. You can remove the annotation after compiling and the file is standalone.
  - The code is the source of truth, visual part runs on top, this allows you to create your workflows visually in the Studio, at the end of the day it is just plain Typescript code that you or any LLM can understand and iterate.
  - It being just code opens a lot of doors for you, like using Git for version control, doing all sort of stuff you already do with code like testing, linting, automating, everything.
  - In the era of LLMs and agents, being able to have that control is crucial, it is not a black box, you can see everything and so can your assistant.

As of now this is a solo project and I am building it in the open. There is a lot to do and rough edges to smooth out. If you run into issues or have questions, the [Discord](https://discord.gg/6Byh3ur2bk) is the best place to reach out. Every issue and question gets a response. I genuinely want to hear from you.

If this resonates with what you have been looking for, give it a try and let me know how it goes. Stars, feedback, and honest criticism all help equally.

## Project Status

Flow Weaver is in **beta**. The compiler, validator, CLI, and MCP tools are stable and thoroughly tested. The test suite covers thousands of cases across parsing, compilation, validation, diffing, and deployment. CI runs on every commit.

**Flow Weaver Studio**, the browser-based visual IDE, is the next major milestone and is being actively built. Core editing (canvas, terminal, diagnostics) is live today. The visual debugger, AI chat assistant, version history, and deployment dashboard are in progress. You can follow development on Discord or in the [GitHub releases](https://github.com/synergenius-fw/flow-weaver/releases).

Breaking changes may still occur between minor versions during beta. Pin your version in `package.json` if stability matters for your project.

## Capabilities

**Annotation-driven workflows:** Define node graphs directly in TypeScript using JSDoc annotations. No YAML, no JSON configs, no separate workflow files. Your workflows live in `.ts` files, version-controlled alongside your code.

**Zero-dependency compiled output:** The compiler generates a self-contained TypeScript function. No runtime to install in production, no SDK to import, no vendor lock-in. Delete the package after compiling and the output still runs.

**AI-native editing:** MCP tools expose the full compiler, validator, debugger, and diagram surface to any MCP-compatible editor. Scaffold a project, add nodes, wire connections, validate, compile, run, and diff through conversation.

**Structural validation:** Type checking across port connections, graph topology analysis, agent safety rules, and breaking change detection. Runs in CI, on every save, or on demand. Errors include source locations, fix suggestions, and documentation links.

**Step-through debugging:** Set breakpoints on nodes, step through execution node by node, inspect variables mid-run, and resume from checkpoints. Variable injection available through MCP tools.

**Semantic diffing:** Compare workflow versions at the graph level instead of text diffs. Impact analysis categorizes every change as critical, breaking, minor, or cosmetic. Know exactly what changed and whether it matters.

**Deploy anywhere:** Export to Inngest, AWS Lambda, Vercel, Cloudflare Workers, GitHub Actions, or GitLab CI. Or serve workflows over HTTP with built-in framework adapters for Next.js, Express, Hono, Fastify, and Remix.

**Extensible pack system:** Node types, deploy targets, CLI commands, and MCP tools are contributed by npm packages. Install community packs or build and publish your own.

**OpenClaw integration:** Use Flow Weaver inside [OpenClaw](https://openclaw.ai) with the native plugin. Build deterministic workflows through conversation. [Plugin](https://clawhub.ai/plugins/%40synergenius%2Fflow-weaver-openclaw) | [npm](https://www.npmjs.com/package/@synergenius/flow-weaver-openclaw) 🦞

## Quick Start

```bash
npm install @synergenius/flow-weaver
npx flow-weaver init my-agent
npx flow-weaver compile my-agent.ts
npx flow-weaver run my-agent.ts
```

The CLI scaffolds a project, compiles annotations into a runnable workflow, and executes it. Run `fw --help` for the full command reference. The example below shows a more complete workflow built through conversation.

## See It in Action

The conversation below shows [Weaver](https://github.com/synergenius-fw/flow-weaver-pack-weaver), an optional AI bot that drives Flow Weaver through natural language. It handles scaffolding, modification, validation, compilation, execution, and deployment. Install it with `fw market install @synergenius/flow-weaver-pack-weaver`, or use the MCP tools directly from your editor without Weaver.

> **You:** Build a support agent that classifies messages and either auto-replies or escalates.

> **Weaver:** Created `support-agent.ts`. Four nodes, one workflow.
>
> ```
> Workflow: supportAgent
>
> Nodes (4):
>   classify  [classifyIntent]  IN: message  OUT: context
>   route     [routeAction]     IN: context, execute  OUT: context, onSuccess, onFailure
>   reply     [llmReply]        IN: context  OUT: reply
>   esc       [escalate]        IN: context  OUT: ticket, assignee
>
> Paths (2):
>   Start -> classify -> route -> reply -> Exit
>   Start -> classify -> route -> esc -> Exit
> ```

> **You:** Show me the graph.

> **Weaver:**
>
> ```
>  ┌───────┐    ┌─────────────────┐    ┌──────────────┐    ┌───────────┐    ┌──────┐
>  │ Start │━━━▶│ Classify Intent │━━━▶│ Route Action │━━━▶│ LLM Reply │━━━▶│ Exit │
>  └───────┘    └─────────────────┘    └──────────────┘    └───────────┘    └──────┘
>
>  Parallel: Escalate
> ```

> **You:** Compile it.

> **Weaver:** Done. Zero runtime deps. The output is a standalone TypeScript function you own.

> **You:** Validate.

> **Weaver:**
>
> ```
> ✓ 1 valid, 2 warnings in 312ms
> ```
>
> Structural, agent safety, and CI rules. All checked.

> **You:** Run it with "I need an urgent refund".

> **Weaver:**
>
> ```
> classify: → SUCCEEDED (0ms)
> route:    → SUCCEEDED (0ms)
> reply:    → CANCELLED
> esc:      → SUCCEEDED (0ms)
> ✓ Workflow "supportAgent" completed in 2ms
>
> Result: { ticket: "ESC-1773950738529", assignee: "support-team" }
> ```

> **You:** Commit it.

> **Weaver:** Committed to `main`. It's a `.ts` file in your repo. Version-controlled like everything else.

> **You:** Now add sentiment analysis before routing.

> **Weaver:** Done. Here's what changed:
>
> ```
> [BREAKING] +1 types, ~1 types, +1 nodes, +5 conns, -2 conns
>
> + analyzeSentiment
> ~ routeAction (+inputs: sentiment)
> + sentiment (instance)
> + classify.context → sentiment.context
> + sentiment.sentiment → route.sentiment
> ```

> **You:** Where does this deploy?

> **Weaver:** Anywhere TypeScript runs. Or generate boilerplate:
>
> ```
> fw export support-agent.ts --target vercel
> fw export support-agent.ts --target lambda
> fw export support-agent.ts --target cloudflare
> fw export support-agent.ts --target inngest
> ```

## How Workflows Are Defined

Workflows are TypeScript functions annotated with JSDoc. You write plain functions for each node, and the annotations describe how they connect.

The function signature is the source of truth. Input parameters become input ports, return object fields become output ports. Every function has an `execute` boolean that controls whether it runs or passes through, and returns `onSuccess`/`onFailure` for branching. Expression nodes (marked with `@expression`) skip the execute/branching pattern and map return fields directly to outputs.

The `@flowWeaver workflow` block wires node instances together. `@node` creates an instance of a node type, `@connect` wires ports between nodes, and `@path` is shorthand for a linear route. `Start` and `Exit` are virtual nodes representing the workflow's inputs and outputs.

The compiler reads these annotations, builds the execution graph, and generates the body in place between markers. Everything outside the markers stays untouched. Node type functions are never modified.

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @input message - The support message
 * @output context - Classified context
 */
function classifyIntent(message: string): { context: SupportContext } {
  const intent = /refund|cancel/i.test(message) ? 'billing' : 'general';
  return { context: { message, intent, priority: 'normal' } };
}

// routeAction, llmReply, and escalate are defined the same way:
// plain functions with @flowWeaver nodeType annotations.

/**
 * @flowWeaver workflow
 * @node classify classifyIntent
 * @node route routeAction
 * @node reply llmReply
 * @node esc escalate
 * @path Start -> classify -> route -> reply -> Exit
 * @path route:fail -> esc -> Exit
 * @connect Start.message -> classify.message
 * @connect classify.context -> route.context
 * @param message - The support message
 * @returns reply - Generated reply
 * @returns ticket - Escalation ticket
 */
export async function supportAgent(
  execute: boolean,
  params: { message: string },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  reply: string | null;
  ticket: string | null;
}> {
  // @flow-weaver-body-start
  // Generated by the compiler. Do not edit.
  // @flow-weaver-body-end
}
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `fw init` | Scaffold a new project with presets and templates |
| `fw compile` | Compile workflow files to standalone TypeScript |
| `fw validate` | Validate workflows without compiling |
| `fw run` | Execute a workflow with optional debug mode |
| `fw watch` | Recompile on file changes |
| `fw dev` | Watch + compile + run loop |
| `fw describe` | Output workflow structure as JSON, text, Mermaid, ASCII, or paths |
| `fw diagram` | Generate SVG, HTML, or ASCII diagrams |
| `fw diff` | Semantic diff between two workflow versions |
| `fw export` | Export to a deploy target (Inngest, Lambda, Vercel, Cloudflare, etc.) |
| `fw serve` | Start an HTTP server exposing workflows as endpoints |
| `fw modify` | Programmatic graph mutations (addNode, removeNode, connect, etc.) |
| `fw mcp-server` | Start the MCP server for AI editor integration |
| `fw mcp-setup` | Auto-configure MCP for Claude, Cursor, VS Code, Windsurf, or Codex |
| `fw docs` | Browse bundled reference documentation |

Run `fw --help` or `fw <command> --help` for full options.

## Flow Weaver Studio (Beta)

A browser-based visual IDE for building workflows. Canvas editor, integrated terminal, real-time diagnostics, and the full CLI available in the cloud.

Studio is in beta. Core editing is live. The visual debugger, AI chat assistant, version history, and deployment dashboard are being actively developed and will ship incrementally. The cloud platform is not yet production-ready, and paid plans are not available yet. Use it to explore and experiment, but expect rough edges.

[Open Studio](https://flowweaver.ai/studio) · [Learn more](https://flowweaver.ai/features)

## Weaver (Experimental)

Weaver is an optional AI bot that automates the full workflow lifecycle. Give it a task in natural language and it plans, scaffolds, compiles, validates, and fixes issues in a loop until the workflow is correct. It connects to Anthropic, Claude CLI, or GitHub Copilot CLI.

- `weaver bot "create a greeting workflow"` handles a task end-to-end with plan approval
- `weaver run workflow.ts` executes a workflow with an AI agent channel attached
- `weaver session` polls a task queue continuously for automated pipelines
- `weaver swarm start` runs multiple bot instances in parallel, with an orchestrator dispatching tasks across them

Weaver is itself built as a set of Flow Weaver workflows. Run `weaver eject` to get a local copy you can customize.

```bash
fw market install @synergenius/flow-weaver-pack-weaver
```

> **Weaver is experimental.** The bot, session, and swarm modes work and are being used internally, but the APIs and behavior may change between releases. Weaver is not required to use Flow Weaver. The compiler, CLI, and MCP tools are the stable foundation and work independently.

## Documentation

Reference documentation is bundled with the CLI. Run `fw docs` to browse topics, or `fw docs <topic>` to read a specific one:

```bash
fw docs list                    # List all topics
fw docs tutorial                # Step-by-step first workflow guide
fw docs concepts                # Core concepts
fw docs jsdoc-grammar           # Annotation syntax reference
fw docs cli-reference           # Full CLI command reference
fw docs search <query>          # Search across all docs
```

**Online resources:**

- [Features](https://flowweaver.ai/features)
- [Compare with Alternatives](https://flowweaver.ai/compare)
- [License](https://flowweaver.ai/license)

## Community

Flow Weaver is built and maintained by a solo developer. If you try it, find a bug, or just want to talk about workflows, the [Discord](https://discord.gg/6Byh3ur2bk) is open. Every message gets read and responded to, usually within a day.

If something breaks, [open an issue](https://github.com/synergenius-fw/flow-weaver/issues). Bug reports with reproduction steps get prioritized. Feature requests are welcome too.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

Licensed under the [Flow Weaver Library License](https://flowweaver.ai/license). See [LICENSE](./LICENSE).

The license is designed to be generous for the vast majority of users while protecting the project's IP. Here is what it means in practice:

**Use freely:**
- Install, compile, validate, run, and deploy workflows in any project
- All compiled output is fully yours with no restrictions or attribution required
- Use in CI/CD pipelines and build systems
- Host internally for organizations with 15 or fewer people
- Include as a dependency in larger products where Flow Weaver is not the primary value

**Requires a commercial license:**
- Internal hosting for organizations with more than 15 people
- Building a hosted or standalone workflow authoring product
- Offering Flow Weaver capabilities as a managed service to third parties

**Never permitted:**
- Using source code, tests, documentation, or outputs as AI/ML training data to replicate the functionality
- Extracting specifications to build competing software

If you are unsure whether your use case needs a commercial license, reach out at support@synergenius.pt. The answer is probably "you're fine."
