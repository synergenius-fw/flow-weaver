/**
 * Expression references feeding a durable gate.
 *
 * The gate's inputs are expressions over Start params and an upstream pure
 * node. The run must yield with those values in the gate payload, the
 * derived edges must appear in the continuation graph as predecessors, and
 * the resume must complete with the downstream node reading the resolution.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';
import { parseWorkflow } from '../../src/api/parse.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-expression-gate.ts');
const bundleDigest = `sha256:${'f'.repeat(64)}`;

describe('expression references into a durable gate', () => {
  it('parses without a shaping node and with the references as derived edges', async () => {
    const parsed = await parseWorkflow(fixture, { workflowName: 'expressionGate' });
    expect(parsed.errors).toEqual([]);
    const derived = parsed.ast.connections
      .filter((c) => c.derived)
      .map((c) => `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`)
      .sort();
    expect(derived).toEqual([
      'Start.path->reviewer.context',
      'Start.path->reviewer.prompt',
      'assess.risk->reviewer.context',
      'assess.risk->reviewer.prompt',
    ]);
  });

  it('yields with the evaluated expressions as the gate inputs, then resumes to completion', async () => {
    const yielded = await executeWorkflow({
      runId: 'expression-gate-run',
      bundleDigest,
      filePath: fixture,
      workflowName: 'expressionGate',
      params: { path: 'index.ts' },
      production: false,
    });
    expect(yielded.kind).toBe('yielded');
    if (yielded.kind !== 'yielded') return;
    expect(yielded.gate.kind).toBe('agent');
    expect(yielded.gate.address.nodeId).toBe('reviewer');
    // The gate payload carries the built-in's arguments positionally:
    // agentId, context, prompt. Each is the evaluated expression.
    const args = (yielded.gate as unknown as { payload: { arguments: Array<{ value?: unknown }> } }).payload.arguments;
    expect(args.map((a) => a.value)).toEqual([
      'review',
      { path: 'index.ts', risk: 'high' },
      'Review index.ts (risk high)',
    ]);

    const resumed = await executeWorkflow({
      runId: 'expression-gate-run',
      bundleDigest,
      filePath: fixture,
      workflowName: 'expressionGate',
      params: { path: 'index.ts' },
      production: false,
      continuation: yielded.continuation,
      resolution: {
        gateId: yielded.gate.id,
        value: { onSuccess: true, onFailure: false, agentResult: { summary: 'looks fine' } },
      },
    });
    expect(resumed.kind).toBe('completed');
    if (resumed.kind !== 'completed') return;
    expect(resumed.result).toMatchObject({ onSuccess: true, report: 'high: looks fine' });
  });
});
