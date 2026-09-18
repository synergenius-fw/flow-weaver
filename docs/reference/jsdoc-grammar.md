---
name: Flow Weaver JSDoc Grammar
description: Formal syntax grammar for @flowWeaver JSDoc annotations parsed by Chevrotain
keywords: [grammar, syntax, JSDoc, annotations, input, output, connect, node, Chevrotain, EBNF, scope, position, durablePure, durableGate, durableEffect]
---

# JSDoc Block Structure

All Flow Weaver annotations live inside standard JSDoc `/** ... */` blocks placed directly above a `function` declaration. The parser recognizes three block types based on the `@flowWeaver` tag value.

```
jsdocBlock     ::= "/**" { tagLine } "*/"
tagLine        ::= "*" "@" TAG_NAME [ tagContent ]
```

---

# Block Types

```
flowWeaverTag  ::= "@flowWeaver" ( "nodeType" | "workflow" | "pattern" )
```

---

# Node Type Tags

A `@flowWeaver nodeType` block accepts these tags (order does not matter):

```
nodeTypeBlock  ::= "@flowWeaver nodeType"
                   [ "@expression" ]
                   [ "@name" TEXT ]
                   [ "@label" TEXT ]
                   [ "@description" TEXT ]
                   [ "@scope" IDENTIFIER ]
                   [ "@executeWhen" IDENTIFIER ]
                   [ "@pullExecution" IDENTIFIER ]
                   [ "@resilience" ( "retries=" INTEGER | "fallback=" STRING ) { ( "retries=" INTEGER | "fallback=" STRING ) } ]
                   [ "@durablePure" | "@durableGate" ( "approval" | "input" | "agent" ) | "@durableEffect" ]
                   [ "@color" TEXT ]
                   [ "@icon" TEXT ]
                   { "@tag" IDENTIFIER [ STRING ] }
                   { inputTag }
                   { outputTag }
                   { stepTag }
```

The durable classification is optional for an ordinary node type and required for every node reachable from a workflow that contains a `@durableGate`. See [Durable Gates](durable-gates).

`@flowWeaver node` is accepted as shorthand for `@flowWeaver nodeType` with `@expression`: the function takes no `execute` parameter and returns its data directly, and the parser infers the ports from the signature. Prefer the explicit form in files you write.

---

# Port Tags (Input / Output / Step)

These are parsed by the Chevrotain port grammar.

## @input

```
inputTag       ::= "@input" ( bracketedInput | plainInput )
                   [ scopeClause ] { metadataBracket } [ descriptionClause ]

plainInput     ::= IDENTIFIER
bracketedInput ::= "[" IDENTIFIER [ "=" defaultValue ] "]"

defaultValue   ::= IDENTIFIER | INTEGER | STRING
```

**Examples:**

```
@input name                       plain required input
@input [name]                     optional input (no connection required)
@input [name=defaultValue]        optional with default (identifier)
@input [name=42]                  optional with default (integer)
@input [name="hello"]             optional with default (string)
@input name scope:myScope         scoped input
@input name [order:2]             with ordering metadata
@input name - Description text    with description
```

## @output

```
outputTag      ::= "@output" IDENTIFIER
                   [ scopeClause ] { metadataBracket } [ descriptionClause ]
```

**Examples:**

```
@output result
@output result scope:myScope
@output result [order:1, placement:TOP]
@output result - The computed result
```

## @step

```
stepTag        ::= "@step" IDENTIFIER [ descriptionClause ]
```

**Examples:**

```
@step process
@step process - Runs the processing pipeline
```

---

# Shared Clauses

```
scopeClause    ::= "scope:" IDENTIFIER

metadataBracket ::= "[" metadataAttr { "," metadataAttr } "]"

metadataAttr   ::= orderAttr | placementAttr | typeAttr | mergeStrategyAttr

orderAttr      ::= "order:" INTEGER
placementAttr  ::= "placement:" ( "TOP" | "BOTTOM" )
typeAttr       ::= "type:" IDENTIFIER
mergeStrategyAttr ::= "mergeStrategy:" IDENTIFIER

descriptionClause ::= "-" TEXT
```

