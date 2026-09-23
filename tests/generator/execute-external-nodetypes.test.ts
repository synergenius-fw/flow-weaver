/**
 * `executeWorkflow` must thread `options.externalNodeTypes`
 * through its internal `compileWorkflow` -> `parseWorkflow` ->
 * `parser.parse` pipeline, so a workflow that references a foreign
 * nodeType by name (an `@node <id> <foreignType>` whose definition the
 * file does not declare) can compile + run when the caller supplies the
 * nodeType's port shape.
 *
 * Regression motivation: the platform runtime resolves a pack-core
 * node's ports from the install's wire manifest (the device install dir
 * has no node_modules to read a `.d.ts` from) and passes them to the
 * executor. Before this fix the executor's options had no
 * `externalNodeTypes`, so its internal compile fell back to a `{ result }`
 * stub and validation failed ("Node ... does not have port ...").
 *
 * The foreign node's runtime impl is injected on `globalThis` (the
 * generated code calls it by bare name), so the workflow can actually
 * execute in this unit test without the package on disk.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { executeWorkflow } from '../../src/mcp/workflow-executor';
import type { CompletedExecutionOutcome } from '../../src/mcp/workflow-executor';
import type { TExternalNodeType } from '../../src/parser/annotation-parser';

describe('executeWorkflow with externalNodeTypes', () => {
  const outputDir = path.join(os.tmpdir(), `fw-exec-ext-${process.pid}`);
  let testFile: string;

  // `gate` is FOREIGN: referenced by @node, never declared in the file.
  // Only resolvable from the externalNodeTypes the caller passes.
  const SOURCE = `/**
 * @flowWeaver nodeType
 * @expression
 * @output value
 */
function seed(): { value: string } {
  return { value: 'ok' };
}

/** @flowWeaver workflow
 * @node s seed
 * @node g gate
 * @path Start -> s -> g -> Exit
 * @connect s.value -> g.input
 * @connect g.passed -> Exit.passed
 * @connect g.onSuccess -> Exit.onSuccess
 * @connect g.onFailure -> Exit.onFailure
 * @returns passed
 * @returns onSuccess
 * @returns onFailure
 */
export function usesForeignGate(
  execute: boolean,
): { passed: string; onSuccess: boolean; onFailure: boolean } {
  throw new Error('stub');
}
`;

  const FOREIGN_GATE: TExternalNodeType = {
    name: 'gate',
    functionName: 'gate',
    ports: [
      { name: 'execute', type: 'STEP', direction: 'INPUT' },
      { name: 'input', type: 'String', direction: 'INPUT' },
      { name: 'passed', type: 'String', direction: 'OUTPUT' },
      { name: 'onSuccess', type: 'STEP', direction: 'OUTPUT' },
      { name: 'onFailure', type: 'STEP', direction: 'OUTPUT' },
    ],
  };

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
    testFile = path.join(outputDir, 'uses-foreign-gate.ts');
    fs.writeFileSync(testFile, SOURCE);
    // Inject the foreign node's impl; the generated code calls `gate(...)`
    // by bare name (parser-external nodes are not import-emitted).
    (globalThis as unknown as { gate?: unknown }).gate = (_execute: boolean, input: string) => ({
      onSuccess: true,
      onFailure: false,
      passed: String(input).toUpperCase(),
    });
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
    delete (globalThis as unknown as { gate?: unknown }).gate;
  });

  it('fails to execute the foreign-gate workflow WITHOUT externalNodeTypes', async () => {
    await expect(
      executeWorkflow({
        runId: 'test:foreign-gate-missing',
        filePath: testFile,
        params: { execute: true },
        workflowName: 'usesForeignGate',
      }),
    ).rejects.toThrow(/gate|port/i);
  });

  it('executes the foreign-gate workflow WHEN externalNodeTypes is supplied', async () => {
    const result = await executeWorkflow({
      runId: 'test:foreign-gate',
      filePath: testFile,
      params: { execute: true },
      workflowName: 'usesForeignGate',
      externalNodeTypes: [FOREIGN_GATE],
    });
    const out = (result as CompletedExecutionOutcome).result as Record<string, unknown>;
    expect(out.onSuccess).toBe(true);
    expect(out.passed).toBe('OK');
  });
});
