---
description: Convert existing TypeScript functions to Flow Weaver node types
argument-hint: <file-path> [function-name] [--mode expression|normal]
---

First, use the Skill tool to invoke skills:

1. flow-weaver:flow-weaver-concepts
2. flow-weaver:flow-weaver-export-interface
3. flow-weaver:flow-weaver-node-conversion

Then convert: $ARGUMENTS

## Conversion Workflow

### 1. Read the file

Read the file at the specified path.

### 2. Find target functions

- If a function name is given ($2), locate that specific function
- If no name is given, scan the file for **conversion candidates** and ask the user which to convert

**Conversion candidates** are functions that:

- Are NOT already annotated with `@flowWeaver`
- Are NOT exported workflow functions
- Have a typed signature (parameters and return type)
- Are standalone named functions, arrow functions, or function expressions (not methods or callbacks)

### 3. Analyze the function signature

- Parameter names and types
- Return type (primitive, object, void, `Promise<T>`)
- Whether it's async

### 4. Determine mode

- If `--mode` is specified, use that mode
- Otherwise auto-detect using the heuristics from the node-conversion skill
- Ask the user to confirm if unsure

### 5. Apply the conversion

Use the Edit tool to apply the conversion following the rules in the node-conversion skill:

- **Expression mode**: Add JSDoc block only — do NOT modify the function signature or body
- **Normal mode**: Add JSDoc block AND rewrite the function signature and body

### 6. Validate the result

```bash
flow-weaver validate <file>
```

### 7. Report

- What was converted and which mode was used
- The resulting input/output ports
- Any validation warnings or errors

## Next Steps

After conversion, suggest:

- `/fw-validate` to verify the full file
- `/fw-test` to test the workflow if one exists
- `/fw-build` to build a workflow using the new node type

## Example Usage

```
/fw-convert ./src/utils.ts add
/fw-convert ./src/services/user.ts fetchUser --mode normal
/fw-convert ./src/math.ts
```
