/**
 * Tests for CLI create command
 * Uses pure functions directly for fast testing, with CLI smoke tests for wiring
 */

import { vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getWorkflowTemplate,
  getNodeTemplate,
  workflowTemplates,
  nodeTemplates,
  toCamelCase,
} from '../../src/cli/templates/index';
import { parser } from '../../src/parser';
import { validator } from '../../src/validator';
import { createWorkflowCommand, createNodeCommand } from '../../src/cli/commands/create';

const TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-create-${process.pid}`);

// Helper: insert content at line or append (pure logic)
function insertAtLine(existingContent: string, newContent: string, line?: number): string {
  const lines = existingContent.split('\n');
  if (line !== undefined && line > 0) {
    const insertIndex = Math.min(line, lines.length);
    lines.splice(insertIndex, 0, newContent);
  } else {
    lines.push('', newContent);
  }
  return lines.join('\n');
}

beforeAll(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(TEMP_DIR)) {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
  }
});

afterAll(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('CLI create command', () => {
  describe('workflow template generation', () => {
    it('should generate sequential workflow template', () => {
      const template = getWorkflowTemplate('sequential');
      expect(template).toBeDefined();

      const code = template!.generate({ workflowName: 'testSequential' });

      expect(code).toContain('@flowWeaver workflow');
      expect(code).toContain('@flowWeaver nodeType');
      expect(code).toContain('function testSequential');
    });

    it('should generate foreach workflow template', () => {
      const template = getWorkflowTemplate('foreach');
      expect(template).toBeDefined();

      const code = template!.generate({ workflowName: 'testForeach' });

      expect(code).toContain('@flowWeaver workflow');
      expect(code).toContain('function testForeach');
    });

    it('should generate conditional workflow template', () => {
      const template = getWorkflowTemplate('conditional');
      expect(template).toBeDefined();

      const code = template!.generate({ workflowName: 'testConditional' });

      expect(code).toContain('@flowWeaver workflow');
      expect(code).toContain('function testConditional');
    });

    it('should return undefined for unknown template', () => {
      const template = getWorkflowTemplate('nonexistent-template');
      expect(template).toBeUndefined();
    });
  });

  describe('node template generation', () => {
    it('should generate validator node template', () => {
      const template = getNodeTemplate('validator');
      expect(template).toBeDefined();

      const code = template!.generate('myValidator');

      expect(code).toContain('@flowWeaver nodeType');
      expect(code).toContain('function myValidator');
      expect(code).toContain('execute: boolean');
      expect(code).toContain('onSuccess: boolean');
      expect(code).toContain('onFailure: boolean');
    });

    it('should return undefined for unknown node template', () => {
      const template = getNodeTemplate('nonexistent');
      expect(template).toBeUndefined();
    });
  });

  describe('toCamelCase utility', () => {
    it('should convert kebab-case to camelCase', () => {
      expect(toCamelCase('my-processor')).toBe('myProcessor');
    });

    it('should convert snake_case to camelCase', () => {
      expect(toCamelCase('my_processor')).toBe('myProcessor');
    });

    it('should handle already camelCase', () => {
      expect(toCamelCase('myProcessor')).toBe('myProcessor');
    });

    it('should strip leading digits to produce valid identifier', () => {
      expect(toCamelCase('02-sequential')).toMatch(/^[a-zA-Z_$]/);
      expect(toCamelCase('02-sequential')).toBe('sequential');
    });

    it('should handle all-digit prefix with trailing word', () => {
      expect(toCamelCase('123-test')).toBe('test');
    });

    it('should handle all-digit input by prepending underscore', () => {
      const result = toCamelCase('123');
      expect(result).toMatch(/^[a-zA-Z_$]/);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle leading digits followed by letters directly', () => {
      expect(toCamelCase('2fast')).toMatch(/^[a-zA-Z_$]/);
    });

    it('should keep valid identifiers unchanged', () => {
      expect(toCamelCase('validName')).toBe('validName');
      expect(toCamelCase('_private')).toBe('_private');
    });
  });

  describe('--name flag override', () => {
    it('should use provided name over derived name', () => {
      const template = getWorkflowTemplate('sequential')!;
      const code = template.generate({ workflowName: 'myCustomName' });
      expect(code).toContain('function myCustomName');
    });
  });

  describe('file insertion logic', () => {
    it('should append to end by default', () => {
      const existing = `// Header comment
type MyType = string;

function existingFunction() {}
`;
      const newContent = '// New content';

      const result = insertAtLine(existing, newContent);

      expect(result.startsWith('// Header comment')).toBe(true);
      expect(result.indexOf('existingFunction')).toBeLessThan(result.indexOf('// New content'));
    });

    it('should insert at specific line', () => {
      const existing = `// Line 1
