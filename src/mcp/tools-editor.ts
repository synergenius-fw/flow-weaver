import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EditorConnection } from './editor-connection.js';
import type { EventBuffer } from './event-buffer.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';
import type { AckResponse } from './types.js';
import { executeWorkflowFromFile } from './workflow-executor.js';
import { AgentChannel } from './agent-channel.js';
import { storePendingRun, getPendingRun, removePendingRun, listPendingRuns } from './run-registry.js';

/**
 * Unwrap editor ack responses to flatten double-nested results.
 * Editor returns { requestId, success, result: { actualData } } —
 * we extract the `result` field to avoid double-nesting in MCP output.
 */
function unwrapAckResult(ack: AckResponse): unknown {
  if (ack && typeof ack === 'object' && 'result' in ack && ack.result !== undefined) {
    return ack.result;
  }
  return ack;
}

export function registerEditorTools(
  mcp: McpServer,
  connection: EditorConnection,
  buffer: EventBuffer
): void {
  mcp.tool(
    'fw_check_events',
    'Get buffered editor events. Returns and clears the event buffer unless peek=true.',
    { peek: z.boolean().optional().describe('If true, read events without clearing the buffer') },
    async (args: { peek?: boolean }) => {
      const events = args.peek ? buffer.peek() : buffer.drain();
      return makeToolResult(events);
    }
  );

  mcp.tool(
    'fw_get_state',
    'Get the current editor/workflow state from Flow Weaver.',
    {},
    async () => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendCommand('get-state', {});
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_focus_node',
    'Select and center a node in the Flow Weaver editor.',
    { nodeId: z.string().describe('The ID of the node to focus') },
    async (args: { nodeId: string }) => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendCommand('focus-node', { nodeId: args.nodeId });
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_add_node',
    'Add a new node to the workflow in the Flow Weaver editor.',
    {
      nodeTypeName: z.string().describe('The name of the node type to add'),
      nodeTypeDefinition: z
        .record(z.unknown())
        .optional()
        .describe('Optional node type definition object'),
    },
    async (args: { nodeTypeName: string; nodeTypeDefinition?: Record<string, unknown> }) => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const params: Record<string, unknown> = { nodeTypeName: args.nodeTypeName };
      if (args.nodeTypeDefinition) {
        params.nodeTypeDefinition = args.nodeTypeDefinition;
      }
      const result = await connection.sendCommand('add-node', params);
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_open_workflow',
    'Open a workflow file in the Flow Weaver editor.',
    { filePath: z.string().describe('The path to the workflow file to open') },
    async (args: { filePath: string }) => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendCommand('open-workflow', { filePath: args.filePath });
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_send_command',
    'Send a generic command to the Flow Weaver editor.',
    {
      action: z.string().describe('The command action name'),
      params: z.record(z.unknown()).optional().describe('Optional parameters for the command'),
    },
    async (args: { action: string; params?: Record<string, unknown> }) => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendCommand(args.action, args.params ?? {});
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_batch',
    'Execute a batch of commands with auto-snapshot rollback support.',
    {
      commands: z
        .array(
          z.object({
            action: z.string(),
            params: z.record(z.unknown()).optional(),
          })
        )
        .describe('Array of commands to execute as a batch'),
    },
    async (args: { commands: Array<{ action: string; params?: Record<string, unknown> }> }) => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendBatch(args.commands);
      return makeToolResult(unwrapAckResult(result));
    }
  );

  // --- New tools ---

  mcp.tool(
    'fw_remove_node',
    'Remove a node and its connections from the workflow.',
    { nodeName: z.string().describe('The name/ID of the node to remove') },
    async (args: { nodeName: string }) => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendCommand('remove-node', { nodeName: args.nodeName });
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_connect',
    'Add or remove a connection between ports.',
    {
      action: z.enum(['add', 'remove']).describe('Whether to add or remove the connection'),
      connection: z
        .object({
          sourceNode: z.string().describe('Source node ID'),
          sourcePort: z.string().describe('Source port name'),
          targetNode: z.string().describe('Target node ID'),
          targetPort: z.string().describe('Target port name'),
        })
        .describe('Connection specification'),
    },
    async (args: {
      action: 'add' | 'remove';
      connection: {
        sourceNode: string;
        sourcePort: string;
        targetNode: string;
        targetPort: string;
      };
    }) => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const bridgeAction = args.action === 'add' ? 'add-connection' : 'remove-connection';
      const result = await connection.sendCommand(bridgeAction, {
        connection: args.connection,
      });
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_undo_redo',
    'Undo or redo the last workflow change.',
    { action: z.enum(['undo', 'redo']).describe('Whether to undo or redo') },
    async (args: { action: 'undo' | 'redo' }) => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendCommand(args.action, {});
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_execute_workflow',
    'Run the current workflow with optional parameters and return the result. ' +
      'Includes per-node execution trace by default (STATUS_CHANGED, VARIABLE_SET events) — ' +
      'use includeTrace: false to disable. If the workflow pauses at a waitForAgent node, ' +
      'returns immediately with status "waiting" and a runId — use fw_resume_workflow to continue.',
    {
      filePath: z
        .string()
        .optional()
        .describe(
          'Path to workflow file. When provided, compiles and executes directly (no editor needed)'
        ),
      workflowName: z
        .string()
        .optional()
        .describe('Specific workflow function name (for multi-workflow files)'),
      params: z.record(z.unknown()).optional().describe('Optional execution parameters'),
      includeTrace: z
        .boolean()
        .optional()
        .describe('Include execution trace events (default: true)'),
    },
    async (args: {
      filePath?: string;
      workflowName?: string;
      params?: Record<string, unknown>;
      includeTrace?: boolean;
    }, extra) => {
      // When filePath is provided, compile and execute directly (no editor needed)
      if (args.filePath) {
        try {
          const channel = new AgentChannel();
          const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

          // Send progress notifications for trace events when client supports it
          const progressToken = extra._meta?.progressToken;
          let eventCount = 0;
          const onEvent = progressToken
            ? (event: { type: string; timestamp: number; data?: Record<string, unknown> }) => {
                eventCount++;
                extra.sendNotification({
                  method: 'notifications/progress' as const,
                  params: {
                    progressToken,
                    progress: eventCount,
                    message: event.type === 'STATUS_CHANGED'
                      ? `${event.data?.id ?? ''}: ${event.data?.status ?? ''}`
                      : event.type,
                  },
                }).catch(() => { /* client may have disconnected */ });
              }
            : undefined;

          const execPromise = executeWorkflowFromFile(args.filePath, args.params, {
            workflowName: args.workflowName,
            includeTrace: args.includeTrace,
            agentChannel: channel,
            onEvent,
          });

          // Race between workflow completing and workflow pausing
          const raceResult = await Promise.race([
            execPromise.then((r) => ({ type: 'completed' as const, result: r })),
            channel.onPause().then((req) => ({ type: 'paused' as const, request: req })),
          ]);

          if (raceResult.type === 'paused') {
            // Store the pending run for later resumption
            storePendingRun({
              runId,
              filePath: args.filePath,
              workflowName: args.workflowName,
              executionPromise: execPromise,
              agentChannel: channel,
              request: raceResult.request,
              createdAt: Date.now(),
              tmpFiles: [], // executor manages its own cleanup
            });

            return makeToolResult({
              status: 'waiting',
              runId,
              request: raceResult.request,
              message: 'Workflow paused at waitForAgent node. Use fw_resume_workflow to continue.',
            });
          }

          // Completed without pausing — return flat result for backward compatibility
          return makeToolResult(raceResult.result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Distinguish compile errors from execution errors
          const code = message.includes('Parse errors') ? 'COMPILE_ERROR' : 'EXECUTION_ERROR';
          return makeErrorResult(code, message);
        }
      }

      // No filePath: delegate to editor via Socket.io (existing behavior)
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendCommand('execute-workflow', args.params ?? {});
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_resume_workflow',
    'Resume a paused workflow that is waiting for agent input. ' +
      'Use this after fw_execute_workflow returns status "waiting".',
    {
      runId: z.string().describe('The runId from the waiting execution result'),
      result: z.record(z.unknown()).describe('The agent result to send back to the workflow'),
    },
    async (args: { runId: string; result: Record<string, unknown> }) => {
      const run = getPendingRun(args.runId);
      if (!run) {
        return makeErrorResult(
          'RUN_NOT_FOUND',
          `No pending run found with ID "${args.runId}". It may have already completed or been cancelled.`
        );
      }

      try {
        // Resume the workflow by resolving the agent channel's Promise
        run.agentChannel.resume(args.result);

        // Wait for the workflow to either complete or pause again
        const raceResult = await Promise.race([
          run.executionPromise.then((r) => ({ type: 'completed' as const, result: r })),
          run.agentChannel.onPause().then((req) => ({ type: 'paused' as const, request: req })),
        ]);

        if (raceResult.type === 'paused') {
          // Workflow paused again at another waitForAgent node
          run.request = raceResult.request;
          return makeToolResult({
            status: 'waiting',
            runId: args.runId,
            request: raceResult.request,
            message: 'Workflow paused again at another waitForAgent node.',
          });
        }

        // Workflow completed
        removePendingRun(args.runId);
        return makeToolResult({ status: 'completed', result: raceResult.result });
      } catch (err) {
        removePendingRun(args.runId);
        const message = err instanceof Error ? err.message : String(err);
        return makeErrorResult('EXECUTION_ERROR', message);
      }
    }
  );

  mcp.tool(
    'fw_list_pending_runs',
    'List workflows that are currently paused waiting for agent input.',
    {},
    async () => {
      const runs = listPendingRuns();
      return makeToolResult(runs);
    }
  );

  mcp.tool(
    'fw_get_workflow_details',
    'Get full workflow structure including nodes, connections, types, and positions.',
    {},
    async () => {
      if (!connection.isConnected) {
        return makeErrorResult(
          'EDITOR_NOT_CONNECTED',
          'Not connected to the editor. Is the editor running?'
        );
      }
      const result = await connection.sendCommand('get-workflow-details', {});
      return makeToolResult(unwrapAckResult(result));
    }
  );

  mcp.tool(
    'fw_configure_events',
    'Configure event include/exclude filters, dedup window, and buffer size. Returns the active config after applying updates.',
    {
      include: z
        .array(z.string())
        .optional()
        .describe('Event patterns to include (empty = all). Supports trailing * for prefix match'),
      exclude: z
        .array(z.string())
        .optional()
        .describe('Event patterns to exclude (applied after include)'),
      dedupeWindowMs: z
        .number()
        .optional()
        .describe('Collapse same-type events within this window in ms (0 = disabled)'),
      maxBufferSize: z.number().optional().describe('Max events before oldest are evicted'),
    },
    async (args: {
      include?: string[];
      exclude?: string[];
      dedupeWindowMs?: number;
      maxBufferSize?: number;
    }) => {
      const partial: Record<string, unknown> = {};
      if (args.include !== undefined) partial.include = args.include;
      if (args.exclude !== undefined) partial.exclude = args.exclude;
      if (args.dedupeWindowMs !== undefined) partial.dedupeWindowMs = args.dedupeWindowMs;
      if (args.maxBufferSize !== undefined) partial.maxBufferSize = args.maxBufferSize;
      const config = buffer.setFilter(partial);
      return makeToolResult(config);
    }
  );
}
