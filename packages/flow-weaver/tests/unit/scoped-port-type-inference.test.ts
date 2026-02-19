/**
 * TDD Tests for Scoped INPUT Port Type Inference
 *
 * Tests that scoped INPUT ports (which become callback return values) have their
 * types correctly inferred from the callback signature. When inference fails,
 * the parser should emit a helpful error message.
 *
 * Architecture reminder:
 * - Scoped OUTPUT ports → callback parameters (data flows to children)
 * - Scoped INPUT ports → callback return values (data flows from children)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parser } from '../../src/parser';

describe('Scoped INPUT port type inference', () => {
  const testDir = path.join(os.tmpdir(), `fw-scoped-type-inference-${process.pid}`);
  const testFile = path.join(testDir, 'scoped-type-inference.ts');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Simple return type inference', () => {
    it('should infer string type from callback return field', () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @scope processItem
 * @output item scope:processItem - Current item to process
 * @input processed scope:processItem - Processed string result
 */
function forEachProcessor(
  execute: boolean,
  items: number[],
  processItem: (item: number) => { processed: string }
): { onSuccess: boolean; onFailure: boolean; results: string[] } {
  const results: string[] = [];
  for (const item of items) {
    const result = processItem(item);
    results.push(result.processed);
  }
  return { onSuccess: true, onFailure: false, results };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      expect(parsed.nodeTypes.length).toBe(1);
      const nodeType = parsed.nodeTypes[0];

      // Scoped INPUT port 'processed' should have tsType inferred from callback return
      expect(nodeType.inputs.processed).toBeDefined();
      expect(nodeType.inputs.processed.tsType).toBe('string');
      expect(nodeType.inputs.processed.dataType).toBe('STRING');
    });

    it('should infer number type from callback return field', () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @scope iterator
 * @output value scope:iterator - Current value
 * @input result scope:iterator - Numeric result
 */
function mapToNumber(
  execute: boolean,
  values: string[],
  iterator: (value: string) => { result: number }
): { onSuccess: boolean; onFailure: boolean; mapped: number[] } {
  return { onSuccess: true, onFailure: false, mapped: [] };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const nodeType = parsed.nodeTypes[0];

      expect(nodeType.inputs.result).toBeDefined();
      expect(nodeType.inputs.result.tsType).toBe('number');
      expect(nodeType.inputs.result.dataType).toBe('NUMBER');
    });

    it('should infer boolean type from callback return field', () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @scope filter
 * @output item scope:filter - Item to filter
 * @input keep scope:filter - Whether to keep the item
 */
function filterItems(
  execute: boolean,
  items: unknown[],
  filter: (item: unknown) => { keep: boolean }
): { onSuccess: boolean; onFailure: boolean; filtered: unknown[] } {
  return { onSuccess: true, onFailure: false, filtered: [] };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const nodeType = parsed.nodeTypes[0];

      expect(nodeType.inputs.keep).toBeDefined();
      expect(nodeType.inputs.keep.tsType).toBe('boolean');
      expect(nodeType.inputs.keep.dataType).toBe('BOOLEAN');
    });
  });

  describe('Complex type inference', () => {
    it('should infer array types from callback return field', () => {
      const content = `
interface SearchResult {
  id: string;
  score: number;
}

/**
 * @flowWeaver nodeType
 * @scope searchScope
 * @output query scope:searchScope - Search query
 * @input results scope:searchScope - Search results array
 */
function searchProcessor(
  execute: boolean,
  queries: string[],
  searchScope: (query: string) => { results: SearchResult[] }
): { onSuccess: boolean; onFailure: boolean; allResults: SearchResult[][] } {
  return { onSuccess: true, onFailure: false, allResults: [] };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const nodeType = parsed.nodeTypes[0];

      expect(nodeType.inputs.results).toBeDefined();
      // Should preserve the full type including array notation
      expect(nodeType.inputs.results.tsType).toMatch(/SearchResult\[\]/);
      expect(nodeType.inputs.results.dataType).toBe('ARRAY');
    });

    it('should infer generic types from callback return field', () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @scope processor
 * @output input scope:processor - Input data
 * @input output scope:processor - Output data map
 */
function processWithMap(
  execute: boolean,
  data: unknown[],
  processor: (input: unknown) => { output: Map<string, number> }
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const nodeType = parsed.nodeTypes[0];

      expect(nodeType.inputs.output).toBeDefined();
      expect(nodeType.inputs.output.tsType).toMatch(/Map<string, number>/);
      expect(nodeType.inputs.output.dataType).toBe('OBJECT');
    });

    it('should infer object literal types from callback return field', () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @scope transformer
 * @output data scope:transformer - Data to transform
 * @input transformed scope:transformer - Transformed object
 */
function objectTransformer(
  execute: boolean,
  items: unknown[],
  transformer: (data: unknown) => { transformed: { name: string; value: number } }
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const nodeType = parsed.nodeTypes[0];

      expect(nodeType.inputs.transformed).toBeDefined();
      // Should capture the object literal type
      expect(nodeType.inputs.transformed.tsType).toMatch(/name.*string.*value.*number/);
      expect(nodeType.inputs.transformed.dataType).toBe('OBJECT');
    });
  });

  describe('Error detection on inference failure', () => {
    it('should emit warning when type cannot be inferred and no tsType provided', () => {
      // This tests a case where the callback return type doesn't include the requested field
      // The port 'missingField' is not in the callback's return type
      const content = `
/**
 * @flowWeaver nodeType
 * @scope handler
 * @output data scope:handler
 * @input missingField scope:handler - This field doesn't exist in return type
 */
function handlerWithMissingReturnField(
  execute: boolean,
  handler: (data: string) => { otherField: number }
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const nodeType = parsed.nodeTypes[0];

      // When inference fails, there should be a warning in the parse output
      // The port should still exist but with ANY type as fallback
      expect(nodeType.inputs.missingField).toBeDefined();
      expect(nodeType.inputs.missingField.dataType).toBe('ANY');

      // Check for warning about type inference failure
      const warnings = parsed.warnings || [];
      const typeWarning = warnings.find(
        (w) => w.includes('missingField') && w.includes('infer')
      );
      expect(typeWarning).toBeDefined();
    });

    it('should include helpful message with scope name and port name', () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @scope myScope
 * @output item scope:myScope
 * @input myPort scope:myScope
 */
function noCallbackParam(
  execute: boolean
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const warnings = parsed.warnings || [];

      // Should mention the port name and scope
      const relevantWarning = warnings.find(
        (w) => w.includes('myPort') || w.includes('myScope')
      );
      expect(relevantWarning).toBeDefined();
    });
  });

  describe('Explicit tsType annotation override', () => {
    it('should use explicit tsType annotation when provided', () => {
      // Note: The current parser may not support inline tsType,
      // but if we add it, this test verifies it works
      const content = `
interface CustomResult {
  data: string;
  metadata: Record<string, unknown>;
}

/**
 * @flowWeaver nodeType
 * @scope processor
 * @output item scope:processor - Item to process
 * @input result scope:processor - Custom result type
 */
function withExplicitType(
  execute: boolean,
  items: unknown[],
  processor: (item: unknown) => { result: CustomResult }
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const nodeType = parsed.nodeTypes[0];

      expect(nodeType.inputs.result).toBeDefined();
      // When the type is a custom interface, it should be captured
      expect(nodeType.inputs.result.tsType).toMatch(/CustomResult/);
    });
  });

  describe('Scoped OUTPUT port type inference (callback parameters)', () => {
    it('should infer types for scoped OUTPUT ports from callback parameters', () => {
      const content = `
/**
 * @flowWeaver nodeType
 * @scope iterator
 * @output index scope:iterator - Current index
 * @output item scope:iterator - Current item
 * @input processed scope:iterator - Processed result
 */
function forEachWithIndex(
  execute: boolean,
  items: string[],
  iterator: (index: number, item: string) => { processed: boolean }
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;
      fs.writeFileSync(testFile, content);

      const parsed = parser.parse(testFile);
      const nodeType = parsed.nodeTypes[0];

      // Scoped OUTPUT ports get types from callback parameters
      expect(nodeType.outputs.index).toBeDefined();
      expect(nodeType.outputs.index.tsType).toBe('number');
      expect(nodeType.outputs.index.dataType).toBe('NUMBER');

      expect(nodeType.outputs.item).toBeDefined();
      expect(nodeType.outputs.item.tsType).toBe('string');
      expect(nodeType.outputs.item.dataType).toBe('STRING');

      // Scoped INPUT port gets type from callback return
      expect(nodeType.inputs.processed).toBeDefined();
      expect(nodeType.inputs.processed.tsType).toBe('boolean');
      expect(nodeType.inputs.processed.dataType).toBe('BOOLEAN');
    });
  });
});
