/**
 * Additional coverage for friendly-errors.ts: design quality rules,
 * coercion rules, and annotation validation rules that were not covered
 * by the existing friendly-errors-coverage.test.ts.
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

describe('design quality rules', () => {
  it('DESIGN_ASYNC_NO_ERROR_PATH', () => {
    const r = getFriendlyError({
      code: 'DESIGN_ASYNC_NO_ERROR_PATH',
      message: 'Async node has no onFailure connection',
      node: 'fetchData',
    });
    expectValid(r, 'DESIGN_ASYNC_NO_ERROR_PATH');
    expect(r!.explanation).toContain('fetchData');
    expect(r!.fix).toContain('fetchData.onFailure');
  });

  it('DESIGN_ASYNC_NO_ERROR_PATH falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'DESIGN_ASYNC_NO_ERROR_PATH',
      message: 'missing error path',
    });
    expectValid(r, 'DESIGN_ASYNC_NO_ERROR_PATH');
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_SCOPE_NO_FAILURE_EXIT', () => {
    const r = getFriendlyError({
      code: 'DESIGN_SCOPE_NO_FAILURE_EXIT',
      message: 'Scope has no failure path',
      node: 'forEach1',
    });
    expectValid(r, 'DESIGN_SCOPE_NO_FAILURE_EXIT');
    expect(r!.explanation).toContain('forEach1');
    expect(r!.fix).toContain('forEach1.onFailure');
  });

  it('DESIGN_UNBOUNDED_RETRY', () => {
    const r = getFriendlyError({
      code: 'DESIGN_UNBOUNDED_RETRY',
      message: 'Retry loop without limit',
      node: 'retryLoop',
    });
    expectValid(r, 'DESIGN_UNBOUNDED_RETRY');
    expect(r!.explanation).toContain('retryLoop');
    expect(r!.fix).toContain('maxAttempts');
  });

  it('DESIGN_FANOUT_NO_FANIN', () => {
    const r = getFriendlyError({
      code: 'DESIGN_FANOUT_NO_FANIN',
      message: 'Fan-out without merge',
      node: 'splitter',
    });
    expectValid(r, 'DESIGN_FANOUT_NO_FANIN');
    expect(r!.explanation).toContain('splitter');
    expect(r!.fix).toContain('merge node');
  });

  it('DESIGN_EXIT_DATA_UNREACHABLE', () => {
    const r = getFriendlyError({
      code: 'DESIGN_EXIT_DATA_UNREACHABLE',
      message: 'Exit port "result" has no incoming data',
    });
    expectValid(r, 'DESIGN_EXIT_DATA_UNREACHABLE');
    expect(r!.explanation).toContain('result');
    expect(r!.fix).toContain('Exit.result');
  });

  it('DESIGN_EXIT_DATA_UNREACHABLE falls back to unknown', () => {
    const r = getFriendlyError({
      code: 'DESIGN_EXIT_DATA_UNREACHABLE',
      message: 'exit data unreachable',
    });
    expectValid(r, 'DESIGN_EXIT_DATA_UNREACHABLE');
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_PULL_CANDIDATE', () => {
    const r = getFriendlyError({
      code: 'DESIGN_PULL_CANDIDATE',
      message: 'Node has no incoming step',
      node: 'configLoader',
    });
    expectValid(r, 'DESIGN_PULL_CANDIDATE');
    expect(r!.explanation).toContain('configLoader');
    expect(r!.fix).toContain('pullExecution');
  });

  it('DESIGN_PULL_UNUSED', () => {
    const r = getFriendlyError({
      code: 'DESIGN_PULL_UNUSED',
      message: 'Node marked pullExecution but unused',
      node: 'deadNode',
    });
    expectValid(r, 'DESIGN_PULL_UNUSED');
    expect(r!.explanation).toContain('deadNode');
    expect(r!.fix).toContain('deadNode');
  });
});

describe('coercion error rules', () => {
  it('COERCE_TYPE_MISMATCH', () => {
    const r = getFriendlyError({
      code: 'COERCE_TYPE_MISMATCH',
      message: 'Coercion `as string` produces wrong type; target expects NUMBER',
    });
    expectValid(r, 'COERCE_TYPE_MISMATCH');
    expect(r!.explanation).toContain('as string');
    expect(r!.explanation).toContain('NUMBER');
    expect(r!.fix).toContain('as number');
  });

  it('COERCE_TYPE_MISMATCH falls back for missing matches', () => {
    const r = getFriendlyError({
      code: 'COERCE_TYPE_MISMATCH',
      message: 'coercion mismatch',
    });
    expectValid(r, 'COERCE_TYPE_MISMATCH');
    expect(r!.explanation).toContain('unknown');
  });

  it('REDUNDANT_COERCE', () => {
    const r = getFriendlyError({
      code: 'REDUNDANT_COERCE',
      message: 'Coercion `as number` is unnecessary because both NUMBER',
    });
    expectValid(r, 'REDUNDANT_COERCE');
    expect(r!.explanation).toContain('as number');
    expect(r!.explanation).toContain('NUMBER');
    expect(r!.fix).toContain('Remove');
  });

  it('REDUNDANT_COERCE falls back for missing matches', () => {
    const r = getFriendlyError({
      code: 'REDUNDANT_COERCE',
      message: 'redundant coercion',
    });
    expectValid(r, 'REDUNDANT_COERCE');
    expect(r!.explanation).toContain('unknown');
  });

  it('COERCE_ON_FUNCTION_PORT', () => {
    const r = getFriendlyError({
      code: 'COERCE_ON_FUNCTION_PORT',
      message: 'Coercion `as string` on FUNCTION port',
    });
    expectValid(r, 'COERCE_ON_FUNCTION_PORT');
    expect(r!.explanation).toContain('as string');
    expect(r!.explanation).toContain('FUNCTION');
    expect(r!.fix).toContain('Remove');
  });

  it('COERCE_ON_FUNCTION_PORT falls back for missing matches', () => {
    const r = getFriendlyError({
      code: 'COERCE_ON_FUNCTION_PORT',
      message: 'coercion on function port',
    });
    expectValid(r, 'COERCE_ON_FUNCTION_PORT');
    expect(r!.explanation).toContain('unknown');
  });
});
