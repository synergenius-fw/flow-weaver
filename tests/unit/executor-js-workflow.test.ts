/**
 * Executor: JavaScript workflow files from marketplace packs.
 *
 * When a workflow lives under src/ and imports point to .ts files that
 * only have compiled .js equivalents in dist/, the executor rewrites
 * import paths so Node.js ESM resolver finds the right modules.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

const tempDir = path.join(os.tmpdir(), `fw-exec-js-${process.pid}`);

beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Executing workflows from marketplace pack layout', () => {
  it('should rewrite src/ imports to dist/ when src .js files are missing', async () => {
    // Simulates: src/workflows/wf.ts imports from ../node-types/upper.js
    // Only dist/node-types/upper.js exists (src/ has .ts only).
    const packDir = path.join(tempDir, 'mock-pack');
    fs.mkdirSync(path.join(packDir, 'src', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(packDir, 'src', 'node-types'), { recursive: true });
    fs.mkdirSync(path.join(packDir, 'dist', 'node-types'), { recursive: true });

    // Node type TS source (for parsing)
    fs.writeFileSync(path.join(packDir, 'src', 'node-types', 'upper.ts'), `
/**
 * @flowWeaver nodeType
 * @label Upper
 * @input execute [order:0] - Execute
 * @input text [order:1] - Text input
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2] - Uppercased text
 */
export function upper(
  execute: boolean,
  text: string,
): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: text.toUpperCase() };
}
`);

    // Node type compiled JS (for runtime)
    fs.writeFileSync(path.join(packDir, 'dist', 'node-types', 'upper.js'), `
export function upper(execute, text) {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: text.toUpperCase() };
}
`);

    // Workflow TS source with import
    fs.writeFileSync(path.join(packDir, 'src', 'workflows', 'upper-wf.ts'), `
import { upper } from '../node-types/upper.js';

/**
 * @flowWeaver workflow
 * @node u upper [position: 0 0]
 * @path Start -> u -> Exit
 * @connect u.result -> Exit.output
 * @position Start -200 0
 * @position Exit 200 0
 * @param execute [order:-1] - Execute
 * @param text [order:0] - Text to uppercase
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 * @returns output [order:0] - Uppercased text
 */
export async function upperWorkflow(
  execute: boolean,
  params: { text: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; output: string }> {
  return { onSuccess: false, onFailure: true, output: '' };
}
`);

    const result = await executeWorkflowFromFile(
      path.join(packDir, 'src', 'workflows', 'upper-wf.ts'),
      { text: 'hello' },
      { production: true, includeTrace: false },
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBeDefined();
    const res = result.result as Record<string, unknown>;
    expect(res.onSuccess).toBe(true);
    expect(res.output).toBe('HELLO');
  }, 15_000);
});
