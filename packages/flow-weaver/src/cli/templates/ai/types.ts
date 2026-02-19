/**
 * Provider-agnostic LLM types for Flow Weaver AI templates
 */

// Core message types (matches OpenAI/Anthropic format)
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string; // For tool response messages
}

// Tool/Function definition (maps directly to Flow Weaver node ports)
export interface LLMTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
}

// Tool call from LLM response
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// LLM response
export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}

// Provider options
export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: LLMTool[];
  systemPrompt?: string;
}

// The provider interface - users implement this
export interface LLMProvider {
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
}

// Factory type for dependency injection
export type LLMProviderFactory = () => LLMProvider;
