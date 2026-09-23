/**
 * End-to-end tests for built-in node auto-injection via generateInPlace.
 *
 * Tests the full compile pipeline: parse -> validate -> generateInPlace.
 * Verifies built-in functions are inserted, production mode works,
 * re-runs are idempotent, and unused built-ins are not injected.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AnnotationParser } from '../../../src/parser/annotation-parser';
import { generateInPlace } from '../../../src/api/generate-in-place';
import { parseWorkflow } from '../../../src/api/parse';

// Helper: parse source string and generate in-place
function compileInPlace(source: string, options: { production?: boolean } = {}) {
  const parser = new AnnotationParser();
  const result = parser.parseFromString(source, 'test.ts');
  expect(result.errors).toHaveLength(0);
  const workflow = result.workflows[0];
  expect(workflow).toBeDefined();

  const generated = generateInPlace(source, workflow, {
    production: options.production ?? false,
    allWorkflows: result.workflows,
  });
  return { code: generated.code, hasChanges: generated.hasChanges, workflow, result };
}

describe('generateInPlace built-in node insertion (step 1.2)', () => {
  it('inserts delay function before workflow when auto-injected', () => {
    const source = `
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @path Start -> wait -> Exit
 */
export async function myWorkflow(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  throw new Error('Not implemented');
  // @flow-weaver-body-end
}
`;

    const { code, hasChanges } = compileInPlace(source);
    expect(hasChanges).toBe(true);

    // delay function should be inserted before the workflow
    expect(code).toContain('async function delay');
    expect(code).toContain('__fw_parseDuration');
    // Mock helpers should be present in dev mode
    expect(code).toContain('__fw_getMockConfig');
    // JSDoc annotation should be added for re-parse
    expect(code).toContain('@flowWeaver nodeType');
    expect(code).toContain('@input duration');
    expect(code).toContain('@output elapsed');

    // delay function should appear BEFORE the workflow function
    const delayIdx = code.indexOf('async function delay');
    const workflowIdx = code.indexOf('export async function myWorkflow');
    expect(delayIdx).toBeLessThan(workflowIdx);
  });

  it('inserts production function bodies when production=true', () => {
    const source = `
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @path Start -> wait -> Exit
 */
export async function myWorkflow(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  throw new Error('Not implemented');
  // @flow-weaver-body-end
}
`;

    const { code } = compileInPlace(source, { production: true });

    // Production: should have the function but NO mock helpers
    expect(code).toContain('async function delay');
    expect(code).toContain('__fw_parseDuration');
    expect(code).not.toContain('__fw_getMockConfig');
    expect(code).not.toContain('__fw_lookupMock');
    expect(code).not.toContain('__fw_mocks__');
  });

  it('does NOT insert built-in functions when not referenced', () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node n myNode
 * @path Start -> n -> Exit
 */
export async function myWorkflow(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  throw new Error('Not implemented');
  // @flow-weaver-body-end
}
`;

    const { code } = compileInPlace(source);
    // None of the built-in functions should be injected
    expect(code).not.toContain('async function delay');
    expect(code).not.toContain('async function waitForEvent');
    expect(code).not.toContain('async function invokeWorkflow');
    expect(code).not.toContain('async function waitForAgent');
  });

  it('does not duplicate built-in functions on re-run', () => {
    const source = `
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @path Start -> wait -> Exit
 */
export async function myWorkflow(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  throw new Error('Not implemented');
  // @flow-weaver-body-end
}
`;

    // First compile
    const { code: first } = compileInPlace(source);
    expect(first).toContain('async function delay');

    // Second compile (re-parse the output)
    const parser2 = new AnnotationParser();
    const result2 = parser2.parseFromString(first, 'test.ts');
    expect(result2.errors).toHaveLength(0);
    const workflow2 = result2.workflows[0];

    const second = generateInPlace(first, workflow2, {
      production: false,
      allWorkflows: result2.workflows,
    });

    // Count delay function declarations - should be exactly 1
    const delayCount = (second.code.match(/async function delay\b/g) || []).length;
    expect(delayCount).toBe(1);

    // Count __fw_parseDuration - should be exactly 1
    const helperCount = (second.code.match(/function __fw_parseDuration\b/g) || []).length;
    expect(helperCount).toBe(1);
  });

  it('deduplicates helpers when multiple built-ins are used', () => {
    const source = `
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'1s'"]
 * @node evt waitForEvent
 * @node sub invokeWorkflow
 * @node agent waitForAgent
 * @connect Start.execute -> wait.execute
 * @connect wait.onSuccess -> evt.execute
 * @connect evt.onSuccess -> sub.execute
 * @connect sub.onSuccess -> agent.execute
 * @connect agent.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  throw new Error('Not implemented');
  // @flow-weaver-body-end
}
`;

    const { code } = compileInPlace(source);

    // All 4 built-in functions should be present
    expect(code).toContain('async function delay');
    expect(code).toContain('async function waitForEvent');
    expect(code).toContain('async function invokeWorkflow');
    expect(code).toContain('async function waitForAgent');

    // Mock helpers should appear exactly ONCE (deduplicated)
    const getMockCount = (code.match(/function __fw_getMockConfig/g) || []).length;
    const lookupMockCount = (code.match(/function __fw_lookupMock/g) || []).length;
    expect(getMockCount).toBe(1);
    expect(lookupMockCount).toBe(1);
  });

  it('generates valid executable code for delay workflow', () => {
    const source = `
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'100ms'"]
 * @path Start -> wait -> Exit
 */
export async function testExec(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  throw new Error('Not implemented');
  // @flow-weaver-body-end
}
`;

    const { code } = compileInPlace(source, { production: true });

    // The generated code should be valid: has runtime markers, body markers, and delay function
    expect(code).toContain('// @flow-weaver-runtime-start');
    expect(code).toContain('// @flow-weaver-runtime-end');
    expect(code).toContain('// @flow-weaver-body-start');
    expect(code).toContain('// @flow-weaver-body-end');
    expect(code).toContain('async function delay');
    expect(code).toContain('const waitResult = await delay(');
  });

  it('parser does not inject built-ins into nodeTypes when no workflow references them', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}
