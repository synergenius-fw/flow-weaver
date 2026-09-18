# Changelog

All notable changes to this project are documented in [GitHub Releases](https://github.com/synergenius-fw/flow-weaver/releases).

This project follows [Semantic Versioning](https://semver.org/) during alpha. Breaking changes may occur between minor versions until v1.0.

## Unreleased

- **Breaking (MCP):** removed `fw_create_model`, `fw_implement_node` and `fw_workflow_status`. They generated an undocumented stub form that the rest of the pipeline could not process (no `(execute, params)` workflow signature, single outputs renamed to `result`, no durable classification) and made the authoring path more confusing than writing the file. The `flow-weaver-nocode` prompt, the `fw init` persona prompts and the orientation topic now say to write the workflow file directly.
- `fw_modify`, `fw_modify_batch` and `fw modify` rewrite only the JSDoc annotations. A file that has not been compiled in place stays uncompiled instead of growing a runtime section and generated body on its first structural edit. A file that was already compiled in place is still recompiled so its body stays consistent.
- In-place generation now round-trips `@durablePure`, `@durableGate <kind>` and `@durableEffect`, both on authored node types and on the built-in gates it inlines. Previously a compiled gated workflow lost every classification on re-parse and `fw_run` failed with "waitForAgent requires a generated durable agent gate".
- `addConnection` is idempotent: a connection that already exists (explicitly or through `@autoConnect`) is skipped with a warning instead of failing the whole batch.
- MCP validation items carry one next step, `hint` or `fix`, instead of a `friendly` block whose title and explanation restated the message.
- `OBJECT_TYPE_MISMATCH` is no longer reported when either side is an opaque object type (`object`, `Record<string, unknown>`, `{}`) or the target is `unknown`, so the built-in gates' `context` and `agentResult` ports connect without a false warning.
- Docs: the orientation loop no longer points at a generator; `jsdoc-grammar` documents the `@flowWeaver node` shorthand; `mcp-tools` and `durable-gates` describe the annotation-only edit behaviour.

## 0.37.4

- Preserve optional workflow parameter defaults through parsing and generated durable Start values.
