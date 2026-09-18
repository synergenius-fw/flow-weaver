/**
 * An unknown code in [suppress: "..."] must not pass silently.
 *
 * The grammar is `suppress: "CODE", "CODE2"` -- comma-separated string
 * literals. Writing `suppress: "CODE,CODE2"` instead is a single string that
 * names no real code, so it suppresses nothing while looking like it works.
 * That silent no-op is what this rule catches.
 */

import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '../../src/api/validate';
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TConnectionAST,
} from '../../src/ast/types';

function makeNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: overrides.name || 'testNode',
    functionName: overrides.functionName || overrides.name || 'testNode',
    inputs: overrides.inputs || {},
    outputs: overrides.outputs || {},
    hasSuccessPort: overrides.hasSuccessPort ?? false,
    hasFailurePort: overrides.hasFailurePort ?? false,
    executeWhen: overrides.executeWhen || ('PULL_ANY' as TNodeTypeAST['executeWhen']),
    isAsync: overrides.isAsync ?? false,
    ...overrides,
  } as TNodeTypeAST;
}

function makeInstance(
  id: string,
  nodeType: string,
  config?: TNodeInstanceAST['config'],
): TNodeInstanceAST {
  return { type: 'NodeInstance', id, nodeType, ...(config && { config }) } as TNodeInstanceAST;
}

function conn(
  fromNode: string,
  fromPort: string,
  toNode: string,
  toPort: string,
): TConnectionAST {
  return {
    type: 'Connection',
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort },
  } as TConnectionAST;
}

/**
 * An async node with an unconnected onFailure: reliably produces
 * DESIGN_ASYNC_NO_ERROR_PATH, which the instance then tries to suppress.
 */
function workflowSuppressing(codes: string[]): TWorkflowAST {
  const asyncType = makeNodeType({
    name: 'fetchThing',
    isAsync: true,
    hasSuccessPort: true,
    hasFailurePort: true,
    inputs: { execute: { dataType: 'STEP' } },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      value: { dataType: 'STRING' },
    },
  });

  return {
    type: 'Workflow',
    name: 'wf',
    functionName: 'wf',
    nodeTypes: [asyncType],
    instances: [makeInstance('fetch', 'fetchThing', { suppressWarnings: codes })],
    connections: [
      conn('Start', 'execute', 'fetch', 'execute'),
      conn('fetch', 'value', 'Exit', 'value'),
    ],
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: { value: { dataType: 'STRING' } },
  } as unknown as TWorkflowAST;
}

describe('unknown suppress codes', () => {
  it('warns when a suppress code matches no known warning', () => {
    // The comma-in-one-string mistake: names a code that cannot exist.
    const ast = workflowSuppressing(['DESIGN_ASYNC_NO_ERROR_PATH,DESIGN_PULL_CANDIDATE']);
    const result = validateWorkflow(ast);

    const unknown = result.warnings.filter((w) => w.code === 'SUPPRESS_UNKNOWN_CODE');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].node).toBe('fetch');
    // The message should name the offending code so the author can spot it.
    expect(unknown[0].message).toContain(
      'DESIGN_ASYNC_NO_ERROR_PATH,DESIGN_PULL_CANDIDATE',
    );
  });

  it('stays silent for a correctly written suppress list', () => {
    const ast = workflowSuppressing(['DESIGN_ASYNC_NO_ERROR_PATH']);
    const result = validateWorkflow(ast);

    expect(result.warnings.filter((w) => w.code === 'SUPPRESS_UNKNOWN_CODE')).toHaveLength(0);
    // and the real warning is actually suppressed
    expect(
      result.warnings.filter((w) => w.code === 'DESIGN_ASYNC_NO_ERROR_PATH'),
    ).toHaveLength(0);
  });

  it('does not flag a real code that is absent from the documented catalogue', () => {
    // STUB_NODE is emitted by the validator but is not listed in
    // VALIDATION_CODES. The check must not depend on that catalogue being
    // complete, so suppressing a real-but-undocumented code stays silent.
    const ast = workflowSuppressing(['STUB_NODE']);
    const result = validateWorkflow(ast);

    expect(result.warnings.filter((w) => w.code === 'SUPPRESS_UNKNOWN_CODE')).toHaveLength(0);
  });
});
