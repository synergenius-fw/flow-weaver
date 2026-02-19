---
name: Flow Weaver Error Codes
description: Complete reference of validation error and warning codes with causes and fixes
---

# Error Code Reference

Every code the validator can emit is listed below. Each entry includes the severity (error or warning), what the code means, common causes, and how to fix it.

## Quick Fixes — Top 5 Most Common Errors

These are the errors you'll hit most often. Here's how to fix them fast:

### 1. MISSING_REQUIRED_INPUT

**You'll see this when:** A node input has nothing connected to it.

```typescript
// Fix: Add a @connect to wire the port
@connect Start.apiKey -> fetcher.apiKey

// Or mark it optional:
@input [apiKey] - Optional API key
```

### 2. UNKNOWN_NODE_TYPE

**You'll see this when:** A `@node` references a function that doesn't have `@flowWeaver nodeType`.

```typescript
// Fix: Add the annotation above your function
/** @flowWeaver nodeType @expression */
function myFunction(input: string): { output: string } { ... }
```

### 3. UNKNOWN_SOURCE_PORT / UNKNOWN_TARGET_PORT

**You'll see this when:** A `@connect` has a typo in the port name.

```typescript
// BAD — typo
@connect nodeA.reuslt -> nodeB.input

// GOOD
@connect nodeA.result -> nodeB.input
```

### 4. STEP_PORT_TYPE_MISMATCH

**You'll see this when:** You wire a control flow port (execute/onSuccess/onFailure) to a data port or vice versa.

```typescript
// BAD — onSuccess is control flow, inputData is data
@connect nodeA.onSuccess -> nodeB.inputData

// GOOD — control flow to control flow, data to data
@connect nodeA.onSuccess -> nodeB.execute
@connect nodeA.result -> nodeB.inputData
```

### 5. CYCLE_DETECTED

**You'll see this when:** Nodes form a circular dependency (A -> B -> C -> A).

```
// Fix: Remove one connection to break the loop.
// If you need iteration, use a forEach scoped node instead.
```

---

## Structural Errors

#### MISSING_WORKFLOW_NAME

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                         |
| Meaning       | The workflow AST has no `name` property.                                                                                                                      |
| Common Causes | The `@flowWeaver workflow` annotation is missing or has no name argument. The parser could not extract a workflow name from the source file.                  |
| Fix           | Add or correct the workflow annotation: `@flowWeaver workflow MyWorkflowName`. Ensure the annotation is placed directly above the exported workflow function. |

> **Beginner explanation:** The workflow annotation is missing or incomplete. Every workflow needs `@flowWeaver workflow` in its JSDoc block.
>
> **What to do:** Add `@flowWeaver workflow` to the JSDoc block above your exported workflow function.

#### MISSING_FUNCTION_NAME

| Field         | Value                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                           |
| Meaning       | The workflow AST has no `functionName` property.                                                                                                                                |
| Common Causes | The exported function declaration is missing or anonymous. The parser could not determine the function name from the source file.                                               |
| Fix           | Ensure the workflow is exported as a named function: `export async function myWorkflow(execute: boolean, params: {...}) { ... }`. The function name becomes the `functionName`. |

> **Beginner explanation:** The compiler found a `@flowWeaver workflow` annotation but could not determine the function name. The workflow must be an exported, named function.
>
> **What to do:** Make sure your workflow is declared as `export function myWorkflowName(...)` -- not anonymous or unexported.

#### DUPLICATE_NODE_NAME

| Field         | Value                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                               |
| Meaning       | Two or more `@flowWeaver nodeType` declarations share the same `functionName`.                                                                      |
| Common Causes | Copy-pasting a node type and forgetting to rename the function. Two separate files defining the same function name imported into a single workflow. |
| Fix           | Rename one of the duplicate node type functions so each has a unique name.                                                                          |

> **Beginner explanation:** Two node type functions have the same name. Each `@flowWeaver nodeType` function must have a unique name.
>
> **What to do:** Rename one of the duplicate functions to make all names unique.

**Example:**

```typescript
// BAD: Both functions have the same name
/** @flowWeaver nodeType */
const processData = (execute: boolean, input: string) => { ... };

/** @flowWeaver nodeType */
const processData = (execute: boolean, value: number) => { ... }; // DUPLICATE_NODE_NAME

// GOOD: Unique names
const processText = (execute: boolean, input: string) => { ... };
const processNumber = (execute: boolean, value: number) => { ... };
```

