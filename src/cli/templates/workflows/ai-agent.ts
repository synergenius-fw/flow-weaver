/**
 * AI Agent Template
 * Stateful, tool-calling agent with explicit loop and termination semantics
 */
import type { WorkflowTemplate, WorkflowTemplateOptions } from '../index';
import { getProviderCode } from '../providers';
import { LLM_CORE_TYPES, LLM_MOCK_PROVIDER_WITH_TOOLS } from '../shared/llm-types';

/** Shared configSchema for AI templates */
export const aiConfigSchema = {
  provider: {
    type: 'select' as const,
    label: 'LLM Provider',
    description: 'Choose your LLM provider',
    default: 'mock',
    options: [
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'ollama', label: 'Ollama (Local)' },
      { value: 'mock', label: 'Mock (Testing)' },
    ],
  },
  model: {
    type: 'string' as const,
    label: 'Model',
    description: 'Model identifier',
    default: 'gpt-4o',
    placeholder: 'e.g., gpt-4o, claude-3-5-sonnet-20241022, llama3.2',
    dependsOn: {
      field: 'provider',
      values: ['openai', 'anthropic', 'ollama'],
    },
  },
};

export const aiAgentTemplate: WorkflowTemplate = {
  id: 'ai-agent',
  name: 'AI Agent (Tool Calling)',
  description: 'Stateful LLM agent with explicit reasoning loop and tool execution',
  category: 'ai',
  configSchema: aiConfigSchema,

  generate: ({ workflowName, config }: WorkflowTemplateOptions): string => {
    const provider = (config?.provider as string) || 'mock';
    const model = (config?.model as string) || '';

    // Get provider-specific code or use mock
    const providerCode =
      provider === 'mock'
        ? `
/* ============================================================
 * MOCK PROVIDER (REPLACE IN REAL USE)
 * ============================================================
 */

${LLM_MOCK_PROVIDER_WITH_TOOLS}
`
        : getProviderCode(provider, model);

    return `
/* ============================================================
 * CORE TYPES
 * ============================================================
 */

${LLM_CORE_TYPES}

type TerminationReason =
  | 'completed'
  | 'max_iterations'
  | 'tool_error'
  | 'llm_error'
  | 'aborted';

/* ============================================================
 * AGENT STATE
 * ============================================================
 */

interface AgentState {
  messages: LLMMessage[];
  iteration: number;
  toolsUsed: string[];
  terminated: boolean;
  terminationReason?: TerminationReason;
  finalResponse?: string;
}

${providerCode}

const SYSTEM_PROMPT = \`You are a helpful AI assistant with access to tools.
Use tools when necessary. Respond directly when the task is complete.\`;

const MAX_ITERATIONS = 10;

/* ============================================================
 * TOOLS
 * ============================================================
 */

const AVAILABLE_TOOLS: LLMTool[] = [
  {
    name: 'search',
    description: 'Search for information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
];

type ToolResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

type ToolFn = (args: Record<string, unknown>) => Promise<ToolResult>;

const TOOL_IMPLEMENTATIONS: Record<string, ToolFn> = {
  async search(args) {
    if (typeof args.query !== 'string') {
      return { ok: false, error: 'Invalid query' };
    }
    return { ok: true, value: '[Search results for: ' + args.query + ']' };
  },
};

/* ============================================================
 * NODES
 * ============================================================
 */

/**
 * Agent loop that orchestrates LLM calls and tool execution
 * Uses scoped ports to handle iteration internally
 *
 * @flowWeaver nodeType
 * @label Agent Loop
 * @input userMessage [order:1] - User's input message
 * @input success scope:iteration [order:0] - From LLM onSuccess
 * @input failure scope:iteration [order:1] - From LLM onFailure
 * @input llmResponse scope:iteration [order:2] - LLM response
 * @input toolMessages scope:iteration [order:3] - Tool results
 * @input execute [order:0] - Execute
 * @output start scope:iteration [order:0] - Triggers iteration
 * @output state scope:iteration [order:1] - Current agent state
 * @output response [order:2] - Final response when done
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function agentLoop(
  execute: boolean,
  userMessage: string,
  iteration: (start: boolean, state: AgentState) => Promise<{
    success: boolean;
    failure: boolean;
    llmResponse: LLMResponse | null;
    toolMessages: LLMMessage[];
  }>
): Promise<{ onSuccess: boolean; onFailure: boolean; response: string }> {
  if (!execute) {
    return { onSuccess: false, onFailure: false, response: '' };
  }

  let state: AgentState = {
    messages: [{ role: 'user', content: userMessage }],
    iteration: 0,
    toolsUsed: [],
    terminated: false,
  };

  while (state.iteration < MAX_ITERATIONS) {
    const result = await iteration(true, state);

    state.iteration++;

    // Handle LLM failure
    if (result.failure) {
      return { onSuccess: false, onFailure: true, response: 'LLM error occurred' };
    }

    // Add assistant message if present
    if (result.llmResponse?.content) {
      state.messages.push({ role: 'assistant', content: result.llmResponse.content });
    }

    // Add tool messages
    if (result.toolMessages && result.toolMessages.length > 0) {
      state.messages.push(...result.toolMessages);
    }

    // Check termination: no tool calls means we're done
    if (result.llmResponse && result.llmResponse.toolCalls.length === 0 && result.llmResponse.content) {
      return { onSuccess: true, onFailure: false, response: result.llmResponse.content };
    }
  }

  return { onSuccess: true, onFailure: false, response: 'Max iterations reached' };
}

/**
 * Calls the LLM with current state
 *
 * @flowWeaver nodeType
 * @label Call LLM
 * @input state [order:1] - Current agent state
 * @input execute [order:0] - Execute
 * @output response [order:2] - LLM response
 * @output toolCalls [order:3] - Tool calls from LLM
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function callLLM(
  execute: boolean,
  state: AgentState
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  response: LLMResponse | null;
  toolCalls: LLMToolCall[];
}> {
  if (!execute) {
    return { onSuccess: false, onFailure: false, response: null, toolCalls: [] };
  }

  try {
    const response = await llmProvider.chat(state.messages, {
      tools: AVAILABLE_TOOLS,
      systemPrompt: SYSTEM_PROMPT,
    });

    return { onSuccess: true, onFailure: false, response, toolCalls: response.toolCalls };
  } catch {
    return { onSuccess: false, onFailure: true, response: null, toolCalls: [] };
  }
}

/**
 * Executes tool calls
 *
 * @flowWeaver nodeType
 * @label Execute Tools
 * @input calls [order:1] - Tool calls to execute
 * @input execute [order:0] - Execute
 * @output messages [order:2] - Tool response messages
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function executeTools(
  execute: boolean,
  calls: LLMToolCall[]
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  messages: LLMMessage[];
}> {
  if (!execute || !calls || calls.length === 0) {
    return { onSuccess: true, onFailure: false, messages: [] };
  }

  const messages: LLMMessage[] = [];

  for (const call of calls) {
    const impl = TOOL_IMPLEMENTATIONS[call.name];
    if (!impl) {
      messages.push({
        role: 'tool',
        content: 'Unknown tool: ' + call.name,
        toolCallId: call.id,
      });
      continue;
    }

    const result = await impl(call.arguments);

    messages.push({
      role: 'tool',
      content: result.ok ? result.value : 'Error: ' + result.error,
      toolCallId: call.id,
    });
  }

  return { onSuccess: true, onFailure: false, messages };
}

/* ============================================================
 * WORKFLOW
 * ============================================================
 */

/**
 * AI Agent that uses tools to accomplish tasks
 *
 * @flowWeaver workflow
 * @node loop agentLoop [size: 450 350] [position: -180 0]
 * @node llm callLLM loop.iteration [position: -40 100]
 * @node tools executeTools loop.iteration [position: 120 200]
 * @position Start -450 0
 * @position Exit 360 0
 * @connect Start.execute -> loop.execute
 * @connect Start.userMessage -> loop.userMessage
 * @connect loop.start:iteration -> llm.execute
 * @connect loop.state:iteration -> llm.state
 * @connect llm.toolCalls -> tools.calls
 * @connect llm.onSuccess -> tools.execute
 * @connect llm.response -> loop.llmResponse:iteration
 * @connect llm.onSuccess -> loop.success:iteration
 * @connect llm.onFailure -> loop.failure:iteration
 * @connect tools.messages -> loop.toolMessages:iteration
 * @connect loop.response -> Exit.response
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 * @param execute [order:0] - Execute
 * @param userMessage [order:1] - User's message to the agent
 * @returns onSuccess [order:0] - Agent completed successfully
 * @returns onFailure [order:1] - Agent encountered an error
 * @returns response [order:2] - Agent's final response
 */
export async function ${workflowName}(
  execute: boolean,
  params: { userMessage: string }
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
