/**
 * Tests for arrow function and function expression support in parser.
 * TDD: These tests define the expected behavior for arrow function parsing.
 */

import { AnnotationParser } from '../../src/parser';

describe('Arrow Function Support', () => {
  let parser: AnnotationParser;

  beforeEach(() => {
    parser = new AnnotationParser();
  });

  describe('nodeType parsing', () => {
    it('should parse arrow function with @flowWeaver nodeType and @expression', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @label Add
 * @input a
 * @input b
 * @output result
 */
const add = (a: number, b: number): number => {
  return a + b;
};
`;
      const result = parser.parseFromString(code, 'arrow-expr.ts');

      expect(result.nodeTypes.length).toBeGreaterThan(0);
      const addNode = result.nodeTypes.find((nt) => nt.functionName === 'add');
      expect(addNode).toBeDefined();
      expect(addNode!.expression).toBe(true);
    });

    it('should extract function name from const variable name', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
const double = (x: number): number => x * 2;
`;
      const result = parser.parseFromString(code, 'arrow-name.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'double');
      expect(nodeType).toBeDefined();
      expect(nodeType!.name).toBe('double');
    });

    it('should correctly extract parameters and return type', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input name
 * @input age
 * @output greeting
 */
const greet = (name: string, age: number): string => {
  return \`Hello \${name}, you are \${age}\`;
};
`;
      const result = parser.parseFromString(code, 'arrow-params.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'greet');
      expect(nodeType).toBeDefined();
      expect(nodeType!.inputs.name.dataType).toBe('STRING');
      expect(nodeType!.inputs.age.dataType).toBe('NUMBER');
    });

    it('should detect async arrow function', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input url
 * @output result
 */
const fetchData = async (url: string): Promise<any> => {
  const res = await fetch(url);
  return await res.json();
};
`;
      const result = parser.parseFromString(code, 'arrow-async.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'fetchData');
      expect(nodeType).toBeDefined();
      expect(nodeType!.isAsync).toBe(true);
    });

    it('should parse function expression (const fn = function() {})', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
const triple = function(x: number): number {
  return x * 3;
};
`;
      const result = parser.parseFromString(code, 'func-expr.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'triple');
      expect(nodeType).toBeDefined();
    });

    it('should parse normal mode arrow function (with execute)', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
const process = (execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number | null } => {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: value * 2 };
};
`;
      const result = parser.parseFromString(code, 'arrow-normal.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'process');
      expect(nodeType).toBeDefined();
      expect(nodeType!.expression).toBeUndefined();
    });
  });

  describe('workflow parsing', () => {
    it('should parse arrow function with @flowWeaver workflow', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output result
 */
const add = (a: number, b: number): number => a + b;

/**
 * @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.result -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export const calc = (execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } => {
  throw new Error('Not implemented');
};
`;
      const result = parser.parseFromString(code, 'arrow-workflow.ts');

      expect(result.workflows.length).toBe(1);
      expect(result.workflows[0].functionName).toBe('calc');
    });
  });

  describe('pattern parsing', () => {
    it('should parse arrow function with @flowWeaver pattern', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input data
 * @output result
 */
function processor(execute: boolean, data: any): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: data };
}

/**
 * @flowWeaver pattern
 * @name testPattern
 * @node p processor
 */
const myPattern = () => {};
`;
      const result = parser.parseFromString(code, 'arrow-pattern.ts');

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0].name).toBe('testPattern');
    });
  });

  describe('regression', () => {
    it('should still parse regular FunctionDeclaration', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output result
 */
function add(a: number, b: number): number {
  return a + b;
}
`;
      const result = parser.parseFromString(code, 'func-decl.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'add');
      expect(nodeType).toBeDefined();
      expect(nodeType!.expression).toBe(true);
    });

    it('should ignore arrow function without @flowWeaver', () => {
      const code = `
const helper = (x: number): number => x * 2;

/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
function double(x: number): number {
  return helper(x);
}
`;
      const result = parser.parseFromString(code, 'no-annotation.ts');

      // Only the annotated function should be parsed
      expect(result.nodeTypes.length).toBe(1);
      expect(result.nodeTypes[0].functionName).toBe('double');
    });
  });

  describe('variable declaration kinds', () => {
    it('should parse let declaration', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
let transform = (x: number): number => x + 1;
`;
      const result = parser.parseFromString(code, 'let-arrow.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'transform');
      expect(nodeType).toBeDefined();
    });

    it('should parse var declaration', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
var compute = (x: number): number => x * x;
`;
      const result = parser.parseFromString(code, 'var-arrow.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'compute');
      expect(nodeType).toBeDefined();
    });
  });

  describe('exported arrow functions', () => {
    it('should parse exported const arrow function', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
export const square = (x: number): number => x * x;
`;
      const result = parser.parseFromString(code, 'exported-arrow.ts');

      const nodeType = result.nodeTypes.find((nt) => nt.functionName === 'square');
      expect(nodeType).toBeDefined();
    });
  });

  describe('mixed declarations', () => {
    it('should parse both function declarations and arrow functions in same file', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input a
 * @input b
 * @output result
 */
function add(a: number, b: number): number {
  return a + b;
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
const double = (x: number): number => x * 2;
`;
      const result = parser.parseFromString(code, 'mixed.ts');

      expect(result.nodeTypes.length).toBe(2);
      expect(result.nodeTypes.find((nt) => nt.functionName === 'add')).toBeDefined();
      expect(result.nodeTypes.find((nt) => nt.functionName === 'double')).toBeDefined();
    });
  });
});