#### MUTABLE_NODE_TYPE_BINDING (warning)

| Field         | Value                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                   |
| Meaning       | A node type function is declared with `let` or `var` instead of `const`.                                  |
| Common Causes | Using `let` out of habit when declaring the node function variable.                                       |
| Fix           | Change the declaration to `const`. This prevents accidental reassignment of the node function at runtime. |

> **Beginner explanation:** Use `const` instead of `let` or `var` when declaring node type functions. This is a best practice to prevent accidental reassignment.
>
> **What to do:** Change `let myNode = ...` to `const myNode = ...`.

**Example:**

```typescript
// Triggers warning
let myNode = (execute: boolean, input: string) => { ... };

// No warning
const myNode = (execute: boolean, input: string) => { ... };
```

---

## Naming Errors

#### RESERVED_NODE_NAME

| Field         | Value                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                           |
| Meaning       | A node type's `functionName` uses a reserved name (`Start` or `Exit`).                                                                                          |
| Common Causes | Naming a node type function `Start` or `Exit`, which are reserved for the virtual entry and exit points of the workflow graph.                                  |
| Fix           | Rename the node type function to something other than `Start` or `Exit`. For example, use `StartProcess`, `InitializeFlow`, `ExitHandler`, or `FinalizeResult`. |

> **Beginner explanation:** `Start` and `Exit` are special built-in nodes in every workflow. You can't name your own functions `Start` or `Exit`.
>
> **What to do:** Rename your function to something else, like `startProcess` or `exitHandler`.

#### RESERVED_INSTANCE_ID

| Field         | Value                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                    |
| Meaning       | A node instance in the `@instance` annotation uses a reserved ID (`Start` or `Exit`).                                                    |
| Common Causes | Explicitly naming an instance `Start` or `Exit` in the workflow annotations.                                                             |
| Fix           | Choose a different instance ID. The names `Start` and `Exit` are reserved for the implicit entry and exit nodes that every workflow has. |

> **Beginner explanation:** In `@node myId myType`, the `myId` cannot be `Start` or `Exit` — those are reserved for the built-in entry and exit points.
>
> **What to do:** Pick a different instance ID, like `startHandler` or `exitHandler`.

**Example:**

```typescript
// BAD: Using reserved names
/** @instance Start: MyNodeType */ // RESERVED_INSTANCE_ID
/** @instance Exit: MyNodeType */ // RESERVED_INSTANCE_ID

// GOOD: Non-reserved names
/** @instance startHandler: MyNodeType */
/** @instance exitHandler: MyNodeType */
```

---

## Connection Errors

#### UNKNOWN_SOURCE_NODE

| Field         | Value                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity      | Error                                                                                                                                                  |
| Meaning       | A `@connect` annotation references a source node that does not exist in the workflow instances.                                                        |
| Common Causes | Typo in the source node name. The source instance was removed but the connection was not. Referencing a node from another workflow.                    |
| Fix           | Correct the source node name in the `@connect` annotation. The validator may suggest a similar name if one exists (e.g., `Did you mean "fetchData"?`). |

> **Beginner explanation:** The node name before the `.` in a `@connect` line doesn't match any `@node` in your workflow. Check for typos.
>
> **What to do:** Make sure the name in `@connect sourceName.port -> ...` matches an ID from a `@node sourceName nodeType` line.

#### UNKNOWN_TARGET_NODE

| Field         | Value                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                           |
| Meaning       | A `@connect` annotation references a target node that does not exist in the workflow instances. |
| Common Causes | Typo in the target node name. The target instance was removed but the connection was not.       |
| Fix           | Correct the target node name. Check the validator suggestion for the closest match.             |

> **Beginner explanation:** The node name after `->` in a `@connect` line doesn't match any `@node` in your workflow. Check for typos.
>
> **What to do:** Make sure the name in `@connect ... -> targetName.port` matches an ID from a `@node targetName nodeType` line.

#### UNKNOWN_SOURCE_PORT

