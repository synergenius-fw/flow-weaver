---
description: Build a complete Flow Weaver workflow following iterative development
argument-hint: <workflow-description>
---

First, use the Skill tool to invoke skills:

1. flow-weaver:flow-weaver-concepts
2. flow-weaver:flow-weaver-export-interface
3. flow-weaver:flow-weaver-iterative-development

Then build: $ARGUMENTS

Follow the iterative development process:

## 1. Create Workflow File

Create a workflow file (any TypeScript file works):

```typescript
/**
 * @flowWeaver workflow
 * @param input - Description
 * @returns result - Description
 */
export function workflowName(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; result: any } {
  return { onSuccess: true, onFailure: false, result: null };
}
```

## 2. Define Node Types

Add `@flowWeaver nodeType` functions for each processing step:

```typescript
/**
 * @flowWeaver nodeType
 * @label Transform Data
 * @input value - Value to transform
 * @output result - Transformed value
 */
function transformData(
  execute: boolean,
  value: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  // transformation logic
  return { onSuccess: true, onFailure: false, result: value };
}
```

## 3. Add Nodes to Workflow

Use `@node` annotations to instantiate nodes:

```typescript
/**
 * @flowWeaver workflow
 * @node transformer transformData
 * @connect Start.input -> transformer.value
 * @connect transformer.result -> Exit.result
 * @position transformer 0 0
 */
```

## 4. Validate After Each Change

```bash
flow-weaver validate <file>
```

## 5. Test the Workflow

```bash
flow-weaver compile <file>
# Then run /fw-test <exportName>
```

## Key Syntax Reference

- **@node**: `@node instanceId nodeTypeName`
- **@connect**: `@connect Node.port -> Node.port`
- **@position**: `@position nodeId x y` (pixels)
- **@param**: `@param name - Description` (workflow inputs)
- **@returns**: `@returns name - Description` (workflow outputs)

Example usage:

- /fw-build Create a workflow that validates user input and transforms data
- /fw-build Build a data processing pipeline with filtering and mapping