Metadata brackets can be repeated: `@input name [order:1] [placement:TOP]`

---

# Workflow Tags

A `@flowWeaver workflow` block accepts these tags:

```
workflowBlock  ::= "@flowWeaver workflow"
                   [ "@name" TEXT ]
                   [ "@description" TEXT ]
                   [ "@strictTypes" [ "false" ] ]
                   [ "@autoConnect" ]
                   { fwImportTag }
                   { "@param" paramTag }
                   { ( "@returns" | "@return" ) returnsTag }
                   { nodeTag }
                   { connectTag }
                   { pathTag }
                   { mapTag }
                   { positionTag }
                   { scopeTag }
```

## @strictTypes

```
strictTypesTag ::= "@strictTypes" [ "false" ]
```

Enables strict type checking for the workflow. When present (or with any value other than `"false"`), type warnings (LOSSY_TYPE_COERCION, UNUSUAL_TYPE_COERCION, TYPE_MISMATCH) are promoted to errors. Defaults to off when absent.

**Examples:**

```
@strictTypes              enables strict mode
@strictTypes false        explicitly disables
```

## @autoConnect

```
autoConnectTag ::= "@autoConnect"
```

Enables automatic linear connection wiring for the workflow. When present, the compiler automatically wires nodes in declaration order (connecting compatible ports from previous nodes). No value is needed — presence enables the feature.

**Examples:**

```
@autoConnect
```

## @fwImport

```
fwImportTag    ::= "@fwImport" IDENTIFIER IDENTIFIER "from" QUOTED_STRING

QUOTED_STRING  ::= STRING | "'" { any character except "'" } "'"
```

Import npm package functions or local module exports as node types. The imported function becomes a node that can be instantiated with `@node`. Both double and single quotes are accepted for the module specifier.

**Examples:**

```
@fwImport npm/lodash/map map from "lodash"
@fwImport npm/date-fns/format format from "date-fns"
@fwImport local/utils/helper helper from './utils'
@fwImport waitForApproval waitForApproval from "flow-weaver-pack-example"
```

- First identifier: node type name (used in `@node` tags, convention: `npm/pkg/fn` or `local/path/fn`, or just the function name for a marketplace pack node)
- Second identifier: exported function name to import
- String: package name or relative path
- Port types are inferred from the imported function's TypeScript `.d.ts`
- Inference follows re-export barrels: packages whose entry `.d.ts` is a barrel (`export * from './sub'` / `export { fn } from './sub'`) resolve correctly. This is the common shape for marketplace packs, whose entry point re-exports their node types
- A function annotated with `@flowWeaver nodeType` in the `.d.ts` keeps its full port set (inputs, outputs, `onSuccess`/`onFailure`); a plain function maps to an expression node. With no `.d.ts`, the import falls back to a stub with a single `ANY` `result` port
- The compiler emits a real `import { fn } from "<pkg>"` in the generated output, so the function is callable at run time. The package must be resolvable from where the compiled workflow runs (installed in `node_modules`, or otherwise on the module resolution path)

## @node

```
nodeTag        ::= "@node" IDENTIFIER IDENTIFIER [ parentScopeRef ] { attributeBracket }

parentScopeRef ::= IDENTIFIER "." IDENTIFIER

attributeBracket ::= "[" nodeAttr { "," nodeAttr } "]"

nodeAttr       ::= labelAttr | exprAttr | portOrderAttr | portLabelAttr
                 | minimizedAttr | pullExecutionAttr | sizeAttr
                 | colorAttr | iconAttr | tagsAttr | suppressAttr
                 | positionAttr | jobAttr | environmentAttr

labelAttr      ::= "label:" STRING
exprAttr       ::= "expr:" IDENTIFIER "=" STRING { "," IDENTIFIER "=" STRING }
portOrderAttr  ::= "portOrder:" IDENTIFIER "=" INTEGER { "," IDENTIFIER "=" INTEGER }
portLabelAttr  ::= "portLabel:" IDENTIFIER "=" STRING { "," IDENTIFIER "=" STRING }
minimizedAttr  ::= "minimized"
pullExecutionAttr ::= "pullExecution:" IDENTIFIER
sizeAttr       ::= "size:" INTEGER INTEGER
colorAttr      ::= "color:" STRING
iconAttr       ::= "icon:" STRING
tagsAttr       ::= "tags:" tagEntry { "," tagEntry }
tagEntry       ::= STRING [ STRING ]
positionAttr   ::= "position:" INTEGER INTEGER
jobAttr        ::= "job:" STRING
environmentAttr ::= "environment:" STRING
suppressAttr   ::= "suppress:" STRING { "," STRING }
```

