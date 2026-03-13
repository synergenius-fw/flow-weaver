/**
 * Coverage tests for src/generator.ts (lines 72, 88-92)
 * Targets: generate() with sourceMap:true branch, and parseWithLogging error path.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-generator-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const SIMPLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function simpleWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

describe('WorkflowGenerator.generate coverage', () => {
  it('should generate code without sourceMap', async () => {
    const { generator } = await import('../../src/generator');
    const filePath = writeFixture('gen-no-map.ts', SIMPLE_WORKFLOW);

    const code = await generator.generate(filePath, 'simpleWf');
    expect(typeof code).toBe('string');
    expect(code).toContain('simpleWf');
  });

  it('should generate code with sourceMap:true (returns GeneratorResult)', async () => {
    const { generator } = await import('../../src/generator');
    const filePath = writeFixture('gen-map.ts', SIMPLE_WORKFLOW);

    const result = await generator.generate(filePath, 'simpleWf', { sourceMap: true });
    // With sourceMap:true, returns a GeneratorResult object (not just a string)
    expect(typeof result).toBe('object');
    expect((result as any).code).toBeDefined();
    expect(typeof (result as any).code).toBe('string');
  });

  it('should generate code with production:true', async () => {
    const { generator } = await import('../../src/generator');
    const filePath = writeFixture('gen-prod.ts', SIMPLE_WORKFLOW);

    const code = await generator.generate(filePath, 'simpleWf', { production: true });
    expect(typeof code).toBe('string');
  });

  it('should throw on parse errors (e.g., referencing nonexistent workflow)', async () => {
    const { generator } = await import('../../src/generator');
    const filePath = writeFixture('gen-err.ts', SIMPLE_WORKFLOW);

    await expect(
      generator.generate(filePath, 'nonExistentWorkflow')
    ).rejects.toThrow(/parsing failed|not found|No workflow/i);
  });

  it('should throw on parse errors for invalid file content', async () => {
    const { generator } = await import('../../src/generator');
    const filePath = writeFixture('gen-bad.ts', `
// No workflow annotations at all
export const x = 1;
`);

    await expect(
      generator.generate(filePath, 'testWf')
    ).rejects.toThrow();
  });
});
