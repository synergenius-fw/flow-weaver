---
name: Flow Weaver Error Codes
description: Complete reference of validation error and warning codes with causes and fixes
keywords: [errors, warnings, validation, error codes, MISSING_REQUIRED_INPUT, UNKNOWN_NODE_TYPE, STEP_PORT_TYPE_MISMATCH, CYCLE_DETECTED, TYPE_MISMATCH, AGENT_LLM_MISSING_ERROR_HANDLER, INFERRED_NODE_TYPE, ANNOTATION_SIGNATURE_MISMATCH]
---

# Error Code Reference

Every code the validator can emit is listed below. Each entry includes the severity (error or warning), what the code means, common causes, and how to fix it.

## Quick Fixes -- Top 5 Most Common Errors

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
// BAD -- typo
@connect nodeA.reuslt -> nodeB.input

// GOOD
@connect nodeA.result -> nodeB.input
```

### 4. STEP_PORT_TYPE_MISMATCH

**You'll see this when:** You wire a control flow port (execute/onSuccess/onFailure) to a data port or vice versa.

```typescript
// BAD -- onSuccess is control flow, inputData is data
@connect nodeA.onSuccess -> nodeB.inputData

// GOOD -- control flow to control flow, data to data
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

#### INFERRED_NODE_TYPE (warning)

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                       |
| Meaning       | A node type was auto-inferred from the function signature in expression mode without an explicit `@flowWeaver nodeType` annotation.                           |
| Common Causes | A function is used as a node type but lacks the `@flowWeaver nodeType` JSDoc annotation. The parser inferred port types automatically from the signature.     |
| Fix           | Add `@flowWeaver nodeType` (with `@expression` if appropriate) above the function to gain explicit control over ports, names, and metadata.                   |

> **Beginner explanation:** The compiler guessed the node type definition from the function signature. It works, but you lose explicit control over port names, types, and ordering.
>
> **What to do:** Add a `/** @flowWeaver nodeType @expression */` JSDoc block above the function.

#### ANNOTATION_SIGNATURE_MISMATCH (warning)

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                       |
| Meaning       | A port is optional in the TypeScript function signature (parameter with `?`) but required in the `@input`/`@output` annotation.                               |
| Common Causes | Using `@input name` (required) for a parameter declared as `name?: string` in the function signature. Mismatch between signature and annotation optionality.  |
| Fix           | Use `@input [name]` (with brackets) to mark the port as optional in the annotation, matching the TypeScript signature.                                        |

> **Beginner explanation:** The annotation says the port is required, but the TypeScript parameter is optional. These should agree.
>
> **What to do:** Change `@input name` to `@input [name]` to mark it as optional, matching the `?` in the function signature.

#### ANNOTATION_SIGNATURE_TYPE_MISMATCH (warning)

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                       |
| Meaning       | A port's type in the `@input`/`@output` annotation differs from its type in the function signature.                                                          |
| Common Causes | Declaring `@input name [type: STRING]` but the function parameter is `name: number`. The annotation type and TypeScript type disagree.                        |
| Fix           | Update the annotation type to match the function signature, or change the signature type. Both should agree.                                                  |

> **Beginner explanation:** The type you wrote in the annotation doesn't match the TypeScript type. Pick one and update the other.
>
> **What to do:** Make the `[type: ...]` in the annotation match the parameter type in the function signature.

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

> **Beginner explanation:** In `@node myId myType`, the `myId` cannot be `Start` or `Exit` -- those are reserved for the built-in entry and exit points.
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

#### LOSSY_TYPE_COERCION (warning)

| Field         | Value                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning (Error with `@strictTypes`)                                                                                                                                                                                 |
| Meaning       | The connection requires a type coercion that may lose information.                                                                                                                                                  |
| Common Causes | STRING to NUMBER (may produce NaN). STRING to BOOLEAN (JavaScript truthy/falsy). OBJECT to STRING (uses JSON.stringify). ARRAY to STRING (uses JSON.stringify).                                                     |
| Fix           | Add an explicit conversion node between the source and target if precision matters. Or accept the coercion if the behavior is intentional. With `@strictTypes` enabled, this becomes an error and must be resolved. |

#### UNUSUAL_TYPE_COERCION (warning)

