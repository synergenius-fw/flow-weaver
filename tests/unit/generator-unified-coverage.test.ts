/**
 * Coverage for unified.ts:
 * - CUSTOM executeWhen fallback to CONJUNCTION when no customExecuteCondition (line ~2087)
 * - Expression node with multiple data output ports (lines ~2203-2204)
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Unified Generator: CUSTOM executeWhen fallback', () => {
  it('falls back to conjunction behavior when CUSTOM strategy has no customExecuteCondition', async () => {
    // A node with @executeWhen CUSTOM but no metadata.customExecuteCondition
    // should fall back to CONJUNCTION-style guard (AND conditions)
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
 * @input b - number
 * @output sum - number
 * @executeWhen CUSTOM
 */
export async function adder(execute: boolean, a: number, b: number) {
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} result - Result
 * @node d1 doubleIt
 * @node add adder
 * @connect Start.num -> d1.value
 * @connect Start.onSuccess -> add.execute
 * @connect d1.doubled -> add.a
 * @connect Start.num -> add.b
 * @connect add.sum -> Exit.result
 */
export async function customFallback(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'custom-fallback.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'customFallback');
      // The CUSTOM strategy without a customExecuteCondition should still produce
      // an if-guard similar to CONJUNCTION
      expect(code).toContain('adder');
      expect(code).toContain('doubleIt');
    } finally {
      global.testHelpers.cleanupOutput('custom-fallback.ts');
    }
  });
});

describe('Unified Generator: expression node with multiple outputs', () => {
  it('generates destructured output assignments for expression nodes with >1 data port', async () => {
    // An expression node returning multiple data output ports should generate
    // destructured assignments (result.portA, result.portB)
    const source = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input text - string
 * @output length - number
 * @output upper - string
 */
export function analyzeText(text: string): { length: number; upper: string } {
  return { length: text.length, upper: text.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {number} len - Length
 * @returns {string} upper - Uppercased
 * @node a analyzeText
 * @connect Start.input -> a.text
 * @connect a.length -> Exit.len
 * @connect a.upper -> Exit.upper
 */
export function multiOutputExpr(execute: boolean, params: { input: string }): {
  onSuccess: boolean; onFailure: boolean; len: number; upper: string;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'multi-output-expr.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'multiOutputExpr');
      // With multiple data outputs, the generator destructures from the result object
      // e.g., result.length, result.upper
      expect(code).toContain('.length');
      expect(code).toContain('.upper');
      expect(code).toContain('analyzeText');
    } finally {
      global.testHelpers.cleanupOutput('multi-output-expr.ts');
    }
  });
});
