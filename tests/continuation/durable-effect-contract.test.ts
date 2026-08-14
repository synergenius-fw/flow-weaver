import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileWorkflow } from '../../src/api/compile';
import { parseWorkflow } from '../../src/api/parse';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('authored durable effect contracts', () => {
  it('rejects an Accounting-like effect that returns plain outputs without the injected operation key', async () => {
    const filePath = fixture('durable-effect-contract-invalid.ts');
    const parsed = await parseWorkflow(filePath, {
      workflowName: 'invalidAccountingEffect',
    });
    const effect = parsed.ast.nodeTypes.find(
      (nodeType) => nodeType.functionName === 'assembleAccountingBatch',
    );

    expect(effect?.durableEffectContract).toEqual({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.stringContaining('injected final operationKey'),
        expect.stringContaining('exactly required receipt and result fields'),
        expect.stringMatching(/result fields.*missing onFailure, onSuccess/),
      ]),
    });
    await expect(
      compileWorkflow(filePath, {
        inPlace: false,
        write: false,
        parse: { workflowName: 'invalidAccountingEffect' },
      }),
    ).rejects.toThrow(/Durable effect contract errors:[\s\S]*operationKey[\s\S]*receipt and result/);
  });

  it('accepts an exact receipt/result envelope whose result matches every node output', async () => {
    const filePath = fixture('durable-effect-contract-valid.ts');
    const parsed = await parseWorkflow(filePath, {
      workflowName: 'validAccountingEffect',
    });
    const effect = parsed.ast.nodeTypes.find(
      (nodeType) => nodeType.functionName === 'assembleAccountingBatch',
    );

    expect(effect?.durableEffectContract).toEqual({ valid: true, diagnostics: [] });
    expect(effect?.inputs).not.toHaveProperty('operationKey');
    const compiled = await compileWorkflow(filePath, {
      inPlace: false,
      write: false,
      parse: { workflowName: 'validAccountingEffect' },
    });
    expect(compiled.code).toContain('assembleAccountingBatch(assemble_month, __operationKey__)');
    expect(compiled.code).toContain('__operationKey__');
  });
});
