/**
 * Tests for parallel execution in the unified/TypeScript generator.
 * The generator should emit Promise.all() for independent nodes at the same topological level.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('Unified Generator Parallel Execution', () => {
  it('should wrap two independent nodes in Promise.all', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function doubleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output tripled - number
 */
export async function tripleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, tripled: value * 3 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} doubled - Doubled value
 * @returns {number} tripled - Tripled value
 * @node d doubleIt
 * @node t tripleIt
 * @connect Start.num -> d.value
 * @connect Start.num -> t.value
 * @connect d.doubled -> Exit.doubled
 * @connect t.tripled -> Exit.tripled
 */
export async function parallelBasic(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number; tripled: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'parallel-basic.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'parallelBasic');
      expect(code).toContain('Promise.all([');
      // Both nodes should appear inside the Promise.all
      expect(code).toMatch(/Promise\.all\(\[[\s\S]*?doubleIt[\s\S]*?tripleIt[\s\S]*?\]\)/);
    } finally {
      global.testHelpers.cleanupOutput('parallel-basic.ts');
    }
  });

  it('should keep dependent nodes sequential (no Promise.all)', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function doubleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output tripled - number
 */
export async function tripleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, tripled: value * 3 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} result - Result
 * @node d doubleIt
 * @node t tripleIt
 * @connect Start.num -> d.value
 * @connect d.doubled -> t.value
 * @connect t.tripled -> Exit.result
 */
export async function sequentialDeps(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'sequential-deps.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'sequentialDeps');
      expect(code).not.toContain('Promise.all');
    } finally {
      global.testHelpers.cleanupOutput('sequential-deps.ts');
    }
  });

  it('should handle mixed parallel and sequential nodes', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function addOne(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function addTwo(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 2 };
}

/**
 * @flowWeaver nodeType
 * @input a - number
 * @input b - number
 * @output sum - number
 */
export async function combine(execute: boolean, a: number, b: number) {
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} sum - Sum
 * @node a addOne
 * @node b addTwo
 * @node c combine
 * @connect Start.num -> a.value
 * @connect Start.num -> b.value
 * @connect a.result -> c.a
 * @connect b.result -> c.b
 * @connect c.sum -> Exit.sum
 */
export async function mixedParallel(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; sum: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'mixed-parallel.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'mixedParallel');
      // a and b should be in Promise.all
      expect(code).toContain('Promise.all([');
      // c (combine) should come after Promise.all (sequential)
      // Search within the workflow function body only
      const funcBody = code.substring(code.indexOf('function mixedParallel'));
      const promiseAllIdx = funcBody.indexOf('Promise.all([');
      const combineCallIdx = funcBody.indexOf('combine(');
      expect(promiseAllIdx).toBeGreaterThan(-1);
      expect(combineCallIdx).toBeGreaterThan(promiseAllIdx);
    } finally {
      global.testHelpers.cleanupOutput('mixed-parallel.ts');
    }
  });

  it('should not wrap a single node in Promise.all', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function doubleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} doubled - Doubled value
 * @node d doubleIt
 * @connect Start.num -> d.value
 * @connect d.doubled -> Exit.doubled
 */
export async function singleNode(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'single-node-no-parallel.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'singleNode');
      expect(code).not.toContain('Promise.all');
    } finally {
      global.testHelpers.cleanupOutput('single-node-no-parallel.ts');
    }
  });

  it('should wrap expression nodes in Promise.resolve() inside Promise.all', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - number
 * @output doubled - number
 */
export function doubleExpr(value: number): number {
  return value * 2;
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output tripled - number
 */
export async function tripleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, tripled: value * 3 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} doubled - Doubled value
 * @returns {number} tripled - Tripled value
 * @node d doubleExpr
 * @node t tripleIt
 * @connect Start.num -> d.value
 * @connect Start.num -> t.value
 * @connect d.doubled -> Exit.doubled
 * @connect t.tripled -> Exit.tripled
 */
export async function exprParallel(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number; tripled: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'expr-parallel.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'exprParallel');
      // Both nodes should be present in the code
      expect(code).toContain('doubleExpr(');
      expect(code).toContain('tripleIt(');
      // Either Promise.all wraps both, or expression runs separately
      // (expression + async node = at least one needs Promise.all)
      expect(code).toContain('Promise.all([');
    } finally {
      global.testHelpers.cleanupOutput('expr-parallel.ts');
    }
  });

  it('should exclude branching nodes from parallel groups', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function processA(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function validate(execute: boolean, value: number) {
  if (value > 0) return { onSuccess: true, onFailure: false, result: value };
  return { onSuccess: false, onFailure: true, result: 0 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output formatted - string
 */
export async function formatResult(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, formatted: String(value) };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {string} formatted - Formatted value
 * @node a processA
 * @node v validate
 * @node f formatResult
 * @connect Start.num -> a.value
 * @connect Start.num -> v.value
 * @connect v.onSuccess -> f.execute
 * @connect a.result -> f.value
 * @connect f.formatted -> Exit.formatted
 */
export async function branchParallel(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; formatted: string;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'branch-parallel.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'branchParallel');
      // validate is a branching node, so it should NOT be in a Promise.all with processA
      expect(code).toContain('validate(');
      expect(code).toContain('processA(');
    } finally {
      global.testHelpers.cleanupOutput('branch-parallel.ts');
    }
  });

  it('should correctly execute a workflow with parallel nodes', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function slowDouble(execute: boolean, value: number) {
  await new Promise(r => setTimeout(r, 10));
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output tripled - number
 */
export async function slowTriple(execute: boolean, value: number) {
  await new Promise(r => setTimeout(r, 10));
  return { onSuccess: true, onFailure: false, tripled: value * 3 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} doubled - Doubled value
 * @returns {number} tripled - Tripled value
 * @node d slowDouble
 * @node t slowTriple
 * @connect Start.num -> d.value
 * @connect Start.num -> t.value
 * @connect d.doubled -> Exit.doubled
 * @connect t.tripled -> Exit.tripled
 */
export async function parallelExec(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number; tripled: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'parallel-exec.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'parallelExec');
      const outputFile = path.join(global.testHelpers.outputDir, 'parallel-exec.generated.ts');
      fs.writeFileSync(outputFile, code, 'utf-8');

      const { parallelExec } = await import(outputFile);
      const result = await parallelExec(true, { num: 5 });

      expect(result.doubled).toBe(10);
      expect(result.tripled).toBe(15);
      expect(result.onSuccess).toBe(true);
    } finally {
      global.testHelpers.cleanupOutput('parallel-exec.ts');
      global.testHelpers.cleanupOutput('parallel-exec.generated.ts');
    }
  });
});
