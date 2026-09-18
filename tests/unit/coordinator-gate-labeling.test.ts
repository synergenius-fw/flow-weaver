import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from '../../src/api/index.js';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';
import { labelGate } from '../../src/coordinator/gate-labeling.js';
import type { DurableGate } from '../../src/runtime/continuation.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'continuation', 'fixtures');
const agentFixture = path.join(fixtures, 'durable-agent-labeled.ts');
const bundleDigest = `sha256:${'a'.repeat(64)}`;

describe('labelGate', () => {
  it('names the built-in waitForAgent inputs from a real yield', async () => {
    const outcome = await executeWorkflow({
      runId: 'label-agent',
      bundleDigest,
      filePath: agentFixture,
      workflowName: 'reviewFile',
      params: { path: 'notes.md', text: 'TODO: ship it.' },
      includeTrace: false,
    });
    if (outcome.kind !== 'yielded') throw new Error('expected a yield');

    const parsed = await parseWorkflow(agentFixture, { workflowName: 'reviewFile' });
    expect(parsed.errors).toEqual([]);

    const labeled = labelGate(outcome.gate, parsed.ast);
    expect(labeled.inputs).toEqual({ agentId: 'review', context: 'TODO: ship it.', prompt: null });
    expect(labeled.absent).toEqual(['prompt']);
    expect(labeled.outputs).toEqual(['agentResult']);
    expect(labeled.hasSuccessPort).toBe(true);
    expect(labeled.hasFailurePort).toBe(true);
  });

  it('refuses a payload whose length does not match the declared inputs', async () => {
    const parsed = await parseWorkflow(agentFixture, { workflowName: 'reviewFile' });
    const gate = {
      id: '0'.repeat(64),
      kind: 'agent',
      address: { frames: [], scopes: [], branches: [], nodeId: 'agent', nodeType: 'waitForAgent', executionIndex: 0 },
      payload: { arguments: [{ value: 'only-one' }] },
    } as unknown as DurableGate;
    expect(() => labelGate(gate, parsed.ast)).toThrow(/1 arguments but node type waitForAgent declares 3/);
  });

  it('refuses a gate whose node id is not in the workflow', async () => {
    const parsed = await parseWorkflow(agentFixture, { workflowName: 'reviewFile' });
    const gate = {
      id: '0'.repeat(64),
      kind: 'agent',
      address: { frames: [], scopes: [], branches: [], nodeId: 'ghost', nodeType: 'waitForAgent', executionIndex: 0 },
      payload: { arguments: [] },
    } as unknown as DurableGate;
    expect(() => labelGate(gate, parsed.ast)).toThrow(/gate node not found in workflow: ghost/);
  });
});
