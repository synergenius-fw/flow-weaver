import type { NodeTemplate } from '../index';

export const llmCallNodeTemplate: NodeTemplate = {
  id: 'llm-call',
  name: 'LLM Call',
  description: 'Provider-agnostic LLM API call with tool support',
  category: 'ai',
  generate: (name: string): string => {
    const funcName = name || 'llmCall';
    return `
// LLM Types
interface LLMMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; }
interface LLMTool { name: string; description: string; parameters: { type: 'object'; properties: Record<string, { type: string; description?: string }>; required?: string[] }; }
interface LLMToolCall { id: string; name: string; arguments: Record<string, unknown>; }
interface LLMResponse { content: string | null; toolCalls: LLMToolCall[]; finishReason: string; }
interface LLMProvider { chat(messages: LLMMessage[], options?: { tools?: LLMTool[]; temperature?: number }): Promise<LLMResponse>; }

// Mock provider - replace with real provider (OpenAI, Anthropic, etc.)
const createMockProvider = (): LLMProvider => ({
  async chat(messages, options) {
    const lastMsg = messages[messages.length - 1];
    if (options?.tools?.length && lastMsg.content.toLowerCase().includes('search')) {
      return { content: null, toolCalls: [{ id: \`call_\${Date.now()}\`, name: 'search', arguments: { query: lastMsg.content } }], finishReason: 'tool_calls' };
    }
    return { content: \`[Mock: \${lastMsg.content.slice(0, 40)}...]\`, toolCalls: [], finishReason: 'stop' };
  },
});

const llmProvider: LLMProvider = (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ ?? createMockProvider();

/**
 * Calls an LLM with messages and optional tools
 *
 * @flowWeaver nodeType
 * @label ${funcName}
 * @color purple
 * @icon psychology
 * @input messages [order:1] - Conversation messages
 * @input tools [order:2] - Available tools/functions (optional)
 * @input systemPrompt [order:3] - System prompt (optional)
 * @input temperature [order:4] - Temperature 0-1 (optional)
 * @input execute [order:0] - Execute
 * @output content [order:2] - Text response (null if tool call)
 * @output toolCalls [order:3] - Tool calls requested by LLM
 * @output hasToolCalls [order:4] - Whether LLM wants to call tools
 * @output finishReason [order:5] - Why generation stopped
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function ${funcName}(
  execute: boolean,
  messages: LLMMessage[],
  tools?: LLMTool[],
  systemPrompt?: string,
  temperature?: number
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  content: string | null;
  toolCalls: LLMToolCall[];
  hasToolCalls: boolean;
  finishReason: string;
}> {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      content: null,
      toolCalls: [],
      hasToolCalls: false,
      finishReason: 'skipped'
    };
  }

  try {
    const allMessages: LLMMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const response = await llmProvider.chat(allMessages, {
      tools,
      temperature,
    });

    return {
      onSuccess: true,
      onFailure: false,
      content: response.content,
      toolCalls: response.toolCalls,
      hasToolCalls: response.toolCalls.length > 0,
      finishReason: response.finishReason
    };
  } catch (error) {
    console.error('LLM call failed:', error);
    return {
      onSuccess: false,
      onFailure: true,
      content: null,
      toolCalls: [],
      hasToolCalls: false,
      finishReason: 'error'
    };
  }
}
`.trim();
  },
};
