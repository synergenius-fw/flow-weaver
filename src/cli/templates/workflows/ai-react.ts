/**
 * ReAct Agent Template
 * Implements: Thought → Action → Observation loop with scoped iteration
 */
import type { WorkflowTemplate, WorkflowTemplateOptions } from '../index';
import { LLM_SIMPLE_TYPES, LLM_MOCK_PROVIDER } from '../shared/llm-types';

export const aiReactTemplate: WorkflowTemplate = {
  id: 'ai-react',
  name: 'ReAct Agent',
  description: 'Reasoning + Acting agent with explicit thought process',
  category: 'ai',
  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName } = opts;

    return `
// ============================================================
// ReAct Agent — Thought → Action → Observation loop
// ============================================================
//
// The agent follows the ReAct pattern (Yao et al., 2022):
//   1. Think — reason about the current state
//   2. Act — call a tool or FINISH
//   3. Observe — receive tool output, feed back into next thought
//
// The reactLoop node manages iteration and message accumulation.
// think + act run inside the loop's scoped iteration.

// ============================================================
// LLM TYPES
// ============================================================

${LLM_SIMPLE_TYPES}

// Mock provider — replace with real provider
const createMockReactProvider = (): LLMProvider => ({
  async chat(messages) {
    const lastMessage = messages[messages.length - 1];
    return {
      content: \`Thought: Processing the request\\nAction: FINISH\\nAction Input: [Mock answer to: \${lastMessage.content.slice(0, 30)}...]\`,
      toolCalls: [],
      finishReason: 'stop',
    };
  },
});

const llmProvider: LLMProvider = (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ ?? createMockReactProvider();
const MAX_STEPS = 10;

const REACT_PROMPT = \`You are a ReAct (Reasoning + Acting) agent.

For each step, you MUST respond in this exact format:
Thought: [Your reasoning about what to do next]
Action: [tool_name] or [FINISH]
Action Input: [input for the tool, or final answer if FINISH]

Available tools: search, calculate

When you have the final answer:
Thought: I now have enough information to answer
Action: FINISH
Action Input: [Your final answer here]\`;

// Parse ReAct response format
function parseReactResponse(content: string): {
  thought: string;
  action: string;
  actionInput: string;
} {
  const thoughtMatch = content.match(/Thought:\\s*(.+?)(?=\\nAction:|$)/s);
  const actionMatch = content.match(/Action:\\s*(.+?)(?=\\nAction Input:|$)/s);
  const inputMatch = content.match(/Action Input:\\s*(.+?)$/s);

  return {
    thought: thoughtMatch?.[1]?.trim() ?? '',
    action: actionMatch?.[1]?.trim() ?? 'FINISH',
    actionInput: inputMatch?.[1]?.trim() ?? '',
  };
}

// ============================================================
// TOOL IMPLEMENTATIONS
// ============================================================

// Replace with real tools
const TOOL_IMPLEMENTATIONS: Record<string, (input: string) => Promise<string>> = {
  async search(input: string): Promise<string> {
    return '[Search results for: ' + input + ']';
  },
  async calculate(input: string): Promise<string> {
    return '[Calculation result for: ' + input + ']';
  },
};

// ============================================================
// NODES
// ============================================================

/**
 * ReAct loop — manages Think→Act→Observe iterations.
 * Accumulates messages and terminates when action is FINISH or max steps.
 *
 * @flowWeaver nodeType
 * @label ReAct Loop
 * @input execute [order:0] - Execute
 * @input task [order:1] - Task for the agent
 * @input success scope:step [order:0] - Iteration succeeded
 * @input failure scope:step [order:1] - Iteration failed
 * @input thought scope:step [order:2] - Agent's reasoning
 * @input action scope:step [order:3] - Action name
 * @input actionInput scope:step [order:4] - Action input / final answer
 * @input observation scope:step [order:5] - Tool observation
 * @output onSuccess [order:0] - On Success (finished)
 * @output onFailure [order:1] - On Failure
 * @output start scope:step [order:0] - Triggers iteration
 * @output messages scope:step [order:1] - Current messages for LLM
 * @output answer [order:2] - Final answer
 */
async function reactLoop(
  execute: boolean,
  task: string,
  step: (start: boolean, messages: LLMMessage[]) => Promise<{
    success: boolean;
    failure: boolean;
    thought: string;
    action: string;
    actionInput: string;
    observation: string;
  }>
): Promise<{ onSuccess: boolean; onFailure: boolean; answer: string }> {
  if (!execute) {
    return { onSuccess: false, onFailure: false, answer: '' };
  }

  const messages: LLMMessage[] = [{ role: 'user', content: task }];

  for (let i = 0; i < MAX_STEPS; i++) {
    const result = await step(true, messages);

    if (result.failure) {
      return { onSuccess: false, onFailure: true, answer: '' };
    }

    // Append thought + action as assistant message
    messages.push({
      role: 'assistant',
      content: \`Thought: \${result.thought}\\nAction: \${result.action}\\nAction Input: \${result.actionInput}\`,
    });

    // Check termination
    if (result.action.toUpperCase() === 'FINISH') {
      return { onSuccess: true, onFailure: false, answer: result.actionInput };
    }

    // Append observation
    if (result.observation) {
      messages.push({ role: 'user', content: \`Observation: \${result.observation}\` });
    }
  }

  return { onSuccess: true, onFailure: false, answer: 'Max steps reached' };
}

/**
 * ReAct reasoning step — calls LLM and parses Thought/Action/ActionInput
 *
 * @flowWeaver nodeType
 * @label Think
 * @input execute [order:0] - Execute
 * @input messages [order:1] - Conversation history
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output thought [order:2] - Agent's reasoning
 * @output action [order:3] - Action to take (tool name or FINISH)
 * @output actionInput [order:4] - Input for action or final answer
 */
async function think(
  execute: boolean,
  messages: LLMMessage[]
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  thought: string;
  action: string;
  actionInput: string;
}> {
  if (!execute) {
    return { onSuccess: false, onFailure: false, thought: '', action: '', actionInput: '' };
  }

  try {
    const response = await llmProvider.chat(messages, { systemPrompt: REACT_PROMPT });
    const parsed = parseReactResponse(response.content ?? '');

    return {
      onSuccess: true,
      onFailure: false,
      thought: parsed.thought,
      action: parsed.action,
      actionInput: parsed.actionInput,
    };
  } catch {
    return { onSuccess: false, onFailure: true, thought: '', action: '', actionInput: '' };
  }
}

/**
 * Execute action and return observation
 *
 * @flowWeaver nodeType
 * @label Act
 * @input execute [order:0] - Execute
 * @input action [order:1] - Tool name to execute
 * @input actionInput [order:2] - Input for tool
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output observation [order:2] - Tool observation result
 */
async function act(
  execute: boolean,
  action: string,
  actionInput: string
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  observation: string;
}> {
  if (!execute) {
    return { onSuccess: false, onFailure: false, observation: '' };
  }

  const tool = TOOL_IMPLEMENTATIONS[action.toLowerCase()];
  if (!tool) {
    return {
      onSuccess: true,
      onFailure: false,
      observation: 'Unknown tool: ' + action,
    };
  }

  try {
    const observation = await tool(actionInput);
    return { onSuccess: true, onFailure: false, observation };
  } catch (error) {
    return { onSuccess: false, onFailure: true, observation: '' };
  }
}

// ============================================================
// WORKFLOW
// ============================================================

/**
 * ReAct Agent — iterative Thought→Action→Observation loop
 *
 * @flowWeaver workflow
 * @node loop reactLoop [size: 450 250]
 * @node thinking think loop.step
 * @node acting act loop.step
 * @position Start -400 0
 * @position loop -150 0
 * @position thinking -80 30
 * @position acting 130 30
 * @position Exit 350 0
 * @connect Start.execute -> loop.execute
 * @connect Start.task -> loop.task
 * @connect loop.start -> thinking.execute
 * @connect loop.messages -> thinking.messages
 * @connect thinking.onSuccess -> acting.execute
 * @connect thinking.action -> acting.action
 * @connect thinking.actionInput -> acting.actionInput
 * @connect thinking.thought -> loop.thought
 * @connect thinking.action -> loop.action
 * @connect thinking.actionInput -> loop.actionInput
 * @connect thinking.onFailure -> loop.failure
 * @connect acting.observation -> loop.observation
 * @connect acting.onSuccess -> loop.success
 * @connect acting.onFailure -> loop.failure
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 * @connect loop.answer -> Exit.answer
 * @param execute [order:0] - Execute
 * @param task [order:1] - Task for the agent
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns answer [order:2] - Final answer
 */
export async function ${workflowName}(
  execute: boolean,
  params: { task: string }
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  answer: string;
}> {
  throw new Error('Compile with: flow-weaver compile <file>');
}
`.trim();
  },
};
