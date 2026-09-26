---
name: Console
description: The local operator console — every workflow in a project as a process, its issues and code, live runs with gates answered from the page, and this guide beside it
keywords: [console, fw console, operator, run, gate, approve, resume, trace, project, tree, guide, docs, cli]
---

# Console

`fw console` opens a local web app over a project's workflows. It is the place to watch a workflow run, answer a gate, read what a step does, and find out why a file is not valid — without leaving the browser for a terminal.

```bash
fw console            # the current directory
fw console ./flows    # another project
fw console --open     # and open the browser
```

It binds to `127.0.0.1:4311` by default and re-reads a file as you save it.

The console has no login, so it guards against the other pages open in your browser. It answers only to a loopback host name, which defeats DNS rebinding. It refuses a change sent from any origin but its own. Scripts and `curl` send no origin, so they keep working.

## What is on screen

| Where | What |
|-------|------|
| Left | The project's workflows as a tree, with each one's verdict: a dot for valid, warnings or errors, a count for runs waiting at a gate. Below it, this guide. |
| Centre | One workflow as a process: steps in run order, failure arms branching, pulled steps beside the step that reads them. A scope body sits in a tinted band under its owner, named “scope in owner” at its corner: the rows inside run once per item, the owner above them once; a body inside a body is a band inside a band. During a run each step lights up as it goes. `Start` and `Exit` open like steps and show the parameters and return values. |
| Right | Panes for what you are doing: **Run** (start a run, or the one open now), **Step** (the selected step: what it is, its ports, its code), **Issues** (everything the validator said), **Serve** (the workflow as an HTTP endpoint: its routes, one button to expose it, and the server's Start and Stop), and under **More**: **Reference** (the workflow's annotations), **Changes** (two git versions on one picture), **Export** (when a pack provides a target). |
| Bottom | A drawer, closed until something opens it: the **Server** and **Watch** output as they print it, and the **CLI**. Drag its top edge for height. |
| Bar | The glyphs at the bottom left: the **Project** page (with a green dot while the server is up), **Endpoints**, **Agents**, and opening another project. |

Click a step to read it; click it again to let go. Click a tile's row while a run is going to see the values that flowed through it.

## The Project page

The front door, and where the console opens when it has nowhere else to go: the project as a whole, with the controls on it. Its first line counts the workflows and names the ones with errors. In a project where nothing has run yet, a **Start here** card comes first and runs a workflow from the list with one click; the server, endpoints and environment come after it. A workflow's header says *not compiled in place* when its file has no generated body yet: runs from the console use a private compile, so that is not a problem, only a note that `fw compile` has not written the body into the file for code of your own to call.

- **Server** — whether `fw serve` runs for this project, where, since when, how many requests it has answered. **Start** brings it up with the saved settings; **Stop**, **Restart** and **Logs** do what they say. The settings behind the sliders glyph are port, host, whether a token guards it (generated at each start; the card shows it, since anyone who reaches the console can already run every workflow), agent profiles, the step trace, Swagger UI, dev mode, and *start with the console*. Settings are kept per project under your home, never in the project tree. A server someone started from a terminal for the same project is shown too and can be stopped, but not restarted or read: it is not the console's. Services the console started stop with the console.
- **Endpoints**, **Agents** — the number that matters and the way to the page.
- **Recompile on save** — `fw watch` as a switch, with its output in the drawer.
- **Editors** — which editors have the MCP server registered for this project and from which install; `fw mcp-setup` registers it.
- **Environment** — the checks `fw doctor` runs, with the fix beside each.
- **Needs you**, on the right — every run waiting at a gate anywhere in the project, and the latest failures; one click opens the run.

Below, the console's own version, install and run store, and whether each registry in `.npmrc` answers with its token. Every long-lived `fw` process — `mcp-server`, `serve`, `console` — announces itself in `~/.fw/services/` when it starts and notes each tool call or request; the page and `fw doctor`'s *Running services* check read that directory, and a record whose process is gone is dropped. An MCP server speaks stdio to the editor that started it, so what is known about a running one is what it reports about itself. A server answering from another install than the one you are editing is called out, since edits do not reach it.

## Starting a run

The **New run** card has three parts.