| Field         | Value                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                                                           |
| Meaning       | The source port in a connection does not exist on the source node type's outputs.                                                                                                                               |
| Common Causes | Typo in the port name (port names are case-sensitive). The node type was modified and the output port was removed or renamed. Connecting from a port that is actually an input.                                 |
| Fix           | Check the source node type definition for available output ports. The validator suggests the closest matching port name. Remember that all node types implicitly have `onSuccess` and `onFailure` output ports. |

> **Beginner explanation:** The port name after the `.` on the source side doesn't exist on that node. Port names come from the function's return type (for expression nodes) or `@output` annotations.
>
> **What to do:** Check what the source function actually returns. The port name must match a property in the return object.

#### UNKNOWN_TARGET_PORT

| Field         | Value                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                                         |
| Meaning       | The target port in a connection does not exist on the target node type's inputs.                                                                                                              |
| Common Causes | Typo in the port name. The node type was modified and the input port was removed or renamed. Connecting to a port that is actually an output.                                                 |
| Fix           | Check the target node type definition for available input ports. The validator suggests the closest matching port name. Remember that all node types implicitly have an `execute` input port. |

> **Beginner explanation:** The port name after the `.` on the target side doesn't exist on that node. Port names come from the function's parameters (for expression nodes) or `@input` annotations.
>
> **What to do:** Check what parameters the target function accepts. The port name must match a parameter name.

**Example:**

```typescript
// BAD: "reuslt" is a typo for "result"
/** @connect NodeA.reuslt -> NodeB.input */ // UNKNOWN_SOURCE_PORT (Did you mean "result"?)

// GOOD:
/** @connect NodeA.result -> NodeB.input */
```

#### STEP_PORT_TYPE_MISMATCH

| Field         | Value                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity      | Error                                                                                                                                                                                                                                |
| Meaning       | A STEP (control flow) port is connected to a non-STEP port, or vice versa.                                                                                                                                                           |
| Common Causes | Connecting `onSuccess` (STEP) to a data input port. Connecting a data output to `execute` (STEP) input of another node. Confusing control flow and data flow.                                                                        |
| Fix           | STEP ports can only connect to other STEP ports. Control flow ports are: `execute` (input), `onSuccess` (output), `onFailure` (output). Data ports carry values (STRING, NUMBER, OBJECT, etc.) and must connect to other data ports. |

> **Beginner explanation:** The port expects a trigger signal but received data (or vice versa). Connect STEP ports (`execute`, `onSuccess`, `onFailure`) only to other STEP ports. Connect data ports only to other data ports.
>
> **What to do:** Check the connection. If you meant to pass data, use the data output port (e.g., `result`) instead of `onSuccess`. If you meant to trigger execution, use `execute` as the target instead of a data input.

**Example:**

```typescript
// BAD: Connecting control flow to data port
/** @connect NodeA.onSuccess -> NodeB.inputData */ // STEP_PORT_TYPE_MISMATCH

// GOOD: Control flow to control flow
/** @connect NodeA.onSuccess -> NodeB.execute */

// GOOD: Data to data
/** @connect NodeA.result -> NodeB.inputData */
```

#### MULTIPLE_CONNECTIONS_TO_INPUT

| Field         | Value                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                                                                                                                                                                                                                                                          |
| Meaning       | A non-STEP input port has more than one incoming connection. Only one value can be received per data input.                                                                                                                                                                                                                                                                                                    |
| Common Causes | Two different nodes both send data to the same input port. Accidentally duplicating a `@connect` line with a different source.                                                                                                                                                                                                                                                                                 |
| Fix           | Remove one of the connections. If you need to merge multiple values, either: (1) use a merge node that combines the values and outputs a single result, (2) add a `@mergeStrategy` tag to the port (FIRST, LAST, COLLECT, MERGE, CONCAT), or (3) use separate input ports on the target node. Note: STEP ports (like `execute`) can have multiple connections because control flow supports multiple triggers. |

> **Beginner explanation:** Two different nodes are sending data to the same input port. Each data input can only receive from one source.
>
> **What to do:** Remove one of the `@connect` lines, or use separate input ports on the target node.

**Example:**

```typescript
// BAD: Two data sources to one input
/** @connect NodeA.result -> NodeC.input */
/** @connect NodeB.result -> NodeC.input */ // MULTIPLE_CONNECTIONS_TO_INPUT

// GOOD: Use separate ports or a merge node
/** @connect NodeA.result -> Merger.inputA */
/** @connect NodeB.result -> Merger.inputB */
/** @connect Merger.merged -> NodeC.input */
```

