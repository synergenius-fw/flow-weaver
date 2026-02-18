import { writeFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parser } from '../../src/parser';
import { generateInngestFunction } from '../../src/generator/inngest';

describe('example-inngest-approval', () => {
  it('generates valid Inngest code with no undefined sources', () => {
    const result = parser.parse('./fixtures/advanced/example-inngest-approval.ts');
    expect(result.errors).toHaveLength(0);
    const wf = result.workflows[0];
    const code = generateInngestFunction(wf, [...(wf.nodeTypes || [])], {
      typedEvents: true,
      serveHandler: true,
      framework: 'next',
    });

    // No unresolved ports
    expect(code).not.toContain('undefined');
    expect(code).not.toContain('no source for');

    // All 10 features present
    expect(code).toContain('z.string()');
    expect(code).toContain("event: 'app/expense.submitted'");
    expect(code).toContain('cancelOn:');
    expect(code).toContain("step.sleep('d'");
    expect(code).toContain("step.waitForEvent('wait'");
    expect(code).toContain("step.invoke('pay'");
    expect(code).toContain("import { serve } from 'inngest/next'");
    expect(code).toContain('retries: 5');
    expect(code).toContain("finish: '7d'");
    expect(code).toContain('limit: 20');

    // Write for manual inspection
    writeFileSync('/tmp/fw-inngest-output.ts', code);
  });
});
