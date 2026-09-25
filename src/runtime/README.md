# runtime/

This folder does not mean the library ships a runtime. Generated workflows have zero
dependencies on `@synergenius/flow-weaver` at execution time. The files here serve
two purposes that happen to share types.

---

## The inlined runtime

`ExecutionContext.ts`, `continuation-core.ts`, `durable-execution.ts`

Generated code imports none of these; a compiled file carries their text instead, and
here the source *is* the text. `scripts/generate-inline-engine.ts` reads the three
files, drops their `import` statements and `export` modifiers, turns doc comments into
plain block comments, and writes `src/api/inline-engine.generated.ts` (gitignored,
produced by `prebuild` and by the vitest global setup). `generateInlineRuntime` in
`src/api/inline-runtime.ts` prepends what the imports provided (the package version,
the event and debugger types, `CancellationError`), writes the execution context and
then the engine, and appends the `export` list a compiled file offers
(`INLINE_ENGINE_EXPORTS`).

So there is one `GeneratedExecutionContext`: the class the package exports (from the
root, typed against by `debug-controller.ts`, driven by the tests) is the class a
compiled workflow runs, and the package's coordinator runs the same engine modules. A
change to either reaches compiled files on the next compile, and the generator goldens
pin the copied text.

A compiled file comes in a `development` variant (full debug event stream) and a
`production` variant (no debug instrumentation). `ExecutionContext.ts` marks what the
production variant leaves out with comment lines: a region between
`// inline: development only` and `// inline: end` is removed, and a region opened by
`// inline: development only, a no-op stub in production` becomes one
`name(_args: unknown): void` stub per method, so generated calls still resolve. The
package and the development variant keep both kinds of region.

Because they are copied into user files, these modules follow rules the rest of the
package does not:

- import values only from each other and `generated-version.ts`, plus
  `CancellationError` in `ExecutionContext.ts`, which the inlined runtime declares
  ahead of the class. Types may be imported (`FwMockConfig`, `TDebugger`,
  `DebugController`, the event types) because the inlined runtime provides them.
- no Node API. `sha256Hex` is SHA-256 in plain JavaScript, UTF-8 lengths are counted by
  hand, and nothing past ES2020 is allowed (`Object.hasOwn`, `.at()` are out).
- module-private helpers carry distinctive names (`durableAddressKey`, `canonicalJson`),
  since they land at the top level of somebody's file.
- `WorkflowRuntime.durable` is the `DurableEngine` interface, never the class, so a
  runtime built by the package and one built by a compiled file's copy are
  interchangeable to the type checker.

`CancellationError.ts` and the event types in `events.ts` are not inlined from source:
`generateInlineRuntime` still writes its own `CancellationError` and event types, so
those are the one pair left to keep in step by hand.

`continuation.ts` adds `decodeContinuation` (the strict parse and the checks that need
the compiled graph) on top of the core, for the coordinator only.

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
