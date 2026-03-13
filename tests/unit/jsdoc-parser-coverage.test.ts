/**
 * Coverage tests for src/jsdoc-parser.ts
 * Targets lines 1498-1499 (invalid @throttle warning) and 1569
 * (parseDefaultValue fallback to string for non-JSON values).
 */

import { jsdocParser } from '../../src/jsdoc-parser';
import { extractFunctionLikes } from '../../src/function-like';
import { getSharedProject } from '../../src/shared-project';

describe('JSDocParser coverage', () => {
  const project = getSharedProject();

  it('produces warning for invalid @throttle format', () => {
    // @throttle requires a specific format like @throttle 100ms
    // An invalid format should produce a warning.
    const code = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @throttle !!!invalid
 */
export async function testWorkflow(execute: boolean, params: {}) {
  return { onSuccess: true, onFailure: false };
}
`;

    const sourceFile = project.createSourceFile('throttle-invalid.ts', code, { overwrite: true });
    const functions = extractFunctionLikes(sourceFile);
    expect(functions.length).toBe(1);

    const warnings: string[] = [];
    const config = jsdocParser.parseWorkflow(functions[0], warnings);

    expect(config).not.toBeNull();
    // Should have a warning about invalid throttle format
    expect(warnings.some(w => w.includes('@throttle'))).toBe(true);
  });

  it('parses non-JSON default value as string via parseDefaultValue', () => {
    // @input [name=someNonJsonString] should have default as the bare string
    const code = `
/**
 * @flowWeaver nodeType
 * @input [mode=fast]
 */
function myNode(execute: boolean, mode: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;

    const sourceFile = project.createSourceFile('default-string.ts', code, { overwrite: true });
    const functions = extractFunctionLikes(sourceFile);
    expect(functions.length).toBe(1);

    const warnings: string[] = [];
    const config = jsdocParser.parseNodeType(functions[0], warnings);

    expect(config).not.toBeNull();
    expect(config!.inputs).toBeDefined();
    expect(config!.inputs!['mode']).toBeDefined();
    // "fast" is not valid JSON, so parseDefaultValue should return it as a string
    expect(config!.inputs!['mode'].defaultValue).toBe('fast');
  });
});
