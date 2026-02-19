---
description: Import workflows from n8n or other tools into Flow Weaver
argument-hint: <source-file> [--output <file>] [--format n8n|auto]
---

First, use the Skill tool to invoke skills:

1. flow-weaver:flow-weaver-concepts
2. flow-weaver:flow-weaver-export-interface
3. flow-weaver:flow-weaver-node-conversion

Then import: $ARGUMENTS

## Import Workflow

### 1. Read & Detect Format

Read the source file. Detect the format:

- **n8n single workflow**: Root JSON object has `nodes` array and `connections` object (may also have `meta`, `tags`, `pinData`)
- **n8n multi-workflow export**: Root JSON is an **array** of workflow objects (`[{nodes, connections, ...}, ...]`). List all workflows by name and ask the user which to import, or import all into separate files.
- **Unknown**: Ask the user to confirm the format and describe the structure

If the file is not JSON (e.g., Python, YAML), still attempt to parse and understand it — the conversion rules below are n8n-specific but the general approach (analyze nodes, map to FW node types, wire connections) applies to any format.

**n8n export format versions**: n8n has evolved its export format. Handle both:
- **Legacy (pre-1.0)**: `connections` uses node names as keys, `main` arrays contain objects with `{ node, type, index }`
- **Current (1.0+)**: Same overall structure but nodes may use `id` fields for references instead of names, and connections may use `id`-based keys. Parameters may have a `typeVersion` that changes the schema. Always use the actual parameter structure found in the JSON rather than assuming a fixed schema.

### 2. Analyze Source Workflow

For n8n JSON:

1. **List all nodes** with their `type` (e.g., `n8n-nodes-base.httpRequest`) and `parameters`
2. **Map connections** — n8n uses this format:
   ```json
   "connections": {
     "SourceNodeName": {
       "main": [
         [{ "node": "TargetNode", "type": "main", "index": 0 }],  // output[0] connections
         [{ "node": "OtherNode", "type": "main", "index": 0 }]    // output[1] connections
       ]
     }
   }
   ```
   - `main[0]` = success/true path (maps to `onSuccess`)
   - `main[1]` = failure/false path for IF nodes (maps to `onFailure`)
3. **Identify trigger nodes** (webhook, cron, manual) — these define workflow Start ports
4. **Identify terminal nodes** (respondToWebhook, noOp at end) — these define workflow Exit ports
5. **Categorize each node** using the mapping table below
6. **Present the analysis** to the user before generating code

### 3. n8n Node Mapping Reference

#### Trigger Nodes → Workflow Start Ports

| n8n Node | Strategy |
|---|---|
| `webhook` | Extract path, method. Params become `@param` ports. Do NOT generate a node function for this. |
| `manualTrigger` | Workflow takes no input params (or generic `input` param). |
| `cron` / `scheduleTrigger` | Use `@trigger cron="<expression>"` annotation on the workflow. When targeting Inngest, this emits a cron-triggered function. |
| `emailTrigger`, `kafkaTrigger`, etc. | Note the trigger source in comments. Params become `@param` ports. |

#### Response/Terminal Nodes → Workflow Exit Ports

| n8n Node | Strategy |
|---|---|
| `respondToWebhook` | Data sent to this node becomes `@returns` ports on Exit. |
| `noOp` (at graph end) | Pass-through — wire predecessor directly to Exit. |

#### Logic Nodes → Normal Mode Node Types

| n8n Node | Strategy |
|---|---|
| `if` | **Normal mode**. Convert conditions to TypeScript boolean logic. `onSuccess` = true branch, `onFailure` = false branch. Use `@path` with `:ok`/`:fail` suffixes in workflow annotation. |
| `switch` | **Normal mode**. Multiple output ports — one per case + default. Each case is a named output port. |
| `merge` | **Normal mode** with `executeWhen: CONJUNCTION`. Combines multiple inputs. Specify merge mode (append/combine/chooseBranch) in implementation. |
| `splitInBatches` | Convert to forEach pattern with scoped ports (`scope:scopeName`). See `flow-weaver:flow-weaver-export-interface`. |

#### HTTP/API Nodes → Async Expression Nodes

| n8n Node | Strategy |
|---|---|
| `httpRequest` | **Async expression mode**. Generate `fetch()` call using URL, method, headers, body from params. Convert `{{ }}` expressions to template literals. Use `process.env.XXX` for auth tokens. |

#### Code Nodes → Expression or Normal Mode

| n8n Node | Strategy |
|---|---|
| `code` / `function` / `functionItem` | Read the `jsCode` or `functionCode` parameter. If it's a pure transformation (maps items), use **expression mode**. If it has side effects or error handling, use **normal mode**. Convert JavaScript to TypeScript (add types). |

