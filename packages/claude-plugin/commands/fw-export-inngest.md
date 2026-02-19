---
description: Export a Flow Weaver workflow as an Inngest durable function
argument-hint: <workflow-file> [--durable-steps]
---

First, use the Skill tool to invoke:

1. flow-weaver:flow-weaver-concepts
2. flow-weaver:flow-weaver-export-interface

Then export to Inngest: $ARGUMENTS

## 1. Validate the workflow

```bash
flow-weaver validate <workflow-file>
```

If validation fails, report errors and stop.

## 2. Choose export mode

There are two Inngest export modes:

### Shallow mode (default)
- Wraps the entire compiled workflow in a single `inngest.createFunction()` call
- Simpler output, one retriable unit per workflow invocation
- Good for short-lived workflows where per-node durability is unnecessary

### Deep mode (`--durable-steps`)
- Each workflow node becomes a separate `step.run()` call inside the Inngest function
- Per-node durability: if a node fails, Inngest retries just that node
- Parallel nodes are emitted as `Promise.all([step.run(...), ...])`
- forEach/scoped nodes use indexed step names (`step.run(\`name-${i}\`)`)
- Expression nodes are inlined without step.run() wrappers
- Branching chains are flattened into sequential if/else blocks

Use deep mode when:
- Workflow nodes call external APIs that may fail
- You need per-node retry/checkpoint granularity
- Long-running workflows benefit from resumability

## 3. Export via CLI

### Shallow export (compile target)
```bash
flow-weaver compile <workflow-file> --target inngest
```

### Deep export (compile target with durable steps)
```bash
flow-weaver compile <workflow-file> --target inngest
```
This generates `<workflow-file>.inngest.ts` with per-node `step.run()` calls.

### Bundle export (full deployment package)
```bash
flow-weaver export <workflow-file> --target inngest --output-dir ./deploy/inngest --durable-steps
```

## 4. Verify the generated output

After export, check the generated file:

1. Each non-expression node should have its own `step.run('nodeName', async () => { ... })`
2. Parallel nodes should be wrapped in `Promise.all([...])`
3. Branching nodes should have `if (result.onSuccess) { ... } else { ... }` blocks
4. Expression nodes should be inlined as plain function calls (no step.run)
5. Event trigger should be `{ event: 'workflow/<workflowName>' }`

## 5. Integrate with Inngest

The generated file exports an Inngest function. Register it in your Inngest serve handler:

```typescript
import { serve } from 'inngest/next'; // or your framework
import { inngest } from './client';
import { myWorkflow } from './<workflow>.inngest';

export default serve({ client: inngest, functions: [myWorkflow] });
```

Trigger the workflow by sending an event:

```typescript
await inngest.send({ name: 'workflow/myWorkflow', data: { input: 'value' } });
```
