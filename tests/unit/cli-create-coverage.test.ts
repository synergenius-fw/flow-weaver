/**
 * Coverage tests for src/cli/commands/create.ts (lines 164, 183, 187-188)
 * Targets: createNodeCommand unknown template, invalid --config JSON, line insertion info,
 * and error handling in node file creation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-create-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('createNodeCommand coverage', () => {
  it('should exit for unknown node template', async () => {
    const { createNodeCommand } = await import('../../src/cli/commands/create');
    // vitest intercepts process.exit and throws "process.exit unexpectedly called"
    await expect(
      createNodeCommand('myNode', 'test.ts', { template: 'nonexistent-node-tmpl' })
    ).rejects.toThrow(/process\.exit/);
  });

  it('should exit for invalid --config JSON in createNodeCommand', async () => {
    const { createNodeCommand } = await import('../../src/cli/commands/create');
    await expect(
      createNodeCommand('myNode', 'test.ts', { config: 'not valid json{', template: 'transformer' })
    ).rejects.toThrow(/process\.exit/);
  });

  it('should create node with --line option and show insertion info', async () => {
    const { createNodeCommand } = await import('../../src/cli/commands/create');
    const filePath = writeFixture('node-line.ts', '// line 1\n// line 2\n// line 3\n');

    await createNodeCommand('myNode', filePath, { line: 2, template: 'transformer' });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('myNode');
  });

  it('should create node with --strategy option', async () => {
    const { createNodeCommand } = await import('../../src/cli/commands/create');
    const filePath = path.join(TEMP_DIR, 'node-strategy.ts');

    await createNodeCommand('approvalNode', filePath, { strategy: 'manual', template: 'transformer' });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('approvalNode');
  });

  it('should create node with valid --config JSON', async () => {
    const { createNodeCommand } = await import('../../src/cli/commands/create');
    const filePath = path.join(TEMP_DIR, 'node-config.ts');

    await createNodeCommand('configNode', filePath, { config: '{"maxRetries": 3}', template: 'transformer' });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('configNode');
  });

  it('should output code in preview mode without writing', async () => {
    const { createNodeCommand } = await import('../../src/cli/commands/create');
    const filePath = path.join(TEMP_DIR, 'node-preview.ts');

    await createNodeCommand('previewNode', filePath, { preview: true, template: 'transformer' });

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('should create new file when target does not exist', async () => {
    const { createNodeCommand } = await import('../../src/cli/commands/create');
    const filePath = path.join(TEMP_DIR, 'subdir', 'new-node.ts');

    await createNodeCommand('newNode', filePath, { template: 'transformer' });

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('newNode');
  });
});

describe('createWorkflowCommand coverage', () => {
  it('should exit for unknown workflow template', async () => {
    const { createWorkflowCommand } = await import('../../src/cli/commands/create');
    await expect(
      createWorkflowCommand('nonexistent-tmpl', 'test.ts')
    ).rejects.toThrow(/process\.exit/);
  });

  it('should exit for invalid --config JSON in createWorkflowCommand', async () => {
    const { createWorkflowCommand } = await import('../../src/cli/commands/create');
    await expect(
      createWorkflowCommand('sequential', 'test.ts', { config: '{bad' })
    ).rejects.toThrow(/process\.exit/);
  });

  it('should create workflow with --line option', async () => {
    const { createWorkflowCommand } = await import('../../src/cli/commands/create');
    const filePath = writeFixture('wf-line.ts', '// line 1\n// line 2\n');

    await createWorkflowCommand('sequential', filePath, { line: 1 });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('flowWeaver');
  });

  it('should output code in preview mode', async () => {
    const { createWorkflowCommand } = await import('../../src/cli/commands/create');
    const filePath = path.join(TEMP_DIR, 'wf-preview.ts');

    await createWorkflowCommand('sequential', filePath, { preview: true });

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('should accept --name override', async () => {
    const { createWorkflowCommand } = await import('../../src/cli/commands/create');
    const filePath = path.join(TEMP_DIR, 'wf-name.ts');

    await createWorkflowCommand('sequential', filePath, { name: 'customName' });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('customName');
  });

  it('should accept --provider and --model options', async () => {
    const { createWorkflowCommand } = await import('../../src/cli/commands/create');
    const filePath = path.join(TEMP_DIR, 'wf-provider.ts');

    await createWorkflowCommand('sequential', filePath, {
      provider: 'openai',
      model: 'gpt-4',
    });

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('should accept --nodes, --input, --output options', async () => {
    const { createWorkflowCommand } = await import('../../src/cli/commands/create');
    const filePath = path.join(TEMP_DIR, 'wf-ports.ts');

    await createWorkflowCommand('sequential', filePath, {
      nodes: 'a,b,c',
      input: 'data',
      output: 'result',
    });

    expect(fs.existsSync(filePath)).toBe(true);
  });
});
