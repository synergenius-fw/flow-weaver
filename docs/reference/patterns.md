---
name: Flow Weaver Patterns
description: Create and use reusable workflow patterns with IN/OUT boundary ports
keywords: [patterns, reusable, extract, apply, workflow fragments, IN, OUT, template]
---

# Patterns Overview

Patterns are reusable workflow fragments with boundary ports (`IN.`/`OUT.`) instead of Start/Exit nodes. They define:
- Node types (inline or referenced)
- Node instances
- Internal connections
- Boundary ports for external wiring

## CLI Commands

```bash
# List patterns in file or directory
flow-weaver pattern list <path> [--json]

# Apply pattern to workflow
flow-weaver pattern apply <pattern-file> <target-file> [--prefix p] [--name n] [--preview]

# Extract pattern from workflow nodes
flow-weaver pattern extract <source-file> --nodes a,b,c -o <output-file> [--name n] [--preview]
```

## Pattern Annotation

```typescript
/**
 * @flowWeaver pattern
 * @name validateTransform
 * @description Validates input then transforms it
 * @node v inputValidator [position: -90 0]
 * @node t dataTransformer [position: 90 0]
 * @connect IN.data -> v.input
 * @connect v.valid -> t.input
 * @connect t.output -> OUT.result
 * @connect v.invalid -> OUT.error
 * @port IN.data - Raw input data
 * @port OUT.result - Transformed data
 * @port OUT.error - Validation errors
 */
function patternPlaceholder() {}

// Node types are defined inline or imported
function inputValidator(execute: boolean, input: any) { ... }
function dataTransformer(execute: boolean, input: any) { ... }
```

## Key Differences from Workflows

| Workflows | Patterns |
|-----------|----------|
| `Start`/`Exit` nodes | `IN`/`OUT` pseudo-nodes |
| `export function` | Regular function (placeholder) |
| Executable | Template only |
| `@param`/`@returns` | `@port IN.x`/`@port OUT.x` |

## Pattern Apply

When applying a pattern:
1. Node type functions are copied (unless they conflict)
2. `@node` declarations are added (with optional prefix)
3. Internal connections are preserved
4. IN/OUT ports become manual wiring instructions

```bash
# Basic apply
flow-weaver pattern apply pattern.ts workflow.ts

# With prefix to avoid conflicts
flow-weaver pattern apply pattern.ts workflow.ts --prefix vt

# Output shows wiring instructions:
# Applied pattern "validateTransform"
# Added nodes: vt_v, vt_t
#
# Wire these ports manually:
#   IN.data  -> connect to: vt_v.input
#   OUT.result -> connect from: vt_t.output
```

## Pattern Extract

Extract nodes from an existing workflow to create a reusable pattern:

```bash
# Extract specific nodes
flow-weaver pattern extract my-workflow.ts --nodes validator,transformer -o my-pattern.ts

# Preview without writing
flow-weaver pattern extract my-workflow.ts --nodes a,b -o output.ts --preview
```

The extractor:
1. Copies specified node instances
2. Preserves connections between extracted nodes
3. Converts boundary connections to IN/OUT ports
4. Includes referenced node type functions

## Common Patterns

### Validate-Transform
```typescript
@node v validator
@node t transformer
@connect IN.data -> v.input
@connect v.valid -> t.input
@connect t.output -> OUT.result
@connect v.invalid -> OUT.error
```

### Retry with Backoff
```typescript
@node attempt operation
@node retry retryHandler
@connect IN.data -> attempt.input
@connect attempt.onSuccess -> OUT.result
@connect attempt.onFailure -> retry.trigger
@connect retry.retry -> attempt.execute
```

### Fan-Out/Fan-In
```typescript
@node splitter dataSplitter
@node procA processorA
@node procB processorB
@node merger dataMerger
@connect IN.data -> splitter.input
@connect splitter.partA -> procA.input
@connect splitter.partB -> procB.input
@connect procA.result -> merger.inputA
@connect procB.result -> merger.inputB
@connect merger.result -> OUT.combined
```

## Conflict Resolution

When a pattern node type already exists in target:
- Warning is displayed
- Existing node type is preserved
- Use `--prefix` to avoid ID conflicts
- Manually resolve or use separate file for conflicts

## Best Practices

1. **Name patterns descriptively** - The `@name` should describe what the pattern does
2. **Document ports** - Use `@port` descriptions for clarity
3. **Use relative positions** - Patterns maintain relative positions when applied
4. **Keep patterns focused** - One pattern = one reusable concept
5. **Include node types inline** - Makes patterns self-contained

## Related Topics

- `concepts` - Core workflow concepts
- `export-interface` - Workflow ports and interfaces
- `iterative-development` - Building workflows step-by-step
