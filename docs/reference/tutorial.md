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
- Writing node type functions with `@flowWeaver nodeType` annotations
- Wiring nodes together with `@flowWeaver workflow`, `@node`, and `@connect`
- Validating, compiling, and running the generated code
- Debugging when things go wrong

# Step 1: Scaffold

Use the CLI to generate a starting point:

```bash
flow-weaver create workflow sequential my-workflow.ts
```

This creates `my-workflow.ts` with a linear pipeline skeleton. Preview before writing:

```bash
flow-weaver create workflow sequential my-workflow.ts --preview
```

Open the generated file. It contains a placeholder workflow function with a single node. You will replace and expand it in the following steps.

# Step 2: Define Node Types

Node types are plain TypeScript functions annotated with `@flowWeaver nodeType`. Each input is declared with `@input` and each output with `@output` in the JSDoc block. Inputs become **direct parameters** (not wrapped in an object).

Add the following three node type functions to `my-workflow.ts`:

## 2a. Validator

Checks that the incoming record has the required fields and that values are within acceptable ranges. Returns the validated record on success, or signals failure.

```typescript
/**
 * @flowWeaver nodeType
 * @label Validate Record
 * @input record - Raw record to validate
 * @output validated - The validated record
 */
function validateRecord(
  execute: boolean,
  record: { name: string; age: number; email: string }
): {
  onSuccess: boolean;
  onFailure: boolean;
  validated: { name: string; age: number; email: string } | null;
} {
  if (!execute) return { onSuccess: false, onFailure: false, validated: null };
  try {
    if (!record.name || !record.email || record.age < 0 || record.age > 150) {
      return { onSuccess: false, onFailure: true, validated: null };
    }
    return { onSuccess: true, onFailure: false, validated: record };
  } catch {
    return { onSuccess: false, onFailure: true, validated: null };
  }
}
```

## 2b. Enricher

Adds computed fields to the validated record: a normalized name and an age bracket.

```typescript
/**
 * @flowWeaver nodeType
 * @label Enrich Record
 * @input record - Validated record to enrich
 * @output enriched - Record with added fields
 */
function enrichRecord(
  execute: boolean,
  record: { name: string; age: number; email: string }
): {
  onSuccess: boolean;
  onFailure: boolean;
  enriched: {
    name: string;
    age: number;
    email: string;
    normalizedName: string;
    ageBracket: string;
  } | null;
} {
  if (!execute) return { onSuccess: false, onFailure: false, enriched: null };
  const normalizedName = record.name.trim().toLowerCase();
  const ageBracket = record.age < 18 ? 'minor' : record.age < 65 ? 'adult' : 'senior';
  return {
    onSuccess: true,
    onFailure: false,
    enriched: { ...record, normalizedName, ageBracket },
  };
}
```

## 2c. Scorer

Assigns a simple numeric score based on the enriched record.

```typescript
/**
 * @flowWeaver nodeType
 * @label Score Record
 * @input record - Enriched record to score
 * @output score - Computed score
 * @output summary - Human-readable summary
 */
function scoreRecord(
  execute: boolean,
  record: {
    name: string;
    age: number;
    email: string;
    normalizedName: string;
    ageBracket: string;
  }
): {
  onSuccess: boolean;
  onFailure: boolean;
  score: number;
  summary: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, score: 0, summary: '' };
  let score = 50;
  if (record.email.endsWith('.edu')) score += 20;
  if (record.ageBracket === 'adult') score += 10;
  if (record.normalizedName.length > 3) score += 5;
  const summary = `${record.name}: score ${score} (${record.ageBracket})`;
  return { onSuccess: true, onFailure: false, score, summary };
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
- You don't want to write wrapper boilerplate

Port types are inferred from TypeScript definitions. See `flow-weaver docs jsdoc-grammar` for full syntax.

After adding each function, validate to catch errors early:

```bash
flow-weaver validate my-workflow.ts
```

# Step 3: Wire the Workflow

Below the node type functions, add the workflow export. The `@flowWeaver workflow` JSDoc block declares node instances with `@node`, connects ports with `@connect`, and defines positions with `@position`.

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
 * @connect Start.record -> validator.record
 * @connect validator.onSuccess -> enricher.execute
 * @connect validator.validated -> enricher.record
 * @connect enricher.onSuccess -> scorer.execute
 * @connect enricher.enriched -> scorer.record
 * @connect scorer.score -> Exit.score
 * @connect scorer.summary -> Exit.summary
 * @connect scorer.onSuccess -> Exit.onSuccess
 * @connect scorer.onFailure -> Exit.onFailure
 * @position validator -180 0
 * @position enricher 0 0
 * @position scorer 180 0
 */
export function processRecord(
  execute: boolean,
  params: { record: { name: string; age: number; email: string } }
): { onSuccess: boolean; onFailure: boolean; score: number; summary: string } {
  throw new Error('Not implemented');
}
```

