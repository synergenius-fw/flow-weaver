/**
 * Tests that @coerce annotations produce inline JS coercion expressions in
 * generated code rather than synthetic function calls like __fw_toNumber(...).
 */

import * as fs from 'fs';
import * as path from 'path';

/** Two simple node types and a workflow that pipes through a @coerce annotation. */
function makeCoerceSource(
  coerceInstanceId: string,
  targetType: string,
  workflowName: string,
): string {
  return `
/**
 * @flowWeaver nodeType
 * @input value - string
 * @output result - string
 */
export async function produceValue(execute: boolean, value: string) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value - any
 * @output result - string
 */
export async function consumeValue(execute: boolean, value: any) {
  return { onSuccess: true, onFailure: false, result: String(value) };
}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {string} output - The result
 * @node a produceValue
 * @node b consumeValue
 * @connect Start.input -> a.value
 * @coerce ${coerceInstanceId} a.result -> b.value as ${targetType}
 * @connect b.result -> Exit.output
 */
export async function ${workflowName}(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; output: string;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();
}

describe('Coerce Codegen - inline expressions', () => {
  it('should generate Number() for @coerce as number', async () => {
    const source = makeCoerceSource('c1', 'number', 'coerceNumber');
    const testFile = path.join(global.testHelpers.outputDir, 'coerce-number.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'coerceNumber');
      expect(code).toContain('Number(');
    } finally {
      global.testHelpers.cleanupOutput('coerce-number.ts');
    }
  });

  it('should generate String() for @coerce as string', async () => {
    const source = makeCoerceSource('c1', 'string', 'coerceString');
    const testFile = path.join(global.testHelpers.outputDir, 'coerce-string.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'coerceString');
      expect(code).toContain('String(');
    } finally {
      global.testHelpers.cleanupOutput('coerce-string.ts');
    }
  });

  it('should generate Boolean() for @coerce as boolean', async () => {
    const source = makeCoerceSource('c1', 'boolean', 'coerceBoolean');
    const testFile = path.join(global.testHelpers.outputDir, 'coerce-boolean.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'coerceBoolean');
      expect(code).toContain('Boolean(');
    } finally {
      global.testHelpers.cleanupOutput('coerce-boolean.ts');
    }
  });

  it('should generate JSON.stringify() for @coerce as json', async () => {
    const source = makeCoerceSource('c1', 'json', 'coerceJson');
    const testFile = path.join(global.testHelpers.outputDir, 'coerce-json.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'coerceJson');
      expect(code).toContain('JSON.stringify(');
    } finally {
      global.testHelpers.cleanupOutput('coerce-json.ts');
    }
  });

  it('should generate JSON.parse() for @coerce as object', async () => {
    const source = makeCoerceSource('c1', 'object', 'coerceObject');
    const testFile = path.join(global.testHelpers.outputDir, 'coerce-object.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'coerceObject');
      expect(code).toContain('JSON.parse(');
    } finally {
      global.testHelpers.cleanupOutput('coerce-object.ts');
    }
  });

  it('should NOT emit __fw_toNumber as a function call', async () => {
    const source = makeCoerceSource('c1', 'number', 'coerceNoSynthetic');
    const testFile = path.join(global.testHelpers.outputDir, 'coerce-no-synthetic.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'coerceNoSynthetic');
      // The generator must inline the expression, not call the synthetic function name
      expect(code).not.toContain('__fw_toNumber(');
      expect(code).not.toContain('__fw_toString(');
      expect(code).not.toContain('__fw_toBoolean(');
      expect(code).not.toContain('__fw_toJSON(');
      expect(code).not.toContain('__fw_parseJSON(');
      // But it should still have the inline Number() call
      expect(code).toContain('Number(');
    } finally {
      global.testHelpers.cleanupOutput('coerce-no-synthetic.ts');
    }
  });
});
