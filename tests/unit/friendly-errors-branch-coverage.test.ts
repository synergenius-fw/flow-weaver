/**
 * Branch coverage tests for src/friendly-errors.ts
 * Targets uncovered branches: extractQuoted no-match, extractTypes all four regex paths,
 * buildCoerceSuggestion edge cases, extractCyclePath, all error mappers with/without quoted values,
 * formatFriendlyDiagnostics empty/unmapped/mapped paths.
 */

import { getFriendlyError, formatFriendlyDiagnostics } from '../../src/friendly-errors';

// ── extractQuoted branches ──

describe('getFriendlyError', () => {
  it('returns null for unknown error codes', () => {
    const result = getFriendlyError({ code: 'NONEXISTENT_CODE', message: 'whatever' });
    expect(result).toBeNull();
  });

  it('MISSING_REQUIRED_INPUT with no quoted values falls back to node/unknown', () => {
    const result = getFriendlyError({
      code: 'MISSING_REQUIRED_INPUT',
      message: 'No quoted values here',
      node: 'myNode',
    });
    expect(result).not.toBeNull();
    expect(result!.explanation).toContain('myNode');
    expect(result!.explanation).toContain('unknown');
  });

  it('MISSING_REQUIRED_INPUT with quoted values extracts names', () => {
    const result = getFriendlyError({
      code: 'MISSING_REQUIRED_INPUT',
      message: 'Node "fetchData" has unconnected required input port "url"',
    });
    expect(result!.explanation).toContain('fetchData');
    expect(result!.explanation).toContain('url');
  });

  it('MISSING_REQUIRED_INPUT with no node and no quoted falls back to unknown', () => {
    const result = getFriendlyError({
      code: 'MISSING_REQUIRED_INPUT',
      message: 'some error without quotes',
    });
    expect(result!.explanation).toContain('unknown');
  });
});

// ── extractTypes branches ──

describe('extractTypes regex paths', () => {
  it('structural format: "from TypeName (ENUM) to TypeName (ENUM)"', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Type mismatch from MyObject (OBJECT) to OtherThing (STRING)',
    });
    expect(result!.explanation).toContain('MyObject');
    expect(result!.explanation).toContain('OtherThing');
  });

  it('legacy format: "from NUMBER to STRING"', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Type mismatch from NUMBER to STRING',
    });
    expect(result!.explanation).toContain('NUMBER');
    expect(result!.explanation).toContain('STRING');
  });

  it('structural parenthetical format: "(TypeName (ENUM)) ... (TypeName (ENUM))"', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'connection (MyType (OBJECT)) something (OtherType (STRING))',
    });
    expect(result!.explanation).toContain('MyType');
    expect(result!.explanation).toContain('OtherType');
  });

  it('simple parenthetical format: "(ENUM) ... (ENUM)"', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'connection (NUMBER) something (STRING)',
    });
    expect(result!.explanation).toContain('NUMBER');
    expect(result!.explanation).toContain('STRING');
  });

  it('no type match falls back to unknown', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'some weird error with no types',
    });
    expect(result!.explanation).toContain('unknown');
  });
});

// ── buildCoerceSuggestion branches ──

describe('buildCoerceSuggestion', () => {
  it('provides concrete coercion suggestion when port refs are available', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Type mismatch "nodeA.output" to "nodeB.input" from NUMBER to STRING',
    });
    expect(result!.fix).toContain('@connect nodeA.output -> nodeB.input as string');
  });

  it('provides generic suggestion when fewer than 2 port refs', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Type mismatch "something" from NUMBER to STRING',
    });
    expect(result!.fix).toContain('as <type>');
  });

  it('provides generic suggestion when port refs are not in node.port format', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Type mismatch "notAPortRef" "alsoNotARef" from NUMBER to STRING',
    });
    expect(result!.fix).toContain('as <type>');
  });

  it('coerce suggestion uses known target types', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: '"a.b" to "c.d" from STRING to NUMBER',
    });
    expect(result!.fix).toContain('as number');
  });

  it('coerce suggestion handles boolean target', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: '"a.b" to "c.d" from STRING to BOOLEAN',
    });
    expect(result!.fix).toContain('as boolean');
  });

  it('returns null for unknown target type in coerce', () => {
    const result = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: '"a.b" to "c.d" from STRING to FUNCTION',
    });
    expect(result!.fix).toContain('as <type>');
  });
});

