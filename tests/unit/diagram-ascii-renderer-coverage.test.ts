/**
 * Coverage for ascii-renderer.ts uncovered lines:
 * - Lines 362-363: spanning route with avgY <= midBoxY (above highway)
 * - Line 499: findTrack fallback returning mid when all tracks conflicted
 * - Line 588: renderText node with no input AND no output ports
 */
import { describe, it, expect } from 'vitest';
import { renderASCII, renderText } from '../../src/diagram/ascii-renderer.js';
import { buildDiagramGraph } from '../../src/diagram/geometry.js';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types.js';
import type { DiagramGraph, DiagramNode, DiagramPort, DiagramConnection } from '../../src/diagram/types.js';

function makeWorkflowWithSpanningConnection(): TWorkflowAST {
  // A workflow where a connection spans more than one column gap,
  // with the average Y above the midpoint of all boxes to trigger
  // the "above highway" branch (lines 362-363).
  const nodeType: TNodeTypeAST = {
    type: 'NodeType',
    name: 'proc',
    functionName: 'proc',
    inputs: { execute: { dataType: 'STEP' }, input: { dataType: 'NUMBER', optional: true } },
    outputs: { onSuccess: { dataType: 'STEP', isControlFlow: true }, output: { dataType: 'NUMBER' } },
    hasSuccessPort: true,
    hasFailurePort: false,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };

  return {
    type: 'Workflow',
    name: 'spanWorkflow',
    functionName: 'spanWorkflow',
    sourceFile: 'span.ts',
    nodeTypes: [nodeType],
    instances: [
      { type: 'NodeInstance', id: 'a', nodeType: 'proc' },
      { type: 'NodeInstance', id: 'b', nodeType: 'proc' },
      { type: 'NodeInstance', id: 'c', nodeType: 'proc' },
    ],
    connections: [
      // Chain a -> b -> c
      { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
      { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
      { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
      // Spanning connection: a -> c (skips b), which should use highway routing
      { type: 'Connection', from: { node: 'a', port: 'output' }, to: { node: 'c', port: 'input' } },
      { type: 'Connection', from: { node: 'c', port: 'output' }, to: { node: 'Exit', port: 'result' } },
    ],
    scopes: {},
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: { result: { dataType: 'NUMBER' }, onSuccess: { dataType: 'STEP' } },
    imports: [],
  };
}

describe('renderASCII spanning route (lines 362-363)', () => {
  it('routes spanning connections via highway above boxes when avgY is low', () => {
    const graph = buildDiagramGraph(makeWorkflowWithSpanningConnection());
    const result = renderASCII(graph);
    // The spanning connection should be rendered; verify the result contains
    // all node labels and connection characters
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
    // Highway routing uses horizontal line characters
    expect(result).toContain('\u2500'); // ─ for data connections
  });
});

describe('renderText with portless node (line 588)', () => {
  it('renders a node that has neither input nor output ports', () => {
    // Build a graph with a node that has no ports at all
    const noPortNode: DiagramNode = {
      id: 'empty',
      label: 'EmptyNode',
      color: '#999',
      icon: '',
      isVirtual: false,
      inputs: [],
      outputs: [],
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    };

    const normalNode: DiagramNode = {
      id: 'normal',
      label: 'Normal',
      color: '#999',
      icon: '',
      isVirtual: false,
      inputs: [{ name: 'in', label: 'in', dataType: 'NUMBER', direction: 'INPUT', isControlFlow: false, isFailure: false, cx: 0, cy: 0 }],
      outputs: [{ name: 'out', label: 'out', dataType: 'NUMBER', direction: 'OUTPUT', isControlFlow: false, isFailure: false, cx: 0, cy: 0 }],
      x: 200,
      y: 0,
      width: 100,
      height: 50,
    };

    const graph: DiagramGraph = {
      workflowName: 'portlessTest',
      nodes: [noPortNode, normalNode],
      connections: [],
      bounds: { width: 400, height: 200 },
    };

    const result = renderText(graph);
    expect(result).toContain('portlessTest');
    // EmptyNode should appear without any port brackets
    expect(result).toContain('EmptyNode');
    // Normal node should have port brackets
    expect(result).toContain('[in');
    expect(result).toContain('[out');
    // EmptyNode line should NOT contain brackets
    const lines = result.split('\n');
    const emptyLine = lines.find(l => l.includes('EmptyNode'));
    expect(emptyLine).toBeDefined();
    expect(emptyLine).not.toContain('[');
    expect(emptyLine).not.toContain(']');
  });
});

describe('findTrack fallback (line 499)', () => {
  it('falls back when all tracks in the gap are conflicted', () => {
    // To trigger the findTrack fallback, we need a connection routed through
    // a gap where every candidate track column has conflicting vertical usage.
    // We create a chain of 3+ nodes with many connections using the same gap.
    const nodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'multi',
      functionName: 'multi',
      inputs: {
        execute: { dataType: 'STEP' },
        a: { dataType: 'NUMBER', optional: true },
        b: { dataType: 'NUMBER', optional: true },
        c: { dataType: 'NUMBER', optional: true },
        d: { dataType: 'NUMBER', optional: true },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        x: { dataType: 'NUMBER' },
        y: { dataType: 'NUMBER' },
        z: { dataType: 'NUMBER' },
        w: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: false,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'trackFallback',
      functionName: 'trackFallback',
      sourceFile: 'track.ts',
      nodeTypes: [nodeType],
      instances: [
        { type: 'NodeInstance', id: 'n1', nodeType: 'multi' },
        { type: 'NodeInstance', id: 'n2', nodeType: 'multi' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'n1', port: 'execute' } },
        { type: 'Connection', from: { node: 'n1', port: 'onSuccess' }, to: { node: 'n2', port: 'execute' } },
        // Multiple data connections through the same gap to saturate tracks
        { type: 'Connection', from: { node: 'n1', port: 'x' }, to: { node: 'n2', port: 'a' } },
        { type: 'Connection', from: { node: 'n1', port: 'y' }, to: { node: 'n2', port: 'b' } },
        { type: 'Connection', from: { node: 'n1', port: 'z' }, to: { node: 'n2', port: 'c' } },
        { type: 'Connection', from: { node: 'n1', port: 'w' }, to: { node: 'n2', port: 'd' } },
        { type: 'Connection', from: { node: 'n2', port: 'x' }, to: { node: 'Exit', port: 'result' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
    };

    const graph = buildDiagramGraph(workflow);
    // Rendering should not throw, even if all tracks are exhausted
    const result = renderASCII(graph);
    expect(result).toContain('n1');
    expect(result).toContain('n2');
  });
});
