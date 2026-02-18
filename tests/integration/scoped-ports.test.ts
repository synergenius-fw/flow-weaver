/**
 * Integration tests for scoped ports (per-port scope architecture)
 * Tests end-to-end: workflow definition → code generation → execution → results
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generator } from "../../src/generator";

describe("Scoped Ports Integration Tests", () => {
  const outputDir = global.testHelpers?.outputDir || path.join(os.tmpdir(), `flow-weaver-scoped-ports-${process.pid}`);

  beforeAll(async () => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  describe("Simple forEach with scoped port", () => {
    it("should generate and execute a forEach workflow with scoped iteration", async () => {
      // Create a workflow file with scoped ports
      const workflowContent = `
/**
 * ForEach node type with scoped ports
 * @flowWeaver nodeType
 * @label For Each
 * @input items - Array to iterate over
 * @output start scope:processItem - MANDATORY: Execute control for scope
 * @output item scope:processItem - Current item passed to scope function
 * @input success scope:processItem - MANDATORY: Success control from scope
 * @input failure scope:processItem - MANDATORY: Failure control from scope
 * @input processed scope:processItem - Processed value returned from scope
 * @output results - Processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Processor node - doubles the input
 * @flowWeaver nodeType
 * @label Double
 * @input item - Value to double
 * @output processed - Doubled value
 */
function doubleValue(execute: boolean, item: any) {
  if (!execute) return { onSuccess: false, onFailure: false, processed: 0 };
  return { onSuccess: true, onFailure: false, processed: item * 2 };
}

