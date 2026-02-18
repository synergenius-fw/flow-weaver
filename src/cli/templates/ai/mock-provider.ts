/**
 * Mock LLM provider for testing/development
 * Replace with real provider (OpenAI, Anthropic, etc.)
 */
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types';

export const createMockProvider = (): LLMProvider => ({
  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const lastMessage = messages[messages.length - 1];

    // Simulate tool calling if tools provided
    if (options?.tools && options.tools.length > 0) {
      const shouldCallTool =
        lastMessage.content.toLowerCase().includes('search') ||
        lastMessage.content.toLowerCase().includes('calculate');

      if (shouldCallTool) {
        return {
          content: null,
          toolCalls: [
            {
              id: `call_${Date.now()}`,
              name: options.tools[0].name,
              arguments: { query: lastMessage.content },
            },
          ],
          finishReason: 'tool_calls',
        };
      }
    }

    return {
      content: `[Mock Response to: ${lastMessage.content.slice(0, 50)}...]`,
      toolCalls: [],
      finishReason: 'stop',
    };
  },
});

// Example real provider adapter (in comments for user reference)
/*
import OpenAI from 'openai';

export const createOpenAIProvider = (apiKey: string): LLMProvider => {
  const client = new OpenAI({ apiKey });

  return {
    async chat(messages, options) {
      const response = await client.chat.completions.create({
        model: options?.model ?? 'gpt-4',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        tools: options?.tools?.map(t => ({ type: 'function', function: t })),
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      });

      const choice = response.choices[0];
      return {
        content: choice.message.content,
        toolCalls: choice.message.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments)
        })) ?? [],
        finishReason: choice.finish_reason as any,
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens
        } : undefined
      };
    }
  };
};
*/
