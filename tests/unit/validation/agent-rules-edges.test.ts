/**
 * Agent node roles and the agent rules at their edges: which port, icon,
 * colour or name decides a role, and where an approval gate, a failure
 * route or a declared @resilience changes what a rule says. Also the rule
 * registry that packs add their rule sets to.
 */
import { describe, it, expect } from 'vitest';
import { detectNodeRole, detectNodeRoleSignal, findNodesByRole } from '../../../src/validation/agent-detection';
import { unguardedToolExecutorRule, llmWithoutFallbackRule, missingErrorHandlerRule, toolNoOutputHandlingRule } from '../../../src/validation/agent-rules';
import { ValidationRuleRegistry } from '../../../src/validation/rule-registry';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TConnectionAST, TPortDefinition } from '../../../src/ast/types';

const STEP: TPortDefinition = { dataType: 'STEP', isControlFlow: true };
const ANY: TPortDefinition = { dataType: 'ANY' };

function nodeType(name: string, inputs: string[] = [], outputs: string[] = [], overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType', name, functionName: name,
    inputs: { execute: STEP, ...Object.fromEntries(inputs.map((p) => [p, ANY])) },
    outputs: { onSuccess: STEP, onFailure: { ...STEP, failure: true }, ...Object.fromEntries(outputs.map((p) => [p, ANY])) },
    hasSuccessPort: true, hasFailurePort: true, executeWhen: 'CONJUNCTION', isAsync: false,
    ...overrides,
  };
}

const LLM = nodeType('callModel', ['messages'], ['content']);
const TOOL = nodeType('runTool', ['toolCall'], ['result']);
const APPROVE = nodeType('askHuman', [], ['approved', 'rejected']);

const conn = (s: string): TConnectionAST => {
  const [from, to] = s.split(' -> ');
  const [fn, fp] = from.split('.');
  const [tn, tp] = to.split('.');
  return { type: 'Connection', from: { node: fn, port: fp }, to: { node: tn, port: tp } };
};
const inst = (id: string, type: string): TNodeInstanceAST => ({ type: 'NodeInstance', id, nodeType: type });
const wf = (nodeTypes: TNodeTypeAST[], instances: TNodeInstanceAST[], connections: string[]): TWorkflowAST => ({
  type: 'Workflow', name: 'wf', functionName: 'wf', sourceFile: 'wf.ts',
  nodeTypes, instances, connections: connections.map(conn), scopes: {}, startPorts: {}, exitPorts: {}, imports: [],
});

describe('agent roles', () => {
  it('come from ports first: every port pattern of every role', () => {
    expect(detectNodeRoleSignal(nodeType('x', ['messages'], ['toolCalls']))).toEqual({ role: 'llm', signal: 'port' });
    expect(detectNodeRoleSignal(nodeType('x', ['messages'], ['content']))).toEqual({ role: 'llm', signal: 'port' });
    expect(detectNodeRoleSignal(nodeType('x', ['toolCalls'], ['resultMessage']))).toEqual({ role: 'tool-executor', signal: 'port' });
    expect(detectNodeRoleSignal(nodeType('x', [], ['approved', 'rejected']))).toEqual({ role: 'human-approval', signal: 'port' });
    expect(detectNodeRoleSignal(nodeType('x', ['conversationId'], ['messages']))).toEqual({ role: 'memory', signal: 'port' });
  });

  it('need both halves of a port pattern', () => {
    expect(detectNodeRole(nodeType('x', ['messages'], []))).toBeNull();
    expect(detectNodeRole(nodeType('x', [], ['content']))).toBeNull();
    expect(detectNodeRole(nodeType('x', [], ['approved']))).toBeNull();
    expect(detectNodeRole(nodeType('x', ['conversationId'], []))).toBeNull();
    expect(detectNodeRole(nodeType('x', [], ['messages']))).toBeNull();
    expect(detectNodeRole(nodeType('x', ['toolCall'], []))).toBeNull();
  });

  it('then from the icon, then the colour, then the start of the name', () => {
    expect(detectNodeRoleSignal(nodeType('x', [], [], { visuals: { icon: 'database', color: 'purple' } }))).toEqual({ role: 'memory', signal: 'icon' });
    expect(detectNodeRoleSignal(nodeType('x', [], [], { visuals: { icon: 'flag', color: 'orange' } }))).toEqual({ role: 'human-approval', signal: 'color' });
    expect(detectNodeRoleSignal(nodeType('reviewDraft'))).toEqual({ role: 'human-approval', signal: 'name' });
    expect(detectNodeRoleSignal(nodeType('toolbox'))).toEqual({ role: 'tool-executor', signal: 'name' });
    expect(detectNodeRole(nodeType('sendChat'))).toBeNull();
    expect(detectNodeRole(nodeType('myMemory'))).toBeNull();
  });

  it('find the node types of one role', () => {
    expect(findNodesByRole([LLM, TOOL, APPROVE, nodeType('plain')], 'tool-executor')).toEqual([TOOL]);
  });
});

