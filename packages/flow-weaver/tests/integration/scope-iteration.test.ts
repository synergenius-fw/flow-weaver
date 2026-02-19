/**
 * Integration tests for scope iteration (forEach pattern)
 *
 * Tests the per-port scoped execution pattern where a node receives
 * a scope function and calls it for each item in its iteration.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";

describe("Scope Iteration", () => {
  const outputDir = path.join(os.tmpdir(), `flow-weaver-scope-iteration-${process.pid}`);

  beforeEach(() => {
    // Create temp dir before each test to handle parallel test cleanup
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    // Note: Using import() instead of require() - cache is handled by unique file names
  });

  it("should pass item index to child nodes if connected", async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @output index scope:processItem
 * @input success scope:processItem
 * @input failure scope:processItem
 * @input processed scope:processItem
 * @output results
 */
function forEach(
  execute: boolean,
  items: string[],
  processItem: (start: boolean, item: string, index: number) => { success: boolean; failure: boolean; processed: string }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item, index) => processItem(true, item, index).processed);
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input item
 * @input index
 * @output formatted
 */
function format(execute: boolean, item: string, index: number) {
  if (!execute) return { onSuccess: false, onFailure: false, formatted: '' };
  return { onSuccess: true, onFailure: false, formatted: \`\${index}: \${item}\` };
}

/**
 * @flowWeaver workflow
 * @param items
 * @returns results
 * @node loop forEach
 * @node fmt format loop.processItem
 * @connect Start.execute -> loop.execute
 * @connect Start.items -> loop.items
 * @connect loop.start:processItem -> fmt.execute
 * @connect loop.item:processItem -> fmt.item
 * @connect loop.index:processItem -> fmt.index
 * @connect fmt.formatted -> loop.processed:processItem
 * @connect fmt.onSuccess -> loop.success:processItem
 * @connect fmt.onFailure -> loop.failure:processItem
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 */
export function formatAll(
  execute: boolean,
  params: { items: string[] }
): { onSuccess: boolean; onFailure: boolean; results: string[] } {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, "with-index.ts");
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, "formatAll");
    const outputFile = path.join(outputDir, "with-index.generated.ts");
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);

    const result = module.formatAll(true, { items: ['a', 'b', 'c'] });

    expect(result.onSuccess).toBe(true);
    expect(result.results).toEqual(['0: a', '1: b', '2: c']);
  });

  it("should execute multiple child nodes in sequence per iteration", async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:processItem
 * @output item scope:processItem
 * @input success scope:processItem
 * @input failure scope:processItem
 * @input processed scope:processItem
 * @output results
 */
function forEach(
  execute: boolean,
  items: number[],
  processItem: (start: boolean, item: number) => { success: boolean; failure: boolean; processed: number }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map(item => processItem(true, item).processed);
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output y
 */
function addOne(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, y: x + 1 };
}

/**
 * @flowWeaver nodeType
 * @input x
 * @output y
 */
function multiplyTwo(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, y: x * 2 };
}

/**
 * @flowWeaver workflow
 * @param items
 * @returns results
 * @node loop forEach
 * @node add addOne loop.processItem
 * @node mult multiplyTwo loop.processItem
 * @connect Start.execute -> loop.execute
 * @connect Start.items -> loop.items
 * @connect loop.start:processItem -> add.execute
 * @connect loop.item:processItem -> add.x
 * @connect add.y -> mult.x
 * @connect mult.y -> loop.processed:processItem
 * @connect mult.onSuccess -> loop.success:processItem
 * @connect mult.onFailure -> loop.failure:processItem
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 */
export function transformAll(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, "multi-child.ts");
    fs.writeFileSync(testFile, source);

    const code = await generator.generate(testFile, "transformAll");
    const outputFile = path.join(outputDir, "multi-child.generated.ts");
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);

    // [1, 2, 3] -> add 1 -> [2, 3, 4] -> multiply 2 -> [4, 6, 8]
    const result = module.transformAll(true, { items: [1, 2, 3] });

    expect(result.onSuccess).toBe(true);
    expect(result.results).toEqual([4, 6, 8]);
  });
});
