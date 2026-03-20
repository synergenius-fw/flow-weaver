/**
 * Comprehensive tests for compiler codegen type-safety.
 *
 * Tests that generated code compiles under `tsc --strict` when node types
 * are imported from separate files (cross-file compilation).
 *
 * Bugs covered:
 * 1. TDebugController | undefined not assignable to TDebugController
 * 2. import() absolute paths in type assertions (already fixed)
 * 3. Bare external type names (AppConfig) not in scope
 * 4. Record<string, unknown> not assignable to specific interface
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import { mapToTypeScript } from '../../src/type-mappings';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/codegen-types');
const WORKFLOW_PATH = path.join(FIXTURE_DIR, 'workflow.ts');

// Resolve tsc path
const TSC_PATH = (() => {
  try { return require.resolve('typescript/bin/tsc'); } catch { return 'npx tsc'; }
})();

describe('mapToTypeScript', () => {
  it('preserves primitive types', () => {
    expect(mapToTypeScript('STRING')).toBe('string');
    expect(mapToTypeScript('NUMBER')).toBe('number');
    expect(mapToTypeScript('BOOLEAN')).toBe('boolean');
  });

  it('strips absolute import() paths', () => {
    expect(mapToTypeScript('OBJECT', 'import("/Users/foo/types").Config'))
      .toBe('Record<string, unknown>');
  });

  it('strips relative import() paths', () => {
    expect(mapToTypeScript('OBJECT', 'import("../types").Config'))
      .toBe('Record<string, unknown>');
  });

  it('preserves structural types', () => {
    expect(mapToTypeScript('OBJECT', '{ name: string }')).toBe('{ name: string }');
    expect(mapToTypeScript('OBJECT', 'Record<string, unknown>')).toBe('Record<string, unknown>');
  });

  it('preserves array types', () => {
    expect(mapToTypeScript('ARRAY', 'string[]')).toBe('string[]');
    expect(mapToTypeScript('ARRAY', 'SearchResult[]')).toBe('SearchResult[]');
  });
});

describe('cross-file workflow tsc --strict validity', () => {
  it('compiles the fixture', () => {
    const output = execSync(
      `npx flow-weaver compile ${WORKFLOW_PATH}`,
      { encoding: 'utf-8', timeout: 30000, cwd: path.resolve(__dirname, '../..') }
    );
    const compiled = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(compiled).toContain('@flow-weaver-body-start');
  });

  it('generated code passes tsc --strict', () => {
    // First compile the workflow
    execSync(
      `npx flow-weaver compile ${WORKFLOW_PATH}`,
      { encoding: 'utf-8', timeout: 30000, cwd: path.resolve(__dirname, '../..') }
    );

    // Create a tsconfig for the fixture directory
    const tsconfigPath = path.join(FIXTURE_DIR, 'tsconfig.test.json');
    fs.writeFileSync(tsconfigPath, JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ['workflow.ts', 'nodes.ts', 'types.ts'],
    }));

    try {
      const tscOutput = execSync(`node ${TSC_PATH} --project ${tsconfigPath}`, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // No output = no errors
    } catch (err: unknown) {
      const output = (err as { stdout?: string; stderr?: string }).stdout ?? '';
      // Clean up before failing
      try { fs.unlinkSync(tsconfigPath); } catch {}
      throw new Error(`Generated code has TypeScript errors:\n${output}`);
    } finally {
      try { fs.unlinkSync(tsconfigPath); } catch {}
    }
  });
});

describe('cross-file workflow runtime execution', () => {
  it('runs correctly', async () => {
    const result = await executeWorkflowFromFile(WORKFLOW_PATH, {
      raw: JSON.stringify({ name: 'test-app', debug: true, maxRetries: 3 }),
    });

    expect(result.result).toBeDefined();
    const output = result.result as { onSuccess: boolean; output: string };
    expect(output.onSuccess).toBe(true);
  });
});
