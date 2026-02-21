# runtime/

This folder does not mean the library ships a runtime. Generated workflows have zero
dependencies on `@synergenius/flow-weaver` at execution time. The files here serve two
different purposes that happen to share types.

---

## The inlined execution kernel

`ExecutionContext.ts`, `CancellationError.ts`, `events.ts`

None of these are imported by generated code. Instead, `src/api/inline-runtime.ts`
stringifies their logic and copy-pastes it as source code directly into every generated
output file. The result is a standalone `.ts` file with no external imports.

These source files are the canonical source of truth for what gets inlined. Change
`ExecutionContext.ts` and all future generated files will reflect it — existing generated
files are unaffected until you regenerate them.

The compiler generates two variants: a `production` build (no debug instrumentation,
no-op event stubs) and a `development` build (full debug event stream, WebSocket debug
client). The source files here always represent the full development version; production
stripping happens at code-generation time inside `inline-runtime.ts`.

## The function registry

`function-registry.ts`, `builtin-functions.ts`, `parameter-resolver.ts`

These are not inlined. They only appear when using a multi-workflow HTTP deployment
target (`--target lambda|vercel|cloudflare|inngest --multi`). In that case the compiler
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