`);

    // Only myNode should be in nodeTypes, no built-ins
    expect(result.nodeTypes).toHaveLength(1);
    expect(result.nodeTypes[0].name).toBe('myNode');
  });

  it('parser injects only the specific built-in that is referenced', () => {
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
    const wf = result.workflows[0];
    // Only waitForEvent should be in workflow nodeTypes (not delay, invokeWorkflow, waitForAgent)
    const builtInNames = wf.nodeTypes
      .filter(nt => ['delay', 'waitForEvent', 'invokeWorkflow', 'waitForAgent'].includes(nt.name))
      .map(nt => nt.name);
    expect(builtInNames).toEqual(['waitForEvent']);
  });
});

describe('built-in helpers across the workflows of one file', () => {
  const tmpDir = path.join(os.tmpdir(), `fw-builtin-helpers-${process.pid}`);
  afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('are emitted once when two workflows use different built-ins and are compiled one after the other', async () => {
    const { compileWorkflow } = await import('../../../src/api/compile');
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, 'two.ts');
    fs.writeFileSync(file, `
/**
 * @flowWeaver nodeType
 * @expression
 * @input wokeAt - When
 * @output note - A line
 */
function report(wokeAt: string): string { return wokeAt; }

/**
 * @flowWeaver workflow
 * @param label - A label
 * @returns note - A line
 * @node nap sleep [expr: duration="'1m'"]
 * @node say report
 * @path Start -> nap -> say -> Exit
 * @connect nap.wokeAt -> say.wokeAt
 */
export async function sleeper(execute: boolean, params: { label: string }): Promise<{ onSuccess: boolean; onFailure: boolean; note: string }> {
  throw new Error('generated body was not installed');
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input eventData - What arrived
 * @output got - A line
 */
function arrived(eventData: object): string { return JSON.stringify(eventData); }

/**
 * @flowWeaver workflow
 * @param label - A label
 * @returns got - A line
 * @node wait waitForEvent [expr: eventName="'app/thing'"]
 * @node ok arrived
 * @path Start -> wait -> ok -> Exit
 */
export async function waiter(execute: boolean, params: { label: string }): Promise<{ onSuccess: boolean; onFailure: boolean; got: string }> {
  throw new Error('generated body was not installed');
}
`);
    // The executor compiles a file workflow by workflow; so does fw compile on a multi-workflow file.
    for (const workflowName of ['sleeper', 'waiter']) {
      await compileWorkflow(file, { write: true, inPlace: true, parse: { workflowName } });
    }
    const code = fs.readFileSync(file, 'utf8');
    expect(code.match(/function __fw_getMockConfig\(/g)).toHaveLength(1);
    expect(code.match(/function __fw_lookupMock/g)).toHaveLength(1);
    expect(code).toContain('async function sleep(');
    expect(code).toContain('async function waitForEvent(');
    // Compiling again adds nothing, and the graph identity each gated body
    // declares is the same number whether its built-ins came from the
    // registry or from the file's own inlined copies.
    for (const workflowName of ['sleeper', 'waiter']) {
      await compileWorkflow(file, { write: true, inPlace: true, parse: { workflowName } });
    }
    const again = fs.readFileSync(file, 'utf8');
    expect(again.match(/function __fw_getMockConfig\(/g)).toHaveLength(1);
    expect(again.match(/ctx\.bindWorkflow\([^)]*\)/g)).toEqual(code.match(/ctx\.bindWorkflow\([^)]*\)/g));
  });
});

describe('parseWorkflow forwards parser errors', () => {
  const tmpDir = path.join(os.tmpdir(), `fw-parse-errors-${process.pid}`);

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeWorkflow(name: string, content: string): string {
    fs.mkdirSync(tmpDir, { recursive: true });
    const p = path.join(tmpDir, `${name}.ts`);
    fs.writeFileSync(p, content);
    return p;
  }

  it('forwards @path errors for non-existent nodes', async () => {
    const filePath = writeWorkflow('ghost-path', `
/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}

/**
 * @flowWeaver workflow
 * @node n myNode
 * @path Start -> n -> ghost -> Exit
 */
export async function ghostWorkflow(
  execute: boolean,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`);

    const result = await parseWorkflow(filePath);
    expect(result.errors.length).toBeGreaterThan(0);
    const ghostError = result.errors.find(e => e.includes('ghost'));
    expect(ghostError).toBeDefined();
    expect(ghostError).toContain('not found');
  });
});
