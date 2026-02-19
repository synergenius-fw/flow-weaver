/**
 * Response formatters for different output contexts
 *
 * Transforms unified WorkflowResponse into format-specific outputs.
 */

import type { WorkflowResponse } from '../types.js';

/**
 * Format response for CLI output
 */
export interface CliOutputOptions {
  /** Output as JSON */
  json?: boolean;
  /** Include trace summary */
  includeTrace?: boolean;
  /** Color output */
  color?: boolean;
}

/**
 * Format response for CLI consumption
 */
export function formatCliResponse<T>(
  response: WorkflowResponse<T>,
  options: CliOutputOptions = {}
): string {
  if (options.json) {
    return formatJsonResponse(response, options.includeTrace);
  }

  return formatHumanReadableResponse(response, options);
}

/**
 * Format response as JSON string
 */
function formatJsonResponse<T>(response: WorkflowResponse<T>, includeTrace?: boolean): string {
  const output: Record<string, unknown> = {
    success: response.success,
    workflow: response.workflowId,
    executionTime: response.executionTime,
    requestId: response.requestId,
  };

  if (response.success) {
    output.result = response.result;
    if (includeTrace && response.trace) {
      output.traceCount = response.trace.length;
    }
  } else {
    output.error = response.error;
  }

  return JSON.stringify(output, null, 2);
}

/**
 * Format response for human-readable CLI output
 */
function formatHumanReadableResponse<T>(
  response: WorkflowResponse<T>,
  options: CliOutputOptions
): string {
  const lines: string[] = [];

  if (response.success) {
    lines.push(`Workflow "${response.workflowId}" completed in ${response.executionTime}ms`);
    lines.push('');
    lines.push('Result:');
    lines.push(JSON.stringify(response.result, null, 2));

    if (options.includeTrace && response.trace && response.trace.length > 0) {
      lines.push('');
      lines.push('Trace:');
      lines.push(`${response.trace.length} events captured`);

      // Show first few trace events as summary
      const preview = response.trace.slice(0, 5);
      for (const event of preview) {
        const nodeId = (event.data as Record<string, unknown>)?.nodeId || '';
        lines.push(`  [${event.type}] ${nodeId}`);
      }
      if (response.trace.length > 5) {
        lines.push(`  ... and ${response.trace.length - 5} more events`);
      }
    }
  } else {
    lines.push(`Workflow "${response.workflowId}" failed`);
    lines.push('');
    lines.push(`Error: ${response.error?.message || 'Unknown error'}`);
    if (response.error?.code) {
      lines.push(`Code: ${response.error.code}`);
    }
    if (response.error?.stack) {
      lines.push('');
      lines.push('Stack trace:');
      lines.push(response.error.stack);
    }
  }

  return lines.join('\n');
}

/**
 * Format response for HTTP (returns object suitable for JSON response)
 */
export function formatHttpResponse<T>(response: WorkflowResponse<T>): {
  statusCode: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': response.requestId,
    'X-Execution-Time': `${response.executionTime}ms`,
  };

  if (response.success) {
    return {
      statusCode: 200,
      body: {
        success: true,
        workflow: response.workflowId,
        result: response.result,
        executionTime: response.executionTime,
        ...(response.trace && { trace: response.trace }),
      },
      headers,
    };
  }

  // Determine status code based on error
  let statusCode = 500;
  if (response.error?.code === 'WORKFLOW_NOT_FOUND') {
    statusCode = 404;
  } else if (response.error?.code === 'VALIDATION_ERROR') {
    statusCode = 400;
  } else if (response.error?.code === 'TIMEOUT') {
    statusCode = 504;
  }

  return {
    statusCode,
    body: {
      success: false,
      workflow: response.workflowId,
      error: response.error,
      executionTime: response.executionTime,
    },
    headers,
  };
}

/**
 * Format response for AWS Lambda (API Gateway response format)
 */
export function formatLambdaResponse<T>(response: WorkflowResponse<T>): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const httpResponse = formatHttpResponse(response);

  return {
    statusCode: httpResponse.statusCode,
    headers: httpResponse.headers,
    body: JSON.stringify(httpResponse.body),
  };
}

/**
 * Format response for Cloudflare Workers (returns Response object constructor args)
 */
export function formatCloudflareResponse<T>(response: WorkflowResponse<T>): {
  body: string;
  init: ResponseInit;
} {
  const httpResponse = formatHttpResponse(response);

  return {
    body: JSON.stringify(httpResponse.body),
    init: {
      status: httpResponse.statusCode,
      headers: httpResponse.headers,
    },
  };
}

/**
 * Format error for consistent error responses
 */
export function formatError(
  error: unknown,
  context: {
    workflowId?: string;
    requestId?: string;
    production?: boolean;
  } = {}
): {
  message: string;
  code: string;
  stack?: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const stack = !context.production && error instanceof Error ? error.stack : undefined;

  // Try to determine error code from message
  let code = 'INTERNAL_ERROR';
  if (message.includes('not found')) {
    code = 'WORKFLOW_NOT_FOUND';
  } else if (message.includes('timeout')) {
    code = 'TIMEOUT';
  } else if (message.includes('validation') || message.includes('invalid')) {
    code = 'VALIDATION_ERROR';
  } else if (message.includes('cancelled') || message.includes('abort')) {
    code = 'CANCELLED';
  }

  return {
    message,
    code,
    stack,
  };
}
