import type { NodeTemplate } from '../index';

export const toolExecutorNodeTemplate: NodeTemplate = {
  id: 'tool-executor',
  name: 'Tool Executor',
  description: 'Executes tool calls from LLM response',
  category: 'ai',
  generate: (name: string): string => {
    const funcName = name || 'executeTool';
    return `
// LLM Types
interface LLMToolCall { id: string; name: string; arguments: Record<string, unknown>; }
interface LLMMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; }

// Register your tools here
type ToolFunction = (args: Record<string, unknown>) => Promise<unknown>;
const toolRegistry: Record<string, ToolFunction> = {
  // Example tools:
  // 'search': async (args) => {
  //   const query = String(args.query || '');
  //   return await searchDatabase(query);
  // },
  // 'get_weather': async (args) => {
  //   const city = String(args.city || '');
  //   const response = await fetch(\`https://api.weather.example/v1/\${encodeURIComponent(city)}\`);
  //   return response.json();
  // },
};

/**
 * Executes a single tool call and returns result as message
 *
 * @flowWeaver nodeType
 * @label ${funcName}
 * @color cyan
 * @icon build
 * @input toolCall [order:1] - Tool call to execute
 * @input execute [order:0] - Execute
 * @output result [order:2] - Tool execution result
 * @output resultMessage [order:3] - Result formatted as LLM message
 * @output toolName [order:4] - Name of executed tool
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function ${funcName}(
  execute: boolean,
  toolCall: LLMToolCall
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  result: unknown;
  resultMessage: LLMMessage;
  toolName: string;
}> {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      result: null,
      resultMessage: { role: 'tool', content: '', toolCallId: '' },
      toolName: ''
    };
  }

  const tool = toolRegistry[toolCall.name];
  if (!tool) {
    return {
      onSuccess: false,
      onFailure: true,
      result: null,
      resultMessage: {
        role: 'tool',
        content: JSON.stringify({ error: \`Unknown tool: \${toolCall.name}\` }),
        toolCallId: toolCall.id
      },
      toolName: toolCall.name
    };
  }

  try {
    const result = await tool(toolCall.arguments);
    return {
      onSuccess: true,
      onFailure: false,
      result,
      resultMessage: {
        role: 'tool',
        content: JSON.stringify(result),
        toolCallId: toolCall.id
      },
      toolName: toolCall.name
    };
  } catch (error) {
    return {
      onSuccess: false,
      onFailure: true,
      result: null,
      resultMessage: {
        role: 'tool',
        content: JSON.stringify({ error: String(error) }),
        toolCallId: toolCall.id
      },
      toolName: toolCall.name
    };
  }
}
`.trim();
  },
};