---

## Type Compatibility Errors and Warnings

#### OBJECT_TYPE_MISMATCH (warning)

| Field         | Value                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity      | Warning                                                                                                                                                                                          |
| Meaning       | Both ports are OBJECT type but their TypeScript structural types (`tsType`) differ.                                                                                                              |
| Common Causes | Connecting a port that outputs `{ name: string }` to a port that expects `{ id: number, name: string }`. Different interfaces that happen to share the OBJECT data type.                         |
| Fix           | Verify that the source object shape is compatible with what the target expects. If the structures are intentionally different, ensure the target handles missing or extra properties gracefully. |

> **Beginner explanation:** You're passing an object from one node to another, but they have different shapes (different properties). It might work, but could cause issues if the target expects fields that don't exist.
>
> **What to do:** Check that the source object has all the fields the target expects. You may need to add a transform node between them.

#### LOSSY_TYPE_COERCION (warning)

| Field         | Value                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning (Error with `@strictTypes`)                                                                                                                                                                                 |
| Meaning       | The connection requires a type coercion that may lose information.                                                                                                                                                  |
| Common Causes | STRING to NUMBER (may produce NaN). STRING to BOOLEAN (JavaScript truthy/falsy). OBJECT to STRING (uses JSON.stringify). ARRAY to STRING (uses JSON.stringify).                                                     |
| Fix           | Add an explicit conversion node between the source and target if precision matters. Or accept the coercion if the behavior is intentional. With `@strictTypes` enabled, this becomes an error and must be resolved. |

> **Beginner explanation:** You're connecting ports with different types (e.g., a string output to a number input). The system will try to convert, but data might be lost (e.g., "hello" becomes NaN as a number).
>
> **What to do:** Add a conversion node between them, or change your node types so the types match.

#### UNUSUAL_TYPE_COERCION (warning)

| Field         | Value                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity      | Warning (Error with `@strictTypes`)                                                                                                                                                  |
| Meaning       | The connection requires a type coercion that is technically valid but semantically unusual.                                                                                          |
| Common Causes | NUMBER to BOOLEAN (0 = false, non-zero = true). BOOLEAN to NUMBER (false = 0, true = 1). STRING to OBJECT (requires valid JSON). STRING to ARRAY (requires valid JSON array).        |
| Fix           | Consider whether the coercion is intentional. If so, the warning can be acknowledged. For explicit conversion, insert a conversion node. With `@strictTypes`, this becomes an error. |

> **Beginner explanation:** You're connecting types that can technically convert but it's unusual (e.g., number to boolean, where 0 becomes false). It works, but might not be what you intended.
>
> **What to do:** If intentional, you can ignore this warning. Otherwise, adjust your types to match.

#### TYPE_MISMATCH (warning)

| Field         | Value                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning (Error with `@strictTypes`)                                                                                                                                    |
| Meaning       | The source and target port types are incompatible, and the connection does not fall into any known coercion category. Runtime coercion will be attempted but may fail. |
| Common Causes | Connecting fundamentally incompatible types such as ARRAY to NUMBER, OBJECT to BOOLEAN, or FUNCTION to STRING.                                                         |
| Fix           | Review whether the connection is correct. In most cases this indicates a wiring mistake. Insert a conversion or transformation node if the connection is intentional.  |

> **Beginner explanation:** The connected ports have completely incompatible types (e.g., array to number). This is almost always a wiring mistake.
>
> **What to do:** Check the `@connect` line — you're probably connecting the wrong ports. Look at what each node actually outputs and expects.

#### TYPE_INCOMPATIBLE (with @strictTypes)

| Field         | Value                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                           |
| Meaning       | A type coercion or mismatch that would normally be a warning is promoted to an error because the workflow uses `@strictTypes`.                                                  |
| Common Causes | Any of the above type warnings (LOSSY_TYPE_COERCION, UNUSUAL_TYPE_COERCION, TYPE_MISMATCH) occurring in a workflow annotated with `@strictTypes`.                               |
| Fix           | Either resolve the type mismatch by changing the connection or inserting a conversion node, or remove `@strictTypes` from the workflow if you want to allow implicit coercions. |

