---
name: Flow Weaver Tutorial
description: Step-by-step guide to building your first Flow Weaver workflow
keywords: [tutorial, first workflow, getting started, scaffold, compile, run, validate, beginner]
---

# Overview

In this tutorial you will build a **data processing workflow** that takes raw records, validates them, enriches them with computed fields, and scores each record. The finished workflow chains three node types together in a linear pipeline:

```
Start -> validator -> enricher -> scorer -> Exit
```

**What you will learn:**

- Scaffolding a workflow from a template
- Writing node type functions with `@flowWeaver nodeType` and `@expression` annotations
- Wiring nodes together with `@flowWeaver workflow`, `@node`, and `@path`
- Validating, compiling, and running the generated code
- Debugging when things go wrong

# Step 1: Scaffold

Use the CLI to generate a starting point:

```bash
fw create workflow sequential my-workflow.ts
```

This creates `my-workflow.ts` with a linear pipeline skeleton. Preview before writing:

```bash
fw create workflow sequential my-workflow.ts --preview
```

Open the generated file. It contains a placeholder workflow function with a single node. You will replace and expand it in the following steps.

# Step 2: Define Node Types

Node types are plain TypeScript functions annotated with `@flowWeaver nodeType` and `@expression`. Each input is declared with `@input` and each output with `@output` in the JSDoc block. Inputs become **direct parameters** (not wrapped in an object). The return value is the output: a single `@output` receives the whole return value, and with several `@output` tags each one receives the property of the same name from the returned object. To signal failure, throw; the error marks the node failed and propagates out of the workflow call (Step 6 shows what that looks like).

Add the following three node type functions to `my-workflow.ts`. Notice the port names: each node calls its input `record`, and the validator and enricher both call their output `record`. Step 3 relies on that.

## 2a. Validator

Checks that the incoming record has the required fields and that values are within acceptable ranges. Returns the validated record, or throws to signal failure.

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Validate Record
 * @input record - Raw record to validate
 * @output record - The validated record
 */
function validateRecord(record: { name: string; age: number; email: string }): {
  name: string;
  age: number;
  email: string;
} {
  if (!record.name || !record.email || record.age < 0 || record.age > 150) {
    throw new Error('Invalid record: missing fields or age out of range');
  }
  return record;
}
```

## 2b. Enricher

Adds computed fields to the validated record: a normalized name and an age bracket.

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Enrich Record
 * @input record - Validated record to enrich
 * @output record - Record with added fields
 */
function enrichRecord(record: { name: string; age: number; email: string }): {
  name: string;
  age: number;
  email: string;
  normalizedName: string;
  ageBracket: string;
} {
  const normalizedName = record.name.trim().toLowerCase();
  const ageBracket = record.age < 18 ? 'minor' : record.age < 65 ? 'adult' : 'senior';
  return { ...record, normalizedName, ageBracket };
}
```

## 2c. Scorer

Assigns a simple numeric score based on the enriched record. Two `@output` tags, so the function returns an object with a `score` and a `summary` property.

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Score Record
 * @input record - Enriched record to score
 * @output score - Computed score
 * @output summary - Human-readable summary
 */
function scoreRecord(record: {
  name: string;
  age: number;
  email: string;
  normalizedName: string;
  ageBracket: string;
}): { score: number; summary: string } {
  let score = 50;
  if (record.email.endsWith('.edu')) score += 20;
  if (record.ageBracket === 'adult') score += 10;
  if (record.normalizedName.length > 3) score += 5;
  const summary = `${record.name}: score ${score} (${record.ageBracket})`;
  return { score, summary };
}
```

## 2d. Alternative: Import External Functions

Instead of writing custom node types, you can import existing functions from npm packages or local modules using `@fwImport`:

```typescript
/**
 * @flowWeaver workflow
 * @fwImport npm/validator/isEmail isEmail from "validator"
 * @node emailCheck npm/validator/isEmail
 * @connect Start.email -> emailCheck.str
 */
```

This is useful when:

- The function already exists and does what you need
- You want to use popular libraries (lodash, date-fns, etc.) directly
- You want a node type from an installed marketplace pack
- You don't want to write wrapper boilerplate

Port types are inferred from TypeScript definitions, including packages that re-export their node types through a barrel `index.d.ts`. See `fw docs jsdoc-grammar` for full syntax.

After adding each function, validate to catch errors early:

```bash
fw validate my-workflow.ts
```

# Step 3: Wire the Workflow

Below the node type functions, add the workflow export. The `@flowWeaver workflow` JSDoc block declares node instances with `@node`, and declares the route with `@path`.

```typescript
/**
 * @flowWeaver workflow
 * @description Validate, enrich, and score a data record
 * @param record - Raw input record
 * @returns score - Computed score
 * @returns summary - Human-readable summary
 * @node validator validateRecord
 * @node enricher enrichRecord
 * @node scorer scoreRecord
 * @path Start -> validator -> enricher -> scorer -> Exit
 */
