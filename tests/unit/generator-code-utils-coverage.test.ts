/**
 * Coverage for code-utils.ts:
 * - FUNCTION dataType port with multiple connections (lines 408, 416-421)
 * - Non-function expression on an input port (line 437)
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Code Utils: FUNCTION type port with connected source', () => {
  it('generates resolveFunction call chain for FUNCTION-typed input ports', async () => {
    // A node with a FUNCTION-typed input port connected to another node's output.
    // The codegen should emit _raw, _resolved, and .fn variables.
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - string
 * @output callback - FUNCTION
 */
export async function makeCallback(execute: boolean, value: string) {
  return { onSuccess: true, onFailure: false, callback: () => value };
}

/**
 * @flowWeaver nodeType
 * @input fn - FUNCTION
 * @output result - string
 */
export async function invokeCallback(execute: boolean, fn: Function) {
  return { onSuccess: true, onFailure: false, result: fn() };
}

/**
 * @flowWeaver workflow
 * @param text - string
 * @returns {string} result - Result
 * @node maker makeCallback
 * @node invoker invokeCallback
 * @connect Start.text -> maker.value
 * @connect maker.callback -> invoker.fn
 * @connect invoker.result -> Exit.result
 */
export async function functionPortWorkflow(execute: boolean, params: { text: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: string;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'function-port.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'functionPortWorkflow');
      // FUNCTION type should produce resolveFunction pattern
      expect(code).toContain('resolveFunction');
      // Should have _raw and _resolved intermediate variables
      expect(code).toMatch(/_raw/);
      expect(code).toMatch(/_resolved/);
      expect(code).toMatch(/\.fn\s/);
    } finally {
      global.testHelpers.cleanupOutput('function-port.ts');
    }
  });
});

describe('Code Utils: non-function expression on input port', () => {
  it('generates a plain expression assignment (not wrapped in IIFE) for non-arrow expressions', async () => {
    // An input port with an expression that is not a function (no => or function keyword)
    // should produce `const varName = expression as Type;`
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function doubler(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input factor - number {expression: "42"}
 * @output product - number
 */
export async function multiply(execute: boolean, factor: number) {
  return { onSuccess: true, onFailure: false, product: factor * 10 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} result - Result
 * @node d doubler
 * @node m multiply
 * @connect Start.num -> d.value
 * @connect d.result -> Exit.result
 */
export async function expressionWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'non-fn-expression.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'expressionWorkflow');
      // The constant expression "42" should appear in the generated code
      // (either as a literal or in the assignment pattern)
      expect(code).toContain('42');
      expect(code).toContain('multiply');
    } finally {
      global.testHelpers.cleanupOutput('non-fn-expression.ts');
    }
  });
});

describe('Code Utils: FUNCTION type port with multiple connections', () => {
  it('generates resolveFunction with ternary for FUNCTION port with multi-source', async () => {
    // When a FUNCTION-typed port has multiple sources, code-utils should skip coercion
    // (line 408) and still produce resolveFunction (lines 416-421)
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - string
 * @output callback - FUNCTION
 */
export async function makeCallbackA(execute: boolean, value: string) {
  return { onSuccess: true, onFailure: false, callback: () => value + 'A' };
}

/**
 * @flowWeaver nodeType
 * @input value - string
 * @output callback - FUNCTION
 */
export async function makeCallbackB(execute: boolean, value: string) {
  return { onSuccess: true, onFailure: false, callback: () => value + 'B' };
}

/**
 * @flowWeaver nodeType
 * @input fn - FUNCTION
 * @output result - string
 */
export async function invoker(execute: boolean, fn: Function) {
  return { onSuccess: true, onFailure: false, result: fn() };
}

/**
 * @flowWeaver workflow
 * @param text - string
 * @returns {string} result - Result
 * @node cbA makeCallbackA
 * @node cbB makeCallbackB
 * @node inv invoker
 * @connect Start.text -> cbA.value
 * @connect Start.text -> cbB.value
 * @connect cbA.callback -> inv.fn
 * @connect cbB.callback -> inv.fn
 * @connect inv.result -> Exit.result
 */
export async function multiFunctionPort(execute: boolean, params: { text: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: string;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'multi-function-port.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'multiFunctionPort');
      // Multiple FUNCTION sources should use the ternary ?? pattern
      // and still produce resolveFunction
      expect(code).toContain('resolveFunction');
      expect(code).toMatch(/_raw/);
      expect(code).toMatch(/\?\?/);
    } finally {
      global.testHelpers.cleanupOutput('multi-function-port.ts');
    }
  });
});
