# Flow Weaver

[![npm version](https://img.shields.io/npm/v/@synergenius/flow-weaver?style=flat)](https://www.npmjs.com/package/@synergenius/flow-weaver)
[![npm downloads](https://img.shields.io/npm/dw/@synergenius/flow-weaver?style=flat)](https://www.npmjs.com/package/@synergenius/flow-weaver)
[![CI](https://img.shields.io/github/actions/workflow/status/synergenius-fw/flow-weaver/ci.yml?branch=main&style=flat)](https://github.com/synergenius-fw/flow-weaver/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/moraispgsi/305430ef59a51d0a58eb61fefdfbe634/raw/flow-weaver-test-count.json&style=flat)](https://github.com/synergenius-fw/flow-weaver/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/synergenius-fw/flow-weaver?style=flat)](https://codecov.io/gh/synergenius-fw/flow-weaver)
[![License: Flow Weaver Library License](https://img.shields.io/badge/License-Flow%20Weaver%20Library-blue?style=flat)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat)](https://nodejs.org)

**Design agent workflows in conversation. The compiled output is yours.**

[**flowweaver.ai**](https://flowweaver.ai) · [**Studio**](https://flowweaver.ai/studio) · [**Docs**](https://flowweaver.ai/docs) · [**Discord**](https://discord.gg/6Byh3ur2bk) · [**npm**](https://www.npmjs.com/package/@synergenius/flow-weaver)

---

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

---

## Install

```bash
npm install @synergenius/flow-weaver
npx flow-weaver init
```

The CLI handles the rest.

---

## License

Licensed under the [Flow Weaver License](https://flowweaver.ai/license). See [LICENSE.md](./LICENSE.md).
