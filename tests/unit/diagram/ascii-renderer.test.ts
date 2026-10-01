import { describe, it, expect } from 'vitest';
import { renderASCII, renderASCIICompact, renderText } from '../../../src/diagram/ascii-renderer';
import { buildDiagramGraph } from '../../../src/diagram/geometry';
import { sourceToASCII } from '../../../src/diagram/index';
import { createSimpleWorkflow, createParallelWorkflow, createChainWorkflow, createScopedWorkflow } from '../../helpers/test-fixtures';

describe('renderASCII', () => {
  it('contains workflow name and node labels', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('testWorkflow');
    expect(result).toContain('Start');
    expect(result).toContain('node1');
    expect(result).toContain('Exit');
  });

  it('contains port names for nodes', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('execute');
    expect(result).toContain('onSuccess');
  });

  it('uses box-drawing characters', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('\u250C'); // ┌
    expect(result).toContain('\u2510'); // ┐
    expect(result).toContain('\u2514'); // └
    expect(result).toContain('\u2518'); // ┘
    expect(result).toContain('\u2502'); // │
  });

  it('shows connected/not-connected symbols and legend', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('\u25CF'); // ● connected
    expect(result).toContain('\u25CB'); // ○ not connected
    expect(result).toContain('connected');
  });

  it('draws connection lines between ports', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCII(graph);
    // Connection lines use ─ (DATA) or ═ (STEP) and ▶ arrowheads
    expect(result).toContain('\u2500'); // ─
    expect(result).toContain('\u25B6'); // ▶
  });

  it('handles parallel branches', () => {
    const graph = buildDiagramGraph(createParallelWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('node1');
    expect(result).toContain('node2');
    expect(result).toContain('node3');
  });

  it('handles chain workflows', () => {
    const graph = buildDiagramGraph(createChainWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('node1');
    expect(result).toContain('node2');
    expect(result).toContain('node3');
  });

  it('handles scoped workflows', () => {
    const graph = buildDiagramGraph(createScopedWorkflow());
    const result = renderASCII(graph);
    expect(result).toContain('forEach1');
  });
});

describe('renderASCIICompact', () => {
  it('contains workflow name', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('testWorkflow');
  });

  it('renders node labels in boxes', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('Start');
    expect(result).toContain('node1');
    expect(result).toContain('Exit');
  });

  it('uses compact box-drawing characters', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('\u250C'); // ┌
    expect(result).toContain('\u2518'); // ┘
  });

  it('uses arrow connectors between boxes', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('\u2501\u2501\u2501\u25B6'); // ━━━▶
  });

  it('shows parallel nodes', () => {
    const graph = buildDiagramGraph(createParallelWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('Parallel:');
  });

  // A refund: approved, it is paid; declined, the gate's failure port leads to `decline`.
  const REFUND = `
/** @flowWeaver nodeType @expression */
function reviewRequest(amount: number): { summary: string } { return { summary: String(amount) }; }

/**
 * @flowWeaver nodeType
 * @input summary
 * @output note
 */
function managerApproval(execute: boolean, summary: string): { onSuccess: boolean; onFailure: boolean; note: string } {
  return { onSuccess: execute, onFailure: false, note: summary };
}

/** @flowWeaver nodeType @expression */
function issueRefund(note: string): { outcome: string } { return { outcome: note }; }

/** @flowWeaver nodeType @expression */
function declineRefund(summary: string): { declined: string } { return { declined: summary }; }

/**
 * @flowWeaver workflow
 * @param amount
 * @returns outcome
 * @returns declined
 * @node review reviewRequest
 * @node approval managerApproval
 * @node pay issueRefund
 * @node decline declineRefund
 * @path Start -> review -> approval -> pay -> Exit
 * @path Start -> review -> approval:fail -> decline -> Exit
 * @connect review.summary -> decline.summary
 */
export function refundRequest(execute: boolean, params: { amount: number }): { onSuccess: boolean; onFailure: boolean; outcome: string; declined: string } {
  throw new Error('generated body was not installed');
}
`;

  it('describes a failure arm as one, not as a parallel branch', () => {
    const result = sourceToASCII(REFUND, { format: 'ascii-compact' });
    expect(result).toContain('On failure of approval: decline');
    expect(result).not.toContain('Parallel');
  });

  it('says where a failure goes when it ends the run at once', () => {
    const CHECKED = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output value
 */
function check(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; value: number } {
  return { onSuccess: value > 0, onFailure: value <= 0, value };
}

/** @flowWeaver nodeType @expression */
function double(value: number): { result: number } { return { result: value * 2 }; }

/**
 * @flowWeaver workflow
 * @param value
 * @returns result
 * @node gate check
 * @node twice double
 * @path Start -> gate -> twice -> Exit
 * @path Start -> gate:fail -> Exit
 */
export function checked(execute: boolean, params: { value: number }): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('generated body was not installed');
}
`;
    const result = sourceToASCII(CHECKED, { format: 'ascii-compact' });
    expect(result).toContain('On failure of gate: Exit');
    // A workflow that routes no failure says nothing about failures.
    expect(sourceToASCII(REFUND.replace(' * @path Start -> review -> approval:fail -> decline -> Exit\n', '').replace(' * @connect review.summary -> decline.summary\n', ''), { format: 'ascii-compact' })).not.toContain('On failure');
  });

  it('never runs the main chain through a failure arm', () => {
    const result = sourceToASCII(REFUND, { format: 'ascii-compact' });
    const chain = result.split('\n').find((l) => l.includes('\u25B6')) ?? '';
    expect(chain).toMatch(/review.*approval.*pay.*Exit/);
    expect(chain).not.toContain('decline');
  });

  it('shows scoped children', () => {
    const graph = buildDiagramGraph(createScopedWorkflow());
    const result = renderASCIICompact(graph);
    expect(result).toContain('Scope');
    expect(result).toContain('child1');
  });
});

describe('renderText', () => {
  it('contains workflow name with underline', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderText(graph);
    expect(result).toContain('testWorkflow');
    expect(result).toContain('\u2550'.repeat('testWorkflow'.length));
  });

  it('lists all nodes', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderText(graph);
    expect(result).toContain('Nodes:');
    expect(result).toContain('Start');
    expect(result).toContain('node1');
    expect(result).toContain('Exit');
  });

  it('shows connected/not-connected port symbols', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderText(graph);
    // x on Start is connected (Start.x -> node1.input), so ●
    expect(result).toContain('x\u25CF');
    // execute on Start is not connected, so ○
    expect(result).toContain('execute\u25CB');
    // input on node1 is connected (receives from Start.x), so ●
    expect(result).toContain('input\u25CF');
  });

  it('lists connections with arrows', () => {
    const graph = buildDiagramGraph(createSimpleWorkflow());
    const result = renderText(graph);
    expect(result).toContain('Connections:');
    expect(result).toContain('Start.');
    expect(result).toContain('node1.');
  });

  it('marks STEP connections', () => {
    // Scoped workflow has STEP connections (execute ports are connected)
    const graph = buildDiagramGraph(createScopedWorkflow());
    const result = renderText(graph);
    expect(result).toContain('STEP');
  });

  it('handles parallel workflows', () => {
    const graph = buildDiagramGraph(createParallelWorkflow());
    const result = renderText(graph);
    expect(result).toContain('node1');
    expect(result).toContain('node2');
    expect(result).toContain('node3');
  });

  it('handles scoped workflows', () => {
    const graph = buildDiagramGraph(createScopedWorkflow());
    const result = renderText(graph);
    expect(result).toContain('forEach1');
    expect(result).toContain('scope:');
    expect(result).toContain('child1');
  });
});
