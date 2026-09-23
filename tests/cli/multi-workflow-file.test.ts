/**
 * A file is a module, not a workflow: `use-cases/two-in-one-file` declares two
 * workflows. Without -w, `fw validate` and `fw compile` handle every workflow in
 * the file instead of refusing with MULTIPLE_WORKFLOWS_FOUND.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateCommand } from '../../src/cli/commands/validate';
import { compileCommand } from '../../src/cli/commands/compile';
import { logger } from '../../src/cli/utils/logger';

const SOURCE = path.resolve(__dirname, '../../use-cases/two-in-one-file/notifications.ts');
const BODY_START = '// @flow-weaver-body-start';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-multi-workflow-'));
  file = path.join(dir, 'notifications.ts');
  fs.copyFileSync(SOURCE, file);
  for (const level of ['info', 'warn', 'error', 'success', 'log', 'section', 'newline', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function validateJson(target: string, workflowName?: string) {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  await validateCommand(target, { json: true, workflowName });
  return JSON.parse(logs.join(''));
}

describe('a file with two workflows', () => {
  it('fw validate checks each workflow and still counts one file', async () => {
    const out = await validateJson(file);
    expect(out.valid).toBe(true);
    expect(out.totalFiles).toBe(1);
    expect(out.validFiles).toBe(1);
    expect(out.results.map((r: { workflow: string; valid: boolean }) => [r.workflow, r.valid])).toEqual([
      ['emailAlert', true],
      ['chatAlert', true],
    ]);
  });

  it('fw validate -w still checks only the named workflow, without a workflow field', async () => {
    const out = await validateJson(file, 'chatAlert');
    expect(out.results).toHaveLength(1);
    expect(out.results[0].workflow).toBeUndefined();
    expect(out.results[0].valid).toBe(true);
  });

  it('fw compile installs every body, and a second compile changes nothing', async () => {
    await compileCommand(file, {});
    const once = fs.readFileSync(file, 'utf8');
    expect(once.split(BODY_START).length - 1).toBe(2);

    await compileCommand(file, {});
    expect(fs.readFileSync(file, 'utf8')).toBe(once);
  });

  it('fw compile --dry-run leaves the file as it was', async () => {
    const before = fs.readFileSync(file, 'utf8');
    await compileCommand(file, { dryRun: true });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('fw compile -w installs only the named body', async () => {
    await compileCommand(file, { workflowName: 'emailAlert' });
    expect(fs.readFileSync(file, 'utf8').split(BODY_START).length - 1).toBe(1);
  });
});
