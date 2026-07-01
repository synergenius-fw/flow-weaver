/**
 * Regression: an `@expression` foreign nodeType supplied via
 * `externalNodeTypes` (the on-device case: a runtime-provided node like
 * pack-core's `resolveMonth`, resolved from a pack wire manifest) must
 * generate a call WITHOUT the leading `execute` arg. The wire
 * `TExternalNodeType` carries `expression`; `externalToAST` sets the
 * nodeType's `expression` flag (and omits the synthetic `execute` input),
 * so codegen's expression branch emits `fn(dataArg)` not `fn(execute,
 * dataArg)`.
 *
 * Before the fix, `externalToAST` always injected an `execute` input and
 * never set `expression`, so the generated workflow called the expression
 * node with the regular `(execute, ...args)` signature. The boolean
 * `execute` landed in the first data parameter (`spec`), and pack-core's
 * `resolveMonth(spec)` threw `(spec ?? '').trim is not a function` at run
 * time. Symptom on-device: the "Resolve Month" step "Failed" with that
 * TypeError instead of resolving the month.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parser, TExternalNodeType } from '../../src/parser';
import { generateCode } from '../../src/api/generate';

const WORKFLOW = `/**
 * @flowWeaver nodeType
 * @expression
 * @output resolvedMonth
 */
function consume(resolvedMonth: string): { echoed: string } {
  return { echoed: resolvedMonth };
}

/**
 * @flowWeaver workflow
 * @name monthFlow
 * @fwImport resolveMonth resolveMonth from "@synergenius/flow-weaver-pack-core"
 * @param {string} targetMonth - Month spec
 * @node resolve resolveMonth
 * @node consume consume
 * @path Start -> resolve -> consume -> Exit
 * @connect Start.targetMonth -> resolve.spec
 * @connect resolve.resolvedMonth -> consume.resolvedMonth
 * @connect consume.echoed -> Exit.echoed
 * @returns echoed
 */
export function monthFlow(
  execute: boolean,
  params: { targetMonth: string },
): { onSuccess: boolean; onFailure: boolean; echoed: string } {
  // @flow-weaver-body-start
  throw new Error('stub');
  // @flow-weaver-body-end
}
`;

const RESOLVE_MONTH_EXPRESSION: TExternalNodeType = {
  name: 'resolveMonth',
  functionName: 'resolveMonth',
  expression: true,
  ports: [
    { name: 'spec', type: 'String', direction: 'INPUT' },
    { name: 'resolvedMonth', type: 'String', direction: 'OUTPUT' },
  ],
};

describe('expression externalNodeType generates an execute-less call', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-expr-'));
    tempFile = path.join(tempDir, 'month.ts');
    fs.writeFileSync(tempFile, WORKFLOW, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('calls resolveMonth WITHOUT a leading execute arg when expression', () => {
    const parsed = parser.parse(tempFile, [RESOLVE_MONTH_EXPRESSION]);
    const wfAst =
      (parsed as { workflows?: unknown[] }).workflows?.find(
        (w) => (w as { name?: string }).name === 'monthFlow',
      ) ?? parsed;
    const code = generateCode(wfAst as never, { production: false });
    const call = /\bresolveMonth\(([^)]*)\)/.exec(code);
    expect(call, 'no resolveMonth(...) call in generated code').not.toBeNull();
    const firstArg = call![1].split(',')[0]?.trim() ?? '';
    // The first arg must be the node's `_spec` data var, never its
    // `_execute` boolean.
    expect(firstArg.endsWith('_execute')).toBe(false);
    expect(firstArg).toMatch(/_spec$/);
  });

  it('marks the resolved nodeType expression and omits the execute input', () => {
    const parsed = parser.parse(tempFile, [RESOLVE_MONTH_EXPRESSION]);
    const nt = parsed.nodeTypes.find((n) => n.name === 'resolveMonth');
    expect(nt).toBeDefined();
    expect((nt as { expression?: boolean }).expression).toBe(true);
    expect(nt!.inputs.execute).toBeUndefined();
  });

  it('a non-expression external type still gets the execute-first signature', () => {
    const regular: TExternalNodeType = { ...RESOLVE_MONTH_EXPRESSION, expression: false };
    parser.clearCache();
    const parsed = parser.parse(tempFile, [regular]);
    const nt = parsed.nodeTypes.find((n) => n.name === 'resolveMonth');
    expect((nt as { expression?: boolean }).expression).toBeFalsy();
    expect(nt!.inputs.execute).toBeDefined();
  });
});
