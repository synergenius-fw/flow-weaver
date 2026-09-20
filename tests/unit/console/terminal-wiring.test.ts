/**
 * Which parameter feeds which input, and which output becomes which return
 * value. The process model stops at the step level; a person clicking
 * `Start` or `Exit` in the console wants the port level.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseWorkflow } from '../../../src/api/parse';
import { terminalWiring } from '../../../src/console/terminals';
import type { TConnectionAST } from '../../../src/ast/types';

const useCases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'use-cases');
const figma = path.join(useCases, 'figma-to-page', 'figma-to-page.ts');

const conn = (from: string, to: string): TConnectionAST => {
  const [fn, fp] = from.split('.'), [tn, tp] = to.split('.');
  return { type: 'Connection', from: { node: fn, port: fp }, to: { node: tn, port: tp } };
};

describe('terminalWiring', () => {
  it('lists every input a parameter reaches, in order', () => {
    const w = terminalWiring({ connections: [conn('Start.id', 'a.id'), conn('Start.id', 'b.key'), conn('a.out', 'b.in')] });
    expect(w.start).toEqual({ id: [{ node: 'a', port: 'id' }, { node: 'b', port: 'key' }] });
  });

  it('names the one output behind each return value', () => {
    const w = terminalWiring({ connections: [conn('finish.status', 'Exit.status'), conn('finish.outcome', 'Exit.outcome')] });
    expect(w.exit).toEqual({ status: { node: 'finish', port: 'status' }, outcome: { node: 'finish', port: 'outcome' } });
  });

  it('ignores the control ports', () => {
    // `Start.execute -> a.execute` and `a.onSuccess -> Exit.onSuccess` are
    // routing, not data, and the cards are about data.
    const w = terminalWiring({ connections: [conn('Start.execute', 'a.execute'), conn('a.onSuccess', 'Exit.onSuccess'), conn('a.onFailure', 'Exit.onFailure')] });
    expect(w.start).toEqual({});
    expect(w.exit).toEqual({});
  });

  it('is empty for a workflow without data ports', () => {
    expect(terminalWiring({ connections: [] })).toEqual({ start: {}, exit: {} });
  });

  it('sees @path name matching as well as @connect', async () => {
    // `request` is never named in a `@connect`; `@path Start -> ask` wires
    // it by name. `Exit.status` is an explicit `@connect finish.status`.
    const parsed = await parseWorkflow(figma, { workflowName: 'figmaToPage', projectDir: path.dirname(figma) });
    expect(parsed.errors).toEqual([]);
    const w = terminalWiring(parsed.ast);
    expect(w.start.request).toEqual([{ node: 'ask', port: 'request' }]);
    expect(w.exit.status).toEqual({ node: 'finish', port: 'status' });
    expect(w.exit.outcome).toEqual({ node: 'finish', port: 'outcome' });
  });
});
