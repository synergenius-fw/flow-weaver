/**
 * Tests for fw_workflow_run and fw_workflow_resume MCP tools.
 *
 * These tools allow running a workflow via MCP where waitForAgent pauses
 * the workflow and returns control to the MCP caller (e.g. Claude Code).
 * The caller then responds via fw_workflow_resume to continue execution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Inline waitForAgent for integration tests (executor copies to temp dir)
// ---------------------------------------------------------------------------
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

const SIMPLE_WORKFLOW = `
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

const AGENT_WORKFLOW = `
${WAIT_FOR_AGENT_DEF}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - string
 */
export async function processResult(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: String(JSON.stringify(data)) + '-done' };
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

// ---------------------------------------------------------------------------
// Fake MCP server (same pattern as mcp-tools-debug-coverage.test.ts)
// ---------------------------------------------------------------------------
function createFakeMcpServer() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const mcp = {
    tool: (name: string, _description: string, _schema: any, handler: (args: any) => Promise<any>) => {
      tools[name] = handler;
    },
  };
  return { mcp, tools };
}

function parseToolResult(result: any): any {
  const text = result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fw_workflow_run and fw_workflow_resume MCP tools', () => {
  let outputDir: string;

  beforeAll(() => {
    outputDir = global.testHelpers?.outputDir ?? path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  });

  // Lazy-load registerWorkflowRunTools to avoid import errors if it doesn't exist yet
  async function loadTools() {
    const { registerWorkflowRunTools } = await import('../../src/mcp/tools-workflow-run.js');
    const { mcp, tools } = createFakeMcpServer();
    registerWorkflowRunTools(mcp as any);
    return tools;
  }

  it('DEBUG: direct executor with AgentChannel should pause', async () => {
    // Same as wait-for-agent.test.ts "should detect pause" but in this file
    const { AgentChannel } = await import('../../src/mcp/agent-channel.js');
    const { executeWorkflow } = await import('../../src/mcp/workflow-executor.js');

    const testFile = path.join(outputDir, 'wfrun-debug-direct.ts');
    fs.writeFileSync(testFile, AGENT_WORKFLOW);

    try {
      const channel = new AgentChannel();

      const resultPromise = executeWorkflow({ filePath: testFile, params: { task: 'review code' }, workflowName: 'agentWorkflow', agentChannel: channel });

      const request = await channel.onPause();
      expect(request).toHaveProperty('agentId');
      expect(request).toHaveProperty('context');

      channel.resume({ feedback: 'approved' });
      const result = await resultPromise;
      expect(result.functionName).toBe('agentWorkflow');
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });

  it('DEBUG: raceAgentPause should detect pause', async () => {
    const { AgentChannel } = await import('../../src/mcp/agent-channel.js');
    const { executeWorkflow } = await import('../../src/mcp/workflow-executor.js');

    const testFile = path.join(outputDir, 'wfrun-debug-race.ts');
    fs.writeFileSync(testFile, AGENT_WORKFLOW);

    try {
      const channel = new AgentChannel();

      const execPromise = executeWorkflow({ filePath: testFile, params: { task: 'review code' }, workflowName: 'agentWorkflow', agentChannel: channel });

      // This is exactly what raceAgentPause does
      const outcome = await Promise.race([
        execPromise.then((r) => ({
          type: 'completed' as const,
          result: (r as { result?: unknown })?.result ?? r,
        })),
        channel.onPause().then((request) => ({
          type: 'waiting_for_agent' as const,
          request,
        })),
      ]);

      expect(outcome.type).toBe('waiting_for_agent');

      if (outcome.type === 'waiting_for_agent') {
        channel.resume({ feedback: 'ok' });
        await execPromise;
      }
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });

  it('DEBUG: runWorkflowWithAgent from tool module should pause', async () => {
    const { runWorkflowWithAgent } = await import('../../src/mcp/tools-workflow-run.js');

    const testFile = path.join(outputDir, 'wfrun-debug-fn.ts');
    fs.writeFileSync(testFile, AGENT_WORKFLOW);

    try {
      const result = await runWorkflowWithAgent(testFile, { task: 'review code' }, 'agentWorkflow');

      if (result.status === 'completed') {
        throw new Error('runWorkflowWithAgent returned completed: ' + JSON.stringify(result.result));
      }
      if (result.status === 'error') {
        throw new Error('runWorkflowWithAgent returned error: ' + result.message);
      }

      expect(result.status).toBe('waiting_for_agent');
      expect(result.agentRequest).toBeDefined();

      // Resume
      result.agentChannel.resume({ feedback: 'ok' });
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });

  it('should register fw_workflow_run and fw_workflow_resume tools', async () => {
    const tools = await loadTools();
    expect(tools).toHaveProperty('fw_workflow_run');
    expect(tools).toHaveProperty('fw_workflow_resume');
  });

  it('should complete immediately for workflows without waitForAgent', async () => {
    const tools = await loadTools();
    const testFile = path.join(outputDir, 'wfrun-simple.ts');
    fs.writeFileSync(testFile, SIMPLE_WORKFLOW);

    try {
      const result = parseToolResult(
        await tools.fw_workflow_run({ filePath: testFile, params: { num: 5 } }),
      );

      expect(result.status).toBe('completed');
      expect(result.result).toBeDefined();
      expect(result.result.onSuccess).toBe(true);
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });

  it('should pause at waitForAgent and return the agent request', async () => {
    const { runWorkflowWithAgent } = await import('../../src/mcp/tools-workflow-run.js');
    const testFile = path.join(outputDir, 'wfrun-pause.ts');
    fs.writeFileSync(testFile, AGENT_WORKFLOW);

    try {
      const result = await runWorkflowWithAgent(testFile, { task: 'review code' }, 'agentWorkflow');

      expect(result.status).toBe('waiting_for_agent');
      if (result.status === 'waiting_for_agent') {
        expect(result.runId).toBeDefined();
        expect(result.agentRequest).toBeDefined();
        expect((result.agentRequest as any).context).toBe('review code');
        // Clean up
        result.agentChannel.resume({ feedback: 'ok' });
      }
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });

  it('should resume a paused workflow and return the final result', async () => {
    const { runWorkflowWithAgent, resumeWorkflow } = await import('../../src/mcp/tools-workflow-run.js');
    const testFile = path.join(outputDir, 'wfrun-resume.ts');
    fs.writeFileSync(testFile, AGENT_WORKFLOW);

    try {
      const runResult = await runWorkflowWithAgent(testFile, { task: 'review code' }, 'agentWorkflow');
      expect(runResult.status).toBe('waiting_for_agent');

      if (runResult.status === 'waiting_for_agent') {
        const resumeResult = await resumeWorkflow(runResult.runId, { approved: true, comments: 'LGTM' });
        expect(resumeResult.status).toBe('completed');
        if (resumeResult.status === 'completed') {
          expect(resumeResult.result).toBeDefined();
          expect((resumeResult.result as any).processed).toContain('done');
        }
      }
    } finally {
      try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    }
  });

  it('should return error when resuming a non-existent run', async () => {
    const tools = await loadTools();

    const result = parseToolResult(
      await tools.fw_workflow_resume({
        runId: 'non-existent-id',
        agentResult: { data: 'test' },
      }),
    );

    expect(result.error).toBeDefined();
  });

  it('should handle workflow errors gracefully', async () => {
    const tools = await loadTools();

    const result = parseToolResult(
      await tools.fw_workflow_run({
        filePath: '/non/existent/file.ts',
        params: {},
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.message).toBeDefined();
  });
});