Multiple attribute brackets are allowed (zero or more). Attributes can be split across brackets or combined in one.

**Examples:**

```
@node myAdd Add
@node myAdd Add [label: "My Adder"]
@node myAdd Add parent.loopScope
@node myAdd Add [expr: a="x + 1", b="y * 2"]
@node myAdd Add [portOrder: a=1, b=2]
@node myAdd Add [minimized, label: "Compact"]
@node myAdd Add [pullExecution: trigger]
@node myAdd Add [size: 200 150]
@node myAdd Add [color: "red", icon: "database"]
@node myAdd Add [tags: "math" "Math operation", "transform"]
@node myAdd Add [position: 180 0]
@node myAdd Add [label: "hi"] [color: "#f00"] [position: 360 0]
@node build npmBuild [job: "build"]
@node deploy deploySsh [job: "deploy"] [environment: "production"]
@node fetch fetchData [suppress: "UNUSED_OUTPUT_PORT"]
```

## @connect

```
connectTag     ::= "@connect" portRef "->" portRef

portRef        ::= IDENTIFIER "." IDENTIFIER [ ":" IDENTIFIER ]
                 | IDENTIFIER ":" IDENTIFIER
```

The first form is the standard `node.port` reference with optional `:scope` suffix. The second form is a pseudo-node reference: `secret:NAME` resolves to `{ nodeId: "secret:NAME", portName: "value" }`.

**Examples:**

```
@connect myAdd.result -> myLog.message
@connect loop.item -> process.input:loopScope
@connect secret:NPM_TOKEN -> publish.token
```

## @path

```
pathTag        ::= "@path" pathSequence ( "," pathSequence )*
pathSequence   ::= pathStep ( "->" pathStep )+
pathStep       ::= IDENTIFIER [ ":" ( "ok" | "fail" ) ]
```

Declare a complete execution route through the graph with scope walking for data ports. Steps separated by `->`, each optionally suffixed with `:ok` (default) or `:fail` to select `onSuccess` or `onFailure`.

Multiple paths can be declared in a single `@path` tag using commas, or as separate `@path` tags. Both forms are equivalent.

**Examples:**

```
@path Start -> validator -> classifier -> urgencyRouter:fail -> escalate -> Exit
@path Start -> validator:ok -> processor -> Exit
```

Comma-separated (equivalent to two `@path` tags):

```
@path Start -> enrichCompany -> scoreLead -> Exit, Start -> enrichContact -> scoreLead
```

- `:ok` follows `onSuccess` (default when no suffix)
- `:fail` follows `onFailure`
- Data ports auto-resolve by walking backward through the path to the nearest ancestor with a same-name output port (scope walking)
- Multiple `@path` lines can coexist; overlapping prefixes are deduplicated
- Comma-separated paths within a single `@path` are expanded to separate paths
- Manual `@connect` lines can supplement for cross-named ports

## @position

Standalone `@position` is reserved for Start and Exit virtual nodes, which have no `@node` line. For instance nodes, use the `[position: x y]` bracket attribute on `@node` instead.

```
positionTag    ::= "@position" IDENTIFIER INTEGER INTEGER
```

**Examples:**

```
@position Start -450 0
@position Exit 450 0
```

## @scope

```
scopeTag       ::= "@scope" scopeRef "[" IDENTIFIER { "," IDENTIFIER } "]"

scopeRef       ::= IDENTIFIER | IDENTIFIER "." IDENTIFIER
```

**Examples:**

```
@scope loopScope [process, validate]
@scope container.inner [step1, step2]
```

## @map

