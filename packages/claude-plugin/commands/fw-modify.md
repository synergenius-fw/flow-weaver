---
description: Make targeted modifications to existing workflows
argument-hint: <modification-description>
---

**USE CASE**: Make targeted changes - add/remove nodes, update logic, modify connections.

Invoke skills: flow-weaver:flow-weaver-concepts

Then modify: $ARGUMENTS

## Modification Types

### 1. Add Nodes

Add `@node` instance and define the node type if needed:

```typescript
/**
 * @flowWeaver workflow
 * @node validator validateData
 * @node processor processData
 * @connect Start.input -> validator.data
 * @connect validator.output -> processor.input
 */
```

For new node types, add function with `@flowWeaver nodeType`:

```typescript
/**
 * @flowWeaver nodeType
 * @label Validate Data
 * @input data - Data to validate
 * @output validated - Validated data
 */
function validateData(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; validated: any } {
  if (!execute) return { onSuccess: false, onFailure: false, validated: null };
  // validation logic
  return { onSuccess: true, onFailure: false, validated: data };
}
```

### 2. Remove Nodes

1. Remove `@node` annotation
2. Remove related `@connect` annotations
3. Remove `@position` if present
4. Remove node type function if unused

### 3. Update Node Logic

Edit the function body directly:

```typescript
function processData(
  execute: boolean,
  input: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };

  // MODIFY: Update logic here
  const result = transform(input);

  return { onSuccess: true, onFailure: false, result };
}
```

### 4. Modify Connections

Update `@connect` annotations:

```typescript
// Add connection
@connect nodeA.output -> nodeB.input

// Remove: delete the @connect line

// Reconnect: modify source/target
@connect nodeA.output -> nodeC.input  // Changed target
```

### 5. Update Export Interface

Modify `@param`, `@returns` annotations:

```typescript
/**
 * @flowWeaver workflow
 * @param newInput - New input port
 * @param [optionalInput] - Optional input
 * @returns result - Output result
 */
```

### 6. Add Scopes (Iteration)

For iteration/looping, use per-port `scope:scopeName` suffixes:

```typescript
/**
 * @flowWeaver nodeType
 * @input items - Array to iterate
 * @output start scope:processItem - Triggers child execute
 * @output item scope:processItem - Current item
 * @input success scope:processItem - From child onSuccess
 * @input failure scope:processItem - From child onFailure
 * @input processed scope:processItem - Result from child
 * @output results - Collected results
 */
```

See `flow-weaver:flow-weaver-export-interface` for full scope documentation.

## Modification Workflow

1. Read file to understand current state
2. Use Edit tool for targeted changes
3. Validate: `flow-weaver validate <file>`
4. Test: `/fw-test <exportName>`

## Example Usage

- /fw-modify "Add validation node before processing"
- /fw-modify "Update the transform logic in processData"
- /fw-modify "Connect error handler to failure path"
- /fw-modify "Add logging to track execution"
