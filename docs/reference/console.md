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

## What is on screen

| Where | What |
|-------|------|
| Left | The project's workflows as a tree, with each one's verdict: a dot for valid, warnings or errors, a count for runs waiting at a gate. Below it, this guide. |
| Centre | One workflow as a process: steps in run order, failure arms branching, pulled steps beside the step that reads them. A scope body sits in a tinted band under its owner, named `owner · scope` at its corner: the rows inside run once per item, the owner above them once; a body inside a body is a band inside a band. During a run each step lights up as it goes. `Start` and `Exit` open like steps and show the parameters and return values. |
| Right | Panes for what you are doing: **Run** (start a run, or the one open now), **Step** (the selected step: what it is, its ports, its code), **Issues** (everything the validator said), **Reference** (the workflow's annotations), **CLI** (run an `fw` command here). |

Click a step to read it; click it again to let go. Click a tile's row while a run is going to see the values that flowed through it.

## Starting a run

The **New run** card has three parts.

**Parameters** is a form built from the workflow's TypeScript types: a `boolean` is a yes/no, a union of literals a choice, an object its fields, a list of objects rows to add and remove, and anything the type checker cannot name a JSON box with a *tidy* button. A port's description sits under its field. The whole thing can be switched to JSON, cleared, and kept under a name with **save** — presets live in this browser, per workflow, and are picked from the menu beside the title.

**Mocks** lists every gate and every call to another workflow. Ticking one gives it an answer here — the gate's own outputs, as a form from their types — and the run goes through it without pausing, as if a person had answered that. A workflow with delays gets a *skip delays* switch. What is not ticked pauses as usual. This is the same mock config `fw run --mocks` takes (see [Built-in Nodes](built-in-nodes)); **copy as CLI** puts the run, parameters and mocks included, on the clipboard as an `fw run` command.

**How** is *Run* or *Step through*. Stepping pauses before the first step, or runs to the first breakpoint when there is one; the breakpoints are listed there and can be removed. `⌘↵` (`Ctrl+↵`) starts the run from anywhere in the card.

While a run goes and after it ends, its card shows what it was given, its mocks, and every step as it happened with its duration — the bar under a step is its share of the longest — then the result or the error, with the step that threw one click away. **Run again** repeats it with the same parameters and mocks.

A step inside a scope body runs once per item, and the console keeps each pass apart. The process shows `3× · 2 ms` — three passes, their time added up — the timeline's `×3` opens a line per pass with its own duration and error, and the Step card gets a pass picker so the inputs and outputs shown are the second invoice's, not only the last one's. A failed pass among successes is marked as such, and the Step card opens on it.

**Runs** underneath is the history: each row says what became of the run (*completed*, *failed at Parse Figma Link*, *waiting at Approve Plan*), when, how long, and what it was given. Filter by *failed*, *waiting* or *done*; hover a row to run it again; *clear finished* forgets what is over. A run in flight or waiting is never cleared.

## Changes

The **Changes** tab compares two versions of the open workflow from git and paints the difference on the process itself. Pick *from* and *to* — a commit, `HEAD`, or the working tree; the default is the file against its last commit when it has uncommitted changes, else the last commit against the one before. The two versions are laid out as one picture: an added step sits where it now runs, tinted green; a removed step keeps the place it had, struck through in red; a changed step is amber; edges that came or went are drawn green or dashed red. The column beside it gives the verdict in words — *Breaking: removed 1 output port* — then the changes as steps, wiring and contract; clicking a step selects it on the picture. **Before** and **After** show one version on the same rows, so switching (`d`, `b`, `a`) moves nothing: a step the other version lacks leaves an empty dashed slot. The comparison is semantic, from `fw diff`: renames, colours and positions do not count.

**History** underneath lists the commits that touched the file; click one to compare from it, or its *to* button to compare up to it. Every run is stamped with the commit the file stood at, shown on its history row (`a1b2c3•` when there were uncommitted changes), and a run card's **changes since** opens this pane on what changed in the file after that run.

## Runs and gates

A run started in the console is a real execution of the workflow, through the same coordinator `fw_run` uses over MCP, stored under `~/.fw/runs` (`FW_RUNS_DIR` to move it). That has three consequences worth knowing:

- A gate reached here can be answered by an assistant over MCP with `fw_resume`, and a gate reached by an assistant can be answered here. The console follows either as it happens.
- A run waiting at a gate survives the console being closed and reopened.
- The step trace is kept beside the record, so a run opened tomorrow still shows what each step did and how long it took. A segment resumed over MCP keeps no trace, and the console says so instead of guessing.

The gate form is built from the port's TypeScript type: a `boolean` is a yes/no, a union of literals a choice, an object its fields. **Reject** is offered when the gate has an `onFailure` port.

If the file changed since the run paused, the answer is refused with a message saying so; start a new run. See [Durable Gates](durable-gates) for what pauses a run and how an answer is shaped.

## Debugging

Choose **Step through** on the New run card and the workflow pauses before its first node, or runs to the first breakpoint if you asked for that; the same debugger `fw run --debug` and the `fw_debug_*` tools drive. The debugger cannot hold a gate, so a stepped run stops at the first gate that is not answered by a mock. While it is paused:

| Control | Does |
|---------|------|
| **Step** (`F10`) | Runs the next node, then pauses again — before it, then after it |
| **Continue** (`F5`) | Runs to the end |
| **To breakpoint** (`⇧F5`) | Runs to the next breakpoint |
| **Stop** | Ends the session |

A breakpoint is set by clicking a step's tile, as in an editor's gutter; they are kept per workflow and can be changed while a session is paused. The step the run is paused at is marked in the process, with *before* or *after*. When it is paused after a step, that step's outputs are editable in its Step card: the new value is what the next node reads, which is how a branch is forced or a bad value patched without a rerun.

A debug session is a held process, not a run in the store: it is not listed by `fw_runs`, does not survive the console closing, and cannot hold a gate — a gated workflow can be stepped as far as its first gate, where the session ends and says so. See [Debugging](debugging) for the same facility from the CLI and MCP.

## Packs

The Packs view lists the packs installed in the project — the third glyph on the left bar. Each pack opens as a page: the node types it adds with their ports, the export targets, the annotations it understands and where they land, its rule sets, docs, CLI commands and MCP tools, and whether this Flow Weaver is new enough for it. A step whose node type came from a pack says so and links there; what a pack's tags said about a workflow or a step shows on its card as *pack tags*.

Three more things live under Packs:

- **Export** — when a pack provides an export target, the workflow gets an Export pane: pick the target, see the `@deploy` keys it reads and their current values, preview the generated files, write them, and follow the target's own deploy instructions. The same export is one click away as an `fw export` command.
- **Find a pack** — a search of the npm registry narrowed to packs. Installing one is `fw market install`, put on the command line for you to run; a private registry is reached with `fw market search --registry`.
- **This pack** — when the open project is itself a pack, the console shows what `fw market pack` would do before it does it: the manifest generated from the sources, the marketplace rules over it, and what writing `flowweaver.manifest.json` would change. `fw market pack` and `fw market publish --dry-run` are on the command line.

See [Marketplace](marketplace) for what a pack can contain and how one is made.

## The guide

The guide you are reading is part of the console. Open a topic from the rail and it takes the centre, with its contents on the right and, where it applies, the workflows in this project the topic is about — the gated ones on *Durable Gates*, the ones with issues on *Error Codes*.

Every `fw` command in a page can be put into the **CLI** pane with one click, with the open workflow's file filled in, and run there. Each page can also be copied in its compact form, the same bytes `fw_docs` gives an assistant, to paste into a conversation.

## The command line

The **CLI** pane runs `fw` commands in the project — as an argument list handed to this install of the CLI, never through a shell, so quoting means the same on every platform. Long-lived commands (`console`, `mcp-server`, `watch`, `dev`, `serve`) are refused with a reason.

- **Type** — `Tab` completes commands, subcommands and flags from the CLI reference and from installed packs' commands; `↑`/`↓` walk the session's history; `Enter` runs.
- **Build** — *Commands* opens the catalogue as a form: pick a command, fill its arguments (the open workflow's file is filled in for an input) and its options, with each flag's description and default beside it; the line it makes is shown as you go, and examples from the reference can be taken as a starting point. Typing and the form are two views of one line: a typed line opens in the form with what it had, and the form writes back to the line.
- **Placeholders** — a line with a `<placeholder>` still in it, from a ▶ in the guide say, opens the form on that command with the rest filled in.
- **Output** — streamed as the command runs, with the exit status and time; each run can be stopped, run again, copied, opened full screen or removed.

## Status

The heart glyph at the bottom of the bar opens Status: the `fw` processes alive on this machine and what they are doing, which editors have the MCP server registered and from which install, the environment as `fw doctor` sees it, and whether each registry in `.npmrc` answers with its token.

An MCP server speaks stdio to the editor that started it, so nothing can connect to it to ask; instead every long-lived `fw` process — `mcp-server`, `serve`, `console` — announces itself in `~/.fw/services/` when it starts and notes each tool call or request. Status, and `fw doctor`'s *Running services* check, read that directory; a record whose process is gone is dropped. A server answering from another install than the one you are editing is called out, since edits do not reach it.

## Handing a workflow over

**Share**, at the top right of a workflow, downloads it as one self-contained file for someone who will not open the console: the **brief** — the graph first, large, every step there to be clicked for what it does, what it reads and where its failure goes, then what goes in, what comes out and where a person or an agent is needed; the same brief as a **PDF** — a one-page overview with the graph beside the contract, the pauses and the failure arms, then every step in detail — printed by the browser on this machine; or the **diagram** as an SVG for a slide or a document. The graph in all three is the spine drawn on screen — the same lane layout, tiles and colours — so what a stakeholder sees is what the operator sees. `fw artifact` produces the same three files from the command line.

## Keys

| Key | Does |
|-----|------|
| `Esc` | Closes full-screen code and dialogs |

## Related Topics

- [CLI Reference](cli-reference) — `fw console` flags
- [Durable Gates](durable-gates) — gates, answers, and driving a run from an assistant
- [Debugging](debugging) — reading traces and fixing validation errors
