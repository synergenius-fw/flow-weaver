---
name: Flow Weaver JSDoc Grammar
description: Formal syntax grammar for @flowWeaver JSDoc annotations parsed by Chevrotain
keywords: [grammar, syntax, JSDoc, annotations, input, output, connect, node, Chevrotain, EBNF, scope, position]
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

Import npm package functions or local module exports as node types. The imported function becomes an expression node that can be instantiated with `@node`. Both double and single quotes are accepted for the module specifier.

**Examples:**

```
@fwImport npm/lodash/map map from "lodash"
@fwImport npm/date-fns/format format from "date-fns"
@fwImport local/utils/helper helper from './utils'
```

- First identifier: node type name (used in `@node` tags, convention: `npm/pkg/fn` or `local/path/fn`)
- Second identifier: exported function name to import
- String: package name or relative path

Port types are inferred from TypeScript `.d.ts` files when available. Falls back to a stub with `ANY` result port if inference fails.

## @node

```
nodeTag        ::= "@node" IDENTIFIER IDENTIFIER [ parentScopeRef ] { attributeBracket }

parentScopeRef ::= IDENTIFIER "." IDENTIFIER

attributeBracket ::= "[" nodeAttr { "," nodeAttr } "]"

nodeAttr       ::= labelAttr | exprAttr | portOrderAttr | portLabelAttr
                 | minimizedAttr | pullExecutionAttr | sizeAttr
                 | colorAttr | iconAttr | tagsAttr | positionAttr
                 | jobAttr | environmentAttr

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
```

## @connect

```
connectTag     ::= "@connect" portRef "->" portRef

portRef        ::= IDENTIFIER "." IDENTIFIER [ ":" IDENTIFIER ]
                 | IDENTIFIER ":" IDENTIFIER
```

The first form is the standard `node.port` reference with optional `:scope` suffix. The second form is a pseudo-node reference for CI/CD secrets: `secret:NAME` resolves to `{ nodeId: "secret:NAME", portName: "value" }`.

**Examples:**

```
@connect myAdd.result -> myLog.message
@connect loop.item -> process.input:loopScope
@connect secret:NPM_TOKEN -> publish.token
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

## @trigger (workflow-level, Inngest)

```
triggerTag     ::= "@trigger" ( "event=" STRING | "cron=" STRING )*
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

# CI/CD Workflow Annotations

These tags configure CI/CD pipeline behavior when exporting to GitHub Actions or GitLab CI. They are placed inside `@flowWeaver workflow` blocks alongside standard workflow tags.

## @trigger (CI/CD mode)

When the trigger value is one of `push`, `pull_request`, `dispatch`, `tag`, or `schedule`, the parser treats it as a CI/CD trigger rather than an Inngest event trigger.

```
cicdTriggerTag ::= "@trigger" ( "push" | "pull_request" | "dispatch" | "tag" | "schedule" )
                   { IDENTIFIER "=" STRING }
```

Recognized attributes: `branches`, `paths`, `paths-ignore`, `types`, `pattern`, `cron`.

**Examples:**

```
@trigger push branches="main,develop"
@trigger pull_request branches="main" types="opened,synchronize"
@trigger tag pattern="v*"
@trigger dispatch
@trigger schedule cron="0 9 * * 1"
```

## @secret

```
secretTag      ::= "@secret" IDENTIFIER { IDENTIFIER "=" STRING } [ "-" TEXT ]
```

**Examples:**

```
@secret NPM_TOKEN - NPM authentication token
@secret DEPLOY_KEY scope="deploy" platform="github" - SSH deploy key
```

## @runner

```
runnerTag      ::= "@runner" TEXT
```

**Examples:**

```
@runner ubuntu-latest
@runner self-hosted
```

## @cache

```
cacheTag       ::= "@cache" IDENTIFIER { IDENTIFIER "=" STRING }
```

**Examples:**

```
@cache npm key="package-lock.json"
@cache npm key="package-lock.json" path="~/.npm"
```

## @artifact

```
artifactTag    ::= "@artifact" IDENTIFIER { IDENTIFIER "=" ( STRING | INTEGER ) }
```

**Examples:**

```
@artifact dist path="dist/" retention=5
@artifact coverage path="coverage/"
```

## @environment

```
environmentTag ::= "@environment" IDENTIFIER { IDENTIFIER "=" ( STRING | INTEGER ) }
```

