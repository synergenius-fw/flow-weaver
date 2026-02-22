/**
 * Shared LLM type definitions for AI template code generation.
 *
 * These strings are embedded into generated workflow code by the AI templates.
 * They provide the common type system that all AI workflows need.
 */

/** Core LLM types — embedded in all AI templates */
export const LLM_CORE_TYPES = `interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}

interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface LLMTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string }>;
    required?: string[];
  };
}

interface LLMProvider {
  chat(
    messages: LLMMessage[],
    options?: { tools?: LLMTool[]; systemPrompt?: string; model?: string; temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse>;
}`;

/** Simplified LLM types — for templates that don't need tool calling */
export const LLM_SIMPLE_TYPES = `interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}

interface LLMProvider {
  chat(messages: LLMMessage[], options?: { systemPrompt?: string; model?: string; temperature?: number; maxTokens?: number }): Promise<LLMResponse>;
}`;

/** Mock provider factory code */
export const LLM_MOCK_PROVIDER = `const createMockProvider = (): LLMProvider => ({
  async chat(messages) {
    const lastMessage = messages[messages.length - 1];
    return {
      content: \`[Mock response to: \${lastMessage.content.slice(0, 50)}...]\`,
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    };
  },
});

const llmProvider: LLMProvider = (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ ?? createMockProvider();`;

/** Mock provider with tool calling support (for ai-agent) */
export const LLM_MOCK_PROVIDER_WITH_TOOLS = `const createMockProvider = (): LLMProvider => ({
  async chat(messages, options) {
    const last = messages[messages.length - 1];
    if (options?.tools && last.content.toLowerCase().includes('search')) {
      return {
        content: null,
        toolCalls: [
          {
            id: 'call_' + Date.now(),
            name: 'search',
            arguments: { query: last.content },
          },
        ],
        finishReason: 'tool_calls',
        usage: { promptTokens: 15, completionTokens: 30 },
      };
    }

    return {
      content: '[Mock answer] ' + last.content,
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    };
  },
});

const llmProvider: LLMProvider = (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ ?? createMockProvider();`;
