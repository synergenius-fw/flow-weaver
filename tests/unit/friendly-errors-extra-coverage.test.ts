/**
 * Additional edge-case coverage for friendly-errors.ts.
 * Targets remaining uncovered branches in design rules, annotation rules,
 * and the LOSSY_TYPE_COERCION coerce-suggestion builder.
 */
import { describe, it, expect } from 'vitest';
import { getFriendlyError, type TFriendlyError } from '../../src/friendly-errors';

function expectValid(result: TFriendlyError | null, code: string) {
  expect(result).not.toBeNull();
  expect(result!.title).toBeTruthy();
  expect(result!.explanation).toBeTruthy();
  expect(result!.fix).toBeTruthy();
  expect(result!.code).toBe(code);
}

describe('design rules: fallback node names', () => {
  it('DESIGN_SCOPE_NO_FAILURE_EXIT falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'DESIGN_SCOPE_NO_FAILURE_EXIT',
      message: 'scope has no failure exit',
    });
    expectValid(r, 'DESIGN_SCOPE_NO_FAILURE_EXIT');
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_UNBOUNDED_RETRY falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'DESIGN_UNBOUNDED_RETRY',
      message: 'unbounded retry detected',
    });
    expectValid(r, 'DESIGN_UNBOUNDED_RETRY');
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_FANOUT_NO_FANIN falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'DESIGN_FANOUT_NO_FANIN',
      message: 'fan out detected',
    });
    expectValid(r, 'DESIGN_FANOUT_NO_FANIN');
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_PULL_CANDIDATE falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'DESIGN_PULL_CANDIDATE',
      message: 'pull candidate detected',
    });
    expectValid(r, 'DESIGN_PULL_CANDIDATE');
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_PULL_UNUSED falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'DESIGN_PULL_UNUSED',
      message: 'pull unused detected',
    });
    expectValid(r, 'DESIGN_PULL_UNUSED');
    expect(r!.explanation).toContain('unknown');
  });

  it('AGENT_LLM_NO_FALLBACK falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'AGENT_LLM_NO_FALLBACK',
      message: 'llm no fallback',
    });
    expectValid(r, 'AGENT_LLM_NO_FALLBACK');
    expect(r!.explanation).toContain('unknown');
  });

  it('AGENT_TOOL_NO_OUTPUT_HANDLING falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'AGENT_TOOL_NO_OUTPUT_HANDLING',
      message: 'tool output not connected',
    });
    expectValid(r, 'AGENT_TOOL_NO_OUTPUT_HANDLING');
    expect(r!.explanation).toContain('unknown');
  });
});

describe('annotation validation rules: edge cases', () => {
  it('INVALID_EXIT_PORT_TYPE falls back to onSuccess when no quote', () => {
    const r = getFriendlyError({
      code: 'INVALID_EXIT_PORT_TYPE',
      message: 'invalid exit port type',
    });
    expectValid(r, 'INVALID_EXIT_PORT_TYPE');
    expect(r!.explanation).toContain('onSuccess');
  });

  it('DUPLICATE_INSTANCE_ID uses error.node fallback', () => {
    const r = getFriendlyError({
      code: 'DUPLICATE_INSTANCE_ID',
      message: 'duplicate id',
      node: 'myDupe',
    });
    expectValid(r, 'DUPLICATE_INSTANCE_ID');
    expect(r!.explanation).toContain('myDupe');
  });

  it('DUPLICATE_INSTANCE_ID falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'DUPLICATE_INSTANCE_ID',
      message: 'duplicate id',
    });
    expectValid(r, 'DUPLICATE_INSTANCE_ID');
    expect(r!.explanation).toContain('unknown');
  });

  it('INVALID_COLOR with quoted color', () => {
    const r = getFriendlyError({
      code: 'INVALID_COLOR',
      message: 'Instance "n1" has invalid color "chartreuse"',
    });
    expectValid(r, 'INVALID_COLOR');
    expect(r!.explanation).toContain('chartreuse');
  });

  it('INVALID_ICON with quoted icon', () => {
    const r = getFriendlyError({
      code: 'INVALID_ICON',
      message: 'Instance "n1" has invalid icon "rocket"',
    });
    expectValid(r, 'INVALID_ICON');
    expect(r!.explanation).toContain('rocket');
  });

  it('INVALID_PORT_TYPE with two quoted values', () => {
    const r = getFriendlyError({
      code: 'INVALID_PORT_TYPE',
      message: 'Port "data" on node type "MyNode" has invalid type "WIDGET"',
    });
    expectValid(r, 'INVALID_PORT_TYPE');
    expect(r!.explanation).toContain('data');
    expect(r!.explanation).toContain('WIDGET');
  });

  it('INVALID_PORT_CONFIG_REF with node fallback', () => {
    const r = getFriendlyError({
      code: 'INVALID_PORT_CONFIG_REF',
      message: 'port config references unknown port',
      node: 'someNode',
    });
    expectValid(r, 'INVALID_PORT_CONFIG_REF');
    expect(r!.explanation).toContain('someNode');
  });

  it('INVALID_EXECUTE_WHEN falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'INVALID_EXECUTE_WHEN',
      message: 'invalid executeWhen value',
    });
    expectValid(r, 'INVALID_EXECUTE_WHEN');
    expect(r!.explanation).toContain('unknown');
  });

  it('SCOPE_EMPTY with node fallback', () => {
    const r = getFriendlyError({
      code: 'SCOPE_EMPTY',
      message: 'scope is empty',
      node: 'loopNode',
    });
    expectValid(r, 'SCOPE_EMPTY');
    expect(r!.explanation).toContain('loopNode');
  });

  it('SCOPE_INCONSISTENT with node fallback', () => {
    const r = getFriendlyError({
      code: 'SCOPE_INCONSISTENT',
      message: 'scope conflict',
      node: 'childNode',
    });
    expectValid(r, 'SCOPE_INCONSISTENT');
    expect(r!.explanation).toContain('childNode');
  });
});

describe('LOSSY_TYPE_COERCION with structural type format', () => {
  it('extracts structural types with parenthetical ENUM format', () => {
    const r = getFriendlyError({
      code: 'LOSSY_TYPE_COERCION',
      message: 'Connection from "a.out" to "b.in" converts from User[] (ARRAY) to string (STRING)',
    });
    expectValid(r, 'LOSSY_TYPE_COERCION');
    expect(r!.explanation).toContain('User[]');
    expect(r!.explanation).toContain('string');
  });
});
