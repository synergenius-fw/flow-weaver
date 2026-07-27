import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  executeWorkflow,
  type WorkflowExecutionOutcome,
} from './workflow-executor.js';
import { makeErrorResult, makeToolResult } from './response-utils.js';
import { validateWireValue, type WireValue } from '../runtime/continuation.js';

/** Execute a new durable run. No process or Promise is retained after a yield. */
export async function runWorkflow(
  filePath: string,
  params: Record<string, unknown>,
  workflowName?: string,
  runId: string = randomUUID(),
  bundleDigest?: string,
): Promise<WorkflowExecutionOutcome> {
  return executeWorkflow({
    runId,
    bundleDigest,
    filePath,
    params,
    workflowName,
    includeTrace: true,
  });
}

/** Resume from coordinator-owned continuation data and one exact resolution. */
export async function resumeWorkflow(
  runId: string,
  filePath: string,
  continuation: unknown,
  gateId: string,
  resolution: WireValue,
  params: Record<string, unknown> = {},
  workflowName?: string,
  bundleDigest?: string,
): Promise<WorkflowExecutionOutcome> {
  return executeWorkflow({
    runId,
    bundleDigest,
    filePath,
    params,
    workflowName,
    continuation,
    resolution: { gateId, value: resolution },
    includeTrace: true,
  });
}

export function registerWorkflowRunTools(mcp: McpServer): void {
  mcp.tool(
    'fw_workflow_run',
    'Run a workflow until completion or a durable approval, input, or agent gate.',
    {
      filePath: z.string().describe('Path to the workflow .ts file'),
      params: z.record(z.string(), z.unknown()).optional(),
      workflowName: z.string().optional(),
      runId: z.string().optional().describe('Stable run identity; generated when omitted'),
      bundleDigest: z.string().optional().describe('Verified sha256 identity of the executable bundle'),
    },
    async (args: {
      filePath: string;
      params?: Record<string, unknown>;
      workflowName?: string;
      runId?: string;
      bundleDigest?: string;
    }) => {
      try {
        return makeToolResult(
          await runWorkflow(
            args.filePath,
            args.params ?? {},
            args.workflowName,
            args.runId,
            args.bundleDigest,
          ),
        );
      } catch (error) {
        return makeErrorResult(
          'EXECUTION_ERROR',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );

  mcp.tool(
    'fw_workflow_resume',
    'Resume one exact durable gate continuation. The prior executor is not retained.',
    {
      runId: z.string(),
      filePath: z.string(),
      continuation: z.unknown(),
      gateId: z.string(),
      resolution: z.record(z.string(), z.unknown()),
      params: z.record(z.string(), z.unknown()).optional(),
      workflowName: z.string().optional(),
      bundleDigest: z.string(),
    },
    async (args: {
      runId: string;
      filePath: string;
      continuation: unknown;
      gateId: string;
      resolution: Record<string, unknown>;
      params?: Record<string, unknown>;
      workflowName?: string;
      bundleDigest: string;
    }) => {
      try {
        validateWireValue(args.resolution);
        return makeToolResult(
          await resumeWorkflow(
            args.runId,
            args.filePath,
            args.continuation,
            args.gateId,
            args.resolution,
            args.params,
            args.workflowName,
            args.bundleDigest,
          ),
        );
      } catch (error) {
        return makeErrorResult(
          'RESUME_ERROR',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );
}
