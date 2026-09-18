/**
 * A durable EFFECT placed after branch convergence inside a gated workflow.
 *
 * The durable-gates topic used to say only a GATE after branch convergence is
 * refused. The closure validator refuses any durable boundary there, effects
 * included, because the continuation must retain an independently active
 * branch path and a converged node no longer has one. This test pins that
 * behaviour and its message so the documentation can state the rule exactly.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';
import { parseWorkflow } from '../../src/api/parse.js';
import { validateDurableClosure } from '../../src/api/durable-validation.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-effect-after-branch.ts');
const bundleDigest = `sha256:${'b'.repeat(64)}`;

describe('durable effect after branch convergence', () => {
  it('is refused by the closure validator with a message naming the node', async () => {
    const parsed = await parseWorkflow(fixture, { workflowName: 'effectAfterBranch' });
    expect(parsed.errors).toEqual([]);
    expect(() => validateDurableClosure(parsed.ast, [])).toThrow(
      /Durable boundaries after branch convergence are not supported[\s\S]*Invalid: effectAfterBranch\.record/,
    );
  });

  it('is refused before the first node runs, on either arm', async () => {
    for (const needsHuman of [false, true]) {
      let recovered = 0;
      await expect(
        executeWorkflow({
          runId: `effect-after-branch-${needsHuman}`,
          bundleDigest,
          filePath: fixture,
          workflowName: 'effectAfterBranch',
          params: { needsHuman },
          production: false,
          effectAdapter: {
            recover: async () => {
              recovered += 1;
              return { kind: 'not-committed' as const };
            },
          },
        }),
      ).rejects.toThrow(/after branch convergence/);
      expect(recovered).toBe(0);
    }
  });
});
