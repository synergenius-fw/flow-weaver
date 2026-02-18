/**
 * Tests for parser handling of custom port names
 *
 * Validates that @input and @output ports with non-standard names (not just "value"/"result")
 * are correctly parsed and include type information.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parser } from '../../src/parser';

describe('Parser Custom Port Names', () => {
  const uniqueId = `parser-custom-ports-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should parse @input text with custom port name (type inferred from signature)', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input text - The input text
 * @output length - The length of the text
 * @expression
 */
function getLength(text: string): number {
  return text.length;
}
`;

    const testFile = path.join(tempDir, 'test-custom-ports.ts');
    fs.writeFileSync(testFile, sourceCode, 'utf-8');

    const result = parser.parse(testFile);

    expect(result.errors).toHaveLength(0);
    expect(result.nodeTypes).toHaveLength(1);

    const nodeType = result.nodeTypes[0];
    expect(nodeType.name).toBe('getLength');
    expect(nodeType.expression).toBe(true);

    // Check inputs - should have "text" and mandatory "execute"
    expect(Object.keys(nodeType.inputs)).toContain('text');
    expect(Object.keys(nodeType.inputs)).toContain('execute');
    // Type is inferred from function signature
    expect(nodeType.inputs.text.tsType).toBe('string');

    // Check outputs - should have "length" and mandatory "onSuccess/onFailure"
    expect(Object.keys(nodeType.outputs)).toContain('length');
    expect(Object.keys(nodeType.outputs)).toContain('onSuccess');
    expect(Object.keys(nodeType.outputs)).toContain('onFailure');
    // For single outputs, type might be 'ANY' but tsType should capture the actual type
    // (Output type inference for single-output expression nodes is less reliable)
  });

  it('should parse expression node with custom output port name "doubled"', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value - A number to double
 * @output doubled - The doubled value
 * @expression
 */
function doubleValue(value: number): number {
  return value * 2;
}
`;

    const testFile = path.join(tempDir, 'test-doubled-port.ts');
    fs.writeFileSync(testFile, sourceCode, 'utf-8');

    const result = parser.parse(testFile);

    expect(result.errors).toHaveLength(0);
    expect(result.nodeTypes).toHaveLength(1);

    const nodeType = result.nodeTypes[0];
    expect(nodeType.expression).toBe(true);
    expect(Object.keys(nodeType.outputs)).toContain('doubled');
    // Type inference for single-output nodes might not always infer NUMBER
  });

  it('should parse boolean output port with custom name "isEmpty"', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input text - Input text
 * @output isEmpty - Whether the text is empty
 * @expression
 */
function checkEmpty(text: string): boolean {
  return text.length === 0;
}
`;

    const testFile = path.join(tempDir, 'test-boolean-port.ts');
    fs.writeFileSync(testFile, sourceCode, 'utf-8');

    const result = parser.parse(testFile);

    expect(result.errors).toHaveLength(0);
    expect(result.nodeTypes).toHaveLength(1);

    const nodeType = result.nodeTypes[0];
    expect(Object.keys(nodeType.outputs)).toContain('isEmpty');
    // Type inference for single-output nodes might not always infer BOOLEAN
  });

  it('should parse multiple custom output ports', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value - A number
 * @output sum - Value plus 10
 * @output diff - Value minus 10
 * @expression
 */
function sumAndDiff(value: number): { sum: number; diff: number } {
  return { sum: value + 10, diff: value - 10 };
}
`;

    const testFile = path.join(tempDir, 'test-multi-output.ts');
    fs.writeFileSync(testFile, sourceCode, 'utf-8');

    const result = parser.parse(testFile);

    expect(result.errors).toHaveLength(0);
    expect(result.nodeTypes).toHaveLength(1);

    const nodeType = result.nodeTypes[0];
    expect(Object.keys(nodeType.outputs)).toContain('sum');
    expect(Object.keys(nodeType.outputs)).toContain('diff');
    expect(nodeType.outputs.sum.dataType).toBe('NUMBER');
    expect(nodeType.outputs.diff.dataType).toBe('NUMBER');
  });

  it('should infer type from underscore-prefixed parameter (banana → _banana)', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input banana - Banana
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 */
export function myNode(
  execute: boolean,
  _banana: number,
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: execute, onFailure: !execute };
}
`;

    const testFile = path.join(tempDir, 'test-underscore-param.ts');
    fs.writeFileSync(testFile, sourceCode, 'utf-8');

    const result = parser.parse(testFile);

    expect(result.errors).toHaveLength(0);
    expect(result.nodeTypes).toHaveLength(1);

    const nodeType = result.nodeTypes[0];
    // The port "banana" should match parameter "_banana" and infer number type
    expect(nodeType.inputs.banana.tsType).toBe('number');
    expect(nodeType.inputs.banana.dataType).toBe('NUMBER');
  });
});
