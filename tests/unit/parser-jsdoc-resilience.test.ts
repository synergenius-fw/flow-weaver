/**
 * Tests for parser resilience when JSDoc contains characters that break ts-morph tag parsing.
 *
 * ts-morph absorbs '---' lines into the preceding tag's comment text, which
 * causes exact-match checks like `getCommentText()?.trim() === 'workflow'`
 * to fail silently (returning null with no diagnostic).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parser } from '../../src/parser';

describe('Parser JSDoc Resilience', () => {
  const uniqueId = `parser-resilience-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should warn when JSDoc has --- separator lines after @flowWeaver that break parsing', () => {
    // The --- line after @flowWeaver workflow gets absorbed into the tag's comment,
    // making getCommentText() return "workflow\n--- Node Setup ---" instead of "workflow"
    const sourceCode = `
/**
 * @flowWeaver workflow
 * --- Node Setup ---
 * @node fetchData FetchNode
 * @connect Start.execute -> fetchData.execute
 * @connect fetchData.onSuccess -> Exit.onSuccess
 */
export function agentPipeline(execute: boolean) {}
`;

    const testFile = path.join(tempDir, 'test-dash-separator.ts');
    fs.writeFileSync(testFile, sourceCode, 'utf-8');

    try {
      const result = parser.parse(testFile);

      // The workflow should not parse due to --- corrupting the @flowWeaver tag text
      expect(result.workflows.length).toBe(0);

      // But we should get a warning about the failed parse
      expect(
        result.warnings.some(
          (w) => w.includes('@flowWeaver') && w.includes('agentPipeline')
        )
      ).toBe(true);
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it('should still parse workflow when --- lines are absent', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input items {string[]} - Array of items
 * @output result {string} - Result
 */
function processItems(items: string[]) {
  return { result: items.join(',') };
}

/**
 * Simple workflow without separators
 *
 * @flowWeaver workflow
 * @node proc processItems
 * @connect Start.items -> proc.items
 * @connect proc.result -> Exit.result
 */
export function simpleWorkflow(execute: boolean, items: string[]) {}
`;

    const testFile = path.join(tempDir, 'test-no-dashes.ts');
    fs.writeFileSync(testFile, sourceCode, 'utf-8');

    try {
      const result = parser.parse(testFile);

      // Should parse successfully
      expect(result.workflows.length).toBe(1);
      expect(result.workflows[0].functionName).toBe('simpleWorkflow');
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it('should warn when @flowWeaver nodeType is present but parsing fails due to ---', () => {
    // --- after @flowWeaver nodeType corrupts the tag comment text
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * --- Port Definitions ---
 * @input x {number}
 * @output y {number}
 */
function brokenNode(x: number) {
  return { y: x * 2 };
}
`;

    const testFile = path.join(tempDir, 'test-broken-jsdoc.ts');
    fs.writeFileSync(testFile, sourceCode, 'utf-8');

    try {
      const result = parser.parse(testFile);

      // Node type should not parse
      expect(result.nodeTypes.length).toBe(0);

      // Should get a warning mentioning @flowWeaver and the function name
      expect(
        result.warnings.some(
          (w) => w.includes('@flowWeaver') && w.includes('brokenNode')
        )
      ).toBe(true);
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });
});
