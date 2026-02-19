---
name: Flow Weaver JSDoc Grammar
description: Formal syntax grammar for @flowWeaver JSDoc annotations parsed by Chevrotain
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
                   [ "@color" TEXT ]
                   [ "@icon" TEXT ]
                   { "@tag" IDENTIFIER [ STRING ] }
                   { inputTag }
                   { outputTag }
                   { stepTag }
```

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
                   { fwImportTag }
                   { "@param" paramTag }
                   { "@returns" returnsTag }
                   { nodeTag }
                   { connectTag }
                   { pathTag }
                   { mapTag }
                   { positionTag }
                   { scopeTag }
```

## @fwImport

```
fwImportTag    ::= "@fwImport" IDENTIFIER IDENTIFIER "from" STRING
```

Import npm package functions or local module exports as node types. The imported function becomes an expression node that can be instantiated with `@node`.

**Examples:**

```
@fwImport npm/lodash/map map from "lodash"
@fwImport npm/date-fns/format format from "date-fns"
@fwImport local/utils/helper helper from "./utils"
```

- First identifier: node type name (used in `@node` tags, convention: `npm/pkg/fn` or `local/path/fn`)
- Second identifier: exported function name to import
- String: package name or relative path

Port types are inferred from TypeScript `.d.ts` files when available. Falls back to a stub with `ANY` result port if inference fails.

## @node

```
nodeTag        ::= "@node" IDENTIFIER IDENTIFIER [ parentScopeRef ] [ attributeBracket ]

parentScopeRef ::= IDENTIFIER "." IDENTIFIER

attributeBracket ::= "[" nodeAttr { "," nodeAttr } "]"

nodeAttr       ::= labelAttr | exprAttr | portOrderAttr | portLabelAttr
                 | minimizedAttr | pullExecutionAttr | sizeAttr

labelAttr      ::= "label:" STRING
exprAttr       ::= "expr:" IDENTIFIER "=" STRING { "," IDENTIFIER "=" STRING }
portOrderAttr  ::= "portOrder:" IDENTIFIER "=" INTEGER { "," IDENTIFIER "=" INTEGER }
portLabelAttr  ::= "portLabel:" IDENTIFIER "=" STRING { "," IDENTIFIER "=" STRING }
minimizedAttr  ::= "minimized"
pullExecutionAttr ::= "pullExecution:" IDENTIFIER
sizeAttr       ::= "size:" INTEGER INTEGER
```

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
```

## @connect

```
connectTag     ::= "@connect" portRef "->" portRef

portRef        ::= IDENTIFIER "." IDENTIFIER [ ":" IDENTIFIER ]
```

The optional `:IDENTIFIER` suffix is a scope qualifier.

**Examples:**

```
@connect myAdd.result -> myLog.message
@connect loop.item -> process.input:loopScope
```

## @path

```
pathTag        ::= "@path" pathStep ( "->" pathStep )+
pathStep       ::= IDENTIFIER [ ":" ( "ok" | "fail" ) ]
```

Declare a complete execution route through the graph with scope walking for data ports. Steps separated by `->`, each optionally suffixed with `:ok` (default) or `:fail` to select `onSuccess` or `onFailure`.

**Examples:**

```
@path Start -> validator -> classifier -> urgencyRouter:fail -> escalate -> Exit
@path Start -> validator:ok -> processor -> Exit
```

- `:ok` follows `onSuccess` (default when no suffix)
- `:fail` follows `onFailure`
- Data ports auto-resolve by walking backward through the path to the nearest ancestor with a same-name output port (scope walking)
- Multiple `@path` lines can coexist; overlapping prefixes are deduplicated
- Manual `@connect` lines can supplement for cross-named ports

## @position

```
positionTag    ::= "@position" IDENTIFIER INTEGER INTEGER
```

**Examples:**

```
@position myAdd 100 200
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

## @param / @returns (workflow I/O)

```
paramTag       ::= IDENTIFIER [ scopeClause ] { metadataBracket } [ descriptionClause ]
returnsTag     ::= IDENTIFIER [ scopeClause ] { metadataBracket } [ descriptionClause ]
```

These follow the same clause syntax as port tags.

## @trigger (workflow-level, Inngest)

```
triggerTag     ::= "@trigger" ( "event=" STRING | "cron=" STRING )+
```

Declares an event or cron trigger for Inngest deployment. Can specify event, cron, or both.

**Examples:**

```
@trigger event="agent/request"
@trigger cron="0 9 * * *"
@trigger event="agent/request" cron="0 9 * * *"
```

## @cancelOn (workflow-level, Inngest)

```
cancelOnTag    ::= "@cancelOn" "event=" STRING [ "match=" STRING ] [ "timeout=" STRING ]
```

Cancels a running Inngest function when a specified event is received.

**Examples:**

```
@cancelOn event="app/user.deleted"
@cancelOn event="app/user.deleted" match="data.userId"
@cancelOn event="x" match="data.id" timeout="1h"
```

## @retries (workflow-level, Inngest)

```
retriesTag     ::= "@retries" INTEGER
```

Sets the retry count for an Inngest function (overrides default of 3).

**Examples:**

```
@retries 5
@retries 0
```

## @timeout (workflow-level, Inngest)

```
timeoutTag     ::= "@timeout" STRING
```

Sets the maximum execution time for an Inngest function.

**Examples:**

```
@timeout "30m"
@timeout "2h"
```

## @throttle (workflow-level, Inngest)

```
throttleTag    ::= "@throttle" "limit=" INTEGER [ "period=" STRING ]
```

Limits concurrent executions of an Inngest function.

**Examples:**

```
@throttle limit=3 period="1m"
@throttle limit=10
```

---

# Terminals

```
IDENTIFIER     ::= [a-zA-Z_$] [a-zA-Z0-9_$]*
INTEGER        ::= "-"? [0-9]+
STRING         ::= '"' { any character except '"' or '\', or escape sequence } '"'
TEXT           ::= any characters to end of line
```
