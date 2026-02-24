/**
 * Run command - execute a workflow file directly from the CLI
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { executeWorkflowFromFile } from '../../mcp/workflow-executor.js';
import type { ExecuteWorkflowResult, ExecutionTraceEvent } from '../../mcp/workflow-executor.js';
import { AgentChannel } from '../../mcp/agent-channel.js';
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
    // Determine trace inclusion:
    // - If --production is set, no trace (unless --trace explicitly set)
    // - If --trace is set, include trace
    // - Default: include trace in dev mode
    const includeTrace = options.stream || options.trace || !options.production;

    if (!options.json && mocks) {
      logger.info('Running with mock data');
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
      workflowName: options.workflow,
      production: options.production ?? false,
      includeTrace,
      mocks,
      agentChannel: channel,
      onEvent,
    });

    let result!: ExecuteWorkflowResult;
    let execDone = false;

    // Race loop: detect pauses, prompt user, resume
    while (!execDone) {
      const raceResult = await Promise.race([
        execPromise.then((r) => ({ type: 'completed' as const, result: r })),
        channel.onPause().then((req) => ({ type: 'paused' as const, request: req })),
      ]);

      if (raceResult.type === 'completed') {
        result = raceResult.result;
        execDone = true;
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
