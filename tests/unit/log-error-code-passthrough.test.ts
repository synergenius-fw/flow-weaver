/**
 * A node that throws an Error carrying a structured `.code` should have
 * that code surfaced on the emitted LOG_ERROR event, not just the message.
 *
 * Downstream (Console) routes the code to a localized message catalog
 * (`messageForCode`). Today the code is dropped at the LOG_ERROR boundary
 * (`TErrorLogEvent.error` is a bare string), so the Console can only render
 * the en-only `Error.message`. This test pins the contract: the code rides
 * along on the event.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generator } from '../../src/generator';
import { TEvent, TErrorLogEvent } from '../../src/runtime/events';

describe('LOG_ERROR carries the thrown Error.code', () => {
  const uniqueId = `log-error-code-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);
  const testFile = path.join(tempDir, 'log-error-code-test.ts');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    global.testHelpers?.cleanupOutput?.('log-error-code.generated.ts');
  });

  it('surfaces err.code on the LOG_ERROR event when a node throws a coded error', async () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function boom(execute: boolean, x: number) {
  const err = new Error('Boom message.') as Error & { code: string };
  err.code = 'ERR_BOOM_TEST';
  throw err;
}

/**
 * @flowWeaver workflow
 * @name codedErrorWorkflow
 * @node boom1 boom
 * @connect Start.x -> boom1.x
 * @connect boom1.result -> Exit.result
 */
export async function codedErrorWorkflow(execute: boolean, params: { x: number }): Promise<{ result: number; onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    const code = await generator.generate(testFile, 'codedErrorWorkflow', {
      production: false,
    });

    const outputFile = path.join(global.testHelpers.outputDir, 'log-error-code.generated.ts');
    fs.writeFileSync(outputFile, code, 'utf-8');
    const { codedErrorWorkflow } = await import(outputFile);

    const events: TEvent[] = [];
    const mockDebugger = {
      sendEvent: (event: TEvent) => events.push(event),
      innerFlowInvocation: false,
    };

    // The node throws; the workflow halts. We don't care about the return
    // value here, only the emitted LOG_ERROR event.
    await codedErrorWorkflow(
      true,
      { x: 1 },
      testHelpers.createRuntime('codedErrorWorkflow', {
        debugger: mockDebugger,
      }),
    ).catch(() => undefined);

    const logErrors = events.filter((e): e is TErrorLogEvent => e.type === 'LOG_ERROR');

    const boomError = logErrors.find((e) => e.id === 'boom1');
    expect(boomError).toBeDefined();
    // The message still rides along (unchanged behaviour).
    expect(boomError?.error).toContain('Boom message.');
    // The structured code is the new contract.
    expect(boomError?.code).toBe('ERR_BOOM_TEST');
  });
});
