import { describe, it, expect, vi } from 'vitest';
import { CancellationError } from '../../src/runtime/CancellationError.js';

// Mock the workflow executor to control execution timing
vi.mock('../../src/mcp/workflow-executor.js', () => ({
  executeWorkflow: vi.fn(),
}));

import { UnifiedWorkflowExecutor } from '../../src/deployment/core/executor.js';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';

const mockedExecute = vi.mocked(executeWorkflow);

describe('UnifiedWorkflowExecutor - abort signal handling', () => {
  it('forwards parent abort through the derived deployment signal', async () => {
    let forwardedSignal: AbortSignal | undefined;
    mockedExecute.mockImplementation(({ abortSignal }) => {
      forwardedSignal = abortSignal;
      return new Promise((_, reject) => {
        abortSignal?.addEventListener(
          'abort',
          () => reject(new CancellationError()),
          { once: true },
        );
      });
    });

    const controller = new AbortController();
    const executor2 = new UnifiedWorkflowExecutor({
      defaultTimeout: 60000,
      registry: {
        getEndpoint: vi.fn().mockResolvedValue({
          filePath: '/fake/workflow.ts',
          functionName: 'testWorkflow',
        }),
        scan: vi.fn(),
        listEndpoints: vi.fn(),
      } as any,
    });

    const resultPromise2 = executor2.execute({
      workflowId: 'test',
      params: {},
      context: {
        source: 'http',
        environment: 'development',
        requestId: 'test-req',
        includeTrace: false,
        timeout: 60000,
      },
      abortSignal: controller.signal,
    });

    await vi.waitFor(() => expect(forwardedSignal).toBeDefined());
    expect(forwardedSignal).not.toBe(controller.signal);
    controller.abort();

    const result = await resultPromise2;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CANCELLED');
  });

  it('returns TIMEOUT error when execution exceeds timeout', async () => {
    mockedExecute.mockImplementation(({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal?.addEventListener(
          'abort',
          () => reject(new CancellationError()),
          { once: true },
        );
      })
    );

    const executor = new UnifiedWorkflowExecutor({
      defaultTimeout: 100,
      registry: {
        getEndpoint: vi.fn().mockResolvedValue({
          filePath: '/fake/workflow.ts',
          functionName: 'testWorkflow',
        }),
        scan: vi.fn(),
        listEndpoints: vi.fn(),
      } as any,
    });

    const result = await executor.execute({
      workflowId: 'test',
      params: {},
      context: {
        source: 'http',
        environment: 'development',
        requestId: 'timeout-req',
        includeTrace: false,
        timeout: 100,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
    expect(result.error?.message).toContain('timed out');
  });
});
