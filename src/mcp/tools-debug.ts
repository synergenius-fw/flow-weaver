import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { parseWorkflow } from '../api/index.js';
import { getTopologicalOrder } from '../api/query.js';
import { DebugController } from '../runtime/debug-controller.js';
import { CheckpointWriter, loadCheckpoint, findLatestCheckpoint } from '../runtime/checkpoint.js';
import { executeWorkflowFromFile } from './workflow-executor.js';
import { AgentChannel } from './agent-channel.js';
import {
  storeDebugSession,
  getDebugSession,
  removeDebugSession,
  listDebugSessions,
} from './debug-session.js';
import type { DebugSession } from './debug-session.js';
import type { DebugPauseState } from '../runtime/debug-controller.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

/**
 * Helper: get execution order for a workflow file by parsing its annotations.
 */
async function getExecutionOrder(filePath: string, workflowName?: string): Promise<string[]> {
  const source = fs.readFileSync(path.resolve(filePath), 'utf8');
  const parsed = await parseWorkflow(source, { workflowName });
  if (parsed.errors.length > 0) {
    throw new Error(`Failed to parse workflow: ${parsed.errors.join(', ')}`);
  }
  return getTopologicalOrder(parsed.ast);
}

/**
 * Helper: race execution against debug pause. Returns the outcome.
 */
async function raceDebugPause(
  session: DebugSession
): Promise<
  | { type: 'paused'; state: DebugPauseState }
  | { type: 'completed'; result: unknown }
  | { type: 'error'; message: string }
