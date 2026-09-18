# Changelog

All notable changes to this project are documented in [GitHub Releases](https://github.com/synergenius-fw/flow-weaver/releases).

This project follows [Semantic Versioning](https://semver.org/) during alpha. Breaking changes may occur between minor versions until v1.0.

## Unreleased

- **Expressions can reference upstream ports.** Inside `[expr: port="..."]`, `Start.<param>` and `<node>.<port>` (with any further property access) read values the workflow already has. Each reference becomes a connection marked as derived from the expression, so ordering, cycle detection, `fw_query`, the diagram and the durable continuation all see the dependency; the generator fetches the values and substitutes them before evaluating. A derived connection is never written as `@connect`, is exempt from the one-source and type-compatibility rules, and cannot be removed on its own. Unknown ports, control ports, self-references, scope-crossing references and names that are also top-level bindings of the file are parse errors that name the instance and port. No existing file changes meaning: a reference could not work before, and an expression without one produces no derived connection. See ADR 0002.
- **`@path` resolves Exit ports by name.** A `@returns` port now resolves to the nearest earlier step with a same-name output, like any other step's input, so a linear pipeline with consistent port names needs no `@connect` at all. An explicit `@connect` to the port wins, and a `Start` param never resolves straight to Exit. The only observable change for an existing file is an Exit port that was unconnected and reported by `UNREACHABLE_EXIT_PORT`, which now receives its value. Connection order is unchanged, so graph fingerprints of unchanged files are unchanged.
- Docs teach the compact form: the orientation model leads with `@expression` and `@path`; the tutorial, concepts, durable-gates, built-in-nodes, iterative-development and export-interface examples are rewritten in it and validated; the `sequential` and `foreach` templates generate it, with a test that validates and runs both. The docs now state what a throw in an expression node actually does: it marks the node failed and propagates out of the workflow call, so routing a failure to another node still needs a normal-mode node.
- The durable-gates topic now says that an **effect** after branch convergence is refused, not only a gate; a test pins the engine's behaviour.
- **Breaking (MCP):** removed `fw_create_model`, `fw_implement_node` and `fw_workflow_status`. They generated an undocumented stub form that the rest of the pipeline could not process (no `(execute, params)` workflow signature, single outputs renamed to `result`, no durable classification) and made the authoring path more confusing than writing the file. The `flow-weaver-nocode` prompt, the `fw init` persona prompts and the orientation topic now say to write the workflow file directly.
- `fw_modify`, `fw_modify_batch` and `fw modify` rewrite only the JSDoc annotations. A file that has not been compiled in place stays uncompiled instead of growing a runtime section and generated body on its first structural edit. A file that was already compiled in place is still recompiled so its body stays consistent.
- In-place generation now round-trips `@durablePure`, `@durableGate <kind>` and `@durableEffect`, both on authored node types and on the built-in gates it inlines. Previously a compiled gated workflow lost every classification on re-parse and `fw_run` failed with "waitForAgent requires a generated durable agent gate".
- `addConnection` is idempotent: a connection that already exists (explicitly or through `@autoConnect`) is skipped with a warning instead of failing the whole batch.
- MCP validation items carry one next step, `hint` or `fix`, instead of a `friendly` block whose title and explanation restated the message.
- `OBJECT_TYPE_MISMATCH` is no longer reported when either side is an opaque object type (`object`, `Record<string, unknown>`, `{}`) or the target is `unknown`, so the built-in gates' `context` and `agentResult` ports connect without a false warning.
- Docs: the orientation loop no longer points at a generator; `jsdoc-grammar` documents the `@flowWeaver node` shorthand; `mcp-tools` and `durable-gates` describe the annotation-only edit behaviour.

## 0.37.4

- Preserve optional workflow parameter defaults through parsing and generated durable Start values.
