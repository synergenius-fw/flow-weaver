/**
 * Generated Code Execution Tests
 *
 * Optimized: All workflows generated once in top-level beforeAll
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const OUTPUT_DIR = path.join(os.tmpdir(), `flow-weaver-execution-tests-${process.pid}`);

// =============================================================================
// SOURCE CODE DEFINITIONS
// =============================================================================

const SOURCES = {
  addNumbers: `
/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @output sum
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 */
export function addNumbers(
  execute: boolean,
  params: { a: number; b: number }
): { onSuccess: boolean; onFailure: boolean; sum: number } {
  throw new Error('Not implemented');
}
`,

  calculate: `
/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @output sum
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @input factor
 * @output result
 */
function multiply(execute: boolean, value: number, factor: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * factor };
}

/**
 * @flowWeaver workflow
 * @node adder add
 * @node multiplier multiply
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> multiplier.value
 * @connect Start.factor -> multiplier.factor
 * @connect multiplier.result -> Exit.result
 */
export function calculate(
  execute: boolean,
  params: { a: number; b: number; factor: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`,

  processString: `
/**
 * @flowWeaver nodeType
 * @input text
 * @output upper
 */
function toUpper(execute: boolean, text: string) {
  if (!execute) return { onSuccess: false, onFailure: false, upper: "" };
  return { onSuccess: true, onFailure: false, upper: text.toUpperCase() };
}

/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @output joined
 */
function concat(execute: boolean, a: string, b: string) {
  if (!execute) return { onSuccess: false, onFailure: false, joined: "" };
  return { onSuccess: true, onFailure: false, joined: a + b };
}

/**
 * @flowWeaver workflow
 * @node upper toUpper
 * @node joiner concat
 * @connect Start.text -> upper.text
 * @connect upper.upper -> joiner.a
 * @connect Start.suffix -> joiner.b
 * @connect joiner.joined -> Exit.result
 */
export function processString(
  execute: boolean,
  params: { text: string; suffix: string }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('Not implemented');
}
`,

  validateAndDouble: `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function validate(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  if (value < 0) {
    return { onSuccess: false, onFailure: true, result: 0 };
  }
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node validator validate
 * @node doubler double
 * @connect Start.value -> validator.value
 * @connect validator.onSuccess -> doubler.execute
 * @connect validator.result -> doubler.value
 * @connect doubler.result -> Exit.result
 */
export function validateAndDouble(
  execute: boolean,
  params: { value: number }
): { onSuccess?: boolean; onFailure?: boolean; result?: number } {
  throw new Error('Not implemented');
}
`,

  multiOutput: `
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 * @output tripled
 * @output squared
 */
function multiOp(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0, tripled: 0, squared: 0 };
  return {
    onSuccess: true,
    onFailure: false,
    doubled: value * 2,
    tripled: value * 3,
    squared: value * value
  };
}

/**
 * @flowWeaver workflow
 * @node ops multiOp
 * @connect Start.value -> ops.value
 * @connect ops.doubled -> Exit.doubled
 * @connect ops.tripled -> Exit.tripled
 * @connect ops.squared -> Exit.squared
 */
export function multiOutput(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; doubled: number; tripled: number; squared: number } {
  throw new Error('Not implemented');
}
`,

  booleanLogic: `
/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @output andResult
 * @output orResult
 */
function boolOps(execute: boolean, a: boolean, b: boolean) {
  if (!execute) return { onSuccess: false, onFailure: false, andResult: false, orResult: false };
  return {
    onSuccess: true,
    onFailure: false,
    andResult: a && b,
    orResult: a || b
  };
}

/**
 * @flowWeaver workflow
 * @node logic boolOps
 * @connect Start.a -> logic.a
 * @connect Start.b -> logic.b
 * @connect logic.andResult -> Exit.andResult
 * @connect logic.orResult -> Exit.orResult
 */
export function booleanLogic(
  execute: boolean,
  params: { a: boolean; b: boolean }
): { onSuccess: boolean; onFailure: boolean; andResult: boolean; orResult: boolean } {
  throw new Error('Not implemented');
}
`,

  asyncWorkflow: `
/**
 * @flowWeaver nodeType
 * @input ms
 * @input value
 * @output result
 */
async function delay(execute: boolean, ms: number, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  await new Promise(resolve => setTimeout(resolve, ms));
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input a
 * @input b
 * @output sum
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @node delayer delay
 * @node adder add
 * @connect Start.value -> delayer.value
 * @connect Start.delay -> delayer.ms
 * @connect delayer.result -> adder.a
 * @connect Start.addend -> adder.b
 * @connect adder.sum -> Exit.result
 */
export async function asyncWorkflow(
  execute: boolean,
  params: { value: number; delay: number; addend: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`,

  processArray: `
/**
 * @flowWeaver nodeType
 * @input items
 * @output count
 * @output sum
 */
function arrayStats(execute: boolean, items: number[]) {
  if (!execute) return { onSuccess: false, onFailure: false, count: 0, sum: 0 };
  const count = items.length;
  const sum = items.reduce((acc, val) => acc + val, 0);
  return { onSuccess: true, onFailure: false, count, sum };
}

/**
 * @flowWeaver workflow
 * @node stats arrayStats
 * @connect Start.numbers -> stats.items
 * @connect stats.count -> Exit.count
 * @connect stats.sum -> Exit.sum
 */
export function processArray(
  execute: boolean,
  params: { numbers: number[] }
): { onSuccess: boolean; onFailure: boolean; count: number; sum: number } {
  throw new Error('Not implemented');
}
`,

  processObject: `
/**
 * @flowWeaver nodeType
 * @input data
 * @output json
 * @output keyCount
 */
function objectInfo(execute: boolean, data: Record<string, any>) {
  if (!execute) return { onSuccess: false, onFailure: false, json: "", keyCount: 0 };
  return {
    onSuccess: true,
    onFailure: false,
    json: JSON.stringify(data),
    keyCount: Object.keys(data).length
  };
}

/**
 * @flowWeaver workflow
 * @node info objectInfo
 * @connect Start.obj -> info.data
 * @connect info.json -> Exit.json
 * @connect info.keyCount -> Exit.keyCount
 */
export function processObject(
  execute: boolean,
  params: { obj: Record<string, any> }
): { onSuccess: boolean; onFailure: boolean; json: string; keyCount: number } {
  throw new Error('Not implemented');
}
`,

  addFive: `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function addOne(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node n1 addOne
 * @node n2 addOne
 * @node n3 addOne
 * @node n4 addOne
 * @node n5 addOne
 * @connect Start.value -> n1.value
 * @connect n1.result -> n2.value
 * @connect n2.result -> n3.value
 * @connect n3.result -> n4.value
 * @connect n4.result -> n5.value
 * @connect n5.result -> Exit.result
 */
export function addFive(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`,
};

// =============================================================================
// GENERATED MODULES (populated in beforeAll)
// =============================================================================

const modules: Record<string, any> = {};

// Generate ALL workflows once
beforeAll(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [name, source] of Object.entries(SOURCES)) {
    const sourceFile = path.join(OUTPUT_DIR, `${name}.ts`);
    fs.writeFileSync(sourceFile, source, "utf-8");

    const code = await testHelpers.generateFast(sourceFile, name);

    const outputFile = path.join(OUTPUT_DIR, `${name}.generated.ts`);
    fs.writeFileSync(outputFile, code, "utf-8");

    modules[name] = await import(outputFile);
  }
});

afterAll(() => {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
});

// =============================================================================
// BASIC TESTS
// =============================================================================

describe("Basic Workflow Execution", () => {
  describe("Single Node - Addition", () => {
    it("should execute with positive numbers", () => {
      const result = modules.addNumbers.addNumbers(true, { a: 5, b: 3 });
      expect(result.sum).toBe(8);
      expect(result.onSuccess).toBe(true);
      expect(result.onFailure).toBe(false);
    });

    it("should execute with negative numbers", () => {
      const result = modules.addNumbers.addNumbers(true, { a: -5, b: -3 });
      expect(result.sum).toBe(-8);
    });

    it("should execute with zero", () => {
      const result = modules.addNumbers.addNumbers(true, { a: 0, b: 0 });
      expect(result.sum).toBe(0);
    });

    it("should handle execute=false", () => {
      const result = modules.addNumbers.addNumbers(false, { a: 5, b: 3 });
      expect(result.sum).toBe(8);
    });
  });

  describe("Two Nodes - Chain", () => {
    it("should chain operations: (a + b) * factor", () => {
      const testCases = [
        { input: { a: 5, b: 3, factor: 2 }, expected: 16 },
        { input: { a: 10, b: 5, factor: 3 }, expected: 45 },
        { input: { a: 0, b: 0, factor: 100 }, expected: 0 },
        { input: { a: -5, b: 10, factor: 2 }, expected: 10 },
      ];

      for (const { input, expected } of testCases) {
        const result = modules.calculate.calculate(true, input);
        expect(result.result).toBe(expected);
        expect(result.onSuccess).toBe(true);
      }
    });
  });

  describe("String Operations", () => {
    it("should transform and concatenate strings", () => {
      const testCases = [
        { input: { text: "hello", suffix: "!" }, expected: "HELLO!" },
        { input: { text: "world", suffix: "..." }, expected: "WORLD..." },
        { input: { text: "", suffix: "test" }, expected: "test" },
      ];

      for (const { input, expected } of testCases) {
        const result = modules.processString.processString(true, input);
        expect(result.result).toBe(expected);
      }
    });
  });
});

// =============================================================================
// INTERMEDIATE TESTS
// =============================================================================

describe("Intermediate Workflow Execution", () => {
  describe("Branching - Success/Failure Paths", () => {
    it("should execute success path for positive values", () => {
      const result = modules.validateAndDouble.validateAndDouble(true, { value: 5 });
      expect(result.result).toBe(10);
    });

    it("should not execute doubler for negative values", () => {
      const result = modules.validateAndDouble.validateAndDouble(true, { value: -5 });
      expect(result.result).toBeUndefined();
    });
  });

  describe("Multiple Outputs", () => {
    it("should return multiple outputs", () => {
      const testCases = [
        { value: 5, doubled: 10, tripled: 15, squared: 25 },
        { value: 3, doubled: 6, tripled: 9, squared: 9 },
        { value: 0, doubled: 0, tripled: 0, squared: 0 },
      ];

      for (const tc of testCases) {
        const result = modules.multiOutput.multiOutput(true, { value: tc.value });
        expect(result.doubled).toBe(tc.doubled);
        expect(result.tripled).toBe(tc.tripled);
        expect(result.squared).toBe(tc.squared);
      }
    });
  });

  describe("Boolean Logic", () => {
    it("should perform boolean operations", () => {
      const testCases = [
        { a: true, b: true, and: true, or: true },
        { a: true, b: false, and: false, or: true },
        { a: false, b: true, and: false, or: true },
        { a: false, b: false, and: false, or: false },
      ];

      for (const tc of testCases) {
        const result = modules.booleanLogic.booleanLogic(true, { a: tc.a, b: tc.b });
        expect(result.andResult).toBe(tc.and);
        expect(result.orResult).toBe(tc.or);
      }
    });
  });
});

// =============================================================================
// COMPLEX TESTS
// =============================================================================

describe("Complex Workflow Execution", () => {
  describe("Async Operations", () => {
    it("should handle async nodes", async () => {
      const start = Date.now();
      const result = await modules.asyncWorkflow.asyncWorkflow(true, { value: 10, delay: 50, addend: 5 });
      const elapsed = Date.now() - start;

      expect(result.result).toBe(15);
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe("Array Processing", () => {
    it("should process arrays", () => {
      const testCases = [
        { numbers: [1, 2, 3, 4, 5], count: 5, sum: 15 },
        { numbers: [], count: 0, sum: 0 },
        { numbers: [100], count: 1, sum: 100 },
        { numbers: [-1, 1, -2, 2], count: 4, sum: 0 },
      ];

      for (const tc of testCases) {
        const result = modules.processArray.processArray(true, { numbers: tc.numbers });
        expect(result.count).toBe(tc.count);
        expect(result.sum).toBe(tc.sum);
      }
    });
  });

  describe("Object Handling", () => {
    it("should process objects", () => {
      const testCases = [
        { obj: { a: 1, b: 2 }, keyCount: 2 },
        { obj: {}, keyCount: 0 },
        { obj: { nested: { deep: true } }, keyCount: 1 },
      ];

      for (const tc of testCases) {
        const result = modules.processObject.processObject(true, { obj: tc.obj });
        expect(result.keyCount).toBe(tc.keyCount);
        expect(JSON.parse(result.json)).toEqual(tc.obj);
      }
    });
  });

  describe("Long Chain - 5 Nodes", () => {
    it("should chain 5 nodes correctly", () => {
      const testCases = [
        { input: 0, expected: 5 },
        { input: 10, expected: 15 },
        { input: -5, expected: 0 },
        { input: 100, expected: 105 },
      ];

      for (const { input, expected } of testCases) {
        const result = modules.addFive.addFive(true, { value: input });
        expect(result.result).toBe(expected);
      }
    });
  });
});
