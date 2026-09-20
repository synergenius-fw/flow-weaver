/**
 * Built-in node auto-injection tests.
 *
 * Built-in nodes (delay, waitForEvent, invokeWorkflow, waitForAgent) should be
 * usable in workflows without any import or @flowWeaver nodeType declaration.
 * The parser auto-injects them, and the compiled output inlines the function body
 * with no runtime dependency.
 */

import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import { generateCode } from '../../src/api/generate';

describe('built-in node auto-injection', () => {
  // ── 1. delay: parse without import ──────────────────────────────────
  it('should parse a workflow using delay without any import or annotation', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay
 * @connect Start.execute -> wait.execute
 * @connect wait.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();

    const delayNode = workflow.nodeTypes.find((nt) => nt.functionName === 'delay');
    expect(delayNode).toBeDefined();
    expect(delayNode!.name).toBe('delay');
  });

  // ── 2. invokeWorkflow: parse without import ─────────────────────────
  it('should parse a workflow using invokeWorkflow without any import or annotation', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node sub invokeWorkflow
 * @connect Start.execute -> sub.execute
 * @connect sub.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();

    const node = workflow.nodeTypes.find((nt) => nt.functionName === 'invokeWorkflow');
    expect(node).toBeDefined();
  });

  // ── 3. waitForEvent: parse without import ───────────────────────────
  it('should parse a workflow using waitForEvent without any import or annotation', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node evt waitForEvent
 * @connect Start.execute -> evt.execute
 * @connect evt.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();

    const node = workflow.nodeTypes.find((nt) => nt.functionName === 'waitForEvent');
    expect(node).toBeDefined();
  });

  // ── 4. waitForAgent: parse without import ───────────────────────────
  it('should parse a workflow using waitForAgent without any import or annotation', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node agent waitForAgent
 * @connect Start.execute -> agent.execute
 * @connect agent.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();

    const node = workflow.nodeTypes.find((nt) => nt.functionName === 'waitForAgent');
    expect(node).toBeDefined();
  });

  // ── 5. Port definitions are correct ─────────────────────────────────
  it('should have correct port definitions for delay (duration input, elapsed output)', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay
 * @connect Start.execute -> wait.execute
 * @connect wait.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    const delayNode = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'delay')!;
    expect(delayNode.inputs.duration).toBeDefined();
    expect(delayNode.inputs.duration.dataType).toBe('STRING');
    expect(delayNode.outputs.elapsed).toBeDefined();
    expect(delayNode.outputs.elapsed.dataType).toBe('BOOLEAN');
    expect(delayNode.isAsync).toBe(true);
  });

  // ── 6. User-defined version wins (dedup) ────────────────────────────
  it('should prefer user-defined delay over built-in when both exist', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input customInput - My custom input
 * @output customOutput - My custom output
 */
export async function delay(
  execute: boolean,
  customInput: string
): Promise<{ onSuccess: boolean; onFailure: boolean; customOutput: string }> {
  if (!execute) return { onSuccess: false, onFailure: false, customOutput: '' };
  return { onSuccess: true, onFailure: false, customOutput: customInput };
}

/** @flowWeaver workflow
 * @node wait delay
 * @connect Start.execute -> wait.execute
 * @connect wait.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const delayNode = workflow.nodeTypes.find((nt) => nt.functionName === 'delay')!;
    expect(delayNode).toBeDefined();
    // User's version has customInput, built-in has duration
    expect(delayNode.inputs.customInput).toBeDefined();
    expect(delayNode.inputs.duration).toBeUndefined();
  });

  // ── 7. Compiled output inlines the function body ────────────────────
  it('should inline the delay function body in compiled output', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay
 * @connect Start.execute -> wait.execute
 * @connect wait.elapsed -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const code = generateCode(workflow) as string;

    // The compiled output should contain the delay function inlined
    expect(code).toContain('async function delay');
    // Should contain mock-related code in non-production mode
    expect(code).toContain('__fw_getMockConfig');
    // Should contain setTimeout (from the delay implementation)
    expect(code).toContain('setTimeout');
  });

  // ── 8. Production mode strips mock code ─────────────────────────────
  it('should strip mock-related code in production mode', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay
 * @connect Start.execute -> wait.execute
 * @connect wait.elapsed -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const code = generateCode(workflow, { production: true }) as string;

    // Production output should NOT contain mock helpers
    expect(code).not.toContain('__fw_getMockConfig');
    expect(code).not.toContain('__fw_lookupMock');
    expect(code).not.toContain('__fw_mocks__');
    // But should still contain the delay function itself
    expect(code).toContain('async function delay');
    expect(code).toContain('setTimeout');
  });

  // ── 9. Port definitions for waitForEvent ─────────────────────────────
  it('should have correct port definitions for waitForEvent', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node evt waitForEvent
 * @connect Start.execute -> evt.execute
 * @connect evt.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    const node = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'waitForEvent')!;
    expect(node.inputs.eventName).toBeDefined();
    expect(node.inputs.eventName.dataType).toBe('STRING');
    expect(node.inputs.match).toBeDefined();
    expect(node.inputs.match.optional).toBe(true);
    expect(node.inputs.timeout).toBeDefined();
    expect(node.inputs.timeout.optional).toBe(true);
    expect(node.outputs.eventData).toBeDefined();
    expect(node.outputs.eventData.dataType).toBe('OBJECT');
  });

  // ── 10. Port definitions for invokeWorkflow ─────────────────────────
  it('should have correct port definitions for invokeWorkflow', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node sub invokeWorkflow
 * @connect Start.execute -> sub.execute
 * @connect sub.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    const node = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'invokeWorkflow')!;
    expect(node.inputs.functionId).toBeDefined();
    expect(node.inputs.functionId.dataType).toBe('STRING');
    expect(node.inputs.payload).toBeDefined();
    expect(node.inputs.payload.dataType).toBe('OBJECT');
    expect(node.inputs.timeout).toBeDefined();
    expect(node.inputs.timeout.optional).toBe(true);
    expect(node.outputs.result).toBeDefined();
    expect(node.outputs.result.dataType).toBe('OBJECT');
  });

  // ── 11. Port definitions for waitForAgent ────────────────────────────
  it('should have correct port definitions for waitForAgent', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node agent waitForAgent
 * @connect Start.execute -> agent.execute
 * @connect agent.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    const node = result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'waitForAgent')!;
    expect(node.inputs.agentId).toBeDefined();
    expect(node.inputs.agentId.dataType).toBe('STRING');
    expect(node.inputs.context).toBeDefined();
    expect(node.inputs.context.dataType).toBe('OBJECT');
    expect(node.inputs.prompt).toBeDefined();
    expect(node.inputs.prompt.optional).toBe(true);
    expect(node.outputs.agentResult).toBeDefined();
    expect(node.outputs.agentResult.dataType).toBe('OBJECT');
  });

  // ── 12. Compiled output has no import statement (zero-dependency) ───
  it('should not emit any import statement for built-in nodes in compiled output', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay
 * @connect Start.execute -> wait.execute
 * @connect wait.elapsed -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    const code = generateCode(result.workflows[0]) as string;
    expect(code).not.toContain("from '@synergenius/flow-weaver");
    expect(code).not.toContain('from "flow-weaver');
    expect(code).not.toContain('import { delay');
    expect(code).not.toContain('require(');
  });

  // ── 13. Production mode for invokeWorkflow uses runtime registry ────
  it('should strip mock code and use the explicit runtime workflow registry', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node sub invokeWorkflow
 * @connect Start.execute -> sub.execute
 * @connect sub.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    const code = generateCode(result.workflows[0], {
      production: true,
    }) as string;
    expect(code).not.toContain('__fw_getMockConfig');
    expect(code).not.toContain('__fw_lookupMock');
    expect(code).toContain('runtime?.runtime.services.workflowRegistry');
    expect(code).toContain('async function invokeWorkflow');
  });

  // ── 14. Multiple built-in nodes in one workflow ─────────────────────
  it('should support multiple built-in nodes in a single workflow', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay
 * @node evt waitForEvent
 * @connect Start.execute -> wait.execute
 * @connect wait.onSuccess -> evt.execute
 * @connect evt.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const wf = result.workflows[0];
    expect(wf.nodeTypes.find((nt) => nt.functionName === 'delay')).toBeDefined();
    expect(wf.nodeTypes.find((nt) => nt.functionName === 'waitForEvent')).toBeDefined();

    const code = generateCode(wf) as string;
    expect(code).toContain('async function delay');
    expect(code).toContain('async function waitForEvent');
  });

  // ── 15. Built-in node with @path shorthand ──────────────────────────
  it('should work with @path shorthand', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @path Start -> wait -> Exit
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    expect(result.workflows[0].nodeTypes.find((nt) => nt.functionName === 'delay')).toBeDefined();
  });

  // ── 16. Registry exports exactly 5 built-in node types ──────────────
  it('should export exactly 5 built-in node types from registry', async () => {
    const { BUILT_IN_NODE_TYPES } = await import('../../src/built-in-nodes/generated-registry');
    expect(BUILT_IN_NODE_TYPES).toHaveLength(5);
    const names = BUILT_IN_NODE_TYPES.map((nt) => nt.name).sort();
    expect(names).toEqual(['delay', 'invokeWorkflow', 'sleep', 'waitForAgent', 'waitForEvent']);
    expect(BUILT_IN_NODE_TYPES.find((nt) => nt.name === 'sleep')).toMatchObject({ durableGate: 'timer', receivesRuntime: true });
  });

  // ── 17. Source delay function matches compiled auto-injected delay ──
  it('should produce structurally matching results between source delay and compiled delay', async () => {
    const { delay } = await import('../../src/built-in-nodes/delay');

    // Run the real source function with execute=true
    const sourceResult = await delay(true, '100ms');

    // Verify source function returns expected structure
    expect(sourceResult).toEqual({
      onSuccess: true,
      onFailure: false,
      elapsed: true,
    });

    // Run the real source function with execute=false
    const skipResult = await delay(false, '100ms');
    expect(skipResult).toEqual({
      onSuccess: false,
      onFailure: false,
      elapsed: false,
    });

    // Parse and compile a workflow that uses auto-injected delay
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay
 * @connect Start.execute -> wait.execute
 * @connect wait.onSuccess -> Exit.onSuccess
 * @connect wait.elapsed -> Exit.onSuccess
 */
export async function testWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);
    expect(result.errors).toHaveLength(0);
    const code = generateCode(result.workflows[0]) as string;

    // The compiled output should contain the same delay logic from source
    expect(code).toContain('async function delay');
    expect(code).toContain('__fw_parseDuration');
    expect(code).toContain('setTimeout');
    // The function body fields should match what the source returns
    expect(code).toContain('onSuccess: true, onFailure: false, elapsed: true');
    expect(code).toContain('onSuccess: false, onFailure: false, elapsed: false');
  });

  // ── 18. Generated registry is up to date ──────────────────────────────
  it('should have an up-to-date generated registry', async () => {
    const { execSync } = await import('child_process');
    const path = await import('path');
    const fs = await import('fs');

    const root = path.resolve(__dirname, '..', '..');
    const registryPath = path.join(root, 'src', 'built-in-nodes', 'generated-registry.ts');

    // Read current file
    const before = fs.readFileSync(registryPath, 'utf-8');

    // Run the generator
    execSync('npx tsx scripts/generate-built-in-registry.ts', {
      cwd: root,
      stdio: 'pipe',
    });

    // Read regenerated file
    const after = fs.readFileSync(registryPath, 'utf-8');

    // They should be identical (deterministic output)
    expect(after).toBe(before);
  });

  // ── 19. Only inline used built-in nodes, not all 4 ──────────────────
  it('should only inline the built-in nodes actually used by the workflow', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @path Start -> wait -> Exit
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const code = generateCode(result.workflows[0]) as string;

    // delay should be inlined
    expect(code).toContain('async function delay');
    // Other built-ins should NOT be inlined
    expect(code).not.toContain('async function waitForEvent');
    expect(code).not.toContain('async function invokeWorkflow');
    expect(code).not.toContain('async function waitForAgent');
  });

  // ── 20. No duplicate helper functions in compiled output ───────────
  it('should not duplicate __fw_getMockConfig or __fw_lookupMock helpers', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @path Start -> wait -> Exit
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const code = generateCode(result.workflows[0]) as string;

    // Each helper should appear exactly once
    const getMockCount = (code.match(/function __fw_getMockConfig/g) || []).length;
    const lookupMockCount = (code.match(/function __fw_lookupMock/g) || []).length;
    expect(getMockCount).toBe(1);
    expect(lookupMockCount).toBe(1);
  });

  // ── 21. __fw_parseDuration not renamed to delay ────────────────────
  it('should keep __fw_parseDuration as the helper name, not rename to delay', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @path Start -> wait -> Exit
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const code = generateCode(result.workflows[0]) as string;

    // __fw_parseDuration should exist as a function declaration
    expect(code).toContain('function __fw_parseDuration');
    // There should be exactly ONE "async function delay" (the main function, not the helper)
    const delayFuncCount = (code.match(/function delay/g) || []).length;
    // "async function delay" (1) + "function __fw_parseDuration" (1) = only delay-related functions
    expect(delayFuncCount).toBe(1); // only "async function delay", not "function delay"
  });

  // ── 22. Multiple built-in nodes: helpers deduplicated ──────────────
  it('should deduplicate helpers when multiple built-in nodes are used', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @node evt waitForEvent
 * @connect Start.execute -> wait.execute
 * @connect wait.onSuccess -> evt.execute
 * @connect evt.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const code = generateCode(result.workflows[0]) as string;

    // Both should be inlined
    expect(code).toContain('async function delay');
    expect(code).toContain('async function waitForEvent');
    // Unused ones should not
    expect(code).not.toContain('async function invokeWorkflow');
    expect(code).not.toContain('async function waitForAgent');
    // Helpers should appear exactly once
    const getMockCount = (code.match(/function __fw_getMockConfig/g) || []).length;
    const lookupMockCount = (code.match(/function __fw_lookupMock/g) || []).length;
    expect(getMockCount).toBe(1);
    expect(lookupMockCount).toBe(1);
  });

  // ── 23. Warn when unannotated function shadows a built-in ──────────
  it('should warn when an unannotated function has the same name as a built-in', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
// Unannotated function named "delay" — no @flowWeaver nodeType
function delay(execute: boolean, duration: string): { onSuccess: boolean; onFailure: boolean; elapsed: boolean } {
  return { onSuccess: true, onFailure: false, elapsed: true };
}

/** @flowWeaver workflow
 * @node wait delay
 * @connect Start.execute -> wait.execute
 * @connect wait.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    // Should have a warning about the unannotated delay function
    const shadowWarning = result.warnings.find(
      (w) => w.includes('delay') && w.includes('not annotated') && w.includes('built-in'),
    );
    expect(shadowWarning).toBeDefined();
    expect(shadowWarning).toContain('@flowWeaver nodeType');
  });
});
