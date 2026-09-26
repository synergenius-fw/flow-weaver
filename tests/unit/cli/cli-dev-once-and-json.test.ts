/**
 * fw dev --once is for scripts and CI: its exit code says whether the cycle
 * worked. fw dev --json is for programs: stdout carries only the JSON
 * result, and everything written for a person goes to stderr.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { mockCompileCommand, mockExecuteWorkflow } = vi.hoisted(() => ({
  mockCompileCommand: vi.fn(),
  mockExecuteWorkflow: vi.fn(),
}));

vi.mock('../../../src/cli/commands/compile.js', () => ({ compileCommand: mockCompileCommand }));
vi.mock('../../../src/mcp/workflow-executor.js', () => ({ executeWorkflow: mockExecuteWorkflow }));

import { devCommand } from '../../../src/cli/commands/dev.js';
import { logger } from '../../../src/cli/utils/logger.js';

let dir: string;
let file: string;
let stdout: string[];
let consoleLog: string[];
let stderr: string[];
let exitCodeBefore: typeof process.exitCode;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-dev-once-'));
  file = path.join(dir, 'wf.ts');
  fs.writeFileSync(file, '// a workflow');
  mockCompileCommand.mockReset();
  mockExecuteWorkflow.mockReset();
  stdout = []; consoleLog = []; stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { stdout.push(String(chunk)); return true; }) as typeof process.stdout.write);
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { consoleLog.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { stderr.push(a.join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { stderr.push(a.join(' ')); });
  exitCodeBefore = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = exitCodeBefore;
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const completed = { kind: 'completed', functionName: 'wf', executionTime: 3, result: { onSuccess: true, onFailure: false, out: 1 } };

describe('fw dev --once', () => {
  it('exits 0 when the cycle compiles and runs', async () => {
    mockCompileCommand.mockResolvedValue(undefined);
    mockExecuteWorkflow.mockResolvedValue(completed);
    await devCommand(file, { once: true });
    expect(process.exitCode).toBeUndefined();
  });

  it('exits 1 when the compile fails', async () => {
    mockCompileCommand.mockRejectedValue(new Error('does not compile'));
    await devCommand(file, { once: true });
    expect(process.exitCode).toBe(1);
    expect(mockExecuteWorkflow).not.toHaveBeenCalled();
  });

  it('exits 1 when the run fails', async () => {
    mockCompileCommand.mockResolvedValue(undefined);
    mockExecuteWorkflow.mockRejectedValue(new Error('the node threw'));
    await devCommand(file, { once: true });
    expect(process.exitCode).toBe(1);
  });
});

describe('fw dev --json', () => {
  it('prints only the JSON result on stdout; what compile says for a person goes to stderr', async () => {
    mockCompileCommand.mockImplementation(async () => { logger.info('Compiling wf.ts'); logger.success('1 file compiled'); });
    mockExecuteWorkflow.mockResolvedValue(completed);
    await devCommand(file, { once: true, json: true });
    expect(consoleLog).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toEqual({ success: true, workflow: 'wf', executionTime: 3, result: completed.result });
    expect(stderr.join('\n')).toContain('Compiling wf.ts');
  });

  it('reports a compile failure as JSON on stdout', async () => {
    mockCompileCommand.mockRejectedValue(new Error('does not compile'));
    await devCommand(file, { once: true, json: true });
    expect(consoleLog).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toEqual({ success: false, error: 'does not compile' });
    expect(process.exitCode).toBe(1);
  });

  it('leaves the logger writing to stdout again afterwards', async () => {
    mockCompileCommand.mockResolvedValue(undefined);
    mockExecuteWorkflow.mockResolvedValue(completed);
    await devCommand(file, { once: true, json: true });
    logger.info('after');
    expect(consoleLog.join('\n')).toContain('after');
  });
});
