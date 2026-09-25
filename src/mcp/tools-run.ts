import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createLocalCoordinator,
  defaultRunsDir,
  type LocalCoordinator,
  type ResolveInput,
} from '../coordinator/index.js';
import { makeErrorResult, makeToolResult } from './response-utils.js';

/**
 * Coordinated workflow runs for an AI assistant.
 *
 * The stateless primitives (`runWorkflow` / `resumeWorkflow` in
 * tools-workflow-run.ts) hand the caller the whole continuation envelope and
 * expect it back. That is right for a coordinator and hopeless for a
 * language model, which would carry ~800 tokens of addresses and variables
 * per gate in each direction. These three tools put a local coordinator in
 * between so the assistant only ever sees `{ runId, gate }` and answers with
 * `{ runId, answer }`.
 *
 * Nothing here returns trace events, progress, or the envelope. Fewer tokens
 * is the point.
 */
export function registerRunTools(
  mcp: McpServer,
  injectedCoordinator?: LocalCoordinator,
): void {
  // The store follows the workflow FILE, not this process's working directory.
  // A run started by this MCP server must land in <projectRoot>/.fw/runs so the
  // console — opened on the same project, possibly from a different directory —
  // sees it. We resolve one coordinator per runs-dir and reuse it.
  //
  // A test (or an embedder) can inject a single coordinator, which then backs
  // every tool regardless of file — preserving the old single-store behaviour.
  const byDir = new Map<string, LocalCoordinator>();
  function coordinatorForFile(filePath: string): LocalCoordinator {
    if (injectedCoordinator) return injectedCoordinator;
    const dir = defaultRunsDir(filePath);
    let coord = byDir.get(dir);
    if (!coord) {
      coord = createLocalCoordinator({ rootDir: dir });
      byDir.set(dir, coord);
    }
    return coord;
  }

  /**
   * Every coordinator this session might hold a run in: the injected one, or
   * each project store touched so far. `fw_resume` and an unfiltered `fw_runs`
   * only have a runId, so they search across these. A fresh server has
   * touched nothing yet, but the project it was started in still holds the
   * runs of the last session, so that store is always in the set.
   */
  function allCoordinators(): LocalCoordinator[] {
    if (injectedCoordinator) return [injectedCoordinator];
    if (byDir.size === 0) coordinatorForFile(path.join(process.cwd(), 'workflow.ts'));
    return [...byDir.values()];
  }

  /** Find the coordinator whose store holds `runId`, if any. */
  async function coordinatorForRun(runId: string): Promise<LocalCoordinator | undefined> {
    for (const coord of allCoordinators()) {
      const view = await coord.get(runId).catch(() => undefined);
      if (view) return coord;
    }
    return undefined;
  }

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
        const coordinator = coordinatorForFile(args.filePath);
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
        .describe('For a single-output gate, the value. For multi-output, an object with every output'),
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
        const coordinator = (await coordinatorForRun(args.runId)) ?? allCoordinators()[0];
        if (!coordinator) return makeErrorResult('RUN_NOT_FOUND', `no run with id ${args.runId}`);
        return makeToolResult(await coordinator.resume({ runId: args.runId, input }));
      } catch (error) {
        return toErrorResult(error, 'RESUME_ERROR');
      }
    },
  );

  mcp.tool(
    'fw_runs',
    'List runs (newest first, 20 by default), or inspect one. With runId returns the full gate so you can re-read a pause without resuming. A run whose sleep or timeout has passed is moved on first.',
    {
      runId: z.string().optional(),
      filePath: z.string().optional().describe('Only runs of this workflow file'),
      status: z.enum(['waiting', 'completed', 'failed', 'cancelled']).optional().describe('Only runs in this state. waiting is the one that needs you'),
      limit: z.number().int().min(1).max(200).optional().describe('How many, newest first. Default 20'),
    },
    async (args: { runId?: string; filePath?: string; status?: 'waiting' | 'completed' | 'failed' | 'cancelled'; limit?: number }) => {
      // Which stores to look in: the one for a named file, the one holding a
      // named run, or — with neither — every project store touched this session.
      const coordinators = args.filePath
        ? [coordinatorForFile(args.filePath)]
        : args.runId
          ? await coordinatorForRun(args.runId).then((c) => (c ? [c] : allCoordinators()))
          : allCoordinators();

      // The MCP server has no clock of its own running. A look at the runs
      // is the moment to let time act, so a sleep that is over is not shown
      // as waiting.
      await Promise.all(coordinators.map((c) => c.tick().catch(() => undefined)));

      if (args.runId) {
        for (const c of coordinators) {
          const view = await c.get(args.runId).catch(() => undefined);
          if (view) return makeToolResult(view);
        }
        return makeErrorResult('RUN_NOT_FOUND', `no run with id ${args.runId}`);
      }

      // Runs across the touched project stores; an assistant asking "what is
      // there" wants the recent ones, not a history dump.
      const lists = await Promise.all(
        coordinators.map((c) => c.list({ filePath: args.filePath }).catch(() => []))
      );
      const all = lists
        .flat()
        .filter((r) => !args.status || r.status === args.status)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const limit = args.limit ?? 20;
      const runs = all.slice(0, limit);
      return makeToolResult(all.length > limit ? { runs, total: all.length, note: `${all.length - limit} older run(s) not shown. Pass limit, status or filePath to narrow` } : runs);
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
              : name === 'MissingParamsError'
                ? 'MISSING_PARAMS'
              : name === 'MissingOutputsError'
                ? 'MISSING_OUTPUTS'
                : name === 'InvalidAnswerError'
                  ? 'INVALID_INPUT'
                  : refusal?.reason === 'ambiguous-effect'
                    ? 'AMBIGUOUS_EFFECT'
                    : fallback;
  return makeErrorResult(code, message);
}