> **Beginner explanation:** You have `@strictTypes` enabled, which turns type warnings into errors. Either fix the type mismatch or remove `@strictTypes` if you want to allow implicit conversions.
>
> **What to do:** Fix the connection so types match, add a conversion node, or remove `@strictTypes` from the workflow annotation.

**Example:**

```typescript
// With @strictTypes, this warning becomes TYPE_INCOMPATIBLE error:
// STRING -> NUMBER connection
/** @connect UserInput.text -> Calculator.value */ // TYPE_INCOMPATIBLE

// Fix: Add explicit conversion
/** @connect UserInput.text -> ParseNumber.input */
/** @connect ParseNumber.result -> Calculator.value */
```

---

## Node Reference Errors

#### UNKNOWN_NODE_TYPE

| Field         | Value                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                               |
| Meaning       | An instance references a node type function name that does not exist in the workflow.                                                                                               |
| Common Causes | Typo in the `@instance` annotation. The node type function was renamed or removed. The node type is defined in a different file that is not imported.                               |
| Fix           | Correct the node type name in the `@instance` annotation. The validator suggests the closest match. Ensure the node type function is defined in the same file or properly imported. |

> **Beginner explanation:** Did you forget to add `@flowWeaver nodeType` above the function? The `@node` annotation references a function name that the compiler cannot find. Either the function does not exist, is misspelled, or is missing its `@flowWeaver nodeType` annotation.
>
> **What to do:** Check that the function name in `@node instanceId functionName` exactly matches a function annotated with `@flowWeaver nodeType` in the same file (or imported).

#### UNDEFINED_NODE

| Field         | Value                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                       |
| Meaning       | A connection references a node name that appears in the graph but has no corresponding instance definition.                                                 |
| Common Causes | A `@connect` annotation references a node that was never declared with `@instance`. The instance annotation was removed but connections still reference it. |
| Fix           | Either add the missing `@instance` annotation or remove/update the connections that reference the undefined node.                                           |

> **Beginner explanation:** A `@connect` references a node that was never declared with `@node`. The connection exists but the node doesn't.
>
> **What to do:** Either add a `@node myId myType` line for the missing node, or fix the `@connect` to reference the correct node.

#### MISSING_REQUIRED_INPUT

| Field         | Value                                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                                                                                                                   |
| Meaning       | A required input port on a node instance has no connection, no default value, no expression, and is not optional. This will cause a runtime error.                                                                                                                      |
| Common Causes | Adding a new required input to a node type without connecting it in the workflow. Removing a connection without adding a default or marking the port optional.                                                                                                          |
| Fix           | Either: (1) connect a source to the missing input port, (2) add a `@default` value to the port in the node type definition, (3) add an `@expression` to compute the value, (4) mark the port as `@optional`, or (5) add an instance-level expression via `@portConfig`. |

> **Beginner explanation:** This node needs a value for this port but nothing is connected to it. Every required input must receive data from somewhere.
>
> **What to do:** Add a `@connect` from another node's output to this input, or mark the input as optional with `@input [paramName]` (square brackets), or add a default value with `@input [paramName=defaultValue]`.

**Example:**

```typescript
// BAD: "apiKey" has no connection or default
/** @flowWeaver nodeType */
const fetchData = (execute: boolean, url: string, apiKey: string) => { ... };

/** @instance fetcher: fetchData */
/** @connect Start.url -> fetcher.url */
// Missing: nothing connects to fetcher.apiKey -> MISSING_REQUIRED_INPUT

// Fix option 1: Add connection
/** @connect Start.apiKey -> fetcher.apiKey */

// Fix option 2: Add default in node type
// @default apiKey "default-key"

// Fix option 3: Add expression in node type
// @expression apiKey process.env.API_KEY

// Fix option 4: Make optional
// @optional apiKey
```

---

## Graph Structure Errors

#### CYCLE_DETECTED

| Field         | Value                                                                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                                                                                                                                                                             |
| Meaning       | The workflow graph contains a cycle (loop) where nodes form a circular dependency.                                                                                                                                                                                                                                                |
| Common Causes | NodeA connects to NodeB, and NodeB connects back to NodeA (directly or through intermediate nodes). Accidentally creating a feedback loop in the connection annotations.                                                                                                                                                          |
| Fix           | Remove one of the connections forming the cycle. If you need iteration, use a scoped node type (like `forEach`) which handles loops internally without graph cycles. Self-loops (a node connecting to itself) are allowed and do not trigger this error. The error message shows the exact cycle path (e.g., `A -> B -> C -> A`). |

