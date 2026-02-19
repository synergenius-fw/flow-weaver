/**
 * Tests for CLI templates command
 * Uses pure functions directly for fast testing, with CLI smoke tests for wiring
 */

import { workflowTemplates, nodeTemplates } from '../../src/cli/templates/index';

describe('Templates registry', () => {
  describe('workflow templates', () => {
    it('should have workflow templates', () => {
      expect(workflowTemplates.length).toBeGreaterThan(0);
    });

    it('should include sequential template', () => {
      const seqTemplate = workflowTemplates.find((t) => t.id === 'sequential');
      expect(seqTemplate).toBeDefined();
    });

    it('should have required fields on all workflow templates', () => {
      for (const template of workflowTemplates) {
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.category).toBeDefined();
        expect(template.generate).toBeInstanceOf(Function);
      }
    });

    it('should have descriptions for all templates', () => {
      for (const template of workflowTemplates) {
        expect(template.description.length).toBeGreaterThan(10);
      }
    });

    it('should have valid categories', () => {
      const validCategories = ['data-processing', 'automation', 'ai', 'integration', 'utility'];
      for (const template of workflowTemplates) {
        expect(validCategories).toContain(template.category);
      }
    });
  });

  describe('node templates', () => {
    it('should have node templates', () => {
      expect(nodeTemplates.length).toBeGreaterThan(0);
    });

    it('should have required fields on all node templates', () => {
      for (const template of nodeTemplates) {
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.generate).toBeInstanceOf(Function);
      }
    });
  });

  describe('template generation', () => {
    it('should generate code from sequential template', () => {
      const sequential = workflowTemplates.find((t) => t.id === 'sequential');
      expect(sequential).toBeDefined();

      const code = sequential!.generate({ workflowName: 'testWorkflow' });
      expect(code).toContain('@flowWeaver');
      expect(code).toContain('function testWorkflow');
    });

    it('should generate code from all workflow templates', () => {
      for (const template of workflowTemplates) {
        const code = template.generate({ workflowName: 'testWorkflow' });
        expect(code).toContain('@flowWeaver');
        expect(code.length).toBeGreaterThan(100);
      }
    });

    it('should generate code from all node templates', () => {
      for (const template of nodeTemplates) {
        const code = template.generate('testNode');
        expect(code).toContain('@flowWeaver nodeType');
        expect(code).toContain('function testNode');
      }
    });
  });

  describe('known templates', () => {
    it('should include common workflow templates', () => {
      const templateIds = workflowTemplates.map((t) => t.id);
      expect(templateIds).toContain('sequential');
    });

    it('should have non-empty template arrays', () => {
      expect(workflowTemplates.length).toBeGreaterThan(0);
      expect(nodeTemplates.length).toBeGreaterThan(0);
    });
  });

  describe('conditional template', () => {
    it('has conditionTrue/conditionFalse data ports', () => {
      const conditional = workflowTemplates.find((t) => t.id === 'conditional');
      expect(conditional).toBeDefined();
      const code = conditional!.generate({ workflowName: 'testConditional' });
      expect(code).toContain('@output conditionTrue');
      expect(code).toContain('@output conditionFalse');
    });

    it('uses conditionTrue/conditionFalse for data routing', () => {
      const conditional = workflowTemplates.find((t) => t.id === 'conditional');
      const code = conditional!.generate({ workflowName: 'testConditional' });
      // conditionTrue/conditionFalse carry data to the appropriate handler
      expect(code).toContain('router.conditionTrue -> successHandler.data');
      expect(code).toContain('router.conditionFalse -> failureHandler.data');
    });

    it('uses onSuccess/onFailure for execution routing (STEP ports)', () => {
      const conditional = workflowTemplates.find((t) => t.id === 'conditional');
      const code = conditional!.generate({ workflowName: 'testConditional' });
      // onSuccess/onFailure are STEP ports that route execution
      expect(code).toContain('router.onSuccess -> successHandler.execute');
      expect(code).toContain('router.onFailure -> failureHandler.execute');
    });

    it('evaluateCondition includes try/catch error handling', () => {
      const conditional = workflowTemplates.find((t) => t.id === 'conditional');
      const code = conditional!.generate({ workflowName: 'testConditional' });
      expect(code).toContain('try {');
      expect(code).toContain('} catch');
    });
  });
});
