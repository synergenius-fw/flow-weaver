/**
 * What an `[expr:]` binding is.
 *
 * The forms look alike as plain text -- `10`, `'24h'`, `ask.eventName` --
 * but mean different things, and telling them apart is the same distinction
 * behind EXPRESSION_SYNTAX: an unquoted `24h` fails precisely because a bare
 * token is read as an identifier rather than as text.
 */
export type ExprKind =
  | { kind: 'string' | 'number' | 'boolean' | 'nullish' | 'js'; text: string }
  | { kind: 'reference'; node: string; port: string };

const STRING = /^(['"])(.*)\1$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const REFERENCE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/;

export function classifyExpr(value: string): ExprKind {
  const text = value.trim();
  if (STRING.test(text)) return { kind: 'string', text };
  if (NUMBER.test(text)) return { kind: 'number', text };
  if (text === 'true' || text === 'false') return { kind: 'boolean', text };
  if (text === 'null' || text === 'undefined') return { kind: 'nullish', text };
  if (REFERENCE.test(text)) {
    const dot = text.indexOf('.');
    return { kind: 'reference', node: text.slice(0, dot), port: text.slice(dot + 1) };
  }
  // An arrow function, a template, a computation: left as code.
  return { kind: 'js', text };
}
