/**
 * Request adapters for normalizing input from different sources
 *
 * Each adapter transforms source-specific input into a unified WorkflowRequest.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  WorkflowRequest,
  ExecutionContext,
  ValidationResult,
  ValidationError,
  CliInput,
  HttpInput,
  LambdaInput,
  VercelInput,
  CloudflareInput,
  Environment,
} from '../types.js';

/**
 * Request adapter interface
 */
export interface RequestAdapter<TInput> {
  /**
   * Parse source input into a unified WorkflowRequest
   */
  parseRequest(input: TInput): WorkflowRequest;

  /**
   * Validate the parsed request
   */
  validate(request: WorkflowRequest): ValidationResult;
}

/**
 * Base adapter with shared validation logic
 */
abstract class BaseRequestAdapter<TInput> implements RequestAdapter<TInput> {
  abstract parseRequest(input: TInput): WorkflowRequest;

  validate(request: WorkflowRequest): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate workflowId
    if (!request.workflowId || typeof request.workflowId !== 'string') {
      errors.push({
        path: 'workflowId',
        message: 'Workflow ID is required and must be a string',
        expected: 'string',
        actual: typeof request.workflowId,
      });
    }

    // Validate params is an object
    if (request.params !== null && typeof request.params !== 'object') {
      errors.push({
        path: 'params',
        message: 'Params must be an object',
        expected: 'object',
        actual: typeof request.params,
      });
    }

