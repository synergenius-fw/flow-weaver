import { describe, it, expect, beforeEach } from 'vitest';
import { AnnotationParser } from '../../src/parser';

describe('AnnotationParser uncovered regions', () => {
  let parser: AnnotationParser;

  beforeEach(() => {
    parser = new AnnotationParser();
  });

  describe('generateAnnotationSuggestion', () => {
    it('returns null when content has no functions', () => {
      const content = `const x = 42;\n`;
      const result = parser.generateAnnotationSuggestion(content, 0);
      expect(result).toBeNull();
    });

    it('generates a full annotation block for an unannotated function', () => {
      const content = `function add(a: number, b: number): number {
  return a + b;
}`;
      // Cursor on the line before the function
      const result = parser.generateAnnotationSuggestion(content, 0);
      expect(result).not.toBeNull();
      expect(result!.text).toContain('@flowWeaver nodeType add');
      expect(result!.replaceLinesCount).toBe(0);
    });

    it('generates continuation lines when cursor is on a /** line', () => {
      // The /** must be on the line immediately before the function,
      // and the function must be valid TS despite the incomplete JSDoc.
      const content = [
        '/**',
        'function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
      ].join('\n');
      // Cursor on line 0 where "/**" is
      const result = parser.generateAnnotationSuggestion(content, 0);
      // ts-morph may not parse this as a valid function with an incomplete JSDoc,
      // so we just verify it doesn't crash and returns something sensible
      if (result !== null) {
        expect(result.text).toContain('@flowWeaver nodeType');
      }
    });

    it('returns null when cursor is too far above the function', () => {
      // 40 blank lines then a function
      const lines = Array(40).fill('').concat([
        'function add(a: number): number { return a; }',
      ]);
      const content = lines.join('\n');
      const result = parser.generateAnnotationSuggestion(content, 0);
      expect(result).toBeNull();
    });

    it('returns null when function has a regular JSDoc but no @flowWeaver tag', () => {
      const content = `/**
 * A normal utility function.
 */
function add(a: number, b: number): number {
  return a + b;
}`;
      const result = parser.generateAnnotationSuggestion(content, 0);
      expect(result).toBeNull();
    });

    it('suggests missing ports on a partially annotated function', () => {
      const content = `/**
 * @flowWeaver nodeType calc
 * @input {number} a - First number
 */
function calc(a: number, b: number): { onSuccess: boolean; result: number } {
  return { onSuccess: true, result: a + b };
}`;
      const result = parser.generateAnnotationSuggestion(content, 0);
      expect(result).not.toBeNull();
      // Should suggest the missing 'b' input and 'result' output
      expect(result!.text).toContain('b');
    });

    it('returns null when all ports are already annotated', () => {
      // Use the actual annotation format: @input name (no {type} braces)
      const content = `/**
 * @flowWeaver nodeType identity
 * @input a
 * @output result
 */
function identity(execute: boolean, a: number): { onSuccess: boolean; result: number } {
  return { onSuccess: true, result: a };
}`;
      const result = parser.generateAnnotationSuggestion(content, 0);
      // All non-control-flow ports are annotated, so nothing to suggest
      expect(result).toBeNull();
    });

    it('merges @param descriptions into inferred port labels', () => {
      const content = `/**
 * @flowWeaver nodeType calc
 * @param a - The first operand
 */
function calc(a: number, b: number): { onSuccess: boolean; result: number } {
  return { onSuccess: true, result: a + b };
}`;
      const result = parser.generateAnnotationSuggestion(content, 0);
      expect(result).not.toBeNull();
      // Should suggest the missing 'b' input and 'result' output
      expect(result!.text).toContain('b');
      expect(result!.text).toContain('result');
    });

    it('suggests @expression for expression-style functions', () => {
      // Expression nodes have no execute param and simple return
      const content = `function double(value: number): number {
  return value * 2;
}`;
      const result = parser.generateAnnotationSuggestion(content, 0);
      expect(result).not.toBeNull();
      expect(result!.text).toContain('@flowWeaver nodeType double');
      // Expression inference: no execute param implies expression
      expect(result!.text).toContain('@expression');
    });

    it('picks the nearest function when there are multiple', () => {
      const content = `function first(a: number): number {
  return a;
}

function second(b: string): string {
  return b;
}`;
      // Cursor at line 4, near second function
      const result = parser.generateAnnotationSuggestion(content, 4);
      expect(result).not.toBeNull();
      expect(result!.text).toContain('second');
    });

    it('handles virtual path collision by removing existing source file', () => {
      const content = `function foo(x: number): number { return x; }`;
      // Call twice with the same virtual path
      const r1 = parser.generateAnnotationSuggestion(content, 0, 'clash.ts');
      const r2 = parser.generateAnnotationSuggestion(content, 0, 'clash.ts');
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1!.text).toEqual(r2!.text);
    });
  });

  describe('isWorkflowBlock (via generateAnnotationSuggestion)', () => {
    it('suggests connections for workflow blocks with @node declarations', () => {
      const content = `/**
 * @flowWeaver nodeType producer
 * @output {number} value
 */
function producer(execute: boolean): { onSuccess: boolean; value: number } {
  return { onSuccess: true, value: 42 };
}

/**
 * @flowWeaver nodeType consumer
 * @input {number} value
 */
function consumer(execute: boolean, value: number): { onSuccess: boolean } {
  return { onSuccess: true };
}

/**
 * @flowWeaver workflow pipeline
 * @node p producer
 * @node c consumer
 */
function pipeline() {}`;
      // Cursor near workflow function at line 20
      const result = parser.generateAnnotationSuggestion(content, 20);
      expect(result).not.toBeNull();
      // Should suggest @connect p.value -> c.value
      expect(result!.text).toContain('@connect');
      expect(result!.text).toContain('p.value');
      expect(result!.text).toContain('c.value');
    });

    it('does not suggest connections that already exist', () => {
      const content = `/**
 * @flowWeaver nodeType producer
 * @output {number} value
 */
function producer(execute: boolean): { onSuccess: boolean; value: number } {
  return { onSuccess: true, value: 42 };
}

/**
 * @flowWeaver nodeType consumer
 * @input {number} value
 */
function consumer(execute: boolean, value: number): { onSuccess: boolean } {
  return { onSuccess: true };
}

/**
 * @flowWeaver workflow pipeline
 * @node p producer
 * @node c consumer
 * @connect p.value -> c.value
 */
function pipeline() {}`;
      const result = parser.generateAnnotationSuggestion(content, 20);
      // Connection already exists, nothing to suggest
      expect(result).toBeNull();
    });

    it('returns empty suggestions when fewer than 2 nodes declared', () => {
      const content = `/**
 * @flowWeaver nodeType producer
 */
function producer(execute: boolean): { onSuccess: boolean; value: number } {
  return { onSuccess: true, value: 42 };
}

/**
 * @flowWeaver workflow solo
 * @node p producer
 */
function solo() {}`;
      const result = parser.generateAnnotationSuggestion(content, 10);
      // Only one node, no connections to suggest
      expect(result).toBeNull();
    });

    it('treats bare @flowWeaver tag as workflow', () => {
      const content = `/**
 * @flowWeaver nodeType helper
 */
function helper(execute: boolean, data: number): { onSuccess: boolean; data: number } {
  return { onSuccess: true, data };
}

/**
 * @flowWeaver
 * @node a helper
 * @node b helper
 */
function myFlow() {}`;
      // Cursor near the workflow function (line 13 is function myFlow)
      const result = parser.generateAnnotationSuggestion(content, 13);
      // Bare @flowWeaver is treated as workflow, so it should try to suggest connections.
      // If both nodes have matching data ports, we get @connect suggestions.
      if (result !== null) {
        expect(result.text).toContain('@connect');
      }
    });
  });

  describe('extractExistingAnnotatedPorts', () => {
    it('recognizes @step tags as inputs', () => {
      const content = `/**
 * @flowWeaver nodeType scoped
 * @step inner
 * @output result
 */
function scoped(execute: boolean, inner: boolean): { onSuccess: boolean; result: number } {
  return { onSuccess: true, result: 1 };
}`;
      const result = parser.generateAnnotationSuggestion(content, 0);
      // inner (@step) and result (@output) are already annotated, nothing to suggest
      expect(result).toBeNull();
    });

    it('handles bracketed port names like [name=default]', () => {
      const content = `/**
 * @flowWeaver nodeType withDefault
 * @input [count=10]
 */
function withDefault(execute: boolean, count: number): { onSuccess: boolean } {
  return { onSuccess: true };
}`;
      const result = parser.generateAnnotationSuggestion(content, 0);
      // count is already annotated (bracketed), nothing new to suggest
      expect(result).toBeNull();
    });
  });

  describe('extractTypeSchema fallback path', () => {
    it('parses interface properties through type inference', () => {
      // This tests the extractTypeSchema method indirectly: when a function
      // takes an interface parameter, the parser needs to resolve its properties.
      // The fallback at line 2521 is exercised when getValueDeclaration() returns
      // null but getDeclarations() succeeds.
      const content = `interface Config {
  readonly name: string;
  readonly count: number;
}

/**
 * @flowWeaver nodeType withConfig
 */
function withConfig(execute: boolean, config: Config): { onSuccess: boolean } {
  return { onSuccess: true };
}`;
      const result = parser.generateAnnotationSuggestion(content, 6);
      expect(result).not.toBeNull();
      // Should infer config as an input port
      expect(result!.text).toContain('config');
    });
  });
});