// ── extractCyclePath ──

describe('CYCLE_DETECTED', () => {
  it('extracts cycle path from message', () => {
    const result = getFriendlyError({
      code: 'CYCLE_DETECTED',
      message: 'Loop detected: A -> B -> C -> A',
      node: 'A',
    });
    expect(result!.explanation).toContain('A -> B -> C -> A');
  });

  it('handles missing cycle path', () => {
    const result = getFriendlyError({
      code: 'CYCLE_DETECTED',
      message: 'Loop detected with no path info',
      node: 'nodeX',
    });
    expect(result!.explanation).not.toContain('Path:');
    expect(result!.explanation).toContain('nodeX');
  });

  it('uses node field when available', () => {
    const result = getFriendlyError({
      code: 'CYCLE_DETECTED',
      message: 'Loop detected',
    });
    expect(result!.explanation).toContain('unknown');
  });
});

// ── Mappers with node fallback branches ──

describe('mapper fallback branches', () => {
  it('MISSING_WORKFLOW_NAME', () => {
    const result = getFriendlyError({ code: 'MISSING_WORKFLOW_NAME', message: '' });
    expect(result!.title).toBe('Missing Workflow Name');
  });

  it('MISSING_FUNCTION_NAME', () => {
    const result = getFriendlyError({ code: 'MISSING_FUNCTION_NAME', message: '' });
    expect(result!.title).toBe('Missing Function Name');
  });

  it('STEP_PORT_TYPE_MISMATCH with quoted value', () => {
    const result = getFriendlyError({
      code: 'STEP_PORT_TYPE_MISMATCH',
      message: 'STEP port "execute" cannot connect',
    });
    expect(result!.explanation).toContain('execute');
  });

  it('STEP_PORT_TYPE_MISMATCH without quoted value', () => {
    const result = getFriendlyError({
      code: 'STEP_PORT_TYPE_MISMATCH',
      message: 'STEP port cannot connect',
    });
    expect(result!.explanation).toContain('unknown');
  });

  it('UNKNOWN_NODE_TYPE with second quoted value', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_NODE_TYPE',
      message: 'Node "inst1" references unknown node type "myFunc"',
    });
    expect(result!.explanation).toContain('myFunc');
  });

  it('UNKNOWN_NODE_TYPE with first quoted value only', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_NODE_TYPE',
      message: 'Node "myFunc" references unknown',
    });
    expect(result!.explanation).toContain('myFunc');
  });

  it('UNKNOWN_SOURCE_NODE uses node field as fallback', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_SOURCE_NODE',
      message: 'no quotes here',
      node: 'nodeFromField',
    });
    expect(result!.explanation).toContain('nodeFromField');
  });

  it('UNKNOWN_TARGET_NODE uses node field as fallback', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_TARGET_NODE',
      message: 'no quotes here',
      node: 'nodeFromField',
    });
    expect(result!.explanation).toContain('nodeFromField');
  });

  it('UNKNOWN_SOURCE_PORT with "does not have output port" message', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_SOURCE_PORT',
      message: 'Node "myNode" does not have output port "badPort"',
    });
    expect(result!.explanation).toContain('badPort');
    expect(result!.explanation).toContain('myNode');
  });

  it('UNKNOWN_SOURCE_PORT without "does not have output port"', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_SOURCE_PORT',
      message: '"somePort" is invalid',
      node: 'fallbackNode',
    });
    expect(result!.explanation).toContain('somePort');
  });

  it('UNKNOWN_TARGET_PORT with "does not have input port" message', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_TARGET_PORT',
      message: 'Node "myNode" does not have input port "badPort"',
    });
    expect(result!.explanation).toContain('badPort');
    expect(result!.explanation).toContain('myNode');
  });

  it('UNKNOWN_TARGET_PORT without "does not have input port"', () => {
    const result = getFriendlyError({
      code: 'UNKNOWN_TARGET_PORT',
      message: 'unknown port issue',
      node: 'fallbackNode',
    });
    expect(result!.explanation).toContain('unknown');
  });

  it('UNUSED_NODE', () => {
    const r = getFriendlyError({ code: 'UNUSED_NODE', message: 'Node "x" is unused', node: 'y' });
    expect(r!.explanation).toContain('x');
  });

  it('UNUSED_NODE fallback to node field', () => {
    const r = getFriendlyError({ code: 'UNUSED_NODE', message: 'unused', node: 'y' });
    expect(r!.explanation).toContain('y');
  });

  it('NO_START_CONNECTIONS', () => {
    const r = getFriendlyError({ code: 'NO_START_CONNECTIONS', message: '' });
    expect(r!.title).toBe('No Start Connections');
  });

  it('NO_EXIT_CONNECTIONS', () => {
    const r = getFriendlyError({ code: 'NO_EXIT_CONNECTIONS', message: '' });
    expect(r!.title).toBe('No Exit Connections');
  });

  it('DUPLICATE_NODE_NAME', () => {
    const r = getFriendlyError({ code: 'DUPLICATE_NODE_NAME', message: '"foo"', node: 'bar' });
    expect(r!.explanation).toContain('foo');
  });

  it('RESERVED_NODE_NAME', () => {
    const r = getFriendlyError({ code: 'RESERVED_NODE_NAME', message: '"Start"' });
    expect(r!.explanation).toContain('Start');
  });

  it('RESERVED_INSTANCE_ID', () => {
    const r = getFriendlyError({ code: 'RESERVED_INSTANCE_ID', message: '"Exit"' });
    expect(r!.explanation).toContain('Exit');
  });

  it('INFERRED_NODE_TYPE', () => {
    const r = getFriendlyError({ code: 'INFERRED_NODE_TYPE', message: '"myFunc"' });
    expect(r!.explanation).toContain('myFunc');
  });

  it('UNDEFINED_NODE', () => {
    const r = getFriendlyError({ code: 'UNDEFINED_NODE', message: '"myNode"' });
    expect(r!.explanation).toContain('myNode');
  });
});

