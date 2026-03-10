/**
 * Compiler regression: multiple step sources to the same target node.
 *
 * When two different nodes connect their step outputs to the same target
 * node's execute port, the compiler must not produce duplicate variable
 * declarations (e.g. two `const fooIdx = ctx.addExecution('foo')`).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { compileWorkflow } from '../../src/api/compile';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

const tempDir = path.join(os.tmpdir(), `fw-multi-step-${process.pid}`);

beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// A workflow where nodeA.onSuccess and nodeA.onFailure both connect
// to nodeB.execute (two step sources, one target).
const MULTI_STEP_SOURCE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @label Brancher
 * @input execute [order:0] - Execute
 * @input data [order:1] - Input data
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2] - Result
 */
function brancher(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  if (data?.fail) return { onSuccess: false, onFailure: true, result: 'failed' };
  return { onSuccess: true, onFailure: false, result: 'ok' };
}

/**
 * @flowWeaver nodeType
 * @label Handler
 * @input execute [order:0] - Execute
 * @input value [order:1] - Value
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output handled [order:2] - Handled result
 */
function handler(
  execute: boolean,
  value: string
): { onSuccess: boolean; onFailure: boolean; handled: string } {
  if (!execute) return { onSuccess: false, onFailure: false, handled: '' };
  return { onSuccess: true, onFailure: false, handled: 'handled:' + value };
}

/**
 * Two step sources (brancher.onSuccess AND brancher.onFailure) both
 * connect to handler.execute.
 *
 * @flowWeaver workflow
 * @node a brancher [position: -100 0]
 * @node b handler [position: 200 0]
 * @position Start -300 0
 * @position Exit 400 0
 * @connect Start.execute -> a.execute
 * @connect Start.data -> a.data
 * @connect a.onSuccess -> b.execute
 * @connect a.onFailure -> b.execute
 * @connect a.result -> b.value
 * @connect b.handled -> Exit.handled
 * @connect b.onSuccess -> Exit.onSuccess
 * @connect b.onFailure -> Exit.onFailure
 * @param execute [order:0] - Execute
 * @param data [order:1] - Input data
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns handled [order:2] - Handled result
 */
export function multiStepWorkflow(
  execute: boolean,
  params: { data: any }
): { onSuccess: boolean; onFailure: boolean; handled: string } {
  throw new Error('Compile with: fw compile <file>');
}
`;

describe('Multi-source step connections', () => {
  it('should compile without duplicate variable declarations', async () => {
    const filePath = path.join(tempDir, 'multi-step.ts');
    fs.writeFileSync(filePath, MULTI_STEP_SOURCE_WORKFLOW);

    const result = await compileWorkflow(filePath, {
      write: true,
      inPlace: true,
    });

    expect(result.code).toBeDefined();

    // Check the compiled output for duplicate const declarations
    const compiled = fs.readFileSync(filePath, 'utf8');
    const constBDeclarations = compiled.match(/const\s+bIdx\s*=/g) || [];
    expect(constBDeclarations.length).toBeLessThanOrEqual(1);
  });

  it('should execute successfully when compiled', async () => {
    const filePath = path.join(tempDir, 'multi-step-exec.ts');
    fs.writeFileSync(filePath, MULTI_STEP_SOURCE_WORKFLOW);

    const result = await executeWorkflowFromFile(
      filePath,
      { data: { value: 1 } },
      { production: true, includeTrace: false }
    );

    expect((result as unknown as Record<string, unknown>).error).toBeUndefined();
    expect(result.result).toBeDefined();
  }, 15_000);
});