| Field         | Value                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity      | Warning (Error with `@strictTypes`)                                                                                                                                                  |
| Meaning       | The connection requires a type coercion that is technically valid but semantically unusual.                                                                                          |
| Common Causes | NUMBER to BOOLEAN (0 = false, non-zero = true). BOOLEAN to NUMBER (false = 0, true = 1). STRING to OBJECT (requires valid JSON). STRING to ARRAY (requires valid JSON array).        |
| Fix           | Consider whether the coercion is intentional. If so, the warning can be acknowledged. For explicit conversion, insert a conversion node. With `@strictTypes`, this becomes an error. |

#### TYPE_MISMATCH (warning)

| Field         | Value                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning (Error with `@strictTypes`)                                                                                                                                    |
| Meaning       | The source and target port types are incompatible, and the connection does not fall into any known coercion category. Runtime coercion will be attempted but may fail. |
| Common Causes | Connecting fundamentally incompatible types such as ARRAY to NUMBER, OBJECT to BOOLEAN, or FUNCTION to STRING.                                                         |
| Fix           | Review whether the connection is correct. In most cases this indicates a wiring mistake. Insert a conversion or transformation node if the connection is intentional.  |

#### TYPE_INCOMPATIBLE (with @strictTypes)

| Field         | Value                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                           |
| Meaning       | A type coercion or mismatch that would normally be a warning is promoted to an error because the workflow uses `@strictTypes`.                                                  |
| Common Causes | Any of the above type warnings (LOSSY_TYPE_COERCION, UNUSUAL_TYPE_COERCION, TYPE_MISMATCH) occurring in a workflow annotated with `@strictTypes`.                               |
| Fix           | Either resolve the type mismatch by changing the connection or inserting a conversion node, or remove `@strictTypes` from the workflow if you want to allow implicit coercions. |

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

#### MISSING_REQUIRED_INPUT

| Field         | Value                                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                                                                                                                                   |
| Meaning       | A required input port on a node instance has no connection, no default value, no expression, and is not optional. This will cause a runtime error.                                                                                                                      |
| Common Causes | Adding a new required input to a node type without connecting it in the workflow. Removing a connection without adding a default or marking the port optional.                                                                                                          |
| Fix           | Either: (1) connect a source to the missing input port, (2) add a `@default` value to the port in the node type definition, (3) add an `@expression` to compute the value, (4) mark the port as `@optional`, or (5) add an instance-level expression via `@portConfig`. |

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

#### NO_START_CONNECTIONS (warning)

| Field         | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                       |
| Meaning       | The workflow has no connections originating from the `Start` node. No node will receive execution triggers or input parameters.               |
| Common Causes | New workflow with no connections added yet. All Start connections were accidentally removed.                                                  |
| Fix           | Add at least one connection from `Start` to a node: `@connect Start.paramName -> NodeA.input` or `@connect Start.onSuccess -> NodeA.execute`. |

#### NO_EXIT_CONNECTIONS (warning)

| Field         | Value                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                                                                 |
| Meaning       | The workflow has no connections to the `Exit` node. The workflow will not return any values.                                                                                                            |
| Common Causes | The workflow performs side effects only and intentionally has no return value. Missing connections to `Exit` for the workflow output.                                                                   |
| Fix           | If the workflow should return values, add connections from nodes to `Exit`: `@connect NodeA.result -> Exit.outputName`. If the workflow is intentionally side-effect-only, this warning can be ignored. |

#### INVALID_EXIT_PORT_TYPE

| Field         | Value                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                             |
| Meaning       | The `onSuccess` or `onFailure` exit ports are not STEP type. These are mandatory control flow ports.                                              |
| Common Causes | Manually defining exit ports with incorrect types. Overriding the default exit port configuration.                                                |
| Fix           | Ensure `onSuccess` and `onFailure` exit ports are STEP type. These are auto-generated and should not be manually overridden with different types. |

#### UNUSED_OUTPUT_PORT (warning)

| Field         | Value                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                                                                                                 |
| Meaning       | A node's data output port is never connected to anything. The data produced by this port is discarded.                                                                                                                                  |
| Common Causes | The node produces an output that is not needed by the current workflow. A connection from this port was removed but the port still exists. Control flow ports (`onSuccess`, `onFailure`) and scoped ports are excluded from this check. |
| Fix           | If the output is needed, connect it to a downstream node or to `Exit`. If not needed, the warning can be ignored, but it may indicate an incomplete workflow.                                                                           |

#### UNREACHABLE_EXIT_PORT (warning)