// ── TYPE_INCOMPATIBLE with coerce suggestion ──

describe('TYPE_INCOMPATIBLE', () => {
  it('with coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'TYPE_INCOMPATIBLE',
      message: '"a.b" to "c.d" from NUMBER to STRING',
    });
    expect(r!.fix).toContain('@connect a.b -> c.d as string');
  });

  it('without coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'TYPE_INCOMPATIBLE',
      message: 'from NUMBER to STRING',
    });
    expect(r!.fix).toContain('as <type>');
  });
});

// ── UNUSUAL_TYPE_COERCION ──

describe('UNUSUAL_TYPE_COERCION', () => {
  it('with coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'UNUSUAL_TYPE_COERCION',
      message: '"a.b" to "c.d" from NUMBER to BOOLEAN',
    });
    expect(r!.fix).toContain('@connect a.b -> c.d as boolean');
  });

  it('without coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'UNUSUAL_TYPE_COERCION',
      message: 'from NUMBER to BOOLEAN',
    });
    expect(r!.fix).toContain('as <type>');
  });
});

// ── LOSSY_TYPE_COERCION ──

describe('LOSSY_TYPE_COERCION', () => {
  it('with coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'LOSSY_TYPE_COERCION',
      message: '"a.b" to "c.d" from STRING to NUMBER',
    });
    expect(r!.fix).toContain('@connect a.b -> c.d as number');
  });

  it('without coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'LOSSY_TYPE_COERCION',
      message: 'from STRING to NUMBER',
    });
    expect(r!.fix).toContain('as <type>');
  });
});