#### Data Transformation Nodes → Expression Nodes

| n8n Node | Strategy |
|---|---|
| `set` | **Expression mode**. Generate a function that constructs the specified fields. |
| `renameKeys` | **Expression mode**. Generate object spread + rename. |
| `itemLists` / `removeDuplicates` | **Expression mode**. Generate array filter/map/reduce. |
| `dateTime` | **Expression mode**. Generate Date manipulation. |
| `crypto` | **Expression mode**. Generate `crypto` module calls. |
| `xml` / `html` | **Expression mode**. Parse/generate XML/HTML (suggest npm package in comments). |
| `spreadsheetFile` / `readBinaryFile` | **Async expression mode**. File I/O with appropriate npm package. |

#### SaaS Integration Nodes → Async Nodes with API Calls

| n8n Node | Strategy | npm Package Suggestion |
|---|---|---|
| `slack` | Generate `fetch()` to Slack Web API. Extract channel, text, etc. from params. | `@slack/web-api` |
| `gmail` / `googleSheets` / `googleDrive` | Generate Google API calls using googleapis. | `googleapis` |
| `sendGrid` / `mailgun` | Generate email API call. | `@sendgrid/mail` / `mailgun.js` |
| `stripe` | Generate Stripe API call. | `stripe` |
| `airtable` | Generate Airtable API call. | `airtable` |
| `notion` | Generate Notion API call. | `@notionhq/client` |
| `discord` | Generate Discord webhook/API call. | `discord.js` |
| `telegram` | Generate Telegram Bot API call. | `node-telegram-bot-api` |
| `postgres` / `mysql` / `mongodb` | Generate DB query. | `pg` / `mysql2` / `mongodb` |
| `redis` | Generate Redis command. | `redis` |
| `s3` / `awsS3` | Generate S3 operation. | `@aws-sdk/client-s3` |
| Other SaaS nodes | Generate `fetch()` to the service's REST API. Add TODO comment with API docs link. | — |

#### Flow Control Nodes

| n8n Node | Strategy |
|---|---|
| `noOp` | **Omit entirely**. Wire predecessor outputs directly to successor inputs. |
| `wait` | Use the built-in `delay` node from `@synergenius/flow-weaver/built-in-nodes`. Input: `duration` (e.g. "30s", "5m"). When targeting Inngest, this emits `step.sleep()`. |
| `executeWorkflow` | Use the built-in `invokeWorkflow` node from `@synergenius/flow-weaver/built-in-nodes`. Inputs: `functionId`, `payload`. When targeting Inngest, this emits `step.invoke()`. |
| `errorTrigger` | Map to `onFailure` port connection from the source node. |
| `stopAndError` | Generate a node that returns `onFailure: true` with error message. |

### 4. n8n Expression Conversion

When converting n8n parameter values containing `{{ }}` expressions:

| n8n Expression | TypeScript Equivalent |
|---|---|
| `{{ $json.fieldName }}` | Function parameter: `fieldName` (becomes an input port) |
| `{{ $json["field name"] }}` | `data["field name"]` |
| `{{ $json.nested.deep.field }}` | `data.nested.deep.field` |
| `{{ $json.items[0].name }}` | `items[0].name` |
| `{{ $node["NodeName"].json.field }}` | Becomes a `@connect` from that node's output port |
| `{{ $env.VARIABLE_NAME }}` | `process.env.VARIABLE_NAME` |
| `{{ DateTime.now().toISO() }}` | `new Date().toISOString()` |
| `{{ $json.amount * 1.1 }}` | Inline calculation in function body |
| `={{ expression }}` | Same as `{{ expression }}` (the `=` prefix is optional in n8n) |
| `{{ $input.first().json.x }}` | The input parameter `x` (from upstream connection) |

**Key insight**: n8n expressions that reference `$node["OtherNode"]` indicate data flowing between nodes. These become `@connect` annotations, not inline code.

### 5. Generate Output File

Generate a single TypeScript file with this structure:

