import { describe, it, expect } from 'vitest';
import { applyModifyOperation } from '../../../src/api/modify-operation';
import { parser } from '../../../src/parser';

const SOURCE = `
/**
 * @flowWeaver nodeType
 * @input value - Input
 * @output result - Output
 */
function step(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: execute, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @param value - Input
 * @returns result - Output
 * @node a step
 * @connect Start.execute -> a.execute
 * @connect Start.value -> a.value
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function flow(execute: boolean, params: { value: number }): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('stub');
}
`;

describe('applyModifyOperation addConnection is idempotent', () => {
  it('skips a connection that already exists and says so', () => {
    const parsed = parser.parseFromString(SOURCE);
    const ast = parsed.workflows[0];
    const before = ast.connections.length;

    const result = applyModifyOperation(ast, 'addConnection', { from: 'Start.value', to: 'a.value' });

    expect(result.ast.connections).toHaveLength(before);
    expect(result.warnings).toEqual(['Connection Start.value -> a.value already exists; skipped']);
  });

  it('still adds a connection that is new', () => {
    const parsed = parser.parseFromString(SOURCE);
    const ast = parsed.workflows[0];
    const before = ast.connections.length;

    const result = applyModifyOperation(ast, 'addConnection', { from: 'a.result', to: 'Exit.result' });

    expect(result.ast.connections).toHaveLength(before + 1);
    expect(result.warnings).toEqual([]);
  });

  it('does not treat a scoped connection as the same as an unscoped one', () => {
    const parsed = parser.parseFromString(SOURCE);
    const ast = parsed.workflows[0];
    const scoped = {
      ...ast,
      connections: [
        ...ast.connections,
        { type: 'Connection' as const, from: { node: 'a', port: 'result', scope: 'inner' }, to: { node: 'Exit', port: 'result' } },
      ],
    };
    const result = applyModifyOperation(scoped, 'addConnection', { from: 'a.result', to: 'Exit.result' });
    expect(result.warnings).toEqual([]);
    expect(result.ast.connections).toHaveLength(scoped.connections.length + 1);
  });
});
