import type { NodeTemplate } from '../index';

export const conversationMemoryNodeTemplate: NodeTemplate = {
  id: 'conversation-memory',
  name: 'Conversation Memory',
  description: 'Stores and retrieves conversation history',
  category: 'ai',
  generate: (name: string): string => {
    const funcName = name || 'conversationMemory';
    return `
// LLM Types
interface LLMMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; }

// In-memory store (replace with Redis, database, etc. for production)
const conversations: Map<string, LLMMessage[]> = new Map();

/**
 * Manages conversation history for stateful chat
 *
 * @flowWeaver nodeType
 * @label ${funcName}
 * @color blue
 * @icon database
 * @input conversationId [order:1] - Unique conversation identifier
 * @input newMessage [order:2] - New message to add (optional)
 * @input maxMessages [order:3] - Max messages to retain (optional, default 50)
 * @input execute [order:0] - Execute
 * @output messages [order:2] - Full conversation history
 * @output messageCount [order:3] - Number of messages
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function ${funcName}(
  execute: boolean,
  conversationId: string,
  newMessage?: LLMMessage,
  maxMessages?: number
): {
  onSuccess: boolean;
  onFailure: boolean;
  messages: LLMMessage[];
  messageCount: number;
} {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      messages: [],
      messageCount: 0
    };
  }

  const limit = maxMessages ?? 50;

  // Get or create conversation
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, []);
  }

  const history = conversations.get(conversationId)!;

  // Add new message if provided
  if (newMessage) {
    history.push(newMessage);

    // Trim to max length (keep system message if present)
    while (history.length > limit) {
      const firstNonSystem = history.findIndex(m => m.role !== 'system');
      if (firstNonSystem > 0) {
        history.splice(firstNonSystem, 1);
      } else {
        history.shift();
      }
    }
  }

  return {
    onSuccess: true,
    onFailure: false,
    messages: [...history],
    messageCount: history.length
  };
}
`.trim();
  },
};