Key points:

- `@node validator validateRecord` creates an instance named `validator` of node type `validateRecord`.
- `@connect validator.onSuccess -> enricher.execute` chains the success STEP port of the validator to the execute STEP port of the enricher, so the enricher only runs when validation passes.
- `Start` and `Exit` are reserved pseudo-nodes. `Start` ports come from `@param` tags, `Exit` ports come from `@returns` tags.
- The function body is a placeholder -- the compiler generates the real execution code.

# Step 4: Validate

Run the validator to check for annotation errors, missing connections, and type mismatches:

```bash
flow-weaver validate my-workflow.ts
```

If everything is correct you will see a success message. If there are issues, the output describes each problem. Common things to check:

- Every `@input` has a corresponding function parameter
- Every `@output` appears in the return type
- Port names in `@connect` match the declared `@input` / `@output` names exactly (case-sensitive)
- STEP ports (`execute`, `onSuccess`, `onFailure`) only connect to other STEP ports

For machine-readable output (useful in CI):

```bash
flow-weaver validate my-workflow.ts --json
```

# Step 5: Compile

Generate the executable code:

```bash
flow-weaver compile my-workflow.ts
```

This compiles the workflow in-place, modifying the source file directly. The compiled file contains:

- A runtime execution context class
- Your node type functions (copied verbatim)
- The `processRecord` export function wired with real execution logic

The generated function has the same signature as your placeholder, so existing imports continue to work.

For production builds (no debug events):

```bash
flow-weaver compile my-workflow.ts --production
```

# Step 6: Run

Import and call the generated function from any TypeScript or JavaScript file:

```typescript
import { processRecord } from './my-workflow';

const result = processRecord(true, {
  record: { name: 'Alice Smith', age: 30, email: 'alice@university.edu' },
});

console.log(result);
// {
//   onSuccess: true,
//   onFailure: false,
//   score: 85,
//   summary: "Alice Smith: score 85 (adult)"
// }
```

The first argument (`execute: boolean`) controls whether the workflow actually runs. Pass `true` for normal execution.

Test edge cases:

```typescript
// Invalid record -- validator will fail, enricher and scorer won't run
const bad = processRecord(true, {
  record: { name: '', age: -5, email: '' },
});
console.log(bad.onSuccess); // false
```

# Step 7: Debug

When the workflow does not behave as expected, use these techniques:

## Verbose validation

```bash
flow-weaver validate my-workflow.ts --verbose
```

Shows detailed information about parsed annotations, port types, and connection resolution.

## Inspect generated code

Open the compiled source file and read the execution logic. Each node call is visible in sequence, making it straightforward to trace how data flows between ports.

## Describe the workflow structure

```bash
flow-weaver describe my-workflow.ts
flow-weaver describe my-workflow.ts --format mermaid
```

Outputs the workflow graph as JSON or as a Mermaid diagram for visual inspection.

## WebSocket runtime debugger

For runtime debugging, compile without the `--production` flag and set the debug environment variable:

```bash
FLOW_WEAVER_DEBUG=ws://localhost:9000 node my-workflow.generated.js
```

Debug events (`STATUS_CHANGED`, `VARIABLE_SET`, `WORKFLOW_COMPLETED`) are sent over WebSocket so you can observe execution in real time.

## Common issues

| Symptom                       | Likely cause                                      |
| ----------------------------- | ------------------------------------------------- |
| Output is `null` or `0`       | Exit port not connected, or upstream node failed  |
| Node never executes           | Missing `@connect` to its `execute` STEP port     |
| Validation error on port name | Typo in `@connect` -- names are case-sensitive    |
| `onSuccess` is always `false` | Check the `if (!execute)` guard and failure paths |

# Complete Example

Here is the full `my-workflow.ts` with all pieces together:

