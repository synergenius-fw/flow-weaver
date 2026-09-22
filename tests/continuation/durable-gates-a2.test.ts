import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ContinuationRefusalError, executeWorkflow } from '../../src/mcp/workflow-executor.js';
import {
  continuationChecksum,
  type ContinuationEnvelope,
  decodeContinuation,
  durableGateId,
  operationKey,
} from '../../src/runtime/continuation.js';
import digestContract from './fixtures/stitch-digest-contract.json';
import { compileWorkflow } from '../../src/api/compile.js';
import { parseWorkflow } from '../../src/api/parse.js';
import { generateCode } from '../../src/api/generate.js';
import { generateInPlace } from '../../src/api/generate-in-place.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-approval.ts');
const bundleDigest = digestContract.bundleDigest;
const parallelFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-parallel.ts');
const scopedGateFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-scoped-gate.ts');
const twoGatesFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-two-gates.ts');
const effectGateFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-effect-gate.ts');
const lazyFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-lazy.ts');
const branchConvergenceFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'durable-branch-convergence.ts',
);
const outputAfterGateFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'durable-output-after-gate.ts',
);

function graphForEnvelope(envelope: ContinuationEnvelope) {
  const addresses = [envelope.location, ...envelope.state.completed];
  return {
    nodes: addresses.map((address, index) => ({
      workflowId: address.frames.at(-1)!.workflowId,
      nodeId: address.nodeId,
      nodeType: address.nodeType,
      executionOrder: address === envelope.location ? addresses.length : index,
      inputPorts: [],
      outputPorts: envelope.state.variables
        .filter((variable) => JSON.stringify(variable.address) === JSON.stringify(address))
        .map((variable) => variable.portName),
      scopeNames: address.scopes.map((scope) => scope.scopeName),
      invokedWorkflows: [],
      branchArms: address.branches.map((branch) => branch.arm),
      branchPath: address.branches
        .filter((branch) => branch.frameDepth === address.frames.length - 1)
        .map(({ nodeId, arm }) => ({ nodeId, arm })),
      predecessors: [],
      ...(address === envelope.location && { durableGate: envelope.gateKind }),
      ...(envelope.receipts.some((receipt) => JSON.stringify(receipt.address) === JSON.stringify(address)) && {
        durableEffect: true as const,
      }),
    })),
  };
}
const unclassifiedFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'durable-unclassified.ts',
);
const localConflictFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'durable-conflict.ts');
const externalConflictFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'durable-external-conflict.ts',
);
const nestedIdentityFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'durable-nested-identity.ts',
);
const nestedBranchesFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'durable-nested-branches.ts',
);
const nestedFailureBranchesFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'durable-nested-failure-branches.ts',
);
const externalPorts = [
  { name: 'execute', type: 'STEP', direction: 'INPUT' },
  { name: 'value', type: 'NUMBER', direction: 'INPUT' },
  { name: 'onSuccess', type: 'STEP', direction: 'OUTPUT' },
  { name: 'onFailure', type: 'STEP', direction: 'OUTPUT' },
  { name: 'value', type: 'NUMBER', direction: 'OUTPUT' },
] as const;
const notCommittedEffectAdapter = {
  recover: async () => ({ kind: 'not-committed' as const }),
};

