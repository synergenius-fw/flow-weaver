import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  registerWorkflowRunTools,
  resumeWorkflow,
  runWorkflow,
} from '../../../src/mcp/tools-workflow-run.js';

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..',
  'continuation',
  'fixtures',
  'durable-approval.ts',
);
const bundleDigest = `sha256:${'a'.repeat(64)}`;

function createFakeMcpServer() {
  const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  return {
    tools,
    mcp: {
      tool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) {
        tools[name] = handler;
      },
    },
  };
}

describe('durable workflow MCP tools', () => {
  it('returns a terminal yielded outcome and resumes without retaining an executor', async () => {
    const runId = 'mcp-durable-run';
    const first = await runWorkflow(
      fixture,
      { value: 4 },
      'durableApproval',
      runId,
      bundleDigest,
    );
    expect(first.kind).toBe('yielded');
    if (first.kind !== 'yielded') throw new Error('expected durable yield');

    const resumed = await resumeWorkflow(
      runId,
      fixture,
      structuredClone(first.continuation),
      first.gate.id,
      { onSuccess: true, onFailure: false, value: 8 },
      { value: 999 },
      'durableApproval',
      bundleDigest,
    );
    expect(resumed).toMatchObject({
      kind: 'completed',
      result: { onSuccess: true, onFailure: false, result: 9 },
    });
  });

  it('registers stateless run and exact-continuation resume tools', () => {
    const { mcp, tools } = createFakeMcpServer();
    registerWorkflowRunTools(mcp as never);
    expect(Object.keys(tools).sort()).toEqual([
      'fw_workflow_resume',
      'fw_workflow_run',
    ]);
  });

  it('fails closed instead of looking up an in-memory run', async () => {
    await expect(
      resumeWorkflow(
        'missing-run',
        fixture,
        {},
        '0'.repeat(64),
        { value: 8 },
        {},
        'durableApproval',
        bundleDigest,
      ),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'malformed' },
    });
  });
});
