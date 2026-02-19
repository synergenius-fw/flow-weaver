/**
 * Integration tests for workflow-executor.ts
 * Verifies F3 fixes: trace capture and result field propagation
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

describe('Workflow Executor Integration', () => {
  const outputDir = path.join(os.tmpdir(), `fw-executor-test-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  const createSimpleWorkflow = () => `
/** @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } { return { result: value * 2 }; }

/** @flowWeaver workflow
 * @node d doubleIt
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param value
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function simpleWorkflow(execute: boolean, params: { value: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;

  it('should return all result fields (F3 result fix)', async () => {
    const testFile = path.join(outputDir, 'executor-result.ts');
    fs.writeFileSync(testFile, createSimpleWorkflow());

    const execResult = await executeWorkflowFromFile(testFile, { value: 5 });

    // Result should be the full object with all exit ports
    expect(execResult.result).toBeDefined();
    const result = execResult.result as Record<string, unknown>;
    expect(result.result).toBe(10); // doubleIt(5) = 10
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });

  it('should capture trace events when includeTrace=true (F3 trace fix)', async () => {
    const testFile = path.join(outputDir, 'executor-trace.ts');
    fs.writeFileSync(testFile, createSimpleWorkflow());

    const execResult = await executeWorkflowFromFile(
      testFile,
      { value: 5 },
      {
        includeTrace: true,
      }
    );

    // Trace should be non-empty
    expect(execResult.trace).toBeDefined();
    expect(execResult.trace!.length).toBeGreaterThan(0);

    // Should contain STATUS_CHANGED events
    const statusEvents = execResult.trace!.filter((e) => e.type === 'STATUS_CHANGED');
    expect(statusEvents.length).toBeGreaterThan(0);

    // Should contain VARIABLE_SET events
    const varEvents = execResult.trace!.filter((e) => e.type === 'VARIABLE_SET');
    expect(varEvents.length).toBeGreaterThan(0);
  });

  it('should execute workflow that uses another workflow as a node type (#36)', async () => {
    const compositionSource = `
/** @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function tripleIt(value: number): { result: number } { return { result: value * 3 }; }

/** @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function addFive(value: number): { result: number } { return { result: value + 5 }; }

/** @flowWeaver workflow
 * @node t tripleIt
 * @node a addFive
 * @connect Start.value -> t.value
 * @connect t.result -> a.value
 * @connect a.result -> Exit.result
 * @connect Start.execute -> t.execute
 * @connect t.onSuccess -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 * @param value
 * @returns result
 * @returns onSuccess
 */
export function innerPipeline(execute: boolean, params: { value: number }): { result: number; onSuccess: boolean } {
  throw new Error('Not compiled');
}

/** @flowWeaver workflow
 * @node inner innerPipeline
 * @node t2 tripleIt
 * @connect Start.value -> inner.value
 * @connect inner.result -> t2.value
 * @connect t2.result -> Exit.result
 * @connect Start.execute -> inner.execute
 * @connect inner.onSuccess -> t2.execute
 * @connect t2.onSuccess -> Exit.onSuccess
 * @param value
 * @returns result
 * @returns onSuccess
 */
export function outerPipeline(execute: boolean, params: { value: number }): { result: number; onSuccess: boolean } {
  throw new Error('Not compiled');
}
`;
    const testFile = path.join(outputDir, 'executor-composition.ts');
    fs.writeFileSync(testFile, compositionSource);

    // outerPipeline(2): inner = triple(2)+5 = 11, outer = triple(11) = 33
    const execResult = await executeWorkflowFromFile(
      testFile,
      { value: 2 },
      { workflowName: 'outerPipeline' }
    );

    const result = execResult.result as Record<string, unknown>;
    expect(result.result).toBe(33);
    expect(result.onSuccess).toBe(true);
  });

  it('should have empty trace when includeTrace=false', async () => {
    const testFile = path.join(outputDir, 'executor-notrace.ts');
    fs.writeFileSync(testFile, createSimpleWorkflow());

    const execResult = await executeWorkflowFromFile(
      testFile,
      { value: 5 },
      {
        includeTrace: false,
      }
    );

    // When trace is disabled, it should not be in the result
    expect(execResult.trace).toBeUndefined();
  });
});
