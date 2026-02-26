/**
 * Coverage tests for friendly-errors.ts.
 * Covers every error code mapper branch, formatFriendlyDiagnostics,
 * and the internal helper functions via their observable outputs.
 */
import { describe, it, expect } from 'vitest';
import {
  getFriendlyError,
  formatFriendlyDiagnostics,
  type TFriendlyError,
} from '../../src/friendly-errors';

function expectValid(result: TFriendlyError | null, code: string) {
  expect(result).not.toBeNull();
  expect(result!.title).toBeTruthy();
  expect(result!.explanation).toBeTruthy();
  expect(result!.fix).toBeTruthy();
  expect(result!.code).toBe(code);
}

// ── Every error code in the mapper ──────────────────────────────────────

describe('getFriendlyError: every error code', () => {
  it('MISSING_WORKFLOW_NAME', () => {
    const r = getFriendlyError({ code: 'MISSING_WORKFLOW_NAME', message: '' });
    expectValid(r, 'MISSING_WORKFLOW_NAME');
  });

  it('MISSING_FUNCTION_NAME', () => {
    const r = getFriendlyError({ code: 'MISSING_FUNCTION_NAME', message: '' });
    expectValid(r, 'MISSING_FUNCTION_NAME');
  });

  it('MISSING_REQUIRED_INPUT extracts quoted node and port', () => {
    const r = getFriendlyError({
      code: 'MISSING_REQUIRED_INPUT',
      message: 'Node "adder" is missing required input "b"',
      node: 'adder',
    });
    expectValid(r, 'MISSING_REQUIRED_INPUT');
    expect(r!.explanation).toContain('adder');
    expect(r!.explanation).toContain('b');
  });

  it('MISSING_REQUIRED_INPUT falls back to error.node and "unknown"', () => {
    const r = getFriendlyError({
      code: 'MISSING_REQUIRED_INPUT',
      message: 'something happened',
      node: 'fallbackNode',
    });
    expectValid(r, 'MISSING_REQUIRED_INPUT');
    expect(r!.explanation).toContain('fallbackNode');
    expect(r!.explanation).toContain('unknown');
  });

  it('STEP_PORT_TYPE_MISMATCH extracts port name', () => {
    const r = getFriendlyError({
      code: 'STEP_PORT_TYPE_MISMATCH',
      message: 'Port "trigger" received data instead of a STEP signal',
    });
    expectValid(r, 'STEP_PORT_TYPE_MISMATCH');
    expect(r!.explanation).toContain('trigger');
  });

  it('STEP_PORT_TYPE_MISMATCH with no quoted value falls back', () => {
    const r = getFriendlyError({
      code: 'STEP_PORT_TYPE_MISMATCH',
      message: 'port type mismatch',
    });
    expectValid(r, 'STEP_PORT_TYPE_MISMATCH');
    expect(r!.explanation).toContain('unknown');
  });

  it('UNKNOWN_NODE_TYPE picks second quoted value for type name', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_NODE_TYPE',
      message: 'Node "inst1" references unknown type "calculator"',
    });
    expectValid(r, 'UNKNOWN_NODE_TYPE');
    expect(r!.explanation).toContain('calculator');
    expect(r!.fix).toContain('calculator');
  });

  it('UNKNOWN_NODE_TYPE with single quoted value', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_NODE_TYPE',
      message: 'Unknown type "calculator"',
    });
    expectValid(r, 'UNKNOWN_NODE_TYPE');
    expect(r!.explanation).toContain('calculator');
  });

  it('UNKNOWN_SOURCE_NODE', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_SOURCE_NODE',
      message: 'Connection references node "missing"',
    });
    expectValid(r, 'UNKNOWN_SOURCE_NODE');
    expect(r!.explanation).toContain('missing');
  });

  it('UNKNOWN_SOURCE_NODE falls back to error.node', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_SOURCE_NODE',
      message: 'bad ref',
      node: 'nodeX',
    });
    expectValid(r, 'UNKNOWN_SOURCE_NODE');
    expect(r!.explanation).toContain('nodeX');
  });

  it('UNKNOWN_TARGET_NODE', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_TARGET_NODE',
      message: 'Connection references node "gone"',
    });
    expectValid(r, 'UNKNOWN_TARGET_NODE');
    expect(r!.explanation).toContain('gone');
  });

  it('UNKNOWN_SOURCE_PORT with "does not have output port"', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_SOURCE_PORT',
      message: 'Node "proc" does not have output port "data"',
    });
    expectValid(r, 'UNKNOWN_SOURCE_PORT');
    expect(r!.explanation).toContain('data');
    expect(r!.explanation).toContain('proc');
  });

  it('UNKNOWN_SOURCE_PORT without the specific phrase', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_SOURCE_PORT',
      message: 'Port "data" not found',
      node: 'fallback',
    });
    expectValid(r, 'UNKNOWN_SOURCE_PORT');
    expect(r!.explanation).toContain('data');
  });

  it('UNKNOWN_TARGET_PORT with "does not have input port"', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_TARGET_PORT',
      message: 'Node "proc" does not have input port "val"',
    });
    expectValid(r, 'UNKNOWN_TARGET_PORT');
    expect(r!.explanation).toContain('val');
    expect(r!.explanation).toContain('proc');
  });

  it('UNKNOWN_TARGET_PORT without the specific phrase', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_TARGET_PORT',
      message: 'Port "val" not found',
      node: 'nodeY',
    });
    expectValid(r, 'UNKNOWN_TARGET_PORT');
    expect(r!.explanation).toContain('val');
  });

  it('TYPE_MISMATCH with from/to format', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Type mismatch from STRING to NUMBER',
    });
    expectValid(r, 'TYPE_MISMATCH');
    expect(r!.explanation).toContain('STRING');
    expect(r!.explanation).toContain('NUMBER');
  });

  it('TYPE_MISMATCH with structural type format extracts structural types', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Type mismatch from MyType (STRING) to OtherType (NUMBER) between "a.out" and "b.inp"',
    });
    expectValid(r, 'TYPE_MISMATCH');
    // Structural type regex matches first, extracting "MyType" and "OtherType"
    expect(r!.explanation).toContain('MyType');
    expect(r!.explanation).toContain('OtherType');
    expect(r!.fix).toContain('as <type>');
  });

  it('TYPE_MISMATCH with port refs and simple types gets concrete coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Type mismatch from STRING to NUMBER between "a.out" and "b.inp"',
    });
    expectValid(r, 'TYPE_MISMATCH');
    expect(r!.fix).toContain('@connect');
    expect(r!.fix).toContain('a.out');
    expect(r!.fix).toContain('b.inp');
    expect(r!.fix).toContain('as number');
  });

  it('TYPE_MISMATCH with parenthetical format', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Incompatible types (STRING) connected to (NUMBER)',
    });
    expectValid(r, 'TYPE_MISMATCH');
    expect(r!.explanation).toContain('STRING');
    expect(r!.explanation).toContain('NUMBER');
  });

  it('TYPE_MISMATCH with structural parenthetical format', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Incompatible types (Foo (STRING)) connected to (Bar (NUMBER))',
    });
    expectValid(r, 'TYPE_MISMATCH');
    expect(r!.explanation).toContain('Foo');
    expect(r!.explanation).toContain('Bar');
  });

  it('TYPE_MISMATCH with no type info falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'some generic mismatch',
    });
    expectValid(r, 'TYPE_MISMATCH');
    expect(r!.explanation).toContain('unknown');
  });

  it('CYCLE_DETECTED with path', () => {
    const r = getFriendlyError({
      code: 'CYCLE_DETECTED',
      message: 'Circular dependency detected: a -> b -> a',
      node: 'a',
    });
    expectValid(r, 'CYCLE_DETECTED');
    expect(r!.explanation).toContain('a -> b -> a');
    expect(r!.explanation).toContain("Node 'a'");
  });

  it('CYCLE_DETECTED with no path', () => {
    const r = getFriendlyError({
      code: 'CYCLE_DETECTED',
      message: 'Circular dependency detected',
      node: 'x',
    });
    expectValid(r, 'CYCLE_DETECTED');
    expect(r!.explanation).not.toContain('Path:');
  });

  it('UNUSED_NODE', () => {
    const r = getFriendlyError({
      code: 'UNUSED_NODE',
      message: 'Node "helper" is defined but never referenced',
    });
    expectValid(r, 'UNUSED_NODE');
    expect(r!.explanation).toContain('helper');
  });

  it('NO_START_CONNECTIONS', () => {
    const r = getFriendlyError({
      code: 'NO_START_CONNECTIONS',
      message: 'No connections from Start node',
    });
    expectValid(r, 'NO_START_CONNECTIONS');
  });

  it('NO_EXIT_CONNECTIONS', () => {
    const r = getFriendlyError({
      code: 'NO_EXIT_CONNECTIONS',
      message: 'No connections to Exit node',
    });
    expectValid(r, 'NO_EXIT_CONNECTIONS');
  });

  it('DUPLICATE_NODE_NAME', () => {
    const r = getFriendlyError({
      code: 'DUPLICATE_NODE_NAME',
      message: 'Duplicate node type name "transform"',
    });
    expectValid(r, 'DUPLICATE_NODE_NAME');
    expect(r!.explanation).toContain('transform');
  });

  it('RESERVED_NODE_NAME', () => {
    const r = getFriendlyError({
      code: 'RESERVED_NODE_NAME',
      message: 'Node name "Start" is reserved',
    });
    expectValid(r, 'RESERVED_NODE_NAME');
    expect(r!.fix).toContain('Start');
  });

  it('RESERVED_INSTANCE_ID', () => {
    const r = getFriendlyError({
      code: 'RESERVED_INSTANCE_ID',
      message: 'Instance ID "Exit" is reserved',
    });
    expectValid(r, 'RESERVED_INSTANCE_ID');
    expect(r!.explanation).toContain('Exit');
  });

  it('INFERRED_NODE_TYPE', () => {
    const r = getFriendlyError({
      code: 'INFERRED_NODE_TYPE',
      message: 'Node type "processData" was inferred',
    });
    expectValid(r, 'INFERRED_NODE_TYPE');
    expect(r!.explanation).toContain('processData');
  });

  it('UNDEFINED_NODE', () => {
    const r = getFriendlyError({
      code: 'UNDEFINED_NODE',
      message: 'Reference to "ghost" but no definition',
    });
    expectValid(r, 'UNDEFINED_NODE');
    expect(r!.explanation).toContain('ghost');
  });

  it('TYPE_INCOMPATIBLE with coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'TYPE_INCOMPATIBLE',
      message: 'Incompatible from STRING to BOOLEAN between "src.out" and "tgt.inp"',
    });
    expectValid(r, 'TYPE_INCOMPATIBLE');
    expect(r!.fix).toContain('@connect');
    expect(r!.fix).toContain('boolean');
  });

  it('TYPE_INCOMPATIBLE without enough port refs omits coerce', () => {
    const r = getFriendlyError({
      code: 'TYPE_INCOMPATIBLE',
      message: 'Incompatible from STRING to BOOLEAN',
    });
    expectValid(r, 'TYPE_INCOMPATIBLE');
    expect(r!.fix).toContain('as <type>');
  });

  it('UNUSUAL_TYPE_COERCION with coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'UNUSUAL_TYPE_COERCION',
      message: 'Unusual coercion from NUMBER to STRING between "a.val" and "b.text"',
    });
    expectValid(r, 'UNUSUAL_TYPE_COERCION');
    expect(r!.fix).toContain('@connect');
    expect(r!.fix).toContain('string');
  });

  it('UNUSUAL_TYPE_COERCION without port refs', () => {
    const r = getFriendlyError({
      code: 'UNUSUAL_TYPE_COERCION',
      message: 'Unusual coercion from NUMBER to STRING',
    });
    expectValid(r, 'UNUSUAL_TYPE_COERCION');
    expect(r!.fix).toContain('as <type>');
  });

  it('MULTIPLE_CONNECTIONS_TO_INPUT', () => {
    const r = getFriendlyError({
      code: 'MULTIPLE_CONNECTIONS_TO_INPUT',
      message: 'Input port "value" on node "calc" has 3 connections',
    });
    expectValid(r, 'MULTIPLE_CONNECTIONS_TO_INPUT');
    expect(r!.explanation).toContain('value');
    expect(r!.explanation).toContain('calc');
  });

  it('SCOPE_CONSISTENCY_ERROR', () => {
    const r = getFriendlyError({
      code: 'SCOPE_CONSISTENCY_ERROR',
      message: 'Scope "iteration" has mismatched connections',
    });
    expectValid(r, 'SCOPE_CONSISTENCY_ERROR');
    expect(r!.explanation).toContain('iteration');
  });

  it('SCOPE_MISSING_REQUIRED_INPUT', () => {
    const r = getFriendlyError({
      code: 'SCOPE_MISSING_REQUIRED_INPUT',
      message: 'Child "child1" inside scope "loop" of "parent1" has required input "data" with no connection',
    });
    expectValid(r, 'SCOPE_MISSING_REQUIRED_INPUT');
    expect(r!.explanation).toContain('child1');
    expect(r!.explanation).toContain('data');
    expect(r!.explanation).toContain('loop');
    expect(r!.explanation).toContain('parent1');
  });

  it('SCOPE_UNUSED_INPUT', () => {
    const r = getFriendlyError({
      code: 'SCOPE_UNUSED_INPUT',
      message: 'Scoped input "result" on "forEach1" expects data within scope "iteration"',
    });
    expectValid(r, 'SCOPE_UNUSED_INPUT');
    expect(r!.explanation).toContain('result');
    expect(r!.explanation).toContain('forEach1');
    expect(r!.explanation).toContain('iteration');
  });

  it('SCOPE_WRONG_SCOPE_NAME', () => {
    const r = getFriendlyError({
      code: 'SCOPE_WRONG_SCOPE_NAME',
      message: 'Connection "x.out:badScope" references "badScope" on node "forEach1"',
    });
    expectValid(r, 'SCOPE_WRONG_SCOPE_NAME');
    expect(r!.explanation).toContain('x.out:badScope');
    expect(r!.explanation).toContain('forEach1');
  });

  it('SCOPE_CONNECTION_OUTSIDE', () => {
    const r = getFriendlyError({
      code: 'SCOPE_CONNECTION_OUTSIDE',
      message: 'Scoped connection targets a node outside scope',
    });
    expectValid(r, 'SCOPE_CONNECTION_OUTSIDE');
  });

  it('SCOPE_PORT_TYPE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'SCOPE_PORT_TYPE_MISMATCH',
      message: 'Type mismatch within scope "iteration"',
    });
    expectValid(r, 'SCOPE_PORT_TYPE_MISMATCH');
    expect(r!.explanation).toContain('iteration');
  });

  it('SCOPE_UNKNOWN_PORT', () => {
    const r = getFriendlyError({
      code: 'SCOPE_UNKNOWN_PORT',
      message: 'Port "badPort" referenced in scoped connection',
    });
    expectValid(r, 'SCOPE_UNKNOWN_PORT');
    expect(r!.explanation).toContain('badPort');
  });

  it('SCOPE_ORPHANED_CHILD', () => {
    const r = getFriendlyError({
      code: 'SCOPE_ORPHANED_CHILD',
      message: 'Node "orphan" inside scope "loop" of "forEach1" has no scoped connections',
    });
    expectValid(r, 'SCOPE_ORPHANED_CHILD');
    expect(r!.explanation).toContain('orphan');
    expect(r!.explanation).toContain('loop');
    expect(r!.explanation).toContain('forEach1');
  });

  it('OBJECT_TYPE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'OBJECT_TYPE_MISMATCH',
      message: 'Object shape mismatch: source "UserInput" target "ExpectedShape"',
    });
    expectValid(r, 'OBJECT_TYPE_MISMATCH');
    expect(r!.explanation).toContain('UserInput');
    expect(r!.explanation).toContain('ExpectedShape');
  });

  it('MUTABLE_NODE_TYPE_BINDING', () => {
    const r = getFriendlyError({
      code: 'MUTABLE_NODE_TYPE_BINDING',
      message: 'Node type "proc" is declared with "let"',
      node: 'proc',
    });
    expectValid(r, 'MUTABLE_NODE_TYPE_BINDING');
    expect(r!.explanation).toContain('proc');
    expect(r!.explanation).toContain('let');
    expect(r!.fix).toMatch(/const|function/);
  });

  it('UNUSED_OUTPUT_PORT', () => {
    const r = getFriendlyError({
      code: 'UNUSED_OUTPUT_PORT',
      message: 'Output port "debug" of node "transformer" is never connected',
    });
    expectValid(r, 'UNUSED_OUTPUT_PORT');
    expect(r!.explanation).toContain('debug');
    expect(r!.explanation).toContain('transformer');
  });

  it('UNREACHABLE_EXIT_PORT', () => {
    const r = getFriendlyError({
      code: 'UNREACHABLE_EXIT_PORT',
      message: 'Exit port "errorMessage" has no incoming connection',
    });
    expectValid(r, 'UNREACHABLE_EXIT_PORT');
    expect(r!.explanation).toContain('errorMessage');
  });

  it('MULTIPLE_EXIT_CONNECTIONS', () => {
    const r = getFriendlyError({
      code: 'MULTIPLE_EXIT_CONNECTIONS',
      message: 'Exit port "result" has 3 incoming connections',
    });
    expectValid(r, 'MULTIPLE_EXIT_CONNECTIONS');
    expect(r!.explanation).toContain('result');
  });

  it('ANNOTATION_SIGNATURE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'ANNOTATION_SIGNATURE_MISMATCH',
      message: 'Port "timeout" in node type "fetchData" is optional in signature but required in annotation',
      node: 'fetchData',
    });
    expectValid(r, 'ANNOTATION_SIGNATURE_MISMATCH');
    expect(r!.explanation).toContain('timeout');
    expect(r!.explanation).toContain('fetchData');
    expect(r!.fix).toContain('@input [');
  });

  it('ANNOTATION_SIGNATURE_TYPE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'ANNOTATION_SIGNATURE_TYPE_MISMATCH',
      message: 'Port "count" in node "pager" has type "STRING" in annotation but "NUMBER" in signature',
    });
    expectValid(r, 'ANNOTATION_SIGNATURE_TYPE_MISMATCH');
    expect(r!.explanation).toContain('count');
  });

  // Agent-specific rules

  it('AGENT_LLM_MISSING_ERROR_HANDLER', () => {
    const r = getFriendlyError({
      code: 'AGENT_LLM_MISSING_ERROR_HANDLER',
      message: 'LLM node missing error handler',
      node: 'llm1',
    });
    expectValid(r, 'AGENT_LLM_MISSING_ERROR_HANDLER');
    expect(r!.explanation).toContain('llm1');
  });

  it('AGENT_UNGUARDED_TOOL_EXECUTOR', () => {
    const r = getFriendlyError({
      code: 'AGENT_UNGUARDED_TOOL_EXECUTOR',
      message: 'Tool executor without approval gate',
      node: 'tools1',
    });
    expectValid(r, 'AGENT_UNGUARDED_TOOL_EXECUTOR');
    expect(r!.explanation).toContain('tools1');
  });

  it('AGENT_MISSING_MEMORY_IN_LOOP', () => {
    const r = getFriendlyError({
      code: 'AGENT_MISSING_MEMORY_IN_LOOP',
      message: 'Loop "agentLoop" has LLM but no conversation memory',
    });
    expectValid(r, 'AGENT_MISSING_MEMORY_IN_LOOP');
    expect(r!.explanation).toContain('agentLoop');
  });

  it('AGENT_LLM_NO_FALLBACK', () => {
    const r = getFriendlyError({
      code: 'AGENT_LLM_NO_FALLBACK',
      message: 'LLM failure goes directly to exit',
      node: 'llm2',
    });
    expectValid(r, 'AGENT_LLM_NO_FALLBACK');
    expect(r!.explanation).toContain('llm2');
  });

  it('AGENT_TOOL_NO_OUTPUT_HANDLING', () => {
    const r = getFriendlyError({
      code: 'AGENT_TOOL_NO_OUTPUT_HANDLING',
      message: 'Tool results discarded',
      node: 'toolExec',
    });
    expectValid(r, 'AGENT_TOOL_NO_OUTPUT_HANDLING');
    expect(r!.explanation).toContain('toolExec');
  });

  it('LOSSY_TYPE_COERCION with coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'LOSSY_TYPE_COERCION',
      message: 'Lossy coercion from STRING to NUMBER between "parser.text" and "calc.value"',
    });
    expectValid(r, 'LOSSY_TYPE_COERCION');
    expect(r!.explanation).toContain('STRING');
    expect(r!.fix).toContain('as number');
    expect(r!.fix).toContain('parser.text');
  });

  it('LOSSY_TYPE_COERCION without port refs', () => {
    const r = getFriendlyError({
      code: 'LOSSY_TYPE_COERCION',
      message: 'Lossy coercion from STRING to NUMBER',
    });
    expectValid(r, 'LOSSY_TYPE_COERCION');
    expect(r!.fix).toContain('as <type>');
    expect(r!.fix).not.toContain('parser.text');
  });

  it('INVALID_EXIT_PORT_TYPE', () => {
    const r = getFriendlyError({
      code: 'INVALID_EXIT_PORT_TYPE',
      message: "Exit port 'onSuccess' must be STEP type",
    });
    expectValid(r, 'INVALID_EXIT_PORT_TYPE');
    expect(r!.explanation).toContain('onSuccess');
  });

  // Annotation validation rules

  it('DUPLICATE_INSTANCE_ID', () => {
    const r = getFriendlyError({
      code: 'DUPLICATE_INSTANCE_ID',
      message: 'Duplicate instance ID "proc1"',
    });
    expectValid(r, 'DUPLICATE_INSTANCE_ID');
    expect(r!.explanation).toContain('proc1');
  });

  it('DUPLICATE_CONNECTION', () => {
    const r = getFriendlyError({
      code: 'DUPLICATE_CONNECTION',
      message: 'Duplicate connection a.out -> b.inp',
    });
    expectValid(r, 'DUPLICATE_CONNECTION');
    expect(r!.explanation).toContain('Duplicate connection a.out -> b.inp');
  });

  it('INVALID_COLOR', () => {
    const r = getFriendlyError({
      code: 'INVALID_COLOR',
      message: 'Node "proc" has invalid color "rainbow"',
    });
    expectValid(r, 'INVALID_COLOR');
    expect(r!.explanation).toContain('rainbow');
  });

  it('INVALID_ICON', () => {
    const r = getFriendlyError({
      code: 'INVALID_ICON',
      message: 'Node "proc" has invalid icon "unicorn"',
    });
    expectValid(r, 'INVALID_ICON');
    expect(r!.explanation).toContain('unicorn');
  });

  it('INVALID_PORT_TYPE', () => {
    const r = getFriendlyError({
      code: 'INVALID_PORT_TYPE',
      message: 'Port "data" has unrecognized type "MAGIC"',
    });
    expectValid(r, 'INVALID_PORT_TYPE');
    expect(r!.explanation).toContain('data');
    expect(r!.explanation).toContain('MAGIC');
  });

  it('INVALID_PORT_CONFIG_REF', () => {
    const r = getFriendlyError({
      code: 'INVALID_PORT_CONFIG_REF',
      message: 'Instance "proc1" references port "nonexistent" in portOrder',
    });
    expectValid(r, 'INVALID_PORT_CONFIG_REF');
    expect(r!.explanation).toContain('proc1');
    expect(r!.explanation).toContain('nonexistent');
  });

  it('INVALID_EXECUTE_WHEN', () => {
    const r = getFriendlyError({
      code: 'INVALID_EXECUTE_WHEN',
      message: '@executeWhen value "ALWAYS" is not valid',
    });
    expectValid(r, 'INVALID_EXECUTE_WHEN');
    expect(r!.explanation).toContain('ALWAYS');
  });

  it('SCOPE_EMPTY', () => {
    const r = getFriendlyError({
      code: 'SCOPE_EMPTY',
      message: 'Scope "iteration" on node "forEach1" has no children',
    });
    expectValid(r, 'SCOPE_EMPTY');
    expect(r!.explanation).toContain('iteration');
    expect(r!.explanation).toContain('forEach1');
  });

  it('SCOPE_INCONSISTENT', () => {
    const r = getFriendlyError({
      code: 'SCOPE_INCONSISTENT',
      message: 'Instance "proc1" assigned to multiple scopes',
    });
    expectValid(r, 'SCOPE_INCONSISTENT');
    expect(r!.explanation).toContain('proc1');
  });

  it('returns null for unmapped code', () => {
    expect(getFriendlyError({ code: 'TOTALLY_FAKE_CODE', message: '' })).toBeNull();
  });
});