// ── Remaining mappers ──

describe('remaining error mappers', () => {
  it('MULTIPLE_CONNECTIONS_TO_INPUT', () => {
    const r = getFriendlyError({
      code: 'MULTIPLE_CONNECTIONS_TO_INPUT',
      message: '"inputPort" on "myNode" has multiple',
    });
    expect(r!.explanation).toContain('inputPort');
    expect(r!.explanation).toContain('myNode');
  });

  it('SCOPE_CONSISTENCY_ERROR', () => {
    const r = getFriendlyError({
      code: 'SCOPE_CONSISTENCY_ERROR',
      message: '"iterate" scope error',
    });
    expect(r!.explanation).toContain('iterate');
  });

  it('SCOPE_MISSING_REQUIRED_INPUT', () => {
    const r = getFriendlyError({
      code: 'SCOPE_MISSING_REQUIRED_INPUT',
      message: '"child1" has required input "data" in scope "iterate" of "forEach1"',
    });
    expect(r!.explanation).toContain('child1');
    expect(r!.explanation).toContain('data');
    expect(r!.explanation).toContain('iterate');
    expect(r!.explanation).toContain('forEach1');
  });

  it('SCOPE_UNUSED_INPUT', () => {
    const r = getFriendlyError({
      code: 'SCOPE_UNUSED_INPUT',
      message: '"result" on "forEach1" in scope "iterate"',
    });
    expect(r!.explanation).toContain('result');
  });

  it('SCOPE_WRONG_SCOPE_NAME', () => {
    const r = getFriendlyError({
      code: 'SCOPE_WRONG_SCOPE_NAME',
      message: '"forEach1.item:badScope" uses scope "badScope" but node "forEach1" does not',
    });
    expect(r!.title).toBe('Invalid Scope Qualifier');
  });

  it('SCOPE_CONNECTION_OUTSIDE', () => {
    const r = getFriendlyError({
      code: 'SCOPE_CONNECTION_OUTSIDE',
      message: 'connection outside scope',
    });
    expect(r!.title).toBe('Scope Connection Leak');
  });

  it('SCOPE_PORT_TYPE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'SCOPE_PORT_TYPE_MISMATCH',
      message: '"iterate" scope mismatch',
    });
    expect(r!.explanation).toContain('iterate');
  });

  it('SCOPE_UNKNOWN_PORT', () => {
    const r = getFriendlyError({
      code: 'SCOPE_UNKNOWN_PORT',
      message: '"badPort" not found',
    });
    expect(r!.explanation).toContain('badPort');
  });

  it('SCOPE_ORPHANED_CHILD', () => {
    const r = getFriendlyError({
      code: 'SCOPE_ORPHANED_CHILD',
      message: '"child1" in scope "iterate" of "forEach1"',
    });
    expect(r!.explanation).toContain('child1');
  });

  it('OBJECT_TYPE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'OBJECT_TYPE_MISMATCH',
      message: '"TypeA" vs "TypeB"',
    });
    expect(r!.explanation).toContain('TypeA');
    expect(r!.explanation).toContain('TypeB');
  });

  it('MUTABLE_NODE_TYPE_BINDING', () => {
    const r = getFriendlyError({
      code: 'MUTABLE_NODE_TYPE_BINDING',
      message: '"myFunc" is declared with "let"',
    });
    expect(r!.explanation).toContain('myFunc');
    expect(r!.explanation).toContain('let');
  });

  it('MUTABLE_NODE_TYPE_BINDING fallback', () => {
    const r = getFriendlyError({
      code: 'MUTABLE_NODE_TYPE_BINDING',
      message: 'declared with something',
      node: 'nodeField',
    });
    expect(r!.explanation).toContain('nodeField');
  });

  it('UNUSED_OUTPUT_PORT', () => {
    const r = getFriendlyError({
      code: 'UNUSED_OUTPUT_PORT',
      message: '"result" on "myNode"',
    });
    expect(r!.explanation).toContain('result');
    expect(r!.explanation).toContain('myNode');
  });

  it('UNREACHABLE_EXIT_PORT', () => {
    const r = getFriendlyError({
      code: 'UNREACHABLE_EXIT_PORT',
      message: '"output" port',
    });
    expect(r!.explanation).toContain('output');
  });

  it('MULTIPLE_EXIT_CONNECTIONS', () => {
    const r = getFriendlyError({
      code: 'MULTIPLE_EXIT_CONNECTIONS',
      message: '"result" port',
    });
    expect(r!.explanation).toContain('result');
  });

  it('ANNOTATION_SIGNATURE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'ANNOTATION_SIGNATURE_MISMATCH',
      message: '"port1" in "myNode"',
    });
    expect(r!.explanation).toContain('port1');
    expect(r!.explanation).toContain('myNode');
  });

  it('ANNOTATION_SIGNATURE_TYPE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'ANNOTATION_SIGNATURE_TYPE_MISMATCH',
      message: '"port1" in "myNode" has type "STRING" but "number"',
    });
    expect(r!.explanation).toContain('port1');
    expect(r!.explanation).toContain('STRING');
    expect(r!.explanation).toContain('number');
  });
});

