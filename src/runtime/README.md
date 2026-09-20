# runtime/

This folder does not mean the library ships a runtime. Generated workflows have zero
dependencies on `@synergenius/flow-weaver` at execution time. The files here serve
three purposes that happen to share types.

---

## The inlined execution kernel

`ExecutionContext.ts`, `CancellationError.ts`, `events.ts`

None of these are imported by generated code. Instead, `src/api/inline-runtime.ts`
emits their logic as source code directly into every generated output file. The
result is a standalone `.ts` file with no external imports.

These source files are the canonical source of truth for what gets inlined. Change
`ExecutionContext.ts` and all future generated files will reflect it — existing generated
files are unaffected until you regenerate them.

The compiler generates two variants: a `production` build (no debug instrumentation,
no-op event stubs) and a `development` build (full debug event stream). The source files
here always represent the full development version; production stripping happens at
code-generation time inside `inline-runtime.ts`.

## The inlined durable engine

`continuation-core.ts`, `durable-execution.ts`

The engine behind gates and effects is inlined too, and here the source *is* the text:
`scripts/generate-inline-engine.ts` reads these two files, drops their `import`
statements and `export` modifiers, turns doc comments into plain block comments, and
writes `src/api/inline-engine.generated.ts` (gitignored; produced by `prebuild` and by
the vitest global setup). `generateInlineRuntime` prepends what the imports provided —
the package version and aliases for the three host types — and appends the `export`
list a compiled file offers (`INLINE_ENGINE_EXPORTS`). The package's coordinator runs
the same modules, so there is one engine and it cannot drift.

Because they are copied into user files, these two modules follow rules the rest of the
package does not:

- import values only from each other and `generated-version.ts`; types may be imported
  (`FwMockConfig`, `TDebugger`, `DebugController`) because the inliner aliases them;
- no Node API — `sha256Hex` is SHA-256 in plain JavaScript, UTF-8 lengths are counted by
  hand — and nothing past ES2020 (`Object.hasOwn`, `.at()` are out);
- module-private helpers carry distinctive names (`durableAddressKey`, `canonicalJson`),
  since they land at the top level of somebody's file;
- `WorkflowRuntime.durable` is the `DurableEngine` interface, never the class, so a
  runtime built by the package and one built by a compiled file's copy are
  interchangeable to the type checker.

`continuation.ts` adds `decodeContinuation` — the strict parse and the checks that need
the compiled graph — on top of the core, for the coordinator only.

## The function registry

`function-registry.ts`, `builtin-functions.ts`, `parameter-resolver.ts`

These are not inlined. They only appear when using a multi-workflow HTTP deployment
target (`--target <target> --multi`). In that case the compiler
copies them into the output directory and the generated handler imports them with a
relative path:

```ts
import { functionRegistry } from './runtime/function-registry.js';
import './runtime/builtin-functions.js';
```

The registry exists because HTTP callers cannot pass JavaScript functions as arguments.
You register a transform once at startup under a string ID (`'string:uppercase'`), then
reference it by that ID in a workflow definition sent over the wire. The generated
handler resolves the string back to the actual function at execution time.
`builtin-functions.ts` pre-registers a standard library of common transforms so the
common cases work without any configuration.

If you are not using a multi-workflow HTTP target, these three files are irrelevant.
No generated workflow file will reference them.