// ── buildCoerceSuggestion edge cases ────────────────────────────────────

describe('coerce suggestion edge cases', () => {
  it('coerce target type maps correctly for known types', () => {
    // STRING target
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Mismatch from NUMBER to STRING between "a.out" and "b.inp"',
    });
    expect(r!.fix).toContain('as string');
  });

  it('coerce with BOOLEAN target type', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Mismatch from STRING to BOOLEAN between "x.out" and "y.inp"',
    });
    expect(r!.fix).toContain('as boolean');
  });

  it('coerce with OBJECT target type', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Mismatch from STRING to OBJECT between "x.out" and "y.inp"',
    });
    expect(r!.fix).toContain('as object');
  });

  it('no coerce suggestion when target type is unsupported (e.g. ARRAY)', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Mismatch from STRING to ARRAY between "x.out" and "y.inp"',
    });
    // ARRAY is not in COERCE_TARGET_TYPES, so no concrete suggestion
    expect(r!.fix).toContain('as <type>');
  });

  it('no coerce suggestion when quoted values are not port refs', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'Mismatch from STRING to NUMBER between "just a word" and "another"',
    });
    // "just a word" is not a port ref pattern
    expect(r!.fix).toContain('as <type>');
  });
});

// ── extractTypes format coverage ────────────────────────────────────────

