import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createLocalCoordinator,
  type LocalCoordinator,
  type ResolveInput,
} from '../coordinator/index.js';
import { makeErrorResult, makeToolResult } from './response-utils.js';

/**
 * Coordinated workflow runs for an AI assistant.
 *
 * `fw_workflow_run` / `fw_workflow_resume` are the stateless primitives: they
 * hand the caller the whole continuation envelope and expect it back. That
 * is correct for a real coordinator and hopeless for a language model, which
 * would carry ~800 tokens of addresses and variables per gate in each
 * direction. These three tools put a local coordinator in between so the
 * assistant only ever sees `{ runId, gate }` and answers with
 * `{ runId, answer }`.
 *
 * Nothing here returns trace events, progress, or the envelope. Fewer tokens
 * is the point.
 */
export function registerRunTools(
  mcp: McpServer,
  coordinator: LocalCoordinator = createLocalCoordinator(),
): void {
  mcp.tool(
    'fw_run',
    'Run a workflow. Returns the result, or pauses at the first gate and returns {runId, gate}. Continue with fw_resume.',
    {
      filePath: z.string().describe('Workflow .ts file'),
      workflowName: z.string().optional().describe('Export name if the file has several'),
      params: z.record(z.string(), z.unknown()).optional(),
    },
    async (args: { filePath: string; workflowName?: string; params?: Record<string, unknown> }) => {
      try {
        return makeToolResult(await coordinator.start({ ...args, origin: 'mcp' }));
      } catch (error) {
        return toErrorResult(error, 'EXECUTION_ERROR');
      }
    },
  );

  mcp.tool(
    'fw_resume',
    "Continue a paused run. Give exactly one of answer (the gate's result) or reject (a reason).",
    {
      runId: z.string(),
      answer: z
        .unknown()
        .optional()
        .describe('For a single-output gate, the value; for multi-output, an object with every output'),
      reject: z.string().optional().describe('Fail the gate with this reason'),
    },
    async (args: { runId: string; answer?: unknown; reject?: string }) => {
      const hasAnswer = 'answer' in args && args.answer !== undefined;
      const hasReject = typeof args.reject === 'string';
      if (hasAnswer === hasReject) {
        return makeErrorResult('INVALID_INPUT', 'give exactly one of answer or reject');
      }
      const input: ResolveInput = hasReject ? { reject: args.reject as string } : { answer: args.answer };
      try {
        return makeToolResult(await coordinator.resume({ runId: args.runId, input }));
      } catch (error) {
        return toErrorResult(error, 'RESUME_ERROR');
      }
    },
  );

  mcp.tool(
    'fw_runs',
    'List runs, or inspect one. With runId returns the full gate so you can re-read a pause without resuming.',
    {
      runId: z.string().optional(),
      filePath: z.string().optional().describe('Only runs of this workflow file'),
    },
    async (args: { runId?: string; filePath?: string }) => {
      if (args.runId) {
        const view = await coordinator.get(args.runId);
        return view ? makeToolResult(view) : makeErrorResult('RUN_NOT_FOUND', `no run with id ${args.runId}`);
      }
      return makeToolResult(await coordinator.list({ filePath: args.filePath }));
    },
  );
}

function toErrorResult(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const refusal = (error as { refusal?: { reason?: string } }).refusal;

  const code =
    name === 'ParseError'
      ? 'PARSE_ERROR'
      : name === 'AmbiguousWorkflowError'
        ? 'AMBIGUOUS_WORKFLOW'
        : name === 'RunNotFoundError'
          ? 'RUN_NOT_FOUND'
          : name === 'RunNotWaitingError'
            ? 'RUN_NOT_WAITING'
            : name === 'BundleChangedError'
              ? 'BUNDLE_CHANGED'
              : name === 'RunBusyError'
                ? 'RUN_BUSY'
              : name === 'MissingOutputsError'
                ? 'MISSING_OUTPUTS'
                : name === 'InvalidAnswerError'
                  ? 'INVALID_INPUT'
                  : refusal?.reason === 'ambiguous-effect'
                    ? 'AMBIGUOUS_EFFECT'
                    : fallback;
  return makeErrorResult(code, message);
}
