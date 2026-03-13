/**
 * Coverage for formatDiff.ts uncovered lines:
 * - Line 131: exit ports added
 * - Line 137: exit ports modified
 * - Line 215: instance config pullExecution changed
 * - Line 218: instance config portConfigs changed
 */
import { describe, it, expect } from 'vitest';
import { formatDiff } from '../../src/diff/formatDiff.js';
import type { TWorkflowDiff, TInstanceDiff } from '../../src/diff/types.js';

function createDiff(overrides: Partial<TWorkflowDiff> = {}): TWorkflowDiff {
  return {
    identical: false,
    impact: 'MINOR',
    summary: {
      nodeTypesAdded: 0,
      nodeTypesRemoved: 0,
      nodeTypesModified: 0,
      instancesAdded: 0,
      instancesRemoved: 0,
      instancesModified: 0,
      instancesUIModified: 0,
      connectionsAdded: 0,
      connectionsRemoved: 0,
    },
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: { added: [], removed: [], modified: [] },
    exitPorts: { added: [], removed: [], modified: [] },
    scopes: [],
    ...overrides,
  };
}

describe('formatDiff exit port changes (lines 131, 137)', () => {
  it('formats added exit ports', () => {
    const diff = createDiff({
      exitPorts: {
        added: [{ name: 'newExit', definition: { dataType: 'NUMBER' } }],
        removed: [],
        modified: [],
      },
    });

    const output = formatDiff(diff, 'text');
    expect(output).toContain('Exit ports added');
    expect(output).toContain('newExit');
  });

  it('formats modified exit ports', () => {
    const diff = createDiff({
      exitPorts: {
        added: [],
        removed: [],
        modified: [{
          name: 'result',
          before: { dataType: 'NUMBER' },
          after: { dataType: 'STRING' },
        }],
      },
    });

    const output = formatDiff(diff, 'text');
    expect(output).toContain('Exit ports modified');
    expect(output).toContain('result');
  });

  it('formats removed exit ports alongside added exit ports', () => {
    const diff = createDiff({
      exitPorts: {
        added: [{ name: 'added1', definition: { dataType: 'STEP' } }],
        removed: [{ name: 'removed1', definition: { dataType: 'NUMBER' } }],
        modified: [{ name: 'mod1', before: { dataType: 'NUMBER' }, after: { dataType: 'STRING' } }],
      },
    });

    const output = formatDiff(diff, 'text');
    expect(output).toContain('Exit ports added');
    expect(output).toContain('added1');
    expect(output).toContain('Exit ports removed');
    expect(output).toContain('removed1');
    expect(output).toContain('Exit ports modified');
    expect(output).toContain('mod1');
  });
});

describe('formatDiff instance config changes (lines 215, 218)', () => {
  it('formats pullExecution config change', () => {
    const inst: TInstanceDiff = {
      id: 'myNode',
      changeType: 'MODIFIED',
      changes: {
        config: {
          pullExecution: {
            type: 'MODIFIED',
            before: { triggerPort: 'execute' },
            after: { triggerPort: 'trigger' },
          },
        },
      },
    };

    const diff = createDiff({
      summary: {
        nodeTypesAdded: 0, nodeTypesRemoved: 0, nodeTypesModified: 0,
        instancesAdded: 0, instancesRemoved: 0, instancesModified: 1,
        instancesUIModified: 0, connectionsAdded: 0, connectionsRemoved: 0,
      },
      instances: [inst],
    });

    const output = formatDiff(diff, 'text');
    expect(output).toContain('myNode');
    expect(output).toContain('pullExecution changed');
  });

  it('formats portConfigs config change', () => {
    const inst: TInstanceDiff = {
      id: 'configNode',
      changeType: 'MODIFIED',
      changes: {
        config: {
          portConfigs: {
            type: 'MODIFIED',
            before: undefined,
            after: [{ port: 'input', expression: 'x + 1' }] as any,
          },
        },
      },
    };

    const diff = createDiff({
      summary: {
        nodeTypesAdded: 0, nodeTypesRemoved: 0, nodeTypesModified: 0,
        instancesAdded: 0, instancesRemoved: 0, instancesModified: 1,
        instancesUIModified: 0, connectionsAdded: 0, connectionsRemoved: 0,
      },
      instances: [inst],
    });

    const output = formatDiff(diff, 'text');
    expect(output).toContain('configNode');
    expect(output).toContain('portConfigs changed');
  });

  it('formats both pullExecution and portConfigs changes together', () => {
    const inst: TInstanceDiff = {
      id: 'bothNode',
      changeType: 'MODIFIED',
      changes: {
        config: {
          pullExecution: {
            type: 'MODIFIED',
            before: undefined,
            after: { triggerPort: 'execute' },
          },
          portConfigs: {
            type: 'MODIFIED',
            before: undefined,
            after: [{ port: 'data', expression: 'val' }] as any,
          },
        },
      },
    };

    const diff = createDiff({
      summary: {
        nodeTypesAdded: 0, nodeTypesRemoved: 0, nodeTypesModified: 0,
        instancesAdded: 0, instancesRemoved: 0, instancesModified: 1,
        instancesUIModified: 0, connectionsAdded: 0, connectionsRemoved: 0,
      },
      instances: [inst],
    });

    const output = formatDiff(diff, 'text');
    expect(output).toContain('pullExecution changed');
    expect(output).toContain('portConfigs changed');
  });
});
