/**
 * Type definitions for the webhook server
 */

/**
 * Represents a workflow exposed as an HTTP endpoint
 */
export interface WorkflowEndpoint {
  /** Workflow name (used in URL path) */
  name: string;
  /** Function name in the source file */
  functionName: string;
  /** Path to the source file */
  filePath: string;
  /** HTTP method for the endpoint */
  method: 'POST' | 'GET';
  /** URL path for the endpoint */
  path: string;
  /** JSON Schema for input parameters */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema for output */
  outputSchema?: Record<string, unknown>;
  /** Workflow description */
  description?: string;
}

/**
 * Configuration for the webhook server
 */
export interface WebhookServerConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host: string;
  /** Directory containing workflow files */
  workflowDir: string;
  /** Enable file watching for hot reload */
  watchEnabled: boolean;
  /** CORS origin configuration */
  corsOrigin: string | string[];
  /** Production mode (no trace events) */
  production: boolean;
  /** Precompile workflows on startup */
  precompile: boolean;
  /** Enable Swagger UI at /docs and OpenAPI spec at /openapi.json */
  swaggerEnabled?: boolean;
}

/**
 * Result of workflow execution via HTTP
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Name of the executed workflow */
  workflow: string;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Execution result (if successful) */
  result?: unknown;
  /** Error details (if failed) */
  error?: {
    message: string;
    stack?: string;
  };
  /** Execution trace events (if requested) */
  trace?: Array<{
    type: string;
    timestamp: number;
    data?: unknown;
  }>;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  workflows: number;
  uptime?: number;
}

/**
 * Workflow list response
 */
export interface WorkflowListResponse {
  count: number;
  workflows: Array<{
    name: string;
    path: string;
    method: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }>;
}
