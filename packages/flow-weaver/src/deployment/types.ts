/**
 * Shared types for the deployment system
 *
 * These types provide a unified abstraction for workflow execution
 * across CLI, HTTP, and serverless contexts.
 */

import type { ExecutionTraceEvent } from '../mcp/workflow-executor.js';

/**
 * Source of a workflow execution request
 */
export type ExecutionSource = 'cli' | 'http' | 'lambda' | 'vercel' | 'cloudflare';

/**
 * Runtime environment
 */
export type Environment = 'development' | 'staging' | 'production';

/**
 * Execution context - metadata about the execution environment
 */
export interface ExecutionContext {
  /** Where the request originated from */
  source: ExecutionSource;
  /** Current runtime environment */
  environment: Environment;
  /** Unique request identifier for tracing */
  requestId: string;
  /** Whether to include execution trace events */
  includeTrace: boolean;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Normalized workflow request - unified across CLI, HTTP, serverless
 */
export interface WorkflowRequest {
  /** Workflow identifier (name or function name) */
  workflowId: string;
  /** Input parameters for the workflow */
  params: Record<string, unknown>;
  /** Execution context */
  context: ExecutionContext;
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Unified workflow response
 */
export interface WorkflowResponse<T = unknown> {
  /** Whether execution succeeded */
  success: boolean;
  /** Name of the executed workflow */
  workflowId: string;
  /** Execution result (if successful) */
  result?: T;
  /** Error details (if failed) */
  error?: WorkflowError;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Execution trace events (if requested) */
  trace?: ExecutionTraceEvent[];
  /** Request identifier for correlation */
  requestId: string;
}

/**
 * Standardized error format
 */
export interface WorkflowError {
  /** Error code for programmatic handling */
  code: WorkflowErrorCode;
  /** Human-readable error message */
  message: string;
  /** Stack trace (in non-production environments) */
  stack?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * Standard error codes
 */
export type WorkflowErrorCode =
  | 'WORKFLOW_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'EXECUTION_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';

/**
 * Validation result for request validation
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors (if any) */
  errors?: ValidationError[];
}

/**
 * Individual validation error
 */
export interface ValidationError {
  /** Path to the invalid field (e.g., 'params.email') */
  path: string;
  /** Error message */
  message: string;
  /** Expected type or value */
  expected?: string;
  /** Actual type or value */
  actual?: string;
}

/**
 * Input from CLI command
 */
export interface CliInput {
  /** Path to the workflow file */
  filePath: string;
  /** Specific workflow name to execute */
  workflowName?: string;
  /** Input parameters as JSON string */
  params?: string;
  /** Path to JSON file containing parameters */
  paramsFile?: string;
  /** Include execution trace */
  trace?: boolean;
  /** Production mode (no trace) */
  production?: boolean;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Input from HTTP request (Fastify-like)
 */
export interface HttpInput {
  /** Request params (URL path parameters) */
  params: Record<string, string>;
  /** Request body */
  body: Record<string, unknown>;
  /** Query string parameters */
  query: Record<string, string>;
  /** Request headers */
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Input from AWS Lambda
 */
export interface LambdaInput {
  /** Raw event body (JSON string or parsed object) */
  body?: string | Record<string, unknown>;
  /** Path parameters */
  pathParameters?: Record<string, string>;
  /** Query string parameters */
  queryStringParameters?: Record<string, string>;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request context */
  requestContext?: {
    requestId?: string;
    stage?: string;
  };
}

/**
 * Input from Vercel serverless function
 */
export interface VercelInput {
  /** Request method */
  method: string;
  /** Request body (already parsed) */
  body: Record<string, unknown>;
  /** Query parameters */
  query: Record<string, string | string[]>;
  /** Request headers */
  headers: Record<string, string | string[]>;
}

/**
 * Input from Cloudflare Worker
 */
export interface CloudflareInput {
  /** Request object */
  request: {
    method: string;
    url: string;
    headers: Headers;
    json: () => Promise<Record<string, unknown>>;
  };
}

/**
 * Generic adapter input type
 */
export type AdapterInput = CliInput | HttpInput | LambdaInput | VercelInput | CloudflareInput;
