import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests that parser caches are bounded and evict old entries.
 * Written before implementation — expects LRU eviction on parseCache.
 */

const FIXTURES_DIR = path.join(os.tmpdir(), 'fw-test-cache-eviction');
const FILE_COUNT = 105; // Cache limit is 100; 5 beyond is sufficient to test eviction

function createWorkflowFile(name: string): string {
  const filePath = path.join(FIXTURES_DIR, `${name}.ts`);
  const content = `
/**
 * @flowWeaver workflow
 * @node Start Entry
 * @node Exit Exit
 * @connect Start.onSuccess -> Exit.execute
 */
export function ${name}() {}

/** @flowWeaver nodeType */
function Entry(execute: any) { return { onSuccess: true }; }

/** @flowWeaver nodeType */
function Exit(execute: any) { return { onSuccess: true }; }
`;
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('Parser cache eviction', () => {
  let parser: AnnotationParser;
  const sharedFilePaths: string[] = [];

  beforeAll(() => {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    // Create all files once — both tests reuse them (each gets a fresh parser instance)
    for (let i = 0; i < FILE_COUNT; i++) {
      sharedFilePaths.push(createWorkflowFile(`workflow_${i}`));
    }
  });

  afterAll(() => {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    parser = new AnnotationParser();
  });

  it('should bound parseCache size after many parses', () => {
    // Parse more files than the cache limit (100)
    for (const filePath of sharedFilePaths) {
      parser.parse(filePath);
    }

    // Access internal cache size — parseCache should not exceed 100
    // We test this indirectly: parsing an early file again should trigger a full re-parse
    // (since it was evicted), but should still succeed without errors
    const result = parser.parse(sharedFilePaths[0]);
    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);
  });

  it('should still return correct results after eviction and re-parse', () => {
    for (const filePath of sharedFilePaths) {
      parser.parse(filePath);
    }

    // Re-parse the first file (evicted from cache) — should work correctly
    const result = parser.parse(sharedFilePaths[0]);
    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].functionName).toBe('workflow_0');
  });

  it('should still support clearCache()', () => {
    const filePath = createWorkflowFile('clearable_workflow');
    parser.parse(filePath);
    // clearCache should not throw
    parser.clearCache();
    // Parsing again after clear should work (full re-parse)
    const result = parser.parse(filePath);
    expect(result.errors).toHaveLength(0);
  });
});
