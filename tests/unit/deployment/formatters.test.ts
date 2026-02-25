import { describe, it, expect } from 'vitest';
import {
  formatCliResponse,
  formatHttpResponse,
  formatLambdaResponse,
  formatCloudflareResponse,
  formatError,
} from '../../../src/deployment/core/formatters.js';
import type { WorkflowResponse } from '../../../src/deployment/types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSuccessResponse(overrides?: Partial<WorkflowResponse<string>>): WorkflowResponse<string> {
  return {
    success: true,
    workflowId: 'test-workflow',
    executionTime: 42,
    requestId: 'req-001',
    result: 'hello',
    ...overrides,
  };
}

function makeErrorResponse(overrides?: Partial<WorkflowResponse>): WorkflowResponse {
  return {
    success: false,
    workflowId: 'test-workflow',
    executionTime: 10,
    requestId: 'req-002',
    error: {
      message: 'Something went wrong',
      code: 'INTERNAL_ERROR',
    },
    ...overrides,
  };
}

// ── formatCliResponse ───────────────────────────────────────────────────────

describe('formatCliResponse', () => {
  describe('json mode', () => {
    it('returns valid JSON for a successful response', () => {
      const output = formatCliResponse(makeSuccessResponse(), { json: true });
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.workflow).toBe('test-workflow');
      expect(parsed.executionTime).toBe(42);
      expect(parsed.requestId).toBe('req-001');
      expect(parsed.result).toBe('hello');
    });

    it('returns valid JSON for an error response', () => {
      const output = formatCliResponse(makeErrorResponse(), { json: true });
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toBe('Something went wrong');
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
      expect(parsed.result).toBeUndefined();
    });

    it('includes traceCount when includeTrace is true and trace exists', () => {
      const response = makeSuccessResponse({
        trace: [
          { type: 'NODE_STARTED', timestamp: 1, data: { nodeId: 'a' } },
          { type: 'NODE_COMPLETED', timestamp: 2, data: { nodeId: 'a' } },
        ],
      });
      const output = formatCliResponse(response, { json: true, includeTrace: true });
      const parsed = JSON.parse(output);

      expect(parsed.traceCount).toBe(2);
    });

    it('omits traceCount when includeTrace is false', () => {
      const response = makeSuccessResponse({
        trace: [{ type: 'NODE_STARTED', timestamp: 1 }],
      });
      const output = formatCliResponse(response, { json: true, includeTrace: false });
      const parsed = JSON.parse(output);

      expect(parsed.traceCount).toBeUndefined();
    });

    it('omits traceCount when trace is absent', () => {
      const output = formatCliResponse(makeSuccessResponse(), { json: true, includeTrace: true });
      const parsed = JSON.parse(output);

      expect(parsed.traceCount).toBeUndefined();
    });
  });

  describe('human-readable mode', () => {
    it('prints success with workflow name and execution time', () => {
      const output = formatCliResponse(makeSuccessResponse());

      expect(output).toContain('Workflow "test-workflow" completed in 42ms');
      expect(output).toContain('Result:');
      expect(output).toContain('"hello"');
    });

    it('prints failure with error message and code', () => {
      const response = makeErrorResponse({
        error: { message: 'Oops', code: 'VALIDATION_ERROR' },
      });
      const output = formatCliResponse(response);

      expect(output).toContain('Workflow "test-workflow" failed');
      expect(output).toContain('Error: Oops');
      expect(output).toContain('Code: VALIDATION_ERROR');
    });

    it('shows stack trace when present in error', () => {
      const response = makeErrorResponse({
        error: { message: 'Oops', code: 'INTERNAL_ERROR', stack: 'Error: Oops\n    at foo.ts:1' },
      });
      const output = formatCliResponse(response);

      expect(output).toContain('Stack trace:');
      expect(output).toContain('at foo.ts:1');
    });

    it('shows "Unknown error" when error message is missing', () => {
      const response = makeErrorResponse({ error: undefined });
      const output = formatCliResponse(response);

      expect(output).toContain('Error: Unknown error');
    });

    it('includes trace summary when includeTrace is true', () => {
      const response = makeSuccessResponse({
        trace: [
          { type: 'NODE_STARTED', timestamp: 1, data: { nodeId: 'step1' } },
          { type: 'NODE_COMPLETED', timestamp: 2, data: { nodeId: 'step1' } },
        ],
      });
      const output = formatCliResponse(response, { includeTrace: true });

      expect(output).toContain('Trace:');
      expect(output).toContain('2 events captured');
      expect(output).toContain('[NODE_STARTED] step1');
      expect(output).toContain('[NODE_COMPLETED] step1');
    });

    it('shows "and N more events" when trace exceeds 5 entries', () => {
      const trace = Array.from({ length: 8 }, (_, i) => ({
        type: 'EVENT',
        timestamp: i,
        data: { nodeId: `n${i}` },
      }));
      const response = makeSuccessResponse({ trace });
      const output = formatCliResponse(response, { includeTrace: true });

      expect(output).toContain('8 events captured');
      expect(output).toContain('... and 3 more events');
    });

    it('omits trace section when includeTrace is false', () => {
      const response = makeSuccessResponse({
        trace: [{ type: 'EVENT', timestamp: 1, data: { nodeId: 'a' } }],
      });
      const output = formatCliResponse(response);

      expect(output).not.toContain('Trace:');
    });

    it('omits trace section when trace is empty', () => {
      const response = makeSuccessResponse({ trace: [] });
      const output = formatCliResponse(response, { includeTrace: true });

      expect(output).not.toContain('Trace:');
    });

    it('handles trace event without nodeId in data', () => {
      const response = makeSuccessResponse({
        trace: [{ type: 'GLOBAL_EVENT', timestamp: 1, data: {} }],
      });
      const output = formatCliResponse(response, { includeTrace: true });

      expect(output).toContain('[GLOBAL_EVENT]');
    });
  });
});

