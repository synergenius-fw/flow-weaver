/**
 * Tests for template code generation.
 * Exercises each workflow and node template's generate() function
 * with various config options to cover the template code branches.
 */

import {
  workflowTemplates,
  nodeTemplates,
  getWorkflowTemplate,
  getNodeTemplate,
  toCamelCase,
  toPascalCase,
} from '../../src/cli/templates/index';

import {
  generateOpenAIProvider,
  generateAnthropicProvider,
  generateOllamaProvider,
  generateMockProvider,
  getProviderCode,
} from '../../src/cli/templates/providers/index';

import {
  generateMockApproval,
  generateCallbackApproval,
  generateWebhookApproval,
  getApprovalCode,
} from '../../src/cli/templates/approvals/index';

describe('Template code generation', () => {
  describe('toCamelCase', () => {
    it('should convert hyphenated strings', () => {
      expect(toCamelCase('my-workflow')).toBe('myWorkflow');
    });

    it('should convert underscored strings', () => {
      expect(toCamelCase('my_workflow')).toBe('myWorkflow');
    });

    it('should convert space-separated strings', () => {
      expect(toCamelCase('my workflow')).toBe('myWorkflow');
    });

    it('should preserve leading underscores', () => {
      expect(toCamelCase('_private')).toBe('_private');
    });

    it('should preserve leading dollar signs', () => {
      expect(toCamelCase('$special')).toBe('$special');
    });

    it('should handle empty result with fallback', () => {
      const result = toCamelCase('123');
      expect(result).toBeTruthy();
    });

    it('should lowercase first character', () => {
      expect(toCamelCase('MyWorkflow')).toBe('myWorkflow');
    });
  });

  describe('toPascalCase', () => {
    it('should uppercase first character', () => {
      expect(toPascalCase('myWorkflow')).toBe('MyWorkflow');
    });

    it('should convert hyphenated strings', () => {
      expect(toPascalCase('my-workflow')).toBe('MyWorkflow');
    });
  });

  describe('getWorkflowTemplate', () => {
    it('should find template by id', () => {
      const t = getWorkflowTemplate('sequential');
      expect(t).toBeDefined();
      expect(t!.id).toBe('sequential');
    });

    it('should return undefined for unknown id', () => {
      expect(getWorkflowTemplate('nonexistent')).toBeUndefined();
    });
  });

  describe('getNodeTemplate', () => {
    it('should find node template by id', () => {
      const t = getNodeTemplate('transformer');
      expect(t).toBeDefined();
      expect(t!.id).toBe('transformer');
    });

    it('should return undefined for unknown id', () => {
      expect(getNodeTemplate('nonexistent')).toBeUndefined();
    });
  });

  describe('sequential template', () => {
    const template = getWorkflowTemplate('sequential')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'myPipeline' });
      expect(code).toContain('function myPipeline');
      expect(code).toContain('@flowWeaver workflow');
    });

    it('should generate async variant', () => {
      const code = template.generate({ workflowName: 'myPipeline', async: true });
      expect(code).toContain('async function myPipeline');
      expect(code).toContain('Promise<');
    });

    it('should accept custom node names via config', () => {
      const code = template.generate({
        workflowName: 'myPipeline',
        config: { nodes: ['fetch', 'parse', 'store'] },
      });
      expect(code).toContain('fetch');
      expect(code).toContain('parse');
      expect(code).toContain('store');
    });

    it('should accept custom input/output port names', () => {
      const code = template.generate({
        workflowName: 'myPipeline',
        config: { input: 'payload', output: 'response' },
      });
      expect(code).toContain('payload');
      expect(code).toContain('response');
    });
  });

  describe('foreach template', () => {
    const template = getWorkflowTemplate('foreach')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'batchProcess' });
      expect(code).toContain('function batchProcess');
      expect(code).toContain('scope');
    });

    it('should generate async variant', () => {
      const code = template.generate({ workflowName: 'batchProcess', async: true });
      expect(code).toContain('async');
      expect(code).toContain('Promise<');
    });
  });

  describe('conditional template', () => {
    const template = getWorkflowTemplate('conditional')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'routeData' });
      expect(code).toContain('function routeData');
      expect(code).toContain('conditionTrue');
      expect(code).toContain('conditionFalse');
    });
  });

  describe('aggregator template', () => {
    const template = getWorkflowTemplate('aggregator')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'aggregate' });
      expect(code).toContain('function aggregate');
      expect(code).toContain('@flowWeaver workflow');
    });
  });

  describe('webhook template', () => {
    const template = getWorkflowTemplate('webhook')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'handleWebhook' });
      expect(code).toContain('function handleWebhook');
      expect(code).toContain('@flowWeaver');
    });
  });

  describe('error-handler template', () => {
    const template = getWorkflowTemplate('error-handler')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'handleErrors' });
      expect(code).toContain('function handleErrors');
      expect(code).toContain('onFailure');
    });
  });

  describe('ai-agent template', () => {
    const template = getWorkflowTemplate('ai-agent')!;

    it('should generate with mock provider (default)', () => {
      const code = template.generate({ workflowName: 'myAgent' });
      expect(code).toContain('function myAgent');
      expect(code).toContain('MOCK PROVIDER');
    });

    it('should generate with openai provider', () => {
      const code = template.generate({
        workflowName: 'myAgent',
        config: { provider: 'openai', model: 'gpt-4o' },
      });
      expect(code).toContain('function myAgent');
      expect(code).toContain('OPENAI PROVIDER');
    });

    it('should generate with anthropic provider', () => {
      const code = template.generate({
        workflowName: 'myAgent',
        config: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      });
      expect(code).toContain('ANTHROPIC PROVIDER');
    });

    it('should generate with ollama provider', () => {
      const code = template.generate({
        workflowName: 'myAgent',
        config: { provider: 'ollama', model: 'llama3.2' },
      });
      // Ollama uses an OpenAI-compatible endpoint
      expect(code).toContain('function myAgent');
      expect(code.length).toBeGreaterThan(500);
    });

    it('should have configSchema with provider and model', () => {
      expect(template.configSchema).toBeDefined();
      expect(template.configSchema!.provider).toBeDefined();
      expect(template.configSchema!.model).toBeDefined();
    });
  });

  describe('ai-react template', () => {
    const template = getWorkflowTemplate('ai-react')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'reactAgent' });
      expect(code).toContain('function reactAgent');
      expect(code).toContain('@flowWeaver');
    });

    it('should include ReAct pattern elements', () => {
      const code = template.generate({ workflowName: 'reactAgent' });
      expect(code).toContain('ReAct');
      expect(code.length).toBeGreaterThan(200);
    });
  });

  describe('ai-rag template', () => {
    const template = getWorkflowTemplate('ai-rag')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'ragPipeline' });
      expect(code).toContain('function ragPipeline');
    });

    it('should generate with anthropic provider', () => {
      const code = template.generate({
        workflowName: 'ragPipeline',
        config: { provider: 'anthropic' },
      });
      expect(code).toContain('ANTHROPIC PROVIDER');
    });
  });

  describe('ai-chat template', () => {
    const template = getWorkflowTemplate('ai-chat')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'chatBot' });
      expect(code).toContain('function chatBot');
    });

    it('should generate with openai provider', () => {
      const code = template.generate({
        workflowName: 'chatBot',
        config: { provider: 'openai' },
      });
      expect(code).toContain('OPENAI PROVIDER');
    });
  });

  describe('ai-agent-durable template', () => {
    const template = getWorkflowTemplate('ai-agent-durable')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'durableAgent' });
      expect(code).toContain('function durableAgent');
    });

    it('should generate with openai provider', () => {
      const code = template.generate({
        workflowName: 'durableAgent',
        config: { provider: 'openai', model: 'gpt-4o' },
      });
      expect(code).toContain('OPENAI PROVIDER');
    });
  });

  describe('ai-pipeline-durable template', () => {
    const template = getWorkflowTemplate('ai-pipeline-durable')!;

    it('should generate with default options', () => {
      const code = template.generate({ workflowName: 'durablePipeline' });
      expect(code).toContain('function durablePipeline');
    });

    it('should generate with anthropic provider', () => {
      const code = template.generate({
        workflowName: 'durablePipeline',
        config: { provider: 'anthropic' },
      });
      expect(code).toContain('ANTHROPIC PROVIDER');
    });
  });

  describe('node templates', () => {
    it('should generate validator node', () => {
      const t = getNodeTemplate('validator')!;
      const code = t.generate('myValidator');
      expect(code).toContain('function myValidator');
      expect(code).toContain('@flowWeaver nodeType');
    });

    it('should generate transformer node', () => {
      const t = getNodeTemplate('transformer')!;
      const code = t.generate('myTransformer');
      expect(code).toContain('function myTransformer');
    });

    it('should generate http node', () => {
      const t = getNodeTemplate('http')!;
      const code = t.generate('myHttp');
      expect(code).toContain('function myHttp');
    });

    it('should generate aggregator node', () => {
      const t = getNodeTemplate('aggregator')!;
      const code = t.generate('myAggregator');
      expect(code).toContain('function myAggregator');
    });

    it('should generate llm-call node', () => {
      const t = getNodeTemplate('llm-call')!;
      const code = t.generate('myLlm');
      expect(code).toContain('function myLlm');
    });

    it('should generate tool-executor node', () => {
      const t = getNodeTemplate('tool-executor')!;
      const code = t.generate('myTools');
      expect(code).toContain('function myTools');
    });

    it('should generate conversation-memory node', () => {
      const t = getNodeTemplate('conversation-memory')!;
      const code = t.generate('myMemory');
      expect(code).toContain('function myMemory');
    });

    it('should generate prompt-template node', () => {
      const t = getNodeTemplate('prompt-template')!;
      const code = t.generate('myPrompt');
      expect(code).toContain('function myPrompt');
    });

    it('should generate json-extractor node', () => {
      const t = getNodeTemplate('json-extractor')!;
      const code = t.generate('myExtractor');
      expect(code).toContain('function myExtractor');
    });

    it('should generate human-approval node', () => {
      const t = getNodeTemplate('human-approval')!;
      const code = t.generate('myApproval');
      expect(code).toContain('function myApproval');
    });

    it('should generate agent-router node', () => {
      const t = getNodeTemplate('agent-router')!;
      const code = t.generate('myRouter');
      expect(code).toContain('function myRouter');
    });

    it('should generate rag-retriever node', () => {
      const t = getNodeTemplate('rag-retriever')!;
      const code = t.generate('myRetriever');
      expect(code).toContain('function myRetriever');
    });

    it('should generate node templates with config', () => {
      for (const t of nodeTemplates) {
        if (t.configSchema) {
          const code = t.generate('testNode', { someConfig: 'value' });
          expect(code).toContain('function testNode');
        }
      }
    });
  });

  describe('LLM provider code generators', () => {
    describe('generateOpenAIProvider', () => {
      it('should generate with default model', () => {
        const code = generateOpenAIProvider({ model: '' });
        expect(code).toContain('OPENAI PROVIDER');
        expect(code).toContain('OPENAI_API_KEY');
        expect(code).toContain('gpt-4o');
        expect(code).toContain('api.openai.com');
      });

      it('should use custom model', () => {
        const code = generateOpenAIProvider({ model: 'gpt-3.5-turbo' });
        expect(code).toContain('gpt-3.5-turbo');
      });

      it('should use custom API key env var', () => {
        const code = generateOpenAIProvider({ model: 'gpt-4o', apiKeyEnvVar: 'MY_KEY' });
        expect(code).toContain('MY_KEY');
        expect(code).not.toContain('OPENAI_API_KEY');
      });
    });

    describe('generateAnthropicProvider', () => {
      it('should generate with default model', () => {
        const code = generateAnthropicProvider({ model: '' });
        expect(code).toContain('ANTHROPIC PROVIDER');
        expect(code).toContain('ANTHROPIC_API_KEY');
        expect(code).toContain('claude-3-5-sonnet');
        expect(code).toContain('api.anthropic.com');
      });

      it('should use custom model', () => {
        const code = generateAnthropicProvider({ model: 'claude-3-haiku' });
        expect(code).toContain('claude-3-haiku');
      });

      it('should separate system messages', () => {
        const code = generateAnthropicProvider({ model: 'claude-3-5-sonnet' });
        expect(code).toContain('systemMessage');
      });
    });

    describe('generateOllamaProvider', () => {
      it('should generate with default model', () => {
        const code = generateOllamaProvider({ model: '' });
        expect(code).toContain('OLLAMA PROVIDER');
        expect(code).toContain('llama3.2');
        expect(code).toContain('localhost:11434');
      });

      it('should use custom model', () => {
        const code = generateOllamaProvider({ model: 'mistral' });
        expect(code).toContain('mistral');
      });
    });

    describe('generateMockProvider', () => {
      it('should generate mock provider', () => {
        const code = generateMockProvider();
        expect(code).toContain('MOCK PROVIDER');
        expect(code).toContain('Mock response');
      });
    });

    describe('getProviderCode', () => {
      it('should return openai provider for openai', () => {
        const code = getProviderCode('openai');
        expect(code).toContain('OPENAI PROVIDER');
      });

      it('should return anthropic provider for anthropic', () => {
        const code = getProviderCode('anthropic');
        expect(code).toContain('ANTHROPIC PROVIDER');
      });

      it('should return ollama provider for ollama', () => {
        const code = getProviderCode('ollama');
        expect(code).toContain('OLLAMA PROVIDER');
      });

      it('should return mock provider for mock', () => {
        const code = getProviderCode('mock');
        expect(code).toContain('MOCK PROVIDER');
      });

      it('should return mock provider for unknown provider', () => {
        const code = getProviderCode('unknown-provider');
        expect(code).toContain('MOCK PROVIDER');
      });

      it('should pass model to provider generator', () => {
        const code = getProviderCode('openai', 'gpt-4-turbo');
        expect(code).toContain('gpt-4-turbo');
      });
    });
  });

  describe('Approval strategy code generators', () => {
    it('should generate mock approval provider', () => {
      const code = generateMockApproval();
      expect(code).toContain('MOCK APPROVAL PROVIDER');
      expect(code).toContain('Auto-approving');
      expect(code).toContain('approved: true');
    });

    it('should generate callback approval provider', () => {
      const code = generateCallbackApproval();
      expect(code).toContain('CALLBACK APPROVAL PROVIDER');
      expect(code).toContain('ApprovalProvider');
    });

    it('should generate webhook approval provider', () => {
      const code = generateWebhookApproval();
      expect(code).toContain('WEBHOOK APPROVAL PROVIDER');
      expect(code).toContain('ApprovalProvider');
    });

    describe('getApprovalCode', () => {
      it('should return mock for mock strategy', () => {
        expect(getApprovalCode('mock')).toContain('MOCK APPROVAL');
      });

      it('should return callback for callback strategy', () => {
        expect(getApprovalCode('callback')).toContain('CALLBACK APPROVAL');
      });

      it('should return webhook for webhook strategy', () => {
        expect(getApprovalCode('webhook')).toContain('WEBHOOK APPROVAL');
      });

      it('should default to mock for unknown strategy', () => {
        expect(getApprovalCode('unknown')).toContain('MOCK APPROVAL');
      });
    });
  });

  describe('all templates produce valid annotations', () => {
    it('should contain @flowWeaver in all workflow templates', () => {
      for (const t of workflowTemplates) {
        const code = t.generate({ workflowName: 'test' });
        expect(code).toContain('@flowWeaver');
      }
    });

    it('should contain @flowWeaver nodeType in all node templates', () => {
      for (const t of nodeTemplates) {
        const code = t.generate('test');
        expect(code).toContain('@flowWeaver nodeType');
      }
    });

    it('should generate non-empty code from all templates', () => {
      for (const t of workflowTemplates) {
        const code = t.generate({ workflowName: 'test' });
        expect(code.length).toBeGreaterThan(100);
      }
      for (const t of nodeTemplates) {
        const code = t.generate('test');
        expect(code.length).toBeGreaterThan(50);
      }
    });
  });
});