```typescript
// =============================================================================
// Node Types
// =============================================================================

/**
 * @flowWeaver nodeType
 * @label Validate Record
 * @input record - Raw record to validate
 * @output validated - The validated record
 */
function validateRecord(
  execute: boolean,
  record: { name: string; age: number; email: string }
): {
  onSuccess: boolean;
  onFailure: boolean;
  validated: { name: string; age: number; email: string } | null;
} {
  if (!execute) return { onSuccess: false, onFailure: false, validated: null };
  try {
    if (!record.name || !record.email || record.age < 0 || record.age > 150) {
      return { onSuccess: false, onFailure: true, validated: null };
    }
    return { onSuccess: true, onFailure: false, validated: record };
  } catch {
    return { onSuccess: false, onFailure: true, validated: null };
  }
}

/**
 * @flowWeaver nodeType
 * @label Enrich Record
 * @input record - Validated record to enrich
 * @output enriched - Record with added fields
 */
function enrichRecord(
  execute: boolean,
  record: { name: string; age: number; email: string }
): {
  onSuccess: boolean;
  onFailure: boolean;
  enriched: {
    name: string;
    age: number;
    email: string;
    normalizedName: string;
    ageBracket: string;
  } | null;
} {
  if (!execute) return { onSuccess: false, onFailure: false, enriched: null };
  const normalizedName = record.name.trim().toLowerCase();
  const ageBracket = record.age < 18 ? 'minor' : record.age < 65 ? 'adult' : 'senior';
  return {
    onSuccess: true,
    onFailure: false,
    enriched: { ...record, normalizedName, ageBracket },
  };
}

/**
 * @flowWeaver nodeType
 * @label Score Record
 * @input record - Enriched record to score
 * @output score - Computed score
 * @output summary - Human-readable summary
 */
function scoreRecord(
  execute: boolean,
  record: {
    name: string;
    age: number;
    email: string;
    normalizedName: string;
    ageBracket: string;
  }
): {
  onSuccess: boolean;
  onFailure: boolean;
  score: number;
  summary: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, score: 0, summary: '' };
  let score = 50;
  if (record.email.endsWith('.edu')) score += 20;
  if (record.ageBracket === 'adult') score += 10;
  if (record.normalizedName.length > 3) score += 5;
  const summary = `${record.name}: score ${score} (${record.ageBracket})`;
  return { onSuccess: true, onFailure: false, score, summary };
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
 * @connect Start.record -> validator.record
 * @connect validator.onSuccess -> enricher.execute
 * @connect validator.validated -> enricher.record
 * @connect enricher.onSuccess -> scorer.execute
 * @connect enricher.enriched -> scorer.record
 * @connect scorer.score -> Exit.score
 * @connect scorer.summary -> Exit.summary
 * @connect scorer.onSuccess -> Exit.onSuccess
 * @connect scorer.onFailure -> Exit.onFailure
 * @position validator -180 0
 * @position enricher 0 0
 * @position scorer 180 0
 */
export function processRecord(
  execute: boolean,
  params: { record: { name: string; age: number; email: string } }
): { onSuccess: boolean; onFailure: boolean; score: number; summary: string } {
  throw new Error('Not implemented');
}
```

## Running the complete example

```bash
# Validate
flow-weaver validate my-workflow.ts

# Compile
flow-weaver compile my-workflow.ts

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

Instead of running validate, compile, and run separately, use `flow-weaver dev` to do all three in a single watch loop:

```bash
flow-weaver dev my-workflow.ts --params '{"record": {"name": "Alice", "age": 30, "email": "alice@edu.com"}}'
```

This watches for file changes, recompiles, and re-runs automatically.

# Generate a Diagram

Visualize your workflow as an SVG diagram:

```bash
flow-weaver diagram my-workflow.ts -o my-workflow.svg
flow-weaver diagram my-workflow.ts --theme light -o my-workflow.svg
```

# Next Steps

Now that you have a working workflow, explore these topics to go further:

- **CLI Reference** (`flow-weaver docs cli-reference`) -- Complete reference for all CLI commands and flags
- **Advanced Annotations** (`flow-weaver docs advanced-annotations`) -- Pull execution, merge strategies, auto-connect, path/map sugar
- **Compilation** (`flow-weaver docs compilation`) -- TypeScript and Inngest compilation targets, production mode, serve handlers
- **Deployment** (`flow-weaver docs deployment`) -- Export to Lambda, Vercel, Cloudflare, Inngest; HTTP serve mode
- **Built-in Nodes** (`flow-weaver docs built-in-nodes`) -- delay, waitForEvent, invokeWorkflow nodes and the mock system for testing
- **Marketplace** (`flow-weaver docs marketplace`) -- Install and publish reusable node type packages
- **Patterns** (`flow-weaver docs patterns`) -- Extract reusable workflow fragments and apply them across projects
- **Scoped ports and forEach** (`flow-weaver docs export-interface`) -- Iterate over arrays using scoped ports and callback parameters
- **Expression nodes** (`flow-weaver docs node-conversion`) -- Write pure functions without `execute`/`onSuccess`/`onFailure` boilerplate
- **Scaffolding templates** (`flow-weaver docs scaffold`) -- Generate workflows from templates like `sequential`, `foreach`, `conditional`, and more
- **Debugging** (`flow-weaver docs debugging`) -- WebSocket debugger, validation diagnostics, and error resolution
- **JSDoc grammar** (`flow-weaver docs jsdoc-grammar`) -- Full annotation syntax reference including metadata brackets, scope clauses, and positioning
