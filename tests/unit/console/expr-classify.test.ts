/**
 * How an `[expr:]` binding is classified for display.
 *
 * The three forms look alike as plain text -- `10`, `'24h'`, `ask.eventName`
 * -- and were all rendered in the same muted grey. Telling them apart is the
 * same distinction behind EXPRESSION_SYNTAX: an unquoted `24h` is a syntax
 * error precisely because a bare token is read as an identifier, not text.
 */
import { describe, it, expect } from 'vitest';
import { classifyExpr } from '../../../console-ui/src/expr';

describe('classifyExpr', () => {
  it('reads a quoted value as a string', () => {
    expect(classifyExpr("'24h'")).toEqual({ kind: 'string', text: "'24h'" });
    expect(classifyExpr('"review"')).toEqual({ kind: 'string', text: '"review"' });
  });

  it('reads a bare number as a number', () => {
    expect(classifyExpr('10')).toEqual({ kind: 'number', text: '10' });
    expect(classifyExpr('-2.5')).toEqual({ kind: 'number', text: '-2.5' });
  });

  it('reads the keywords', () => {
    expect(classifyExpr('true').kind).toBe('boolean');
    expect(classifyExpr('false').kind).toBe('boolean');
    expect(classifyExpr('null').kind).toBe('nullish');
  });

  it('splits a port reference into the step and the rest', () => {
    expect(classifyExpr('ask.eventName')).toEqual({ kind: 'reference', node: 'ask', port: 'eventName' });
    // A deeper read still belongs to the step it starts from.
    expect(classifyExpr('frame.task.agentId')).toEqual({ kind: 'reference', node: 'frame', port: 'task.agentId' });
  });

  it('leaves real JavaScript alone', () => {
    expect(classifyExpr('(ctx) => String(Date.now())').kind).toBe('js');
    expect(classifyExpr("Start.name + '!'").kind).toBe('js');
    expect(classifyExpr('items.length > 0').kind).toBe('js');
  });

  it('does not mistake a lone identifier for a port reference', () => {
    // No dot: there is no step to name, so it is not a reference.
    expect(classifyExpr('goal').kind).toBe('js');
  });

  it('ignores surrounding whitespace', () => {
    expect(classifyExpr('  10  ')).toEqual({ kind: 'number', text: '10' });
  });
});
