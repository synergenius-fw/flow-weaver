/**
 * Tests for LLM Provider Code Generators
 * TDD: Write tests first, then implement
 */

import {
  generateOpenAIProvider,
  generateAnthropicProvider,
  generateOllamaProvider,
  generateMockProvider,
  getProviderCode,
} from '../../../src/cli/templates/providers';

describe('Provider Code Generators', () => {
  describe('generateOpenAIProvider', () => {
    it('should include API key check', () => {
      const code = generateOpenAIProvider({ model: 'gpt-4o' });
      expect(code).toContain('OPENAI_API_KEY');
      expect(code).toContain('throw new Error');
    });

    it('should include fetch call to OpenAI', () => {
      const code = generateOpenAIProvider({ model: 'gpt-4o' });
      expect(code).toContain('api.openai.com/v1/chat/completions');
      expect(code).toContain('Authorization');
    });

    it('should include model parameter', () => {
      const code = generateOpenAIProvider({ model: 'gpt-4-turbo' });
      expect(code).toContain('gpt-4-turbo');
    });

    it('should handle tool calls mapping', () => {
      const code = generateOpenAIProvider({ model: 'gpt-4o' });
      expect(code).toContain('tool_calls');
      expect(code).toContain('function.name');
    });

    it('should implement LLMProvider interface', () => {
      const code = generateOpenAIProvider({ model: 'gpt-4o' });
      expect(code).toContain('const llmProvider: LLMProvider');
      expect(code).toContain('async chat(messages');
    });

    it('should support custom API key env var', () => {
      const code = generateOpenAIProvider({
        model: 'gpt-4o',
        apiKeyEnvVar: 'MY_OPENAI_KEY',
      });
      expect(code).toContain('MY_OPENAI_KEY');
    });
  });

  describe('generateAnthropicProvider', () => {
    it('should include API key check', () => {
      const code = generateAnthropicProvider({
        model: 'claude-3-5-sonnet-20241022',
      });
      expect(code).toContain('ANTHROPIC_API_KEY');
      expect(code).toContain('throw new Error');
    });

    it('should include Anthropic API endpoint', () => {
      const code = generateAnthropicProvider({
        model: 'claude-3-5-sonnet-20241022',
      });
      expect(code).toContain('api.anthropic.com/v1/messages');
      expect(code).toContain('anthropic-version');
    });

    it('should handle system message separately', () => {
      const code = generateAnthropicProvider({
        model: 'claude-3-5-sonnet-20241022',
      });
      expect(code).toContain('systemMessage');
      expect(code).toContain("role !== 'system'");
    });

    it('should handle tool_result format', () => {
      const code = generateAnthropicProvider({
        model: 'claude-3-5-sonnet-20241022',
      });
      expect(code).toContain('tool_result');
      expect(code).toContain('tool_use_id');
    });

    it('should include model parameter', () => {
      const code = generateAnthropicProvider({
        model: 'claude-3-opus-20240229',
      });
      expect(code).toContain('claude-3-opus-20240229');
    });

    it('should implement LLMProvider interface', () => {
      const code = generateAnthropicProvider({
        model: 'claude-3-5-sonnet-20241022',
      });
      expect(code).toContain('const llmProvider: LLMProvider');
      expect(code).toContain('async chat(messages');
    });
  });

  describe('generateOllamaProvider', () => {
    it('should use localhost by default', () => {
      const code = generateOllamaProvider({ model: 'llama3.2' });
      expect(code).toContain('localhost:11434');
    });

    it('should support custom base URL via env var', () => {
      const code = generateOllamaProvider({ model: 'llama3.2' });
      expect(code).toContain('OLLAMA_BASE_URL');
    });

    it('should include model pull instructions in comment', () => {
      const code = generateOllamaProvider({ model: 'llama3.2' });
      expect(code).toContain('ollama pull llama3.2');
    });

    it('should include model parameter', () => {
      const code = generateOllamaProvider({ model: 'mistral' });
      expect(code).toContain('mistral');
    });

    it('should implement LLMProvider interface', () => {
      const code = generateOllamaProvider({ model: 'llama3.2' });
      expect(code).toContain('const llmProvider: LLMProvider');
      expect(code).toContain('async chat(messages');
    });

    it('should not require API key (local)', () => {
      const code = generateOllamaProvider({ model: 'llama3.2' });
      // Ollama is local, no API key check required
      expect(code).not.toContain('API_KEY');
      expect(code).not.toContain('Missing');
    });
  });

  describe('generateMockProvider', () => {
    it('should return mock provider code', () => {
      const code = generateMockProvider();
      expect(code).toContain('Mock');
      expect(code).toContain('llmProvider');
    });

    it('should implement LLMProvider interface', () => {
      const code = generateMockProvider();
      expect(code).toContain('const llmProvider: LLMProvider');
      expect(code).toContain('async chat(messages');
    });

    it('should simulate tool calls for testing', () => {
      const code = generateMockProvider();
      expect(code).toContain('toolCalls');
      expect(code).toContain('search');
    });

    it('should not require any API keys', () => {
      const code = generateMockProvider();
      expect(code).not.toContain('API_KEY');
      expect(code).not.toContain('throw new Error');
    });
  });

  describe('getProviderCode', () => {
    it("should return OpenAI code for 'openai'", () => {
      const code = getProviderCode('openai', 'gpt-4o');
      expect(code).toContain('api.openai.com');
      expect(code).toContain('OPENAI_API_KEY');
    });

    it("should return Anthropic code for 'anthropic'", () => {
      const code = getProviderCode('anthropic', 'claude-3-5-sonnet-20241022');
      expect(code).toContain('api.anthropic.com');
      expect(code).toContain('ANTHROPIC_API_KEY');
    });

    it("should return Ollama code for 'ollama'", () => {
      const code = getProviderCode('ollama', 'llama3.2');
      expect(code).toContain('localhost:11434');
    });

    it("should return mock code for 'mock'", () => {
      const code = getProviderCode('mock');
      expect(code).toContain('Mock');
    });

    it('should return mock code for unknown provider', () => {
      const code = getProviderCode('unknown-provider');
      expect(code).toContain('Mock');
    });

    it('should use provided model in generated code', () => {
      const code = getProviderCode('openai', 'gpt-4-turbo');
      expect(code).toContain('gpt-4-turbo');
    });

    it('should use default model when not provided', () => {
      const code = getProviderCode('openai');
      expect(code).toContain('gpt-4o'); // default OpenAI model
    });
  });

  describe('Generated code validity', () => {
    it('OpenAI code should be valid TypeScript structure', () => {
      const code = generateOpenAIProvider({ model: 'gpt-4o' });
      // Check basic structure
      expect(code).toMatch(/const\s+llmProvider:\s*LLMProvider\s*=/);
      expect(code).toMatch(/async\s+chat\s*\(/);
      expect(code).toMatch(/return\s*\{/);
    });

    it('Anthropic code should be valid TypeScript structure', () => {
      const code = generateAnthropicProvider({
        model: 'claude-3-5-sonnet-20241022',
      });
      expect(code).toMatch(/const\s+llmProvider:\s*LLMProvider\s*=/);
      expect(code).toMatch(/async\s+chat\s*\(/);
      expect(code).toMatch(/return\s*\{/);
    });

    it('Ollama code should be valid TypeScript structure', () => {
      const code = generateOllamaProvider({ model: 'llama3.2' });
      expect(code).toMatch(/const\s+llmProvider:\s*LLMProvider\s*=/);
      expect(code).toMatch(/async\s+chat\s*\(/);
      expect(code).toMatch(/return\s*\{/);
    });
  });
});