| Field         | Value                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                   |
| Meaning       | An Exit port has no incoming connection, so its return value will always be `undefined`.                                                                  |
| Common Causes | Defining a return type that includes a property but never connecting anything to the corresponding Exit port. A connection to this Exit port was removed. |
| Fix           | Connect a node output to this Exit port, or remove the port from the workflow's return type if it is not needed.                                          |

#### MULTIPLE_EXIT_CONNECTIONS (warning)

| Field         | Value                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity      | Warning                                                                                                                                                                                    |
| Meaning       | An Exit port has multiple incoming connections. Only one value will be used at runtime, and which one depends on execution order.                                                          |
| Common Causes | Two nodes on different branches both connect to the same Exit port. Copy-paste error duplicating a connection.                                                                             |
| Fix           | Use separate Exit ports for each branch, or ensure only one connection feeds into each Exit port. If both branches should contribute to the same output, use a merge node before the Exit. |

---

## Agent Workflow Rules

These codes apply to AI agent workflows that use LLM, tool-executor, and memory nodes.

#### AGENT_LLM_MISSING_ERROR_HANDLER

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Error                                                                                                                                                         |
| Meaning       | An LLM node's `onFailure` port is unconnected. LLM calls can fail due to rate limits, timeouts, or model errors, and failures will be silently swallowed.    |
| Common Causes | Adding an LLM node without wiring its `onFailure` port to any handler or Exit.                                                                               |
| Fix           | Connect `llmNode.onFailure` to a retry node, fallback handler, or `Exit.onFailure` to handle LLM errors gracefully.                                         |

> **Beginner explanation:** LLM API calls can fail for many reasons (rate limits, network errors, etc.). Without an error handler, these failures are silently ignored.
>
> **What to do:** Wire the LLM node's `onFailure` port to either a retry node, a fallback, or `Exit.onFailure`.

#### AGENT_UNGUARDED_TOOL_EXECUTOR (warning)

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                       |
| Meaning       | A tool-executor node has no human-approval gate upstream. If this node performs destructive actions, it could be unsafe.                                       |
| Common Causes | Wiring an LLM directly to a tool executor without a human-approval node in between.                                                                           |
| Fix           | Add a human-approval node before the tool executor to gate destructive tool calls. If the tool is read-only, this warning can be safely ignored.              |

> **Beginner explanation:** A tool executor can run destructive actions (writes, deletes, sends). Without human approval, the LLM can trigger these autonomously.
>
> **What to do:** Add a human-approval node before the tool executor, or ignore this warning if the tool is read-only.

#### AGENT_MISSING_MEMORY_IN_LOOP (warning)

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                       |
| Meaning       | A scoped loop contains an LLM node but no conversation memory node. The LLM will lose context between iterations.                                            |
| Common Causes | Creating an agent loop with an LLM node but forgetting to add a conversation-memory node inside the scope.                                                    |
| Fix           | Add a conversation-memory node inside the loop to persist messages between iterations.                                                                        |

> **Beginner explanation:** Without memory, the LLM inside the loop starts fresh every iteration and "forgets" previous context.
>
> **What to do:** Add a conversation-memory node inside the loop scope so the LLM retains history across iterations.

#### AGENT_LLM_NO_FALLBACK (warning)

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                       |
| Meaning       | An LLM node routes failures directly to Exit without any retry or fallback logic. Any LLM error immediately aborts the entire workflow.                       |
| Common Causes | Wiring `llmNode.onFailure -> Exit.onFailure` without a retry or fallback node in between.                                                                    |
| Fix           | Add a retry node or fallback LLM provider between the LLM's `onFailure` and Exit to improve resilience against transient failures.                           |

> **Beginner explanation:** If the LLM fails and goes straight to Exit, the entire workflow stops. Transient errors (rate limits, timeouts) could be retried.
>
> **What to do:** Add a retry node or alternative LLM provider between the failure port and Exit.

#### AGENT_TOOL_NO_OUTPUT_HANDLING (warning)

| Field         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity      | Warning                                                                                                                                                       |
| Meaning       | A tool-executor node's data output ports are all unconnected. Tool results are being computed but discarded.                                                  |
| Common Causes | Adding a tool executor and wiring its control flow (onSuccess) but forgetting to connect its data output (e.g., result, resultMessage) to downstream nodes.   |
| Fix           | Connect the data output ports to downstream nodes, or remove the tool executor if its results aren't needed.                                                  |

