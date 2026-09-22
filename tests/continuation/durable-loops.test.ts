/**
 * Loops and scoped nodes inside durable-gated workflows.
 *
 * A durable workflow used to refuse every scoped child, so an agent loop (a
 * ReAct/tool-use loop, a retry scope) could never pause at a gate. These tests
 * cover the capability that unblocks: a bounded sequential scope whose body
 * reaches a durable gate compiles, yields at each iteration's gate, and resumes
 * at the same iteration in a fresh executor invocation — the iteration ordinal
 * reconstructed from committed continuation state, not a live-process counter.
 *
 * They also pin the guardrail: an unbounded durable scope is still refused, and
 * the refusal names the scope and its missing limit rather than banning scopes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';
import { compileWorkflow } from '../../src/api/compile.js';
import { parseWorkflow } from '../../src/api/parse.js';
import { validateDurableClosure } from '../../src/api/durable-validation.js';
import digestContract from './fixtures/stitch-digest-contract.json';

const here = path.dirname(fileURLToPath(import.meta.url));
const boundedLoopFixture = path.join(here, 'fixtures', 'durable-bounded-loop.ts');
const unboundedLoopFixture = path.join(here, 'fixtures', 'durable-scoped-gate.ts');
const boundLessGateFixture = path.join(here, 'fixtures', 'durable-unbounded-loop.ts');
const boundaryFreeScopeFixture = path.join(here, 'fixtures', 'durable-boundary-free-scope.ts');
const bundleDigest = digestContract.bundleDigest;

describe('bounded durable loops — validation', () => {
  it('accepts a bounded sequential loop whose body reaches a durable gate', async () => {
    const parsed = await parseWorkflow(boundedLoopFixture, { workflowName: 'durableBoundedLoop' });
    expect(parsed.errors).toEqual([]);
    // The durable closure validator no longer refuses the scoped gate.
    expect(() =>
      validateDurableClosure(parsed.ast, parsed.allWorkflows, { enforce: true }),
    ).not.toThrow();
  });

  it('compiles a bounded durable loop end to end', async () => {
    await expect(
      compileWorkflow(boundedLoopFixture, {
        write: false,
        inPlace: true,
        generate: { production: true },
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a concurrent durable scope, naming the scope and the parallel hazard', async () => {
    // durable-scoped-gate.ts fans its iterations out with Promise.all, so the
    // gate ordinals would race on resume. That is caught before the bound check.
    const parsed = await parseWorkflow(unboundedLoopFixture, { workflowName: 'durableScopedGate' });
    expect(() =>
      validateDurableClosure(parsed.ast, parsed.allWorkflows, { enforce: true }),
    ).toThrow(/must iterate sequentially.*durableScopedGate\.owner \(scope 'iteration'\)/s);
  });

  it('refuses a sequential loop that reaches a gate but declares no limit', async () => {
    const parsed = await parseWorkflow(boundLessGateFixture, { workflowName: 'durableUnboundedLoop' });
    expect(() =>
      validateDurableClosure(parsed.ast, parsed.allWorkflows, { enforce: true }),
    ).toThrow(/needs a visible attempt limit.*durableUnboundedLoop\.owner \(scope 'iteration'\)/s);
  });

  it('accepts a scoped loop whose body never reaches a durable boundary', async () => {
    // A boundary-free scope was never the unsafe case; it must stay allowed
    // even without an attempt limit, because it never yields.
    const parsed = await parseWorkflow(boundaryFreeScopeFixture, { workflowName: 'boundaryFreeScope' });
    expect(parsed.errors).toEqual([]);
    expect(() =>
      validateDurableClosure(parsed.ast, parsed.allWorkflows, { enforce: true }),
    ).not.toThrow();
  });
});

describe('bounded durable loops — yield and resume', () => {
  it('yields at the first iteration gate with a scope-qualified address', async () => {
    const yielded = await executeWorkflow({
      runId: 'loop-first-yield',
      bundleDigest,
      filePath: boundedLoopFixture,
      workflowName: 'durableBoundedLoop',
      params: { items: ['a', 'b', 'c'], maxItems: 5 },
      production: false,
    });

    expect(yielded.kind).toBe('yielded');
    if (yielded.kind !== 'yielded') throw new Error('expected a durable yield');

    expect(yielded.gate.kind).toBe('approval');
    // The gate address carries the scope, and the first iteration is 0.
    expect(yielded.gate.address.scopes).toHaveLength(1);
    expect(yielded.gate.address.scopes[0]).toMatchObject({
      parentNodeId: 'owner',
      scopeName: 'iteration',
      loopIteration: 0,
    });
    // The first item drove the gate prompt.
    expect(yielded.gate.payload).toMatchObject({ arguments: [{ value: 'a' }] });
  });

  it('resumes each iteration at the correct ordinal across fresh executor invocations', async () => {
    const runId = 'loop-full-resume';
    const items = ['a', 'b', 'c'];
    const filePath = boundedLoopFixture;
    const workflowName = 'durableBoundedLoop';

    let outcome = await executeWorkflow({
      runId,
      bundleDigest,
      filePath,
      workflowName,
      params: { items, maxItems: 5 },
      production: false,
    });

    const seenIterations: number[] = [];
    const seenPrompts: string[] = [];
    let guard = 0;

    // Each pass simulates a fresh process: the continuation is the only carried
    // state, so if the ordinal restarted at 0 the loop would never progress.
    while (outcome.kind === 'yielded') {
      if (guard++ > 10) throw new Error('loop did not terminate — ordinal likely reset on resume');

      const scope = outcome.gate.address.scopes[0];
      expect(scope).toBeDefined();
      seenIterations.push(scope!.loopIteration ?? scope!.invocation);
      const prompt = (outcome.gate.payload as { arguments: Array<{ value: unknown }> }).arguments[0]?.value;
      seenPrompts.push(String(prompt));

      outcome = await executeWorkflow({
        runId,
        bundleDigest,
        filePath,
        workflowName,
        // A changed parameter proves committed state, not re-evaluation, drives resume.
        params: { items: ['x', 'y', 'z'], maxItems: 5 },
        continuation: JSON.stringify(outcome.continuation),
        resolution: {
          gateId: outcome.gate.id,
          value: { onSuccess: true, onFailure: false, approved: true },
        },
        production: false,
      });
    }

    // The loop advanced through every distinct iteration, in order.
    expect(seenIterations).toEqual([0, 1, 2]);
    // Each iteration saw its own item, from the committed continuation.
    expect(seenPrompts).toEqual(['a', 'b', 'c']);

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { onSuccess: true, onFailure: false, results: [true, true, true] },
    });
  });

  it('does not re-yield a committed iteration when the same continuation is replayed', async () => {
    const runId = 'loop-idempotent-replay';
    const items = ['a', 'b'];

    const first = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: boundedLoopFixture,
      workflowName: 'durableBoundedLoop',
      params: { items, maxItems: 5 },
      production: false,
    });
    if (first.kind !== 'yielded') throw new Error('expected first-iteration yield');
    expect(first.gate.address.scopes[0]?.loopIteration).toBe(0);

    const second = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: boundedLoopFixture,
      workflowName: 'durableBoundedLoop',
      params: { items, maxItems: 5 },
      continuation: JSON.stringify(first.continuation),
      resolution: {
        gateId: first.gate.id,
        value: { onSuccess: true, onFailure: false, approved: true },
      },
      production: false,
    });
    if (second.kind !== 'yielded') throw new Error('expected second-iteration yield');

    // The resumed run advanced to iteration 1 rather than re-yielding at 0:
    // the committed iteration-0 gate is not re-run.
    expect(second.gate.address.scopes[0]?.loopIteration).toBe(1);
    expect(
      (second.gate.payload as { arguments: Array<{ value: unknown }> }).arguments[0]?.value,
    ).toBe('b');
  });

  it('honours the attempt limit, capping iterations below the item count', async () => {
    const runId = 'loop-capped';
    const items = ['a', 'b', 'c', 'd', 'e'];

    let outcome = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: boundedLoopFixture,
      workflowName: 'durableBoundedLoop',
      params: { items, maxItems: 2 },
      production: false,
    });

    const iterations: number[] = [];
    let guard = 0;
    while (outcome.kind === 'yielded') {
      if (guard++ > 10) throw new Error('capped loop did not terminate');
      iterations.push(outcome.gate.address.scopes[0]?.loopIteration ?? -1);
      outcome = await executeWorkflow({
        runId,
        bundleDigest,
        filePath: boundedLoopFixture,
        workflowName: 'durableBoundedLoop',
        params: { items, maxItems: 2 },
        continuation: JSON.stringify(outcome.continuation),
        resolution: {
          gateId: outcome.gate.id,
          value: { onSuccess: true, onFailure: false, approved: true },
        },
        production: false,
      });
    }

    // maxItems: 2 stops the loop at two iterations even with five items.
    expect(iterations).toEqual([0, 1]);
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { results: [true, true] },
    });
  });
});
