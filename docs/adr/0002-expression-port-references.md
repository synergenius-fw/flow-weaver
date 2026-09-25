# 0002. An expression may reference upstream ports, and each reference is an edge

**Status:** accepted
**Date:** 2026-09-18
**Scope:** the annotation language, the parser, the TypeScript generator, validation, the annotation generators

## Context

Every data edge in a Flow Weaver workflow is declared: `@connect a.x -> b.y`,
or a `@path` that resolves ports by name. That is the model, and it is what
the validator, the visual editor (since removed), the durable graph and the packs all read.

Writing an agent-driven workflow against that model showed one recurring
cost. A node's input often has to be a small reshaping of values that
already exist upstream: the three ports of an agent gate built from two
workflow params and one earlier output, a port whose upstream name differs,
a constant merged with a field. The only way to express a transform between
ports was a node function, so every such case became a node type of ten to
twenty lines whose body was a single object literal. In a two-gate workflow
those glue nodes were the majority of the file.

`[expr: port="..."]` already exists on `@node` lines, but an expression was a
constant: it could not name anything produced by the workflow, because
nothing in the generated body was in scope under those names. Any
`Start.path` or `route.risk` in an expression evaluated to `undefined` or
threw.

Two properties must survive whatever fixes this. The graph must stay
explicit: an edge that ordering, cycle detection, the editor or the durable
continuation cannot see is not an edge. And the compiled output must stay
free of any Flow Weaver runtime dependency.

## Decision

### A reference is syntactic, and only two shapes qualify

Inside an expression, a property access whose object is a bare identifier
naming `Start` or an instance of the workflow, and whose property is a
declared data port of it, is a reference. Further property access after the
port belongs to the expression (`Start.expense.id` references
`Start.expense`).

```ts
 * @node reviewer waitForAgent [expr:
 *   agentId="'review'",
 *   context="{ id: Start.expense.id, risk: route.risk }",
 *   prompt="`Draft a decision for expense ${Start.expense.id}`"]
```

The expression is parsed with the TypeScript parser, never matched as text.
A name inside a string literal is not a reference; a name inside a template
literal substitution is. `Start["path"]`, `f().port` and `x[0].port` are not
references. A parameter of an arrow function inside the expression shadows a
candidate name within that function.

No grammar changes. The `[expr:]` attribute, its escaping, and the annotation
generator that re-emits it are untouched.

### Each reference becomes a derived connection

For every distinct (source port, target port) pair the parser appends a
connection to `workflow.connections` with

```ts
derived: { kind: 'expression', expression: '<the expression text>' }
```

The instance's `portConfigs[].expression` remains the single source of the
value. The connection records the dependency. Because it is an ordinary
element of `workflow.connections`, the control-flow graph orders the source
before the target, `validateCycles` reports a reference cycle as
`CYCLE_DETECTED`, `data-deps` and `execution-order` queries include it, the
diagram draws it, and the continuation graph lists the source among the
gate's predecessors. None of those consumers know about expressions.

A derived connection differs from an authored one in exactly four places,
each because the expression transforms the value:

- it is never written back as `@connect` and takes no part in `@path`
  detection; the expression on the `@node` line implies it
- `MULTIPLE_CONNECTIONS_TO_INPUT` ignores it: one expression may read several
  upstream ports into one target, and the expression is the single value
- type compatibility is not checked across it: the source port's type says
  nothing about what the expression produces
- `removeConnection` refuses it and names the expression to edit instead

`MISSING_REQUIRED_INPUT` was already satisfied by an expression and still is.

### The generator fetches, substitutes, then evaluates

Where the generator emits an instance expression it first emits one fetch
per referenced port, using the same `ctx.getVariable` call and execution
index resolution a connection uses, then substitutes each `root.port` span in
the expression text with the fetched local and evaluates the result. Nothing
new exists at run time; the compiled body reads values it already had access
to. Function-form expressions (`(ctx) => ...`) are rewritten the same way.

### Errors are reported by the parser, naming the instance and port

Like the `@path` errors, each starts with `[expr] <instance>.<port>:`.

| Situation | Error |
|---|---|
| `Start.x` where `x` is not a `@param` | `"Start.x" is not a workflow param. Available: ...` |
| `node.x` where `x` is not a data output | `"node.x" is not an output of "node". Available: ...` |
| `node.onSuccess` | `"node.onSuccess" is a control port. Expressions can only reference data ports.` |
| a node referencing itself | `an expression cannot reference its own node` |
| the instance or the source is a scoped child | `crosses a scope boundary. Expression references are only supported between top-level nodes; use @connect with a scope qualifier instead.` |
| the identifier is also a top-level binding of the file and its property is a port | `is ambiguous. "node" is both a node in this workflow and a top-level binding of this file. Rename one of them, or read the binding through a helper.` |

When the identifier is also a top-level binding but its property is not a
port, the expression is plain JavaScript, as it always was. Node type
functions do not count as shadowing bindings: `@node route route` is the
common naming style, and a property read on a function is never intended.

### Compatibility

No valid file changes meaning. A reference could not work before, so no
working expression contained one; an expression without references produces
no derived connections and compiles to the same code. The graph fingerprint
of an existing file is unchanged. A file that adopts references changes its
fingerprint, which invalidates its paused durable runs, as any edit to a
workflow does.

The AST change is additive: one optional field on `TConnectionAST`. A pack
export target that interprets expressions itself will see `Start.x` in an
expression it does not understand; such a target must learn the derived
connections or reject expressions that carry references. The TypeScript
target is the only one in this repository.

### Out of scope, deliberately

- References across a scope boundary. The scope callback protocol already
  has an explicit syntax for that (`node.port:scope`); bringing it into
  expressions is a separate decision.
- Bracket access and computed keys. Dot access on a bare identifier is the
  whole surface, so the rule fits in one sentence.
- Inferring the expression's result type. The target port keeps its declared
  type; validation does not try to type the expression.
- A grammar for inline renames in `@path`, and a single `task` port on
  `waitForAgent`. Both were considered alongside this decision; both are
  subsumed by it, since a rename is `[expr: y="a.x"]` and the gate's three
  ports can be filled from upstream values directly.
