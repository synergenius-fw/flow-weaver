/**
 * Tests for arrow function validator warnings.
 * Warns about mutable bindings (let/var) and nested arrow functions used as node types.
 */

import { AnnotationParser } from '../../../src/parser/annotation-parser';
import { WorkflowValidator } from '../../../src/validation/validator';

describe('Validator Arrow Function Warnings', () => {
  let parser: AnnotationParser;

  beforeEach(() => {
    parser = new AnnotationParser();
  });

  describe('mutable binding warnings', () => {
    it('should NOT warn for const arrow function node type', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
const double = (x: number): number => x * 2;

/**
 * @flowWeaver workflow
 * @node d double
 * @connect Start.x -> d.x
 * @connect d.result -> Exit.result
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param x
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function workflow(execute: boolean, params: { x: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'const-arrow.ts');
      const validator = new WorkflowValidator();
      const validation = validator.validate(result.workflows[0]);

      expect(validation.warnings.some((w) => w.code === 'MUTABLE_NODE_TYPE_BINDING')).toBe(false);
    });

    it('should warn for let arrow function node type', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
let double = (x: number): number => x * 2;

/**
 * @flowWeaver workflow
 * @node d double
 * @connect Start.x -> d.x
 * @connect d.result -> Exit.result
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param x
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function workflow(execute: boolean, params: { x: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'let-arrow.ts');
      const validator = new WorkflowValidator();
      const validation = validator.validate(result.workflows[0]);

      expect(validation.warnings.some((w) => w.code === 'MUTABLE_NODE_TYPE_BINDING')).toBe(true);
    });

    it('should warn for var arrow function node type', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input x
 * @output result
 */
var double = (x: number): number => x * 2;

/**
 * @flowWeaver workflow
 * @node d double
 * @connect Start.x -> d.x
 * @connect d.result -> Exit.result
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param x
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function workflow(execute: boolean, params: { x: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'var-arrow.ts');
      const validator = new WorkflowValidator();
      const validation = validator.validate(result.workflows[0]);

      expect(validation.warnings.some((w) => w.code === 'MUTABLE_NODE_TYPE_BINDING')).toBe(true);
    });
  });
});
