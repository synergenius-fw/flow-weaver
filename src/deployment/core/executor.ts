/**
 * Unified workflow executor
 *
 * Provides a single entry point for executing workflows across all contexts.
 */

import { randomUUID } from 'crypto';
import { executeWorkflowFromFile } from '../../mcp/workflow-executor.js';
import { WorkflowRegistry } from '../../server/workflow-registry.js';
import type {
  WorkflowRequest,
  WorkflowResponse,
  ValidationResult,
  ExecutionContext,
  WorkflowError,
  WorkflowErrorCode,
} from '../types.js';

/**
 * Options for the unified executor
 */
export interface ExecutorOptions {
  /** Workflow registry for resolving workflows */
  registry?: WorkflowRegistry;
  /** Default timeout in milliseconds */
  defaultTimeout?: number;
  /** Production mode - disables trace by default */
  production?: boolean;
}

/**
 * Unified workflow executor
 *
 * Provides consistent execution behavior across CLI, HTTP, and serverless contexts.
 */
export class UnifiedWorkflowExecutor {
  private registry?: WorkflowRegistry;
  private defaultTimeout: number;
  private production: boolean;

  constructor(options: ExecutorOptions = {}) {
    this.registry = options.registry;
    this.defaultTimeout = options.defaultTimeout ?? 30000;
    this.production = options.production ?? false;
  }

  /**
   * Execute a workflow with the given request
   */
  async execute<T = unknown>(request: WorkflowRequest): Promise<WorkflowResponse<T>> {
    const startTime = Date.now();
    const requestId = request.context.requestId || randomUUID();

    try {
      // Resolve the workflow
      const workflow = await this.resolveWorkflow(request.workflowId);
      if (!workflow) {
        return this.createErrorResponse<T>(
          request.workflowId,
          requestId,
          'WORKFLOW_NOT_FOUND',
          `Workflow "${request.workflowId}" not found`,
          startTime
        );
      }

      // Execute with timeout if specified
      const timeout = request.context.timeout ?? this.defaultTimeout;
      const includeTrace = request.context.includeTrace && !this.production;

      const result = await this.executeWithTimeout(
        workflow.filePath,
        request.params,
        {
          workflowName: workflow.functionName,
          production: this.production || request.context.environment === 'production',
          includeTrace,
        },
        timeout,
        request.abortSignal
      );

      return {
        success: true,
        workflowId: request.workflowId,
        result: result.result as T,
        executionTime: Date.now() - startTime,
        trace: includeTrace ? result.trace : undefined,
        requestId,
      };
    } catch (error) {
      // Check for specific error types
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('abort')) {
          return this.createErrorResponse<T>(
            request.workflowId,
            requestId,
            'CANCELLED',
            'Workflow execution was cancelled',
            startTime
          );
        }

        if (error.message.includes('timeout') || error.message.includes('timed out')) {
          return this.createErrorResponse<T>(
            request.workflowId,
            requestId,
            'TIMEOUT',
            `Workflow execution timed out after ${request.context.timeout ?? this.defaultTimeout}ms`,
            startTime
          );
        }

        // Check if it's a validation error
        if (error.message.includes('validation') || error.message.includes('invalid')) {
          return this.createErrorResponse<T>(
            request.workflowId,
            requestId,
            'VALIDATION_ERROR',
            error.message,
            startTime,
            error.stack
          );
        }

        // General execution error
        return this.createErrorResponse<T>(
          request.workflowId,
          requestId,
          'EXECUTION_ERROR',
          error.message,
          startTime,
          error.stack
        );
      }

      // Unknown error
      return this.createErrorResponse<T>(
        request.workflowId,
        requestId,
        'INTERNAL_ERROR',
        String(error),
        startTime
      );
    }
  }

  /**
   * Execute a workflow directly from a file path
   */
  async executeFromFile<T = unknown>(
    filePath: string,
    params: Record<string, unknown>,
    context: Partial<ExecutionContext> = {}
  ): Promise<WorkflowResponse<T>> {
    const fullContext: ExecutionContext = {
      source: context.source ?? 'cli',
      environment: context.environment ?? 'development',
      requestId: context.requestId ?? randomUUID(),
      includeTrace: context.includeTrace ?? true,
      timeout: context.timeout,
    };

    const request: WorkflowRequest = {
      workflowId: filePath,
      params,
      context: fullContext,
    };

    return this.executeFileDirectly<T>(filePath, request);
  }

  /**
   * Execute a file directly without registry lookup
   */
  private async executeFileDirectly<T>(
    filePath: string,
    request: WorkflowRequest
  ): Promise<WorkflowResponse<T>> {
    const startTime = Date.now();
    const requestId = request.context.requestId;

    try {
      const timeout = request.context.timeout ?? this.defaultTimeout;
      const includeTrace = request.context.includeTrace && !this.production;

      const result = await this.executeWithTimeout(
        filePath,
        request.params,
        {
          production: this.production || request.context.environment === 'production',
          includeTrace,
        },
        timeout,
        request.abortSignal
      );

      return {
        success: true,
        workflowId: result.functionName,
        result: result.result as T,
        executionTime: Date.now() - startTime,
        trace: includeTrace ? result.trace : undefined,
        requestId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      return this.createErrorResponse<T>(
        request.workflowId,
        requestId,
        'EXECUTION_ERROR',
        errorMessage,
        startTime,
        errorStack
      );
    }
  }

  /**
   * Resolve a workflow from the registry
   */
  private async resolveWorkflow(workflowId: string) {
    if (!this.registry) {
      return null;
    }

    return this.registry.getEndpoint(workflowId);
  }

  /**
   * Execute workflow with timeout support
   */
  private async executeWithTimeout(
    filePath: string,
    params: Record<string, unknown>,
    options: {
      workflowName?: string;
      production?: boolean;
      includeTrace?: boolean;
    },
    timeout: number,
    abortSignal?: AbortSignal
  ) {
    // Create a promise that rejects on timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Workflow execution timed out after ${timeout}ms`));
      }, timeout);

      // Clear timeout if abort signal fires
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Workflow execution was cancelled'));
        });
      }
    });

    // Race between execution and timeout
    return Promise.race([executeWorkflowFromFile(filePath, params, options), timeoutPromise]);
  }

  /**
   * Create a standardized error response
   */
  private createErrorResponse<T>(
    workflowId: string,
    requestId: string,
    code: WorkflowErrorCode,
    message: string,
    startTime: number,
    stack?: string
  ): WorkflowResponse<T> {
    const error: WorkflowError = {
      code,
      message,
    };

    // Only include stack in non-production environments
    if (stack && !this.production) {
      error.stack = stack;
    }

    return {
      success: false,
      workflowId,
      error,
      executionTime: Date.now() - startTime,
      requestId,
    };
  }

  /**
   * Validate a workflow request
   */
  validateRequest(request: WorkflowRequest): ValidationResult {
    const errors = [];

    if (!request.workflowId) {
      errors.push({
        path: 'workflowId',
        message: 'Workflow ID is required',
      });
    }

    if (request.params && typeof request.params !== 'object') {
      errors.push({
        path: 'params',
        message: 'Params must be an object',
        expected: 'object',
        actual: typeof request.params,
      });
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

/**
 * Create a new executor instance
 */
export function createExecutor(options?: ExecutorOptions): UnifiedWorkflowExecutor {
  return new UnifiedWorkflowExecutor(options);
}
