/**
 * The validation-node pattern from the durable-gates topic: a node after an
 * agent gate that checks the answer and routes a bad one to onFailure. Pins
 * both routes so the documented example stays runnable.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'use-cases',
  'agent-gate-demo',
  'review-with-validation.ts',
);
const bundleDigest = `sha256:${'8'.repeat(64)}`;

async function runToGate() {
  const yielded = await executeWorkflow({
    runId: `agent-validation-${Math.random().toString(36).slice(2)}`,
    bundleDigest,
    filePath: fixture,
    workflowName: 'reviewFile',
    params: { path: 'README.md' },
    production: false,
  });
  if (yielded.kind !== 'yielded') throw new Error('expected a yield');
  return yielded;
}

describe('a validation node after an agent gate', () => {
  it('accepts a well-formed answer and records it', async () => {
    const yielded = await runToGate();
    const resumed = await executeWorkflow({
      runId: yielded.continuation.runId,
      bundleDigest,
      filePath: fixture,
      workflowName: 'reviewFile',
      params: { path: 'README.md' },
      production: false,
      continuation: yielded.continuation,
      resolution: {
        gateId: yielded.gate.id,
        value: { onSuccess: true, onFailure: false, agentResult: { verdict: 'ship', reason: 'docs are current' } },
      },
    });
    expect(resumed.kind).toBe('completed');
    if (resumed.kind !== 'completed') return;
    expect(resumed.result).toMatchObject({ onSuccess: true, outcome: 'ship: docs are current', rejected: '' });
  });

  it('routes a malformed answer to onFailure without recording it', async () => {
    const yielded = await runToGate();
    const resumed = await executeWorkflow({
      runId: yielded.continuation.runId,
      bundleDigest,
      filePath: fixture,
      workflowName: 'reviewFile',
      params: { path: 'README.md' },
      production: false,
      continuation: yielded.continuation,
      resolution: {
        gateId: yielded.gate.id,
        value: { onSuccess: true, onFailure: false, agentResult: { verdict: 'maybe', reason: '' } },
      },
    });
    expect(resumed.kind).toBe('completed');
    if (resumed.kind !== 'completed') return;
    const result = resumed.result as { onSuccess: boolean; onFailure: boolean; outcome?: string; rejected: string };
    expect(result.onSuccess).toBe(false);
    expect(result.onFailure).toBe(true);
    expect(result.rejected).toMatch(/malformed review/);
    expect(result.outcome ?? '').toBe('');
  });
});
