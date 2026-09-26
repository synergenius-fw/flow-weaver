/**
 * Tests for compiler codegen type-safety.
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
import { execFileSync } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { stripGeneratedSections, hasInPlaceMarkers } from '../../src/parser/generated-sections';
import { mapToTypeScript } from '../../src/types/type-mappings';
import { executeWorkflow, type CompletedExecutionOutcome } from '../../src/mcp/workflow-executor';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/codegen-types');
const WORKFLOW_PATH = path.join(FIXTURE_DIR, 'workflow.ts');
const CLI_PATH = path.resolve(__dirname, '../../src/cli/index.ts');

// Resolve tsc path
const TSC_PATH = require.resolve('typescript/bin/tsc');

/**
 * The fixture copied to a temporary directory with its generated sections
 * stripped, then compiled by the real CLI. The tracked fixture is never
 * written, and the compile provably runs: the stripped copy has no markers
 * until it does.
 */
let workDir: string;
let workflowCopy: string;
let compiled = '';

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-codegen-types-'));
  for (const f of fs.readdirSync(FIXTURE_DIR)) fs.copyFileSync(path.join(FIXTURE_DIR, f), path.join(workDir, f));
  workflowCopy = path.join(workDir, 'workflow.ts');
  fs.writeFileSync(workflowCopy, stripGeneratedSections(fs.readFileSync(WORKFLOW_PATH, 'utf-8')));
  execFileSync(process.execPath, ['--import', 'tsx', CLI_PATH, 'compile', workflowCopy], {
    encoding: 'utf-8',
    timeout: 60000,
    cwd: path.resolve(__dirname, '../..'),
  });
  compiled = fs.readFileSync(workflowCopy, 'utf-8');
}, 90000);

afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

describe('mapToTypeScript', () => {
  it('preserves primitive types', () => {
    expect(mapToTypeScript('STRING')).toBe('string');
    expect(mapToTypeScript('NUMBER')).toBe('number');
    expect(mapToTypeScript('BOOLEAN')).toBe('boolean');
  });

  it('strips absolute import() paths', () => {
    expect(mapToTypeScript('OBJECT', 'import("/Users/foo/types").Config')).toBe('Record<string, unknown>');
  });

  it('strips relative import() paths', () => {
    expect(mapToTypeScript('OBJECT', 'import("../types").Config')).toBe('Record<string, unknown>');
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
  it('compiles the fixture from source', () => {
    expect(hasInPlaceMarkers(stripGeneratedSections(fs.readFileSync(WORKFLOW_PATH, 'utf-8')))).toBe(false);
    expect(compiled).toContain('@flow-weaver-body-start');
  });

  it('generated code passes tsc --strict', () => {
    // A tsconfig for the compiled copy.
    const tsconfigPath = path.join(workDir, 'tsconfig.test.json');
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['workflow.ts', 'nodes.ts', 'types.ts'],
      }),
    );

    let tscOutput = '';
    try {
      tscOutput = execFileSync(process.execPath, [TSC_PATH, '--project', tsconfigPath], {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      // tsc exits non-zero on a type error and prints it to stdout.
      const e = err as { stdout?: string; message?: string };
      tscOutput = `Generated code has TypeScript errors:\n${e.stdout || e.message}`;
    }
    // tsc prints nothing when there are no errors.
    expect(tscOutput).toBe('');
  });
});

describe('cross-file workflow runtime execution', () => {
  it('runs correctly', async () => {
    const result = await executeWorkflow({
      runId: 'codegen-type-safety',
      filePath: workflowCopy,
      params: {
        raw: JSON.stringify({ name: 'test-app', debug: true, maxRetries: 3 }),
      },
    }) as CompletedExecutionOutcome;

    expect(result.result).toBeDefined();
    const output = result.result as { onSuccess: boolean; output: string };
    expect(output.onSuccess).toBe(true);
  });
});
