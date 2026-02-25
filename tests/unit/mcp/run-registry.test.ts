import { describe, it, expect, beforeEach } from 'vitest';
import {
  storePendingRun,
  getPendingRun,
  removePendingRun,
  listPendingRuns,
} from '../../../src/mcp/run-registry.js';
import type { PendingRun } from '../../../src/mcp/run-registry.js';
import { AgentChannel } from '../../../src/mcp/agent-channel.js';

function makeFakeRun(overrides: Partial<PendingRun> = {}): PendingRun {
  return {
    runId: overrides.runId ?? 'run-1',
    filePath: overrides.filePath ?? '/tmp/workflow.ts',
    workflowName: overrides.workflowName,
    executionPromise: overrides.executionPromise ?? Promise.resolve(),
    agentChannel: overrides.agentChannel ?? new AgentChannel(),
    request: overrides.request,
    createdAt: overrides.createdAt ?? Date.now(),
    tmpFiles: overrides.tmpFiles ?? [],
  };
}

describe('run-registry', () => {
  beforeEach(() => {
    // Clean up any leftover runs from previous tests by removing known IDs.
    // The module uses a module-level Map, so we remove entries explicitly.
    for (const run of listPendingRuns()) {
      removePendingRun(run.runId);
    }
  });

  it('stores and retrieves a pending run', () => {
    const run = makeFakeRun({ runId: 'r-store' });
    storePendingRun(run);

    const retrieved = getPendingRun('r-store');
    expect(retrieved).toBeDefined();
    expect(retrieved!.runId).toBe('r-store');
    expect(retrieved!.filePath).toBe('/tmp/workflow.ts');
  });

  it('returns undefined for unknown runId', () => {
    expect(getPendingRun('nonexistent')).toBeUndefined();
  });

  it('removes a pending run', () => {
    const run = makeFakeRun({ runId: 'r-remove' });
    storePendingRun(run);
    expect(getPendingRun('r-remove')).toBeDefined();

    removePendingRun('r-remove');
    expect(getPendingRun('r-remove')).toBeUndefined();
  });

  it('removing a nonexistent run does not throw', () => {
    expect(() => removePendingRun('does-not-exist')).not.toThrow();
  });

  it('lists all pending runs with projected fields', () => {
    storePendingRun(makeFakeRun({ runId: 'r-a', filePath: '/a.ts', workflowName: 'wfA', createdAt: 100 }));
    storePendingRun(makeFakeRun({ runId: 'r-b', filePath: '/b.ts', request: { prompt: 'hello' }, createdAt: 200 }));

    const list = listPendingRuns();
    expect(list).toHaveLength(2);

    const ids = list.map((r) => r.runId);
    expect(ids).toContain('r-a');
    expect(ids).toContain('r-b');

    const runA = list.find((r) => r.runId === 'r-a')!;
    expect(runA.filePath).toBe('/a.ts');
    expect(runA.workflowName).toBe('wfA');
    expect(runA.createdAt).toBe(100);

    const runB = list.find((r) => r.runId === 'r-b')!;
    expect(runB.request).toEqual({ prompt: 'hello' });
  });

  it('lists empty when no runs are stored', () => {
    expect(listPendingRuns()).toEqual([]);
  });

  it('listPendingRuns does not expose internal fields like agentChannel or executionPromise', () => {
    storePendingRun(makeFakeRun({ runId: 'r-projection' }));
    const list = listPendingRuns();
    const item = list[0] as Record<string, unknown>;

    // The projected type should only have these keys
    expect(Object.keys(item).sort()).toEqual(
      ['createdAt', 'filePath', 'request', 'runId', 'workflowName'].sort(),
    );
  });

  it('overwriting a run by storing with the same runId replaces it', () => {
    storePendingRun(makeFakeRun({ runId: 'r-overwrite', filePath: '/old.ts' }));
    storePendingRun(makeFakeRun({ runId: 'r-overwrite', filePath: '/new.ts' }));

    const retrieved = getPendingRun('r-overwrite');
    expect(retrieved!.filePath).toBe('/new.ts');
    expect(listPendingRuns()).toHaveLength(1);
  });
});
