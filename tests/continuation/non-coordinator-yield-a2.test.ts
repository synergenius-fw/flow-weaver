import { vi } from 'vitest';

vi.mock('../../src/mcp/workflow-executor.js', () => ({
  executeWorkflow: vi.fn(),
}));

import { runCommand } from '../../src/api/command-runner.js';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';

describe('A2 non-coordinator yield refusal', () => {
  it('does not expose a yielded continuation through the programmatic command runner', async () => {
    vi.mocked(executeWorkflow).mockResolvedValueOnce({
      kind: 'yielded',
      functionName: 'approval',
      executionTime: 1,
    } as never);

    await expect(
      runCommand('run', { file: '/tmp/approval.ts', params: {} }),
    ).rejects.toThrow(/not a durable coordinator/);
  });
});
