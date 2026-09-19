/**
 * Reading a port from a node that never ran on the arm actually taken.
 *
 * A convergence node driven from both a pre-gate failure arm and the gate's
 * success arm has to read ports from both sides. On the failure arm the gate
 * never ran, so it has no execution index, and the generated reader used to
 * address it at `undefined` anyway -- which the continuation validator then
 * refused with "$.executionIndex is not a plain wire value", aborting a run
 * that had done nothing wrong.
 *
 * The absent value must read as undefined instead, so the convergence node
 * can decide from what actually arrived.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'read-across-unrun-arm.ts',
);
const bundleDigest = `sha256:${'c'.repeat(64)}`;

describe('reading across an arm that did not run', () => {
  it('completes the failure arm without addressing the gate at an undefined index', async () => {
    const outcome = await executeWorkflow({
      runId: 'read-across-unrun-arm-fail',
      bundleDigest,
      filePath: fixture,
      workflowName: 'readAcrossUnrunArm',
      params: { raw: 'bad' },
      production: false,
    });

    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') throw new Error('expected completion');
    expect((outcome.result as { outcome?: unknown }).outcome).toBe('refused: refused');
  });

  it('still yields at the gate on the success arm', async () => {
    const outcome = await executeWorkflow({
      runId: 'read-across-unrun-arm-ok',
      bundleDigest,
      filePath: fixture,
      workflowName: 'readAcrossUnrunArm',
      params: { raw: 'good' },
      production: false,
    });

    expect(outcome.kind).toBe('yielded');
    if (outcome.kind !== 'yielded') throw new Error('expected a durable yield');
    expect(outcome.gate.address.nodeId).toBe('g');
  });
});
