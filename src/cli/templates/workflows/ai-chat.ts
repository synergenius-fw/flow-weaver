/**
 * Stateful Chat Template
 * Maintains conversation history with memory
 */
import type { WorkflowTemplate, WorkflowTemplateOptions } from '../index';
import { getProviderCode } from '../providers';
import { aiConfigSchema } from './ai-agent';
import { LLM_SIMPLE_TYPES, LLM_MOCK_PROVIDER } from '../shared/llm-types';

export const aiChatTemplate: WorkflowTemplate = {
  id: 'ai-chat',
  name: 'Stateful Chat',
  description: 'Conversational AI with memory management',
  category: 'ai',
  configSchema: aiConfigSchema,

  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, config } = opts;
    const provider = (config?.provider as string) || 'mock';
    const model = (config?.model as string) || '';

    // Get provider-specific code or use mock
    const providerCode =
      provider === 'mock'
        ? `
// Mock provider for testing - replace with real provider
${LLM_MOCK_PROVIDER}
`
        : getProviderCode(provider, model);

    return `
// ============================================================
// LLM TYPES - Provider-agnostic interface
// ============================================================

${LLM_SIMPLE_TYPES}

${providerCode}

// Conversation memory store
const conversations: Map<string, LLMMessage[]> = new Map();

const DEFAULT_SYSTEM_PROMPT = \`You are a helpful AI assistant.
Be concise but friendly. Remember context from earlier in the conversation.\`;

/**
 * Manages conversation memory
 *
 * @flowWeaver nodeType
 * @label Memory
 * @input conversationId [order:1] - Conversation identifier
 * @input newMessage [order:2] - Message to add
 * @input [maxHistory=50] [order:3] - Max messages to retain
 * @input execute [order:0] - Execute
 * @output history [order:2] - Conversation history
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function memory(
  execute: boolean,
  conversationId: string,
  newMessage?: LLMMessage,
  maxHistory?: number
): {
  onSuccess: boolean;
  onFailure: boolean;
  history: LLMMessage[];
} {
  if (!execute) {
    return { onSuccess: false, onFailure: false, history: [] };
  }

  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, []);
  }

  const history = conversations.get(conversationId)!;

  if (newMessage) {
    history.push(newMessage);
    const max = maxHistory ?? 50;
    while (history.length > max) {
      history.shift();
    }
  }

  return { onSuccess: true, onFailure: false, history: [...history] };
}

/**
 * Generates chat response
 *
 * @flowWeaver nodeType
 * @label Chat
 * @input history [order:1] - Conversation history
 * @input [systemPrompt] [order:2] - System prompt
 * @input execute [order:0] - Execute
 * @output response [order:2] - Assistant response
 * @output responseMessage [order:3] - Response as LLMMessage
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function chat(
  execute: boolean,
  history: LLMMessage[],
  systemPrompt?: string
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  response: string;
  responseMessage: LLMMessage;
}> {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      response: '',
      responseMessage: { role: 'assistant', content: '' },
    };
  }

  const response = await llmProvider.chat(history, {
    systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  });

  const content = response.content ?? '';

  return {
    onSuccess: true,
    onFailure: false,
    response: content,
    responseMessage: { role: 'assistant', content },
  };
}

/**
 * Stateful chat with conversation memory
 *
 * @flowWeaver workflow
 * @node mem memory
 * @node respond chat
 * @node saveMem memory
 * @position Start -350 0
 * @position mem -150 0
 * @position respond 50 0
 * @position saveMem 250 0
 * @position Exit 450 0
 * @connect Start.execute -> mem.execute
 * @connect Start.conversationId -> mem.conversationId
 * @connect Start.userMessage -> mem.newMessage
 * @connect mem.history -> respond.history
 * @connect mem.onSuccess -> respond.execute
 * @connect Start.conversationId -> saveMem.conversationId
 * @connect respond.responseMessage -> saveMem.newMessage
 * @connect respond.onSuccess -> saveMem.execute
 * @connect respond.response -> Exit.response
 * @connect saveMem.onSuccess -> Exit.onSuccess
 * @param execute [order:0] - Execute
 * @param conversationId [order:1] - Unique conversation ID
 * @param userMessage [order:2] - User's message
 * @param systemPrompt [order:3] - System prompt (optional)
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns response [order:2] - Assistant's response
 */
export async function ${workflowName}(
  execute: boolean,
  params: { conversationId: string; userMessage: LLMMessage; systemPrompt?: string }
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  response: string;
}> {
  throw new Error('Compile with: flow-weaver compile <file>');
}
`.trim();
  },
};