> {
  try {
    const raceResult = await Promise.race([
      session.executionPromise.then((r) => ({
        type: 'completed' as const,
        result: (r as { result?: unknown })?.result ?? r,
      })),
      session.controller.onPause().then((state) => ({
        type: 'paused' as const,
        state,
      })),
    ]);

    if (raceResult.type === 'paused') {
      session.lastPauseState = raceResult.state;
    }

    return raceResult;
  } catch (err) {
    return {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Helper: clean up a debug session after completion or abort.
 */
function cleanupDebugSession(debugId: string): void {
  const session = getDebugSession(debugId);
  if (!session) return;

  for (const tmpFile of session.tmpFiles) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }

  removeDebugSession(debugId);
}

/**
 * Helper: find the variable key for a nodeId:portName pair from the variables map.
 * Returns the full key (nodeId:portName:executionIndex) or null.
 */
function findVariableKey(
  variables: Record<string, unknown>,
  nodeId: string,
  portName: string,
  executionIndex?: number
): string | null {
  const prefix = `${nodeId}:${portName}:`;

  if (executionIndex !== undefined) {
    const key = `${prefix}${executionIndex}`;
    return key in variables ? key : null;
  }

  // Find the latest execution index for this nodeId:portName
  let latestKey: string | null = null;
  let latestIndex = -1;

  for (const key of Object.keys(variables)) {
    if (key.startsWith(prefix)) {
      const idx = parseInt(key.substring(prefix.length), 10);
      if (idx > latestIndex) {
        latestIndex = idx;
        latestKey = key;
      }
    }
  }

  return latestKey;
}

export function registerDebugTools(mcp: McpServer): void {
  // -------------------------------------------------------------------------
  // fw_debug_workflow — Start a debug session
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_debug_workflow',
    'Start a step-through debug session for a workflow. Compiles and executes the workflow, ' +
      'pausing before the first node. Returns a debugId and the initial pause state.',
    {
      filePath: z.string().describe('Path to the workflow .ts file'),
      workflowName: z.string().optional().describe('Specific workflow function name (for multi-workflow files)'),
      params: z.record(z.unknown()).optional().describe('Parameters to pass to the workflow'),
      breakpoints: z.array(z.string()).optional().describe('Node IDs to set as initial breakpoints'),
      checkpoint: z.boolean().optional().describe('Enable checkpointing to disk after each node (default: false)'),
    },
    async (args: {
      filePath: string;
      workflowName?: string;
      params?: Record<string, unknown>;
      breakpoints?: string[];
      checkpoint?: boolean;
    }) => {
      try {
        const debugId = `debug-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Get execution order from the workflow file
        const executionOrder = await getExecutionOrder(args.filePath, args.workflowName);

        // Set up checkpoint writer if requested
        let checkpointWriter: CheckpointWriter | undefined;
        if (args.checkpoint) {
          checkpointWriter = new CheckpointWriter(
            args.filePath,
            args.workflowName ?? 'default',
            debugId,
            args.params
          );
        }

        // Create the debug controller
        const controller = new DebugController({
          debug: true,
          checkpoint: args.checkpoint ?? false,
          checkpointWriter,
          breakpoints: args.breakpoints,
          executionOrder,
        });

        // Create agent channel in case the workflow uses waitForAgent
        const agentChannel = new AgentChannel();

        // Start execution (non-blocking: the workflow will pause at the first node)
        const execPromise = executeWorkflowFromFile(args.filePath, args.params, {
          workflowName: args.workflowName,
          includeTrace: true,
          agentChannel,
          debugController: controller,
        });

        // Store the session
        const session: DebugSession = {
          debugId,
          filePath: args.filePath,
          workflowName: args.workflowName,
          controller,
          executionPromise: execPromise,
          createdAt: Date.now(),
          tmpFiles: [],
        };
        storeDebugSession(session);

        // Wait for the first pause or immediate completion
        const outcome = await raceDebugPause(session);

        if (outcome.type === 'paused') {
          return makeToolResult({
            debugId,
            status: 'paused',
            state: outcome.state,
          });
        }

        if (outcome.type === 'completed') {
          cleanupDebugSession(debugId);
          return makeToolResult({
            debugId,
            status: 'completed',
            result: outcome.result,
          });
        }

        // Error
        cleanupDebugSession(debugId);
        return makeErrorResult('EXECUTION_ERROR', outcome.message);
      } catch (err) {
        return makeErrorResult(
          'DEBUG_START_ERROR',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // -------------------------------------------------------------------------
  // fw_debug_step — Execute next node then pause
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_debug_step',
    'Step to the next node in a debug session. Executes one node then pauses again.',
    {
      debugId: z.string().describe('The debug session ID from fw_debug_workflow'),
    },
    async (args: { debugId: string }) => {
      const session = getDebugSession(args.debugId);
      if (!session) {
        return makeErrorResult(
          'SESSION_NOT_FOUND',
          `No debug session found with ID "${args.debugId}". Use fw_debug_workflow to start one.`
        );
      }

      try {
        session.controller.resume({ type: 'step' });

        const outcome = await raceDebugPause(session);

        if (outcome.type === 'paused') {
          return makeToolResult({
            status: 'paused',
            state: outcome.state,
          });
        }

        if (outcome.type === 'completed') {
          cleanupDebugSession(args.debugId);
          return makeToolResult({
            status: 'completed',
            result: outcome.result,
          });
        }

        cleanupDebugSession(args.debugId);
        return makeErrorResult('EXECUTION_ERROR', outcome.message);
      } catch (err) {
        cleanupDebugSession(args.debugId);
        return makeErrorResult(
          'STEP_ERROR',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // -------------------------------------------------------------------------
  // fw_debug_continue — Run to completion or breakpoint
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_debug_continue',
    'Continue execution from the current pause point. Runs to completion, or stops at the ' +
      'next breakpoint if toBreakpoint is true.',
    {
      debugId: z.string().describe('The debug session ID'),
      toBreakpoint: z
        .boolean()
        .optional()
        .describe('If true, pause at the next breakpoint instead of running to completion'),
    },
    async (args: { debugId: string; toBreakpoint?: boolean }) => {
      const session = getDebugSession(args.debugId);
      if (!session) {
        return makeErrorResult(
          'SESSION_NOT_FOUND',
          `No debug session found with ID "${args.debugId}".`
        );
      }

      try {
        const action = args.toBreakpoint
          ? { type: 'continueToBreakpoint' as const }
          : { type: 'continue' as const };

        session.controller.resume(action);

        const outcome = await raceDebugPause(session);

        if (outcome.type === 'paused') {
          return makeToolResult({
            status: 'paused',
            state: outcome.state,
          });
        }

        if (outcome.type === 'completed') {
          cleanupDebugSession(args.debugId);
          return makeToolResult({
            status: 'completed',
            result: outcome.result,
          });
        }

        cleanupDebugSession(args.debugId);
        return makeErrorResult('EXECUTION_ERROR', outcome.message);
      } catch (err) {
        cleanupDebugSession(args.debugId);
        return makeErrorResult(
          'CONTINUE_ERROR',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // -------------------------------------------------------------------------
  // fw_debug_inspect — Read current state without advancing
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_debug_inspect',
    'Inspect the current debug state without advancing execution. Returns all variables, ' +
      'or filter to a specific node.',
    {
      debugId: z.string().describe('The debug session ID'),
      nodeId: z.string().optional().describe('Filter to show only this node\'s variables'),
    },
    async (args: { debugId: string; nodeId?: string }) => {
      const session = getDebugSession(args.debugId);
      if (!session) {
        return makeErrorResult(
          'SESSION_NOT_FOUND',
          `No debug session found with ID "${args.debugId}".`
        );
      }

      if (!session.lastPauseState) {
        return makeErrorResult(
          'NOT_PAUSED',
          'Debug session has not paused yet. Wait for the workflow to reach a pause point.'
        );
      }

      const state = { ...session.lastPauseState };

      // Filter variables to a specific node if requested
      if (args.nodeId) {
        const prefix = `${args.nodeId}:`;
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(state.variables)) {
          if (key.startsWith(prefix)) {
            // Show as portName:executionIndex for readability
            filtered[key.substring(prefix.length)] = value;
          }
        }
        return makeToolResult({
          nodeId: args.nodeId,
          variables: filtered,
          state: {
            currentNodeId: state.currentNodeId,
            phase: state.phase,
            position: state.position,
            completedNodes: state.completedNodes,
          },
        });
      }

      return makeToolResult({ state });
    }
  );

  // -------------------------------------------------------------------------
  // fw_debug_set_variable — Modify a variable value
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_debug_set_variable',
    'Modify a variable value in the debug session. The new value will be used by downstream ' +
      'nodes when execution continues.',
    {
      debugId: z.string().describe('The debug session ID'),
      nodeId: z.string().describe('The node that produced the variable'),
      portName: z.string().describe('The output port name'),
      value: z.unknown().describe('The new value to set'),
      executionIndex: z.number().optional().describe('Execution index (defaults to the latest)'),
    },
    async (args: {
      debugId: string;
      nodeId: string;
      portName: string;
      value: unknown;
      executionIndex?: number;
    }) => {
      const session = getDebugSession(args.debugId);
      if (!session) {
        return makeErrorResult(
          'SESSION_NOT_FOUND',
          `No debug session found with ID "${args.debugId}".`
        );
      }

      if (!session.lastPauseState) {
        return makeErrorResult(
          'NOT_PAUSED',
          'Cannot modify variables when the session is not paused.'
        );
      }

      // Find the variable key
      const key = findVariableKey(
        session.lastPauseState.variables,
        args.nodeId,
        args.portName,
        args.executionIndex
      );

      if (!key) {
        return makeErrorResult(
          'VARIABLE_NOT_FOUND',
          `No variable found for ${args.nodeId}.${args.portName}` +
            (args.executionIndex !== undefined ? `[${args.executionIndex}]` : '') +
            '. Check fw_debug_inspect to see available variables.'
        );
      }

      // Queue the modification (applied before the next node executes)
      session.controller.setVariable(key, args.value);

      // Update the lastPauseState to reflect the modification
      session.lastPauseState.variables[key] = args.value;

      return makeToolResult({
        modified: key,
        value: args.value,
      });
    }
  );

  // -------------------------------------------------------------------------
  // fw_debug_breakpoint — Manage breakpoints
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_debug_breakpoint',
    'Add, remove, or list breakpoints in a debug session. Breakpoints cause execution to ' +
      'pause when running with fw_debug_continue(toBreakpoint: true).',
    {
      debugId: z.string().describe('The debug session ID'),
      action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
      nodeId: z.string().optional().describe('Node ID for add/remove (not needed for list)'),
    },
    async (args: { debugId: string; action: 'add' | 'remove' | 'list'; nodeId?: string }) => {
      const session = getDebugSession(args.debugId);
      if (!session) {
        return makeErrorResult(
          'SESSION_NOT_FOUND',
          `No debug session found with ID "${args.debugId}".`
        );
      }

      if (args.action === 'add') {
        if (!args.nodeId) {
          return makeErrorResult('MISSING_PARAM', 'nodeId is required to add a breakpoint');
        }
        session.controller.addBreakpoint(args.nodeId);
      } else if (args.action === 'remove') {
        if (!args.nodeId) {
          return makeErrorResult('MISSING_PARAM', 'nodeId is required to remove a breakpoint');
        }
        session.controller.removeBreakpoint(args.nodeId);
      }

      return makeToolResult({
        breakpoints: session.controller.getBreakpoints(),
      });
    }
  );

  // -------------------------------------------------------------------------
  // fw_resume_from_checkpoint — Resume a crashed workflow
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_resume_from_checkpoint',
    'Resume a workflow from a checkpoint file written after a crash. Skips already-completed ' +
      'nodes and re-runs from the last checkpoint position.',
    {
      filePath: z.string().describe('Path to the workflow .ts file'),
      checkpointFile: z
        .string()
        .optional()
        .describe('Path to the checkpoint file. If omitted, auto-detects the latest.'),
      workflowName: z
        .string()
        .optional()
        .describe('Workflow function name (for multi-workflow files)'),
      debug: z
        .boolean()
        .optional()
        .describe('Enter step-through debug mode at the resume point (default: false)'),
    },
    async (args: {
      filePath: string;
      checkpointFile?: string;
      workflowName?: string;
      debug?: boolean;
    }) => {
      try {
        // Find checkpoint file
        const checkpointPath =
          args.checkpointFile ?? findLatestCheckpoint(args.filePath, args.workflowName);

        if (!checkpointPath) {
          return makeErrorResult(
            'NO_CHECKPOINT',
            `No checkpoint file found for ${args.filePath}. ` +
              'Checkpoints are created when running with checkpoint: true.'
          );
        }

        // Load and validate checkpoint
        const { data, stale, rerunNodes, skipNodes } = loadCheckpoint(
          checkpointPath,
          args.filePath
        );

        const skippedCount = data.completedNodes.length - rerunNodes.length;

        // Create debug controller with skip nodes from checkpoint
        const controller = new DebugController({
          debug: args.debug ?? false,
          checkpoint: true,
          checkpointWriter: new CheckpointWriter(
            args.filePath,
            data.workflowName,
            `resume-${Date.now()}`,
            data.params
          ),
          executionOrder: data.executionOrder,
          skipNodes,
        });

        const agentChannel = new AgentChannel();

        // Execute with the skip nodes configured
        const execPromise = executeWorkflowFromFile(args.filePath, data.params, {
          workflowName: data.workflowName,
          includeTrace: true,
          agentChannel,
          debugController: controller,
        });

        // If debug mode, handle like fw_debug_workflow
        if (args.debug) {
          const debugId = `debug-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const session: DebugSession = {
            debugId,
            filePath: args.filePath,
            workflowName: data.workflowName,
            controller,
            executionPromise: execPromise,
            createdAt: Date.now(),
            tmpFiles: [],
          };
          storeDebugSession(session);

          const outcome = await raceDebugPause(session);

          if (outcome.type === 'paused') {
            return makeToolResult({
              debugId,
              status: 'paused',
              resumedFrom: checkpointPath,
              skippedNodes: skippedCount,
              ...(rerunNodes.length > 0 && { rerunNodes }),
              ...(stale && { warning: 'Workflow file has changed since checkpoint was written.' }),
              state: outcome.state,
            });
          }

          if (outcome.type === 'completed') {
            cleanupDebugSession(debugId);
            return makeToolResult({
              status: 'completed',
              resumedFrom: checkpointPath,
              skippedNodes: skippedCount,
              ...(rerunNodes.length > 0 && { rerunNodes }),
              result: outcome.result,
            });
          }

          cleanupDebugSession(debugId);
          return makeErrorResult('EXECUTION_ERROR', outcome.message);
        }

        // Non-debug mode: run to completion
        const result = await execPromise;

        // Clean up the checkpoint file on successful completion
        const writer = new CheckpointWriter(
          args.filePath,
          data.workflowName,
          '',
          {}
        );
        writer.cleanup();

        return makeToolResult({
          status: 'completed',
          resumedFrom: checkpointPath,
          skippedNodes: skippedCount,
          ...(rerunNodes.length > 0 && { rerunNodes }),
          ...(stale && { warning: 'Workflow file has changed since checkpoint was written.' }),
          result: (result as { result?: unknown })?.result ?? result,
        });
      } catch (err) {
        return makeErrorResult(
          'RESUME_ERROR',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // -------------------------------------------------------------------------
  // fw_list_debug_sessions — List active debug sessions
  // -------------------------------------------------------------------------
  mcp.tool(
    'fw_list_debug_sessions',
    'List all active debug sessions.',
    {},
    async () => {
      return makeToolResult(listDebugSessions());
    }
  );
}
