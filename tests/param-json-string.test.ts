/**
 * Regression test: @param receiving a JSON string value becomes undefined.
 *
 * When a workflow declares `@param taskJson` and the caller passes a JSON
 * string (e.g. '{"title":"Test"}'), the downstream node receives `undefined`
 * instead of the original string.
 *
 * This test verifies the flow-weaver compiler/executor correctly passes JSON
 * string params to downstream nodes. The test reproduces the exact pattern
 * from the Weaver bot workflow (weaverAgent):
 *   Start -> cfg -> detect -> receive -> ...
 * where `taskJson` is a workflow @param that must reach `receive.taskJson`
 * and intermediate nodes (cfg, detect) do not consume it.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { executeWorkflow } from '../src/mcp/workflow-executor';
import type { CompletedExecutionOutcome } from '../src/mcp/workflow-executor';

describe('@param with JSON string value', () => {
  const outputDir = path.join(os.tmpdir(), `fw-param-json-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('should pass a JSON string @param to a downstream node (bot workflow pattern)', async () => {
    // Reproduces the weaverAgent pattern: Start -> cfg -> detect -> receive
    // where only `receive` consumes `taskJson`, and cfg/detect are intermediates.
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input projectDir
 * @output projectDir
 * @output config
 */
function loadConfig(projectDir: string): { projectDir: string; config: string } {
  return { projectDir, config: '{}' };
}

/** @flowWeaver nodeType
 * @expression
 * @input projectDir
 * @input config
 * @output env
 */
function detectProvider(projectDir: string, config: string): { env: string } {
  return { env: JSON.stringify({ projectDir, config }) };
}

/** @flowWeaver nodeType
 * @input env
 * @input [taskJson] - Pre-supplied task (JSON, optional)
 * @output ctx
 * @output onSuccess
 * @output onFailure
 */
function receiveTask(
  execute: boolean,
  env: string,
  taskJson?: string,
): { ctx: string; onSuccess: boolean; onFailure: boolean } {
  const isDefined = taskJson !== undefined && taskJson !== null;
  return {
    ctx: JSON.stringify({ taskJson: taskJson ?? '{}', isDefined }),
    onSuccess: isDefined,
    onFailure: !isDefined,
  };
}

/** @flowWeaver workflow
 * @node cfg loadConfig
 * @node detect detectProvider
 * @node receive receiveTask
 * @path Start -> cfg -> detect -> receive -> Exit
 * @connect receive.ctx -> Exit.ctx
 * @param execute [order:-1] - Execute
 * @param taskJson [order:0] - TaskJson
 * @param projectDir [order:1] - ProjectDir
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 * @returns ctx [order:0] - Context
 */