/**
 * Workflow with forEach and scoped child
 * @flowWeaver workflow
 * @name processArray
 * @node forEach1 forEach
 * @node doubler doubleValue forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> doubler.item
 * @connect doubler.processed -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export function processArray(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented - will be generated');
}

export { forEach, doubleValue };
      `.trim();

      const testFile = path.join(outputDir, "test-scoped-forEach.ts");
      fs.writeFileSync(testFile, workflowContent);

      // Generate the code
      const generatedCode = await generator.generate(testFile, "processArray");
      expect(generatedCode).toBeDefined();
      expect(generatedCode).toContain("createScope");
      expect(generatedCode).toContain("mergeScope");
      expect(generatedCode).toContain("forEach1_processItem_scopeFn");

      // Write generated code to file
      const outputFile = path.join(outputDir, "test-scoped-forEach.generated.ts");
      fs.writeFileSync(outputFile, generatedCode);

      // Import and execute the generated code
      // Using import() for TypeScript compatibility
      const module = await import(outputFile);

      // Test execution with input: [1, 2, 3]
      let result;
      try {
        result = module.processArray(true, { items: [1, 2, 3] });
      } catch (error: any) {
        console.error('[TEST] Execution error:', error.message);
        console.error('[TEST] Stack:', error.stack);
        throw error;
      }

      // Verify results: each item should be doubled
      expect(result.onSuccess).toBe(true);
      expect(result.onFailure).toBe(false);
      expect(result.results).toEqual([2, 4, 6]);
    });

    it("should handle empty array", async () => {
      const workflowContent = `
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
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function addTen(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 10 };
}

/**
 * @flowWeaver workflow
 * @name processEmpty
 * @node forEach1 forEach
 * @node adder addTen forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> adder.value
 * @connect adder.result -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export function processEmpty(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}

export { forEach, addTen };
      `.trim();

      const testFile = path.join(outputDir, "test-empty-array.ts");
      fs.writeFileSync(testFile, workflowContent);

      const generatedCode = await generator.generate(testFile, "processEmpty");
      const outputFile = path.join(outputDir, "test-empty-array.generated.ts");
      fs.writeFileSync(outputFile, generatedCode);

      // Using import() for TypeScript compatibility
      const module = await import(outputFile);

      // Test with empty array
      const result = module.processEmpty(true, { items: [] });

      expect(result.onSuccess).toBe(true);
      expect(result.results).toEqual([]);
    });
  });

  describe("Multiple operations in scope", () => {
    it("should execute multiple nodes within the same scope in correct order", async () => {
      const workflowContent = `
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
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function addFive(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 5 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function multiplyByTwo(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @name processChain
 * @node forEach1 forEach
 * @node adder addFive forEach1.processItem
 * @node multiplier multiplyByTwo forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> adder.value
 * @connect adder.result -> multiplier.value
 * @connect multiplier.result -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export function processChain(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}

export { forEach, addFive, multiplyByTwo };
      `.trim();

      const testFile = path.join(outputDir, "test-chain.ts");
      fs.writeFileSync(testFile, workflowContent);

      const generatedCode = await generator.generate(testFile, "processChain");
      const outputFile = path.join(outputDir, "test-chain.generated.ts");
      fs.writeFileSync(outputFile, generatedCode);

      // Using import() for TypeScript compatibility
      const module = await import(outputFile);

      // Test: (value + 5) * 2
      // Input: [1, 2, 3]
      // Expected: [(1+5)*2, (2+5)*2, (3+5)*2] = [12, 14, 16]
      const result = module.processChain(true, { items: [1, 2, 3] });

      expect(result.onSuccess).toBe(true);
      expect(result.results).toEqual([12, 14, 16]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle single item array", async () => {
      const workflowContent = `
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
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function triple(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * @flowWeaver workflow
 * @name processSingle
 * @node forEach1 forEach
 * @node tripler triple forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> tripler.value
 * @connect tripler.result -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export function processSingle(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}

export { forEach, triple };
      `.trim();

      const testFile = path.join(outputDir, "test-single-item.ts");
      fs.writeFileSync(testFile, workflowContent);

      const generatedCode = await generator.generate(testFile, "processSingle");
      const outputFile = path.join(outputDir, "test-single-item.generated.ts");
      fs.writeFileSync(outputFile, generatedCode);

      // Using import() for TypeScript compatibility
      const module = await import(outputFile);

      const result = module.processSingle(true, { items: [5] });

      expect(result.onSuccess).toBe(true);
      expect(result.results).toEqual([15]);
    });

    it("should handle large arrays efficiently", async () => {
      const workflowContent = `
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
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function increment(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @name processLarge
 * @node forEach1 forEach
 * @node incrementer increment forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> incrementer.value
 * @connect incrementer.result -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export function processLarge(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}

export { forEach, increment };
      `.trim();

      const testFile = path.join(outputDir, "test-large-array.ts");
      fs.writeFileSync(testFile, workflowContent);

      const generatedCode = await generator.generate(testFile, "processLarge");
      const outputFile = path.join(outputDir, "test-large-array.generated.ts");
      fs.writeFileSync(outputFile, generatedCode);

      // Using import() for TypeScript compatibility
      const module = await import(outputFile);

      // Test with 100 items
      const input = Array.from({ length: 100 }, (_, i) => i);
      const result = module.processLarge(true, { items: input });

      expect(result.onSuccess).toBe(true);
      expect(result.results.length).toBe(100);
      expect(result.results[0]).toBe(1);
      expect(result.results[99]).toBe(100);
    });

    it("should handle any type values correctly", async () => {
      const workflowContent = `
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
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function passThrough(execute: boolean, value: any) {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @name processAnyType
 * @node forEach1 forEach
 * @node passthrough passThrough forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> passthrough.value
 * @connect passthrough.result -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export function processAnyType(
  execute: boolean,
  params: { items: any[] }
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  throw new Error('Not implemented');
}

export { forEach, passThrough };
      `.trim();

      const testFile = path.join(outputDir, "test-any-type.ts");
      fs.writeFileSync(testFile, workflowContent);

      const generatedCode = await generator.generate(testFile, "processAnyType");
      const outputFile = path.join(outputDir, "test-any-type.generated.ts");
      fs.writeFileSync(outputFile, generatedCode);

      // Using import() for TypeScript compatibility
      const module = await import(outputFile);

      // Test with mixed type values
      const result = module.processAnyType(true, { items: [1, "test", true, { foo: "bar" }] });

      expect(result.onSuccess).toBe(true);
      expect(result.results).toEqual([1, "test", true, { foo: "bar" }]);
    });
  });

  describe("Async Variants", () => {
    it("should execute async operations within scoped iterations", async () => {
      const workflowContent = `
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
async function forEachAsync(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{
    success: boolean;
    failure: boolean;
    processed: any;
  }>
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = [];
  for (const item of items) {
    const result = await processItem(true, item);
    results.push(result.processed);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
async function asyncDouble(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  await new Promise(resolve => setTimeout(resolve, 1));
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @name processAsyncArray
 * @node forEach1 forEachAsync
 * @node doubler asyncDouble forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> doubler.value
 * @connect doubler.result -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export async function processAsyncArray(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}

export { forEachAsync, asyncDouble };
      `.trim();

      const testFile = path.join(outputDir, "test-async-forEach.ts");
      fs.writeFileSync(testFile, workflowContent);

      const generatedCode = await generator.generate(testFile, "processAsyncArray");
      const outputFile = path.join(outputDir, "test-async-forEach.generated.ts");
      fs.writeFileSync(outputFile, generatedCode);

      // Verify async/await keywords are in generated code
      expect(generatedCode).toContain("async");
      expect(generatedCode).toContain("await");

      // Using import() for TypeScript compatibility
      const module = await import(outputFile);

      const result = await module.processAsyncArray(true, { items: [1, 2, 3] });

      expect(result.onSuccess).toBe(true);
      expect(result.results).toEqual([2, 4, 6]);
    });

    it("should handle async chain of operations", async () => {
      const workflowContent = `
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
async function forEachAsync(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{
    success: boolean;
    failure: boolean;
    processed: any;
  }>
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = [];
  for (const item of items) {
    const result = await processItem(true, item);
    results.push(result.processed);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
async function asyncAddFive(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  await new Promise(resolve => setTimeout(resolve, 1));
  return { onSuccess: true, onFailure: false, result: value + 5 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
async function asyncMultiplyThree(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  await new Promise(resolve => setTimeout(resolve, 1));
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * @flowWeaver workflow
 * @name processAsyncChain
 * @node forEach1 forEachAsync
 * @node adder asyncAddFive forEach1.processItem
 * @node multiplier asyncMultiplyThree forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> adder.value
 * @connect adder.result -> multiplier.value
 * @connect multiplier.result -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export async function processAsyncChain(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}

export { forEachAsync, asyncAddFive, asyncMultiplyThree };
      `.trim();

      const testFile = path.join(outputDir, "test-async-chain.ts");
      fs.writeFileSync(testFile, workflowContent);

      const generatedCode = await generator.generate(testFile, "processAsyncChain");
      const outputFile = path.join(outputDir, "test-async-chain.generated.ts");
      fs.writeFileSync(outputFile, generatedCode);

      // Using import() for TypeScript compatibility
      const module = await import(outputFile);

      // Test: (value + 5) * 3
      // Input: [1, 2, 3]
      // Expected: [(1+5)*3, (2+5)*3, (3+5)*3] = [18, 21, 24]
      const result = await module.processAsyncChain(true, { items: [1, 2, 3] });

      expect(result.onSuccess).toBe(true);
      expect(result.results).toEqual([18, 21, 24]);
    });
  });
});
