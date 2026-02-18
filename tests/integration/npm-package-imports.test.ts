/**
 * Tests for npm package imports and multi-extension support
 * Tests that node types can be imported from:
 * - .ts, .tsx, .js, .jsx files (multi-extension)
 * - npm packages (package imports)
 */

import * as path from 'path';
import * as fs from 'fs';
import { AnnotationParser } from '../../src/parser';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const CROSS_FILE_DIR = path.join(FIXTURES_DIR, 'cross-file');
const _NPM_MOCK_DIR = path.join(FIXTURES_DIR, 'npm-package-mock');

describe('Multi-Extension and Package Imports', () => {
  let parser: AnnotationParser;

  beforeEach(() => {
    parser = new AnnotationParser();
    parser.clearCache();
  });

  describe('Multi-extension support', () => {
    it('should resolve import without extension (try .ts first)', () => {
      const mainFile = path.join(CROSS_FILE_DIR, 'main-workflow.ts');
      const result = parser.parse(mainFile);

      // node-utils.ts should be found when imported as './node-utils'
      const doubleValue = result.nodeTypes.find((nt) => nt.name === 'doubleValue');
      expect(doubleValue).toBeDefined();
    });

    it('should resolve import with explicit .ts extension', () => {
      const testCode = `
import { doubleValue } from './node-utils.ts';

/**
 * @flowWeaver workflow
 * @node d doubleValue
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.output
 * @param value - Input
 * @returns output - Output
 */
export function explicitTsWorkflow(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  return { onSuccess: true, onFailure: false, output: 0 };
}
`;
      const tempFile = path.join(CROSS_FILE_DIR, 'temp-explicit-ts.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        const result = parser.parse(tempFile);
        const doubleValue = result.nodeTypes.find((nt) => nt.name === 'doubleValue');
        expect(doubleValue).toBeDefined();
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should try .tsx extension when .ts not found', () => {
      // Create a .tsx file
      const tsxCode = `
/**
 * @flowWeaver nodeType
 * @input value - Input value
 * @output result - Output value
 */
export function tsxNode(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 3 };
}
`;
      const tsxFile = path.join(CROSS_FILE_DIR, 'tsx-node.tsx');
      fs.writeFileSync(tsxFile, tsxCode);

      const testCode = `
import { tsxNode } from './tsx-node';

/**
 * @flowWeaver workflow
 * @node t tsxNode
 * @connect Start.value -> t.value
 * @connect t.result -> Exit.output
 * @param value - Input
 * @returns output - Output
 */
export function useTsxWorkflow(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  return { onSuccess: true, onFailure: false, output: 0 };
}
`;
      const tempFile = path.join(CROSS_FILE_DIR, 'temp-use-tsx.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        const result = parser.parse(tempFile);
        const tsxNodeType = result.nodeTypes.find((nt) => nt.name === 'tsxNode');
        expect(tsxNodeType).toBeDefined();
        expect(tsxNodeType?.inputs.value).toBeDefined();
      } finally {
        fs.unlinkSync(tempFile);
        fs.unlinkSync(tsxFile);
      }
    });

    it('should try .js extension when .ts/.tsx not found', () => {
      // Create a .js file with JSDoc annotations (ES module syntax)
      const jsCode = `
/**
 * @flowWeaver nodeType
 * @input value - Input value
 * @output result - Output value
 */
export function jsNode(execute, value) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 4 };
}
`;
      const jsFile = path.join(CROSS_FILE_DIR, 'js-node.js');
      fs.writeFileSync(jsFile, jsCode);

      const testCode = `
import { jsNode } from './js-node';

/**
 * @flowWeaver workflow
 * @node j jsNode
 * @connect Start.value -> j.value
 * @connect j.result -> Exit.output
 * @param value - Input
 * @returns output - Output
 */
export function useJsWorkflow(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  return { onSuccess: true, onFailure: false, output: 0 };
}
`;
      const tempFile = path.join(CROSS_FILE_DIR, 'temp-use-js.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        const result = parser.parse(tempFile);
        const jsNodeType = result.nodeTypes.find((nt) => nt.name === 'jsNode');
        expect(jsNodeType).toBeDefined();
      } finally {
        fs.unlinkSync(tempFile);
        fs.unlinkSync(jsFile);
      }
    });
  });

  describe('Error handling for relative imports', () => {
    it('should throw descriptive error for missing relative import', () => {
      const testCode = `
import { nonexistent } from './does-not-exist-anywhere';

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
      const tempFile = path.join(CROSS_FILE_DIR, 'temp-bad-import.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        expect(() => parser.parse(tempFile)).toThrow(/not found|does not exist/i);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should mention searched extensions in error message', () => {
      const testCode = `
import { missing } from './missing-file';

/**
 * @flowWeaver workflow
 * @node m missing
 * @param input - Input
 * @returns output - Output
 */
export function missingFileWorkflow(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; output: any } {
  return { onSuccess: true, onFailure: false, output: null };
}
`;
      const tempFile = path.join(CROSS_FILE_DIR, 'temp-missing.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        expect(() => parser.parse(tempFile)).toThrow(/\.ts|\.tsx|\.js|\.jsx/);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });

  describe('NPM package imports', () => {
    // These tests will pass once package resolution is implemented

    it('should resolve npm package with main field pointing to .ts', () => {
      // Create a workflow that imports from the mock package using relative path
      // (simulates how a real npm package import would work after resolution)
      const testCode = `
import { packageDouble } from '../npm-package-mock';

/**
 * @flowWeaver workflow
 * @node d packageDouble
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.output
 * @param value - Input
 * @returns output - Output
 */
export function usePackageWorkflow(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  return { onSuccess: true, onFailure: false, output: 0 };
}
`;
      const tempFile = path.join(CROSS_FILE_DIR, 'temp-use-package.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        const result = parser.parse(tempFile);
        const packageDoubleType = result.nodeTypes.find((nt) => nt.name === 'packageDouble');
        expect(packageDoubleType).toBeDefined();
        expect(result.workflows.length).toBe(1);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should silently skip non-flow-weaver npm packages', () => {
      const testCode = `
import path from 'path';
import { Something } from 'some-nonexistent-package';

/**
 * @flowWeaver nodeType
 * @input value - Input
 * @output result - Output
 */
function localNode(
  execute: boolean,
  value: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @node local localNode
 * @connect Start.input -> local.value
 * @connect local.result -> Exit.output
 * @param input - Input
 * @returns output - Output
 */
export function workflowWithSkippedImports(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; output: any } {
  return { onSuccess: true, onFailure: false, output: null };
}
`;
      const tempFile = path.join(CROSS_FILE_DIR, 'temp-skip-packages.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        // Should not throw - package imports should be silently skipped
        const result = parser.parse(tempFile);
        expect(result.workflows.length).toBe(1);
        expect(result.nodeTypes.find((nt) => nt.name === 'localNode')).toBeDefined();
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });
});
