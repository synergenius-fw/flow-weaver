/**
 * Branch coverage tests for src/generator/unified.ts
 *
 * Targets uncovered branches: error paths, empty inputs, optional parameters,
 * early returns, ternary branches, nullish coalescing, and variant switches.
 */

import { generateControlFlowWithExecutionContext } from '../../src/generator/unified';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

// ---------------------------------------------------------------------------
// Helpers to build minimal AST fixtures
// ---------------------------------------------------------------------------

function makeWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    functionName: 'testWorkflow',
    instances: [],
    connections: [],
    exitPorts: {},
    nodeTypes: [],
    ...overrides,
  } as TWorkflowAST;
}

function makeNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    name: 'TestNode',
    functionName: 'testNode',
    inputs: { execute: { dataType: 'STEP' } },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP', failure: true },
      result: { dataType: 'string' },
    },
    isAsync: false,
    ...overrides,
  } as unknown as TNodeTypeAST;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateControlFlowWithExecutionContext', () => {
  // ── Empty / minimal workflow ──────────────────────────────────────────

  it('generates valid code for an empty workflow (no instances, no connections)', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], false);
    expect(result).toContain('ctx.addExecution');
    expect(result).toContain('return finalResult');
    expect(result).toContain('onSuccess: true');
    expect(result).toContain('onFailure: false');
  });

  it('generates valid code for an empty workflow in production mode', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], false, true);
    expect(result).not.toContain('__effectiveDebugger__');
    expect(result).not.toContain('__ctrl__');
    expect(result).toContain('return finalResult');
  });

  it('generates valid code for an empty workflow in async mode', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], true);
    expect(result).toContain('true');
    expect(result).toContain('return finalResult');
  });

  it('generates valid code for an empty workflow in bundle mode', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], false, false, true);
    expect(result).toContain('return finalResult');
  });

  // ── production=true vs production=false ──

  it('in dev mode emits debugger detection and debug controller', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], false, false);
    expect(result).toContain('__effectiveDebugger__');
    expect(result).toContain('__ctrl__');
    expect(result).toContain('createFlowWeaverDebugClient');
  });

  it('in production mode emits no debugger and no debug controller', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], false, true);
    expect(result).not.toContain('__effectiveDebugger__');
    expect(result).not.toContain('__ctrl__');
    expect(result).not.toContain('createFlowWeaverDebugClient');
    expect(result).toContain('const ctx = new GeneratedExecutionContext(false, __abortSignal__)');
  });

  // ── isAsync=true vs isAsync=false ──

  it('async mode uses await for setVariable and getVariable', () => {
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string' } },
      instances: [{ id: 'myNode', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'myNode', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const nodeType = makeNodeType();
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], true);
    expect(result).toContain('await ctx.setVariable');
    expect(result).toContain('await ctx.getVariable');
    expect(result).toContain('GeneratedExecutionContext(true');
  });

  it('sync mode does not use await for setVariable and getVariable', () => {
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string' } },
      instances: [{ id: 'myNode', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'myNode', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const nodeType = makeNodeType();
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('ctx.setVariable');
    expect(result).toContain('ctx.getVariable');
    expect(result).toContain('GeneratedExecutionContext(false');
  });

  // ── Node type not found ──

  it('skips nodes whose node type is not found', () => {
    const workflow = makeWorkflow({
      instances: [{ id: 'myNode', nodeType: 'UnknownType' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'myNode', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
      exitPorts: { result: { dataType: 'string' } },
    });
    const result = generateControlFlowWithExecutionContext(workflow, [], false);
    expect(result).toContain("type 'UnknownType' not found");
  });

  // ── Exit connections: undeclared exit ports ──

  it('skips exit connections to undeclared exit ports', () => {
    const nodeType = makeNodeType();
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string' } },
      instances: [{ id: 'myNode', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'myNode', port: 'result' }, to: { node: 'Exit', port: 'result' } },
        { from: { node: 'myNode', port: 'result' }, to: { node: 'Exit', port: 'nonexistent' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain("not a declared @returns port");
  });

  // ── Exit connections: source node not declared ──

  it('skips exit connections from undeclared source nodes', () => {
    const nodeType = makeNodeType();
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string' } },
      instances: [{ id: 'myNode', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'ghostNode', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain("source node 'ghostNode' is not declared");
  });

  // ── Exit connections: source node has missing type ──

  it('skips exit connections from nodes with missing types', () => {
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string' } },
      instances: [
        { id: 'myNode', nodeType: 'MissingType' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'myNode', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [], false);
    expect(result).toContain("has missing type 'MissingType'");
  });

  // ── Exit connections: all valid conns filtered out => undefined fallback ──

  it('uses undefined fallback when all exit connections are invalid', () => {
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string' } },
      instances: [] as any,
      connections: [
        { from: { node: 'ghost', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [], false);
    expect(result).toContain('undefined as unknown');
  });

  // ── Exit ports: default onSuccess/onFailure when not connected ──

  it('adds default onSuccess:true and onFailure:false when not explicitly connected', () => {
    const workflow = makeWorkflow({
      exitPorts: { data: { dataType: 'number' } },
    });
    const result = generateControlFlowWithExecutionContext(workflow, [], false);
    expect(result).toContain('onSuccess: true');
    expect(result).toContain('onFailure: false');
  });

  // ── Exit connections: onSuccess control flow port ──

  it('handles onSuccess exit port with boolean false default', () => {
    const nodeType = makeNodeType();
    const workflow = makeWorkflow({
      exitPorts: { onSuccess: { dataType: 'boolean' } },
      instances: [{ id: 'myNode', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'myNode', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).not.toMatch(/onSuccess: true,.*onFailure/);
  });

  // ── Exit ports: unconnected exit ports get undefined default ──

  it('adds undefined for declared exit ports with no valid connections', () => {
    const workflow = makeWorkflow({
      exitPorts: {
        result: { dataType: 'string' },
        extra: { dataType: 'number' },
      },
      instances: [{ id: 'myNode', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'myNode', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const nodeType = makeNodeType();
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain("Exit port 'extra' has no valid connection");
  });

  // ── Multiple connections to same exit port ──

  it('coalesces multiple connections to the same exit port with ?? operator', () => {
    const nodeType = makeNodeType();
    const nodeType2 = makeNodeType({ name: 'TestNode2', functionName: 'testNode2' });
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string' } },
      instances: [
        { id: 'nodeA', nodeType: 'TestNode' },
        { id: 'nodeB', nodeType: 'TestNode2' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'nodeA', port: 'execute' } },
        { from: { node: 'Start', port: 'execute' }, to: { node: 'nodeB', port: 'execute' } },
        { from: { node: 'nodeA', port: 'result' }, to: { node: 'Exit', port: 'result' } },
        { from: { node: 'nodeB', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType, nodeType2], false);
    expect(result).toContain('??');
  });

  // ── Multiple connections to onSuccess exit port uses || operator ──

  it('coalesces multiple connections to onSuccess exit port with || operator', () => {
    const nodeType = makeNodeType();
    const nodeType2 = makeNodeType({ name: 'TestNode2', functionName: 'testNode2' });
    const workflow = makeWorkflow({
      exitPorts: { onSuccess: { dataType: 'boolean' } },
      instances: [
        { id: 'nodeA', nodeType: 'TestNode' },
        { id: 'nodeB', nodeType: 'TestNode2' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'nodeA', port: 'execute' } },
        { from: { node: 'Start', port: 'execute' }, to: { node: 'nodeB', port: 'execute' } },
        { from: { node: 'nodeA', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        { from: { node: 'nodeB', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType, nodeType2], false);
    expect(result).toContain('||');
  });

  // ── Production mode: no VARIABLE_SET emit for exit connections ──

  it('does not emit VARIABLE_SET for exit connections in production mode', () => {
    const nodeType = makeNodeType();
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string' } },
      instances: [{ id: 'myNode', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'myNode', port: 'execute' } },
        { from: { node: 'myNode', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false, true);
    const exitSetVariableCalls = result.split('\n').filter(
      (l) => l.includes("id: 'Exit'") && l.includes('setVariable')
    );
    expect(exitSetVariableCalls.length).toBe(0);
  });

  // ── Production mode: no VARIABLE_SET for default onSuccess/onFailure ──

  it('does not emit default onSuccess/onFailure VARIABLE_SET in production mode', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], false, true);
    const exitSetVarCalls = result.split('\n').filter(
      (l) => l.includes("id: 'Exit'") && l.includes('setVariable')
    );
    expect(exitSetVarCalls.length).toBe(0);
  });

  // ── Node variants: STUB ──

  it('generates a throw for STUB variant nodes', () => {
    const nodeType = makeNodeType({
      variant: 'STUB' as any,
      name: 'StubNode',
      functionName: 'stubNode',
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'stub1', nodeType: 'StubNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'stub1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('uses stub type');
    expect(result).toContain('throw new Error');
  });

  // ── Node variants: COERCION ──

  it('generates inline coercion for COERCION variant nodes (String)', () => {
    const nodeType = makeNodeType({
      variant: 'COERCION' as any,
      name: '__fw_toString',
      functionName: '__fw_toString',
      expression: true,
      inputs: { value: { dataType: 'any' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'coerce1', nodeType: '__fw_toString' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'coerce1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('String(');
  });

  it('generates Number coercion for __fw_toNumber', () => {
    const nodeType = makeNodeType({
      variant: 'COERCION' as any,
      name: '__fw_toNumber',
      functionName: '__fw_toNumber',
      expression: true,
      inputs: { value: { dataType: 'any' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'number' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'coerce2', nodeType: '__fw_toNumber' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'coerce2', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('Number(');
  });

  it('generates Boolean coercion for __fw_toBoolean', () => {
    const nodeType = makeNodeType({
      variant: 'COERCION' as any,
      name: '__fw_toBoolean',
      functionName: '__fw_toBoolean',
      expression: true,
      inputs: { value: { dataType: 'any' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'boolean' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'coerce3', nodeType: '__fw_toBoolean' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'coerce3', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('Boolean(');
  });

  it('generates JSON.stringify for __fw_toJSON and JSON.parse for __fw_parseJSON', () => {
    const toJsonType = makeNodeType({
      variant: 'COERCION' as any,
      name: '__fw_toJSON',
      functionName: '__fw_toJSON',
      expression: true,
      inputs: { value: { dataType: 'any' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const parseJsonType = makeNodeType({
      variant: 'COERCION' as any,
      name: '__fw_parseJSON',
      functionName: '__fw_parseJSON',
      expression: true,
      inputs: { value: { dataType: 'string' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'any' },
      },
    });

    const workflow1 = makeWorkflow({
      instances: [{ id: 'j1', nodeType: '__fw_toJSON' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'j1', port: 'execute' } },
      ] as any,
    });
    const result1 = generateControlFlowWithExecutionContext(workflow1, [toJsonType], false);
    expect(result1).toContain('JSON.stringify(');

    const workflow2 = makeWorkflow({
      instances: [{ id: 'j2', nodeType: '__fw_parseJSON' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'j2', port: 'execute' } },
      ] as any,
    });
    const result2 = generateControlFlowWithExecutionContext(workflow2, [parseJsonType], false);
    expect(result2).toContain('JSON.parse(');
  });

  it('falls back to String for unknown coercion function names', () => {
    const nodeType = makeNodeType({
      variant: 'COERCION' as any,
      name: '__fw_unknownCoerce',
      functionName: '__fw_unknownCoerce',
      expression: true,
      inputs: { value: { dataType: 'any' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'unk1', nodeType: '__fw_unknownCoerce' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'unk1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('String(');
  });

  // ── Node variants: expression node with single data output ──

  it('handles expression node with single data output port (destructure check)', () => {
    const nodeType = makeNodeType({
      expression: true,
      name: 'ExprNode',
      functionName: 'exprNode',
      inputs: { value: { dataType: 'string' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'expr1', nodeType: 'ExprNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'expr1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('typeof');
    expect(result).toContain("'result' in");
  });

  // ── Node variants: expression node with multiple data output ports ──

  it('handles expression node with multiple data output ports', () => {
    const nodeType = makeNodeType({
      expression: true,
      name: 'MultiExprNode',
      functionName: 'multiExprNode',
      inputs: { value: { dataType: 'string' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        resultA: { dataType: 'string' },
        resultB: { dataType: 'number' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'mexpr1', nodeType: 'MultiExprNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'mexpr1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('mexpr1Result.resultA');
    expect(result).toContain('mexpr1Result.resultB');
  });

  // ── Node variants: IMPORTED_WORKFLOW ──

  it('generates workflow call pattern for IMPORTED_WORKFLOW variant', () => {
    const nodeType = makeNodeType({
      variant: 'IMPORTED_WORKFLOW' as any,
      name: 'SubWorkflow',
      functionName: 'subWorkflow',
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'sub1', nodeType: 'SubWorkflow' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'sub1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('__rd__: __rd__ + 1');
    expect(result).toContain('__sub1Params__');
  });

  // ── Node variants: WORKFLOW ──

  it('generates workflow call pattern for WORKFLOW variant', () => {
    const nodeType = makeNodeType({
      variant: 'WORKFLOW' as any,
      name: 'InternalWf',
      functionName: 'internalWf',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'number' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        output: { dataType: 'number' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'wf1', nodeType: 'InternalWf' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'wf1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('__rd__: __rd__ + 1');
  });

  // ── Node variants: scoped node ──

  it('generates scoped node call with positional arguments', () => {
    const nodeType = makeNodeType({
      name: 'ScopedNode',
      functionName: 'scopedNode',
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'array' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'any' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'scoped1', nodeType: 'ScopedNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'scoped1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('scopedNode(');
  });

  // ── Pull execution ──

  it('generates pull execution nodes with lazy executor', () => {
    const nodeType = makeNodeType({
      name: 'PullNode',
      functionName: 'pullNode',
      defaultConfig: { pullExecution: true },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'pull1', nodeType: 'PullNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pull1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('Pull execution node');
    expect(result).toContain('registerPullExecutor');
    expect(result).toContain('pull1_executor');
  });

  it('handles pull execution config as boolean on instance', () => {
    const nodeType = makeNodeType({
      name: 'PullNode2',
      functionName: 'pullNode2',
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'pull2', nodeType: 'PullNode2', config: { pullExecution: true } },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pull2', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('registerPullExecutor');
  });

  it('handles pull execution config as object with triggerPort on instance', () => {
    const nodeType = makeNodeType({
      name: 'PullNode3',
      functionName: 'pullNode3',
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'pull3', nodeType: 'PullNode3', config: { pullExecution: { triggerPort: 'trigger' } } },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pull3', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('registerPullExecutor');
  });

  it('handles pull execution config as object with no triggerPort (defaults to execute)', () => {
    const nodeType = makeNodeType({
      name: 'PullNode4',
      functionName: 'pullNode4',
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'pull4', nodeType: 'PullNode4', config: { pullExecution: { } } },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pull4', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('registerPullExecutor');
  });

  it('handles pull execution defaultConfig as object with triggerPort on nodeType', () => {
    const nodeType = makeNodeType({
      name: 'PullNode5',
      functionName: 'pullNode5',
      defaultConfig: { pullExecution: { triggerPort: 'customTrigger' } },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'pull5', nodeType: 'PullNode5' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pull5', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('registerPullExecutor');
  });

  it('handles pull execution defaultConfig as object with no triggerPort on nodeType', () => {
    const nodeType = makeNodeType({
      name: 'PullNode6',
      functionName: 'pullNode6',
      defaultConfig: { pullExecution: { } },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'pull6', nodeType: 'PullNode6' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pull6', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('registerPullExecutor');
  });

  it('pull execution with async node generates async executor', () => {
    const nodeType = makeNodeType({
      name: 'AsyncPullNode',
      functionName: 'asyncPullNode',
      isAsync: true,
      defaultConfig: { pullExecution: true },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'apull1', nodeType: 'AsyncPullNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'apull1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('async ()');
    expect(result).toContain('await');
  });

  // ── Pull execution: IMPORTED_WORKFLOW variant ──

  it('pull execution with IMPORTED_WORKFLOW variant includes recursion depth', () => {
    const nodeType = makeNodeType({
      variant: 'IMPORTED_WORKFLOW' as any,
      name: 'PullSubWf',
      functionName: 'pullSubWf',
      defaultConfig: { pullExecution: true },
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'psw1', nodeType: 'PullSubWf' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'psw1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('__rd__: __rd__ + 1');
  });

  // ── Pull execution: MAP_ITERATOR variant ──

  it('pull execution with MAP_ITERATOR variant generates inline iteration', () => {
    const nodeType = makeNodeType({
      variant: 'MAP_ITERATOR' as any,
      name: 'PullMap',
      functionName: 'pullMap',
      defaultConfig: { pullExecution: true },
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'array' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        results: { dataType: 'array' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'pm1', nodeType: 'PullMap' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pm1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('for (const __item of');
  });

  // ── Pull execution: scoped node variant ──

  it('pull execution with scoped node generates positional args', () => {
    const nodeType = makeNodeType({
      name: 'PullScoped',
      functionName: 'pullScoped',
      scope: 'body',
      defaultConfig: { pullExecution: true },
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'array' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'ps1', nodeType: 'PullScoped' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'ps1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('pullScoped(');
    expect(result).toContain('registerPullExecutor');
  });

  // ── Branching node: basic ──

  it('generates branching node code with success/failure branches', () => {
    const branchType = makeNodeType({
      name: 'BranchNode',
      functionName: 'branchNode',
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const successType = makeNodeType({
      name: 'SuccessHandler',
      functionName: 'successHandler',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        output: { dataType: 'string' },
      },
    });
    const failureType = makeNodeType({
      name: 'FailureHandler',
      functionName: 'failureHandler',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        output: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'branch1', nodeType: 'BranchNode' },
        { id: 'onOk', nodeType: 'SuccessHandler' },
        { id: 'onFail', nodeType: 'FailureHandler' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'branch1', port: 'execute' } },
        { from: { node: 'branch1', port: 'onSuccess' }, to: { node: 'onOk', port: 'execute' } },
        { from: { node: 'branch1', port: 'onFailure' }, to: { node: 'onFail', port: 'execute' } },
        { from: { node: 'branch1', port: 'result' }, to: { node: 'onOk', port: 'input' } },
        { from: { node: 'branch1', port: 'result' }, to: { node: 'onFail', port: 'input' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [branchType, successType, failureType],
      false
    );
    expect(result).toContain('branch1_success');
    expect(result).toContain('if (branch1_success)');
    expect(result).toContain('CANCELLED');
  });

  // ── Branching node: expression type ──

  it('generates expression branching node with auto onSuccess/onFailure', () => {
    const exprBranch = makeNodeType({
      name: 'ExprBranch',
      functionName: 'exprBranch',
      expression: true,
      inputs: {
        value: { dataType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const successHandler = makeNodeType({
      name: 'Handler',
      functionName: 'handler',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'eb1', nodeType: 'ExprBranch' },
        { id: 'h1', nodeType: 'Handler' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'eb1', port: 'execute' } },
        { from: { node: 'eb1', port: 'onSuccess' }, to: { node: 'h1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [exprBranch, successHandler],
      false
    );
    expect(result).toContain('eb1_success = true');
  });

  // ── Branching node: MAP_ITERATOR variant ──

  it('generates MAP_ITERATOR branching node with inline iteration', () => {
    const mapType = makeNodeType({
      variant: 'MAP_ITERATOR' as any,
      name: 'MapNode',
      functionName: 'mapNode',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'array' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        results: { dataType: 'array' },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'map1', nodeType: 'MapNode' },
        { id: 'after', nodeType: 'TestNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'map1', port: 'execute' } },
        { from: { node: 'map1', port: 'onSuccess' }, to: { node: 'after', port: 'execute' } },
      ] as any,
    });
    const nodeType = makeNodeType();
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [mapType, nodeType],
      false
    );
    expect(result).toContain('for (const __item of');
    expect(result).toContain('__results');
  });

  // ── Branching node: IMPORTED_WORKFLOW variant ──

  it('generates IMPORTED_WORKFLOW branching node with params object', () => {
    const wfType = makeNodeType({
      variant: 'IMPORTED_WORKFLOW' as any,
      name: 'SubWfBranch',
      functionName: 'subWfBranch',
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const handlerType = makeNodeType({
      name: 'PostHandler',
      functionName: 'postHandler',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'swb1', nodeType: 'SubWfBranch' },
        { id: 'ph1', nodeType: 'PostHandler' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'swb1', port: 'execute' } },
        { from: { node: 'swb1', port: 'onSuccess' }, to: { node: 'ph1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [wfType, handlerType],
      false
    );
    expect(result).toContain('__rd__: __rd__ + 1');
    expect(result).toContain('__swb1Params__');
  });

  // ── Branching node: scoped branching node ──

  it('generates scoped branching node with positional args', () => {
    const scopedBranch = makeNodeType({
      name: 'ScopedBranch',
      functionName: 'scopedBranch',
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'array' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'any' },
      },
    });
    const handlerType = makeNodeType({
      name: 'PostScopedHandler',
      functionName: 'postScopedHandler',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'sb1', nodeType: 'ScopedBranch' },
        { id: 'psh1', nodeType: 'PostScopedHandler' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'sb1', port: 'execute' } },
        { from: { node: 'sb1', port: 'onSuccess' }, to: { node: 'psh1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [scopedBranch, handlerType],
      false
    );
    expect(result).toContain('scopedBranch(');
  });

  // ── Branching node in production mode (no debug hooks) ──

  it('branching node in production mode skips debug hooks', () => {
    const branchType = makeNodeType({
      name: 'ProdBranch',
      functionName: 'prodBranch',
    });
    const handlerType = makeNodeType({
      name: 'ProdHandler',
      functionName: 'prodHandler',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'pb1', nodeType: 'ProdBranch' },
        { id: 'ph2', nodeType: 'ProdHandler' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pb1', port: 'execute' } },
        { from: { node: 'pb1', port: 'onSuccess' }, to: { node: 'ph2', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [branchType, handlerType],
      false,
      true
    );
    expect(result).not.toContain('__ctrl__');
    expect(result).not.toContain('beforeNode');
  });

  // ── Execution strategy: CONJUNCTION ──

  it('generates CONJUNCTION (AND) guard for nodes with multiple STEP inputs', () => {
    const nodeType = makeNodeType({
      name: 'ConjNode',
      functionName: 'conjNode',
      executeWhen: 'CONJUNCTION',
      inputs: {
        execute: { dataType: 'STEP' },
        trigger2: { dataType: 'STEP' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const srcType = makeNodeType({
      name: 'SrcNode',
      functionName: 'srcNode',
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        done: { dataType: 'STEP' },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'src1', nodeType: 'SrcNode' },
        { id: 'conj1', nodeType: 'ConjNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'src1', port: 'execute' } },
        { from: { node: 'src1', port: 'onSuccess' }, to: { node: 'conj1', port: 'execute' } },
        { from: { node: 'src1', port: 'done' }, to: { node: 'conj1', port: 'trigger2' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType, srcType], false);
    expect(result).toContain('&&');
  });

  // ── Execution strategy: DISJUNCTION ──

  it('generates DISJUNCTION (OR) guard for nodes with multiple STEP inputs', () => {
    const nodeType = makeNodeType({
      name: 'DisjNode',
      functionName: 'disjNode',
      executeWhen: 'DISJUNCTION',
      inputs: {
        execute: { dataType: 'STEP' },
        trigger2: { dataType: 'STEP' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const srcType = makeNodeType({
      name: 'SrcNodeD',
      functionName: 'srcNodeD',
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        done: { dataType: 'STEP' },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'srcd1', nodeType: 'SrcNodeD' },
        { id: 'disj1', nodeType: 'DisjNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'srcd1', port: 'execute' } },
        { from: { node: 'srcd1', port: 'onSuccess' }, to: { node: 'disj1', port: 'execute' } },
        { from: { node: 'srcd1', port: 'done' }, to: { node: 'disj1', port: 'trigger2' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType, srcType], false);
    expect(result).toContain('||');
  });

  // ── Execution strategy: CUSTOM with valid condition ──

  it('generates CUSTOM guard with customExecuteCondition', () => {
    const nodeType = makeNodeType({
      name: 'CustomNode',
      functionName: 'customNode',
      executeWhen: 'CUSTOM',
      metadata: { customExecuteCondition: 'someFlag === true' },
      inputs: {
        execute: { dataType: 'STEP' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const srcType = makeNodeType({
      name: 'SrcC',
      functionName: 'srcC',
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'srcc1', nodeType: 'SrcC' },
        { id: 'cust1', nodeType: 'CustomNode' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'srcc1', port: 'execute' } },
        { from: { node: 'srcc1', port: 'onSuccess' }, to: { node: 'cust1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType, srcType], false);
    expect(result).toContain('someFlag === true');
  });

  // ── Execution strategy: CUSTOM without condition (fallback to CONJUNCTION) ──

  it('CUSTOM strategy falls back to CONJUNCTION when no customExecuteCondition', () => {
    const nodeType = makeNodeType({
      name: 'CustomFallback',
      functionName: 'customFallback',
      executeWhen: 'CUSTOM',
      metadata: {},
      inputs: {
        execute: { dataType: 'STEP' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const srcType = makeNodeType({
      name: 'SrcFall',
      functionName: 'srcFall',
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'sf1', nodeType: 'SrcFall' },
        { id: 'cf1', nodeType: 'CustomFallback' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'sf1', port: 'execute' } },
        { from: { node: 'sf1', port: 'onSuccess' }, to: { node: 'cf1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType, srcType], false);
    expect(result).toContain('sf1Idx !== undefined');
  });

  // ── Expression node catch block: auto-set failure flags ──

  it('expression node catch block auto-sets onFailure flags', () => {
    const exprType = makeNodeType({
      name: 'ExprFail',
      functionName: 'exprFail',
      expression: true,
      inputs: { value: { dataType: 'string' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'ef1', nodeType: 'ExprFail' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'ef1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [exprType], false);
    expect(result).toContain("portName: 'onFailure'");
    expect(result).toContain("portName: 'onSuccess'");
  });

  // ── Recursion depth protection ──

  it('always includes recursion depth protection', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], false);
    expect(result).toContain('__rd__');
    expect(result).toContain('Max recursion depth exceeded');
    expect(result).toContain('>= 1000');
  });

  // ── Node-level scoped children ──

  it('generates node-level scoped children with scope context', () => {
    const parentType = makeNodeType({
      name: 'ParentNode',
      functionName: 'parentNode',
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'array' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'any' },
      },
    });
    const childType = makeNodeType({
      name: 'ChildNode',
      functionName: 'childNode',
      inputs: {
        execute: { dataType: 'STEP' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'parent1', nodeType: 'ParentNode' },
        { id: 'child1', nodeType: 'ChildNode', parent: { id: 'parent1', scope: 'body' } },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'parent1', port: 'execute' } },
        { from: { node: 'parent1', port: 'onSuccess' }, to: { node: 'child1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [parentType, childType],
      false
    );
    expect(result).toContain('createScope');
    expect(result).toContain('mergeScope');
  });

  // ── useConst=true with debug hooks (non-production) ──

  it('hoists let declaration when useConst=true with debug hooks', () => {
    const nodeType = makeNodeType({
      name: 'ConstNode',
      functionName: 'constNode',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'cn1', nodeType: 'ConstNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'cn1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false, false);
    expect(result).toContain('let cn1Idx: number;');
    expect(result).toContain('__ctrl__.beforeNode');
  });

  // ── useConst=true without debug hooks (production mode) ──

  it('uses const declaration in production mode for non-branch nodes', () => {
    const nodeType = makeNodeType({
      name: 'ConstProdNode',
      functionName: 'constProdNode',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'cpn1', nodeType: 'ConstProdNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'cpn1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false, true);
    expect(result).toContain('const cpn1Idx = ctx.addExecution');
  });

  // ── Branching node: only success downstream ──

  it('branching node with only success downstream and no failure nodes', () => {
    const branchType = makeNodeType({
      name: 'OnlySucc',
      functionName: 'onlySucc',
    });
    const succType = makeNodeType({
      name: 'SuccOnly',
      functionName: 'succOnly',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'os1', nodeType: 'OnlySucc' },
        { id: 'so1', nodeType: 'SuccOnly' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'os1', port: 'execute' } },
        { from: { node: 'os1', port: 'onSuccess' }, to: { node: 'so1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [branchType, succType],
      false
    );
    expect(result).toContain('os1_success');
    expect(result).toContain('CANCELLED');
  });

  // ── Async mode for branching nodes ──

  it('async branching node uses await for hooks and calls', () => {
    const branchType = makeNodeType({
      name: 'AsyncBranch',
      functionName: 'asyncBranch',
      isAsync: true,
    });
    const handlerType = makeNodeType({
      name: 'AsyncHandler',
      functionName: 'asyncHandler',
      isAsync: true,
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'ab1', nodeType: 'AsyncBranch' },
        { id: 'ah1', nodeType: 'AsyncHandler' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'ab1', port: 'execute' } },
        { from: { node: 'ab1', port: 'onSuccess' }, to: { node: 'ah1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [branchType, handlerType],
      true
    );
    expect(result).toContain('await __ctrl__.beforeNode');
    expect(result).toContain('await __ctrl__.afterNode');
  });

  // ── Node with scopes array ──

  it('handles node with scopes array', () => {
    const scopesType = makeNodeType({
      name: 'MultiScopedNode',
      functionName: 'multiScopedNode',
      scopes: ['bodyA', 'bodyB'] as any,
      inputs: {
        execute: { dataType: 'STEP' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'any' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'ms1', nodeType: 'MultiScopedNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'ms1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [scopesType], false);
    expect(result).toContain('multiScopedNode(');
  });

  // ── Node matching by functionName ──

  it('matches node type by functionName when name does not match', () => {
    const nodeType = makeNodeType({
      name: 'npm/pkg/myFunc',
      functionName: 'myFunc',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'nf1', nodeType: 'myFunc' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'nf1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('myFunc(');
  });

  // ── checkAborted is always emitted ──

  it('emits checkAborted for every node', () => {
    const nodeType = makeNodeType({
      name: 'AbortCheck',
      functionName: 'abortCheck',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'ac1', nodeType: 'AbortCheck' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'ac1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain("checkAborted('ac1')");
  });

  // ── Workflow completed event ──

  it('emits workflow completed event at the end', () => {
    const workflow = makeWorkflow();
    const result = generateControlFlowWithExecutionContext(workflow, [], false);
    expect(result).toContain('sendWorkflowCompletedEvent');
    expect(result).toContain("status: 'SUCCEEDED'");
  });

  // ── globalThis current node id tracking ──

  it('sets __fw_current_node_id__ on globalThis for each node', () => {
    const nodeType = makeNodeType({
      name: 'TrackNode',
      functionName: 'trackNode',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'tn1', nodeType: 'TrackNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'tn1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain("__fw_current_node_id__ = 'tn1'");
  });

  // ── CancellationError check in catch blocks ──

  it('checks for CancellationError in catch blocks', () => {
    const nodeType = makeNodeType({
      name: 'CancelCheck',
      functionName: 'cancelCheck',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'cc1', nodeType: 'CancelCheck' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'cc1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('CancellationError.isCancellationError');
    expect(result).toContain("isCancellation ? 'CANCELLED' : 'FAILED'");
  });

  // ── Scoped output ports are skipped ──

  it('skips scoped output ports in result extraction', () => {
    const nodeType = makeNodeType({
      name: 'ScopeOutNode',
      functionName: 'scopeOutNode',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
        scopedPort: { dataType: 'any', scope: 'body' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'son1', nodeType: 'ScopeOutNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'son1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).not.toContain("portName: 'scopedPort'");
  });

  // ── Exit port tsType override ──

  it('uses tsType from exit port definition when available', () => {
    const nodeType = makeNodeType();
    const workflow = makeWorkflow({
      exitPorts: { result: { dataType: 'string', tsType: 'CustomType' } as any },
      instances: [{ id: 'ts1', nodeType: 'TestNode' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'ts1', port: 'execute' } },
        { from: { node: 'ts1', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('as CustomType');
  });

  // ── Expression node promoted from branch gets STEP guard ──

  it('expression node not in inputs gets execute STEP connection for guard', () => {
    const exprType = makeNodeType({
      name: 'PromExpr',
      functionName: 'promExpr',
      expression: true,
      inputs: {
        value: { dataType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const srcType = makeNodeType({
      name: 'GuardSrc',
      functionName: 'guardSrc',
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'gs1', nodeType: 'GuardSrc' },
        { id: 'pe1', nodeType: 'PromExpr' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'gs1', port: 'execute' } },
        { from: { node: 'gs1', port: 'onSuccess' }, to: { node: 'pe1', port: 'execute' } },
        { from: { node: 'gs1', port: 'result' }, to: { node: 'pe1', port: 'value' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [exprType, srcType], false);
    expect(result).toContain('promExpr(');
  });

  // ── MAP_ITERATOR node (non-branching, non-pull) ──

  it('generates MAP_ITERATOR inline iteration for regular node call', () => {
    const mapType = makeNodeType({
      variant: 'MAP_ITERATOR' as any,
      name: 'RegMap',
      functionName: 'regMap',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'array' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        results: { dataType: 'array' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'rm1', nodeType: 'RegMap' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'rm1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [mapType], false);
    expect(result).toContain('for (const __item of');
  });

  // ── Branching node: expression with multiple data outputs ──

  it('expression branching node with multiple data outputs uses destructure', () => {
    const exprMulti = makeNodeType({
      name: 'ExprMultiBranch',
      functionName: 'exprMultiBranch',
      expression: true,
      inputs: { value: { dataType: 'string' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        resultA: { dataType: 'string' },
        resultB: { dataType: 'number' },
      },
    });
    const handler = makeNodeType({
      name: 'PostMulti',
      functionName: 'postMulti',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'emb1', nodeType: 'ExprMultiBranch' },
        { id: 'pm1', nodeType: 'PostMulti' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'emb1', port: 'execute' } },
        { from: { node: 'emb1', port: 'onSuccess' }, to: { node: 'pm1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [exprMulti, handler],
      false
    );
    expect(result).toContain('emb1Result.resultA');
    expect(result).toContain('emb1Result.resultB');
  });

  // ── Branching node: WORKFLOW variant ──

  it('generates WORKFLOW branching node with params object', () => {
    const wfType = makeNodeType({
      variant: 'WORKFLOW' as any,
      name: 'WfBranch',
      functionName: 'wfBranch',
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
      },
    });
    const handlerType = makeNodeType({
      name: 'WfHandler',
      functionName: 'wfHandler',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
      },
    });
    const workflow = makeWorkflow({
      instances: [
        { id: 'wb1', nodeType: 'WfBranch' },
        { id: 'wh1', nodeType: 'WfHandler' },
      ] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'wb1', port: 'execute' } },
        { from: { node: 'wb1', port: 'onSuccess' }, to: { node: 'wh1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(
      workflow,
      [wfType, handlerType],
      false
    );
    expect(result).toContain('__rd__: __rd__ + 1');
    expect(result).toContain('__wb1Params__');
  });

  // ── Pull execution: WORKFLOW variant ──

  it('pull execution with WORKFLOW variant includes recursion depth', () => {
    const nodeType = makeNodeType({
      variant: 'WORKFLOW' as any,
      name: 'PullWf',
      functionName: 'pullWf',
      defaultConfig: { pullExecution: true },
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'string' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'pw1', nodeType: 'PullWf' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'pw1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain('__rd__: __rd__ + 1');
  });

  // ── Pull execution: output ports skipping onSuccess/onFailure ──

  it('pull execution skips onSuccess/onFailure in output extraction', () => {
    const nodeType = makeNodeType({
      name: 'PullSkipPorts',
      functionName: 'pullSkipPorts',
      defaultConfig: { pullExecution: true },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP', failure: true },
        result: { dataType: 'string' },
        scopedOut: { dataType: 'any', scope: 'body' },
      },
    });
    const workflow = makeWorkflow({
      instances: [{ id: 'psp1', nodeType: 'PullSkipPorts' }] as any,
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'psp1', port: 'execute' } },
      ] as any,
    });
    const result = generateControlFlowWithExecutionContext(workflow, [nodeType], false);
    expect(result).toContain("portName: 'result'");
    expect(result).not.toContain("portName: 'scopedOut'");
  });
});
