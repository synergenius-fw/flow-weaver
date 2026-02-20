/**
 * E2E tests for recursive workflow execution
 * Optimized: Generate ALL code once in top-level beforeAll
 *
 * Tests:
 * 1. Depth protection - prevent infinite recursion
 * 2. Workflow calling workflow - correct parameter passing
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const OUTPUT_DIR = path.join(os.tmpdir(), `recursive-workflow-tests-${process.pid}`);

// =============================================================================
// SOURCE CODE DEFINITIONS
// =============================================================================

const SOURCES = {
  infiniteLoop: `
/**
 * @flowWeaver nodeType
 * @input n
 * @output result
 */
function passThrough(execute: boolean, n: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: n + 1 };
}

/**
 * This workflow always recurses - no base case.
 * It should be caught by depth protection.
 *
 * @flowWeaver workflow
 * @node pass passThrough
 * @node self infiniteLoop
 * @connect Start.n -> pass.n
 * @connect pass.result -> self.n
 * @connect self.result -> Exit.result
 * @connect self.onSuccess -> Exit.onSuccess
 * @connect self.onFailure -> Exit.onFailure
 * @param n - Counter
 * @returns result - Result
 */
export function infiniteLoop(
  execute: boolean,
  params: { n: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`,

  outerQuadruple: `
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * Inner workflow that doubles a value
 *
 * @flowWeaver workflow
 * @node d double
 * @connect Start.x -> d.value
 * @connect d.doubled -> Exit.y
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param x - Input value
 * @returns y - Doubled value
 */
export function innerDouble(
  execute: boolean,
  params: { x: number }
): { onSuccess: boolean; onFailure: boolean; y: number } {
  throw new Error('Not implemented');
}

/**
 * Outer workflow that uses inner workflow twice
 *
 * @flowWeaver workflow
 * @node first innerDouble
 * @node second innerDouble
 * @connect Start.value -> first.x
 * @connect first.y -> second.x
 * @connect second.y -> Exit.result
 * @connect second.onSuccess -> Exit.onSuccess
 * @connect second.onFailure -> Exit.onFailure
 * @param value - Input value
 * @returns result - Quadrupled value
 */
export function outerQuadruple(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`,

  outerAdd: `
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
 * Inner workflow that adds two numbers
 *
 * @flowWeaver workflow
 * @node adder add
 * @connect Start.x -> adder.a
 * @connect Start.y -> adder.b
 * @connect adder.sum -> Exit.result
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param x - First number
 * @param y - Second number
 * @returns result - Sum
 */
export function innerAdd(
  execute: boolean,
  params: { x: number; y: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}

/**
 * Outer workflow that uses inner add workflow
 *
 * @flowWeaver workflow
 * @node inner innerAdd
 * @connect Start.a -> inner.x
 * @connect Start.b -> inner.y
 * @connect inner.result -> Exit.sum
 * @connect inner.onSuccess -> Exit.onSuccess
 * @connect inner.onFailure -> Exit.onFailure
 * @param a - First number
 * @param b - Second number
 * @returns sum - Result
 */
export function outerAdd(
  execute: boolean,
  params: { a: number; b: number }
): { onSuccess: boolean; onFailure: boolean; sum: number } {
  throw new Error('Not implemented');
}
`,
};

// =============================================================================
// SHARED MODULE GENERATION
// =============================================================================

const modules: Record<string, any> = {};

beforeAll(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Write all source files first
  for (const [name, source] of Object.entries(SOURCES)) {
    fs.writeFileSync(path.join(OUTPUT_DIR, `${name}.ts`), source, "utf-8");
  }

  // Generate and import in parallel to avoid sequential ts-morph bottleneck
  await Promise.all(
    Object.keys(SOURCES).map(async (name) => {
      const sourceFile = path.join(OUTPUT_DIR, `${name}.ts`);
      const code = await testHelpers.generateFast(sourceFile, name);
      const outputFile = path.join(OUTPUT_DIR, `${name}.generated.ts`);
      fs.writeFileSync(outputFile, code, "utf-8");
      modules[name] = await import(outputFile);
    })
  );
});

afterAll(() => {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
});

// =============================================================================
// DEPTH PROTECTION TESTS
// =============================================================================

describe("Recursive Workflow Depth Protection", () => {
  describe("Infinite recursion prevention", () => {
    it("should throw error when max recursion depth (1000) exceeded", () => {
      expect(() => modules.infiniteLoop.infiniteLoop(true, { n: 0 }))
        .toThrow(/max.*recursion.*depth.*exceeded/i);
    });

    it("should include depth info in error message", () => {
      try {
        modules.infiniteLoop.infiniteLoop(true, { n: 0 });
        expect.fail("Should have thrown an error");
      } catch (e: any) {
        expect(e.message).toContain("1000");
      }
    });
  });
});

// =============================================================================
// WORKFLOW CALLING WORKFLOW TESTS
// =============================================================================

describe("Workflow Calling Workflow", () => {
  describe("Simple workflow chain", () => {
    it("should execute outer workflow that calls inner workflow", async () => {
      const result = await modules.outerQuadruple.outerQuadruple(true, { value: 5 });
      expect(result.result).toBe(20);
    });

    it("should work with different values", async () => {
      expect((await modules.outerQuadruple.outerQuadruple(true, { value: 0 })).result).toBe(0);
      expect((await modules.outerQuadruple.outerQuadruple(true, { value: 3 })).result).toBe(12);
      expect((await modules.outerQuadruple.outerQuadruple(true, { value: -2 })).result).toBe(-8);
    });
  });

  describe("Workflow with multiple inputs", () => {
    it("should pass multiple inputs correctly to nested workflow", async () => {
      const result = await modules.outerAdd.outerAdd(true, { a: 5, b: 3 });
      expect(result.sum).toBe(8);
    });

    it("should handle different input combinations", async () => {
      expect((await modules.outerAdd.outerAdd(true, { a: 0, b: 0 })).sum).toBe(0);
      expect((await modules.outerAdd.outerAdd(true, { a: -5, b: 10 })).sum).toBe(5);
      expect((await modules.outerAdd.outerAdd(true, { a: 100, b: -50 })).sum).toBe(50);
    });
  });
});