> **Beginner explanation:** Circular dependency -- a node eventually connects back to itself through other nodes. The compiler cannot determine execution order when Node A depends on Node B which depends on Node A.
>
> **What to do:** Follow the cycle path shown in the error message and remove one connection to break the loop. If you need iteration, use a `forEach` scoped node instead.

**Example:**

```
// BAD: Cycle
@connect NodeA.onSuccess -> NodeB.execute
@connect NodeB.result -> NodeC.input
@connect NodeC.onSuccess -> NodeA.execute   // CYCLE_DETECTED: NodeA -> NodeB -> NodeC -> NodeA

// GOOD: Use scoped iteration instead
// Define a forEach node type with @scope that processes items in a loop internally
```

---

## Data Flow Warnings

#### UNUSED_NODE (warning)

| Field         | Value                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                         |
| Meaning       | A node instance is defined but has no connections (not referenced by any `@connect`).                           |
| Common Causes | Dead code from a previous iteration. Forgetting to wire up a newly added node.                                  |
| Fix           | Either connect the node into the workflow graph or remove the `@instance` annotation if it is no longer needed. |

> **Beginner explanation:** This node is defined but never used. It exists in the workflow but nothing connects to it and it connects to nothing. It will never execute.
>
> **What to do:** Either add `@connect` annotations to wire this node into the workflow, or remove the `@node` line if the node is no longer needed.

#### NO_START_CONNECTIONS (warning)

| Field         | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                       |
| Meaning       | The workflow has no connections originating from the `Start` node. No node will receive execution triggers or input parameters.               |
| Common Causes | New workflow with no connections added yet. All Start connections were accidentally removed.                                                  |
| Fix           | Add at least one connection from `Start` to a node: `@connect Start.paramName -> NodeA.input` or `@connect Start.onSuccess -> NodeA.execute`. |

> **Beginner explanation:** Your workflow has no connections from Start, so nothing will ever execute. Every workflow needs at least one `@connect Start.* -> ...` line.
>
> **What to do:** Add a `@connect` from Start to your first node. With `@autoConnect`, this is handled automatically.

#### NO_EXIT_CONNECTIONS (warning)

| Field         | Value                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                                                                 |
| Meaning       | The workflow has no connections to the `Exit` node. The workflow will not return any values.                                                                                                            |
| Common Causes | The workflow performs side effects only and intentionally has no return value. Missing connections to `Exit` for the workflow output.                                                                   |
| Fix           | If the workflow should return values, add connections from nodes to `Exit`: `@connect NodeA.result -> Exit.outputName`. If the workflow is intentionally side-effect-only, this warning can be ignored. |

> **Beginner explanation:** Your workflow doesn't return any values. Nothing connects to the Exit node, so the function will return undefined for all outputs.
>
> **What to do:** Add a `@connect` from your last node to `Exit`: `@connect lastNode.result -> Exit.outputName`.

#### INVALID_EXIT_PORT_TYPE

| Field         | Value                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                             |
| Meaning       | The `onSuccess` or `onFailure` exit ports are not STEP type. These are mandatory control flow ports.                                              |
| Common Causes | Manually defining exit ports with incorrect types. Overriding the default exit port configuration.                                                |
| Fix           | Ensure `onSuccess` and `onFailure` exit ports are STEP type. These are auto-generated and should not be manually overridden with different types. |

> **Beginner explanation:** The Exit node's `onSuccess`/`onFailure` ports must be boolean control flow ports. Something is overriding them with a different type.
>
> **What to do:** Don't manually define `onSuccess` or `onFailure` on the Exit node — they're auto-generated. Remove any `@returns` annotation that redefines them.

#### UNUSED_OUTPUT_PORT (warning)

| Field         | Value                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                                                                                                 |
| Meaning       | A node's data output port is never connected to anything. The data produced by this port is discarded.                                                                                                                                  |
| Common Causes | The node produces an output that is not needed by the current workflow. A connection from this port was removed but the port still exists. Control flow ports (`onSuccess`, `onFailure`) and scoped ports are excluded from this check. |
| Fix           | If the output is needed, connect it to a downstream node or to `Exit`. If not needed, the warning can be ignored, but it may indicate an incomplete workflow.                                                                           |