// ── Agent-specific rules ──

describe('agent-specific error mappers', () => {
  it('AGENT_LLM_MISSING_ERROR_HANDLER', () => {
    const r = getFriendlyError({ code: 'AGENT_LLM_MISSING_ERROR_HANDLER', message: '', node: 'llm1' });
    expect(r!.explanation).toContain('llm1');
  });

  it('AGENT_UNGUARDED_TOOL_EXECUTOR', () => {
    const r = getFriendlyError({ code: 'AGENT_UNGUARDED_TOOL_EXECUTOR', message: '', node: 'tool1' });
    expect(r!.explanation).toContain('tool1');
  });

  it('AGENT_MISSING_MEMORY_IN_LOOP with quoted', () => {
    const r = getFriendlyError({ code: 'AGENT_MISSING_MEMORY_IN_LOOP', message: '"myLoop"' });
    expect(r!.explanation).toContain('myLoop');
  });

  it('AGENT_MISSING_MEMORY_IN_LOOP without quoted', () => {
    const r = getFriendlyError({ code: 'AGENT_MISSING_MEMORY_IN_LOOP', message: 'no quotes' });
    expect(r!.explanation).toContain('the loop');
  });

  it('AGENT_LLM_NO_FALLBACK', () => {
    const r = getFriendlyError({ code: 'AGENT_LLM_NO_FALLBACK', message: '', node: 'llm2' });
    expect(r!.explanation).toContain('llm2');
  });

  it('AGENT_TOOL_NO_OUTPUT_HANDLING', () => {
    const r = getFriendlyError({ code: 'AGENT_TOOL_NO_OUTPUT_HANDLING', message: '', node: 'tool2' });
    expect(r!.explanation).toContain('tool2');
  });
});

// ── Design rules ──

describe('design rule mappers', () => {
  it('DESIGN_ASYNC_NO_ERROR_PATH', () => {
    const r = getFriendlyError({ code: 'DESIGN_ASYNC_NO_ERROR_PATH', message: '', node: 'async1' });
    expect(r!.title).toBe('Async Node Missing Error Path');
  });

  it('DESIGN_SCOPE_NO_FAILURE_EXIT', () => {
    const r = getFriendlyError({ code: 'DESIGN_SCOPE_NO_FAILURE_EXIT', message: '', node: 'scope1' });
    expect(r!.title).toBe('Scope Missing Failure Exit');
  });

  it('DESIGN_UNBOUNDED_RETRY', () => {
    const r = getFriendlyError({ code: 'DESIGN_UNBOUNDED_RETRY', message: '', node: 'retry1' });
    expect(r!.title).toBe('Unbounded Retry Loop');
  });

  it('DESIGN_FANOUT_NO_FANIN', () => {
    const r = getFriendlyError({ code: 'DESIGN_FANOUT_NO_FANIN', message: '', node: 'fan1' });
    expect(r!.title).toBe('Fan-Out Without Fan-In');
  });

  it('DESIGN_EXIT_DATA_UNREACHABLE', () => {
    const r = getFriendlyError({ code: 'DESIGN_EXIT_DATA_UNREACHABLE', message: '"result" port' });
    expect(r!.explanation).toContain('result');
  });

  it('DESIGN_PULL_CANDIDATE', () => {
    const r = getFriendlyError({ code: 'DESIGN_PULL_CANDIDATE', message: '', node: 'pull1' });
    expect(r!.title).toBe('Pull Execution Candidate');
  });

  it('DESIGN_PULL_UNUSED', () => {
    const r = getFriendlyError({ code: 'DESIGN_PULL_UNUSED', message: '', node: 'pull2' });
    expect(r!.title).toBe('Unused Pull Execution');
  });
});

