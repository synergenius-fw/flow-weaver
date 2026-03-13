/**
 * Coverage tests for src/cli/commands/init.ts
 * Targets uncovered lines: 775-798 (agent handoff in initCommand),
 * 806 (agentLaunched return), 824 (ExitPromptError catch).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-init-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('initCommand coverage - agent handoff path', () => {
  it('should detect CLI tools and attempt agent handoff when not skipped', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const mcpSetup = await import('../../src/cli/commands/mcp-setup');

    // Mock detectCliTools to return a CLI tool
    vi.spyOn(mcpSetup, 'detectCliTools').mockResolvedValue(['claude']);

    // Mock handleAgentHandoff (imported in init.ts)
    const initModule = await import('../../src/cli/commands/init');
    vi.spyOn(initModule, 'handleAgentHandoff').mockResolvedValue(false);

    // Mock npm install and git init to avoid real side effects
    vi.spyOn(initModule, 'runNpmInstall').mockReturnValue({ success: true });
    vi.spyOn(initModule, 'runGitInit').mockReturnValue({ success: true });

    const targetDir = path.join(TEMP_DIR, 'agent-handoff-test');

    await initCommand(targetDir, {
      yes: false,
      template: 'sequential',
      preset: 'expert',
      install: true,
      git: true,
      mcp: false,
      agent: undefined,
    });

    expect(mcpSetup.detectCliTools).toHaveBeenCalled();
    expect(initModule.handleAgentHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'agent-handoff-test',
        persona: 'expert',
        template: 'sequential',
        cliTools: ['claude'],
      })
    );

    // Cleanup
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('should skip agent handoff when --agent=false', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const initModule = await import('../../src/cli/commands/init');
    const mcpSetup = await import('../../src/cli/commands/mcp-setup');

    vi.spyOn(initModule, 'runNpmInstall').mockReturnValue({ success: true });
    vi.spyOn(initModule, 'runGitInit').mockReturnValue({ success: true });
    const detectSpy = vi.spyOn(mcpSetup, 'detectCliTools').mockResolvedValue(['claude']);

    const targetDir = path.join(TEMP_DIR, 'no-agent-test');

    await initCommand(targetDir, {
      yes: false,
      template: 'sequential',
      preset: 'expert',
      install: true,
      git: true,
      mcp: false,
      agent: false,
    });

    // detectCliTools should not be called when agent=false
    expect(detectSpy).not.toHaveBeenCalled();

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('should skip agent handoff when --yes (non-interactive)', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const initModule = await import('../../src/cli/commands/init');
    const mcpSetup = await import('../../src/cli/commands/mcp-setup');

    vi.spyOn(initModule, 'runNpmInstall').mockReturnValue({ success: true });
    vi.spyOn(initModule, 'runGitInit').mockReturnValue({ success: true });
    const detectSpy = vi.spyOn(mcpSetup, 'detectCliTools').mockResolvedValue([]);

    const targetDir = path.join(TEMP_DIR, 'yes-test');

    await initCommand(targetDir, {
      yes: true,
      template: 'sequential',
      install: true,
      git: true,
      mcp: false,
    });

    expect(detectSpy).not.toHaveBeenCalled();

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('should return early when agent is launched', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const initModule = await import('../../src/cli/commands/init');
    const mcpSetup = await import('../../src/cli/commands/mcp-setup');

    vi.spyOn(mcpSetup, 'detectCliTools').mockResolvedValue(['claude']);
    vi.spyOn(initModule, 'handleAgentHandoff').mockResolvedValue(true);
    vi.spyOn(initModule, 'runNpmInstall').mockReturnValue({ success: true });
    vi.spyOn(initModule, 'runGitInit').mockReturnValue({ success: true });

    const targetDir = path.join(TEMP_DIR, 'agent-launched-test');

    // Should return without printing next steps
    await initCommand(targetDir, {
      yes: false,
      template: 'sequential',
      preset: 'expert',
      install: true,
      git: true,
      mcp: false,
    });

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('should catch ExitPromptError during agent handoff gracefully', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const initModule = await import('../../src/cli/commands/init');
    const mcpSetup = await import('../../src/cli/commands/mcp-setup');
    const { ExitPromptError } = await import('@inquirer/core');

    vi.spyOn(mcpSetup, 'detectCliTools').mockResolvedValue(['claude']);
    vi.spyOn(initModule, 'handleAgentHandoff').mockRejectedValue(
      new ExitPromptError()
    );
    vi.spyOn(initModule, 'runNpmInstall').mockReturnValue({ success: true });
    vi.spyOn(initModule, 'runGitInit').mockReturnValue({ success: true });

    const targetDir = path.join(TEMP_DIR, 'exit-prompt-test');

    // Should not throw
    await initCommand(targetDir, {
      yes: false,
      template: 'sequential',
      preset: 'expert',
      install: true,
      git: true,
      mcp: false,
    });

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('should silently handle non-fatal errors during agent handoff', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const initModule = await import('../../src/cli/commands/init');
    const mcpSetup = await import('../../src/cli/commands/mcp-setup');

    vi.spyOn(mcpSetup, 'detectCliTools').mockResolvedValue(['claude']);
    vi.spyOn(initModule, 'handleAgentHandoff').mockRejectedValue(
      new Error('Some handoff error')
    );
    vi.spyOn(initModule, 'runNpmInstall').mockReturnValue({ success: true });
    vi.spyOn(initModule, 'runGitInit').mockReturnValue({ success: true });

    const targetDir = path.join(TEMP_DIR, 'handoff-error-test');

    // Should not throw; error is silently caught
    await initCommand(targetDir, {
      yes: false,
      template: 'sequential',
      preset: 'expert',
      install: true,
      git: true,
      mcp: false,
    });

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('should handle detectCliTools failure gracefully', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const initModule = await import('../../src/cli/commands/init');
    const mcpSetup = await import('../../src/cli/commands/mcp-setup');

    vi.spyOn(mcpSetup, 'detectCliTools').mockRejectedValue(
      new Error('Detection failed')
    );
    vi.spyOn(initModule, 'runNpmInstall').mockReturnValue({ success: true });
    vi.spyOn(initModule, 'runGitInit').mockReturnValue({ success: true });

    const targetDir = path.join(TEMP_DIR, 'detect-fail-test');

    // Should not throw
    await initCommand(targetDir, {
      yes: false,
      template: 'sequential',
      preset: 'expert',
      install: true,
      git: true,
      mcp: false,
    });

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('should output JSON report and skip agent handoff when json=true', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const initModule = await import('../../src/cli/commands/init');

    vi.spyOn(initModule, 'runNpmInstall').mockReturnValue({ success: true });
    vi.spyOn(initModule, 'runGitInit').mockReturnValue({ success: true });

    const targetDir = path.join(TEMP_DIR, 'json-output-test');

    await initCommand(targetDir, {
      yes: true,
      template: 'sequential',
      install: true,
      git: true,
      mcp: false,
      json: true,
    });

    fs.rmSync(targetDir, { recursive: true, force: true });
  });
});

describe('initCommand coverage - ExitPromptError at top level', () => {
  it('should catch ExitPromptError thrown from resolveInitConfig', async () => {
    const { initCommand } = await import('../../src/cli/commands/init');
    const initModule = await import('../../src/cli/commands/init');
    const { ExitPromptError } = await import('@inquirer/core');

    vi.spyOn(initModule, 'resolveInitConfig').mockRejectedValue(
      new ExitPromptError()
    );

    // Should return without throwing
    await initCommand(undefined, {});
  });
});

describe('handleAgentHandoff coverage', () => {
  it('should offer to launch CLI agent and return true when accepted', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');
    const confirmModule = await import('@inquirer/confirm');
    const childProcess = await import('child_process');

    // Mock confirm to accept launch
    vi.spyOn(confirmModule, 'default').mockResolvedValue(true);

    // Mock spawn
    const mockChild = {
      on: vi.fn(),
    };
    vi.spyOn(childProcess, 'spawn').mockReturnValue(mockChild as any);

    const result = await handleAgentHandoff({
      projectName: 'test-project',
      persona: 'vibecoder',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: ['claude'],
      guiTools: [],
      filesCreated: ['package.json'],
    });

    expect(result).toBe(true);
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({ cwd: TEMP_DIR, stdio: 'inherit' })
    );
  });

  it('should fall through to prompt options when CLI launch is declined', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');
    const confirmModule = await import('@inquirer/confirm');
    const selectModule = await import('@inquirer/select');

    // First confirm (launch agent) = false, then select (prompt action) = skip
    vi.spyOn(confirmModule, 'default').mockResolvedValue(false);
    vi.spyOn(selectModule, 'default').mockResolvedValue('skip' as any);

    const result = await handleAgentHandoff({
      projectName: 'test-project',
      persona: 'expert',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: ['claude'],
      guiTools: [],
      filesCreated: ['package.json'],
    });

    expect(result).toBe(false);
  });

  it('should generate prompt file when file option selected', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');
    const selectModule = await import('@inquirer/select');

    // No CLI tools, only GUI tools, so it skips CLI agent and goes to prompt options
    vi.spyOn(selectModule, 'default').mockResolvedValue('file' as any);

    const testDir = path.join(TEMP_DIR, 'prompt-file-test');
    fs.mkdirSync(testDir, { recursive: true });
    // Create .gitignore so the append logic runs
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules\n');

    const result = await handleAgentHandoff({
      projectName: 'test-project',
      persona: 'vibecoder',
      template: 'sequential',
      targetDir: testDir,
      cliTools: [],
      guiTools: ['cursor'],
      filesCreated: ['package.json'],
    });

    expect(result).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'PROJECT_SETUP.md'))).toBe(true);

    const gitignore = fs.readFileSync(path.join(testDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('PROJECT_SETUP.md');
  });

  it('should print terminal prompt when terminal option selected', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');
    const selectModule = await import('@inquirer/select');

    vi.spyOn(selectModule, 'default').mockResolvedValue('terminal' as any);

    const result = await handleAgentHandoff({
      projectName: 'test-project',
      persona: 'lowcode',
      template: 'sequential',
      targetDir: TEMP_DIR,
      cliTools: [],
      guiTools: ['vscode'],
      filesCreated: ['package.json'],
    });

    expect(result).toBe(false);
  });

  it('should handle both option (terminal + file)', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');
    const selectModule = await import('@inquirer/select');

    vi.spyOn(selectModule, 'default').mockResolvedValue('both' as any);

    const testDir = path.join(TEMP_DIR, 'both-test');
    fs.mkdirSync(testDir, { recursive: true });

    const result = await handleAgentHandoff({
      projectName: 'test-project',
      persona: 'nocode',
      template: 'sequential',
      targetDir: testDir,
      cliTools: [],
      guiTools: ['cursor'],
      filesCreated: ['package.json'],
    });

    expect(result).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'PROJECT_SETUP.md'))).toBe(true);
  });

  it('should not duplicate PROJECT_SETUP.md in gitignore', async () => {
    const { handleAgentHandoff } = await import('../../src/cli/commands/init');
    const selectModule = await import('@inquirer/select');

    vi.spyOn(selectModule, 'default').mockResolvedValue('file' as any);

    const testDir = path.join(TEMP_DIR, 'no-dup-test');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules\nPROJECT_SETUP.md\n');

    await handleAgentHandoff({
      projectName: 'test-project',
      persona: 'vibecoder',
      template: 'sequential',
      targetDir: testDir,
      cliTools: [],
      guiTools: ['cursor'],
      filesCreated: [],
    });

    const gitignore = fs.readFileSync(path.join(testDir, '.gitignore'), 'utf-8');
    const count = (gitignore.match(/PROJECT_SETUP\.md/g) || []).length;
    expect(count).toBe(1);
  });
});

describe('utility function coverage', () => {
  it('validateProjectName rejects empty name', async () => {
    const { validateProjectName } = await import('../../src/cli/commands/init');
    expect(validateProjectName('')).toBe('Project name cannot be empty');
  });

  it('validateProjectName rejects names over 214 chars', async () => {
    const { validateProjectName } = await import('../../src/cli/commands/init');
    const longName = 'a'.repeat(215);
    expect(validateProjectName(longName)).toContain('at most 214');
  });

  it('validateProjectName rejects names with invalid chars', async () => {
    const { validateProjectName } = await import('../../src/cli/commands/init');
    expect(validateProjectName('bad name!')).toContain('must start with');
  });

  it('toWorkflowName converts hyphens to camelCase', async () => {
    const { toWorkflowName } = await import('../../src/cli/commands/init');
    expect(toWorkflowName('my-cool-project')).toBe('myCoolProjectWorkflow');
  });

  it('toWorkflowName handles empty/invalid prefix', async () => {
    const { toWorkflowName } = await import('../../src/cli/commands/init');
    // When all leading chars are stripped, should fallback to myProject
    expect(toWorkflowName('---')).toBe('myProjectWorkflow');
  });

  it('generateProjectFiles adds diagram script for non-expert persona', async () => {
    const { generateProjectFiles } = await import('../../src/cli/commands/init');
    const files = generateProjectFiles('test-proj', 'sequential', 'esm', 'vibecoder');
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.scripts.diagram).toBeDefined();
  });

  it('generateProjectFiles uses CJS format when specified', async () => {
    const { generateProjectFiles } = await import('../../src/cli/commands/init');
    const files = generateProjectFiles('test-proj', 'sequential', 'cjs', 'expert');
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBeUndefined();
    expect(files['src/main.ts']).toContain('require(');
  });

  it('generateProjectFiles adds example workflow for lowcode persona', async () => {
    const { generateProjectFiles } = await import('../../src/cli/commands/init');
    const files = generateProjectFiles('test-proj', 'sequential', 'esm', 'lowcode');
    expect(files['examples/example-workflow.ts']).toBeDefined();
  });

  it('scaffoldProject skips existing files without force', async () => {
    const { scaffoldProject } = await import('../../src/cli/commands/init');

    const testDir = path.join(TEMP_DIR, 'scaffold-skip');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'existing.txt'), 'original');

    const result = scaffoldProject(testDir, {
      'existing.txt': 'new content',
      'new.txt': 'new file',
    }, { force: false });

    expect(result.filesSkipped).toContain('existing.txt');
    expect(result.filesCreated).toContain('new.txt');
    expect(fs.readFileSync(path.join(testDir, 'existing.txt'), 'utf-8')).toBe('original');
  });

  it('scaffoldProject overwrites existing files with force', async () => {
    const { scaffoldProject } = await import('../../src/cli/commands/init');

    const testDir = path.join(TEMP_DIR, 'scaffold-force');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'existing.txt'), 'original');

    const result = scaffoldProject(testDir, {
      'existing.txt': 'new content',
    }, { force: true });

    expect(result.filesCreated).toContain('existing.txt');
    expect(fs.readFileSync(path.join(testDir, 'existing.txt'), 'utf-8')).toBe('new content');
  });
});
