/**
 * Tests for uncovered branches in src/api/compile.ts
 * Covers: saveAST option, inPlace=false path, getDefaultOutputFile,
 * compileWorkflows, compilePattern, and write=false.
 */

import * as path from 'path';
import * as fs from 'node:fs';
import { compileWorkflow, compileWorkflows, compilePattern } from '../../src/api/compile';

const fixtureFile = path.resolve(__dirname, '../../fixtures/basic/example.ts');
const tmpDir = path.resolve(__dirname, '../../tests/temp-compile');

describe('compileWorkflow - uncovered branches', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  describe('inPlace=false (separate file generation)', () => {
    it('should generate to a default output file', async () => {
      const tmpFile = path.join(tmpDir, 'compile-separate.ts');
      fs.copyFileSync(fixtureFile, tmpFile);
      const expectedOutput = path.join(tmpDir, 'compile-separate.generated.ts');

      try {
        const result = await compileWorkflow(tmpFile, { inPlace: false });
        expect(result.code).toBeDefined();
        expect(result.metadata.outputFile).toBe(expectedOutput);
        // The generated file should exist on disk
        expect(fs.existsSync(expectedOutput)).toBe(true);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        if (fs.existsSync(expectedOutput)) fs.unlinkSync(expectedOutput);
      }
    });

    it('should use custom outputFile when provided', async () => {
      const tmpFile = path.join(tmpDir, 'compile-custom-out.ts');
      fs.copyFileSync(fixtureFile, tmpFile);
      const customOutput = path.join(tmpDir, 'my-custom-output.ts');

      try {
        const result = await compileWorkflow(tmpFile, {
          inPlace: false,
          outputFile: customOutput,
        });
        expect(result.metadata.outputFile).toBe(customOutput);
        expect(fs.existsSync(customOutput)).toBe(true);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        if (fs.existsSync(customOutput)) fs.unlinkSync(customOutput);
      }
    });

    it('should skip writing when write=false', async () => {
      const tmpFile = path.join(tmpDir, 'compile-no-write.ts');
      fs.copyFileSync(fixtureFile, tmpFile);
      const expectedOutput = path.join(tmpDir, 'compile-no-write.generated.ts');

      try {
        const result = await compileWorkflow(tmpFile, {
          inPlace: false,
          write: false,
        });
        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);
        // Should NOT have written the output file
        expect(fs.existsSync(expectedOutput)).toBe(false);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        if (fs.existsSync(expectedOutput)) fs.unlinkSync(expectedOutput);
      }
    });
  });

  describe('saveAST option', () => {
    it('should save AST alongside output when saveAST=true', async () => {
      const tmpFile = path.join(tmpDir, 'compile-save-ast.ts');
      fs.copyFileSync(fixtureFile, tmpFile);
      // The AST file typically gets a .json extension next to the source
      const possibleAstFile = path.join(tmpDir, 'compile-save-ast.flow-weaver.json');

      try {
        const result = await compileWorkflow(tmpFile, {
          inPlace: true,
          saveAST: true,
        });
        expect(result.code).toBeDefined();
        expect(result.ast).toBeDefined();
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        if (fs.existsSync(possibleAstFile)) fs.unlinkSync(possibleAstFile);
      }
    });
  });

  describe('metadata fields', () => {
    it('should include all metadata fields', async () => {
      const tmpFile = path.join(tmpDir, 'compile-metadata.ts');
      fs.copyFileSync(fixtureFile, tmpFile);

      try {
        const result = await compileWorkflow(tmpFile, { write: false });
        expect(result.metadata).toBeDefined();
        expect(result.metadata.sourceFile).toBe(tmpFile);
        expect(result.metadata.compiledAt).toBeDefined();
        expect(result.metadata.compilerVersion).toBeDefined();
        expect(typeof result.metadata.generationTime).toBe('number');
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('error paths', () => {
    it('should throw on parse errors', async () => {
      const badFile = path.join(tmpDir, 'compile-bad.ts');
      fs.writeFileSync(badFile, 'this is not a valid workflow file', 'utf-8');

      try {
        // File with no workflow annotations should error during compilation
        // (either at parse or validation stage)
        await expect(compileWorkflow(badFile)).rejects.toThrow();
      } finally {
        if (fs.existsSync(badFile)) fs.unlinkSync(badFile);
      }
    });

    it('should throw on nonexistent file', async () => {
      await expect(
        compileWorkflow('/nonexistent/path/file.ts')
      ).rejects.toThrow();
    });
  });
});

describe('compileWorkflows', () => {
  it('should compile multiple files in parallel', async () => {
    const tmpFile1 = path.join(tmpDir, 'compile-multi-1.ts');
    const tmpFile2 = path.join(tmpDir, 'compile-multi-2.ts');
    fs.copyFileSync(fixtureFile, tmpFile1);
    fs.copyFileSync(fixtureFile, tmpFile2);

    try {
      const results = await compileWorkflows([tmpFile1, tmpFile2], { write: false });
      expect(results).toHaveLength(2);
      expect(results[0].code).toBeDefined();
      expect(results[1].code).toBeDefined();
    } finally {
      if (fs.existsSync(tmpFile1)) fs.unlinkSync(tmpFile1);
      if (fs.existsSync(tmpFile2)) fs.unlinkSync(tmpFile2);
    }
  });

  it('should return empty array for empty input', async () => {
    const results = await compileWorkflows([]);
    expect(results).toHaveLength(0);
  });
});

describe('compilePattern', () => {
  it('should compile files matching a glob pattern', async () => {
    const tmpFile = path.join(tmpDir, 'compile-glob-test.ts');
    fs.copyFileSync(fixtureFile, tmpFile);

    try {
      const results = await compilePattern(
        path.join(tmpDir, 'compile-glob-*.ts'),
        { write: false }
      );
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].code).toBeDefined();
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it('should return empty array when no files match', async () => {
    const results = await compilePattern(
      path.join(tmpDir, 'no-match-*.xyz'),
      { write: false }
    );
    expect(results).toHaveLength(0);
  });
});