```typescript
// Imports (if npm packages needed)
import { ... } from '...';

// --- Node Type Functions ---

// One function per unique n8n node type (excluding triggers and noOp)
// Use expression mode for pure transformations
// Use normal mode for branching/error-handling nodes

/** @flowWeaver nodeType @expression */
function transformData(input: InputType): { result: OutputType } {
  // converted logic
}

// --- Workflow ---

/**
 * @flowWeaver workflow
 * @node transform transformData
 * @node fetch fetchCustomer
 * @connect Start.input -> transform.input
 * @connect transform.result -> fetch.customerId
 * @connect fetch.customer -> Exit.customer
 * @position Start -450 0
 * @position transform -270 0
 * @position fetch -90 0
 * @position Exit 90 0
 * @param input - Description from n8n webhook params
 * @returns customer - Description
 */
export async function workflowName(
  execute: boolean,
  params: { input: InputType }
): Promise<{ onSuccess: boolean; onFailure: boolean; customer: OutputType }> {
  throw new Error('Compile with: flow-weaver compile <file>');
}
```

**Generation rules:**

1. **Naming**: Convert n8n node names to camelCase function names (e.g., "Fetch Customer" → `fetchCustomer`)
2. **Node instance IDs**: Use camelCase lowercase (e.g., `fetcher`, `validator`, `transformer`)
3. **Positions**: Space nodes 180px apart horizontally. Start at x=-450, increment by 180. y=0 for linear, offset y for branches.
4. **Expression mode preference**: Default to `@expression` unless the node needs `onSuccess`/`onFailure` branching
5. **Type safety**: Infer types from n8n parameter values where possible. Use `any` as fallback with TODO comment.
6. **Environment variables**: Replace n8n credential references with `process.env.XXX`. List all required env vars in comments at top of file.
7. **Sugar annotations**: Use `@path` for all routing -- linear chains, branching (`:ok`/`:fail` suffixes), and multi-step routes (e.g., `@path Start -> validator -> processor -> Exit`). Use `@connect` as an escape hatch for connections `@path` cannot cover.
8. **CRITICAL — Flat output ports only**: `@connect` supports `node.port` format ONLY. Nested property access like `node.port.subfield` is NOT valid and will fail parsing. If a node returns an object (e.g., `{ customer: { name, email } }`), you MUST flatten the outputs into separate ports (e.g., `@output customerName`, `@output customerEmail`) and return them as top-level properties. Never use dot notation beyond `node.port` in `@connect` lines.

### 6. Validate & Iterate

After writing the file:

1. Use `fw_validate` MCP tool to validate the generated workflow
2. If there are **errors**: fix them and re-validate (common issues: port name mismatches, missing connections, type conflicts)
3. If there are **warnings**: report to user but don't necessarily fix (common: unused ports, type coercion)
4. If validation passes, optionally use `fw_describe` to show the workflow structure

### 7. Report Results

Present to the user:

1. **Generated file path**
2. **Conversion summary**:
   - Total n8n nodes → FW node types generated
   - Nodes mapped fully vs. nodes with TODOs
   - Connections wired
3. **npm packages to install** (if any SaaS integrations):
   ```
   npm install @slack/web-api googleapis
   ```
4. **Environment variables needed**:
   ```
   SLACK_TOKEN=...
   API_KEY=...
   ```
5. **Items requiring manual review** (if any):
   - SaaS nodes with generated stubs
   - Complex expressions that couldn't be fully converted
   - Sub-workflow references
6. **Next steps**:
   - Review generated code, especially TODOs
   - `npx flow-weaver compile <file>`
   - `/fw-test <workflowName>`
   - `/fw-validate <file>` for ongoing checks

## Handling Edge Cases

- **Multi-workflow exports**: If the JSON root is an array (`[{...}, {...}]`), list all workflow names and ask the user which to import. For "import all", generate one `.ts` file per workflow using the workflow name as filename.
- **Multiple triggers**: n8n allows multiple triggers per workflow. In FW, merge their params into a single Start ports set and add a comment.
- **Disabled nodes**: Skip disabled n8n nodes (`"disabled": true`) and note them in the report.
- **Pin data**: Ignore pin data (test fixtures). Suggest using vitest for testing instead.
- **Sticky notes**: Extract text from sticky notes and add as code comments near relevant nodes.
- **Node versioning**: n8n nodes have versions (v1, v2, v3). Use the parameter structure as-is — the version affects n8n's UI layout, not the underlying operation semantics.
- **ID-based connections (n8n 1.0+)**: Some exports reference nodes by `id` instead of `name` in connections. Resolve IDs to node names by cross-referencing the `nodes` array.
- **Error handling workflows**: If the n8n workflow has an error trigger connected to other nodes, map these to `onFailure` port connections.
- **Empty workflows**: If the workflow has no non-trigger nodes, generate a minimal pass-through workflow.

## Example Usage

```
/fw-import ./exports/n8n-order-processing.json
/fw-import ./exports/n8n-order-processing.json --output src/order-processing.ts
/fw-import ./backups/slack-notifier.json --format n8n
```