// ── Coercion rules ──

describe('coercion error mappers', () => {
  it('COERCE_TYPE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'COERCE_TYPE_MISMATCH',
      message: '`as string` but expects NUMBER',
    });
    expect(r!.explanation).toContain('as string');
    expect(r!.explanation).toContain('NUMBER');
    expect(r!.fix).toContain('as number');
  });

  it('COERCE_TYPE_MISMATCH with unknown target', () => {
    const r = getFriendlyError({
      code: 'COERCE_TYPE_MISMATCH',
      message: '`as string` but expects WEIRD',
    });
    expect(r!.fix).toContain('as weird');
  });

  it('REDUNDANT_COERCE', () => {
    const r = getFriendlyError({
      code: 'REDUNDANT_COERCE',
      message: '`as string` both STRING',
    });
    expect(r!.explanation).toContain('as string');
    expect(r!.explanation).toContain('STRING');
  });

  it('REDUNDANT_COERCE without both match', () => {
    const r = getFriendlyError({
      code: 'REDUNDANT_COERCE',
      message: '`as number` is redundant',
    });
    expect(r!.explanation).toContain('the same type');
  });

  it('COERCE_ON_FUNCTION_PORT', () => {
    const r = getFriendlyError({
      code: 'COERCE_ON_FUNCTION_PORT',
      message: '`as string` on FUNCTION port',
    });
    expect(r!.explanation).toContain('as string');
  });

  it('COERCE_ON_FUNCTION_PORT without match', () => {
    const r = getFriendlyError({
      code: 'COERCE_ON_FUNCTION_PORT',
      message: 'coercion on function',
    });
    expect(r!.explanation).toContain('unknown');
  });
});

// ── Annotation validation rules ──