describe('A2 durable gate continuation', () => {
  it('retains transitive frame-qualified branch paths through nested workflows', async () => {
    const runId = 'nested-branch-path-run';
    const yielded = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: nestedBranchesFixture,
      workflowName: 'nestedBranchGate',
      params: { value: 11 },
      production: false,
    });
    if (yielded.kind !== 'yielded') throw new Error('expected a durable yield');

    expect(yielded.gate.address.branches).toEqual([
      {
        workflowId: 'nestedBranchGate',
        frameDepth: 0,
        nodeId: 'decision',
        executionIndex: 0,
        arm: 'success',
      },
      {
        workflowId: 'innerDecision',
        frameDepth: 1,
        nodeId: 'decision',
        executionIndex: 0,
        arm: 'success',
      },
    ]);
    const aliasedLocation = {
      ...yielded.continuation.location,
      branches: [yielded.continuation.location.branches[0]],
    };
    const aliased = {
      ...yielded.continuation,
      gateId: durableGateId(runId, 'approval', aliasedLocation),
      location: aliasedLocation,
      state: {
        ...yielded.continuation.state,
        nextBoundary: aliasedLocation,
      },
      checksum: '',
    };
    aliased.checksum = continuationChecksum(aliased);
    await expect(
      executeWorkflow({
        runId,
        bundleDigest,
        filePath: nestedBranchesFixture,
        workflowName: 'nestedBranchGate',
        params: { value: 11 },
        continuation: aliased,
        resolution: {
          gateId: aliased.gateId,
          value: { onSuccess: true, onFailure: false, value: 11 },
        },
        production: false,
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'wrong-graph' },
    });

    await expect(
      executeWorkflow({
        runId,
        bundleDigest,
        filePath: nestedBranchesFixture,
        workflowName: 'nestedBranchGate',
        params: { value: 999 },
        continuation: yielded.continuation,
        resolution: {
          gateId: yielded.gate.id,
          value: { onSuccess: true, onFailure: false, value: 11 },
        },
        production: false,
      }),
    ).resolves.toMatchObject({
      kind: 'completed',
      result: { value: 11 },
    });
  });

  it('retains transitive failure paths through nested workflows', async () => {
    const runId = 'nested-failure-branch-path-run';
    const yielded = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: nestedFailureBranchesFixture,
      workflowName: 'nestedFailureBranchGate',
      params: { value: -11 },
      production: false,
    });
    if (yielded.kind !== 'yielded') throw new Error('expected a durable yield');

    expect(yielded.gate.address.branches).toEqual([
      {
        workflowId: 'nestedFailureBranchGate',
        frameDepth: 0,
        nodeId: 'decision',
        executionIndex: 0,
        arm: 'failure',
      },
      {
        workflowId: 'innerFailureDecision',
        frameDepth: 1,
        nodeId: 'decision',
        executionIndex: 0,
        arm: 'failure',
      },
    ]);

    await expect(
      executeWorkflow({
        runId,
        bundleDigest,
        filePath: nestedFailureBranchesFixture,
        workflowName: 'nestedFailureBranchGate',
        params: { value: 999 },
        continuation: yielded.continuation,
        resolution: {
          gateId: yielded.gate.id,
          value: { onSuccess: true, onFailure: false, value: -11 },
        },
        production: false,
      }),
    ).resolves.toMatchObject({
      kind: 'completed',
      result: { value: -11 },
    });
  });

  it('refuses forged execution ordinals before effect re-attestation or node code', async () => {
    const runId = 'forged-ordinal-run';
    delete (globalThis as Record<string, unknown>).__a2_effect_gate_called__;
    const yielded = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: effectGateFixture,
      workflowName: 'durableEffectGate',
      params: { params: {} },
      effectAdapter: notCommittedEffectAdapter,
      production: false,
    });
    if (yielded.kind !== 'yielded') throw new Error('expected a durable yield');
    expect((globalThis as Record<string, unknown>).__a2_effect_gate_called__).toBe(true);

    const mutations: Array<(location: Record<string, unknown>) => void> = [
      (location) => {
        location.executionIndex = 7;
      },
      (location) => {
        const branches = location.branches as Array<Record<string, unknown>>;
        branches[0].executionIndex = 7;
      },
    ];
    for (const mutate of mutations) {
      const forged = JSON.parse(JSON.stringify(yielded.continuation)) as ContinuationEnvelope;
      mutate(forged.location as unknown as Record<string, unknown>);
      (forged.state as { nextBoundary: ContinuationEnvelope['location'] }).nextBoundary = forged.location;
      (forged as { gateId: string }).gateId = durableGateId(runId, forged.gateKind, forged.location);
      (forged as { checksum: string }).checksum = '';
      (forged as { checksum: string }).checksum = continuationChecksum(forged);
      const recover = vi.fn(async () => ({
        kind: 'committed' as const,
        receipt: { id: 'effect' },
        result: { onSuccess: true, onFailure: false, value: 4 },
      }));
      delete (globalThis as Record<string, unknown>).__a2_effect_gate_called__;

      await expect(
        executeWorkflow({
          runId,
          bundleDigest,
          filePath: effectGateFixture,
          workflowName: 'durableEffectGate',
          params: { params: {} },
          continuation: forged,
          resolution: {
            gateId: forged.gateId,
            value: { onSuccess: true, onFailure: false, value: 4 },
          },
          effectAdapter: { recover },
          production: false,
        }),
      ).rejects.toMatchObject({
        name: 'ContinuationRefusalError',
        refusal: { accepted: false, reason: 'wrong-graph' },
      });
      expect(recover).not.toHaveBeenCalled();
      expect((globalThis as Record<string, unknown>).__a2_effect_gate_called__).toBeUndefined();
    }
  });

  it('yields terminally and resumes from committed predecessors in a fresh executor invocation', async () => {
    const runId = 'a2-approval-run';
    const yielded = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: fixture,
      workflowName: 'durableApproval',
      params: { value: 4 },
      includeTrace: true,
      production: false,
    });

    expect(yielded.kind).toBe('yielded');
    if (yielded.kind !== 'yielded') throw new Error('expected a durable yield');

    expect(yielded.gate.kind).toBe('approval');
    expect(yielded.gate.payload).toEqual({
      arguments: [{ value: 8 }],
    });
    expect(yielded.gate.address).toMatchObject({
      frames: [{ workflowId: 'durableApproval', invocation: 0 }],
      scopes: [],
      branches: [
        {
          workflowId: 'durableApproval',
          frameDepth: 0,
          nodeId: 'prepared',
          executionIndex: 0,
          arm: 'success',
        },
      ],
      nodeId: 'approval',
      nodeType: 'waitForApproval',
      executionIndex: 0,
    });
    expect(yielded.gate.id).toBe(durableGateId(runId, 'approval', yielded.gate.address));
    expect(yielded.continuation.checksum).toBe(continuationChecksum(yielded.continuation));
    expect(yielded.continuation.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestContract.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestContract.graphFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      yielded.trace?.some(
        (event) => event.type === 'STATUS_CHANGED' && event.data?.id === 'approval' && event.data?.status === 'FAILED',
      ),
    ).toBe(false);

    const resumed = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: fixture,
      workflowName: 'durableApproval',
      // A changed parameter proves Start/predecessor values came from the
      // committed continuation rather than being re-evaluated.
      params: { value: 999 },
      continuation: JSON.stringify(yielded.continuation),
      resolution: {
        gateId: yielded.gate.id,
        value: { onSuccess: true, onFailure: false, value: 8 },
      },
      includeTrace: true,
      production: false,
    });

    expect(resumed).toMatchObject({
      kind: 'completed',
      result: { onSuccess: true, onFailure: false, result: 9 },
    });
    expect(
      resumed.trace?.some(
        (event) =>
          event.type === 'STATUS_CHANGED' &&
          ['Start', 'prepared'].includes(String(event.data?.id)) &&
          event.data?.status === 'SUCCEEDED',
      ),
    ).toBe(false);
  });

  it('projects the unique selected-branch output after a resumed gate', async () => {
    const runId = 'a2-output-after-gate';
    const yielded = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: outputAfterGateFixture,
      workflowName: 'durableOutputAfterGate',
      params: { value: 17 },
      production: false,
    });
    if (yielded.kind !== 'yielded') throw new Error('expected a durable yield');

    expect(yielded.gate.address.branches.map(({ nodeId, arm }) => ({ nodeId, arm }))).toEqual([
      { nodeId: 'resolve', arm: 'success' },
      { nodeId: 'assemble', arm: 'success' },
      { nodeId: 'build', arm: 'success' },
    ]);

    await expect(
      executeWorkflow({
        runId,
        bundleDigest,
        filePath: outputAfterGateFixture,
        workflowName: 'durableOutputAfterGate',
        params: { value: 999 },
        continuation: yielded.continuation,
        resolution: {
          gateId: yielded.gate.id,
          value: { onSuccess: false, onFailure: true, approved: false },
        },
        production: false,
      }),
    ).resolves.toMatchObject({
      kind: 'completed',
      result: {
        report: 'report:17',
        approved: false,
      },
    });
  });

  it('resumes one gate and produces a fresh continuation at the next gate', async () => {
    const first = await executeWorkflow({
      runId: 'a2-generated-two-gates',
      bundleDigest,
      filePath: twoGatesFixture,
      workflowName: 'durableTwoGates',
      params: { value: 3 },
    });
    if (first.kind !== 'yielded') throw new Error('expected first gate yield');
    expect(first.gate.kind).toBe('approval');

    const second = await executeWorkflow({
      runId: 'a2-generated-two-gates',
      bundleDigest,
      filePath: twoGatesFixture,
      workflowName: 'durableTwoGates',
      params: { value: 3 },
      continuation: first.continuation,
      resolution: {
        gateId: first.gate.id,
        value: { onSuccess: true, onFailure: false, value: 4 },
      },
    });
    if (second.kind !== 'yielded') throw new Error('expected second gate yield');
    expect(second.gate.kind).toBe('input');
    expect(second.gate.id).not.toBe(first.gate.id);

    const completed = await executeWorkflow({
      runId: 'a2-generated-two-gates',
      bundleDigest,
      filePath: twoGatesFixture,
      workflowName: 'durableTwoGates',
      params: { value: 3 },
      continuation: second.continuation,
      resolution: {
        gateId: second.gate.id,
        value: { onSuccess: true, onFailure: false, value: 5 },
      },
    });
    if (completed.kind !== 'completed' || (completed.result as { value?: unknown }).value !== 5) {
      throw new Error(`unexpected chained-gate completion: ${JSON.stringify(completed)}`);
    }
    expect(completed).toMatchObject({
      kind: 'completed',
      result: { onSuccess: true, onFailure: false, value: 5 },
    });
  });

  it('fails closed for stale resolution, changed bundle, and malformed state ownership', async () => {
    const yielded = await executeWorkflow({
      runId: 'a2-refusal-run',
      bundleDigest,
      filePath: fixture,
      workflowName: 'durableApproval',
      params: { value: 4 },
      production: true,
      includeTrace: false,
    });
    if (yielded.kind !== 'yielded') throw new Error('expected a durable yield');

    await expect(
      executeWorkflow({
        runId: 'a2-refusal-run',
        bundleDigest,
        filePath: fixture,
        workflowName: 'durableApproval',
        continuation: yielded.continuation,
        resolution: {
          gateId: '0'.repeat(64),
          value: { onSuccess: true, onFailure: false, value: 8 },
        },
      }),
    ).rejects.toMatchObject<Partial<ContinuationRefusalError>>({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'stale-gate' },
    });

    const invalid = structuredClone(yielded.continuation);
    invalid.state.variables = [
      ...invalid.state.variables,
      {
        address: invalid.location,
        portName: 'forged',
        value: 'not-owned-by-a-completed-node',
      },
    ];
    invalid.checksum = continuationChecksum(invalid);
    const graph = graphForEnvelope(yielded.continuation);
    expect(
      decodeContinuation(invalid, {
        runId: invalid.runId,
        workflowId: invalid.workflowId,
        bundleDigest: invalid.bundleDigest,
        graphFingerprint: invalid.graphFingerprint,
        graph,
      }),
    ).toMatchObject({
      accepted: false,
      reason: 'wrong-graph',
    });
  });

  it('rejects accessor-bearing values without invoking them', async () => {
    let invoked = false;
    const payload = {};
    Object.defineProperty(payload, 'secret', {
      enumerable: true,
      get() {
        invoked = true;
        return 'leaked';
      },
    });

    await expect(
      executeWorkflow({
        runId: 'a2-accessor-run',
        bundleDigest,
        filePath: fixture,
        workflowName: 'durableApproval',
        params: { value: 4 },
        continuation: payload,
        resolution: { gateId: '0'.repeat(64), value: null },
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'malformed' },
    });
    expect(invoked).toBe(false);

    const resolutionValue = {};
    Object.defineProperty(resolutionValue, 'secret', {
      enumerable: true,
      get() {
        invoked = true;
        return 'leaked';
      },
    });
    await expect(
      executeWorkflow({
        runId: 'a2-resolution-accessor',
        bundleDigest,
        filePath: '/definitely/not/read-before-resolution-validation.ts',
        resolution: {
          gateId: '0'.repeat(64),
          value: resolutionValue as never,
        },
      }),
    ).rejects.toThrow(/accessor/);
    expect(invoked).toBe(false);
  });

  it('refuses the same workflow source under a different executable bundle identity', async () => {
    const runId = 'a2-changed-import-run';
    const yielded = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: fixture,
      workflowName: 'durableApproval',
      params: { value: 4 },
    });
    if (yielded.kind !== 'yielded') throw new Error('expected a durable yield');

    await expect(
      executeWorkflow({
        runId,
        bundleDigest: `sha256:${'c'.repeat(64)}`,
        filePath: fixture,
        workflowName: 'durableApproval',
        continuation: yielded.continuation,
        resolution: {
          gateId: yielded.gate.id,
          value: { onSuccess: true, onFailure: false, value: 8 },
        },
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'wrong-bundle' },
    });
  });

  it('refuses an unclassified node before a durable gate at compile time', async () => {
    await expect(
      executeWorkflow({
        runId: 'a2-unclassified-effect',
        bundleDigest,
        filePath: unclassifiedFixture,
        workflowName: 'unsafeBeforeGate',
        params: { value: 4 },
      }),
    ).rejects.toThrow(
      /Every reachable node in a workflow with a durable gate must have exactly one compiler classification.*unsafeBeforeGate\.unknown \(unknownExternalEffect\): unclassified/s,
    );
  });

  it('requires bundle identity before an effect-before-gate graph can run', async () => {
    delete (globalThis as Record<string, unknown>).__a2_unclassified_effect_called__;
    await expect(
      executeWorkflow({
        runId: 'a2-missing-bundle',
        filePath: unclassifiedFixture,
        workflowName: 'unsafeBeforeGate',
        params: { value: 4 },
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'wrong-bundle' },
    });
    expect((globalThis as Record<string, unknown>).__a2_unclassified_effect_called__).toBeUndefined();
  });

  it('rejects conflicting local durable classifications', async () => {
    await expect(
      executeWorkflow({
        runId: 'a2-local-conflict',
        bundleDigest,
        filePath: localConflictFixture,
        workflowName: 'localConflict',
        params: { value: 4 },
        effectAdapter: notCommittedEffectAdapter,
      }),
    ).rejects.toThrow(/localConflict\.gate.*conflicting classifications/s);
  });

  it('rejects conflicting external durable classifications', async () => {
    await expect(
      executeWorkflow({
        runId: 'a2-external-conflict',
        bundleDigest,
        filePath: externalConflictFixture,
        workflowName: 'externalConflict',
        params: { value: 4 },
        effectAdapter: notCommittedEffectAdapter,
        externalNodeTypes: [
          {
            name: 'externalEffect',
            functionName: 'externalEffect',
            isAsync: true,
            durableEffect: true,
            durablePure: true,
            ports: [...externalPorts],
          },
          {
            name: 'externalGate',
            functionName: 'externalGate',
            isAsync: true,
            durableGate: 'approval',
            ports: [...externalPorts],
          },
        ],
      }),
    ).rejects.toThrow(/externalConflict\.effect.*conflicting classifications/s);
  });

  it('rejects a concurrent durable scope, naming the scope and its owner', async () => {
    // durable-scoped-gate.ts fans its iterations out with Promise.all, so the
    // per-iteration gate ordinals would race and could not be authenticated on
    // resume. The concurrency hazard is reported before the missing bound.
    await expect(
      compileWorkflow(scopedGateFixture, {
        write: false,
        inPlace: true,
        generate: { production: true },
      }),
    ).rejects.toThrow(
      /must iterate sequentially.*durableScopedGate\.owner \(scope 'iteration'\)/s,
    );
  });

  it('requires bundle identity across a reachable sibling-workflow gate before root effects', async () => {
    delete (globalThis as Record<string, unknown>).__a2_nested_predecessor_called__;
    await expect(
      executeWorkflow({
        runId: 'a2-nested-missing-bundle',
        filePath: nestedIdentityFixture,
        workflowName: 'outerWithNestedGate',
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'wrong-bundle' },
    });
    expect((globalThis as Record<string, unknown>).__a2_nested_predecessor_called__).toBeUndefined();
  });

  it('conservatively closes dynamic local invocation and preserves nested control-flow yields', async () => {
    delete (globalThis as Record<string, unknown>).__a2_nested_predecessor_called__;
    await expect(
      executeWorkflow({
        runId: 'a2-dynamic-missing-bundle',
        filePath: nestedIdentityFixture,
        workflowName: 'outerWithDynamicGate',
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'wrong-bundle' },
    });
    expect((globalThis as Record<string, unknown>).__a2_nested_predecessor_called__).toBeUndefined();

    const outcome = await executeWorkflow({
      runId: 'a2-dynamic-yield',
      bundleDigest,
      filePath: nestedIdentityFixture,
      workflowName: 'outerWithDynamicGate',
      params: { params: {} },
      effectAdapter: {
        recover: async () => ({
          kind: 'committed' as const,
          receipt: { id: 'predecessor' },
          result: { onSuccess: true, onFailure: false, value: 4 },
        }),
      },
    });
    if (outcome.kind !== 'yielded') {
      throw new Error(`expected nested durable yield: ${JSON.stringify(outcome)}`);
    }
    expect(outcome.gate.address.frames.map((frame) => frame.workflowId)).toEqual(['outerWithDynamicGate', 'innerGate']);
  });

  it('uses the closed recovery decoder when re-attesting completed effects', async () => {
    const runId = 'a2-closed-reattestation';
    const yielded = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: effectGateFixture,
      workflowName: 'durableEffectGate',
      params: { params: {} },
      effectAdapter: {
        recover: async () => ({
          kind: 'committed' as const,
          receipt: { id: 'effect' },
          result: { onSuccess: true, onFailure: false, value: 4 },
        }),
      },
    });
    if (yielded.kind !== 'yielded') throw new Error('expected nested gate yield');
    expect(yielded.continuation.receipts).toHaveLength(1);

    await expect(
      executeWorkflow({
        runId,
        bundleDigest,
        filePath: effectGateFixture,
        workflowName: 'durableEffectGate',
        params: { params: {} },
        continuation: yielded.continuation,
        resolution: {
          gateId: yielded.gate.id,
          value: { onSuccess: true, onFailure: false, value: 4 },
        },
        effectAdapter: {
          recover: async () =>
            ({
              kind: 'committed',
              receipt: { id: 'effect' },
              result: { onSuccess: true, onFailure: false, value: 4 },
              futureField: true,
            }) as never,
        },
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'ambiguous-effect' },
    });
  });

  it('makes durable safety intrinsic to public generation entry points', async () => {
    const parallel = await parseWorkflow(parallelFixture, {
      workflowName: 'durableParallel',
    });
    expect(parallel.errors).toEqual([]);
    const generated = generateCode(parallel.ast, {
      production: true,
      allWorkflows: parallel.allWorkflows,
      durableSequential: false,
    } as never);
    expect(generated).not.toContain('Promise.all');
    const generatedInPlace = generateInPlace(fs.readFileSync(parallelFixture, 'utf8'), parallel.ast, {
      production: true,
      allWorkflows: parallel.allWorkflows,
      durableSequential: false,
    } as never);
    expect(generatedInPlace.code).not.toContain('Promise.all');

    const scoped = await parseWorkflow(scopedGateFixture, {
      workflowName: 'durableScopedGate',
    });
    expect(() =>
      generateCode(scoped.ast, {
        production: true,
        allWorkflows: scoped.allWorkflows,
      }),
    ).toThrow(/must iterate sequentially/);
  });

  it('refuses lazy predecessors and gates after branch convergence', async () => {
    await expect(compileWorkflow(lazyFixture, { write: false })).rejects.toThrow(
      /do not support pull or lazy execution.*durableLazy\.lazy/s,
    );
    await expect(compileWorkflow(branchConvergenceFixture, { write: false })).rejects.toThrow(
      /Durable boundaries after branch convergence are not supported.*durableBranchConvergence\.gate/s,
    );
  });

  it('detaches a validated resolution before asynchronous preflight', async () => {
    const runId = 'a2-resolution-clone';
    const yielded = await executeWorkflow({
      runId,
      bundleDigest,
      filePath: fixture,
      workflowName: 'durableApproval',
      params: { value: 3 },
    });
    if (yielded.kind !== 'yielded') throw new Error('expected approval yield');
    const resolution = {
      gateId: yielded.gate.id,
      value: { onSuccess: true, onFailure: false, value: 6 },
    };
    const resumedPromise = executeWorkflow({
      runId,
      bundleDigest,
      filePath: fixture,
      workflowName: 'durableApproval',
      params: { value: 3 },
      continuation: yielded.continuation,
      resolution,
    });
    resolution.value.value = 999;

    await expect(resumedPromise).resolves.toMatchObject({
      kind: 'completed',
      result: { result: 7 },
    });
  });

  it('fingerprints the canonical full reachable closure, not only the selected root', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-weaver-a2-closure-'));
    const changedFixture = path.join(tempDir, 'durable-nested-identity.ts');
    try {
      const original = fs.readFileSync(nestedIdentityFixture, 'utf8');
      fs.writeFileSync(changedFixture, original, 'utf8');
      const yielded = await executeWorkflow({
        runId: 'a2-closure-fingerprint',
        bundleDigest,
        filePath: changedFixture,
        workflowName: 'outerWithDynamicGate',
        params: { params: {} },
        effectAdapter: {
          recover: async () => ({ kind: 'not-committed' as const }),
        },
      });
      if (yielded.kind !== 'yielded') throw new Error('expected initial nested yield');

      fs.writeFileSync(
        changedFixture,
        original.replace('@connect gate.value -> Exit.value', '@connect Start.value -> Exit.value'),
        'utf8',
      );
      await expect(
        executeWorkflow({
          runId: 'a2-closure-fingerprint',
          bundleDigest,
          filePath: changedFixture,
          workflowName: 'outerWithDynamicGate',
          params: { params: {} },
          continuation: yielded.continuation,
          resolution: {
            gateId: yielded.gate.id,
            value: { onSuccess: true, onFailure: false, value: 4 },
          },
          effectAdapter: {
            recover: async () => ({ kind: 'not-committed' as const }),
          },
        }),
      ).rejects.toMatchObject({
        name: 'ContinuationRefusalError',
        refusal: { accepted: false, reason: 'wrong-graph' },
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('requires effect recovery before a reachable effect can run', async () => {
    delete (globalThis as Record<string, unknown>).__a2_nested_predecessor_called__;
    await expect(
      executeWorkflow({
        runId: 'a2-missing-effect-adapter',
        bundleDigest,
        filePath: nestedIdentityFixture,
        workflowName: 'outerWithNestedGate',
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'ambiguous-effect' },
    });
    expect((globalThis as Record<string, unknown>).__a2_nested_predecessor_called__).toBeUndefined();
  });

  it('serializes a durable closure so a terminal yield leaves no sibling lane live', async () => {
    const generated = await compileWorkflow(parallelFixture, {
      inPlace: true,
      write: false,
      parse: { workflowName: 'durableParallel' },
      generate: { production: true },
    });
    expect(generated.code).not.toContain('Promise.all([');

    delete (globalThis as Record<string, unknown>).__a2_late_parallel_effect_called__;
    const outcome = await executeWorkflow({
      runId: 'a2-terminal-settlement',
      bundleDigest,
      filePath: parallelFixture,
      workflowName: 'durableParallel',
      params: { prompt: 'approve' },
      effectAdapter: {
        recover: async () => ({ kind: 'not-committed' as const }),
      },
    });
    expect(outcome.kind).toBe('yielded');
    expect((globalThis as Record<string, unknown>).__a2_late_parallel_effect_called__).toBeUndefined();
    if (outcome.kind !== 'yielded') throw new Error('expected terminal gate yield');

    const forgedEffectAddress = {
      frames: [{ workflowId: 'durableParallel', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'effect',
      nodeType: 'lateEffect',
      executionIndex: 0,
    } as const;
    const forged = structuredClone(outcome.continuation);
    forged.state.completed = [...forged.state.completed, forgedEffectAddress];
    forged.receipts = [
      ...forged.receipts,
      {
        address: forgedEffectAddress,
        operationKey: operationKey('a2-terminal-settlement', forgedEffectAddress),
        receipt: { id: 'forged' },
      },
    ];
    forged.checksum = continuationChecksum(forged);
    await expect(
      executeWorkflow({
        runId: 'a2-terminal-settlement',
        bundleDigest,
        filePath: parallelFixture,
        workflowName: 'durableParallel',
        params: { prompt: 'approve' },
        continuation: forged,
        resolution: {
          gateId: outcome.gate.id,
          value: { onSuccess: true, onFailure: false, approved: true },
        },
        effectAdapter: {
          recover: async () => ({ kind: 'not-committed' as const }),
        },
      }),
    ).rejects.toMatchObject({
      name: 'ContinuationRefusalError',
      refusal: { accepted: false, reason: 'wrong-graph' },
    });
    expect((globalThis as Record<string, unknown>).__a2_late_parallel_effect_called__).toBeUndefined();

    const resumed = await executeWorkflow({
      runId: 'a2-terminal-settlement',
      bundleDigest,
      filePath: parallelFixture,
      workflowName: 'durableParallel',
      params: { prompt: 'approve' },
      continuation: outcome.continuation,
      resolution: {
        gateId: outcome.gate.id,
        value: { onSuccess: true, onFailure: false, approved: true },
      },
      effectAdapter: {
        recover: async () => ({ kind: 'not-committed' as const }),
      },
    });
    expect(resumed).toMatchObject({
      kind: 'completed',
      result: { approved: true, value: 7 },
    });
    expect((globalThis as Record<string, unknown>).__a2_late_parallel_effect_called__).toBe(true);
  });

  it('generates the effect-adapter boundary for an exactly classified external effect', async () => {
    const compiled = await compileWorkflow(externalConflictFixture, {
      write: false,
      inPlace: false,
      parse: {
        workflowName: 'externalConflict',
        externalNodeTypes: [
          {
            name: 'externalEffect',
            functionName: 'externalEffect',
            isAsync: true,
            durableEffect: true,
            ports: [...externalPorts],
          },
          {
            name: 'externalGate',
            functionName: 'externalGate',
            isAsync: true,
            durableGate: 'approval',
            ports: [...externalPorts],
          },
        ],
      },
    });
    expect(compiled.code).toContain("ctx.executeEffect('effect', 'externalEffect'");
    expect(compiled.code).toContain("ctx.resolveGate('approval', 'gate', 'externalGate'");
  });
});
