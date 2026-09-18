---
name: Node Conversion Reference
description: Rules and heuristics for converting TypeScript functions to Flow Weaver node types
keywords: [conversion, expression mode, normal mode, function, transform, nodeType, input, output]
---

# Which Mode Should I Use?

```
Is it a pure function that returns a value?
  YES -> expression mode (@expression)
  NO  |
Does it need to return error data alongside the failure signal?
  YES -> normal mode
  NO  -> expression mode (@expression)
```

**Default to expression mode.** A throw in an expression node marks it failed and propagates the error out of the workflow call. Use normal mode when a failure must be routed to another node or to `Exit.onFailure`, must carry data, or the function returns void.

---

# Prerequisites

> Function declarations, arrow functions (`const fn = () => {}`), and function expressions (`const fn = function() {}`) are all supported. The JSDoc block is placed above the variable declaration for arrow/function expressions.

---

# Expression Mode

> Expression mode is recommended for most conversions. The auto-detect heuristic
> defaults to expression mode for non-void returns.

Expression nodes are pure functions. The runtime auto-manages `execute`, `onSuccess`, and `onFailure`. The function signature and body are NOT modified -- only a JSDoc block is added.

## The minimal form

**Ports are inferred from the signature.** For a fully-typed function, `@flowWeaver nodeType @expression` is the whole annotation. Each parameter becomes an input port; each returned object property becomes an output port (a primitive or array return is one port, `result`). You do not restate them.

```typescript
/** @flowWeaver nodeType @expression */
function add(a: number, b: number): number {
  return a + b;
}
```

That is a complete node type: two inputs `a` and `b`, one output `result`. Write this first. Reach for the tags below only when you want something inference cannot give you.

## When to add tags

`@input`, `@output` and `@label` are **optional overrides**, not a transcription step. Add one only for a specific reason:

- `@input name - Description` / `@output name - Description` — to document a port. The description is the only thing here inference cannot produce.
- `@input [name]` / `@input [name=default]` — to mark an input optional or give it a default.
- `@input name [order:N]` / `@output name [order:N]` — to fix the visual order of ports in the editor.
- `@label Display Name` — to set the node's display name in diagrams (defaults to the function name).
- `@color`, `@icon`, `@tag` — visual customization.

Rules for the function itself, always:

- Do NOT add an `execute` parameter.
- Do NOT change the return type.
- Do NOT modify the body.

A function used as a node with **no** `@flowWeaver nodeType` annotation at all still works (ports are inferred) but raises `INFERRED_NODE_TYPE`, because the parser cannot tell it was meant to be a node. Adding the one-line annotation silences that; adding port tags is not what it asks for.

## Example -- ports inferred, description added

```typescript
// Minimal: ports inferred
/** @flowWeaver nodeType @expression */
function add(a: number, b: number): number {
  return a + b;
}

// With descriptions, when they earn their place
/**
 * @flowWeaver nodeType
 * @expression
 * @input a - First addend
 * @input b - Second addend
 * @output result - The sum
 */
function addDocumented(a: number, b: number): number {
  return a + b;
}
```

## Example -- multi output (object return)

```typescript
// BEFORE
function splitName(fullName: string): { first: string; last: string } {
  const [first, ...rest] = fullName.split(' ');
  return { first, last: rest.join(' ') };
}

// AFTER
/**
 * @flowWeaver nodeType
 * @expression
 */
function splitName(fullName: string): { first: string; last: string } {
  const [first, ...rest] = fullName.split(' ');
  return { first, last: rest.join(' ') };
}
```

Inputs: `fullName`. Outputs: `first`, `last`, one per returned property.

## Example -- async expression (returns a value)

An `async` function is an expression node like any other; its resolved value maps to the outputs.

```typescript
/** @flowWeaver nodeType @expression */
async function fetchData(url: string): Promise<Data> {
  const res = await fetch(url);
  return await res.json();
}
```

Input: `url`. Output: `result` (the single non-object return).

## Example -- void return (side-effect expression)

A void return has no data outputs, only the automatic `onSuccess`/`onFailure`.

```typescript
/** @flowWeaver nodeType @expression */
function logMessage(message: string): void {
  console.log(message);
}
```

---

# Normal Mode

Normal nodes have explicit `execute` parameter and success/failure handling. The function signature AND body are rewritten.

## Rules