// ── formatHttpResponse ──────────────────────────────────────────────────────

describe('formatHttpResponse', () => {
  it('returns 200 for successful responses', () => {
    const result = formatHttpResponse(makeSuccessResponse());

    expect(result.statusCode).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.workflow).toBe('test-workflow');
    expect(result.body.result).toBe('hello');
    expect(result.body.executionTime).toBe(42);
  });

  it('sets standard headers', () => {
    const result = formatHttpResponse(makeSuccessResponse());

    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers['X-Request-Id']).toBe('req-001');
    expect(result.headers['X-Execution-Time']).toBe('42ms');
  });

  it('includes trace in success body when present', () => {
    const trace = [{ type: 'NODE_STARTED', timestamp: 1, data: { nodeId: 'a' } }];
    const result = formatHttpResponse(makeSuccessResponse({ trace }));

    expect(result.body.trace).toEqual(trace);
  });

  it('omits trace from success body when absent', () => {
    const result = formatHttpResponse(makeSuccessResponse());

    expect(result.body.trace).toBeUndefined();
  });

  it('returns 404 for WORKFLOW_NOT_FOUND', () => {
    const response = makeErrorResponse({
      error: { message: 'Not found', code: 'WORKFLOW_NOT_FOUND' },
    });
    const result = formatHttpResponse(response);

    expect(result.statusCode).toBe(404);
    expect(result.body.success).toBe(false);
    expect(result.body.error).toEqual({ message: 'Not found', code: 'WORKFLOW_NOT_FOUND' });
  });

  it('returns 400 for VALIDATION_ERROR', () => {
    const response = makeErrorResponse({
      error: { message: 'Bad input', code: 'VALIDATION_ERROR' },
    });
    const result = formatHttpResponse(response);

    expect(result.statusCode).toBe(400);
  });

  it('returns 504 for TIMEOUT', () => {
    const response = makeErrorResponse({
      error: { message: 'Timed out', code: 'TIMEOUT' },
    });
    const result = formatHttpResponse(response);

    expect(result.statusCode).toBe(504);
  });

  it('returns 500 for unknown error codes', () => {
    const response = makeErrorResponse({
      error: { message: 'Crash', code: 'INTERNAL_ERROR' },
    });
    const result = formatHttpResponse(response);

    expect(result.statusCode).toBe(500);
  });

  it('returns 500 for CANCELLED (no special mapping)', () => {
    const response = makeErrorResponse({
      error: { message: 'Cancelled', code: 'CANCELLED' },
    });
    const result = formatHttpResponse(response);

    expect(result.statusCode).toBe(500);
  });

  it('returns 500 for EXECUTION_ERROR (no special mapping)', () => {
    const response = makeErrorResponse({
      error: { message: 'Execution failed', code: 'EXECUTION_ERROR' },
    });
    const result = formatHttpResponse(response);

    expect(result.statusCode).toBe(500);
  });

  it('includes error details in body', () => {
    const response = makeErrorResponse();
    const result = formatHttpResponse(response);

    expect(result.body.workflow).toBe('test-workflow');
    expect(result.body.executionTime).toBe(10);
  });
});

