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

**Default to expression mode.** Expression nodes handle success/failure branching via throw. Only use normal mode when you need to return data on the failure path, or for void side-effects.

---

# Prerequisites

> Function declarations, arrow functions (`const fn = () => {}`), and function expressions (`const fn = function() {}`) are all supported. The JSDoc block is placed above the variable declaration for arrow/function expressions.

---

# Expression Mode

> Expression mode is recommended for most conversions. The auto-detect heuristic
> defaults to expression mode for non-void returns.

Expression nodes are pure functions. The runtime auto-manages `execute`, `onSuccess`, and `onFailure`. The function signature and body are NOT modified -- only a JSDoc block is added.

## Rules

- Add a JSDoc block directly above the function
- First line: `@flowWeaver nodeType`
- Second line: `@expression`
- Add `@input <name>` for each function parameter
- Add `@output` based on the return type:
  - **Primitive or array return** -> single `@output result`
  - **Object return** `{ a: T, b: U }` -> one `@output` per property (`@output a`, `@output b`)
  - **void return** -> no `@output` tags (only onSuccess/onFailure, which are automatic)
- Add `@label` with a human-readable name (PascalCase -> spaced words)
- Do NOT add `execute` parameter to the function
- Do NOT change the return type
- Do NOT modify the function body

## Example -- single output (primitive return)

```typescript
// BEFORE
function add(a: number, b: number): number {
  return a + b;
}

// AFTER
/**
 * @flowWeaver nodeType
 * @expression
 * @label Add
 * @input a
 * @input b
 * @output result
 */
function add(a: number, b: number): number {
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
 * @label Split Name
 * @input fullName
 * @output first
 * @output last
 */
function splitName(fullName: string): { first: string; last: string } {
  const [first, ...rest] = fullName.split(' ');
  return { first, last: rest.join(' ') };
}
```

## Example -- async expression (returns a value)

```typescript
// BEFORE
async function fetchData(url: string): Promise<Data> {
  const res = await fetch(url);
  return await res.json();
}

// AFTER
/**
 * @flowWeaver nodeType
 * @expression
 * @label Fetch Data
 * @input url
 * @output result
 */
async function fetchData(url: string): Promise<Data> {
  const res = await fetch(url);
  return await res.json();
}
```

## Example -- void return (side-effect expression)

```typescript
// BEFORE
function logMessage(message: string): void {
  console.log(message);
}

// AFTER
/**
 * @flowWeaver nodeType
 * @expression
 * @label Log Message
 * @input message
 */
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

**Default to expression mode.** Expression nodes support failure branching via throw. Only switch to normal mode for error-with-data patterns or void side-effects.

The compiler fully supports async expression nodes -- `await`, async detection, try/catch wrapping, and onSuccess/onFailure are all handled automatically.

---

# Output Mapping Rules

## Expression mode

- Primitive/array return -> single `@output result`
- Object return `{ a, b }` -> one `@output` per property
- void -> no `@output` tags

## Normal mode

- Single value return -> `@output result` (nullable in return type)
- Object return `{ a, b }` -> one `@output` per property (each nullable)
- void -> no custom outputs (only `onSuccess`/`onFailure`)
- All outputs are `| null` in the return type for the `!execute` and `catch` paths

---

# Post-Conversion Validation

After conversion, run `flow-weaver validate <file>` to verify the converted node types are correctly parsed.
