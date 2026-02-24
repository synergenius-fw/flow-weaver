/**
 * Tests for the waitForAgent built-in node and AgentChannel pause/resume mechanism.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentChannel } from '../../src/mcp/agent-channel';
import { waitForAgent } from '../../src/built-in-nodes/wait-for-agent';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

// Inline waitForAgent definition for integration tests.
// Must be inlined because executeWorkflowFromFile copies to temp dir.
const WAIT_FOR_AGENT_DEF = `
/**
 * @flowWeaver nodeType
 * @input [agentId] - Agent/task identifier
 * @input context - Context data to send to the agent
 * @input [prompt] - Message to display when requesting input
 * @output agentResult - Result returned by the agent
 */
async function waitForAgent(
  execute: boolean,
  agentId: string,
  context: object,
  prompt?: string
): Promise<{ onSuccess: boolean; onFailure: boolean; agentResult: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, agentResult: {} };

  const mocks = (globalThis as any).__fw_mocks__;
  if (mocks?.agents?.[agentId]) {
    return { onSuccess: true, onFailure: false, agentResult: mocks.agents[agentId] };
  }
  if (mocks?.agents) {
    return { onSuccess: false, onFailure: true, agentResult: {} };
  }

  const channel = (globalThis as any).__fw_agent_channel__;
  if (channel) {
    const result = await channel.request({ agentId, context, prompt });
    return { onSuccess: true, onFailure: false, agentResult: result };
  }

  return { onSuccess: true, onFailure: false, agentResult: {} };
}
`;

describe('AgentChannel', () => {
  it('should pause and resume', async () => {
    const channel = new AgentChannel();

    // Start a request (simulates what the waitForAgent node does)
    const requestPromise = channel.request({ task: 'review', code: 'console.log("hi")' });

    // Executor detects the pause
    const pauseData = await channel.onPause();
    expect(pauseData).toEqual({ task: 'review', code: 'console.log("hi")' });

    // Agent sends result back
    channel.resume({ approved: true, comments: 'LGTM' });

    // The request resolves with the agent's result
    const result = await requestPromise;
    expect(result).toEqual({ approved: true, comments: 'LGTM' });
  });

  it('should reject on fail', async () => {
    const channel = new AgentChannel();

    const requestPromise = channel.request({ task: 'fix-bug' });
    await channel.onPause();

    channel.fail('Agent timeout');

    await expect(requestPromise).rejects.toThrow('Agent timeout');
  });

  it('should handle multiple sequential pauses', async () => {
    const channel = new AgentChannel();

    // First pause/resume cycle
    const req1 = channel.request({ task: 'step-1' });
    const pause1 = await channel.onPause();
    expect(pause1).toEqual({ task: 'step-1' });
    channel.resume({ result: 'first' });
    const result1 = await req1;
    expect(result1).toEqual({ result: 'first' });

    // Second pause/resume cycle (same channel, new pause promise)
    const req2 = channel.request({ task: 'step-2' });
    const pause2 = await channel.onPause();
    expect(pause2).toEqual({ task: 'step-2' });
    channel.resume({ result: 'second' });
    const result2 = await req2;
    expect(result2).toEqual({ result: 'second' });
  });
});

describe('waitForAgent node', () => {
  afterEach(() => {
    delete (globalThis as any).__fw_mocks__;
    delete (globalThis as any).__fw_agent_channel__;
  });

  it('should return mock data when mocks are configured', async () => {
    (globalThis as any).__fw_mocks__ = {
      agents: { review: { approved: true, feedback: 'Looks good' } },
    };

    const result = await waitForAgent(true, 'review', { code: 'console.log("hi")' });
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      agentResult: { approved: true, feedback: 'Looks good' },
    });
  });

  it('should return no-op when no mocks and no channel', async () => {
    const result = await waitForAgent(true, 'review', { code: 'test' });
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      agentResult: {},
    });
  });

  it('should not execute when execute=false', async () => {
    const result = await waitForAgent(false, 'review', { code: 'test' });
    expect(result).toEqual({
      onSuccess: false,
      onFailure: false,
      agentResult: {},
    });
  });

  it('should pause on agent channel and resume with result', async () => {
    const channel = new AgentChannel();
    (globalThis as any).__fw_agent_channel__ = channel;

    const nodePromise = waitForAgent(true, 'review', { code: 'test' });

    // Executor detects pause
    const request = await channel.onPause();
    expect(request).toEqual({ agentId: 'review', context: { code: 'test' }, prompt: undefined });

    // Resume with agent result
    channel.resume({ approved: true });

    const result = await nodePromise;
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      agentResult: { approved: true },
    });
  });

  it('should include prompt in channel request', async () => {
    const channel = new AgentChannel();
    (globalThis as any).__fw_agent_channel__ = channel;

    const nodePromise = waitForAgent(true, 'review', { code: 'test' }, 'Please review this code');
    const request = await channel.onPause();
    expect(request).toEqual({
      agentId: 'review',
      context: { code: 'test' },
      prompt: 'Please review this code',
    });

    channel.resume({ approved: true });
    await nodePromise;
  });

  it('should omit prompt from request when not provided', async () => {
    const channel = new AgentChannel();
    (globalThis as any).__fw_agent_channel__ = channel;

    const nodePromise = waitForAgent(true, 'review', { code: 'test' });
    const request = await channel.onPause();
    expect(request).toEqual({
      agentId: 'review',
      context: { code: 'test' },
      prompt: undefined,
    });

    channel.resume({ ok: true });
    await nodePromise;
  });
});

describe('waitForAgent executor integration', () => {
  it('should detect pause and return waiting status', async () => {
    const source = `
