import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalCoordinator, defaultRunsDir } from '../../src/coordinator/index.js';

/**
 * The reported bug: a run started via the MCP server did not appear in the
 * console UI, because the two processes — launched from different working
 * directories — used different run stores. Anchoring the store to the
 * workflow file's project makes them share one store. This test reproduces the
 * two-process shape: two coordinators, each built from `defaultRunsDir(file)`
 * as a differently-located process would, must see each other's runs.
 */

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'continuation',
  'fixtures'
);
const approval = path.join(fixtures, 'durable-approval.ts');

let projectRoot: string;
let workflowFile: string;
const savedRunsDir = process.env.FW_RUNS_DIR;

beforeEach(() => {
  // A throwaway project: package.json marks the root, the workflow lives under src/.
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-shared-'));
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}');
  fs.mkdirSync(path.join(projectRoot, 'src'));
  workflowFile = path.join(projectRoot, 'src', 'wf.ts');
  fs.copyFileSync(approval, workflowFile);
  delete process.env.FW_RUNS_DIR;
});
afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
  if (savedRunsDir === undefined) delete process.env.FW_RUNS_DIR;
  else process.env.FW_RUNS_DIR = savedRunsDir;
});

describe('project-anchored run store is shared across coordinators', () => {
  it('a run one coordinator starts is visible to another anchored to the same file', async () => {
    // Process A (say, the MCP server): resolves the store from the file.
    const dirA = defaultRunsDir(workflowFile);
    const coordA = createLocalCoordinator({ rootDir: dirA });

    // Process B (say, the console): opened on the project directory. It must
    // resolve the SAME store even though it anchors on the project dir, not the
    // file — that is the whole point.
    const dirB = defaultRunsDir(projectRoot);
    expect(dirB).toBe(dirA);
    const coordB = createLocalCoordinator({ rootDir: dirB });

    const started = await coordA.start({ filePath: workflowFile, params: { value: 42 }, origin: 'mcp' });
    expect(started.runId).toBeTruthy();

    // B lists runs and sees A's run.
    const seenByB = await coordB.list();
    expect(seenByB.map((r) => r.runId)).toContain(started.runId);

    // And a filePath-scoped list (what the console uses) still finds it.
    const scoped = await coordB.list({ filePath: workflowFile });
    expect(scoped.map((r) => r.runId)).toContain(started.runId);
  });

  it('lands the runs under <projectRoot>/.fw/runs', async () => {
    const coord = createLocalCoordinator({ rootDir: defaultRunsDir(workflowFile) });
    const started = await coord.start({ filePath: workflowFile, params: { value: 42 }, origin: 'mcp' });
    const runsDir = path.join(path.resolve(projectRoot), '.fw', 'runs');
    expect(fs.existsSync(path.join(runsDir, started.runId, 'run.json'))).toBe(true);
  });
});
