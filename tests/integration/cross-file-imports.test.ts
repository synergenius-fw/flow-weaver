/**
 * Tests for cross-file imports
 * Tests that node types can be imported from other .ts files (not just .ts)
 */

import * as fs from 'fs';
import * as path from 'path';
import { AnnotationParser } from '../../src/parser';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/cross-file');

describe('Cross-File Imports', () => {
  let parser: AnnotationParser;

  beforeEach(() => {
    parser = new AnnotationParser();
    parser.clearCache();
  });

  describe('Node type imports', () => {
    it('should import node type from another .ts file (not .ts)', () => {
      const mainFile = path.join(FIXTURES_DIR, 'main-workflow.ts');
      const result = parser.parse(mainFile);

      // Should have both local and imported node types
      expect(result.nodeTypes.length).toBeGreaterThanOrEqual(2);

      // Check that doubleValue was imported
      const doubleValue = result.nodeTypes.find((nt) => nt.name === 'doubleValue');
      expect(doubleValue).toBeDefined();
      expect(doubleValue?.inputs.value).toBeDefined();
      expect(doubleValue?.outputs.result).toBeDefined();

      // Check that local node type is also present
      const localNode = result.nodeTypes.find((nt) => nt.name === 'localNode');
      expect(localNode).toBeDefined();
    });

    it('should import multiple node types from same file', () => {
      // Create a test file that imports multiple from multi-export
      const testCode = `
import { add, multiply } from './multi-export';

/**
 * @flowWeaver workflow
 * @node adder add
 * @node mult multiply
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> mult.a
 * @connect Start.c -> mult.b
 * @connect mult.product -> Exit.result
 * @param a - First input
 * @param b - Second input
 * @param c - Multiplier
 * @returns result - Final result
 */
export function multiImportWorkflow(
  execute: boolean,
  params: { a: number; b: number; c: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}
`;
      // Write temp file
      const tempFile = path.join(FIXTURES_DIR, 'temp-multi-import.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        const result = parser.parse(tempFile);

        // Should have both add and multiply
        const add = result.nodeTypes.find((nt) => nt.name === 'add');
        const multiply = result.nodeTypes.find((nt) => nt.name === 'multiply');

        expect(add).toBeDefined();
        expect(multiply).toBeDefined();

        // negate should NOT be imported (not in import statement)
        const negate = result.nodeTypes.find((nt) => nt.name === 'negate');
        expect(negate).toBeUndefined();
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should have mixed local and imported node types in workflow', () => {
      const mainFile = path.join(FIXTURES_DIR, 'main-workflow.ts');
      const result = parser.parse(mainFile);

      expect(result.workflows.length).toBe(1);
      const workflow = result.workflows[0];

      // Workflow should reference both local and imported nodes
      expect(workflow.instances.length).toBe(2);

      const importedInstance = workflow.instances.find((i) => i.id === 'imported');
      const localInstance = workflow.instances.find((i) => i.id === 'local');

      expect(importedInstance).toBeDefined();
      expect(importedInstance?.nodeType).toBe('doubleValue');

      expect(localInstance).toBeDefined();
      expect(localInstance?.nodeType).toBe('localNode');
    });
  });

  describe('Error handling', () => {
    it('should error when imported file not found', () => {
      const testCode = `
import { nonexistent } from './does-not-exist';

/**
 * @flowWeaver workflow
 * @node n nonexistent
 * @param input - Input
 * @returns output - Output
 */
export function badImportWorkflow(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; output: any } {
  return { onSuccess: true, onFailure: false, output: null };
}
`;
      const tempFile = path.join(FIXTURES_DIR, 'temp-bad-import.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        expect(() => parser.parse(tempFile)).toThrow(/not found|does not exist/i);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should error when imported name does not exist in source file', () => {
      const testCode = `
import { nonexistentNode } from './node-utils';

/**
 * @flowWeaver workflow
 * @node n nonexistentNode
 * @param input - Input
 * @returns output - Output
 */
export function badNameWorkflow(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; output: any } {
  return { onSuccess: true, onFailure: false, output: null };
}
`;
      const tempFile = path.join(FIXTURES_DIR, 'temp-bad-name.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        // Parser pushes unknown-type errors instead of throwing (defense-in-depth)
        const result = parser.parse(tempFile);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => /not found|nonexistentNode/i.test(e))).toBe(true);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should detect circular dependencies', () => {
      const circularA = path.join(FIXTURES_DIR, 'circular-a.ts');

      expect(() => parser.parse(circularA)).toThrow(/circular/i);
    });
  });

  describe('Import caching', () => {
    it('should cache imported node types', () => {
      const mainFile = path.join(FIXTURES_DIR, 'main-workflow.ts');

      // Parse twice
      const result1 = parser.parse(mainFile);
      const result2 = parser.parse(mainFile);

      // Should return same node types (from cache)
      expect(result1.nodeTypes.length).toBe(result2.nodeTypes.length);

      const doubleValue1 = result1.nodeTypes.find((nt) => nt.name === 'doubleValue');
      const doubleValue2 = result2.nodeTypes.find((nt) => nt.name === 'doubleValue');

      expect(doubleValue1).toBeDefined();
      expect(doubleValue2).toBeDefined();
    });

    it('should handle same file imported from multiple locations', () => {
      const testCode = `
import { doubleValue } from './node-utils';
import { toUpperCase } from './node-utils';

/**
 * @flowWeaver workflow
 * @node d doubleValue
 * @node u toUpperCase
 * @connect Start.num -> d.value
 * @connect Start.text -> u.text
 * @connect d.result -> Exit.doubled
 * @connect u.result -> Exit.uppercased
 * @param num - Number input
 * @param text - Text input
 * @returns doubled - Doubled number
 * @returns uppercased - Uppercased text
 */
export function multiFromSameFile(
  execute: boolean,
  params: { num: number; text: string }
): { onSuccess: boolean; onFailure: boolean; doubled: number; uppercased: string } {
  return { onSuccess: true, onFailure: false, doubled: 0, uppercased: "" };
}
`;
      const tempFile = path.join(FIXTURES_DIR, 'temp-multi-same.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        const result = parser.parse(tempFile);

        // Both node types should be available
        const doubleValue = result.nodeTypes.find((nt) => nt.name === 'doubleValue');
        const toUpperCase = result.nodeTypes.find((nt) => nt.name === 'toUpperCase');

        expect(doubleValue).toBeDefined();
        expect(toUpperCase).toBeDefined();
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });

  describe('Import filtering', () => {
    it('should work with any .ts file containing @flowWeaver annotations', () => {
      const mainFile = path.join(FIXTURES_DIR, 'main-workflow.ts');
      const result = parser.parse(mainFile);

      // Importing from node-utils.ts should work
      const doubleValue = result.nodeTypes.find((nt) => nt.name === 'doubleValue');
      expect(doubleValue).toBeDefined();
    });

    it('should skip imports that are not relative paths', () => {
      const testCode = `
// This should be ignored - not a relative import
import { Something } from 'some-package';
import path from 'path';

/**
 * @flowWeaver nodeType
 * @input value - Input
 * @output result - Output
 */
function localOnly(
  execute: boolean,
  value: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @node local localOnly
 * @connect Start.input -> local.value
 * @connect local.result -> Exit.output
 * @param input - Input
 * @returns output - Output
 */
export function workflowWithPackageImports(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; output: any } {
  return { onSuccess: true, onFailure: false, output: null };
}
`;
      const tempFile = path.join(FIXTURES_DIR, 'temp-package-imports.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        // Should not throw - package imports are ignored
        const result = parser.parse(tempFile);
        expect(result.workflows.length).toBe(1);
        expect(result.nodeTypes.find((nt) => nt.name === 'localOnly')).toBeDefined();
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });
});