describe('extractTypes coverage via TYPE_MISMATCH', () => {
  it('case-insensitive from/to matching', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: 'From string To number',
    });
    expectValid(r, 'TYPE_MISMATCH');
    expect(r!.explanation).toContain('string');
    expect(r!.explanation).toContain('number');
  });
});

// ── formatFriendlyDiagnostics ───────────────────────────────────────────

describe('formatFriendlyDiagnostics', () => {
  it('returns empty string for empty array', () => {
    expect(formatFriendlyDiagnostics([])).toBe('');
  });

  it('formats a single error with friendly mapping', () => {
    const output = formatFriendlyDiagnostics([
      { code: 'NO_START_CONNECTIONS', message: 'No start connections', type: 'error' },
    ]);
    expect(output).toContain('[ERROR]');
    expect(output).toContain('No Start Connections');
    expect(output).toContain('How to fix:');
    expect(output).toContain('Code: NO_START_CONNECTIONS');
  });

  it('formats a warning with friendly mapping', () => {
    const output = formatFriendlyDiagnostics([
      { code: 'UNUSED_NODE', message: 'Node "helper" unused', type: 'warning' },
    ]);
    expect(output).toContain('[WARNING]');
    expect(output).toContain('Unused Node');
  });

  it('falls back to original message for unmapped code', () => {
    const output = formatFriendlyDiagnostics([
      { code: 'CUSTOM_PLUGIN_ERROR', message: 'Something custom happened', type: 'error' },
    ]);
    expect(output).toContain('[ERROR] CUSTOM_PLUGIN_ERROR');
    expect(output).toContain('Something custom happened');
  });

  it('formats multiple mixed errors and warnings', () => {
    const output = formatFriendlyDiagnostics([
      { code: 'NO_START_CONNECTIONS', message: '', type: 'error' },
      { code: 'UNUSED_NODE', message: 'Node "a" unused', type: 'warning' },
      { code: 'UNKNOWN_CODE_XYZ', message: 'something', type: 'error' },
    ]);
    const lines = output.split('\n');
    // Should have content from all three errors
    expect(output).toContain('[ERROR] No Start Connections');
    expect(output).toContain('[WARNING] Unused Node');
    expect(output).toContain('[ERROR] UNKNOWN_CODE_XYZ');
    // Each error block ends with an empty line
    expect(lines.filter((l) => l === '').length).toBeGreaterThanOrEqual(3);
  });
});
