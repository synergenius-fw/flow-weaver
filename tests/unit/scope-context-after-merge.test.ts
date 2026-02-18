/**
 * TDD Test: Scope Context After Merge
 *
 * After `ctx.mergeScope(scopedCtx)` is called, the generated code should use
 * `ctx` (not `scopedCtx`) for all subsequent variable access operations.
 *
 * Problem: The current generator continues using `scopedCtx.getVariable` and
 * `scopedCtx.setVariable` after the merge, which is incorrect because:
 * 1. The scoped context has been merged back into the parent
 * 2. Access should be on the merged (parent) context
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generator } from '../../src/generator';

describe('Scope Context After Merge', () => {
  const tmpDir = path.join(os.tmpdir(), `flow-weaver-scope-merge-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should use ctx (not scopedCtx) after mergeScope', async () => {
    // Create a workflow with forEach that has scoped ports
    const source = `
/**
 * ForEach with scoped ports
 * @flowWeaver nodeType
 * @async
 * @scope itemProcessor
 * @input execute [order:0]
 * @input items [order:1]
 * @output start scope:itemProcessor [order:0]
 * @output item scope:itemProcessor [order:1]
 * @input success scope:itemProcessor [order:0]
 * @input failure scope:itemProcessor [order:1]
 * @input processed scope:itemProcessor [order:2]
 * @output results [order:2]
 * @output onSuccess [order:0]
 * @output onFailure [order:1]
 */
async function forEach(
  execute: boolean,
  items: number[],
  itemProcessor: (start: boolean, item: number) => Promise<{ success: boolean; failure: boolean; processed: number }>
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: number[] = [];
  for (const item of items) {
    const r = await itemProcessor(true, item);
    results.push(r.processed);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Async child node
 * @flowWeaver nodeType
 * @async
 * @input execute [order:0]
 * @input value [order:1]
 * @output processed [order:2]
 * @output onSuccess [order:0]
 * @output onFailure [order:1]
 */
async function addTen(
  execute: boolean,
  value: number
): Promise<{ onSuccess: boolean; onFailure: boolean; processed: number }> {
  if (!execute) return { onSuccess: false, onFailure: false, processed: 0 };
  return { onSuccess: true, onFailure: false, processed: value + 10 };
}

/**
 * @flowWeaver workflow
 * @async
 * @node loop forEach
 * @node proc addTen loop.itemProcessor
 * @connect Start.execute -> loop.execute
 * @connect Start.items -> loop.items
 * @connect loop.start:itemProcessor -> proc.execute
 * @connect loop.item:itemProcessor -> proc.value
 * @connect proc.onSuccess -> loop.success:itemProcessor
 * @connect proc.onFailure -> loop.failure:itemProcessor
 * @connect proc.processed -> loop.processed:itemProcessor
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 * @param items
 * @returns results
 * @returns onSuccess
 */
export async function processArray(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'scope-merge-test.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'processArray');

    // Find the mergeScope call
    const mergeIndex = code.indexOf('ctx.mergeScope(scopedCtx)');
    expect(mergeIndex).toBeGreaterThan(-1);

    // Get the code AFTER the mergeScope call
    const codeAfterMerge = code.substring(mergeIndex);

    // After mergeScope, we should NOT use scopedCtx.getVariable or scopedCtx.setVariable
    // All variable access should be through ctx (the parent context)
    expect(codeAfterMerge).not.toMatch(/scopedCtx\.getVariable/);
    expect(codeAfterMerge).not.toMatch(/scopedCtx\.setVariable/);
  });

  it('should use ctx for extracting return values after scope', async () => {
    // Similar test but focusing on the return value extraction
    // Use a simpler pattern with scoped inputs for the execute trigger
    const source = `
/**
 * @flowWeaver nodeType
 * @scope processor
 * @input execute
 * @input data
 * @output start scope:processor
 * @output value scope:processor
 * @input success scope:processor
 * @input result scope:processor
 * @output output
 * @output onSuccess
 * @output onFailure
 */
function mapValue(
  execute: boolean,
  data: string,
  processor: (start: boolean, value: string) => { success: boolean; result: string }
): { onSuccess: boolean; onFailure: boolean; output: string } {
  if (!execute) return { onSuccess: false, onFailure: false, output: '' };
  const r = processor(true, data);
  return { onSuccess: true, onFailure: false, output: r.result };
}

/**
 * @flowWeaver nodeType
 * @input execute
 * @input input
 * @output result
 * @output onSuccess
 * @output onFailure
 */
function uppercase(
  execute: boolean,
  input: string
): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: input.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node m mapValue
 * @node u uppercase m.processor
 * @connect Start.execute -> m.execute
 * @connect Start.data -> m.data
 * @connect m.start:processor -> u.execute
 * @connect m.value:processor -> u.input
 * @connect u.onSuccess -> m.success:processor
 * @connect u.result -> m.result:processor
 * @connect m.output -> Exit.output
 * @connect m.onSuccess -> Exit.onSuccess
 * @param data
 * @returns output
 * @returns onSuccess
 */
export function transformData(
  execute: boolean,
  params: { data: string }
): { onSuccess: boolean; output: string } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'scope-return-test.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'transformData');

    // The code should compile and run correctly
    // After mergeScope, all variable access should use ctx
    const mergeIndex = code.indexOf('ctx.mergeScope(scopedCtx)');
    if (mergeIndex > -1) {
      const codeAfterMerge = code.substring(mergeIndex);
      expect(codeAfterMerge).not.toMatch(/scopedCtx\.getVariable/);
      expect(codeAfterMerge).not.toMatch(/scopedCtx\.setVariable/);
    }
  });
});
