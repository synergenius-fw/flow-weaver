/**
 * Tests for UnifiedWorkflowExecutor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnifiedWorkflowExecutor, createExecutor } from '../../../src/deployment/core/executor.js';
import type { WorkflowRequest, ExecutionContext } from '../../../src/deployment/types.js';

// Mock the underlying workflow executor so we can control what it returns
vi.mock('../../../src/mcp/workflow-executor.js', () => ({
  executeWorkflowFromFile: vi.fn(),
}));

// Mock the workflow registry module
vi.mock('../../../src/server/workflow-registry.js', () => ({
  WorkflowRegistry: vi.fn(),
}));

import { executeWorkflowFromFile } from '../../../src/mcp/workflow-executor.js';

const mockedExecute = vi.mocked(executeWorkflowFromFile);

function makeRequest(overrides: Partial<WorkflowRequest> = {}): WorkflowRequest {
  return {
    workflowId: 'test-workflow',
    params: {},
    context: {
      source: 'cli',
      environment: 'development',
      requestId: 'req-001',
      includeTrace: true,
    },
    ...overrides,
  };
}

describe('UnifiedWorkflowExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createExecutor', () => {
    it('should create an executor with default options', () => {
      const executor = createExecutor();
      expect(executor).toBeInstanceOf(UnifiedWorkflowExecutor);
    });

    it('should create an executor with custom options', () => {
      const executor = createExecutor({
        defaultTimeout: 60000,
        production: true,
      });
      expect(executor).toBeInstanceOf(UnifiedWorkflowExecutor);
    });
  });

  describe('validateRequest', () => {
    it('should validate a valid request', () => {
      const executor = createExecutor();
      const request: WorkflowRequest = {
        workflowId: 'test-workflow',
        params: { input: 'value' },
        context: {
          source: 'cli',
          environment: 'development',
          requestId: 'test-123',
          includeTrace: true,
        },
      };

      const result = executor.validateRequest(request);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject request without workflowId', () => {
      const executor = createExecutor();
      const request = {
        workflowId: '',
        params: {},
        context: {
          source: 'cli' as const,
          environment: 'development' as const,
          requestId: 'test-123',
          includeTrace: true,
        },
      };

      const result = executor.validateRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((e) => e.path === 'workflowId')).toBe(true);
    });

    it('should reject request with non-object params', () => {
      const executor = createExecutor();
      const request = {
        workflowId: 'test',
        params: 'not an object' as unknown as Record<string, unknown>,
        context: {
          source: 'cli' as const,
          environment: 'development' as const,
          requestId: 'test-123',
          includeTrace: true,
        },
      };

      const result = executor.validateRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'params')).toBe(true);
    });

    it('should accept request with valid params object', () => {
      const executor = createExecutor();
      const result = executor.validateRequest(makeRequest({ params: { key: 'value' } }));
      expect(result.valid).toBe(true);
    });

    it('should accept request with empty params object', () => {
      const executor = createExecutor();
      const result = executor.validateRequest(makeRequest({ params: {} }));
      expect(result.valid).toBe(true);
    });

    it('should report both workflowId and params errors simultaneously', () => {
      const executor = createExecutor();
      const request = {
        workflowId: '',
        params: 42 as unknown as Record<string, unknown>,
        context: {
          source: 'cli' as const,
          environment: 'development' as const,
          requestId: 'test-123',
          includeTrace: true,
        },
      };

      const result = executor.validateRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors?.length).toBe(2);
      expect(result.errors?.some((e) => e.path === 'workflowId')).toBe(true);
      expect(result.errors?.some((e) => e.path === 'params')).toBe(true);
    });

    it('should include expected and actual in params validation error', () => {
      const executor = createExecutor();
      const request = {
        workflowId: 'test',
        params: 123 as unknown as Record<string, unknown>,
        context: {
          source: 'cli' as const,
          environment: 'development' as const,
          requestId: 'r',
          includeTrace: true,
        },
      };

      const result = executor.validateRequest(request);
      const paramsError = result.errors?.find((e) => e.path === 'params');
      expect(paramsError?.expected).toBe('object');
      expect(paramsError?.actual).toBe('number');
    });
  });

  describe('execute', () => {
    it('should return workflow not found error without registry', async () => {
      const executor = createExecutor();
      const request: WorkflowRequest = {
        workflowId: 'nonexistent',
        params: {},
        context: {
          source: 'cli',
          environment: 'development',
          requestId: 'test-123',
          includeTrace: true,
        },
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('WORKFLOW_NOT_FOUND');
      expect(result.workflowId).toBe('nonexistent');
      expect(result.requestId).toBe('test-123');
    });

    it('should include execution time in response', async () => {
      const executor = createExecutor();
      const request: WorkflowRequest = {
        workflowId: 'test',
        params: {},
        context: {
          source: 'cli',
          environment: 'development',
          requestId: 'test-123',
          includeTrace: true,
        },
      };

      const result = await executor.execute(request);

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should return WORKFLOW_NOT_FOUND with correct message', async () => {
      const executor = createExecutor();
      const result = await executor.execute(makeRequest({ workflowId: 'missing-wf' }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('WORKFLOW_NOT_FOUND');
      expect(result.error?.message).toContain('missing-wf');
    });

    it('should use provided requestId in error response', async () => {
      const executor = createExecutor();
      const result = await executor.execute(
        makeRequest({
          context: {
            source: 'http',
            environment: 'development',
            requestId: 'custom-req-id',
            includeTrace: false,
          },
        })
      );

      expect(result.requestId).toBe('custom-req-id');
    });

    it('should generate a requestId when context has empty requestId', async () => {
      const executor = createExecutor();
      const result = await executor.execute(
        makeRequest({
          context: {
            source: 'cli',
            environment: 'development',
            requestId: '',
            includeTrace: true,
          },
        })
      );

      // Empty string is falsy, so randomUUID should be used
      expect(result.requestId).toBeDefined();
    });
  });

  describe('error handling - timeout', () => {
    it('should return TIMEOUT error when execution times out', async () => {
      const executor = createExecutor({ defaultTimeout: 30000 });

      // Mock a registry that returns an endpoint
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/workflow.ts',
          functionName: 'testFn',
          name: 'test',
          method: 'POST',
          path: '/workflows/test',
        }),
      } as any;

      const executorWithReg = new UnifiedWorkflowExecutor({ registry: mockRegistry });

      // Simulate a timeout error from the execution layer
      mockedExecute.mockRejectedValueOnce(new Error('Workflow execution timed out after 30000ms'));

      const result = await executorWithReg.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toContain('timed out');
    });

    it('should detect timeout by keyword "timed out"', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockRejectedValueOnce(new Error('Operation timed out'));

      const result = await executor.execute(makeRequest());
      expect(result.error?.code).toBe('TIMEOUT');
    });

    it('should detect timeout by keyword "timeout"', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockRejectedValueOnce(new Error('timeout exceeded'));

      const result = await executor.execute(makeRequest());
      expect(result.error?.code).toBe('TIMEOUT');
    });

    it('should include default timeout value in timeout error message', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({
        registry: mockRegistry,
        defaultTimeout: 5000,
      });
      mockedExecute.mockRejectedValueOnce(new Error('timed out'));

      const result = await executor.execute(makeRequest());
      expect(result.error?.message).toContain('5000ms');
    });
  });

  describe('error handling - abort', () => {
    it('should return CANCELLED error when execution is aborted', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });

      const abortError = new Error('Workflow execution was cancelled');
      abortError.name = 'AbortError';
      mockedExecute.mockRejectedValueOnce(abortError);

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CANCELLED');
      expect(result.error?.message).toContain('cancelled');
    });

    it('should detect cancellation by error name AbortError', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });

      const err = new Error('some message');
      err.name = 'AbortError';
      mockedExecute.mockRejectedValueOnce(err);

      const result = await executor.execute(makeRequest());
      expect(result.error?.code).toBe('CANCELLED');
    });

    it('should detect cancellation by "abort" in message', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockRejectedValueOnce(new Error('signal abort received'));

      const result = await executor.execute(makeRequest());
      expect(result.error?.code).toBe('CANCELLED');
    });
  });

  describe('error handling - validation errors', () => {
    it('should return VALIDATION_ERROR for validation-related errors', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockRejectedValueOnce(new Error('Parameter validation failed: missing required field'));

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toContain('validation');
    });

    it('should return VALIDATION_ERROR for "invalid" keyword in message', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockRejectedValueOnce(new Error('invalid input format'));

      const result = await executor.execute(makeRequest());
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should include stack trace for validation errors in development', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({
        registry: mockRegistry,
        production: false,
      });
      mockedExecute.mockRejectedValueOnce(new Error('invalid parameter type'));

      const result = await executor.execute(makeRequest());
      expect(result.error?.stack).toBeDefined();
    });
  });

  describe('error handling - general execution errors', () => {
    it('should return EXECUTION_ERROR for generic Error instances', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockRejectedValueOnce(new Error('Something went wrong'));

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toBe('Something went wrong');
    });

    it('should include stack trace in development mode', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({
        registry: mockRegistry,
        production: false,
      });
      mockedExecute.mockRejectedValueOnce(new Error('generic failure'));

      const result = await executor.execute(makeRequest());
      expect(result.error?.stack).toBeDefined();
      expect(result.error?.stack).toContain('generic failure');
    });

    it('should omit stack trace in production mode', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({
        registry: mockRegistry,
        production: true,
      });
      mockedExecute.mockRejectedValueOnce(new Error('secret internal error'));

      const result = await executor.execute(makeRequest());
      expect(result.error?.stack).toBeUndefined();
    });
  });

  describe('error handling - non-Error throws', () => {
    it('should return INTERNAL_ERROR for non-Error thrown values', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockRejectedValueOnce('string error');

      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
      expect(result.error?.message).toBe('string error');
    });

    it('should stringify non-string non-Error throws', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/test/wf.ts',
          functionName: 'fn',
          name: 'wf',
          method: 'POST',
          path: '/workflows/wf',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockRejectedValueOnce(42);

      const result = await executor.execute(makeRequest());
      expect(result.error?.code).toBe('INTERNAL_ERROR');
      expect(result.error?.message).toBe('42');
    });
  });

  describe('execution context', () => {
    it('should respect production mode setting', async () => {
      const executor = createExecutor({ production: true });
      const request: WorkflowRequest = {
        workflowId: 'test',
        params: {},
        context: {
          source: 'cli',
          environment: 'production',
          requestId: 'test-123',
          includeTrace: true, // Should be overridden by production mode
        },
      };

      const result = await executor.execute(request);

      // Even if includeTrace is true, production mode should disable it
      // The error response won't have stack trace in production
      expect(result.error?.stack).toBeUndefined();
    });

    it('should generate request ID if not provided', async () => {
      const executor = createExecutor();
      const context: ExecutionContext = {
        source: 'cli',
        environment: 'development',
        requestId: '', // Empty, should generate
        includeTrace: true,
      };
      const request: WorkflowRequest = {
        workflowId: 'test',
        params: {},
        context,
      };

      const result = await executor.execute(request);

      // Should have a request ID even though we didn't provide one
      expect(result.requestId).toBeDefined();
      expect(result.requestId.length).toBeGreaterThan(0);
    });
  });

  describe('executeFromFile', () => {
    it('should return EXECUTION_ERROR on failure', async () => {
      const executor = createExecutor();
      mockedExecute.mockRejectedValueOnce(new Error('file not found'));

      const result = await executor.executeFromFile('/nonexistent.ts', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toContain('file not found');
    });

    it('should use default context values', async () => {
      const executor = createExecutor();
      mockedExecute.mockRejectedValueOnce(new Error('test'));

      const result = await executor.executeFromFile('/test.ts', { a: 1 });

      // Should have a generated requestId (UUID format)
      expect(result.requestId).toBeDefined();
      expect(result.requestId.length).toBeGreaterThan(0);
    });

    it('should pass provided context overrides', async () => {
      const executor = createExecutor();
      mockedExecute.mockRejectedValueOnce(new Error('test'));

      const result = await executor.executeFromFile('/test.ts', {}, {
        source: 'http',
        environment: 'staging',
        requestId: 'override-id',
      });

      expect(result.requestId).toBe('override-id');
    });

    it('should return success with result on successful execution', async () => {
      const executor = createExecutor();
      mockedExecute.mockResolvedValueOnce({
        result: { sum: 42 },
        functionName: 'calculator',
        trace: [],
      });

      const result = await executor.executeFromFile('/calculator.ts', { a: 20, b: 22 });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ sum: 42 });
      expect(result.workflowId).toBe('calculator');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should include trace when includeTrace is true and not production', async () => {
      const executor = createExecutor({ production: false });
      const traceEvents = [{ type: 'NODE_STARTED', timestamp: Date.now(), data: {} }];
      mockedExecute.mockResolvedValueOnce({
        result: {},
        functionName: 'wf',
        trace: traceEvents,
      });

      const result = await executor.executeFromFile('/wf.ts', {}, { includeTrace: true });
      expect(result.trace).toEqual(traceEvents);
    });

    it('should not include trace in production mode even when requested', async () => {
      const executor = createExecutor({ production: true });
      mockedExecute.mockResolvedValueOnce({
        result: {},
        functionName: 'wf',
        trace: [{ type: 'NODE_STARTED', timestamp: Date.now() }],
      });

      const result = await executor.executeFromFile('/wf.ts', {}, { includeTrace: true });
      expect(result.trace).toBeUndefined();
    });
  });

  describe('successful execution with registry', () => {
    it('should return success when registry resolves the workflow', async () => {
      const mockRegistry = {
        getEndpoint: vi.fn().mockReturnValue({
          filePath: '/workflows/calc.ts',
          functionName: 'calculator',
          name: 'calculator',
          method: 'POST',
          path: '/workflows/calculator',
        }),
      } as any;

      const executor = new UnifiedWorkflowExecutor({ registry: mockRegistry });
      mockedExecute.mockResolvedValueOnce({
        result: { answer: 42 },
        functionName: 'calculator',
        trace: [],
      });

      const result = await executor.execute(makeRequest({ workflowId: 'calculator' }));

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ answer: 42 });
      expect(result.workflowId).toBe('calculator');
    });
  });
});
