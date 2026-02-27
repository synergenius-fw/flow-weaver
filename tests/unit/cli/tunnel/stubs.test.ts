import { describe, it, expect } from 'vitest';
import { stubHandlers } from '../../../../src/cli/tunnel/handlers/stubs.js';

const ctx = { workspaceRoot: '/tmp/test' };

describe('stub handlers', () => {
  it('returns { success: true } for snapshot write operations', async () => {
    expect(await stubHandlers.takeWorkflowSnapshot({}, ctx)).toEqual({ success: true });
    expect(await stubHandlers.deleteWorkflowSnapshot({}, ctx)).toEqual({ success: true });
    expect(await stubHandlers.deleteAllWorkflowSnapshots({}, ctx)).toEqual({ success: true });
  });

  it('returns null/[] for snapshot read operations', async () => {
    expect(await stubHandlers.loadWorkflowSnapshot({}, ctx)).toBe(null);
    expect(await stubHandlers.getLatestWorkflowSnapshot({}, ctx)).toBe(null);
    expect(await stubHandlers.listWorkflowSnapshots({}, ctx)).toEqual([]);
  });

  it('returns git status with default branch', async () => {
    const status = await stubHandlers.gitStatus({}, ctx);
    expect(status).toMatchObject({
      files: [],
      current: 'main',
    });
  });

  it('returns unsupported for terminal operations', async () => {
    const result = await stubHandlers.createTerminal({}, ctx);
    expect(result).toMatchObject({ success: false });
  });

  it('returns expected defaults for marketplace', async () => {
    const search = await stubHandlers.marketplaceSearch({}, ctx);
    expect(search).toEqual({ results: [] });
    const installed = await stubHandlers.marketplaceListInstalled({}, ctx);
    expect(installed).toEqual([]);
  });

  it('returns healthy status for doctor', async () => {
    const result = await stubHandlers.runDoctor({}, ctx);
    expect(result).toMatchObject({ status: 'healthy' });
  });

  it('returns empty arrays for completions and patterns', async () => {
    expect(await stubHandlers.getCompletions({}, ctx)).toEqual([]);
    expect(await stubHandlers.getPatterns({}, ctx)).toEqual([]);
  });
});