export function processRecord(
  execute: boolean,
  params: { record: { name: string; age: number; email: string } }
): { onSuccess: boolean; onFailure: boolean; score: number; summary: string } {
  throw new Error('generated body was not installed');
}
```

Key points:

- `@node validator validateRecord` creates an instance named `validator` of node type `validateRecord`.
- `@path Start -> validator -> enricher -> scorer -> Exit` declares the control flow: each step runs when the previous one succeeds, and the last step's success reaches `Exit`. The compiler writes the STEP connections (`execute`, `onSuccess`, `onFailure`) for you.
- `@path` also wires the data ports by name. Every input of a step resolves to the nearest earlier step that has an output of the same name: `validator.record` comes from `Start.record`, `enricher.record` from `validator.record`, `scorer.record` from `enricher.record`, and `Exit.score` / `Exit.summary` from the scorer. That is why the node types in Step 2 share the port name `record`.
- `@connect from.port -> to.port` is still available for ports whose names differ, and an explicit `@connect` always wins over the name resolution. A linear pipeline with consistent names needs none.
- `Start` and `Exit` are reserved pseudo-nodes. `Start` ports come from `@param` tags, `Exit` ports come from `@returns` tags.
- The function body is a placeholder -- the compiler generates the real execution code.

# Step 4: Validate

Run the validator to check for annotation errors, missing connections, and type mismatches:

```bash
fw validate my-workflow.ts
```

If everything is correct you will see a success message. If there are issues, the output describes each problem. Common things to check:

- Every `@input` has a corresponding function parameter
- A single `@output` is the return value; with several `@output` tags, each is a property of the returned object
- Port names match exactly (case-sensitive). `@path` resolves data by name, so a misspelled input simply stays unconnected and is reported as `MISSING_REQUIRED_INPUT`; a misspelled `@returns` port is reported as `UNREACHABLE_EXIT_PORT`
- STEP ports (`execute`, `onSuccess`, `onFailure`) only connect to other STEP ports

For machine-readable output (useful in CI):

```bash
fw validate my-workflow.ts --json
```

# Step 5: Compile

Generate the executable code:

```bash
fw compile my-workflow.ts
```

This compiles the workflow in-place, modifying the source file directly. The compiled file contains:

- A runtime execution context class
- Your node type functions (copied verbatim)
- The `processRecord` export function wired with real execution logic

The generated function has the same signature as your placeholder, so existing imports continue to work.

For production builds (no debug events):

```bash
fw compile my-workflow.ts --production
```

# Step 6: Run

Import the generated function from any TypeScript or JavaScript file and hand it a runtime — the third parameter the compiler added to its signature. The compiled file exports the helper that builds one, so nothing is imported from the package:

```typescript
import { processRecord, createWorkflowRuntime } from './my-workflow';

const runtime = createWorkflowRuntime({ runId: 'demo-1', workflowId: 'processRecord' });
const result = await processRecord(true, {
  record: { name: 'Alice Smith', age: 30, email: 'alice@university.edu' },
}, runtime);

console.log(result);
// {
//   onSuccess: true,
//   onFailure: false,
//   score: 85,
//   summary: "Alice Smith: score 85 (adult)"
// }
```

The first argument (`execute: boolean`) is the `Start.execute` signal — pass `true`. The runtime names the run (`runId` is any string of yours) and carries optional services: mocks, a cancellation signal, a debugger. [Using the library](library.md) lists them.

Test edge cases:

```typescript
// Invalid record -- the validator throws, so the enricher and scorer never run
// and the error propagates out of processRecord
try {
  await processRecord(true, { record: { name: '', age: -5, email: '' } }, runtime);
} catch (err) {
  console.log((err as Error).message); // "Invalid record: missing fields or age out of range"
}
```

An expression node signals failure by throwing. The runtime marks the node's `onFailure` port and lets the error propagate to the caller, so a failed record surfaces as an exception rather than as a result object.

# Step 7: Debug

When the workflow does not behave as expected, use these techniques:

## Verbose validation

```bash
fw validate my-workflow.ts --verbose
```

Shows detailed information about parsed annotations, port types, and connection resolution.

## Inspect generated code

Open the compiled source file and read the execution logic. Each node call is visible in sequence, making it straightforward to trace how data flows between ports.

## Describe the workflow structure

```bash
fw describe my-workflow.ts
fw describe my-workflow.ts --format mermaid
```

Outputs the workflow graph as JSON or as a Mermaid diagram for visual inspection.

## WebSocket runtime debugger

For runtime debugging, compile without the `--production` flag and set the debug environment variable:

```bash
FLOW_WEAVER_DEBUG=ws://localhost:9000 node my-workflow.generated.js
```

Debug events (`STATUS_CHANGED`, `VARIABLE_SET`, `WORKFLOW_COMPLETED`) are sent over WebSocket so you can observe execution in real time.

## Common issues

| Symptom                       | Likely cause                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Output is `null` or `0`       | The `@returns` port has no same-name output on the path and no `@connect`                       |
| Node never executes           | Node is not on any `@path` and has no `@connect` to its `execute` STEP port                     |
| Validation error on port name | Typo in `@input`, `@output`, `@returns`, or `@connect` -- names are case-sensitive              |
| Workflow call throws          | An expression node threw; the error propagates out of the workflow with the node's message      |

# Complete Example

Here is the full `my-workflow.ts` with all pieces together:

```typescript
// =============================================================================
// Node Types
// =============================================================================

