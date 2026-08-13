/**
 * Integration tests for workflow-executor.ts
 * Verifies F3 fixes: trace capture and result field propagation
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { compileExecutableWorkflowArtifact, executeWorkflow } from '../../src/mcp/workflow-executor';
import { executePrecompiledWorkflow } from '../../src/runtime/precompiled-executor';

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

    const execResult = await executeWorkflow({
      runId: 'test:executor-result',
      filePath: testFile,
      params: { value: 5 },
    });

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

    const execResult = await executeWorkflow({
      runId: 'test:executor-trace',
      filePath: testFile,
      params: { value: 5 },
      includeTrace: true,
    });

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
    const execResult = await executeWorkflow({
      runId: 'test:executor-nested',
      filePath: testFile,
      params: { value: 2 },
      workflowName: 'outerPipeline',
    });

    const result = execResult.result as Record<string, unknown>;
    expect(result.result).toBe(33);
    expect(result.onSuccess).toBe(true);
  });

  it('should have empty trace when includeTrace=false', async () => {
    const testFile = path.join(outputDir, 'executor-notrace.ts');
    fs.writeFileSync(testFile, createSimpleWorkflow());

    const execResult = await executeWorkflow({
      runId: 'test:executor-no-trace',
      filePath: testFile,
      params: { value: 5 },
      includeTrace: false,
    });

    // When trace is disabled, it should not be in the result
    expect(execResult.trace).toBeUndefined();
  });

  it('compiles a closed workflow module before deployment rather than at execution time', async () => {
    const artifact = await compileExecutableWorkflowArtifact({
      source: createSimpleWorkflow(),
      workflowName: 'simpleWorkflow',
    });

    expect(artifact).toMatchObject({ formatVersion: 1, workflowName: 'simpleWorkflow' });
    expect(artifact.code).toContain('simpleWorkflow');
    expect(artifact.code).toContain('@flow-weaver-body-start');
    expect(artifact.code).toContain('export const __flowWeaverExecutableArtifact');

    const artifactFile = path.join(outputDir, 'precompiled-simple.mjs');
    fs.writeFileSync(artifactFile, artifact.code);
    const result = await executePrecompiledWorkflow({
      runId: 'test:precompiled-executor',
      bundleDigest: `sha256:${'0'.repeat(64)}`,
      filePath: artifactFile,
      workflowName: 'simpleWorkflow',
      params: { value: 6 },
      includeTrace: true,
    });

    expect(result.kind).toBe('completed');
    expect(result.kind === 'completed' ? result.result : undefined).toMatchObject({
      result: 12,
      onSuccess: true,
      onFailure: false,
    });
    expect(result.trace?.length).toBeGreaterThan(0);
  });

  it('resumes a durable gate using only sealed module metadata', async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/continuation/fixtures/durable-approval.ts'),
      'utf8',
    );
    const artifact = await compileExecutableWorkflowArtifact({
      source,
      workflowName: 'durableApproval',
    });
    const artifactFile = path.join(outputDir, 'precompiled-durable-approval.mjs');
    fs.writeFileSync(artifactFile, artifact.code);
    const bundleDigest = `sha256:${'1'.repeat(64)}`;
    const yielded = await executePrecompiledWorkflow({
      runId: 'test:precompiled-durable',
      bundleDigest,
      filePath: artifactFile,
      workflowName: 'durableApproval',
      params: { value: 4 },
      includeTrace: true,
    });
    expect(yielded.kind).toBe('yielded');
    if (yielded.kind !== 'yielded') throw new Error('expected durable gate yield');

    const resumed = await executePrecompiledWorkflow({
      runId: 'test:precompiled-durable',
      bundleDigest,
      filePath: artifactFile,
      workflowName: 'durableApproval',
      params: { value: 999 },
      continuation: yielded.continuation,
      resolution: {
        gateId: yielded.gate.id,
        value: { onSuccess: true, onFailure: false, value: 8 },
      },
      includeTrace: true,
    });
    expect(resumed).toMatchObject({
      kind: 'completed',
      result: { onSuccess: true, onFailure: false, result: 9 },
    });
    expect(resumed.trace?.some((event) =>
      event.type === 'STATUS_CHANGED' && ['Start', 'prepared'].includes(String(event.data?.id)) &&
      event.data?.status === 'SUCCEEDED')).toBe(false);
  });
});
