---
description: Execute and test a Flow Weaver workflow export
argument-hint: <exportName> <params-json>
---

First, use the Skill tool to invoke:

1. flow-weaver:flow-weaver-concepts

Then test export:

1. Parse the arguments:
   - Export name: $1 (required - name of the export to test)
   - Parameters: $2 (optional - JSON string of input parameters)

2. Find the workflow file:
   - Look for files with `@flowWeaver` annotations
   - Identify the file containing export `$1`

3. Validate first:

   ```bash
   flow-weaver validate <workflow-file>
   ```

   If validation fails, report errors and stop.

4. Compile the workflow:

   ```bash
   flow-weaver compile <workflow-file>
   ```

   This compiles the workflow in-place, modifying the source file directly.

5. Create a test runner and execute:

   ```typescript
   // test-runner.ts
   import { $1 } from './<basename>';

   const params = $2 ? JSON.parse('$2') : {};
   const result = await $1(true, params);
   console.log('Result:', JSON.stringify(result, null, 2));
   ```

   Run with:

   ```bash
   npx tsx test-runner.ts
   ```

6. Report results:
   - Execution success/failure
   - Return value from the workflow
   - Any runtime errors

7. For debugging, check:
   - The compiled source file (compilation modifies the file in-place)
   - The original annotations above the function

Example usage:

- /fw-test default
- /fw-test processData '{"data": [1, 2, 3]}'
- /fw-test calculateSum '{"x": 5, "y": 3}'