// ── formatLambdaResponse ────────────────────────────────────────────────────

describe('formatLambdaResponse', () => {
  it('stringifies the body from formatHttpResponse', () => {
    const result = formatLambdaResponse(makeSuccessResponse());

    expect(typeof result.body).toBe('string');
    const parsed = JSON.parse(result.body);
    expect(parsed.success).toBe(true);
    expect(parsed.result).toBe('hello');
  });

  it('preserves statusCode from formatHttpResponse', () => {
    const response = makeErrorResponse({
      error: { message: 'Not found', code: 'WORKFLOW_NOT_FOUND' },
    });
    const result = formatLambdaResponse(response);

    expect(result.statusCode).toBe(404);
  });

  it('preserves headers from formatHttpResponse', () => {
    const result = formatLambdaResponse(makeSuccessResponse());

    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers['X-Request-Id']).toBe('req-001');
  });
});

// ── formatCloudflareResponse ────────────────────────────────────────────────

describe('formatCloudflareResponse', () => {
  it('returns stringified body and init with status', () => {
    const result = formatCloudflareResponse(makeSuccessResponse());

    expect(typeof result.body).toBe('string');
    const parsed = JSON.parse(result.body);
    expect(parsed.success).toBe(true);

    expect(result.init.status).toBe(200);
  });

  it('passes headers through init', () => {
    const result = formatCloudflareResponse(makeSuccessResponse());

    expect(result.init.headers).toBeDefined();
    const headers = result.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Request-Id']).toBe('req-001');
  });

  it('maps error codes to correct status', () => {
    const response = makeErrorResponse({
      error: { message: 'Bad', code: 'VALIDATION_ERROR' },
    });
    const result = formatCloudflareResponse(response);

    expect(result.init.status).toBe(400);
  });
});

// ── formatError ─────────────────────────────────────────────────────────────

describe('formatError', () => {
  it('extracts message from Error instances', () => {
    const result = formatError(new Error('Something broke'));

    expect(result.message).toBe('Something broke');
  });

  it('converts non-Error values to string', () => {
    const result = formatError('plain string error');

    expect(result.message).toBe('plain string error');
  });

  it('converts numeric values to string', () => {
    const result = formatError(42);

    expect(result.message).toBe('42');
  });

  it('includes stack trace for Error instances in non-production', () => {
    const err = new Error('test');
    const result = formatError(err);

    expect(result.stack).toBeDefined();
    expect(result.stack).toContain('test');
  });

  it('hides stack trace when production is true', () => {
    const err = new Error('test');
    const result = formatError(err, { production: true });

    expect(result.stack).toBeUndefined();
  });

  it('has no stack for non-Error values regardless of production flag', () => {
    const result = formatError('oops', { production: false });

    expect(result.stack).toBeUndefined();
  });

  describe('error code detection', () => {
    it('detects WORKFLOW_NOT_FOUND from "not found"', () => {
      expect(formatError(new Error('Workflow not found')).code).toBe('WORKFLOW_NOT_FOUND');
    });

    it('detects TIMEOUT from "timeout"', () => {
      expect(formatError(new Error('Request timeout exceeded')).code).toBe('TIMEOUT');
    });

    it('detects VALIDATION_ERROR from "validation"', () => {
      expect(formatError(new Error('Input validation failed')).code).toBe('VALIDATION_ERROR');
    });

    it('detects VALIDATION_ERROR from "invalid"', () => {
      expect(formatError(new Error('invalid parameter type')).code).toBe('VALIDATION_ERROR');
    });

    it('detects CANCELLED from "cancelled"', () => {
      expect(formatError(new Error('Operation cancelled by user')).code).toBe('CANCELLED');
    });

    it('detects CANCELLED from "abort"', () => {
      expect(formatError(new Error('Request abort signal received')).code).toBe('CANCELLED');
    });

    it('defaults to INTERNAL_ERROR for unrecognized messages', () => {
      expect(formatError(new Error('Something unexpected happened')).code).toBe('INTERNAL_ERROR');
    });

    it('defaults to INTERNAL_ERROR for empty message', () => {
      expect(formatError(new Error('')).code).toBe('INTERNAL_ERROR');
    });
  });
});