```
mapTag         ::= "@map" IDENTIFIER IDENTIFIER [ "(" IDENTIFIER "->" IDENTIFIER ")" ]
                   "over" IDENTIFIER "." IDENTIFIER
```

Declares a map (iteration) node that processes items from a source array port using a child node type. The optional port mapping overrides the default input/output port wiring.

**Examples:**

```
@map loop process over scan.files
@map loop process(inputPort -> outputPort) over scan.files
```

- First identifier: instance ID for the map node
- Second identifier: child node type to execute per item
- Optional port mapping: `(inputPort -> outputPort)` overrides default wiring
- `over` clause: `sourceNode.sourcePort` specifies the array to iterate

## @param / @returns (workflow I/O)

```
paramTag       ::= IDENTIFIER [ scopeClause ] { metadataBracket } [ descriptionClause ]
returnsTag     ::= IDENTIFIER [ scopeClause ] { metadataBracket } [ descriptionClause ]
```

These follow the same clause syntax as port tags. `@return` is accepted as an alias for `@returns`.

## @trigger (workflow-level)

```
triggerTag     ::= "@trigger" ( "event=" STRING | "cron=" STRING )*
```

Declares an event or cron trigger for a deployment target. Can specify event, cron, or both.

**Examples:**

```
@trigger event="agent/request"
@trigger cron="0 9 * * *"
@trigger event="agent/request" cron="0 9 * * *"
```

## @cancelOn (workflow-level)

```
cancelOnTag    ::= "@cancelOn" "event=" STRING [ "match=" STRING ] [ "timeout=" STRING ]
```

Cancels a running workflow when a specified event is received; used by deployment targets that support cancellation.

**Examples:**

```
@cancelOn event="app/user.deleted"
@cancelOn event="app/user.deleted" match="data.userId"
@cancelOn event="x" match="data.id" timeout="1h"
```

## @retries (workflow-level)

```
retriesTag     ::= "@retries" INTEGER
```

Sets the retry count a deployment target should apply.

**Examples:**

```
@retries 5
@retries 0
```

## @timeout (workflow-level)

```
timeoutTag     ::= "@timeout" STRING
```

Sets the maximum execution time a deployment target should apply.

**Examples:**

```
@timeout "30m"
@timeout "2h"
```

## @throttle (workflow-level)

```
throttleTag    ::= "@throttle" "limit=" INTEGER [ "period=" STRING ]
```

Limits concurrent executions; applied by deployment targets that support throttling.

**Examples:**

```
@throttle limit=3 period="1m"
@throttle limit=10
```

---

# Pattern Tags

A `@flowWeaver pattern` block defines a reusable partial workflow with boundary ports:

```
patternBlock   ::= "@flowWeaver pattern"
                   [ "@name" TEXT ]
                   [ "@description" TEXT ]
                   { nodeTag }
                   { positionTag }
                   { connectTag }
                   { portTag }

portTag        ::= "@port" ( "IN" | "OUT" ) "." IDENTIFIER [ "-" TEXT ]
```

Pattern ports define the boundary connections (IN for inputs, OUT for outputs) that are wired when the pattern is applied to a workflow.

**Examples:**

```
@port IN.data - Input data to process
@port OUT.result - Processed result
@port IN.config - Configuration object
@port OUT.error - Error output
```

---

# Terminals

<!-- AUTO:START terminals -->
```
IDENTIFIER ::= [a-zA-Z_$] [a-zA-Z0-9_$\/-]*
INTEGER    ::= "-"? [0-9]+
STRING     ::= '"' { any character except '"' or '\', or escape sequence } '"'
TEXT       ::= any characters to end of line
```
IDENTIFIER supports `/` and `-` to accommodate npm package naming conventions (e.g., `npm/react-window/areEqual`).
<!-- AUTO:END terminals -->

---

# Related Topics

- `advanced-annotations` — Conceptual explanations and examples for pull execution, execution strategies, merge strategies, auto-connect, strict types, path/map sugar, and node attributes
- `compilation` — How annotations affect code generation and pack targets for @trigger/@cancelOn/@retries/@timeout/@throttle
- `concepts` — Core workflow fundamentals and quick reference
- `error-codes` — Validation errors and warnings for annotation issues
