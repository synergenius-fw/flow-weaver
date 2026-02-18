/**
 * Tests for Template Configuration System
 * TDD: Tests for configSchema on templates
 */

import { getWorkflowTemplate, generateWorkflowFromTemplate } from '../../../src/api/templates';

describe('Template Configuration System', () => {
  describe('ConfigSchema Definition', () => {
    it('ai-agent template should have configSchema', () => {
      const template = getWorkflowTemplate('ai-agent');
      expect(template?.configSchema).toBeDefined();
      expect(template?.configSchema?.provider).toBeDefined();
      expect(template?.configSchema?.provider.type).toBe('select');
    });

    it('configSchema should have provider options', () => {
      const template = getWorkflowTemplate('ai-agent');
      const providerField = template?.configSchema?.provider;
      expect(providerField?.options).toContainEqual({
        value: 'openai',
        label: 'OpenAI',
      });
      expect(providerField?.options).toContainEqual({
        value: 'anthropic',
        label: 'Anthropic',
      });
      expect(providerField?.options).toContainEqual({
        value: 'ollama',
        label: 'Ollama (Local)',
      });
      expect(providerField?.options).toContainEqual({
        value: 'mock',
        label: 'Mock (Testing)',
      });
    });

    it('should have model field', () => {
      const template = getWorkflowTemplate('ai-agent');
      const modelField = template?.configSchema?.model;
      expect(modelField).toBeDefined();
      expect(modelField?.type).toBe('string');
      expect(modelField?.label).toBe('Model');
    });

    it('model field should depend on provider', () => {
      const template = getWorkflowTemplate('ai-agent');
      const modelField = template?.configSchema?.model;
      expect(modelField?.dependsOn).toEqual({
        field: 'provider',
        values: ['openai', 'anthropic', 'ollama'],
      });
    });
  });

  describe('Code Generation with Config', () => {
    it('should generate OpenAI provider code when provider=openai', () => {
      const code = generateWorkflowFromTemplate('ai-agent', {
        workflowName: 'myAgent',
        config: { provider: 'openai', model: 'gpt-4o' },
      });

      expect(code).toContain('api.openai.com');
      expect(code).toContain('OPENAI_API_KEY');
      expect(code).toContain('gpt-4o');
      expect(code).not.toContain('createMockProvider');
    });

    it('should generate Anthropic provider code when provider=anthropic', () => {
      const code = generateWorkflowFromTemplate('ai-agent', {
        workflowName: 'myAgent',
        config: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      });

      expect(code).toContain('api.anthropic.com');
      expect(code).toContain('ANTHROPIC_API_KEY');
      expect(code).toContain('claude-3-5-sonnet');
    });

    it('should generate Ollama provider code when provider=ollama', () => {
      const code = generateWorkflowFromTemplate('ai-agent', {
        workflowName: 'myAgent',
        config: { provider: 'ollama', model: 'llama3.2' },
      });

      expect(code).toContain('localhost:11434');
      expect(code).toContain('llama3.2');
    });

    it('should use default config when not provided', () => {
      const code = generateWorkflowFromTemplate('ai-agent', {
        workflowName: 'myAgent',
      });

      // Default should be mock for backwards compatibility
      expect(code).toContain('createMockProvider');
    });

    it('should use model from config', () => {
      const code = generateWorkflowFromTemplate('ai-agent', {
        workflowName: 'myAgent',
        config: { provider: 'openai', model: 'gpt-4-turbo' },
      });

      expect(code).toContain('gpt-4-turbo');
    });
  });

  describe('All AI Templates Support Config', () => {
    const aiTemplates = ['ai-agent', 'ai-rag', 'ai-chat'];

    aiTemplates.forEach((templateId) => {
      it(`${templateId} should have provider configSchema`, () => {
        const template = getWorkflowTemplate(templateId);
        expect(template?.configSchema?.provider).toBeDefined();
      });

      it(`${templateId} should generate valid code for each provider`, () => {
        const providers = ['openai', 'anthropic', 'ollama'];

        providers.forEach((provider) => {
          const code = generateWorkflowFromTemplate(templateId, {
            workflowName: 'testWorkflow',
            config: { provider, model: 'test-model' },
          });

          expect(code).toContain('@flowWeaver');
          expect(code.length).toBeGreaterThan(100);
        });
      });
    });
  });

  describe('Type Definitions', () => {
    it('WorkflowTemplateOptions should accept config', () => {
      // This test verifies the type system accepts config
      const options = {
        workflowName: 'test',
        config: { provider: 'openai', model: 'gpt-4o' },
      };

      // Should not throw
      const code = generateWorkflowFromTemplate('ai-agent', options);
      expect(code).toBeDefined();
    });

    it('configSchema should have correct field types', () => {
      const template = getWorkflowTemplate('ai-agent');

      // Provider is select
      expect(template?.configSchema?.provider.type).toBe('select');
      expect(template?.configSchema?.provider.options).toBeDefined();

      // Model is string
      expect(template?.configSchema?.model.type).toBe('string');
      expect(template?.configSchema?.model.placeholder).toBeDefined();
    });
  });
});
