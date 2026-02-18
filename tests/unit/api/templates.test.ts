/**
 * Tests for public template API
 */

import {
  listWorkflowTemplates,
  listNodeTemplates,
  getWorkflowTemplate,
  getNodeTemplate,
  generateWorkflowFromTemplate,
  generateNodeFromTemplate,
} from '../../../src/api/templates';

describe('Templates API', () => {
  describe('listWorkflowTemplates', () => {
    it('should return array of workflow templates', () => {
      const templates = listWorkflowTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should include sequential template', () => {
      const templates = listWorkflowTemplates();
      const sequential = templates.find((t) => t.id === 'sequential');
      expect(sequential).toBeDefined();
      expect(sequential?.name).toBe('Sequential Pipeline');
      expect(sequential?.category).toBe('data-processing');
    });

    it('should include all expected categories', () => {
      const templates = listWorkflowTemplates();
      const categories = new Set(templates.map((t) => t.category));
      expect(categories.has('utility')).toBe(true);
      expect(categories.has('data-processing')).toBe(true);
    });
  });

  describe('listNodeTemplates', () => {
    it('should return array of node templates', () => {
      const templates = listNodeTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should include validator template', () => {
      const templates = listNodeTemplates();
      const validator = templates.find((t) => t.id === 'validator');
      expect(validator).toBeDefined();
      expect(validator?.name).toBeDefined();
    });

    it('every node template should have a category', () => {
      const templates = listNodeTemplates();
      for (const t of templates) {
        expect(t.category).toBeDefined();
        expect(typeof t.category).toBe('string');
        expect(t.category.length).toBeGreaterThan(0);
      }
    });

    it('should include all expected categories', () => {
      const templates = listNodeTemplates();
      const categories = new Set(templates.map((t) => t.category));
      expect(categories.has('ai')).toBe(true);
      expect(categories.has('data')).toBe(true);
      expect(categories.has('validation')).toBe(true);
      expect(categories.has('integration')).toBe(true);
      expect(categories.has('workflow')).toBe(true);
    });

    it('should have correct categories for specific templates', () => {
      const templates = listNodeTemplates();
      const byId = (id: string) => templates.find((t) => t.id === id);

      expect(byId('validator')?.category).toBe('validation');
      expect(byId('transformer')?.category).toBe('data');
      expect(byId('http')?.category).toBe('integration');
      expect(byId('aggregator')?.category).toBe('data');
      expect(byId('llm-call')?.category).toBe('ai');
      expect(byId('tool-executor')?.category).toBe('ai');
      expect(byId('human-approval')?.category).toBe('workflow');
      expect(byId('agent-router')?.category).toBe('ai');
    });
  });

  describe('getWorkflowTemplate', () => {
    it('should return template by id', () => {
      const template = getWorkflowTemplate('sequential');
      expect(template).toBeDefined();
      expect(template?.id).toBe('sequential');
    });

    it('should return undefined for unknown id', () => {
      const template = getWorkflowTemplate('nonexistent');
      expect(template).toBeUndefined();
    });
  });

  describe('getNodeTemplate', () => {
    it('should return template by id', () => {
      const template = getNodeTemplate('validator');
      expect(template).toBeDefined();
      expect(template?.id).toBe('validator');
    });

    it('should return undefined for unknown id', () => {
      const template = getNodeTemplate('nonexistent');
      expect(template).toBeUndefined();
    });
  });

  describe('generateWorkflowFromTemplate', () => {
    it('should generate code from template', () => {
      const code = generateWorkflowFromTemplate('sequential', {
        workflowName: 'myTestWorkflow',
      });
      expect(code).toContain('@flowWeaver workflow');
      expect(code).toContain('function myTestWorkflow');
    });

    it('should generate async workflow when requested', () => {
      const code = generateWorkflowFromTemplate('sequential', {
        workflowName: 'asyncWorkflow',
        async: true,
      });
      expect(code).toContain('async function asyncWorkflow');
      expect(code).toContain('Promise<');
    });

    it('should throw for unknown template', () => {
      expect(() => generateWorkflowFromTemplate('nonexistent', { workflowName: 'test' })).toThrow(
        /template.*not found/i
      );
    });
  });

  describe('generateNodeFromTemplate', () => {
    it('should generate code from template', () => {
      const code = generateNodeFromTemplate('validator', 'myValidator');
      expect(code).toContain('@flowWeaver nodeType');
      expect(code).toContain('function myValidator');
    });

    it('should throw for unknown template', () => {
      expect(() => generateNodeFromTemplate('nonexistent', 'test')).toThrow(/template.*not found/i);
    });
  });

  describe('sequential template customization', () => {
    it('supports custom node names via config', () => {
      const code = generateWorkflowFromTemplate('sequential', {
        workflowName: 'customPipeline',
        config: {
          nodes: ['fetch', 'parse', 'store'],
        },
      });
      expect(code).toContain('function fetch');
      expect(code).toContain('function parse');
      expect(code).toContain('function store');
      expect(code).toContain('@node step0 fetch');
      expect(code).toContain('@node step1 parse');
      expect(code).toContain('@node step2 store');
    });

    it('supports custom input/output via config', () => {
      const code = generateWorkflowFromTemplate('sequential', {
        workflowName: 'customIO',
        config: {
          input: 'rawData',
          output: 'processedData',
        },
      });
      expect(code).toContain('@param rawData');
      expect(code).toContain('@returns processedData');
    });
  });
});