    // Validate context
    if (!request.context) {
      errors.push({
        path: 'context',
        message: 'Execution context is required',
      });
    } else {
      if (!request.context.requestId) {
        errors.push({
          path: 'context.requestId',
          message: 'Request ID is required',
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Create a default execution context
   */
  protected createContext(
    source: WorkflowRequest['context']['source'],
    options: {
      requestId?: string;
      includeTrace?: boolean;
      timeout?: number;
      environment?: Environment;
    } = {}
  ): ExecutionContext {
    return {
      source,
      environment: options.environment ?? this.detectEnvironment(),
      requestId: options.requestId ?? randomUUID(),
      includeTrace: options.includeTrace ?? true,
      timeout: options.timeout,
    };
  }

  /**
   * Detect runtime environment
   */
  protected detectEnvironment(): Environment {
    const nodeEnv = process.env.NODE_ENV?.toLowerCase();
    if (nodeEnv === 'production' || nodeEnv === 'prod') {
      return 'production';
    }
    if (nodeEnv === 'staging' || nodeEnv === 'stage') {
      return 'staging';
    }
    return 'development';
  }
}

/**
 * CLI request adapter
 *
 * Parses CLI command input into a WorkflowRequest
 */
export class CliRequestAdapter extends BaseRequestAdapter<CliInput> {
  parseRequest(input: CliInput): WorkflowRequest {
    // Parse params from JSON string or file
    let params: Record<string, unknown> = {};

    if (input.params) {
      try {
        params = JSON.parse(input.params);
      } catch {
        throw new Error(`Invalid JSON in params: ${input.params}`);
      }
    } else if (input.paramsFile) {
      const paramsFilePath = path.resolve(input.paramsFile);
      if (!fs.existsSync(paramsFilePath)) {
        throw new Error(`Params file not found: ${paramsFilePath}`);
      }
      try {
        const content = fs.readFileSync(paramsFilePath, 'utf8');
        params = JSON.parse(content);
      } catch {
        throw new Error(`Failed to parse params file: ${input.paramsFile}`);
      }
    }

    // Determine trace inclusion
    const includeTrace = input.trace ?? !input.production;

    return {
      workflowId: input.workflowName || this.extractWorkflowId(input.filePath),
      params,
      context: this.createContext('cli', {
        includeTrace,
        timeout: input.timeout,
        environment: input.production ? 'production' : 'development',
      }),
    };
  }

  /**
   * Extract workflow ID from file path (uses filename without extension)
   */
  private extractWorkflowId(filePath: string): string {
    const basename = path.basename(filePath, path.extname(filePath));
    return basename;
  }
}

/**
 * HTTP request adapter (for Fastify/Express-like servers)
 *
 * Parses HTTP request into a WorkflowRequest
 */
export class HttpRequestAdapter extends BaseRequestAdapter<HttpInput> {
  parseRequest(input: HttpInput): WorkflowRequest {
    const workflowId = input.params.name || input.params.workflow || '';
    const includeTrace = input.query.trace === 'true';

    return {
      workflowId,
      params: input.body || {},
      context: this.createContext('http', {
        requestId: input.headers['x-request-id'] as string | undefined,
        includeTrace,
      }),
    };
  }
}

/**
 * AWS Lambda request adapter
 *
 * Parses API Gateway event into a WorkflowRequest
 */
export class LambdaRequestAdapter extends BaseRequestAdapter<LambdaInput> {
  parseRequest(input: LambdaInput): WorkflowRequest {
    // Parse body
    let params: Record<string, unknown> = {};
    if (typeof input.body === 'string') {
      try {
        params = JSON.parse(input.body || '{}');
      } catch {
        params = {};
      }
    } else if (input.body && typeof input.body === 'object') {
      params = input.body;
    }

    // Get workflow ID from path parameters
    const workflowId =
      input.pathParameters?.name ||
      input.pathParameters?.workflow ||
      input.pathParameters?.id ||
      '';

    const includeTrace = input.queryStringParameters?.trace === 'true';
    const isProduction =
      input.requestContext?.stage === 'prod' || input.requestContext?.stage === 'production';

    return {
      workflowId,
      params,
      context: this.createContext('lambda', {
        requestId: input.requestContext?.requestId,
        includeTrace,
        environment: isProduction ? 'production' : 'development',
      }),
    };
  }
}

/**
 * Vercel serverless function request adapter
 */
export class VercelRequestAdapter extends BaseRequestAdapter<VercelInput> {
  parseRequest(input: VercelInput): WorkflowRequest {
    // Workflow ID comes from the file-based routing in Vercel
    // The caller should provide it, or we extract from query
    const workflowId = (input.query.workflow as string) || (input.query.name as string) || '';

    const includeTrace = input.query.trace === 'true';

    return {
      workflowId,
      params: input.body || {},
      context: this.createContext('vercel', {
        requestId: input.headers['x-vercel-id'] as string | undefined,
        includeTrace,
      }),
    };
  }
}

/**
 * Cloudflare Workers request adapter
 */
export class CloudflareRequestAdapter extends BaseRequestAdapter<CloudflareInput> {
  async parseRequestAsync(input: CloudflareInput): Promise<WorkflowRequest> {
    // Parse body
    let params: Record<string, unknown> = {};
    try {
      params = await input.request.json();
    } catch {
      params = {};
    }

    // Extract workflow ID from URL path
    const url = new URL(input.request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const workflowId = pathParts[pathParts.length - 1] || '';

    const includeTrace = url.searchParams.get('trace') === 'true';

    return {
      workflowId,
      params,
      context: this.createContext('cloudflare', {
        requestId: input.request.headers.get('cf-ray') || undefined,
        includeTrace,
      }),
    };
  }

  // Sync version throws - use parseRequestAsync for Cloudflare
  parseRequest(_input: CloudflareInput): WorkflowRequest {
    throw new Error('Use parseRequestAsync for Cloudflare Workers');
  }
}

/**
 * Create the appropriate adapter for a given source
 */
export function createAdapter(source: 'cli'): CliRequestAdapter;
export function createAdapter(source: 'http'): HttpRequestAdapter;
export function createAdapter(source: 'lambda'): LambdaRequestAdapter;
export function createAdapter(source: 'vercel'): VercelRequestAdapter;
export function createAdapter(source: 'cloudflare'): CloudflareRequestAdapter;
export function createAdapter(
  source: 'cli' | 'http' | 'lambda' | 'vercel' | 'cloudflare'
): RequestAdapter<unknown> {
  switch (source) {
    case 'cli':
      return new CliRequestAdapter();
    case 'http':
      return new HttpRequestAdapter();
    case 'lambda':
      return new LambdaRequestAdapter();
    case 'vercel':
      return new VercelRequestAdapter();
    case 'cloudflare':
      return new CloudflareRequestAdapter();
  }
}