- Add `execute: boolean` as the **first** parameter
- Each original parameter becomes a direct parameter after `execute` (NOT wrapped in an object)
- Change the return type to `{ onSuccess: boolean; onFailure: boolean; ...originalOutputs }`
- Add early return: `if (!execute) return { onSuccess: false, onFailure: false, ...nullOutputs };`
- Wrap the original body in `try { ... } catch { ... }`
- In the try block: return `{ onSuccess: true, onFailure: false, ...outputs }`
- In the catch block: return `{ onSuccess: false, onFailure: true, ...nullOutputs }`
- If async, keep the `async` keyword and wrap return type in `Promise<...>`
- Add JSDoc with `@flowWeaver nodeType`, `@input`, `@output` tags (NO `@expression` tag)

## Example -- sync function

```typescript
// BEFORE
function double(x: number): number {
  return x * 2;
}

// AFTER
/**
 * @flowWeaver nodeType
 * @label Double
 * @input x
 * @output result
 */
function double(
  execute: boolean,
  x: number
): { onSuccess: boolean; onFailure: boolean; result: number | null } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  try {
    const result = x * 2;
    return { onSuccess: true, onFailure: false, result };
  } catch {
    return { onSuccess: false, onFailure: true, result: null };
  }
}
```

## Example -- async function

```typescript
// BEFORE
async function fetchUser(id: string): Promise<User> {
  return await db.users.findById(id);
}

// AFTER
/**
 * @flowWeaver nodeType
 * @label Fetch User
 * @input id
 * @output user
 */
async function fetchUser(
  execute: boolean,
  id: string
): Promise<{ onSuccess: boolean; onFailure: boolean; user: User | null }> {
  if (!execute) return { onSuccess: false, onFailure: false, user: null };
  try {
    const user = await db.users.findById(id);
    return { onSuccess: true, onFailure: false, user };
  } catch {
    return { onSuccess: false, onFailure: true, user: null };
  }
}
```

## Example -- multi output

```typescript
// BEFORE
function analyze(text: string): { wordCount: number; charCount: number } {
  return { wordCount: text.split(' ').length, charCount: text.length };
}

// AFTER
/**
 * @flowWeaver nodeType
 * @label Analyze
 * @input text
 * @output wordCount
 * @output charCount
 */
function analyze(
  execute: boolean,
  text: string
): { onSuccess: boolean; onFailure: boolean; wordCount: number | null; charCount: number | null } {
  if (!execute) return { onSuccess: false, onFailure: false, wordCount: null, charCount: null };
  try {
    const wordCount = text.split(' ').length;
    const charCount = text.length;
    return { onSuccess: true, onFailure: false, wordCount, charCount };
  } catch {
    return { onSuccess: false, onFailure: true, wordCount: null, charCount: null };
  }
}
```

---

# Type Mapping Reference

| TypeScript type                                | Flow Weaver data type |
| ---------------------------------------------- | --------------------- |
| `string`                                       | STRING                |
| `number`                                       | NUMBER                |
| `boolean`                                      | BOOLEAN               |
| `T[]`, `Array<T>`                              | ARRAY                 |
| `() => T`, `Function`                          | FUNCTION              |
| `any`, `unknown`                               | ANY                   |
| Everything else (objects, classes, interfaces) | OBJECT                |

Types are inferred automatically from the TypeScript signature -- you don't need to specify them in the JSDoc.

---

# Optional & Default Inputs

- Optional input: `@input [paramName]`
- Input with default value: `@input [paramName=defaultValue]`

Optional inputs generate ports that don't require a connection. Default values are used when the port is unconnected.

---

# Auto-detect Heuristics

When no `--mode` is specified:

- **Expression** (default): function returns a value (non-void), whether sync or async
- **Normal**: void return, or user explicitly requests normal mode

**Default to expression mode.** A throw in an expression node marks it failed and propagates the error out of the workflow call. Switch to normal mode when a failure must be routed to another node or to `Exit.onFailure`, must carry data, or the function returns void.

The compiler fully supports async expression nodes -- `await`, async detection, try/catch wrapping, and onSuccess/onFailure are all handled automatically.

---

# Output Mapping Rules

This is what the compiler infers from the return type; you do not write these `@output` tags unless you are overriding.

## Expression mode

- Primitive/array return -> single output `result`
- Object return `{ a, b }` -> one output per property
- void -> no data outputs

## Normal mode

- Single value return -> `@output result` (nullable in return type)
- Object return `{ a, b }` -> one `@output` per property (each nullable)
- void -> no custom outputs (only `onSuccess`/`onFailure`)
- All outputs are `| null` in the return type for the `!execute` and `catch` paths

---

# Post-Conversion Validation

After conversion, run `fw validate <file>` to verify the converted node types are correctly parsed.
