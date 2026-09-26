/**
 * Which required parameters a start is missing. A parameter counts as given
 * only when the caller's object has it as its own key: a name an object
 * inherits, such as `toString` or `constructor`, is not a value the caller
 * sent.
 */
import { describe, it, expect } from 'vitest';
import { missingParams } from '../../../src/coordinator/params.js';
import type { TWorkflowAST } from '../../../src/ast/types.js';

const ast = (ports: Record<string, { optional?: boolean; defaultValue?: unknown; dataType?: string }>) =>
  ({ startPorts: { execute: { dataType: 'STEP' }, ...Object.fromEntries(Object.entries(ports).map(([k, p]) => [k, { dataType: 'STRING', ...p }])) } }) as unknown as TWorkflowAST;

describe('missingParams', () => {
  it('lists the required parameters that were not given', () => {
    expect(missingParams(ast({ a: {}, b: {}, c: { optional: true }, d: { defaultValue: 1 } }), { a: 1 })).toEqual(['b']);
    expect(missingParams(ast({ a: {} }), undefined)).toEqual(['a']);
  });

  it('treats an explicit undefined as not given', () => {
    expect(missingParams(ast({ a: {} }), { a: undefined })).toEqual(['a']);
  });

  it('does not count a name the object inherits as given', () => {
    expect(missingParams(ast({ toString: {}, constructor: {} }), {})).toEqual(['toString', 'constructor']);
    expect(missingParams(ast({ toString: {} }), { toString: 'given' })).toEqual([]);
  });
});
