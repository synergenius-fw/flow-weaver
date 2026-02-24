/**
 * Extractor for JSDoc annotation documentation
 *
 * This defines all Flow Weaver JSDoc annotations with their syntax and descriptions.
 * The annotation names correspond to tokens defined in chevrotain-parser/tokens.ts.
 */

import type { TAnnotationDoc, TAnnotationModifierDoc } from '../types.js';

/**
 * Core Flow Weaver annotations - the primary JSDoc tags
 */
export const CORE_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@flowWeaver',
    category: 'marker',
    syntax: '@flowWeaver nodeType | workflow | pattern',
    description:
      'Required marker to identify function purpose. Must be first Flow Weaver annotation.',
    insertText: '@flowWeaver ',
    insertTextFormat: 'plain',
    ebnf: 'flowWeaverTag  ::= "@flowWeaver" ( "nodeType" | "workflow" | "pattern" )',
    contexts: ['nodeType', 'workflow', 'pattern'],
  },
  {
    name: '@flowWeaver nodeType',
    category: 'marker',
    syntax: '@flowWeaver nodeType',
    description: 'Marks function as a reusable node type that can be instantiated in workflows.',
    insertText: '@flowWeaver nodeType',
    insertTextFormat: 'plain',
    contexts: ['nodeType'],
  },
  {
    name: '@flowWeaver workflow',
    category: 'marker',
    syntax: '@flowWeaver workflow',
    description: 'Marks function as a DAG workflow orchestration.',
    insertText: '@flowWeaver workflow',
    insertTextFormat: 'plain',
    contexts: ['workflow'],
  },
  {
    name: '@flowWeaver pattern',
    category: 'marker',
    syntax: '@flowWeaver pattern',
    description: 'Marks function as a reusable subgraph pattern.',
    insertText: '@flowWeaver pattern',
    insertTextFormat: 'plain',
    contexts: ['pattern'],
  },
];

/**
 * Port-related annotations
 */
export const PORT_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@input',
    category: 'port',
    syntax: '@input name [modifiers] - description',
    description:
      'Declares an input port for data or control flow. Name required, modifiers in brackets optional (e.g. [type:NUMBER]).',
    insertText: '@input ${1:name}',
    insertTextFormat: 'snippet',
    ebnf: `inputTag       ::= "@input" ( bracketedInput | plainInput )
                   [ scopeClause ] { metadataBracket } [ descriptionClause ]

plainInput     ::= IDENTIFIER
bracketedInput ::= "[" IDENTIFIER [ "=" defaultValue ] "]"

defaultValue   ::= IDENTIFIER | INTEGER | STRING`,
    examples: [
      '@input name                       plain required input',
      '@input [name]                     optional input (no connection required)',
      '@input [name=defaultValue]        optional with default (identifier)',
      '@input [name=42]                  optional with default (integer)',
      '@input [name="hello"]             optional with default (string)',
      '@input name scope:myScope         scoped input',
      '@input name [order:2]             with ordering metadata',
      '@input name - Description text    with description',
    ],
    contexts: ['nodeType'],
  },
  {
    name: '@output',
    category: 'port',
    syntax: '@output name [modifiers] - description',
    description:
      'Declares an output port for data or control flow. Name required, modifiers in brackets optional (e.g. [type:NUMBER]).',
    insertText: '@output ${1:name}',
    insertTextFormat: 'snippet',
    ebnf: `outputTag      ::= "@output" IDENTIFIER
                   [ scopeClause ] { metadataBracket } [ descriptionClause ]`,
    examples: [
      '@output result',
      '@output result scope:myScope',
      '@output result [order:1, placement:TOP]',
      '@output result - The computed result',
    ],
    contexts: ['nodeType'],
  },
  {
    name: '@step',
    category: 'port',
    syntax: '@step name - description',
    description:
      'Declares a STEP port for control flow. Shorthand for @input name [type:STEP] or @output name [type:STEP].',
    insertText: '@step ${1:name}',
    insertTextFormat: 'snippet',
    ebnf: 'stepTag        ::= "@step" IDENTIFIER [ descriptionClause ]',
    examples: ['@step process', '@step process - Runs the processing pipeline'],
    contexts: ['nodeType'],
  },
];

