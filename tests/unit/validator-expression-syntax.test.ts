/**
 * An `[expr:]` binding is JavaScript. One that does not parse -- the classic
 * is `timeout="24h"` where the author meant the string `'24h'` -- used to pass
 * parse, validate and compile, and emit `const g_timeout = 24h;` into the
 * generated body. The failure then surfaced as a transpile error on a file
 * the author never wrote, with nothing pointing back at the annotation.
 *
 * The validator now parses every expression and reports EXPRESSION_SYNTAX
 * at the annotation, with the quoting hint for the common case.
 */
import { describe, it, expect } from 'vitest';
import { parser } from '../../src/parser';
import { validateWorkflow } from '../../src/api/validate';

function workflowWith(expr: string, nodeTypeExpr?: string) {
  const src = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input name - Name
 * @input timeout - ${nodeTypeExpr ? `Expression: ${nodeTypeExpr}` : 'Timeout'}
 * @output greeting - Greeting
 */
export function greet(name: string, timeout: string): { greeting: string } {
  return { greeting: name + timeout };
}
/**
 * @flowWeaver workflow
 * @param name - Name
 * @returns greeting - Greeting
 * @node g greet [expr: timeout=${JSON.stringify(expr)}]
 * @path Start -> g -> Exit
 */
export function wf(execute: boolean, params: { name: string }): { onSuccess: boolean; onFailure: boolean; greeting: string } {
  throw new Error('generated body was not installed');
}
`;
  const parsed = parser.parseFromString(src);
  expect(parsed.errors).toEqual([]);
  return validateWorkflow(parsed.workflows[0]);
}

const codes = (r: ReturnType<typeof validateWorkflow>) =>
  r.errors.map((e) => (typeof e === 'string' ? e : e.code));

describe('EXPRESSION_SYNTAX', () => {
  it('rejects an expression that is not JavaScript, and says how to quote it', () => {
    const r = workflowWith('24h');
    expect(codes(r)).toEqual(['EXPRESSION_SYNTAX']);
    const err = r.errors[0] as { message: string; node?: string };
    expect(err.node).toBe('g');
    expect(err.message).toContain('timeout');
    expect(err.message).toContain(`"'24h'"`);
  });

  it('accepts a quoted string literal', () => {
    expect(codes(workflowWith("'24h'"))).toEqual([]);
  });

  it('accepts an expression that reads an upstream port', () => {
    expect(codes(workflowWith("Start.name + '!'"))).toEqual([]);
  });

  it('accepts an arrow function', () => {
    expect(codes(workflowWith('(ctx) => String(Date.now())'))).toEqual([]);
  });

  it('checks an Expression: default declared on the node type too', () => {
    const r = workflowWith("'ok'", '30 minutes');
    expect(codes(r)).toEqual(['EXPRESSION_SYNTAX']);
    expect((r.errors[0] as { message: string }).message).toContain('greet');
  });
});
