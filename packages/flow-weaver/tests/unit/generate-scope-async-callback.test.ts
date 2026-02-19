/**
 * Phase 9 TDD Test: Scope Async Callback Generation
 *
 * When a per-port scope (callback-style forEach) contains async child nodes,
 * the scope function must be async to properly await those children.
 *
 * Problem: `scopeIsAsync` only checks workflow.isAsync and node.isAsync,
 * but doesn't check if any child node in the scope is async.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generator } from '../../src/generator';

describe('Scope Async Callback Generation', () => {
  const tmpDir = path.join(os.tmpdir(), `flow-weaver-scope-async-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate async scope function when scope contains async child', async () => {
    // Per-port scope pattern: forEach with scoped OUTPUT/INPUT ports
    // The child node (asyncProcess) is async, so the scope function must be async
    const source = `
/**
 * ForEach with per-port scope
 * @flowWeaver nodeType
 * @async
 * @input items [order:1] - Array of items
 * @input success scope:processItem [order:0] - From child onSuccess
 * @input failure scope:processItem [order:1] - From child onFailure
 * @input result scope:processItem [order:2] - Result from child
 * @input execute [order:0] - Execute
 * @output start scope:processItem [order:0] - Triggers child
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - Collected results
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function forEachAsync(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{ success: boolean; failure: boolean; result: any }>
): Promise<{ onSuccess: boolean; onFailure: boolean; results: any[] }> {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: any[] = [];
  for (const item of items) {
    const r = await processItem(true, item);
    results.push(r.result);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Async child node in scope
 * @flowWeaver nodeType
 * @async
 * @input item [order:1]
 * @input execute [order:0]
 * @output result [order:2]
 * @output onSuccess [order:0]
 * @output onFailure [order:1]
 */
async function asyncProcess(
  execute: boolean,
  item: any
): Promise<{ onSuccess: boolean; onFailure: boolean; result: any }> {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: { ...item, processed: true } };
}

/**
 * @flowWeaver workflow
 * @async
 * @node loop forEachAsync
 * @node proc asyncProcess loop.processItem
 * @connect Start.items -> loop.items
 * @connect loop.start:processItem -> proc.execute
 * @connect loop.item:processItem -> proc.item
 * @connect proc.result -> loop.result:processItem
 * @connect proc.onSuccess -> loop.success:processItem
 * @connect proc.onFailure -> loop.failure:processItem
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 * @scope loop.processItem [proc]
 * @param items
 * @returns results
 * @returns onSuccess
 * @returns onFailure
 */
export async function processAllAsync(
  execute: boolean,
  params: { items: any[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: any[] }> {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'async-child-scope.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'processAllAsync');

    // The scope function closure should be async
    // Pattern: ((ctx) => { return async (start: boolean, item: any) => { ...
    expect(code).toMatch(/return\s+async\s*\(/);

    // And it should await the async child call
    expect(code).toContain('await asyncProcess');
  });

  it('should generate sync scope function when all children are sync', async () => {
    const source = `
/**
 * ForEach with per-port scope - sync version
 * @flowWeaver nodeType
 * @input items [order:1] - Array of items
 * @input success scope:processItem [order:0] - From child onSuccess
 * @input failure scope:processItem [order:1] - From child onFailure
 * @input result scope:processItem [order:2] - Result from child
 * @input execute [order:0] - Execute
 * @output start scope:processItem [order:0] - Triggers child
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - Collected results
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function forEachSync(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => { success: boolean; failure: boolean; result: any }
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: any[] = [];
  for (const item of items) {
    const r = processItem(true, item);
    results.push(r.result);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Sync child node in scope
 * @flowWeaver nodeType
 * @input item [order:1]
 * @input execute [order:0]
 * @output result [order:2]
 * @output onSuccess [order:0]
 * @output onFailure [order:1]
 */
function syncProcess(
  execute: boolean,
  item: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: { ...item, processed: true } };
}

/**
 * @flowWeaver workflow
 * @node loop forEachSync
 * @node proc syncProcess loop.processItem
 * @connect Start.items -> loop.items
 * @connect loop.start:processItem -> proc.execute
 * @connect loop.item:processItem -> proc.item
 * @connect proc.result -> loop.result:processItem
 * @connect proc.onSuccess -> loop.success:processItem
 * @connect proc.onFailure -> loop.failure:processItem
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 * @scope loop.processItem [proc]
 * @param items
 * @returns results
 * @returns onSuccess
 * @returns onFailure
 */
export function processAllSync(
  execute: boolean,
  params: { items: any[] }
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'sync-scope.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'processAllSync');

    // The scope function should NOT be async
    // Should NOT match: return async (
    expect(code).not.toMatch(/return\s+async\s*\(/);
    // Should NOT await the sync child
    expect(code).not.toContain('await syncProcess');
  });

  it('should await async parent node call (forEach)', async () => {
    // When the parent node (forEach) is async, the workflow must await its call
    const source = `
/**
 * Async ForEach
 * @flowWeaver nodeType
 * @async
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @input success scope:processItem
 * @input processed scope:processItem
 * @output results
 */
async function forEachAsync(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{ success: boolean; processed: any }>
): Promise<{ onSuccess: boolean; onFailure: boolean; results: any[] }> {
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
 * @input item
 * @output processed
 */
function doubleValue(execute: boolean, item: number) {
  return { onSuccess: true, onFailure: false, processed: item * 2 };
}

/**
 * @flowWeaver workflow
 * @async
 * @node loop forEachAsync
 * @node proc doubleValue loop.processItem
 * @connect Start.items -> loop.items
 * @connect loop.item:processItem -> proc.item
 * @connect proc.processed -> loop.processed:processItem
 * @connect loop.results -> Exit.results
 * @param items
 * @returns results
 */
export async function asyncForEachWorkflow(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(tmpDir, 'async-foreach-call.ts');
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, 'asyncForEachWorkflow');

    // The parent node call should be awaited since forEachAsync is async
    // Should match something like: await forEachAsync(true, ...
    expect(code).toMatch(/await\s+forEachAsync\(/);

    // And the result should be accessed correctly (not on a Promise)
    expect(code).toContain('loopResult.results');
  });
});