describe('annotation validation mappers', () => {
  it('DUPLICATE_INSTANCE_ID', () => {
    const r = getFriendlyError({ code: 'DUPLICATE_INSTANCE_ID', message: '"inst1" duplicate' });
    expect(r!.explanation).toContain('inst1');
  });

  it('DUPLICATE_CONNECTION', () => {
    const r = getFriendlyError({ code: 'DUPLICATE_CONNECTION', message: 'Duplicate conn' });
    expect(r!.explanation).toContain('Duplicate conn');
  });

  it('INVALID_COLOR with two quoted values', () => {
    const r = getFriendlyError({ code: 'INVALID_COLOR', message: '"node1" has color "magenta"' });
    expect(r!.explanation).toContain('magenta');
  });

  it('INVALID_COLOR with one quoted value', () => {
    const r = getFriendlyError({ code: 'INVALID_COLOR', message: '"magenta" is invalid' });
    expect(r!.explanation).toContain('magenta');
  });

  it('INVALID_ICON with two quoted values', () => {
    const r = getFriendlyError({ code: 'INVALID_ICON', message: '"node1" has icon "badIcon"' });
    expect(r!.explanation).toContain('badIcon');
  });

  it('INVALID_ICON with one quoted value', () => {
    const r = getFriendlyError({ code: 'INVALID_ICON', message: '"badIcon" is invalid' });
    expect(r!.explanation).toContain('badIcon');
  });

  it('INVALID_PORT_TYPE', () => {
    const r = getFriendlyError({ code: 'INVALID_PORT_TYPE', message: '"port1" has type "WEIRD" "WEIRD"' });
    expect(r!.explanation).toContain('WEIRD');
  });

  it('INVALID_PORT_TYPE with two quoted', () => {
    const r = getFriendlyError({ code: 'INVALID_PORT_TYPE', message: '"port1" "WEIRD"' });
    expect(r!.explanation).toContain('WEIRD');
  });

  it('INVALID_PORT_CONFIG_REF', () => {
    const r = getFriendlyError({ code: 'INVALID_PORT_CONFIG_REF', message: '"inst1" references "badPort"' });
    expect(r!.explanation).toContain('inst1');
    expect(r!.explanation).toContain('badPort');
  });

  it('INVALID_EXECUTE_WHEN with two quoted', () => {
    const r = getFriendlyError({ code: 'INVALID_EXECUTE_WHEN', message: '"node1" uses "WEIRD"' });
    expect(r!.explanation).toContain('WEIRD');
  });

  it('INVALID_EXECUTE_WHEN with one quoted', () => {
    const r = getFriendlyError({ code: 'INVALID_EXECUTE_WHEN', message: '"WEIRD" is bad' });
    expect(r!.explanation).toContain('WEIRD');
  });

  it('SCOPE_EMPTY', () => {
    const r = getFriendlyError({ code: 'SCOPE_EMPTY', message: '"iterate" on "forEach1"' });
    expect(r!.explanation).toContain('iterate');
  });

  it('SCOPE_INCONSISTENT', () => {
    const r = getFriendlyError({ code: 'SCOPE_INCONSISTENT', message: '"child1" conflicts' });
    expect(r!.explanation).toContain('child1');
  });

  it('INVALID_EXIT_PORT_TYPE', () => {
    const r = getFriendlyError({ code: 'INVALID_EXIT_PORT_TYPE', message: '"onSuccess" port' });
    expect(r!.explanation).toContain('onSuccess');
  });

  it('INVALID_EXIT_PORT_TYPE fallback', () => {
    const r = getFriendlyError({ code: 'INVALID_EXIT_PORT_TYPE', message: 'bad port type' });
    expect(r!.explanation).toContain('onSuccess');
  });
});

// ── formatFriendlyDiagnostics ──

describe('formatFriendlyDiagnostics', () => {
  it('returns empty string for empty array', () => {
    expect(formatFriendlyDiagnostics([])).toBe('');
  });

  it('formats mapped error with friendly message', () => {
    const result = formatFriendlyDiagnostics([
      { code: 'MISSING_WORKFLOW_NAME', message: 'no name', type: 'error' },
    ]);
    expect(result).toContain('[ERROR] Missing Workflow Name');
    expect(result).toContain('How to fix:');
    expect(result).toContain('Code: MISSING_WORKFLOW_NAME');
  });

  it('formats unmapped error with raw message', () => {
    const result = formatFriendlyDiagnostics([
      { code: 'SOME_UNKNOWN_CODE', message: 'raw message', type: 'error' },
    ]);
    expect(result).toContain('[ERROR] SOME_UNKNOWN_CODE');
    expect(result).toContain('raw message');
  });

  it('formats warnings correctly', () => {
    const result = formatFriendlyDiagnostics([
      { code: 'UNUSED_NODE', message: 'Node "x" is unused', type: 'warning' },
    ]);
    expect(result).toContain('[WARNING] Unused Node');
  });

  it('formats multiple diagnostics', () => {
    const result = formatFriendlyDiagnostics([
      { code: 'MISSING_WORKFLOW_NAME', message: '', type: 'error' },
      { code: 'UNKNOWN_CODE', message: 'fallback', type: 'warning' },
    ]);
    expect(result).toContain('[ERROR]');
    expect(result).toContain('[WARNING]');
  });
});
