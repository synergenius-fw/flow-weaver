/**
 * Run command - execute a workflow file directly from the CLI
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { executeWorkflowFromFile } from '../../mcp/workflow-executor.js';
import type { ExecuteWorkflowResult, ExecutionTraceEvent } from '../../mcp/workflow-executor.js';
import { AgentChannel } from '../../mcp/agent-channel.js';
import { DebugController } from '../../runtime/debug-controller.js';
import type { DebugPauseState } from '../../runtime/debug-controller.js';
import { CheckpointWriter, loadCheckpoint, findLatestCheckpoint } from '../../runtime/checkpoint.js';
import { getTopologicalOrder } from '../../api/query.js';
import { logger } from '../utils/logger.js';
import { getFriendlyError } from '../../friendly-errors.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import type { FwMockConfig } from '../../built-in-nodes/mock-types.js';
import { parseWorkflow } from '../../api/index.js';

export interface RunOptions {
  /** Specific workflow name to run (if file contains multiple workflows) */
  workflow?: string;
  /** Input parameters as JSON string */
  params?: string;
  /** Path to JSON file containing input parameters */
  paramsFile?: string;
  /** Run in production mode (no trace events) */
  production?: boolean;
  /** Include execution trace events */
  trace?: boolean;
  /** Stream trace events in real-time */
  stream?: boolean;
  /** Output result as JSON (for scripting) */
  json?: boolean;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Mock config for built-in nodes as inline JSON string */
  mocks?: string;
  /** Path to JSON file containing mock config for built-in nodes */
  mocksFile?: string;
  /** Start in step-through debug mode */
  debug?: boolean;
  /** Enable checkpointing to disk after each node */
  checkpoint?: boolean;
  /** Resume from a checkpoint file (true for auto-detect, or a file path) */
  resume?: boolean | string;
  /** Initial breakpoint node IDs */
  breakpoint?: string[];
}

/**
 * Execute a workflow file and output the result.
 *
 * @param input - Path to the workflow file
 * @param options - Execution options
 *
 * @example
 * ```bash
 * # Basic execution
 * flow-weaver run workflow.ts
 *
 * # With parameters
 * flow-weaver run workflow.ts --params '{"a": 5, "b": 3}'
 *
 * # From params file
 * flow-weaver run workflow.ts --params-file params.json
 *
 * # Specific workflow in multi-workflow file
 * flow-weaver run workflow.ts --workflow calculate
 *
 * # JSON output for scripting
 * flow-weaver run workflow.ts --json | jq '.result'
 * ```
 */
