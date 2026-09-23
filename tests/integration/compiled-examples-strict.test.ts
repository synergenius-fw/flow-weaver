/**
 * Compiled files are TypeScript the user owns, so they must type-check in a
 * strict project. Each shipped example is compiled the way `fw compile` does
 * it (on a copy: compile rewrites the file in place) and the result is checked
 * with `strict: true`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { compileCommand } from '../../src/cli/commands/compile';
import { logger } from '../../src/cli/utils/logger';

const ROOT = path.resolve(__dirname, '../..');
const EXAMPLES = [
  'examples/research-agent-loop.ts',
  'use-cases/hello-world.ts',
  'use-cases/data-pipeline.ts',
  'use-cases/human-approval.ts',
  'use-cases/parallel-enrichment.ts',
  'use-cases/agent-gate-demo/review-file.ts',
  'use-cases/agent-gate-demo/review-with-validation.ts',
  'use-cases/batch-invoices/batch-invoices.ts',
  'use-cases/figma-to-page/figma-to-page.ts',
  'use-cases/resume-yield-demo/incident-triage.ts',
  'use-cases/two-in-one-file/notifications.ts',
];

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-strict-'));
  for (const level of ['info', 'warn', 'error', 'success', 'log', 'section', 'newline', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation(() => {});
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function strictErrors(file: string): string[] {
  const program = ts.createProgram([file], {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ['node'],
    typeRoots: [path.join(ROOT, 'node_modules/@types')],
  });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error && d.file?.fileName === file)
    .map((d) => {
      const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
      return `line ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
}

describe('compiled examples under strict TypeScript', () => {
  it.each(EXAMPLES)('%s', async (example) => {
    const file = path.join(dir, example.replace(/\//g, '_'));
    fs.copyFileSync(path.join(ROOT, example), file);
    await compileCommand(file, {});
    expect(fs.readFileSync(file, 'utf8')).toContain('// @flow-weaver-body-start');
    expect(strictErrors(file)).toEqual([]);
  }, 60_000);
});
