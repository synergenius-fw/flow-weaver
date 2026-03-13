/**
 * Coverage for src/editor-completions/index.ts uncovered lines:
 * - Line 174: getPortCompletions returns [] when context has no instances
 * - Line 186: getPortCompletions returns [] when nodeType not found in context
 * - Lines 218-219: connectedPorts tracks output-direction connections
 */
import { describe, it, expect } from 'vitest';
import { getFlowWeaverCompletions, WorkflowContext } from '../../src/editor-completions';

describe('getPortCompletions edge cases', () => {
  it('returns empty when context has nodeTypes but no instances', () => {
    const context: WorkflowContext = {
      nodeTypes: {
        MyNode: {
          name: 'MyNode',
          ports: [
            { name: 'out', direction: 'OUTPUT', dataType: 'String' },
          ],
        },
      },
      // no instances array
    };

    const result = getFlowWeaverCompletions(
      ' * @connect myNode.',
      19,
      true,
      context,
    );
    expect(result).toEqual([]);
  });

  it('returns empty when context has instances but no nodeTypes', () => {
    const context: WorkflowContext = {
      nodeTypes: undefined as any,
      instances: [{ id: 'myNode', nodeType: 'MyNode' }],
    };

    const result = getFlowWeaverCompletions(
      ' * @connect myNode.',
      19,
      true,
      context,
    );
    expect(result).toEqual([]);
  });

  it('returns empty when instance nodeType is not in nodeTypes map', () => {
    const context: WorkflowContext = {
      nodeTypes: {
        OtherNode: {
          name: 'OtherNode',
          ports: [
            { name: 'data', direction: 'OUTPUT', dataType: 'String' },
          ],
        },
      },
      instances: [{ id: 'myNode', nodeType: 'MissingNode' }],
    };

    const result = getFlowWeaverCompletions(
      ' * @connect myNode.',
      19,
      true,
      context,
    );
    expect(result).toEqual([]);
  });

  it('demotes already-connected output ports on source node', () => {
    const context: WorkflowContext = {
      nodeTypes: {
        Sender: {
          name: 'Sender',
          ports: [
            { name: 'onSuccess', direction: 'OUTPUT', dataType: 'STEP' },
            { name: 'result', direction: 'OUTPUT', dataType: 'String' },
            { name: 'error', direction: 'OUTPUT', dataType: 'String' },
          ],
        },
      },
      instances: [{ id: 'sender1', nodeType: 'Sender' }],
      connections: [
        {
          sourceNode: 'sender1',
          sourcePort: 'result',
          targetNode: 'other',
          targetPort: 'input',
        },
      ],
    };

    // Source port completions (before ->)
    const result = getFlowWeaverCompletions(
      ' * @connect sender1.',
      20,
      true,
      context,
    );

    expect(result.length).toBe(3);
    // 'result' is already connected as an output, so it should sort last
    const resultPort = result.find((c) => c.label === 'result');
    expect(resultPort?.detail).toContain('(connected)');
    expect(result[result.length - 1].label).toBe('result');
  });
});