${WAIT_FOR_AGENT_DEF}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - string
 */
export async function processResult(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: String(data) + '-done' };
}

/**
 * @flowWeaver workflow
 * @param task - string
 * @returns {string} processed - Processed result
 * @node agent waitForAgent
 * @node proc processResult
 * @connect Start.task -> agent.context
 * @connect agent.agentResult -> proc.data
 * @connect proc.processed -> Exit.processed
 */
export async function agentWorkflow(execute: boolean, params: { task: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; processed: string;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'wait-for-agent-pause.ts');
    fs.writeFileSync(testFile, source);

    try {
      const channel = new AgentChannel();

      const resultPromise = executeWorkflowFromFile(testFile, { task: 'review code' }, {
        workflowName: 'agentWorkflow',
        agentChannel: channel,
      });

      // Wait for the workflow to pause
      const request = await channel.onPause();
      expect(request).toHaveProperty('agentId');
      expect(request).toHaveProperty('context');

      // Resume the workflow
      channel.resume({ feedback: 'approved' });

      const result = await resultPromise;
      expect(result.functionName).toBe('agentWorkflow');
      expect(result.result).toBeDefined();
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });

  it('should complete normally when workflow has no waitForAgent', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function doubleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} doubled - Doubled value
 * @node d doubleIt
 * @connect Start.num -> d.value
 * @connect d.doubled -> Exit.doubled
 */
export async function simpleWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'wait-for-agent-no-pause.ts');
    fs.writeFileSync(testFile, source);

    try {
      const channel = new AgentChannel();

      const result = await executeWorkflowFromFile(testFile, { num: 5 }, {
        workflowName: 'simpleWorkflow',
        agentChannel: channel,
      });

      // Should complete normally without pausing
      expect(result.functionName).toBe('simpleWorkflow');
      const workflowResult = result.result as { doubled: number };
      expect(workflowResult.doubled).toBe(10);
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });

  it('should handle multiple sequential waitForAgent nodes', async () => {
    const source = `
${WAIT_FOR_AGENT_DEF}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output formatted - string
 */
export async function formatResult(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, formatted: JSON.stringify(data) };
}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {string} formatted - Final result
 * @node agent1 waitForAgent
 * @node agent2 waitForAgent
 * @node fmt formatResult
 * @connect Start.input -> agent1.context
 * @connect agent1.agentResult -> agent2.context
 * @connect agent2.agentResult -> fmt.data
 * @connect fmt.formatted -> Exit.formatted
 */
export async function multiAgentWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; formatted: string;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'wait-for-agent-multi.ts');
    fs.writeFileSync(testFile, source);

    try {
      const channel = new AgentChannel();

      const resultPromise = executeWorkflowFromFile(testFile, { input: 'start' }, {
        workflowName: 'multiAgentWorkflow',
        agentChannel: channel,
      });

      // First pause — agent1
      const req1 = await channel.onPause();
      expect(req1).toHaveProperty('agentId');
      channel.resume({ step1: 'done' });

      // Second pause — agent2
      const req2 = await channel.onPause();
      expect(req2).toHaveProperty('agentId');
      channel.resume({ step2: 'complete' });

      const result = await resultPromise;
      expect(result.functionName).toBe('multiAgentWorkflow');
      expect(result.result).toBeDefined();
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });
});
