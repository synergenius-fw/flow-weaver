---
description: Validate Flow Weaver workflow health and check for issues
argument-hint: [exportName]
---

First, use the Skill tool to invoke:
1. flow-weaver:flow-weaver-concepts

Then validate workflow:

1. Find the workflow file:
   - Look for files with `@flowWeaver` annotations
   - If $1 is provided, look for a file containing that export name

2. Run validation:
   ```bash
   flow-weaver validate <workflow-file>
   ```

   Options:
   - `--verbose` - Show detailed validation messages
   - `--json` - Output results as JSON (for AI parsing)
   - `-w, --workflow-name <name>` - Validate specific workflow by name

3. Validation output format:
   - `✓` Success messages
   - `✗` Error messages
   - `⚠` Warning messages
   - `ℹ` Info messages

4. Validation checks:
   - **Structural**: Missing workflow name, duplicate node names, reserved names (Start/Exit)
   - **Connections**: Missing nodes/ports, type mismatches
   - **Ports**: Required inputs without connections or defaults
   - **Nodes**: Unused nodes (warnings), Start/Exit validation
   - **Scopes**: Scope name validity, FUNCTION type requirement

5. Report results:
   - **Health Status**: Overall workflow health (valid/invalid)
   - **Errors**: With specific recommendations to fix
   - **Warnings**: Non-blocking but recommended fixes

6. Next steps:
   - If valid: "Workflow ready for testing with /fw-test"
   - If issues: Prioritized list of fixes

Example usage:

- /fw-validate
- /fw-validate my-workflow.ts
- /fw-validate processData