/**
 * Workflow structure annotations
 */
export const WORKFLOW_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@node',
    category: 'workflow',
    syntax: '@node instanceId NodeTypeName [parent.scope] [modifiers]',
    description:
      'Declares a node instance in the workflow. Can optionally specify parent scope and modifiers.',
    insertText: '@node ${1:id} ${2:NodeType}',
    insertTextFormat: 'snippet',
    ebnf: `nodeTag        ::= "@node" IDENTIFIER IDENTIFIER [ parentScopeRef ] { attributeBracket }

parentScopeRef ::= IDENTIFIER "." IDENTIFIER

attributeBracket ::= "[" nodeAttr { "," nodeAttr } "]"

nodeAttr       ::= labelAttr | exprAttr | portOrderAttr | portLabelAttr
                 | minimizedAttr | pullExecutionAttr | sizeAttr
                 | colorAttr | iconAttr | tagsAttr

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
tagEntry       ::= STRING [ STRING ]`,
    examples: [
      '@node myAdd Add',
      '@node myAdd Add [label: "My Adder"]',
      '@node myAdd Add parent.loopScope',
      '@node myAdd Add [expr: a="x + 1", b="y * 2"]',
      '@node myAdd Add [portOrder: a=1, b=2]',
      '@node myAdd Add [minimized, label: "Compact"]',
      '@node myAdd Add [pullExecution: trigger]',
      '@node myAdd Add [size: 200 150]',
      '@node myAdd Add [color: "#ff0000", icon: "math-plus"]',
      '@node myAdd Add [tags: "math" "Math operation", "transform"]',
      '@node myAdd Add [label: "hi"] [color: "#f00"]',
    ],
    contexts: ['workflow', 'pattern'],
  },
  {
    name: '@connect',
    category: 'workflow',
    syntax: '@connect sourceNode.outPort -> targetNode.inPort',
    description: 'Connects an output port to an input port. Use arrow syntax for directionality.',
    insertText: '@connect ${1:from}.${2:port} -> ${3:to}.${4:port}',
    insertTextFormat: 'snippet',
    ebnf: `connectTag     ::= "@connect" portRef "->" portRef

portRef        ::= IDENTIFIER "." IDENTIFIER [ ":" IDENTIFIER ]`,
    examples: [
      '@connect myAdd.result -> myLog.message',
      '@connect loop.item -> process.input:loopScope',
    ],
    contexts: ['workflow', 'pattern'],
  },
  {
    name: '@position',
    category: 'workflow',
    syntax: '@position nodeId x y',
    description: 'Sets the visual position of a node in the editor canvas.',
    insertText: '@position ${1:nodeId} ${2:x} ${3:y}',
    insertTextFormat: 'snippet',
    ebnf: 'positionTag    ::= "@position" IDENTIFIER INTEGER INTEGER',
    examples: ['@position myAdd 100 200'],
    contexts: ['workflow', 'pattern'],
  },
  {
    name: '@fwImport',
    category: 'workflow',
    syntax: '@fwImport nodeName functionName from "packageName"',
    description:
      'Imports an npm package function as a node type. Creates expression node with inferred types.',
    insertText: '@fwImport ${1:nodeName} ${2:functionName} from "${3:package}"',
    insertTextFormat: 'snippet',
    ebnf: `fwImportTag    ::= "@fwImport" IDENTIFIER IDENTIFIER "from" QUOTED_STRING

QUOTED_STRING  ::= STRING | "'" { any character except "'" } "'"`,
    examples: [
      '@fwImport npm/lodash/map map from "lodash"',
      '@fwImport npm/date-fns/format format from "date-fns"',
      "@fwImport local/utils/helper helper from './utils'",
    ],
    contexts: ['workflow'],
  },
  {
    name: '@path',
    category: 'workflow',
    syntax: '@path Start -> nodeA -> nodeB:fail -> Exit',
    description:
      'Declare a complete execution route with scope walking. Steps separated by ->. Suffix :ok (default) or :fail to select onSuccess/onFailure. Data ports auto-resolve by walking backward to the nearest ancestor with a same-name output.',
    insertText: '@path Start -> ${1:node1} -> ${2:node2} -> Exit',
    insertTextFormat: 'snippet',
    ebnf: `pathTag        ::= "@path" pathStep ( "->" pathStep )+
pathStep       ::= IDENTIFIER [ ":" ( "ok" | "fail" ) ]`,
    examples: [
      '@path Start -> validator -> classifier -> urgencyRouter:fail -> escalate -> Exit',
      '@path Start -> validator:ok -> processor -> Exit',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@scope',
    category: 'workflow',
    syntax: '@scope scopeRef [nodes...]',
    description:
      'Assigns nodes to a scope in a workflow. The scope ref can be a simple name or parent.child.',
    insertText: '@scope ${1:scopeRef} [${2:nodes}]',
    insertTextFormat: 'snippet',
    ebnf: `scopeTag       ::= "@scope" scopeRef "[" IDENTIFIER { "," IDENTIFIER } "]"

scopeRef       ::= IDENTIFIER | IDENTIFIER "." IDENTIFIER`,
    examples: [
      '@scope loopScope [process, validate]',
      '@scope container.inner [step1, step2]',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@map',
    category: 'workflow',
    syntax: '@map instanceId ChildType [portMapping] over source.port',
    description:
      'Declares a map (iteration) node that processes items from a source array port using a child node type. The optional port mapping overrides the default input/output port wiring.',
    insertText: '@map ${1:id} ${2:ChildType} over ${3:source}.${4:port}',
    insertTextFormat: 'snippet',
    ebnf: `mapTag         ::= "@map" IDENTIFIER IDENTIFIER [ "(" IDENTIFIER "->" IDENTIFIER ")" ]
                   "over" IDENTIFIER "." IDENTIFIER`,
    examples: [
      '@map loop process over scan.files',
      '@map loop process(inputPort -> outputPort) over scan.files',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@fanOut',
    category: 'workflow',
    syntax: '@fanOut source.port -> target1, target2, target3',
    description:
      'Broadcasts a single output port to multiple target nodes/ports. Expands to individual @connect lines during compilation.',
    insertText: '@fanOut ${1:source}.${2:port} -> ${3:target1}, ${4:target2}',
    insertTextFormat: 'snippet',
    ebnf: `fanOutTag      ::= "@fanOut" portRef "->" portRef { "," portRef }

portRef        ::= IDENTIFIER [ "." IDENTIFIER ]`,
    examples: [
      '@fanOut Start.data -> a, b, c',
      '@fanOut Start.data -> a.input1, b.input2',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@fanIn',
    category: 'workflow',
    syntax: '@fanIn source1.port, source2.port -> target.port',
    description:
      'Merges multiple output ports into a single target input. Expands to individual @connect lines during compilation.',
    insertText: '@fanIn ${1:source1}, ${2:source2} -> ${3:target}.${4:port}',
    insertTextFormat: 'snippet',
    ebnf: `fanInTag       ::= "@fanIn" portRef { "," portRef } "->" portRef

portRef        ::= IDENTIFIER [ "." IDENTIFIER ]`,
    examples: [
      '@fanIn a.result, b.result, c.result -> merge.inputs',
      '@fanIn a, b, c -> merge.data',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@coerce',
    category: 'workflow',
    syntax: '@coerce instanceId source.port -> target.port as TargetType',
    description:
      'Inserts an explicit type coercion node between two ports. Expands to a synthetic expression node that performs the conversion inline (e.g. String(), Number()). Works with @strictTypes since both connections are type-safe through the ANY input.',
    insertText: '@coerce ${1:id} ${2:source}.${3:port} -> ${4:target}.${5:port} as ${6|string,number,boolean,json,object|}',
    insertTextFormat: 'snippet',
    ebnf: `coerceTag      ::= "@coerce" IDENTIFIER portRef "->" portRef "as" targetType

targetType     ::= "string" | "number" | "boolean" | "json" | "object"`,
    examples: [
      '@coerce c1 fetch.count -> calc.amount as number',
      '@coerce toStr llm.response -> logger.message as string',
      '@coerce parse api.body -> transform.data as object',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@autoConnect',
    category: 'workflow',
    syntax: '@autoConnect',
    description:
      'Enables automatic linear connection wiring for the workflow. When present, the compiler automatically wires nodes in declaration order (connecting compatible ports from previous nodes). No value is needed — presence enables the feature.',
    insertText: '@autoConnect',
    insertTextFormat: 'plain',
    ebnf: 'autoConnectTag ::= "@autoConnect"',
    examples: ['@autoConnect'],
    contexts: ['workflow'],
  },
  {
    name: '@trigger',
    category: 'workflow',
    syntax: '@trigger event="name" | cron="expr"',
    description:
      'Declares an event or cron trigger for Inngest deployment. Can specify event, cron, or both.',
    insertText: '@trigger event="${1:event/name}"',
    insertTextFormat: 'snippet',
    ebnf: 'triggerTag     ::= "@trigger" ( "event=" STRING | "cron=" STRING )*',
    examples: [
      '@trigger event="agent/request"',
      '@trigger cron="0 9 * * *"',
      '@trigger event="agent/request" cron="0 9 * * *"',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@cancelOn',
    category: 'workflow',
    syntax: '@cancelOn event="name" [match="field"] [timeout="duration"]',
    description:
      'Cancels a running Inngest function when a specified event is received.',
    insertText: '@cancelOn event="${1:event/name}"',
    insertTextFormat: 'snippet',
    ebnf: 'cancelOnTag    ::= "@cancelOn" "event=" STRING [ "match=" STRING ] [ "timeout=" STRING ]',
    examples: [
      '@cancelOn event="app/user.deleted"',
      '@cancelOn event="app/user.deleted" match="data.userId"',
      '@cancelOn event="x" match="data.id" timeout="1h"',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@retries',
    category: 'workflow',
    syntax: '@retries N',
    description:
      'Sets the retry count for an Inngest function (overrides default of 3).',
    insertText: '@retries ${1:3}',
    insertTextFormat: 'snippet',
    ebnf: 'retriesTag     ::= "@retries" INTEGER',
    examples: ['@retries 5', '@retries 0'],
    contexts: ['workflow'],
  },
  {
    name: '@timeout',
    category: 'workflow',
    syntax: '@timeout "duration"',
    description: 'Sets the maximum execution time for an Inngest function.',
    insertText: '@timeout "${1:30m}"',
    insertTextFormat: 'snippet',
    ebnf: 'timeoutTag     ::= "@timeout" STRING',
    examples: ['@timeout "30m"', '@timeout "2h"'],
    contexts: ['workflow'],
  },
  {
    name: '@throttle',
    category: 'workflow',
    syntax: '@throttle limit=N [period="duration"]',
    description: 'Limits concurrent executions of an Inngest function.',
    insertText: '@throttle limit=${1:10}',
    insertTextFormat: 'snippet',
    ebnf: 'throttleTag    ::= "@throttle" "limit=" INTEGER [ "period=" STRING ]',
    examples: ['@throttle limit=3 period="1m"', '@throttle limit=10'],
    contexts: ['workflow'],
  },
];

/**
 * Node type metadata annotations
 */
export const METADATA_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@name',
    category: 'metadata',
    syntax: '@name identifier',
    description:
      'Sets the node type identifier. Used to reference this type in @node declarations.',
    insertText: '@name ${1:identifier}',
    insertTextFormat: 'snippet',
    contexts: ['nodeType', 'workflow', 'pattern'],
  },
  {
    name: '@label',
    category: 'metadata',
    syntax: '@label "Display Name"',
    description: 'Sets a human-readable display label for the node or workflow in the UI.',
    insertText: '@label "${1:Label}"',
    insertTextFormat: 'snippet',
    contexts: ['nodeType', 'workflow', 'pattern'],
  },
  {
    name: '@description',
    category: 'metadata',
    syntax: '@description Text description',
    description: 'Sets a description that appears as hover tooltip in the UI.',
    insertText: '@description ${1:description}',
    insertTextFormat: 'snippet',
    contexts: ['nodeType', 'workflow', 'pattern'],
  },
  {
    name: '@scope',
    category: 'metadata',
    syntax: '@scope scopeName',
    description:
      'Declares a scope on a node type for nested nodes. Used for iteration patterns (forEach, map, etc.).',
    insertText: '@scope ${1:scopeName}',
    insertTextFormat: 'snippet',
    contexts: ['nodeType'],
  },
  {
    name: '@executeWhen',
    category: 'metadata',
    syntax: '@executeWhen CONJUNCTION | DISJUNCTION | CUSTOM',
    description:
      'Controls when a node with multiple step inputs executes. CONJUNCTION waits for all, DISJUNCTION fires on first.',
    insertText: '@executeWhen ${1|CONJUNCTION,DISJUNCTION,CUSTOM|}',
    insertTextFormat: 'snippet',
    contexts: ['nodeType'],
  },
  {
    name: '@pullExecution',
    category: 'metadata',
    syntax: '@pullExecution triggerPort',
    description: 'Enables lazy execution - node runs only when trigger port is pulled.',
    insertText: '@pullExecution ${1:triggerPort}',
    insertTextFormat: 'snippet',
    contexts: ['nodeType'],
  },
  {
    name: '@expression',
    category: 'metadata',
    syntax: '@expression',
    description:
      'Marks node as pure expression node. No control flow ports (execute/onSuccess/onFailure).',
    insertText: '@expression',
    insertTextFormat: 'plain',
    contexts: ['nodeType'],
  },
  {
    name: '@strictTypes',
    category: 'metadata',
    syntax: '@strictTypes',
    description: 'Promotes type coercion warnings to errors in this workflow.',
    insertText: '@strictTypes',
    insertTextFormat: 'plain',
    ebnf: 'strictTypesTag ::= "@strictTypes" [ "false" ]',
    examples: [
      '@strictTypes              enables strict mode',
      '@strictTypes false        explicitly disables',
    ],
    contexts: ['workflow'],
  },
  {
    name: '@color',
    category: 'metadata',
    syntax: '@color value',
    description: 'Sets a UI color hint for the node type.',
    insertText: '@color ${1:value}',
    insertTextFormat: 'snippet',
    contexts: ['nodeType'],
  },
  {
    name: '@tag',
    category: 'metadata',
    syntax: '@tag identifier ["description"]',
    description:
      'Adds a tag to the node type for categorization. Optional string description.',
    insertText: '@tag ${1:tagName}',
    insertTextFormat: 'snippet',
    contexts: ['nodeType'],
  },
  {
    name: '@icon',
    category: 'metadata',
    syntax: '@icon text',
    description: 'Sets an icon identifier for the node type in the UI.',
    insertText: '@icon ${1:iconName}',
    insertTextFormat: 'snippet',
    contexts: ['nodeType'],
  },
];

/**
 * Standard JSDoc annotations (for completeness in IDE)
 */
export const STANDARD_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@param',
    category: 'standard',
    syntax: '@param {type} name - description',
    description:
      'Standard JSDoc parameter documentation. In workflows, defines Start port (workflow input).',
    insertText: '@param {${1:type}} ${2:name} - ${3:description}',
    insertTextFormat: 'snippet',
    ebnf: 'paramTag       ::= IDENTIFIER [ scopeClause ] { metadataBracket } [ descriptionClause ]',
    contexts: ['workflow'],
  },
  {
    name: '@returns',
    category: 'standard',
    syntax: '@returns {type} description',
    description:
      'Standard JSDoc return documentation. In workflows, defines Exit port (workflow output).',
    insertText: '@returns {${1:type}} ${2:description}',
    insertTextFormat: 'snippet',
    ebnf: 'returnsTag     ::= IDENTIFIER [ scopeClause ] { metadataBracket } [ descriptionClause ]',
    contexts: ['workflow'],
  },
];

/**
 * Pattern-specific annotations
 */
export const PATTERN_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@port IN',
    category: 'pattern',
    syntax: '@port IN.name - description',
    description: 'Defines a pattern input port. Use IN instead of Start in patterns.',
    insertText: '@port IN.${1:name}',
    insertTextFormat: 'snippet',
    ebnf: 'portTag        ::= "@port" ( "IN" | "OUT" ) "." IDENTIFIER [ "-" TEXT ]',
    examples: [
      '@port IN.data - Input data to process',
      '@port IN.config - Configuration object',
    ],
    contexts: ['pattern'],
  },
  {
    name: '@port OUT',
    category: 'pattern',
    syntax: '@port OUT.name - description',
    description: 'Defines a pattern output port. Use OUT instead of Exit in patterns.',
    insertText: '@port OUT.${1:name}',
    insertTextFormat: 'snippet',
    examples: [
      '@port OUT.result - Processed result',
      '@port OUT.error - Error output',
    ],
    contexts: ['pattern'],
  },
];

/**
 * Port modifiers - attributes in square brackets after port name
 */
export const PORT_MODIFIERS: TAnnotationModifierDoc[] = [
  {
    name: 'order',
    syntax: '[order:N]',
    description: 'Sets display order for the port. Lower numbers appear higher.',
  },
  {
    name: 'placement',
    syntax: '[placement:TOP|BOTTOM]',
    description: 'Controls port position on the node.',
    enum: ['TOP', 'BOTTOM'],
  },
  {
    name: 'type',
    syntax: '[type:TYPE]',
    description: 'Overrides inferred port data type.',
  },
  {
    name: 'hidden',
    syntax: '[hidden]',
    description: 'Hides port from UI display.',
  },
  {
    name: 'optional',
    syntax: '[optional]',
    description: 'Marks input port as optional (alternative to square brackets around name).',
  },
];

/**
 * Node instance modifiers - attributes in @node declarations
 */
export const NODE_MODIFIERS: TAnnotationModifierDoc[] = [
  {
    name: 'label',
    syntax: '[label:"Display Name"]',
    description: 'Override the display label for this instance.',
  },
  {
    name: 'expr',
    syntax: '[expr:port="value"]',
    description: 'Set an expression value for a port.',
  },
  {
    name: 'minimized',
    syntax: '[minimized]',
    description: 'Collapse the node in the UI.',
  },
  {
    name: 'pullExecution',
    syntax: '[pullExecution:port]',
    description: 'Enable lazy execution for this instance.',
  },
  {
    name: 'portOrder',
    syntax: '[portOrder:port=N]',
    description: 'Override display order for a specific port.',
  },
  {
    name: 'portLabel',
    syntax: '[portLabel:port="Label"]',
    description: 'Override display label for a specific port.',
  },
  {
    name: 'size',
    syntax: '[size:width,height]',
    description: 'Set custom node dimensions.',
  },
];

/**
 * All annotations combined
 */
export const ALL_ANNOTATIONS: TAnnotationDoc[] = [
  ...CORE_ANNOTATIONS,
  ...PORT_ANNOTATIONS,
  ...WORKFLOW_ANNOTATIONS,
  ...METADATA_ANNOTATIONS,
  ...PATTERN_ANNOTATIONS,
  ...STANDARD_ANNOTATIONS,
];

/**
 * Extract all annotation documentation
 */
export function extractAnnotations(): TAnnotationDoc[] {
  return ALL_ANNOTATIONS;
}

/**
 * Extract port modifier documentation
 */
export function extractPortModifiers(): TAnnotationModifierDoc[] {
  return PORT_MODIFIERS;
}

/**
 * Extract node modifier documentation
 */
export function extractNodeModifiers(): TAnnotationModifierDoc[] {
  return NODE_MODIFIERS;
}
