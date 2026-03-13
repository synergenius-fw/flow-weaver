/**
 * Additional coverage for unified.ts:
 * - CONJUNCTION with multiple sources per port (line 2040) — OR grouping inside AND
 * - DISJUNCTION executeWhen strategy (lines 2049-2064)
 * - CUSTOM executeWhen with an actual customExecuteCondition string (lines 2069-2072)
 * - CUSTOM fallback with multiple sources per port (lines 2078-2087)
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Unified Generator: CONJUNCTION with multiple sources per port', () => {
  it('generates OR-grouped conditions inside an AND guard when a port has multiple sources', async () => {
    // Two producers feed into the same input port of a CONJUNCTION node.
    // The guard should produce (sourceA || sourceB) for that port.
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function producerA(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function producerB(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * @flowWeaver nodeType
 * @input a - number
 * @input b - number
 * @output sum - number
 * @executeWhen CONJUNCTION
 */
export async function adder(execute: boolean, a: number, b: number) {
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} result - Result
 * @node pA producerA
 * @node pB producerB
 * @node add adder
 * @connect Start.num -> pA.value
 * @connect Start.num -> pB.value
 * @connect pA.result -> add.a
 * @connect pB.result -> add.a
 * @connect Start.num -> add.b
 * @connect add.sum -> Exit.result
 */
export async function conjunctionMultiSource(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'conjunction-multi-source.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'conjunctionMultiSource');
      // Multiple sources on a single port under CONJUNCTION should produce an OR group
      // wrapped in parentheses, e.g. (producerAIdx !== undefined || producerBIdx !== undefined)
      expect(code).toMatch(/\(.*Idx !== undefined \|\|.*Idx !== undefined\)/);
    } finally {
      global.testHelpers.cleanupOutput('conjunction-multi-source.ts');
    }
  });
});

describe('Unified Generator: DISJUNCTION executeWhen strategy', () => {
  it('generates OR conditions across all input ports', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function producerA(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function producerB(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * @flowWeaver nodeType
 * @input a - number
 * @input b - number
 * @output sum - number
 * @executeWhen DISJUNCTION
 */
export async function adder(execute: boolean, a: number, b: number) {
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} result - Result
 * @node pA producerA
 * @node pB producerB
 * @node add adder
 * @connect Start.num -> pA.value
 * @connect Start.num -> pB.value
 * @connect pA.result -> add.a
 * @connect pB.result -> add.b
 * @connect add.sum -> Exit.result
 */
export async function disjunctionWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'disjunction-workflow.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'disjunctionWorkflow');
      // DISJUNCTION should use || between ALL sources (not grouped by port like CONJUNCTION)
      expect(code).toMatch(/if\s*\(.*\|\|.*\)/);
      expect(code).toContain('adder');
    } finally {
      global.testHelpers.cleanupOutput('disjunction-workflow.ts');
    }
  });
});

describe('Unified Generator: CUSTOM executeWhen with condition string', () => {
  it('uses the provided customExecuteCondition when present', async () => {
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
 * @input a - number
 * @output result - number
 * @executeWhen CUSTOM
 * @customExecuteCondition ctx.flags.shouldRun === true
 */
export async function customGuard(execute: boolean, a: number) {
  return { onSuccess: true, onFailure: false, result: a + 1 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} result - Result
 * @node d doubleIt
 * @node cg customGuard
 * @connect Start.num -> d.value
 * @connect d.doubled -> cg.a
 * @connect cg.result -> Exit.result
 */
export async function customConditionWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'custom-condition.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'customConditionWorkflow');
      // The custom condition string should appear verbatim in the generated if-guard
      expect(code).toContain('ctx.flags.shouldRun === true');
    } finally {
      global.testHelpers.cleanupOutput('custom-condition.ts');
    }
  });
});

describe('Unified Generator: CUSTOM fallback with multi-source ports', () => {
  it('falls back to conjunction with OR grouping when CUSTOM has no condition and multi-source port', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function producerA(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function producerB(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * @flowWeaver nodeType
 * @input a - number
 * @output result - number
 * @executeWhen CUSTOM
 */
export async function customNoCondition(execute: boolean, a: number) {
  return { onSuccess: true, onFailure: false, result: a };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} result - Result
 * @node pA producerA
 * @node pB producerB
 * @node cn customNoCondition
 * @connect Start.num -> pA.value
 * @connect Start.num -> pB.value
 * @connect pA.result -> cn.a
 * @connect pB.result -> cn.a
 * @connect cn.result -> Exit.result
 */
export async function customFallbackMultiSource(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'custom-fallback-multi.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'customFallbackMultiSource');
      // CUSTOM without condition falls back to CONJUNCTION, and with multiple sources
      // on port 'a', should produce an OR-grouped condition inside parentheses
      expect(code).toMatch(/\(.*Idx !== undefined \|\|.*Idx !== undefined\)/);
      expect(code).toContain('customNoCondition');
    } finally {
      global.testHelpers.cleanupOutput('custom-fallback-multi.ts');
    }
  });
});