**Examples:**

```
@environment production url="https://app.example.com" reviewers=2
@environment staging
```

## @matrix

```
matrixTag      ::= "@matrix" [ "include" | "exclude" ] { IDENTIFIER "=" STRING }
```

Without a prefix, each key-value pair declares a dimension with comma-separated values. With `include` or `exclude`, it adds or removes a specific combination.

**Examples:**

```
@matrix node="18,20,22" os="ubuntu-latest,macos-latest"
@matrix include node="22" os="windows-latest"
@matrix exclude node="18" os="macos-latest"
```

## @service

```
serviceTag     ::= "@service" IDENTIFIER { IDENTIFIER "=" STRING }
```

**Examples:**

```
@service postgres image="postgres:16" env="POSTGRES_PASSWORD=test" ports="5432:5432"
@service redis image="redis:7" ports="6379:6379"
```

## @concurrency

```
concurrencyTag ::= "@concurrency" IDENTIFIER [ "cancel-in-progress=" ( "true" | "false" ) ]
```

**Examples:**

```
@concurrency deploy cancel-in-progress=true
@concurrency ci-main
```

## @job

Configures per-job settings. The name must match a `[job: "name"]` attribute used on `@node` declarations.

```
jobTag         ::= "@job" IDENTIFIER { IDENTIFIER "=" ( STRING | IDENTIFIER | INTEGER ) }
```

Recognized keys: `retry` (number), `allow_failure` (boolean), `timeout` (string), `runner` (string), `tags` (comma-list), `coverage` (string), `reports` (comma-list of type=path), `rules` (string), `when` (rule modifier), `changes` (rule modifier, comma-list), `extends` (string), `before_script` (comma-list), `variables` (comma-list of KEY=VALUE).

The `when` and `changes` keys are rule modifiers: they apply to the most recently declared `rules` entry for that job. If no `rules` entry exists yet, one is created automatically.

**Examples:**

```
@job build retry=2 timeout="10m"
@job test-unit coverage='/Coverage: (\d+)%/' reports="junit=test-results.xml"
@job deploy allow_failure=true rules="$CI_COMMIT_BRANCH == main"
@job deploy rules="$CI_COMMIT_BRANCH == main" when=manual
@job deploy rules="$CI_COMMIT_TAG" changes="src/**,lib/**"
@job lint tags="docker,linux" extends=".base-lint"
```

## @stage

Declares a pipeline stage for GitLab CI grouping. Multiple `@stage` annotations define stage ordering.

```
stageTag       ::= "@stage" IDENTIFIER
```

**Examples:**

```
@stage test
@stage build
@stage deploy
```

## @variables

Sets workflow-level environment variables. Applied as defaults to all jobs.

```
variablesTag   ::= "@variables" { IDENTIFIER "=" ( STRING | IDENTIFIER ) }
```

**Examples:**

```
@variables NODE_ENV="production" CI="true"
```

## @before_script

Sets workflow-level setup commands. Applied as defaults to all jobs.

```
beforeScriptTag ::= "@before_script" ( STRING | TEXT )
```

**Examples:**

```
@before_script "npm ci"
@before_script npm ci
```

## @tags

Sets workflow-level runner tags. Applied as defaults to all jobs.

```
tagsTag        ::= "@tags" { IDENTIFIER }
```

Tags can be space-separated or comma-separated.

**Examples:**

```
@tags docker linux
@tags docker,linux,arm64
```

## @includes

Declares external configuration files to include (GitLab CI). Ignored for GitHub Actions.

```
includesTag    ::= "@includes" ( "local" | "template" | "remote" | "project" ) "=" STRING
                   [ "file=" STRING ] [ "ref=" STRING ]
```

**Examples:**

```
@includes local="ci/shared-templates.yml"
@includes template="Auto-DevOps.gitlab-ci.yml"
@includes remote="https://example.com/ci.yml"
@includes project="other-group/other-project" file="ci/shared.yml" ref="main"
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
- `cicd` — CI/CD pipeline export with annotation examples and validation rules
- `compilation` — How annotations affect code generation, Inngest target details for @trigger/@cancelOn/@retries/@timeout/@throttle
- `concepts` — Core workflow fundamentals and quick reference
- `error-codes` — Validation errors and warnings for annotation issues