export function botWorkflow(
  execute: boolean,
  params: { taskJson?: string; projectDir?: string },
): { onSuccess: boolean; onFailure: boolean; ctx: string } {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, 'param-json-bot-workflow.ts');
    fs.writeFileSync(testFile, source);

    const jsonString = '{"title":"Test Task","id":"task-123","instruction":"Fix the bug"}';
    const execResult = await executeWorkflow({
      runId: 'param-json-string',
      filePath: testFile,
      params: {
        taskJson: jsonString,
        projectDir: '/tmp/test-project',
      },
    });

    const result = (execResult as CompletedExecutionOutcome).result as Record<string, unknown>;
    const ctx = JSON.parse(result.ctx as string);

    // BUG: taskJson becomes undefined when read by the downstream node
    expect(ctx.isDefined).toBe(true);
    expect(ctx.taskJson).toBe(jsonString);
    expect(result.onSuccess).toBe(true);
  });

  it('should include Start.taskJson variable set in generated code when @path skips intermediates', async () => {
    // When @path Start -> cfg -> detect -> receive is used, the compiler
    // needs to wire Start.taskJson to receive.taskJson even though cfg and
    // detect don't have taskJson ports. Verify the generated code does this.
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input projectDir
 * @output projectDir
 * @output config
 */
function loadConfig(projectDir: string): { projectDir: string; config: string } {
  return { projectDir, config: '{}' };
}

/** @flowWeaver nodeType
 * @expression
 * @input projectDir
 * @input config
 * @output env
 */
function detectProvider(projectDir: string, config: string): { env: string } {
  return { env: JSON.stringify({ projectDir, config }) };
}

/** @flowWeaver nodeType
 * @input env
 * @input [taskJson] - Pre-supplied task (JSON, optional)
 * @output ctx
 * @output onSuccess
 * @output onFailure
 */
function receiveTask(
  execute: boolean,
  env: string,
  taskJson?: string,
): { ctx: string; onSuccess: boolean; onFailure: boolean } {
  return {
    ctx: JSON.stringify({ taskJson: taskJson ?? '{}' }),
    onSuccess: true,
    onFailure: false,
  };
}

/** @flowWeaver workflow
 * @node cfg loadConfig
 * @node detect detectProvider
 * @node receive receiveTask
 * @path Start -> cfg -> detect -> receive -> Exit
 * @connect receive.ctx -> Exit.ctx
 * @param execute [order:-1] - Execute
 * @param taskJson [order:0] - TaskJson
 * @param projectDir [order:1] - ProjectDir
 * @returns onSuccess [order:-2]
 * @returns onFailure [order:-1]
 * @returns ctx [order:0]
 */
export function botWorkflow(
  execute: boolean,
  params: { taskJson?: string; projectDir?: string },
): { onSuccess: boolean; onFailure: boolean; ctx: string } {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, 'param-json-codegen-path.ts');
    fs.writeFileSync(testFile, source);

    const generatedCode = await globalThis.testHelpers.generateFast(testFile, 'botWorkflow', {
      production: true,
    });

    // The generated code must set Start.taskJson from params.taskJson
    expect(generatedCode).toContain('params.taskJson');

    // The generated code must read Start.taskJson and pass it to receiveTask
    // Look for the pattern: getVariable(...'Start'...'taskJson'...)
    expect(generatedCode).toMatch(/getVariable.*Start.*taskJson|params\.taskJson/);
  });

  it('should survive JSON.stringify round-trip (platform harness pattern)', async () => {
    // The platform executor embeds params into a JS harness via:
    //   const params = ${JSON.stringify(params)};
    //   const result = await fn(true, params);
    // Test this round-trip for JSON string values.
    const params = {
      taskJson: '{"title":"Test Task","instruction":"Fix the bug","options":{"autoApprove":true}}',
      projectDir: '/tmp/test-project',
    };

    // Simulate the harness embedding
    const paramsJson = JSON.stringify(params);
    // The harness writes: const params = {"taskJson":"...","projectDir":"..."};
    // which is valid JavaScript. When executed, params.taskJson should be the
    // original JSON string.
    const recovered = new Function(`return ${paramsJson}`)();

    expect(typeof recovered.taskJson).toBe('string');
    expect(recovered.taskJson).toBe(params.taskJson);

    // Also verify the JSON string can be parsed back
    const parsed = JSON.parse(recovered.taskJson);
    expect(parsed.title).toBe('Test Task');
    expect(parsed.instruction).toBe('Fix the bug');
  });

  it('should pass a JSON string param through compile+execute when param type is inferred as string', async () => {
    // Minimal case: one node, one JSON string param.
    // This verifies the compiler correctly generates `params.taskJson` access.
    const source = `
/** @flowWeaver nodeType
 * @expression
 * @input taskJson
 * @output isDefined
 * @output value
 * @output typeOf
 */
function check(taskJson: string): { isDefined: boolean; value: string; typeOf: string } {
  return {
    isDefined: taskJson !== undefined && taskJson !== null,
    value: String(taskJson),
    typeOf: typeof taskJson,
  };
}

/** @flowWeaver workflow
 * @node c check
 * @connect Start.taskJson -> c.taskJson
 * @connect c.isDefined -> Exit.isDefined
 * @connect c.value -> Exit.value
 * @connect c.typeOf -> Exit.typeOf
 * @connect c.onSuccess -> Exit.onSuccess
 * @connect c.onFailure -> Exit.onFailure
 * @param taskJson
 * @returns isDefined
 * @returns value
 * @returns typeOf
 * @returns onSuccess
 * @returns onFailure
 */
export function minimalJsonParam(
  execute: boolean,
  params: { taskJson: string },
): { isDefined: boolean; value: string; typeOf: string; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, 'param-json-minimal.ts');
    fs.writeFileSync(testFile, source);

    const jsonString = '{"title":"Test"}';
    const execResult = await executeWorkflow({
      runId: 'param-json-string-special',
      filePath: testFile,
      params: { taskJson: jsonString },
    });
    const result = (execResult as CompletedExecutionOutcome).result as Record<string, unknown>;

    // The node must receive the original JSON string (not undefined, not parsed)
    expect(result.isDefined).toBe(true);
    expect(result.typeOf).toBe('string');
    expect(result.value).toBe(jsonString);
    expect(result.onSuccess).toBe(true);
  });
});
