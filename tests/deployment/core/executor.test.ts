/**
 * Tests for UnifiedWorkflowExecutor
 */

import { describe, it, expect } from 'vitest';
import { UnifiedWorkflowExecutor, createExecutor } from '../../../src/deployment/core/executor';
import type { WorkflowRequest, ExecutionContext } from '../../../src/deployment/types';

describe('UnifiedWorkflowExecutor', () => {
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
});
