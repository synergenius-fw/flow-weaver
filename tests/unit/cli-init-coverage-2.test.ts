/**
 * Additional coverage tests for src/cli/commands/init.ts
 * Targets uncovered lines: 775-798 (agent handoff with detectCliTools fallback),
 * 806 (agentLaunched early return), 824 (ExitPromptError in outer catch).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Module-level mocks for inquirer and child_process (ESM + isolate: false)
const mockConfirm = vi.fn();
vi.mock('@inquirer/confirm', () => ({ default: mockConfirm }));

const mockSelect = vi.fn();
vi.mock('@inquirer/select', () => ({
  default: mockSelect,
  Separator: class Separator {},
}));

const mockInput = vi.fn();
vi.mock('@inquirer/input', () => ({ default: mockInput }));

const mockSpawn = vi.fn();
vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('child_process')>();
  return {
    ...orig,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
});

const mockDetectCliTools = vi.fn();
const mockRunMcpSetupFromInit = vi.fn();
vi.mock('../../src/cli/commands/mcp-setup.js', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    detectCliTools: (...args: unknown[]) => mockDetectCliTools(...args),
    runMcpSetupFromInit: (...args: unknown[]) => mockRunMcpSetupFromInit(...args),
  };
});

const TEMP_DIR = path.join(os.tmpdir(), `fw-init-cov2-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  mockConfirm.mockReset();
  mockSelect.mockReset();
  mockInput.mockReset();
  mockSpawn.mockReset();
  mockDetectCliTools.mockReset().mockResolvedValue([]);
  mockRunMcpSetupFromInit.mockReset().mockResolvedValue({
    configured: [], failed: [], detected: [], cliTools: [], guiTools: [],
  });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── handleAgentHandoff ──────────────────────────────────────────────────────

describe('handleAgentHandoff coverage', () => {
  it('should launch CLI agent when cliTools provided and user confirms', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');

    mockConfirm.mockResolvedValueOnce(true);
    const fakeChild = { on: vi.fn() };
    mockSpawn.mockReturnValue(fakeChild);

    const result = await handleAgentHandoff({
      projectName: 'test-proj',
      persona: 'expert',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: ['claude'],
      guiTools: [],
      filesCreated: ['package.json'],
    });

    expect(result).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({ cwd: TEMP_DIR, stdio: 'inherit' }),
    );
  });

  it('should offer GUI prompt when user declines CLI launch', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');

    // Decline CLI, then skip editor prompt
    mockConfirm.mockResolvedValueOnce(false);
    mockSelect.mockResolvedValueOnce('skip');

    const result = await handleAgentHandoff({
      projectName: 'test-proj',
      persona: 'vibecoder',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: ['claude'],
      guiTools: ['cursor'],
      filesCreated: ['package.json'],
    });

    expect(result).toBe(false);
  });

  it('should print prompt to terminal when user selects terminal option', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');

    mockSelect.mockResolvedValueOnce('terminal');

    const result = await handleAgentHandoff({
      projectName: 'test-proj',
      persona: 'nocode',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: [],
      guiTools: ['vscode'],
      filesCreated: ['package.json'],
      useCaseDescription: 'Build a data pipeline',
    });

    expect(result).toBe(false);
  });

  it('should save prompt file when user selects file option', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');

    mockSelect.mockResolvedValueOnce('file');

    const result = await handleAgentHandoff({
      projectName: 'test-proj',
      persona: 'lowcode',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: [],
      guiTools: ['cursor'],
      filesCreated: ['package.json', 'src/main.ts'],
    });

    expect(result).toBe(false);
    expect(fs.existsSync(path.join(TEMP_DIR, 'PROJECT_SETUP.md'))).toBe(true);
  });

  it('should do both terminal and file when user selects both option', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');

    mockSelect.mockResolvedValueOnce('both');

    const result = await handleAgentHandoff({
      projectName: 'test-proj',
      persona: 'expert',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: [],
      guiTools: ['windsurf'],
      filesCreated: ['package.json'],
    });

    expect(result).toBe(false);
    expect(fs.existsSync(path.join(TEMP_DIR, 'PROJECT_SETUP.md'))).toBe(true);
  });

  it('should return false when no tools available', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');

    const result = await handleAgentHandoff({
      projectName: 'test-proj',
      persona: 'expert',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: [],
      guiTools: [],
      filesCreated: [],
    });

    expect(result).toBe(false);
  });
});

// ── initCommand agent handoff paths ─────────────────────────────────────────

describe('initCommand agent handoff and error paths', () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    // Force interactive mode so the agent handoff block is entered
    (process.stdin as any).isTTY = true;
  });

  afterEach(() => {
    (process.stdin as any).isTTY = origIsTTY;
  });

  it('should fall back to detectCliTools when mcpCliTools is empty', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');

    // detectCliTools returns a CLI tool
    mockDetectCliTools.mockResolvedValue(['claude']);

    // Decline CLI launch, skip editor prompt
    mockConfirm.mockResolvedValue(false);
    mockSelect.mockResolvedValue('skip');

    const targetDir = path.join(TEMP_DIR, 'init-detect-fallback');

    await initCommand(targetDir, {
      yes: false,
      install: false,
      git: false,
      mcp: false,
      agent: true,
      preset: 'expert',
      name: 'agent-test',
      template: 'sequential',
      format: 'esm',
    });

    expect(mockDetectCliTools).toHaveBeenCalled();
  });

  it('should return early when agentLaunched is true (line 806)', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');

    mockDetectCliTools.mockResolvedValue(['claude']);
    mockConfirm.mockResolvedValue(true);

    const fakeChild = { on: vi.fn() };
    mockSpawn.mockReturnValue(fakeChild);

    const targetDir = path.join(TEMP_DIR, 'init-agent-launched');

    await initCommand(targetDir, {
      yes: false,
      install: false,
      git: false,
      mcp: false,
      agent: true,
      preset: 'expert',
      name: 'launched-test',
      template: 'sequential',
      format: 'esm',
    });

    // Verify agent was spawned
    expect(mockSpawn).toHaveBeenCalled();
    expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
  });

  it('should handle detectCliTools throwing an error gracefully (line 778)', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');

    mockDetectCliTools.mockRejectedValue(new Error('which failed'));

    const targetDir = path.join(TEMP_DIR, 'init-detect-fail');

    // Should not throw; detectCliTools error is non-fatal
    await initCommand(targetDir, {
      yes: false,
      install: false,
      git: false,
      mcp: false,
      agent: true,
      preset: 'expert',
      name: 'detect-fail',
      template: 'sequential',
      format: 'esm',
    });

    expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
  });

  it('should handle ExitPromptError during agent handoff (line 798)', async () => {
    const { ExitPromptError } = await import('@inquirer/core');
    const { initCommand } = await import('../../src/cli/commands/init');

    mockDetectCliTools.mockResolvedValue(['claude']);
    mockConfirm.mockRejectedValue(new ExitPromptError(''));

    const targetDir = path.join(TEMP_DIR, 'init-exit-agent');

    // Should return silently without throwing
    await initCommand(targetDir, {
      yes: false,
      install: false,
      git: false,
      mcp: false,
      agent: true,
      preset: 'expert',
      name: 'exit-agent',
      template: 'sequential',
      format: 'esm',
    });
  });

  it('should handle ExitPromptError in the outer catch block (line 824)', async () => {
    const { ExitPromptError } = await import('@inquirer/core');
    const { initCommand } = await import('../../src/cli/commands/init');

    // Make the first interactive prompt throw ExitPromptError
    // This simulates Ctrl+C early in the flow
    mockInput.mockRejectedValue(new ExitPromptError(''));
    mockSelect.mockRejectedValue(new ExitPromptError(''));

    const targetDir = path.join(TEMP_DIR, 'init-exit-outer');

    // Non-interactive: false, no preset, no name -> triggers prompts
    // But since we're mocking, the prompts will throw ExitPromptError
    // which should be caught by the outer try/catch
    await initCommand(targetDir, {
      install: false,
      git: false,
    });
  });
});
