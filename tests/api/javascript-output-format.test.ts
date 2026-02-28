/**
 * Tests for outputFormat: 'javascript' support
 *
 * When compileWorkflow or generateCode is called with outputFormat: 'javascript',
 * the generated code should be valid JavaScript (no TypeScript syntax).
 */

import { generateCode } from '../../src/api/generate';
import { generateInlineRuntime, generateInlineDebugClient } from '../../src/api/inline-runtime';
import { parser } from '../../src/parser';

const SIMPLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function greet(execute: boolean, name: string): { onSuccess: boolean; greeting: string } {
  return { onSuccess: true, greeting: \`Hello, \${name}!\` };
}

/**
 * @flowWeaver workflow
 * @node g greet
 * @connect Start.name -> g.name
 * @connect g.greeting -> Exit.greeting
 */
export function helloWorkflow(execute: boolean, name: string): Promise<{ onSuccess: boolean; greeting: string }> {
  throw new Error("Not implemented");
}
`;

/** TypeScript-only syntax patterns that must not appear in JavaScript output */
const TS_PATTERNS = [
  /^type\s+\w+\s*=/m,                     // type Foo = ...
  /^interface\s+\w+\s*\{/m,               // interface Foo { ... }
  /^declare\s+(const|function|class)\s+/m, // declare const/function/class ...
  /:\s*(string|number|boolean|void)\s*[;,)=]/,  // basic type annotations
  /:\s*TStatusType/,                       // custom type annotations
  /:\s*TDebugger/,                         // custom type annotations
  /:\s*TVariableIdentification/,           // custom type annotations
  /:\s*VariableAddress/,                   // custom type annotations
  /:\s*ExecutionInfo/,                     // custom type annotations
  /:\s*VariableValue/,                     // custom type annotations
  /:\s*GeneratedExecutionContext/,         // custom type annotations
  /:\s*CancellationError/,                // custom type annotations
  /as\s+\w+\s*[;,)]/,                     // type assertions: foo as Bar;
];

/**
 * Check if a string contains TypeScript-only syntax.
 * Returns the first match found, or null if clean JavaScript.
 */
function findTypeScriptSyntax(code: string): string | null {
  // Check for type/interface/declare statements (line-by-line for accuracy)
  const lines = code.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    if (/^type\s+\w+/.test(trimmed)) return `type declaration: ${trimmed.slice(0, 60)}`;
    if (/^interface\s+\w+/.test(trimmed)) return `interface declaration: ${trimmed.slice(0, 60)}`;
    if (/^declare\s+(const|function|class|var|let)\s+/.test(trimmed))
      return `declare statement: ${trimmed.slice(0, 60)}`;
    if (/^export\s+type\s+\w+/.test(trimmed)) return `exported type: ${trimmed.slice(0, 60)}`;
    if (/^export\s+interface\s+\w+/.test(trimmed))
      return `exported interface: ${trimmed.slice(0, 60)}`;
  }
  return null;
}

describe('JavaScript Output Format', () => {
  describe('generateInlineRuntime', () => {
    it('should strip TypeScript types when outputFormat is javascript (production)', () => {
      const code = generateInlineRuntime(true, false, 'javascript');

      const tsFound = findTypeScriptSyntax(code);
      expect(tsFound).toBeNull();

      // Should still contain the class and its methods
      // esbuild may rename the class (e.g., _GeneratedExecutionContext) but the
      // name is preserved via __name() or let assignment
      expect(code).toContain('GeneratedExecutionContext');
      expect(code).toContain('CancellationError');
    });

    it('should strip TypeScript types when outputFormat is javascript (development)', () => {
      const code = generateInlineRuntime(false, false, 'javascript');

      const tsFound = findTypeScriptSyntax(code);
      expect(tsFound).toBeNull();

      // Should still contain the class and its methods
      expect(code).toContain('GeneratedExecutionContext');
      expect(code).toContain('CancellationError');
    });

    it('should still include TypeScript types when outputFormat is typescript', () => {
      const code = generateInlineRuntime(true, false, 'typescript');

      // Should contain TS-only syntax
      expect(code).toContain('type TStatusType');
      expect(code).toContain('interface VariableAddress');
    });

    it('should default to typescript outputFormat when not specified', () => {
      const code = generateInlineRuntime(true, false);

      // Default behavior unchanged - should contain TS types
      expect(code).toContain('type TStatusType');
      expect(code).toContain('interface VariableAddress');
    });
  });

  describe('generateCode', () => {
    it('should produce valid JavaScript when outputFormat is javascript', () => {
      const result = parser.parseFromString(SIMPLE_WORKFLOW, 'hello.ts');
      expect(result.errors).toHaveLength(0);

      const generated = generateCode(result.workflows[0], {
        production: true,
        outputFormat: 'javascript',
      });

      const tsFound = findTypeScriptSyntax(generated as string);
      expect(tsFound).toBeNull();

      // Should still have the workflow function
      expect(generated).toContain('function helloWorkflow');
      expect(generated).toContain('GeneratedExecutionContext');
    });

    it('should produce valid JavaScript in development mode with outputFormat javascript', () => {
      const result = parser.parseFromString(SIMPLE_WORKFLOW, 'hello.ts');
      expect(result.errors).toHaveLength(0);

      const generated = generateCode(result.workflows[0], {
        production: false,
        outputFormat: 'javascript',
      });

      const tsFound = findTypeScriptSyntax(generated as string);
      expect(tsFound).toBeNull();

      // Should still have the workflow function and debug infrastructure
      expect(generated).toContain('function helloWorkflow');
      expect(generated).toContain('GeneratedExecutionContext');
    });

    it('should preserve TypeScript when outputFormat is typescript (default)', () => {
      const result = parser.parseFromString(SIMPLE_WORKFLOW, 'hello.ts');
      expect(result.errors).toHaveLength(0);

      const generated = generateCode(result.workflows[0], {
        production: true,
      });

      // Default - should still have TS syntax
      expect(generated).toContain('type TStatusType');
    });
  });

  describe('generateInlineDebugClient', () => {
    it('should strip TypeScript types when outputFormat is javascript', () => {
      const code = generateInlineDebugClient('esm', 'javascript');

      const tsFound = findTypeScriptSyntax(code);
      expect(tsFound).toBeNull();

      // Should still contain the function
      expect(code).toContain('function createFlowWeaverDebugClient');
    });
  });
});
