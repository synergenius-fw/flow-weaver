/**
 * LLM Provider Code Generators
 * Generate provider implementation code for different LLM services
 */

export interface ProviderCodeOptions {
  model: string;
  apiKeyEnvVar?: string;
}

export function generateOpenAIProvider(opts: ProviderCodeOptions): string {
  const model = opts.model || 'gpt-4o';
  const apiKey = opts.apiKeyEnvVar || 'OPENAI_API_KEY';

  return `
/* ============================================================
 * OPENAI PROVIDER
 * Set ${apiKey} environment variable before running
 * ============================================================ */

const ${apiKey} = process.env.${apiKey};
if (!${apiKey}) {
  throw new Error('Missing ${apiKey} environment variable');
}

const _defaultLlmProvider: LLMProvider = {
  async chat(messages, options) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${${apiKey}}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model ?? '${model}',
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.toolCallId && { tool_call_id: m.toolCallId }),
        })),
        tools: options?.tools?.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(\`OpenAI API error: \${response.status} \${error}\`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    return {
      content: choice.message.content,
      toolCalls: choice.message.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })) ?? [],
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
    };
  },
};

const llmProvider: LLMProvider = (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ ?? _defaultLlmProvider;
`;
}

export function generateAnthropicProvider(opts: ProviderCodeOptions): string {
  const model = opts.model || 'claude-3-5-sonnet-20241022';
  const apiKey = opts.apiKeyEnvVar || 'ANTHROPIC_API_KEY';

  return `
/* ============================================================
 * ANTHROPIC PROVIDER
 * Set ${apiKey} environment variable before running
 * ============================================================ */

const ${apiKey} = process.env.${apiKey};
if (!${apiKey}) {
  throw new Error('Missing ${apiKey} environment variable');
}

const _defaultLlmProvider: LLMProvider = {
  async chat(messages, options) {
    // Separate system message (Anthropic handles it differently)
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ${apiKey},
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model ?? '${model}',
        max_tokens: options?.maxTokens ?? 4096,
        system: systemMessage?.content ?? options?.systemPrompt,
        messages: chatMessages.map(m => {
          if (m.role === 'tool') {
            return {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
            };
          }
          return { role: m.role, content: m.content };
        }),
        tools: options?.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: { type: 'object', properties: t.parameters.properties, required: t.parameters.required },
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(\`Anthropic API error: \${response.status} \${error}\`);
    }

    const data = await response.json();

    let content: string | null = null;
    const toolCalls: LLMToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') content = block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
      }
    }

    return {
      content,
      toolCalls,
      finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    };
  },
};

const llmProvider: LLMProvider = (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ ?? _defaultLlmProvider;
`;
}

export function generateOllamaProvider(opts: ProviderCodeOptions): string {
  const model = opts.model || 'llama3.2';

  return `
/* ============================================================
 * OLLAMA PROVIDER (Local)
 * Ensure Ollama is running: ollama serve
 * Pull model first: ollama pull ${model}
 * ============================================================ */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

const _defaultLlmProvider: LLMProvider = {
  async chat(messages, options) {
    const response = await fetch(\`\${OLLAMA_BASE_URL}/api/chat\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model ?? '${model}',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: options?.temperature,
          num_predict: options?.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(\`Ollama error: \${response.status} \${error}\`);
    }

    const data = await response.json();

    return {
      content: data.message?.content ?? null,
      toolCalls: [], // Ollama tool support varies by model
      finishReason: 'stop',
    };
  },
};

const llmProvider: LLMProvider = (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ ?? _defaultLlmProvider;
`;
}

export function generateMockProvider(): string {
  return `
/* ============================================================
 * MOCK PROVIDER (For Testing)
 * Replace with real provider for production use
 * ============================================================ */

const _defaultLlmProvider: LLMProvider = {
  async chat(messages, options) {
    const last = messages[messages.length - 1];

    // Simulate tool call if message contains "search"
    if (options?.tools && last.content.toLowerCase().includes('search')) {
      return {
        content: null,
        toolCalls: [{
          id: 'call_' + Date.now(),
          name: 'search',
          arguments: { query: last.content },
        }],
        finishReason: 'tool_calls',
      };
    }

    return {
      content: '[Mock response] ' + last.content,
      toolCalls: [],
      finishReason: 'stop',
    };
  },
};

const llmProvider: LLMProvider = (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ ?? _defaultLlmProvider;
`;
}

export function getProviderCode(provider: string, model?: string): string {
  const opts = { model: model || '' };

  switch (provider) {
    case 'openai':
      return generateOpenAIProvider({ ...opts, model: model || 'gpt-4o' });
    case 'anthropic':
      return generateAnthropicProvider({
        ...opts,
        model: model || 'claude-3-5-sonnet-20241022',
      });
    case 'ollama':
      return generateOllamaProvider({ ...opts, model: model || 'llama3.2' });
    case 'mock':
    default:
      return generateMockProvider();
  }
}