> **Beginner explanation:** The tool runs and produces results, but nothing uses them. This is likely a wiring mistake.
>
> **What to do:** Connect the tool executor's data output ports (e.g., `result`) to downstream nodes that consume the data.

---

## Quick Reference: Error Severity Summary

### Errors (must fix)

<!-- AUTO:START error_summary_table -->
| Code | Short Description |
| --- | --- |
| MISSING_WORKFLOW_NAME | Workflow has no name |
| MISSING_FUNCTION_NAME | Workflow has no function name |
| DUPLICATE_NODE_NAME | Two node types share a function name |
| RESERVED_NODE_NAME | Node type uses "Start" or "Exit" |
| RESERVED_INSTANCE_ID | Instance ID is "Start" or "Exit" |
| UNKNOWN_SOURCE_NODE | Connection from nonexistent node |
| UNKNOWN_TARGET_NODE | Connection to nonexistent node |
| UNKNOWN_SOURCE_PORT | Connection from nonexistent output port |
| UNKNOWN_TARGET_PORT | Connection to nonexistent input port |
| MULTIPLE_CONNECTIONS_TO_INPUT | Data input port has more than one source |
| STEP_PORT_TYPE_MISMATCH | STEP port connected to data port or vice versa |
| TYPE_INCOMPATIBLE | Type mismatch with @strictTypes enabled |
| UNKNOWN_NODE_TYPE | Instance references nonexistent node type |
| UNDEFINED_NODE | Connection references node with no instance |
| MISSING_REQUIRED_INPUT | Required input has no connection/default/expression |
| CYCLE_DETECTED | Graph contains a loop |
| INVALID_EXIT_PORT_TYPE | Exit onSuccess/onFailure is not STEP type |
| SCOPE_MISSING_REQUIRED_INPUT | Required input port on a scoped child has no connection |
| SCOPE_WRONG_SCOPE_NAME | Connection uses a scope name not defined on the node |
| SCOPE_CONNECTION_OUTSIDE | Scoped connection references a node outside the scope |
| SCOPE_UNKNOWN_PORT | Connection references a port that is not a scoped port of the specified scope |
| AGENT_LLM_MISSING_ERROR_HANDLER | LLM node's onFailure port is unconnected |
<!-- AUTO:END error_summary_table -->

### Warnings (should review)

<!-- AUTO:START warning_summary_table -->
| Code | Short Description |
| --- | --- |
| MUTABLE_NODE_TYPE_BINDING | Node type declared with let/var instead of const |
| INFERRED_NODE_TYPE | Node type auto-inferred without explicit annotation |
| ANNOTATION_SIGNATURE_MISMATCH | Port optionality differs between annotation and sig |
| ANNOTATION_SIGNATURE_TYPE_MISMATCH | Port type differs between annotation and signature |
| OBJECT_TYPE_MISMATCH | OBJECT ports have different structural types |
| LOSSY_TYPE_COERCION | Type coercion may lose information |
| UNUSUAL_TYPE_COERCION | Type coercion is semantically unusual |
| TYPE_MISMATCH | Incompatible types, runtime coercion attempted |
| UNUSED_NODE | Node defined but not connected |
| NO_START_CONNECTIONS | No connections from Start |
| NO_EXIT_CONNECTIONS | No connections to Exit |
| UNUSED_OUTPUT_PORT | Output port data is discarded |
| UNREACHABLE_EXIT_PORT | Exit port has no incoming connection |
| MULTIPLE_EXIT_CONNECTIONS | Exit port has multiple sources |
| SCOPE_UNUSED_INPUT | Scoped input port has no connection from inner nodes |
| SCOPE_PORT_TYPE_MISMATCH | Type mismatch between scoped port and connected child port |
| SCOPE_ORPHANED_CHILD | Child node in scope has no scoped connections to parent |
| AGENT_UNGUARDED_TOOL_EXECUTOR | Tool executor has no upstream human-approval gate |
| AGENT_MISSING_MEMORY_IN_LOOP | Loop has LLM but no conversation memory node |
| AGENT_LLM_NO_FALLBACK | LLM onFailure routes directly to Exit |
| AGENT_TOOL_NO_OUTPUT_HANDLING | Tool executor data outputs all unconnected |
<!-- AUTO:END warning_summary_table -->
