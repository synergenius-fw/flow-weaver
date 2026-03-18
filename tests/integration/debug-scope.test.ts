import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generator } from '../../src/generator';
import { it, expect } from 'vitest';

it('debug scope gen - dev mode', async () => {
  const dir = path.join(os.tmpdir(), 'flow-weaver-debug-scope2');
  fs.mkdirSync(dir, { recursive: true });

  // Use exact source from the passing scope-iteration test
  const source = `
/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items - Array to iterate
 * @output start scope:processItem - Triggers for each item
 * @output item scope:processItem - Current item
 * @input success scope:processItem - From child onSuccess
 * @input failure scope:processItem - From child onFailure
 * @input processed scope:processItem - Result from child
 * @output results - Collected results
 */
async function forEach(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{ success: boolean; failure: boolean; processed: any }> | { success: boolean; failure: boolean; processed: any }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: any[] = [];
  for (const item of items) {
    const r = await processItem(true, item);
    results.push(r.processed);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @label Process Item
 * @input item - Input value
 * @output processed - Doubled value
 */
function processItem(execute: boolean, item: any) {
  if (!execute) return { onSuccess: false, onFailure: false, processed: null };
  return { onSuccess: true, onFailure: false, processed: item * 2 };
}

/**
 * @flowWeaver workflow
 * @node forEach1 forEach
 * @node processor1 processItem forEach1.processItem
 * @connect Start.execute -> forEach1.execute
 * @connect Start.items -> forEach1.items
 * @connect forEach1.start:processItem -> processor1.execute
 * @connect forEach1.item:processItem -> processor1.item
 * @connect processor1.processed -> forEach1.processed:processItem
 * @connect processor1.onSuccess -> forEach1.success:processItem
 * @connect processor1.onFailure -> forEach1.failure:processItem
 * @connect forEach1.results -> Exit.results
 * @connect forEach1.onSuccess -> Exit.onSuccess
 * @connect forEach1.onFailure -> Exit.onFailure
 * @param items - Array of numbers
 * @returns results - Doubled numbers
 */
export function testWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error("Generated");
}
`;

  const testFile = path.join(dir, 'test-scope-dev.ts');
  fs.writeFileSync(testFile, source);

  // Dev mode (no production flag) - this is what the skill-assertions test uses
  const code = await generator.generate(testFile, 'testWorkflow');
  fs.writeFileSync(path.join(dir, 'generated-code-dump.ts'), code as string);

  const outFile = path.join(dir, 'test-scope-dev.generated.ts');
  fs.writeFileSync(outFile, code as string);
  const mod = await import(outFile);
  const result = await mod.testWorkflow(true, { items: [1, 2, 3] });
  console.log('RESULT:', JSON.stringify(result));
  expect(result.results).toEqual([2, 4, 6]);
});