describe('tool executors and approval gates', () => {
  const warned = (w: TWorkflowAST) => unguardedToolExecutorRule.validate(w).map((e) => `${e.type} ${e.code} ${e.node}: ${e.message}`);

  it('warn about a tool with no approval upstream even when another tool has one', () => {
    const w = wf([TOOL, APPROVE], [inst('gate', 'askHuman'), inst('guarded', 'runTool'), inst('bare', 'runTool')], [
      'gate.approved -> guarded.toolCall',
      'Start.x -> bare.toolCall',
    ]);
    expect(warned(w)).toEqual([
      "warning AGENT_UNGUARDED_TOOL_EXECUTOR bare: Tool executor 'bare' has no human approval gate upstream. If this node performs destructive actions, consider adding a human-approval node before it.",
    ]);
  });

  it('count an approval any number of steps upstream, and a tool that reaches itself is not its own gate', () => {
    const w = wf([TOOL, APPROVE, nodeType('plain')], [inst('gate', 'askHuman'), inst('mid', 'plain'), inst('t', 'runTool'), inst('loop', 'runTool')], [
      'gate.approved -> mid.execute',
      'mid.onSuccess -> t.execute',
      't.result -> loop.toolCall',
      'loop.result -> t.toolCall',
    ]);
    expect(warned(w)).toEqual([]);
    const selfOnly = wf([TOOL, APPROVE], [inst('gate', 'askHuman'), inst('t', 'runTool')], ['t.result -> t.toolCall']);
    expect(warned(selfOnly).map((m) => m.split(':')[0])).toEqual(['warning AGENT_UNGUARDED_TOOL_EXECUTOR t']);
  });

  it('warn about a tool whose results go nowhere, naming them', () => {
    const w = wf([nodeType('runTool', ['toolCall'], ['result', 'log'])], [inst('t', 'runTool')], ['t.onSuccess -> Exit.onSuccess']);
    expect(toolNoOutputHandlingRule.validate(w).map((e) => e.message)).toEqual([
      "Tool executor 't' has no data output ports connected. Tool results (result, log) are being discarded.",
    ]);
    const onlyStep = wf([nodeType('runTool', ['toolCall'], [], { outputs: { onSuccess: STEP, onFailure: STEP } })], [inst('t', 'runTool')], []);
    expect(toolNoOutputHandlingRule.validate(onlyStep)).toEqual([]);
  });
});

describe('LLM failure handling', () => {
  it('asks for an error handler only when the node has a failure port', () => {
    const noFailure = nodeType('callModel', ['messages'], ['content'], { hasFailurePort: false, outputs: { onSuccess: STEP, content: ANY } });
    expect(missingErrorHandlerRule.validate(wf([noFailure], [inst('m', 'callModel')], []))).toEqual([]);
    const outputOnly = nodeType('callModel', ['messages'], ['content'], { hasFailurePort: false });
    expect(missingErrorHandlerRule.validate(wf([outputOnly], [inst('m', 'callModel')], [])).map((e) => `${e.type} ${e.code}`)).toEqual(['error AGENT_LLM_MISSING_ERROR_HANDLER']);
  });

  it('warns when every failure route goes straight to Exit', () => {
    const w = wf([LLM], [inst('m', 'callModel')], ['m.onFailure -> Exit.onFailure']);
    expect(llmWithoutFallbackRule.validate(w).map((e) => `${e.type} ${e.code} ${e.node}: ${e.message}`)).toEqual([
      "warning AGENT_LLM_NO_FALLBACK m: LLM node 'm' routes failures directly to Exit. Add a retry/fallback node, or declare adapter-owned handling with @resilience retries=N and/or fallback=\"provider\".",
    ]);
  });

  it('is satisfied by one failure route that goes elsewhere, or by declared retries or a fallback', () => {
    const plain = nodeType('recover');
    expect(llmWithoutFallbackRule.validate(wf([LLM, plain], [inst('m', 'callModel'), inst('r', 'recover')], ['m.onFailure -> Exit.onFailure', 'm.onFailure -> r.execute']))).toEqual([]);
    const retries = { ...LLM, resilience: { retries: 2 } } as TNodeTypeAST;
    expect(llmWithoutFallbackRule.validate(wf([retries], [inst('m', 'callModel')], ['m.onFailure -> Exit.onFailure']))).toEqual([]);
    const fallback = { ...LLM, resilience: { fallback: 'backup' } } as TNodeTypeAST;
    expect(llmWithoutFallbackRule.validate(wf([fallback], [inst('m', 'callModel')], ['m.onFailure -> Exit.onFailure']))).toEqual([]);
    const blank = { ...LLM, resilience: { retries: 0, fallback: '   ' } } as TNodeTypeAST;
    expect(llmWithoutFallbackRule.validate(wf([blank], [inst('m', 'callModel')], ['m.onFailure -> Exit.onFailure']))).toHaveLength(1);
  });
});

describe('the rule registry', () => {
  it('gives the rules of every registered set whose detector accepts the workflow, in order', () => {
    const registry = new ValidationRuleRegistry();
    expect(registry.size).toBe(0);
    const w = wf([], [], []);
    registry.register({ name: 'a', namespace: 'x', detect: () => true, getRules: () => [missingErrorHandlerRule] });
    registry.register({ name: 'b', namespace: 'y', detect: () => false, getRules: () => { throw new Error('not loaded unless detected'); } });
    registry.register({ name: 'c', namespace: 'z', detect: (ast) => ast.name === 'wf', getRules: () => [llmWithoutFallbackRule, toolNoOutputHandlingRule] });
    expect(registry.size).toBe(3);
    expect(registry.getApplicableRules(w)).toEqual([missingErrorHandlerRule, llmWithoutFallbackRule, toolNoOutputHandlingRule]);
  });
});
