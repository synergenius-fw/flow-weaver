/**
 * Run command - execute a workflow file directly from the CLI
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { randomUUID } from 'node:crypto';
import { executeWorkflow } from '../../mcp/workflow-executor.js';
import type { WorkflowExecutionOutcome, ExecutionTraceEvent } from '../../mcp/workflow-executor.js';
import { DebugController } from '../../runtime/debug-controller.js';
import type { DebugPauseState } from '../../runtime/debug-controller.js';
import { getTopologicalOrder } from '../../api/query.js';
import { logger } from '../utils/logger.js';
import { getFriendlyError } from '../../friendly-errors.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import type { FwMockConfig } from '../../built-in-nodes/mock-types.js';
import { parseWorkflow } from '../../api/index.js';
import { missingParams, MissingParamsError } from '../../coordinator/params.js';

/** Show path relative to cwd for cleaner output */
function displayPath(filePath: string): string {
  const rel = path.relative(process.cwd(), filePath);
  if (rel && !rel.startsWith('..') && rel.length < filePath.length) {
    return rel;
  }
  return filePath;
}

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
 * fw run workflow.ts
 *
 * # With parameters
 * fw run workflow.ts --params '{"a": 5, "b": 3}'
 *
 * # From params file
 * fw run workflow.ts --params-file params.json
 *
 * # Specific workflow in multi-workflow file
 * fw run workflow.ts --workflow calculate
 *
 * # JSON output for scripting
 * fw run workflow.ts --json | jq '.result'
 * ```
 */
export async function runCommand(input: string, options: RunOptions): Promise<void> {
  // Wrap entire body in JSON-aware error handler when --json is set (0b fix)
  if (options.json) {
    try {
      await runCommandInner(input, options);
    } catch (e) {
      console.log(JSON.stringify({ success: false, error: getErrorMessage(e) }));
      process.exitCode = 1;
    }
    return;
  }
  await runCommandInner(input, options);
}

async function runCommandInner(input: string, options: RunOptions): Promise<void> {
  const filePath = path.resolve(input);

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${displayPath(filePath)}`);
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
    // Determine trace inclusion:
    // Include trace data if --trace or --stream is explicitly set.
    // Also include when not in production mode (needed for live debugging).
    // Display of trace results is gated separately on options.trace/options.stream.
    const includeTrace = options.stream || options.trace || !options.production;

    if (!options.json && mocks) {
      logger.info('Running with mock data');
    }

    // Set up the execution-scoped live debug controller.
    const useDebug = options.debug;
    let debugController: DebugController | undefined;

    if (useDebug) {
      // Get execution order for the controller
      // parseWorkflow takes the path; handed the file's text it found no such
      // file, and the debugger stepped with an empty execution order.
      const parsed = await parseWorkflow(filePath, { workflowName: options.workflow, projectDir: path.dirname(filePath) });
      const executionOrder = parsed.errors.length === 0 ? getTopologicalOrder(parsed.ast) : [];

      debugController = new DebugController({
        debug: options.debug ?? false,
        breakpoints: options.breakpoint,
        executionOrder,
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

    // A run without a required parameter would run and return nothing for
    // it, which reads as success. Refuse it here, naming what is missing.
    {
      const parsed = await parseWorkflow(filePath, { workflowName: options.workflow, projectDir: path.dirname(filePath) });
      if (parsed.errors.length === 0) {
        const missing = missingParams(parsed.ast, params);
        if (missing.length) throw new MissingParamsError(parsed.ast.functionName, missing);
      }
    }

    const runId = randomUUID();
    const execPromise = executeWorkflow({
      runId,
      filePath,
      params,
      workflowName: options.workflow,
      production: options.production ?? false,
      includeTrace,
      mocks,
      debugController,
      onEvent,
    });

    // If debug mode is active and interactive, enter the debug REPL
    if (options.debug && debugController && process.stdin.isTTY) {
      const debugResult = await runDebugRepl(debugController, execPromise, options);
      if (timedOut) return;

      if (options.json) {
        process.stdout.write(
          JSON.stringify({
            success: true,
            result: debugResult,
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

    const result = await execPromise;

    if (timedOut) return; // Don't output if already timed out

    if (result.kind === 'yielded') {
      throw new Error(
        'fw run is not a durable coordinator and cannot persist a yielded continuation',
      );
    }

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

      // Hint when the workflow failed and no params were provided
      const resultObj = result.result as Record<string, unknown> | null | undefined;
      if (resultObj?.onFailure === true && !options.params && !options.paramsFile) {
        logger.newline();
        logger.warn(
          'Tip: use --params to provide input. Run `fw describe <file>` to see expected inputs.'
        );
      }

      // Show trace summary only when --trace is explicitly set (not on --stream, which already printed live)
      if (options.trace && !options.stream && result.trace && result.trace.length > 0) {
        logger.newline();
        logger.section('Trace');
        logger.log(`${result.trace.length} events captured`);

        // Show first few trace events as summary (skip events without nodeId)
        const meaningful = result.trace.filter((e) => e.data?.nodeId || e.data?.id);
        const preview = meaningful.slice(0, 5);
        for (const event of preview) {
          const nodeId = (event.data?.nodeId || event.data?.id || '') as string;
          logger.log(`  [${event.type}] ${nodeId}`);
        }
        if (meaningful.length > 5) {
          logger.log(`  ... and ${meaningful.length - 5} more events`);
        }
      }
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);

    // Try to extract validator error code from the error message for friendly formatting
    // Common pattern: "Validation error [CODE]: message" or errors with a .code property
    const errorObj = error as { code?: string; errors?: Array<{ code: string; message: string; node?: string }> };

    if (error instanceof MissingParamsError) {
      logger.error(`Workflow execution failed: ${errorMsg}`);
      logger.warn(`  Pass ${error.missing.length === 1 ? 'it' : 'them'} with --params '${JSON.stringify(Object.fromEntries(error.missing.map((k) => [k, '…'])))}' or --params-file <file>. \`fw describe <file>\` lists the parameters and their types.`);
    } else if (/durable gates? requires coordinator-verified/.test(errorMsg)) {
      // The engine's refusal is precise and unhelpful: what the person needs
      // is where a gated workflow can be run from.
      logger.error('Workflow execution failed: this workflow has durable gates, and `fw run` has nowhere to keep a run between one gate and the next.');
      logger.warn('  Run it where runs are kept: `fw console` (answer gates on the page), `fw serve` (over HTTP), or the `fw_run` MCP tool from an assistant. From code, `createLocalCoordinator()` -- see `fw docs library`.');
    } else if (errorObj.errors && Array.isArray(errorObj.errors)) {
      // Structured validation errors (from compileWorkflow)
      logger.error(`Workflow execution failed:`);
      for (const err of errorObj.errors) {
        const friendly = getFriendlyError(err);
        if (friendly) {
          logger.error(`  ${friendly.title}: ${friendly.explanation}`);
          logger.warn(`    How to fix: ${friendly.fix}`);
        } else {
          logger.error(`  - ${err.message}`);
        }
      }
    } else if (errorObj.code) {
      const friendly = getFriendlyError({ code: errorObj.code, message: errorMsg });
      if (friendly) {
        logger.error(`${friendly.title}: ${friendly.explanation}`);
        logger.warn(`  How to fix: ${friendly.fix}`);
      } else {
        logger.error(`Workflow execution failed: ${errorMsg}`);
      }
    } else {
      logger.error(`Workflow execution failed: ${errorMsg}`);
    }

    if (options.json) {
      // JSON mode: output structured error (0a fix: set exit code)
      process.stdout.write(
        JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n'
      );
      process.exitCode = 1;
    } else {
      // Non-json mode: don't re-throw to avoid duplicate error from wrapAction (0c fix)
      process.exitCode = 1;
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

const VALID_MOCK_KEYS = new Set(['events', 'invocations', 'agents', 'gates', 'fast']);

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
    const result = await parseWorkflow(filePath, { workflowName, projectDir: path.dirname(filePath) });
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
  execPromise: Promise<WorkflowExecutionOutcome>,
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
    if (firstResult.result.kind === 'yielded') {
      throw new Error(
        'fw run debug mode is not a durable coordinator and cannot persist a yielded continuation',
      );
    }
    return firstResult.result.result;
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
      ]);

      if (raceResult.type === 'completed') {
        const execResult = raceResult.result;
        if (execResult.kind === 'yielded') {
          fail(
            new Error(
              'fw run debug mode is not a durable coordinator and cannot persist a yielded continuation',
            ),
          );
          return;
        }
        if (!options.json) {
          logger.success(`\nWorkflow ${execResult.kind} in ${execResult.executionTime}ms`);
        }
        finish(execResult.result);
      } else if (raceResult.type === 'paused') {
        currentState = raceResult.state;
        printDebugState(currentState);
        rl.prompt();
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
