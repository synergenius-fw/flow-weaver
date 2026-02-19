/**
 * Tests for CLI create command
 * Uses pure functions directly for fast testing, with CLI smoke tests for wiring
 */

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
});