/**
 * @flowWeaver nodeType
 * @expression
 * @label Validate Record
 * @input record - Raw record to validate
 * @output record - The validated record
 */
function validateRecord(record: { name: string; age: number; email: string }): {
  name: string;
  age: number;
  email: string;
} {
  if (!record.name || !record.email || record.age < 0 || record.age > 150) {
    throw new Error('Invalid record: missing fields or age out of range');
  }
  return record;
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Enrich Record
 * @input record - Validated record to enrich
 * @output record - Record with added fields
 */
function enrichRecord(record: { name: string; age: number; email: string }): {
  name: string;
  age: number;
  email: string;
  normalizedName: string;
  ageBracket: string;
} {
  const normalizedName = record.name.trim().toLowerCase();
  const ageBracket = record.age < 18 ? 'minor' : record.age < 65 ? 'adult' : 'senior';
  return { ...record, normalizedName, ageBracket };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Score Record
 * @input record - Enriched record to score
 * @output score - Computed score
 * @output summary - Human-readable summary
 */
function scoreRecord(record: {
  name: string;
  age: number;
  email: string;
  normalizedName: string;
  ageBracket: string;
}): { score: number; summary: string } {
  let score = 50;
  if (record.email.endsWith('.edu')) score += 20;
  if (record.ageBracket === 'adult') score += 10;
  if (record.normalizedName.length > 3) score += 5;
  const summary = `${record.name}: score ${score} (${record.ageBracket})`;
  return { score, summary };
}

// =============================================================================
// Workflow
// =============================================================================

/**
 * @flowWeaver workflow
 * @description Validate, enrich, and score a data record
 * @param record - Raw input record
 * @returns score - Computed score
 * @returns summary - Human-readable summary
 * @node validator validateRecord
 * @node enricher enrichRecord
 * @node scorer scoreRecord
 * @path Start -> validator -> enricher -> scorer -> Exit
 */
export function processRecord(
  execute: boolean,
  params: { record: { name: string; age: number; email: string } }
): { onSuccess: boolean; onFailure: boolean; score: number; summary: string } {
  throw new Error('generated body was not installed');
}
```

## Running the complete example

```bash
# Validate
fw validate my-workflow.ts

# Compile
fw compile my-workflow.ts

# Run (from another file or a script)
npx ts-node -e "
  const { processRecord } = require('./my-workflow.generated');
  const result = processRecord(true, {
    record: { name: 'Alice Smith', age: 30, email: 'alice@university.edu' }
  });
  console.log(JSON.stringify(result, null, 2));
"
```

# Alternative: Dev Mode

Instead of running validate, compile, and run separately, use `fw dev` to do all three in a single watch loop:

```bash
fw dev my-workflow.ts --params '{"record": {"name": "Alice", "age": 30, "email": "alice@edu.com"}}'
```

This watches for file changes, recompiles, and re-runs automatically.

# Generate a Diagram

Visualize your workflow as an SVG diagram:

```bash
fw diagram my-workflow.ts -o my-workflow.svg
fw diagram my-workflow.ts --theme light -o my-workflow.svg
```

# Next Steps

Now that you have a working workflow, explore these topics to go further:

- **CLI Reference** (`fw docs cli-reference`) -- Complete reference for all CLI commands and flags
- **Advanced Annotations** (`fw docs advanced-annotations`) -- Pull execution, merge strategies, auto-connect, path/map sugar
- **Compilation** (`fw docs compilation`) -- The TypeScript target, pack targets, production mode, target options
- **Deployment** (`fw docs deployment`) -- Export through target packs, HTTP serve mode, OpenAPI
- **Built-in Nodes** (`fw docs built-in-nodes`) -- delay, waitForEvent, invokeWorkflow, waitForAgent and the mock system for testing
- **Durable Gates** (`fw docs durable-gates`) -- pausing a workflow for approval, input, or an AI agent and resuming it later
- **Marketplace** (`fw docs marketplace`) -- Install and publish reusable node type packages
- **Scoped ports and forEach** (`fw docs export-interface`) -- Iterate over arrays using scoped ports and callback parameters
- **Node conversion** (`fw docs node-conversion`) -- Turn existing functions into expression nodes, and when to fall back to normal mode
- **Scaffolding templates** (`fw docs scaffold`) -- Generate workflows from templates like `sequential`, `foreach`, `conditional`, and more
- **Debugging** (`fw docs debugging`) -- WebSocket debugger, validation diagnostics, and error resolution
- **JSDoc grammar** (`fw docs jsdoc-grammar`) -- Full annotation syntax reference including metadata brackets and scope clauses
