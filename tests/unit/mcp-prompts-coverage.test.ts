import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPrompts } from '../../src/mcp/prompts';

type PromptHandler = () => { messages: Array<{ role: string; content: { type: string; text: string } }> };

let capturedName: string;
let capturedConfig: { title: string; description: string };
let capturedHandler: PromptHandler;

function createMockMcp(): McpServer {
  return {
    registerPrompt: vi.fn().mockImplementation(
      (name: string, config: { title: string; description: string }, handler: PromptHandler) => {
        capturedName = name;
        capturedConfig = config;
        capturedHandler = handler;
      }
    ),
  } as unknown as McpServer;
}

describe('registerPrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mcp = createMockMcp();
    registerPrompts(mcp);
  });

  it('registers the flow-weaver-nocode prompt', () => {
    expect(capturedName).toBe('flow-weaver-nocode');
  });

  it('provides a title and description', () => {
    expect(capturedConfig.title).toBe('Flow Weaver No-Code Mode');
    expect(capturedConfig.description).toContain('plain language');
  });

  it('returns a single assistant message with the system prompt', () => {
    const result = capturedHandler();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].content.type).toBe('text');
  });

  it('system prompt covers key topics', () => {
    const text = capturedHandler().messages[0].content.text;
    expect(text).toContain('workflow developer');
    expect(text).toContain('fw_create_model');
    expect(text).toContain('fw_validate');
    expect(text).toContain('fw_diagram');
    expect(text).toContain('.ts extension');
  });
});