export async function runCommand(input: string, options: RunOptions): Promise<void> {
  const filePath = path.resolve(input);

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Parse params from --params or --params-file
  let params: Record<string, unknown> = {};
  if (options.params) {
    try {
      params = JSON.parse(options.params);
    } catch {
      throw new Error(`Invalid JSON in --params: ${options.params}`);
    }
  } else if (options.paramsFile) {
    const paramsFilePath = path.resolve(options.paramsFile);
    if (!fs.existsSync(paramsFilePath)) {
      throw new Error(`Params file not found: ${paramsFilePath}`);
    }
    try {
      const content = fs.readFileSync(paramsFilePath, 'utf8');
      params = JSON.parse(content);
    } catch {
      throw new Error(`Failed to parse params file: ${options.paramsFile}`);
    }
  }

  // Parse mocks from --mocks or --mocks-file
  let mocks: FwMockConfig | undefined;
  if (options.mocks) {
    try {
      mocks = JSON.parse(options.mocks);
    } catch {
      throw new Error(`Invalid JSON in --mocks: ${options.mocks}`);
    }
  } else if (options.mocksFile) {
    const mocksFilePath = path.resolve(options.mocksFile);
    if (!fs.existsSync(mocksFilePath)) {
      throw new Error(`Mocks file not found: ${mocksFilePath}`);
    }
    try {
      const content = fs.readFileSync(mocksFilePath, 'utf8');
      mocks = JSON.parse(content);
    } catch {
      throw new Error(`Failed to parse mocks file: ${options.mocksFile}`);
    }
  }

  // Validate mock config against workflow when mocks are provided
  if (mocks && !options.json) {
    await validateMockConfig(mocks, filePath, options.workflow);
  }

  // Set up timeout if specified
  let timeoutId: NodeJS.Timeout | undefined;
  let timedOut = false;

  if (options.timeout) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      if (!options.json) {
        logger.error(`Execution timed out after ${options.timeout}ms`);
      }
      process.exit(1);
    }, options.timeout);
  }

  try {
    // Handle --resume: load checkpoint and set up skip nodes
    let resumeSkipNodes: Map<string, Record<string, unknown>> | undefined;
    let resumeCheckpointPath: string | undefined;
    let resumeParams: Record<string, unknown> | undefined;
    let resumeWorkflowName: string | undefined;
    let resumeExecutionOrder: string[] | undefined;
    let resumeRerunNodes: string[] | undefined;
    let resumeStale = false;

    if (options.resume) {
      const checkpointPath =
        typeof options.resume === 'string'
          ? options.resume
          : findLatestCheckpoint(filePath, options.workflow);

      if (!checkpointPath) {
        throw new Error(
          `No checkpoint file found for ${filePath}. ` +
          'Checkpoints are created when running with --checkpoint.'
        );
      }

      const { data, stale, rerunNodes, skipNodes } = loadCheckpoint(
        checkpointPath,
        filePath
      );

      resumeSkipNodes = skipNodes;
      resumeCheckpointPath = checkpointPath;
      resumeParams = data.params;
      resumeWorkflowName = data.workflowName;
      resumeExecutionOrder = data.executionOrder;
      resumeRerunNodes = rerunNodes;
      resumeStale = stale;

      // Use checkpoint params if none provided
      if (Object.keys(params).length === 0) {
        params = data.params;
      }

      if (!options.json) {
        const skipped = data.completedNodes.length - rerunNodes.length;
        logger.info(`Resuming from checkpoint: ${checkpointPath}`);
        logger.info(`Skipping ${skipped} completed nodes`);
        if (rerunNodes.length > 0) {
          logger.info(`Re-running ${rerunNodes.length} nodes: ${rerunNodes.join(', ')}`);
        }
        if (stale) {
          logger.warn('Workflow file has changed since checkpoint was written.');
        }
      }
    }

    // Determine trace inclusion:
    // - If --production is set, no trace (unless --trace explicitly set)
    // - If --trace is set, include trace
    // - Default: include trace in dev mode
    const includeTrace = options.stream || options.trace || !options.production;

    if (!options.json && mocks) {
      logger.info('Running with mock data');
    }

    // Set up debug controller if --debug, --checkpoint, or --resume
    const useDebug = options.debug || options.checkpoint || options.resume;
    let debugController: DebugController | undefined;

    if (useDebug) {
      // Get execution order for the controller
      let executionOrder = resumeExecutionOrder;
      if (!executionOrder) {
        const source = fs.readFileSync(filePath, 'utf8');
        const parsed = await parseWorkflow(source, { workflowName: options.workflow });
        if (parsed.errors.length === 0) {
          executionOrder = getTopologicalOrder(parsed.ast);
        } else {
          executionOrder = [];
        }
      }

      // Set up checkpoint writer
      let checkpointWriter: CheckpointWriter | undefined;
      if (options.checkpoint || options.resume) {
        const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        checkpointWriter = new CheckpointWriter(
          filePath,
          resumeWorkflowName ?? options.workflow ?? 'default',
          runId,
          params
        );
      }

      debugController = new DebugController({
        debug: options.debug ?? false,
        checkpoint: !!(options.checkpoint || options.resume),
        checkpointWriter,
        breakpoints: options.breakpoint,
        executionOrder,
        skipNodes: resumeSkipNodes,
      });
    }

    // Build onEvent callback for real-time streaming
    const nodeStartTimes = new Map<string, number>();
    const onEvent = options.stream && !options.json
      ? (event: ExecutionTraceEvent) => {
          if (event.type === 'STATUS_CHANGED' && event.data) {
            const nodeId = event.data.id as string | undefined;
            const status = event.data.status as string | undefined;
            if (!nodeId || !status) return;

            if (status === 'RUNNING') {
              nodeStartTimes.set(nodeId, event.timestamp);
              logger.log(`  [STATUS_CHANGED] ${nodeId}: → RUNNING`);
            } else {
              const startTime = nodeStartTimes.get(nodeId);
              const duration = startTime ? ` (${event.timestamp - startTime}ms)` : '';
              logger.log(`  [STATUS_CHANGED] ${nodeId}: → ${status}${duration}`);
            }
          } else if (event.type === 'VARIABLE_SET' && event.data) {
            const nodeId = event.data.nodeId as string | undefined;
            const varName = event.data.name as string | undefined;
            if (nodeId && varName) {
              logger.log(`  [VARIABLE_SET] ${nodeId}.${varName}`);
            }
          }
        }
      : undefined;

    const channel = new AgentChannel();
    const execPromise = executeWorkflowFromFile(filePath, params, {
      workflowName: resumeWorkflowName ?? options.workflow,
      production: options.production ?? false,
      includeTrace,
      mocks,
      agentChannel: channel,
      debugController,
      onEvent,
    });

    // If debug mode is active and interactive, enter the debug REPL
    if (options.debug && debugController && process.stdin.isTTY) {
      const debugResult = await runDebugRepl(debugController, execPromise, channel, options);
      if (timedOut) return;

      if (options.json) {
        process.stdout.write(
          JSON.stringify({
            success: true,
            result: debugResult,
            ...(resumeCheckpointPath && { resumedFrom: resumeCheckpointPath }),
            ...(resumeRerunNodes && resumeRerunNodes.length > 0 && { rerunNodes: resumeRerunNodes }),
            ...(resumeStale && { warning: 'Workflow changed since checkpoint.' }),
          }, null, 2) + '\n'
        );
      } else {
        logger.success('Debug session completed');
        logger.newline();
        logger.section('Result');
        logger.log(JSON.stringify(debugResult, null, 2));
      }
      return;
    }

    let result!: ExecuteWorkflowResult;
    let execDone = false;

    // Race loop: detect pauses, prompt user, resume
    while (!execDone) {
      const promises: Promise<{ type: string; result?: ExecuteWorkflowResult; request?: object; state?: DebugPauseState }>[] = [
        execPromise.then((r) => ({ type: 'completed' as const, result: r })),
        channel.onPause().then((req) => ({ type: 'agent_paused' as const, request: req })),
      ];

      // Also race against debug controller pause if present (non-interactive checkpoint mode)
      if (debugController) {
        promises.push(
          debugController.onPause().then((state) => ({ type: 'debug_paused' as const, state }))
        );
      }

      const raceResult = await Promise.race(promises);

      if (raceResult.type === 'completed') {
        result = raceResult.result!;
        execDone = true;
      } else if (raceResult.type === 'debug_paused') {
        // Non-interactive debug mode (checkpoint only, no --debug flag):
        // Auto-continue, the checkpoint was written in afterNode
        debugController!.resume({ type: 'continue' });
      } else {
        // Workflow paused at waitForAgent
        const request = raceResult.request as { agentId?: string; context?: unknown; prompt?: string };

        if (!process.stdin.isTTY) {
          throw new Error(
            'Workflow paused at waitForAgent but stdin is not interactive. ' +
            'Use --mocks to provide agent responses.'
          );
        }

        // Display prompt info to stderr (keeps stdout clean for --json)
        const label = request.prompt || `Agent "${request.agentId}" is requesting input`;
        if (!options.json) {
          logger.newline();
          logger.section('Waiting for Input');
          logger.info(label);
          if (request.context && Object.keys(request.context as object).length > 0) {
            logger.log(`  Context: ${JSON.stringify(request.context, null, 2)}`);
          }
        }

        // Prompt user for JSON response
        const userInput = await promptForInput('Enter response (JSON): ');
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(userInput);
        } catch {
          // If not valid JSON, wrap as { response: "..." }
          parsed = { response: userInput };
        }

        channel.resume(parsed);
      }
    }

    if (timedOut) return; // Don't output if already timed out

    if (options.json) {
      // JSON output for scripting
      process.stdout.write(
        JSON.stringify(
          {
            success: true,
            workflow: result.functionName,
            executionTime: result.executionTime,
            result: result.result,
            ...(includeTrace && result.trace && { traceCount: result.trace.length }),
            ...(resumeCheckpointPath && { resumedFrom: resumeCheckpointPath }),
            ...(resumeRerunNodes && resumeRerunNodes.length > 0 && { rerunNodes: resumeRerunNodes }),
          },
          null,
          2
        ) + '\n'
      );
    } else {
      // Human-readable output
      logger.success(`Workflow "${result.functionName}" completed in ${result.executionTime}ms`);
      logger.newline();
      logger.section('Result');
      logger.log(JSON.stringify(result.result, null, 2));

      if (result.trace && result.trace.length > 0) {
        logger.newline();
        logger.section('Trace');
        logger.log(`${result.trace.length} events captured`);

        // Show first few trace events as summary
        const preview = result.trace.slice(0, 5);
        for (const event of preview) {
          logger.log(`  [${event.type}] ${event.data?.nodeId || ''}`);
        }
        if (result.trace.length > 5) {
          logger.log(`  ... and ${result.trace.length - 5} more events`);
        }
      }
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);

    // Try to extract validator error code from the error message for friendly formatting
    // Common pattern: "Validation error [CODE]: message" or errors with a .code property
    const errorObj = error as { code?: string; errors?: Array<{ code: string; message: string; node?: string }> };

    if (errorObj.errors && Array.isArray(errorObj.errors)) {
      // Structured validation errors (from compileWorkflow)
      logger.error(`Workflow execution failed:`);
      for (const err of errorObj.errors) {
        const friendly = getFriendlyError(err);
        if (friendly) {
          logger.error(`  ${friendly.title}: ${friendly.explanation}`);
          logger.info(`    How to fix: ${friendly.fix}`);
        } else {
          logger.error(`  - ${err.message}`);
        }
      }
    } else if (errorObj.code) {
      const friendly = getFriendlyError({ code: errorObj.code, message: errorMsg });
      if (friendly) {
        logger.error(`${friendly.title}: ${friendly.explanation}`);
        logger.info(`  How to fix: ${friendly.fix}`);
      } else {
        logger.error(`Workflow execution failed: ${errorMsg}`);
      }
    } else {
      logger.error(`Workflow execution failed: ${errorMsg}`);
    }

    if (!options.json) {
      throw error;
    } else {
      process.stdout.write(
        JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n'
      );
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

const VALID_MOCK_KEYS = new Set(['events', 'invocations', 'agents', 'fast']);
const BUILT_IN_NODE_TYPES = new Set(['delay', 'waitForEvent', 'invokeWorkflow', 'waitForAgent']);

const MOCK_SECTION_TO_NODE: Record<string, string> = {
  events: 'waitForEvent',
  invocations: 'invokeWorkflow',
  agents: 'waitForAgent',
};

export async function validateMockConfig(
  mocks: FwMockConfig,
  filePath: string,
  workflowName?: string
): Promise<void> {
  // Check for unknown top-level keys (catches typos like "invocation" instead of "invocations")
  for (const key of Object.keys(mocks)) {
    if (!VALID_MOCK_KEYS.has(key)) {
      logger.warn(`Mock config has unknown key "${key}". Valid keys: ${[...VALID_MOCK_KEYS].join(', ')}`);
    }
  }

  // Quick-parse the workflow to check which built-in node types are used
  try {
    const result = await parseWorkflow(filePath, { workflowName });
    if (result.errors.length > 0 || !result.ast?.instances) return;

    const usedNodeTypes = new Set(result.ast.instances.map((i) => i.nodeType));

    for (const [section, nodeType] of Object.entries(MOCK_SECTION_TO_NODE)) {
      const mockSection = mocks[section as keyof FwMockConfig];
      if (mockSection && typeof mockSection === 'object' && Object.keys(mockSection).length > 0) {
        if (!usedNodeTypes.has(nodeType)) {
          logger.warn(
            `Mock config has "${section}" entries but workflow has no ${nodeType} nodes`
          );
        }
      }
    }
  } catch {
    // Parsing failed — skip validation, the execution will report the real error
  }
}

// ---------------------------------------------------------------------------
// Interactive debug REPL
// ---------------------------------------------------------------------------

function printDebugState(state: DebugPauseState): void {
  const pos = `${state.position + 1}/${state.executionOrder.length}`;
  logger.log(`\n[paused] ${state.phase}: ${state.currentNodeId} (${pos})`);

  if (state.phase === 'after' && state.currentNodeOutputs) {
    // Show outputs of the node that just completed
    for (const [port, value] of Object.entries(state.currentNodeOutputs)) {
      const valueStr = JSON.stringify(value);
      const display = valueStr.length > 80 ? valueStr.substring(0, 77) + '...' : valueStr;
      logger.log(`  ${state.currentNodeId}.${port} = ${display}`);
    }
  }
}

function printDebugHelp(): void {
  logger.log('Commands:');
  logger.log('  s, step             Step to next node');
  logger.log('  c, continue         Run to completion');
  logger.log('  cb                  Continue to next breakpoint');
  logger.log('  i, inspect          Show all variables');
  logger.log('  i <node>            Show variables for a specific node');
  logger.log('  b <node>            Add breakpoint');
  logger.log('  rb <node>           Remove breakpoint');
  logger.log('  bl                  List breakpoints');
  logger.log('  set <node>.<port> <json>  Modify a variable');
  logger.log('  q, quit             Abort debug session');
  logger.log('  h, help             Show this help');
}

async function runDebugRepl(
  controller: DebugController,
  execPromise: Promise<ExecuteWorkflowResult>,
  agentChannel: AgentChannel,
  options: RunOptions
): Promise<unknown> {
  if (!options.json) {
    logger.newline();
    logger.section('Flow Weaver Debug');
    logger.log('Type "h" for help.');
  }

  // Wait for the first pause
  const firstResult = await Promise.race([
    execPromise.then((r) => ({ type: 'completed' as const, result: r })),
    controller.onPause().then((state) => ({ type: 'paused' as const, state })),
  ]);

  if (firstResult.type === 'completed') {
    return (firstResult.result as ExecuteWorkflowResult).result;
  }

  let currentState = firstResult.state;
  printDebugState(currentState);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: '> ',
  });

  return new Promise<unknown>((resolve, reject) => {
    let resolved = false;

    function finish(value: unknown): void {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(value);
    }

    function fail(err: Error): void {
      if (resolved) return;
      resolved = true;
      rl.close();
      reject(err);
    }

    async function handleResume(): Promise<void> {
      const raceResult = await Promise.race([
        execPromise.then((r) => ({ type: 'completed' as const, result: r })),
        controller.onPause().then((state) => ({ type: 'paused' as const, state })),
        agentChannel.onPause().then((req) => ({ type: 'agent_paused' as const, request: req })),
      ]);

      if (raceResult.type === 'completed') {
        const execResult = raceResult.result as ExecuteWorkflowResult;
        if (!options.json) {
          logger.success(`\nWorkflow completed in ${execResult.executionTime}ms`);
        }
        finish(execResult.result);
      } else if (raceResult.type === 'paused') {
        currentState = raceResult.state;
        printDebugState(currentState);
        rl.prompt();
      } else {
        // Agent pause during debug: prompt user for agent input
        const request = raceResult.request as { agentId?: string; prompt?: string };
        const label = request.prompt || `Agent "${request.agentId}" is requesting input`;
        logger.log(`\n[waitForAgent] ${label}`);
        rl.question('Agent response (JSON): ', (answer) => {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(answer);
          } catch {
            parsed = { response: answer };
          }
          agentChannel.resume(parsed);
          // Re-race after agent resume
          handleResume().catch(fail);
        });
      }
    }

    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        return;
      }

      const parts = input.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      try {
        switch (cmd) {
          case 's':
          case 'step':
            controller.resume({ type: 'step' });
            await handleResume();
            break;

          case 'c':
          case 'continue':
            controller.resume({ type: 'continue' });
            await handleResume();
            break;

          case 'cb':
            controller.resume({ type: 'continueToBreakpoint' });
            await handleResume();
            break;

          case 'i':
          case 'inspect': {
            const nodeId = parts[1];
            if (nodeId) {
              const prefix = `${nodeId}:`;
              let found = false;
              for (const [key, value] of Object.entries(currentState.variables)) {
                if (key.startsWith(prefix)) {
                  found = true;
                  const portKey = key.substring(prefix.length);
                  logger.log(`  ${nodeId}.${portKey} = ${JSON.stringify(value)}`);
                }
              }
              if (!found) {
                logger.log(`  No variables found for node "${nodeId}"`);
              }
            } else {
              // Group by node
              const byNode = new Map<string, Record<string, unknown>>();
              for (const [key, value] of Object.entries(currentState.variables)) {
                const firstColon = key.indexOf(':');
                if (firstColon === -1) continue;
                const node = key.substring(0, firstColon);
                if (!byNode.has(node)) byNode.set(node, {});
                byNode.get(node)![key.substring(firstColon + 1)] = value;
              }
              for (const [node, vars] of byNode) {
                logger.log(`  ${node}:`);
                for (const [port, value] of Object.entries(vars)) {
                  const valueStr = JSON.stringify(value);
                  const display = valueStr.length > 60 ? valueStr.substring(0, 57) + '...' : valueStr;
                  logger.log(`    ${port} = ${display}`);
                }
              }
            }
            rl.prompt();
            break;
          }

          case 'b': {
            const nodeId = parts[1];
            if (!nodeId) {
              logger.log('Usage: b <nodeId>');
            } else {
              controller.addBreakpoint(nodeId);
              logger.log(`Breakpoint added: ${nodeId}`);
            }
            rl.prompt();
            break;
          }

          case 'rb': {
            const nodeId = parts[1];
            if (!nodeId) {
              logger.log('Usage: rb <nodeId>');
            } else {
              controller.removeBreakpoint(nodeId);
              logger.log(`Breakpoint removed: ${nodeId}`);
            }
            rl.prompt();
            break;
          }

          case 'bl':
            logger.log(`Breakpoints: ${controller.getBreakpoints().join(', ') || '(none)'}`);
            rl.prompt();
            break;

          case 'set': {
            // set node.port <json_value>
            const target = parts[1];
            const jsonValue = parts.slice(2).join(' ');
            if (!target || !jsonValue) {
              logger.log('Usage: set <node>.<port> <json_value>');
              rl.prompt();
              break;
            }
            const dotIdx = target.indexOf('.');
            if (dotIdx === -1) {
              logger.log('Target must be in format: node.port');
              rl.prompt();
              break;
            }
            const nodeId = target.substring(0, dotIdx);
            const portName = target.substring(dotIdx + 1);
            let value: unknown;
            try {
              value = JSON.parse(jsonValue);
            } catch {
              logger.log(`Invalid JSON value: ${jsonValue}`);
              rl.prompt();
              break;
            }
            // Find the key in current variables
            const prefix = `${nodeId}:${portName}:`;
            let foundKey: string | null = null;
            let latestIdx = -1;
            for (const key of Object.keys(currentState.variables)) {
              if (key.startsWith(prefix)) {
                const idx = parseInt(key.substring(prefix.length), 10);
                if (idx > latestIdx) {
                  latestIdx = idx;
                  foundKey = key;
                }
              }
            }
            if (!foundKey) {
              logger.log(`Variable not found: ${nodeId}.${portName}`);
              rl.prompt();
              break;
            }
            controller.setVariable(foundKey, value);
            currentState.variables[foundKey] = value;
            logger.log(`Set ${nodeId}.${portName} = ${JSON.stringify(value)}`);
            rl.prompt();
            break;
          }

          case 'q':
          case 'quit':
            controller.resume({ type: 'abort' as never });
            finish(undefined);
            break;

          case 'h':
          case 'help':
            printDebugHelp();
            rl.prompt();
            break;

          default:
            logger.log(`Unknown command: ${cmd}. Type "h" for help.`);
            rl.prompt();
        }
      } catch (err) {
        if (!resolved) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('aborted')) {
            logger.log('Debug session aborted.');
            finish(undefined);
          } else {
            logger.error(`Error: ${msg}`);
            rl.prompt();
          }
        }
      }
    });

    rl.on('close', () => {
      if (!resolved) {
        finish(undefined);
      }
    });

    rl.prompt();
  });
}

function promptForInput(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr, // prompts to stderr, not stdout
    });
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