> **Beginner explanation:** A node produces output data that nothing uses. The data is computed but thrown away.
>
> **What to do:** Either connect the output to another node or to `Exit`, or ignore if you don't need that data.

#### UNREACHABLE_EXIT_PORT (warning)

| Field         | Value                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                   |
| Meaning       | An Exit port has no incoming connection, so its return value will always be `undefined`.                                                                  |
| Common Causes | Defining a return type that includes a property but never connecting anything to the corresponding Exit port. A connection to this Exit port was removed. |
| Fix           | Connect a node output to this Exit port, or remove the port from the workflow's return type if it is not needed.                                          |

> **Beginner explanation:** Your workflow's return type includes a property, but nothing connects to the corresponding Exit port. That output will always be `undefined`.
>
> **What to do:** Add a `@connect` to this Exit port, or remove the property from your workflow's return type.

#### MULTIPLE_EXIT_CONNECTIONS (warning)

| Field         | Value                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity      | Warning                                                                                                                                                                                    |
| Meaning       | An Exit port has multiple incoming connections. Only one value will be used at runtime, and which one depends on execution order.                                                          |
| Common Causes | Two nodes on different branches both connect to the same Exit port. Copy-paste error duplicating a connection.                                                                             |
| Fix           | Use separate Exit ports for each branch, or ensure only one connection feeds into each Exit port. If both branches should contribute to the same output, use a merge node before the Exit. |

> **Beginner explanation:** Two different branches of your workflow both send data to the same Exit port. Only one value will actually be returned — whichever runs last.
>
> **What to do:** Use separate Exit ports for each branch (e.g., `Exit.successResult` and `Exit.fallbackResult`), or add a merge node before Exit.

---

## Quick Reference: Error Severity Summary

### Errors (must fix)

| Code                          | Short Description                                   |
| ----------------------------- | --------------------------------------------------- |
| MISSING_WORKFLOW_NAME         | Workflow has no name                                |
| MISSING_FUNCTION_NAME         | Workflow has no function name                       |
| DUPLICATE_NODE_NAME           | Two node types share a function name                |
| RESERVED_NODE_NAME            | Node type uses "Start" or "Exit"                    |
| RESERVED_INSTANCE_ID          | Instance ID is "Start" or "Exit"                    |
| UNKNOWN_NODE_TYPE             | Instance references nonexistent node type           |
| UNKNOWN_SOURCE_NODE           | Connection from nonexistent node                    |
| UNKNOWN_TARGET_NODE           | Connection to nonexistent node                      |
| UNKNOWN_SOURCE_PORT           | Connection from nonexistent output port             |
| UNKNOWN_TARGET_PORT           | Connection to nonexistent input port                |
| STEP_PORT_TYPE_MISMATCH       | STEP port connected to data port or vice versa      |
| TYPE_INCOMPATIBLE             | Type mismatch with @strictTypes enabled             |
| UNDEFINED_NODE                | Connection references node with no instance         |
| MISSING_REQUIRED_INPUT        | Required input has no connection/default/expression |
| INVALID_EXIT_PORT_TYPE        | Exit onSuccess/onFailure is not STEP type           |
| CYCLE_DETECTED                | Graph contains a loop                               |
| MULTIPLE_CONNECTIONS_TO_INPUT | Data input port has more than one source            |

### Warnings (should review)

| Code                      | Short Description                                |
| ------------------------- | ------------------------------------------------ |
| MUTABLE_NODE_TYPE_BINDING | Node type declared with let/var instead of const |
| OBJECT_TYPE_MISMATCH      | OBJECT ports have different structural types     |
| LOSSY_TYPE_COERCION       | Type coercion may lose information               |
| UNUSUAL_TYPE_COERCION     | Type coercion is semantically unusual            |
| TYPE_MISMATCH             | Incompatible types, runtime coercion attempted   |
| UNUSED_NODE               | Node defined but not connected                   |
| NO_START_CONNECTIONS      | No connections from Start                        |
| NO_EXIT_CONNECTIONS       | No connections to Exit                           |
| UNUSED_OUTPUT_PORT        | Output port data is discarded                    |
| UNREACHABLE_EXIT_PORT     | Exit port has no incoming connection             |
| MULTIPLE_EXIT_CONNECTIONS | Exit port has multiple sources                   |
