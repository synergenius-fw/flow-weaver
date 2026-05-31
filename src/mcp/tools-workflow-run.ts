/**
 * MCP tools for running workflows with waitForAgent pause/resume support.
 *
 * fw_workflow_run: Starts a workflow. If it hits waitForAgent, returns the
 * agent request to the MCP caller (e.g. Claude Code) with status "waiting_for_agent".
 * If the workflow completes without pausing, returns the result directly.
 *
 * fw_workflow_resume: Resumes a paused workflow with the agent's result.
 * Returns the final workflow result (or pauses again if another waitForAgent is hit).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeWorkflowFromFile } from './workflow-executor.js';
import { AgentChannel } from './agent-channel.js';
import {
  storePendingRun,
  getPendingRun,
  removePendingRun,
  type PendingRun,
} from './run-registry.js';

function makeToolResult(data: object) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function makeErrorResult(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Race between workflow completion and agent pause.
 * Returns whichever happens first.
 */
async function raceAgentPause(
  executionPromise: Promise<unknown>,
  agentChannel: AgentChannel,
): Promise<
  | { type: 'completed'; result: unknown }
  | { type: 'waiting_for_agent'; request: object }
  | { type: 'error'; message: string }
> {
  try {
    const outcome = await Promise.race([
      executionPromise.then((r) => ({
        type: 'completed' as const,
        result: (r as { result?: unknown })?.result ?? r,
      })),
      agentChannel.onPause().then((request) => ({
        type: 'waiting_for_agent' as const,
        request,
      })),
    ]);
    return outcome;
  } catch (err) {
    return {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Exposed for testing — run workflow with pause/resume support */
export async function runWorkflowWithAgent(
  filePath: string,
  params: Record<string, unknown>,
  workflowName?: string,
): Promise<
  | { status: 'completed'; result: unknown }
  | { status: 'waiting_for_agent'; runId: string; agentRequest: object; agentChannel: AgentChannel }
  | { status: 'error'; message: string }
> {
  const agentChannel = new AgentChannel();
  const runId = generateRunId();

  const executionPromise = executeWorkflowFromFile(
    filePath,
    params,
    {
      workflowName,
      agentChannel,
      includeTrace: true,
    },
  );

  const outcome = await raceAgentPause(executionPromise, agentChannel);

  if (outcome.type === 'completed') {
    return { status: 'completed', result: outcome.result };
  }

  if (outcome.type === 'waiting_for_agent') {
    storePendingRun({
      runId,
      filePath,
      workflowName,
      executionPromise,
      agentChannel,
      request: outcome.request,
      createdAt: Date.now(),
      tmpFiles: [],
    });
    return { status: 'waiting_for_agent', runId, agentRequest: outcome.request, agentChannel };
  }

  return { status: 'error', message: outcome.message };
}

/** Exposed for testing — resume a paused workflow with agent result */
export async function resumeWorkflow(
  runId: string,
  agentResult: Record<string, unknown>,
): Promise<
  | { status: 'completed'; result: unknown }
  | { status: 'waiting_for_agent'; runId: string; agentRequest: object; agentChannel: AgentChannel }
  | { status: 'error'; message: string }
> {
  const pendingRun = getPendingRun(runId);
  if (!pendingRun) {
    return { status: 'error', message: `No pending run found with ID "${runId}".` };
  }

  pendingRun.agentChannel.resume(agentResult);

  const outcome = await raceAgentPause(pendingRun.executionPromise, pendingRun.agentChannel);

  if (outcome.type === 'completed') {
    removePendingRun(runId);
    return { status: 'completed', result: outcome.result };
  }

  if (outcome.type === 'waiting_for_agent') {
    pendingRun.request = outcome.request;
    return { status: 'waiting_for_agent', runId, agentRequest: outcome.request, agentChannel: pendingRun.agentChannel };
  }

  removePendingRun(runId);
  return { status: 'error', message: outcome.message };
}

export function registerWorkflowRunTools(mcp: McpServer): void {
  // -------------------------------------------------------------------------
  // fw_workflow_run - Start a workflow, pause at waitForAgent
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_workflow_run',
    'Run a workflow. If it hits a waitForAgent node, returns the agent request so ' +
      'you can respond. If it completes without pausing, returns the result directly.',
    {
      filePath: z.string().describe('Path to the workflow .ts file'),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Input parameters for the workflow'),
      workflowName: z
        .string()
        .optional()
        .describe('Specific workflow export name (for multi-workflow files)'),
    },
    async (args: { filePath: string; params?: Record<string, unknown>; workflowName?: string }) => {
      try {
        const result = await runWorkflowWithAgent(
          args.filePath,
          args.params ?? {},
          args.workflowName,
        );

        if (result.status === 'error') {
          return makeErrorResult('EXECUTION_ERROR', result.message);
        }

        // Don't leak agentChannel to MCP output
        const { agentChannel: _ac, ...output } = result as any;
        return makeToolResult(output);
      } catch (err) {
        return makeErrorResult(
          'EXECUTION_ERROR',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // fw_workflow_resume - Resume a paused workflow with agent result
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_workflow_resume',
    'Resume a workflow that paused at waitForAgent. Provide the agent result to continue execution.',
    {
      runId: z.string().describe('Run ID from fw_workflow_run'),
      agentResult: z
        .record(z.string(), z.unknown())
        .describe('The agent result to pass back to the workflow'),
    },
    async (args: { runId: string; agentResult: Record<string, unknown> }) => {
      try {
        const result = await resumeWorkflow(args.runId, args.agentResult);

        if (result.status === 'error') {
          return makeErrorResult('RESUME_ERROR', result.message);
        }

        const { agentChannel: _ac, ...output } = result as any;
        return makeToolResult(output);
      } catch (err) {
        return makeErrorResult(
          'RESUME_ERROR',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );
}
