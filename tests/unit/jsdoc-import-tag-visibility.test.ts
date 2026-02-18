/**
 * Test to verify @fwImport tags are correctly returned by ts-morph.
 *
 * Background: TypeScript treats @import specially (for type imports),
 * truncating the first word. We use @fwImport instead.
 */
import { describe, it, expect } from 'vitest';
import { getSharedProject } from '../../src/shared-project';

describe('JSDoc @fwImport tag visibility in ts-morph', () => {
  const project = getSharedProject();

  it('demonstrates @import tag behavior (may vary by environment)', () => {
    // Note: TypeScript's handling of @import can vary by version/config.
    // In some environments it truncates the first word as a type annotation.
    // We use @fwImport to ensure consistent behavior.
    const code = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @import npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
 * @node myNode someType
 */
export function testWorkflow() {}
`;

    const sourceFile = project.createSourceFile('test-import-visibility.ts', code, {
      overwrite: true,
    });
    const func = sourceFile.getFunctions()[0];
    const jsdoc = func.getJsDocs()[0];
    const tags = jsdoc.getTags();

    const importTag = tags.find((t) => t.getTagName() === 'import');
    // Just verify the tag exists - content may vary by environment
    expect(importTag).toBeDefined();
  });

  it('should return @fwImport tag content correctly', () => {
    const code = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
 * @node myNode someType
 */
export function testWorkflow() {}
`;

    const sourceFile = project.createSourceFile('test-fwimport-visibility.ts', code, {
      overwrite: true,
    });
    const func = sourceFile.getFunctions()[0];
    const jsdoc = func.getJsDocs()[0];
    const tags = jsdoc.getTags();

    const fwImportTag = tags.find((t) => t.getTagName() === 'fwImport');
    const comment = fwImportTag?.getCommentText() || '';
    // @fwImport preserves the full content
    expect(comment).toContain('npm/autoprefixer/autoprefixer');
  });

  it('should return @fwImport after generateInPlace writes it', async () => {
    const { parser } = await import('../../src/parser');
    const { generateInPlace } = await import('../../src/api/generate-in-place');
    const { addNodeType } = await import('../../src/api');
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-import-test-'));
    const tempFile = path.join(tempDir, 'test.ts');

    const initialCode = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 */
export async function testWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  return { onSuccess: true, onFailure: false };
  // @flow-weaver-body-end
}
`;
    fs.writeFileSync(tempFile, initialCode, 'utf-8');
    parser.clearCache();

    let parsed = parser.parse(tempFile);
    let workflow = parsed.workflows[0];

    const npmNodeType = {
      type: 'NodeType' as const,
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'autoprefixer',
      importSource: 'autoprefixer',
      inputs: { execute: { dataType: 'STEP' as const } },
      outputs: { result: { dataType: 'ANY' as const } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION' as const,
    };
    workflow = addNodeType(workflow, npmNodeType);

    const sourceCode = fs.readFileSync(tempFile, 'utf-8');
    const result = generateInPlace(sourceCode, workflow);
    fs.writeFileSync(tempFile, result.code, 'utf-8');

    parser.clearCache();
    parsed = parser.parse(tempFile);
    workflow = parsed.workflows[0];

    const npmTypesWithImportSource = workflow.nodeTypes.filter(
      (nt) => (nt as { importSource?: string }).importSource
    );

    fs.rmSync(tempDir, { recursive: true, force: true });

    expect(npmTypesWithImportSource.length).toBeGreaterThan(0);
  });
});