// Line 2
// Line 3
// Line 4
// Line 5
`;
      const newContent = '// Inserted';

      const result = insertAtLine(existing, newContent, 3);
      const lines = result.split('\n');

      expect(lines[0]).toBe('// Line 1');
      expect(lines[1]).toBe('// Line 2');
      expect(lines[2]).toBe('// Line 3');
      expect(lines[3]).toBe('// Inserted');
      expect(lines[4]).toBe('// Line 4');
    });
  });

  describe('template validation', () => {
    it('should generate valid TypeScript for sequential template', () => {
      const template = getWorkflowTemplate('sequential')!;
      const code = template.generate({ workflowName: 'testSequential' });

      const testFile = path.join(TEMP_DIR, 'test-sequential-valid.ts');
      fs.writeFileSync(testFile, code);

      const parseResult = parser.parse(testFile);
      expect(parseResult.errors).toHaveLength(0);

      const workflow = parseResult.workflows.find((w) => w.functionName === 'testSequential');
      expect(workflow).toBeDefined();

      const validationResult = validator.validate(workflow!);
      expect(validationResult.errors).toHaveLength(0);
    });

    it('should generate valid TypeScript for foreach template', () => {
      const template = getWorkflowTemplate('foreach')!;
      const code = template.generate({ workflowName: 'testForeach' });

      const testFile = path.join(TEMP_DIR, 'test-foreach-valid.ts');
      fs.writeFileSync(testFile, code);

      const parseResult = parser.parse(testFile);
      expect(parseResult.errors).toHaveLength(0);

      const workflow = parseResult.workflows.find((w) => w.functionName === 'testForeach');
      expect(workflow).toBeDefined();

      const validationResult = validator.validate(workflow!);
      expect(validationResult.errors).toHaveLength(0);
    });

    it('should generate valid TypeScript for conditional template', () => {
      const template = getWorkflowTemplate('conditional')!;
      const code = template.generate({ workflowName: 'testConditional' });

      const testFile = path.join(TEMP_DIR, 'test-conditional-valid.ts');
      fs.writeFileSync(testFile, code);

      const parseResult = parser.parse(testFile);
      expect(parseResult.errors).toHaveLength(0);

      const workflow = parseResult.workflows.find((w) => w.functionName === 'testConditional');
      expect(workflow).toBeDefined();

      const validationResult = validator.validate(workflow!);
      expect(validationResult.errors).toHaveLength(0);
    });
  });

  describe('AI template config', () => {
    it('should generate OpenAI provider code', () => {
      const template = getWorkflowTemplate('ai-agent')!;
      const code = template.generate({
        workflowName: 'testAgent',
        config: { provider: 'openai' },
      });

      expect(code).toContain('api.openai.com');
      expect(code).toContain('OPENAI_API_KEY');
    });

    it('should use specified model', () => {
      const template = getWorkflowTemplate('ai-agent')!;
      const code = template.generate({
        workflowName: 'testAgent',
        config: { provider: 'openai', model: 'gpt-4-turbo' },
      });

      expect(code).toContain('gpt-4-turbo');
    });

    it('should generate Anthropic provider code', () => {
      const template = getWorkflowTemplate('ai-agent')!;
      const code = template.generate({
        workflowName: 'testAgent',
        config: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      });

      expect(code).toContain('api.anthropic.com');
      expect(code).toContain('claude-3-5-sonnet');
    });

    it('should generate Ollama provider code', () => {
      const template = getWorkflowTemplate('ai-agent')!;
      const code = template.generate({
        workflowName: 'testAgent',
        config: { provider: 'ollama', model: 'llama3.2' },
      });

      expect(code).toContain('localhost:11434');
      expect(code).toContain('llama3.2');
    });

    it('should generate mock provider by default', () => {
      const template = getWorkflowTemplate('ai-agent')!;
      const code = template.generate({ workflowName: 'testAgent' });

      expect(code).toContain('createMockProvider');
    });
  });

  describe('templates registry', () => {
    it('should have workflow templates', () => {
      expect(workflowTemplates.length).toBeGreaterThan(0);
      expect(workflowTemplates.some((t) => t.id === 'sequential')).toBe(true);
      expect(workflowTemplates.some((t) => t.id === 'sequential')).toBe(true);
      expect(workflowTemplates.some((t) => t.id === 'foreach')).toBe(true);
      expect(workflowTemplates.some((t) => t.id === 'conditional')).toBe(true);
    });

    it('should have node templates', () => {
      expect(nodeTemplates.length).toBeGreaterThan(0);
    });

    it('should have descriptions for all templates', () => {
      for (const t of workflowTemplates) {
        expect(t.description).toBeDefined();
        expect(t.description.length).toBeGreaterThan(10);
      }
    });
  });

  // ── createWorkflowCommand ────────────────────────────────────────────────

  describe('createWorkflowCommand', () => {
    let origExit: typeof process.exit;

    beforeEach(() => {
      origExit = process.exit;
      process.exit = vi.fn() as never;
    });

    afterEach(() => {
      process.exit = origExit;
    });

    it('should create a workflow file from a known template', async () => {
      const outFile = path.join(TEMP_DIR, 'cmd-sequential.ts');

      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createWorkflowCommand('sequential', outFile);
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      expect(fs.existsSync(outFile)).toBe(true);
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('@flowWeaver workflow');
      expect(content).toContain('cmdSequential');
    });

    it('should use --name override for the function name', async () => {
      const outFile = path.join(TEMP_DIR, 'cmd-named.ts');

      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createWorkflowCommand('sequential', outFile, { name: 'customWorkflowName' });
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('function customWorkflowName');
    });

    it('should output code in preview mode without writing file', async () => {
      const outFile = path.join(TEMP_DIR, 'cmd-preview.ts');
      const logs: string[] = [];

      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createWorkflowCommand('sequential', outFile, { preview: true });
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      // File should NOT exist in preview mode
      expect(fs.existsSync(outFile)).toBe(false);

      // Code should be logged to stdout
      const output = logs.join('\n');
      expect(output).toContain('@flowWeaver workflow');
    });

    it('should call process.exit(1) for unknown template', async () => {
      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createWorkflowCommand('nonexistent-template', '/tmp/test.ts');
      } catch {
        // process.exit is mocked so code continues past exit(1) and may throw
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should insert at specific line when --line is provided', async () => {
      const outFile = path.join(TEMP_DIR, 'cmd-insert-line.ts');
      fs.writeFileSync(outFile, '// Line 1\n// Line 2\n// Line 3\n');

      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createWorkflowCommand('sequential', outFile, { line: 2 });
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      const content = fs.readFileSync(outFile, 'utf8');
      const lines = content.split('\n');
      // First two lines should be the original header lines
      expect(lines[0]).toBe('// Line 1');
      expect(lines[1]).toBe('// Line 2');
      // Template content should follow
      expect(content).toContain('@flowWeaver');
    });

    it('should apply config from --config JSON', async () => {
      const outFile = path.join(TEMP_DIR, 'cmd-config.ts');

      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createWorkflowCommand('ai-agent', outFile, {
          provider: 'openai',
          model: 'gpt-4-turbo',
        });
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('api.openai.com');
      expect(content).toContain('gpt-4-turbo');
    });

    it('should call process.exit(1) for invalid --config JSON', async () => {
      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createWorkflowCommand('sequential', '/tmp/test.ts', { config: '{invalid json' });
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  // ── createNodeCommand ──────────────────────────────────────────────────────

  describe('createNodeCommand', () => {
    let origExit: typeof process.exit;

    beforeEach(() => {
      origExit = process.exit;
      process.exit = vi.fn() as never;
    });

    afterEach(() => {
      process.exit = origExit;
    });

    it('should create a node type file using transformer template', async () => {
      const outFile = path.join(TEMP_DIR, 'cmd-node-default.ts');

      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createNodeCommand('myCustomNode', outFile, { template: 'transformer' });
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      expect(fs.existsSync(outFile)).toBe(true);
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('@flowWeaver nodeType');
      expect(content).toContain('myCustomNode');
    });

    it('should output code in preview mode without writing', async () => {
      const outFile = path.join(TEMP_DIR, 'cmd-node-preview.ts');
      const logs: string[] = [];

      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createNodeCommand('previewNode', outFile, { preview: true, template: 'validator' });
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      expect(fs.existsSync(outFile)).toBe(false);
      expect(logs.join('\n')).toContain('@flowWeaver nodeType');
    });

    it('should call process.exit(1) for unknown node template', async () => {
      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createNodeCommand('test', '/tmp/test.ts', { template: 'fake-template' });
      } catch {
        // process.exit is mocked so code continues past exit(1) and may throw
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should generate a validator node template', async () => {
      const outFile = path.join(TEMP_DIR, 'cmd-node-validator.ts');

      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = vi.fn();
      console.error = vi.fn();
      console.warn = vi.fn();

      try {
        await createNodeCommand('dataValidator', outFile, { template: 'validator' });
      } finally {
        console.log = origLog;
        console.error = origError;
        console.warn = origWarn;
      }

      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('@flowWeaver nodeType');
      expect(content).toContain('dataValidator');
    });
  });
});