**Parameters** is a form built from the workflow's TypeScript types: a `boolean` is a yes/no, a union of literals a choice, an object its fields, a list of objects rows to add and remove, and anything the type checker cannot name a JSON box with a *tidy* button. A port's description sits under its field. The whole thing can be switched to JSON, cleared, and kept under a name with **save** — presets live in this browser, per workflow, and are picked from the menu beside the title.

**Mocks** lists every gate and every call to another workflow. Ticking one gives it an answer here — the gate's own outputs, as a form from their types — and the run goes through it without pausing, as if a person had answered that. A workflow with delays gets a *skip delays* switch. What is not ticked pauses as usual. This is the same mock config `fw run --mocks` takes (see [Built-in Nodes](built-in-nodes.md)); **copy as CLI** puts the run, parameters and mocks included, on the clipboard as an `fw run` command.

**Agents** appears when the workflow has an agent gate that is not mocked. It names the profile each gate would go to — from `.flowweaver/agents.yaml`, see [Agent profiles](durable-gates.md#agent-profiles) — with a dot for whether that profile can run from here, and a switch: *Let a profile answer the agent gates*. On, the run does not stop at those gates; off, they wait for you as any gate does. The choice is kept per workflow.

**How** is *Run* or *Step through*. Stepping pauses before the first step, or runs to the first breakpoint when there is one; the breakpoints are listed there and can be removed. `⌘↵` (`Ctrl+↵`) starts the run from anywhere in the card.

While a run goes and after it ends, its card shows what it was given, its mocks, and every step as it happened with its duration — the bar under a step is its share of the longest — then the result or the error, with the step that threw one click away. **Run again** repeats it with the same parameters and mocks.

A step inside a scope body runs once per item, and the console keeps each pass apart. The process shows `3× 2 ms`, three passes with their time added up: the timeline's `×3` opens a line per pass with its own duration and error, and the Step card gets a pass picker so the inputs and outputs shown are the second invoice's, not only the last one's. A failed pass among successes is marked as such, and the Step card opens on it.

**Runs** underneath is the history: each row says what became of the run (*completed*, *failed at Parse Figma Link*, *waiting at Approve Plan*), when, how long, and what it was given. Filter by *failed*, *waiting* or *done*; hover a row to run it again; *clear finished* forgets what is over. A run in flight or waiting is never cleared.

## Changes

The **Changes** tab compares two versions of the open workflow from git and paints the difference on the process itself. Pick *from* and *to* — a commit, `HEAD`, or the working tree; the default is the file against its last commit when it has uncommitted changes, else the last commit against the one before. The two versions are laid out as one picture: an added step sits where it now runs, tinted green; a removed step keeps the place it had, struck through in red; a changed step is amber; edges that came or went are drawn green or dashed red. The column beside it gives the verdict in words — *Breaking: removed 1 output port* — then the changes as steps, wiring and contract; clicking a step selects it on the picture. **Before** and **After** show one version on the same rows, so switching (`d`, `b`, `a`) moves nothing: a step the other version lacks leaves an empty dashed slot. The comparison is semantic, from `fw diff`: renames, colours and positions do not count.

**History** underneath lists the commits that touched the file; click one to compare from it, or its *to* button to compare up to it. Every run is stamped with the commit the file stood at, shown on its history row (`a1b2c3•` when there were uncommitted changes), and a run card's **changes since** opens this pane on what changed in the file after that run.

## Runs and gates

A run started in the console is a real execution of the workflow, through the same coordinator `fw_run` uses over MCP, stored under the project's `.fw/runs` (`FW_RUNS_DIR` to move it). That has three consequences worth knowing:

- A gate reached here can be answered by an assistant over MCP with `fw_resume`, and a gate reached by an assistant can be answered here. The console follows either as it happens.
- A run waiting at a gate survives the console being closed and reopened.
- The step trace is kept beside the record, so a run opened tomorrow still shows what each step did and how long it took. A segment resumed over MCP keeps no trace, and the console says so instead of guessing.

The gate form is built from the port's TypeScript type: a `boolean` is a yes/no, a union of literals a choice, an object its fields. The words around it are the author's: the gate function's JSDoc description is shown at the top of the card as what is being asked, each input the gate hands over is named by its `@input` label, and each field to fill carries its `@output` label. Write those lines for the person who will answer, not for the compiler. **Reject** is offered when the gate has an `onFailure` port.

A run asleep at a `sleep` node shows when it wakes and a **Wake now** button instead of a form; a gate with a `timeout` says when it times out and takes its failure path. The console's clock ticks every few seconds while it is open, as `fw serve`'s does, so a sleep that is over wakes without anyone at the page. The Project page's *Needs you* list says *sleeping until* or *times out at* on those rows. See [Time](durable-gates.md#time).

If the file changed since the run paused, the answer is refused with a message saying so; start a new run. See [Durable Gates](durable-gates.md) for what pauses a run and how an answer is shaped.

When an agent profile is answering a gate, its panel sits on the step's row in the process: the profile's name and model, the model's words as they stream, the tools it calls, and the tokens so far. The form is out of the way until it is done. Then one line stays on the row — *answered in 3.2 s, 1.4k tokens* — and the run goes on. If the profile could not answer — no key in the environment, a model that never submitted, an answer that did not fit — the line says why in red, the form is back, and *ask the agent again* is beside it. A run started with the switch off can still be handed to the agent from that button.

## Agents

The Agents page — the robot glyph on the left bar — is the project's `.flowweaver/agents.yaml` as the console reads it: each profile with its provider and model, the environment variable its key comes from and whether that variable is set (the key itself is never shown), the system prompt, and which gate goes to which profile. A project without the file gets the starter file to copy. Problems in the file are listed the way the validator lists a workflow's.

## Serve

The **Serve** pane is the open workflow as an HTTP endpoint. It says whether the server is running for this project, with **Start** and **Stop** right there (the settings are on the Project page) and **Logs** opening the drawer, and lists the routes the workflow declares with `@http`, each with the request to copy as `curl`, the parameters coming from the run form, and what the route answers with. A workflow with no route has one button, **Expose as endpoint**, which writes `@http POST /<name>` on the workflow; **Edit** opens the same small editor for a workflow that has routes: a method, a path (`:param` binds a parameter), and three switches — answer at once, no token, accept a callback URL. Saving rewrites only the `@http` lines. When this console started the server, *copy request* fills in its token. Under the routes, the run resource every workflow has regardless, and the run URLs to resolve, follow and cancel a run. Runs made over the API are the same runs as the console's, so a gate a caller reached can be answered on this page; a run started elsewhere says so in the run list (`http`, `mcp`). See [Deployment](deployment.md#workflows-as-endpoints).

## Endpoints

The Endpoints page — the API glyph on the left bar — is every declared route in the project on one page: method, path, what it answers with, the flags it carries, and the request to copy, grouped by workflow; the routes that could not be mounted and why; and whether the server is up, with **Start server** when it is not. A project with no routes yet is told what a route adds over the run resource and shown the workflows to start with. The side has the response contract in short, and the snippets to mount the same API in an Express app or a fetch host. See [Embedding the API](deployment.md#embedding-the-api).

## Debugging

Choose **Step through** on the New run card and the workflow pauses before its first node, or runs to the first breakpoint if you asked for that; the same debugger `fw run --debug` and the `fw_debug_*` tools drive. The debugger cannot hold a gate, so a stepped run stops at the first gate that is not answered by a mock. While it is paused:

| Control | Does |
|---------|------|
| **Step** (`F10`) | Runs the next node, then pauses again — before it, then after it |
| **Continue** (`F5`) | Runs to the end |
| **To breakpoint** (`⇧F5`) | Runs to the next breakpoint |
| **Stop** | Ends the session |

A breakpoint is set by clicking a step's tile, as in an editor's gutter; they are kept per workflow and can be changed while a session is paused. The step the run is paused at is marked in the process, with *before* or *after*. When it is paused after a step, that step's outputs are editable in its Step card: the new value is what the next node reads, which is how a branch is forced or a bad value patched without a rerun.

A debug session is a held process, not a run in the store: it is not listed by `fw_runs`, does not survive the console closing, and cannot hold a gate — a gated workflow can be stepped as far as its first gate, where the session ends and says so. See [Debugging](debugging.md) for the same facility from the CLI and MCP.

## Packs

The Packs view lists the packs installed in the project — the third glyph on the left bar. Each pack opens as a page: the node types it adds with their ports, the export targets, the annotations it understands and where they land, its rule sets, docs, CLI commands and MCP tools, and whether this Flow Weaver is new enough for it. A step whose node type came from a pack says so and links there; what a pack's tags said about a workflow or a step shows on its card as *pack tags*.

Three more things live under Packs:

- **Export** — when a pack provides an export target, the workflow gets an Export pane: pick the target, see the `@deploy` keys it reads and their current values, preview the generated files, write them, and follow the target's own deploy instructions. The same export is one click away as an `fw export` command.
- **Find a pack** — a search of the npm registry narrowed to packs. Installing one is `fw market install`, put on the command line for you to run; a private registry is reached with `fw market search --registry`.
- **This pack** — when the open project is itself a pack, the console shows what `fw market pack` would do before it does it: the manifest generated from the sources, the marketplace rules over it, and what writing `flowweaver.manifest.json` would change. `fw market pack` and `fw market publish --dry-run` are on the command line.

See [Marketplace](marketplace.md) for what a pack can contain and how one is made.

## The guide

The guide you are reading is part of the console. Open a topic from the rail and it takes the centre, with its contents on the right and, where it applies, the workflows in this project the topic is about — the gated ones on *Durable Gates*, the ones with issues on *Error Codes*.

Every `fw` command in a page can be put on the **CLI** in the drawer with one click, with the open workflow's file filled in, and run there. Each page can also be copied in its compact form, the same bytes `fw_docs` gives an assistant, to paste into a conversation.

## The command line

The **CLI** tab of the drawer runs `fw` commands in the project — as an argument list handed to this install of the CLI, never through a shell, so quoting means the same on every platform. Long-lived commands are refused with a reason: `serve` and `watch` belong to the Project page, where they are started and stopped as services; `console`, `mcp-server` and `dev` to a terminal.

- **Type** — `Tab` completes commands, subcommands and flags from the CLI reference and from installed packs' commands; `↑`/`↓` walk the session's history; `Enter` runs.
- **Build** — *Commands* opens the catalogue as a form: pick a command, fill its arguments (the open workflow's file is filled in for an input) and its options, with each flag's description and default beside it; the line it makes is shown as you go, and examples from the reference can be taken as a starting point. Typing and the form are two views of one line: a typed line opens in the form with what it had, and the form writes back to the line.
- **Placeholders** — a line with a `<placeholder>` still in it, from a ▶ in the guide say, opens the form on that command with the rest filled in.
- **Output** — streamed as the command runs, with the exit status and time; each run can be stopped, run again, copied, opened full screen or removed.

## The console on a store of your own

`fw console` shows the runs in the project's `.fw/runs`, the same directory `fw serve` and `fw_run` use for that project. Your own code joins them with `createLocalCoordinator({ rootDir: defaultRunsDir(projectDir) })`. A service in production keeps its runs in a [run store](library.md#run-stores) of its own instead; to answer those gates from the console, run it from code on the same store:

```typescript
import { createConsoleServer } from '@synergenius/flow-weaver/console';
import type { RunStore } from '@synergenius/flow-weaver/coordinator';

declare const myStore: RunStore;   // the store your API instances use

await createConsoleServer({ projectDir: '/srv/workflows', port: 4311, store: myStore });
```

Everything on this page then reads and writes that store: the run list, the gate forms, the agent panel, the Serve pane's run URLs. Changes made by other instances arrive by polling every few seconds rather than at once. Put it behind your own login; the console has none of its own.

## Handing a workflow over

**Share**, at the top right of a workflow, downloads it as one self-contained file for someone who will not open the console: the **brief** — the graph first, large, every step there to be clicked for what it does, what it reads and where its failure goes, then what goes in, what comes out and where a person or an agent is needed; the same brief as a **PDF** — a one-page overview with the graph beside the contract, the pauses and the failure arms, then every step in detail — printed by the browser on this machine; or the **diagram** as an SVG for a slide or a document. The graph in all three is the spine drawn on screen — the same lane layout, tiles and colours — so what a stakeholder sees is what the operator sees. `fw artifact` produces the same three files from the command line.

## Keys

| Key | Does |
|-----|------|
| `Esc` | Closes full-screen code and dialogs |

## Related Topics

- [CLI Reference](cli-reference.md) — `fw console` flags
- [Durable Gates](durable-gates.md) — gates, answers, and driving a run from an assistant
- [Debugging](debugging.md) — reading traces and fixing validation errors
