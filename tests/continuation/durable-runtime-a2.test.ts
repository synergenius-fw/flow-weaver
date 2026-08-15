import {
  createContinuationEnvelope,
  continuationChecksum,
  decodeContinuation,
  durableGateId,
  operationKey,
  validateWireValue,
  MAX_CONTINUATION_BYTES,
  MAX_CONTINUATION_DEPTH,
  MAX_CONTINUATION_ENTRIES,
  MAX_CONTINUATION_STRING_BYTES,
  type ExecutionAddress,
} from '../../src/runtime/continuation.js';
import {
  AmbiguousEffectError,
  DurableExecution,
  DurableGateYield,
  createWorkflowRuntime,
} from '../../src/runtime/durable-execution.js';
import { GeneratedExecutionContext } from '../../src/runtime/ExecutionContext.js';
import { storeDebugSession } from '../../src/mcp/debug-session.js';
import { invokeWorkflow } from '../../src/built-in-nodes/invoke-workflow.js';

function graphForAddress(
  address: ExecutionAddress,
  outputPorts: readonly string[] = [],
  durableEffect: boolean = false,
) {
  const workflowIds = new Set(address.frames.map((frame) => frame.workflowId));
  const nodes = [
    {
      workflowId: address.frames.at(-1)!.workflowId,
      nodeId: address.nodeId,
      nodeType: address.nodeType,
      executionOrder: 1,
      inputPorts: [],
      outputPorts,
      scopeNames: [],
      invokedWorkflows: [],
      branchArms: [],
      branchPath: address.branches
        .filter((branch) => branch.frameDepth === address.frames.length - 1)
        .map(({ nodeId, arm }) => ({ nodeId, arm })),
      predecessors: [],
      durableGate: 'approval' as const,
      ...(durableEffect && { durableEffect: true as const }),
    },
  ];
  for (let index = 1; index < address.frames.length; index++) {
    const frame = address.frames[index];
    if (frame.callerNodeId !== undefined) {
      nodes.push({
        workflowId: address.frames[index - 1].workflowId,
        nodeId: frame.callerNodeId,
        nodeType: frame.callerNodeId,
        executionOrder: 0,
        inputPorts: [],
        outputPorts: [],
        scopeNames: [],
        invokedWorkflows: [frame.workflowId],
        branchArms: [],
        branchPath: [],
        predecessors: [],
        durableGate: 'approval',
      });
    }
  }
  for (const scope of address.scopes) {
    for (const workflowId of workflowIds) {
      nodes.push({
        workflowId,
        nodeId: scope.parentNodeId,
        nodeType: scope.parentNodeId,
        executionOrder: 0,
        inputPorts: [],
        outputPorts: [],
        scopeNames: [scope.scopeName],
        invokedWorkflows: [],
        branchArms: [],
        branchPath: [],
        predecessors: [],
        durableGate: 'approval',
      });
    }
  }
  for (const branch of address.branches) {
    nodes.push({
      workflowId: branch.workflowId,
      nodeId: branch.nodeId,
      nodeType: branch.nodeId,
      executionOrder: 0,
      inputPorts: [],
      outputPorts: [],
      scopeNames: [],
      invokedWorkflows: [],
      branchArms: [branch.arm],
      branchPath: [],
      predecessors: [],
      durableGate: 'approval',
    });
  }
  const uniqueNodes = nodes.filter(
    (node, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.workflowId === node.workflowId &&
          candidate.nodeId === node.nodeId &&
          candidate.nodeType === node.nodeType,
      ) === index,
  );
  const nextOrder = new Map<string, number>();
  return {
    nodes: uniqueNodes.map((node) => {
      const executionOrder = nextOrder.get(node.workflowId) ?? 0;
      nextOrder.set(node.workflowId, executionOrder + 1);
      return { ...node, executionOrder };
    }),
  };
}

describe('A2 durable runtime state machine', () => {
  it('assigns exact nested, scope, loop, and branch addresses without process state', () => {
    const runtime = createWorkflowRuntime({
      runId: 'address-run',
      workflowId: 'outer',
    });
    const root = new GeneratedExecutionContext(true, runtime);
    const container = root.addExecution('container');
    const firstIteration = root.createScope('container', container, 'items', true);
    firstIteration.enterBranch('decision', 0, 'success');
    const nested = firstIteration.createNestedRuntime('inner', 'callInner', 0);

    expect(
      nested.durable.address(nested, 'gate', 'approval', 0),
    ).toEqual({
      frames: [
        { workflowId: 'outer', invocation: 0 },
        {
          workflowId: 'inner',
          invocation: 0,
          callerNodeId: 'callInner',
          callerExecutionIndex: 0,
        },
      ],
      scopes: [
        {
          parentNodeId: 'container',
          parentExecutionIndex: 0,
          scopeName: 'items',
          invocation: 0,
          loopIteration: 0,
        },
      ],
      branches: [
        {
          workflowId: 'outer',
          frameDepth: 0,
          nodeId: 'decision',
          executionIndex: 0,
          arm: 'success',
        },
      ],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    });

    const secondIteration = root.createScope('container', container, 'items', true);
    expect(secondIteration.getRuntime().scopes[0]?.loopIteration).toBe(1);
  });

  it('isolates continuation addresses across concurrent sibling lanes', async () => {
    const root = new GeneratedExecutionContext(
      true,
      createWorkflowRuntime({
        runId: 'parallel-address-run',
        workflowId: 'parallel',
      }),
    );
    const left = root.forkParallel();
    const right = root.forkParallel();

    const [leftAddress, rightAddress] = await Promise.all([
      (async () => {
        left.enterBranch('leftDecision', 0, 'success');
        await Promise.resolve();
        return left.executionAddress({
          id: 'leftGate',
          nodeTypeName: 'approval',
          executionIndex: 0,
        });
      })(),
      (async () => {
        right.enterBranch('rightDecision', 0, 'failure');
        await Promise.resolve();
        return right.executionAddress({
          id: 'rightGate',
          nodeTypeName: 'approval',
          executionIndex: 0,
        });
      })(),
    ]);

    expect(leftAddress.branches).toEqual([
      {
        workflowId: 'parallel',
        frameDepth: 0,
        nodeId: 'leftDecision',
        executionIndex: 0,
        arm: 'success',
      },
    ]);
    expect(rightAddress.branches).toEqual([
      {
        workflowId: 'parallel',
        frameDepth: 0,
        nodeId: 'rightDecision',
        executionIndex: 0,
        arm: 'failure',
      },
    ]);
    expect(root.getRuntime().branches).toEqual([]);
  });

  it('refuses ambiguous branch-descendant variables at convergence', () => {
    const runtime = createWorkflowRuntime({
      runId: 'ambiguous-branch-convergence',
      workflowId: 'branchConvergence',
    });
    const rootAddress: ExecutionAddress = {
      frames: runtime.frames,
      scopes: [],
      branches: [],
      nodeId: 'assemble',
      nodeType: 'assembleReport',
      executionIndex: 0,
    };
    const inBranch = (arm: string): ExecutionAddress => ({
      ...rootAddress,
      branches: [
        {
          workflowId: 'branchConvergence',
          frameDepth: 0,
          nodeId: 'decision',
          executionIndex: 0,
          arm,
        },
      ],
    });
    runtime.durable.setVariable(inBranch('success'), 'report', 'success report');
    runtime.durable.setVariable(inBranch('failure'), 'report', 'failure report');

    expect(() => runtime.durable.getVariable(rootAddress, 'report')).toThrow(
      /Ambiguous durable variable address for assemble\.report/,
    );
  });

  it('propagates and bounds dynamic workflow recursion depth', async () => {
    const invoked = vi.fn(async () => ({ value: 7 }));
    const runtime = createWorkflowRuntime({
      runId: 'dynamic-depth',
      workflowId: 'outer',
      services: { workflowRegistry: { inner: invoked } },
    });
    await expect(
      invokeWorkflow(
        true,
        'inner',
        { value: 6 },
        undefined,
        undefined,
        {
          nodeId: 'invoke',
          runtime,
          recursionDepth: 12,
          createNestedRuntime: () => runtime,
        },
      ),
    ).resolves.toMatchObject({ onSuccess: true, result: { value: 7 } });
    expect(invoked).toHaveBeenCalledWith(
      true,
      { value: 6, __rd__: 13 },
      runtime,
    );

    invoked.mockClear();
    await expect(
      invokeWorkflow(
        true,
        'inner',
        {},
        undefined,
        undefined,
        {
          nodeId: 'invoke',
          runtime,
          recursionDepth: 999,
          createNestedRuntime: () => runtime,
        },
      ),
    ).rejects.toThrow(/Max recursion depth exceeded \(1000\)/);
    expect(invoked).not.toHaveBeenCalled();
  });

  it('requires an effect adapter to resolve post-crash ambiguity and preserves stable operation keys', async () => {
    const address: ExecutionAddress = {
      frames: [{ workflowId: 'effects', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'charge',
      nodeType: 'chargeCard',
      executionIndex: 0,
    };
    const runId = 'effect-run';
    const continuation = createContinuationEnvelope({
      runId,
      gateId: durableGateId(runId, 'approval', address),
      gateKind: 'approval',
      workflowId: 'effects',
      bundleDigest: `sha256:${'1'.repeat(64)}`,
      graphFingerprint: '2'.repeat(64),
      location: address,
      state: { completed: [], variables: [], nextBoundary: address },
      receipts: [],
    });
    const decoded = decodeContinuation(continuation, {
      runId,
      workflowId: 'effects',
      bundleDigest: `sha256:${'1'.repeat(64)}`,
      graphFingerprint: '2'.repeat(64),
      graph: graphForAddress(address, [], true),
    });
    if (!decoded.accepted) throw new Error(decoded.message);
    const runtime = createWorkflowRuntime({
      runId,
      workflowId: 'effects',
      continuation: decoded.envelope,
    });

    await expect(
      runtime.durable.executeEffect(
        runtime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        async () => ({ result: { charged: true }, receipt: { id: 'receipt' } }),
      ),
    ).rejects.toBeInstanceOf(AmbiguousEffectError);

    const recover = vi.fn(async (key: string) => ({
      kind: 'committed' as const,
      receipt: { id: 'receipt' },
      result: { charged: true },
    }));
    const recoveredDecoded = decodeContinuation(
      structuredClone(continuation),
      {
        runId,
        workflowId: 'effects',
        bundleDigest: `sha256:${'1'.repeat(64)}`,
        graphFingerprint: '2'.repeat(64),
        graph: graphForAddress(address, [], true),
      },
    );
    if (!recoveredDecoded.accepted) throw new Error(recoveredDecoded.message);
    const recoveredRuntime = createWorkflowRuntime({
      runId,
      workflowId: 'effects',
      continuation: recoveredDecoded.envelope,
      services: { effectAdapter: { recover } },
    });
    await expect(
      recoveredRuntime.durable.executeEffect(
        recoveredRuntime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        async () => {
          throw new Error('must not repeat a recovered committed effect');
        },
      ),
    ).resolves.toEqual({ charged: true });
    expect(recover).toHaveBeenCalledWith(operationKey(runId, address), address);

    const execute = vi.fn(async () => ({
      result: { charged: true },
      receipt: { id: 'new-receipt' },
    }));
    const newRuntime = createWorkflowRuntime({
      runId: 'new-effect-run',
      workflowId: 'effects',
      services: {
        effectAdapter: {
          recover: async () => ({ kind: 'not-committed' as const }),
        },
      },
    });
    await expect(
      newRuntime.durable.executeEffect(
        newRuntime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        execute,
      ),
    ).resolves.toEqual({ charged: true });
    expect(execute).toHaveBeenCalledWith(
      operationKey(
        'new-effect-run',
        newRuntime.durable.address(newRuntime, 'charge', 'chargeCard', 0),
      ),
    );
  });

  it('rechecks recovery when an attempted effect body throws', async () => {
    const ambiguousRecover = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'not-committed' as const })
      .mockResolvedValueOnce({ kind: 'ambiguous' as const });
    const ambiguousRuntime = createWorkflowRuntime({
      runId: 'thrown-effect-ambiguous',
      workflowId: 'effects',
      services: { effectAdapter: { recover: ambiguousRecover } },
    });
    await expect(
      ambiguousRuntime.durable.executeEffect(
        ambiguousRuntime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        async () => {
          throw new Error('connection dropped after request');
        },
      ),
    ).rejects.toBeInstanceOf(AmbiguousEffectError);
    expect(ambiguousRecover).toHaveBeenCalledTimes(2);

    const committedRuntime = createWorkflowRuntime({
      runId: 'thrown-effect-committed',
      workflowId: 'effects',
      services: {
        effectAdapter: {
          recover: vi
            .fn()
            .mockResolvedValueOnce({ kind: 'not-committed' as const })
            .mockResolvedValueOnce({
              kind: 'committed' as const,
              receipt: { id: 'receipt' },
              result: { onSuccess: true, value: 11 },
            }),
        },
      },
    });
    await expect(
      committedRuntime.durable.executeEffect(
        committedRuntime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        async () => {
          throw new Error('response lost after commit');
        },
      ),
    ).resolves.toEqual({ onSuccess: true, value: 11 });
  });

  it('lets an effect adapter durably commit the exact result used for later re-attestation', async () => {
    const committed = new Map<string, { receipt: unknown; result: unknown }>();
    const recover = vi.fn(async (key: string) => {
      const value = committed.get(key);
      return value === undefined ? { kind: 'not-committed' as const } : { kind: 'committed' as const, ...value };
    });
    const commit = vi.fn(async (key: string, _address: unknown, execution: { receipt: unknown; result: unknown }) => {
      committed.set(key, structuredClone(execution));
    });
    const runtime = createWorkflowRuntime({ runId: 'commit-hook-run', workflowId: 'effects', services: { effectAdapter: { recover, commit } } });
    await expect(runtime.durable.executeEffect(
      runtime,
      { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
      async () => ({ result: { charged: true }, receipt: { id: 'receipt-1' } }),
    )).resolves.toEqual({ charged: true });
    expect(commit).toHaveBeenCalledOnce();
    expect(committed.size).toBe(1);
  });

  it('fails ambiguous when commit fails and recovery cannot prove the exact effect', async () => {
    const recover = vi.fn().mockResolvedValueOnce({ kind: 'not-committed' as const }).mockResolvedValueOnce({ kind: 'repeatable' as const });
    const runtime = createWorkflowRuntime({
      runId: 'failed-commit-run', workflowId: 'effects',
      services: { effectAdapter: { recover, commit: async () => { throw new Error('store unavailable'); } } },
    });
    await expect(runtime.durable.executeEffect(
      runtime,
      { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
      async () => ({ result: { charged: true }, receipt: { id: 'receipt-1' } }),
    )).rejects.toBeInstanceOf(AmbiguousEffectError);
  });

  it('fails ambiguous when recovery after a commit error proves a different effect', async () => {
    const recover = vi.fn()
      .mockResolvedValueOnce({ kind: 'not-committed' as const })
      .mockResolvedValueOnce({ kind: 'committed' as const, result: { charged: false }, receipt: { id: 'another-receipt' } });
    const runtime = createWorkflowRuntime({
      runId: 'mismatched-commit-run', workflowId: 'effects',
      services: { effectAdapter: { recover, commit: async () => { throw new Error('acknowledgement lost'); } } },
    });
    await expect(runtime.durable.executeEffect(
      runtime,
      { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
      async () => ({ result: { charged: true }, receipt: { id: 'receipt-1' } }),
    )).rejects.toBeInstanceOf(AmbiguousEffectError);
  });

  it('treats unknown or malformed effect recovery states as ambiguous', async () => {
    const execute = vi.fn(async () => ({
      result: { charged: true },
      receipt: { id: 'receipt' },
    }));
    const initialRuntime = createWorkflowRuntime({
      runId: 'unknown-initial-recovery',
      workflowId: 'effects',
      services: {
        effectAdapter: {
          recover: async () => ({ kind: 'future-state' }) as never,
        },
      },
    });
    await expect(
      initialRuntime.durable.executeEffect(
        initialRuntime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        execute,
      ),
    ).rejects.toBeInstanceOf(AmbiguousEffectError);
    expect(execute).not.toHaveBeenCalled();

    const malformedCommittedRuntime = createWorkflowRuntime({
      runId: 'malformed-committed-recovery',
      workflowId: 'effects',
      services: {
        effectAdapter: {
          recover: async () =>
            ({
              kind: 'committed',
              receipt: new Date(),
              result: {},
            }) as never,
        },
      },
    });
    await expect(
      malformedCommittedRuntime.durable.executeEffect(
        malformedCommittedRuntime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        execute,
      ),
    ).rejects.toBeInstanceOf(AmbiguousEffectError);
    expect(execute).not.toHaveBeenCalled();

    const failedRuntime = createWorkflowRuntime({
      runId: 'unknown-after-failure-recovery',
      workflowId: 'effects',
      services: {
        effectAdapter: {
          recover: vi
            .fn()
            .mockResolvedValueOnce({ kind: 'not-committed' as const })
            .mockResolvedValueOnce({ kind: 'future-state' } as never),
        },
      },
    });
    await expect(
      failedRuntime.durable.executeEffect(
        failedRuntime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        async () => {
          throw new Error('response lost');
        },
      ),
    ).rejects.toBeInstanceOf(AmbiguousEffectError);
  });

  it('rechecks recovery when an effect returns a malformed committed response', async () => {
    const recover = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'not-committed' as const })
      .mockResolvedValueOnce({ kind: 'ambiguous' as const });
    const runtime = createWorkflowRuntime({
      runId: 'malformed-effect-response',
      workflowId: 'effects',
      services: { effectAdapter: { recover } },
    });

    await expect(
      runtime.durable.executeEffect(
        runtime,
        { nodeId: 'charge', nodeType: 'chargeCard', executionIndex: 0 },
        async () =>
          ({
            result: new Date(),
            receipt: { id: 'receipt' },
          }) as never,
      ),
    ).rejects.toBeInstanceOf(AmbiguousEffectError);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('consumes one resume gate and yields terminally at the next distinct gate', () => {
    const first: ExecutionAddress = {
      frames: [{ workflowId: 'twoGates', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'first',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const second: ExecutionAddress = {
      ...first,
      nodeId: 'second',
    };
    const runId = 'two-gate-run';
    const gateId = durableGateId(runId, 'approval', first);
    const raw = createContinuationEnvelope({
      runId,
      gateId,
      gateKind: 'approval',
      workflowId: 'twoGates',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: first,
      state: { completed: [], variables: [], nextBoundary: first },
      receipts: [],
    });
    const graph = {
      nodes: [first, second].map((address) => ({
        workflowId: 'twoGates',
        nodeId: address.nodeId,
        nodeType: address.nodeType,
        executionOrder: address.nodeId === 'first' ? 0 : 1,
        inputPorts: [],
        outputPorts: [],
        scopeNames: [],
        invokedWorkflows: [],
        branchArms: [],
        branchPath: [],
        predecessors: [],
        durableGate: 'approval' as const,
      })),
    };
    const decoded = decodeContinuation(raw, {
      runId,
      workflowId: 'twoGates',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      gateId,
      graph,
    });
    if (!decoded.accepted) throw new Error(decoded.message);
    const runtime = createWorkflowRuntime({
      runId,
      workflowId: 'twoGates',
      continuation: decoded.envelope,
      resolution: { gateId, value: { approved: true } },
    });

    expect(
      runtime.durable.resolveGate(runtime, {
        kind: 'approval',
        nodeId: 'first',
        nodeType: 'approval',
        executionIndex: 0,
        payload: {},
      }),
    ).toEqual({ approved: true });
    expect(() =>
      runtime.durable.resolveGate(runtime, {
        kind: 'approval',
        nodeId: 'second',
        nodeType: 'approval',
        executionIndex: 0,
        payload: {},
      }),
    ).toThrow(DurableGateYield);
    expect(() =>
      runtime.durable.resolveGate(runtime, {
        kind: 'approval',
        nodeId: 'first',
        nodeType: 'approval',
        executionIndex: 0,
        payload: {},
      }),
    ).toThrowError(expect.objectContaining({ name: 'StaleGateError' }));
  });

  it('accepts a prior completed gate after its branch has converged before a later gate', () => {
    const frame = [{ workflowId: 'convergedGates', invocation: 0 }] as const;
    const address = (
      nodeId: string,
      nodeType: string,
      branches: ExecutionAddress['branches'] = [],
    ): ExecutionAddress => ({ frames: [...frame], scopes: [], branches, nodeId, nodeType, executionIndex: 0 });
    const resolve = address('resolve', 'resolve');
    const first = address('firstGate', 'approval', [{ frameDepth: 0, workflowId: 'convergedGates', nodeId: 'resolve', arm: 'success', executionIndex: 0 }]);
    const selected = address('selected', 'selected');
    const second = address('secondGate', 'approval', [{ frameDepth: 0, workflowId: 'convergedGates', nodeId: 'selected', arm: 'success', executionIndex: 0 }]);
    const runId = 'converged-two-gate-run';
    const gateId = durableGateId(runId, 'approval', second);
    const graph = { nodes: [
      { workflowId: 'convergedGates', nodeId: 'resolve', nodeType: 'resolve', executionOrder: 0, inputPorts: [], outputPorts: [], scopeNames: [], invokedWorkflows: [], branchArms: ['success', 'failure'], branchPath: [], predecessors: [] },
      { workflowId: 'convergedGates', nodeId: 'firstGate', nodeType: 'approval', executionOrder: 1, inputPorts: [], outputPorts: [], scopeNames: [], invokedWorkflows: [], branchArms: [], branchPath: [{ nodeId: 'resolve', arm: 'success' }], predecessors: [], durableGate: 'approval' as const },
      { workflowId: 'convergedGates', nodeId: 'selected', nodeType: 'selected', executionOrder: 2, inputPorts: [], outputPorts: [], scopeNames: [], invokedWorkflows: [], branchArms: ['success', 'failure'], branchPath: [], predecessors: [{ nodeId: 'resolve', branchPath: [] }] },
      { workflowId: 'convergedGates', nodeId: 'secondGate', nodeType: 'approval', executionOrder: 3, inputPorts: [], outputPorts: [], scopeNames: [], invokedWorkflows: [], branchArms: [], branchPath: [{ nodeId: 'selected', arm: 'success' }], predecessors: [{ nodeId: 'selected', branchPath: [] }], durableGate: 'approval' as const },
    ] };
    const raw = createContinuationEnvelope({
      runId, gateId, gateKind: 'approval', workflowId: 'convergedGates',
      bundleDigest: `sha256:${'a'.repeat(64)}`, graphFingerprint: 'b'.repeat(64), location: second,
      state: { completed: [resolve, first, selected], variables: [], nextBoundary: second }, receipts: [],
    });

    expect(decodeContinuation(raw, {
      runId, workflowId: 'convergedGates', bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64), gateId, graph,
    })).toMatchObject({ accepted: true });
  });

  it('uses canonical address identity across property-reordered JSON roundtrips', () => {
    const address: ExecutionAddress = {
      frames: [{ workflowId: 'reordered', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const runId = 'reordered-run';
    const raw = createContinuationEnvelope({
      runId,
      gateId: durableGateId(runId, 'approval', address),
      gateKind: 'approval',
      workflowId: 'reordered',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: address,
      state: { completed: [], variables: [], nextBoundary: address },
      receipts: [],
    });
    const reordered = {
      executionIndex: 0,
      nodeType: 'approval',
      nodeId: 'gate',
      branches: [],
      scopes: [],
      frames: [{ invocation: 0, workflowId: 'reordered' }],
    } satisfies ExecutionAddress;
    const reorderedEnvelope = {
      ...raw,
      location: reordered,
      state: { ...raw.state, nextBoundary: reordered },
      checksum: '',
    };
    reorderedEnvelope.checksum = continuationChecksum(reorderedEnvelope);
    const decoded = decodeContinuation(reorderedEnvelope, {
      runId,
      workflowId: 'reordered',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      gateId: raw.gateId,
      graph: graphForAddress(address),
    });
    expect(decoded.accepted).toBe(true);

    const nonCanonicalDate = {
      ...raw,
      createdAt: '2026-01-01',
      checksum: '',
    };
    nonCanonicalDate.checksum = continuationChecksum(nonCanonicalDate);
    expect(
      decodeContinuation(nonCanonicalDate, {
        runId,
        workflowId: 'reordered',
        bundleDigest: `sha256:${'a'.repeat(64)}`,
        graphFingerprint: 'b'.repeat(64),
        gateId: raw.gateId,
        graph: graphForAddress(address),
      }),
    ).toMatchObject({ accepted: false, reason: 'malformed' });
  });

  it('rejects forged future completion and output state before a gate boundary', () => {
    const boundary: ExecutionAddress = {
      frames: [{ workflowId: 'prefix', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const future: ExecutionAddress = {
      ...boundary,
      nodeId: 'future',
      nodeType: 'pureNode',
    };
    const runId = 'forged-prefix-run';
    const envelope = createContinuationEnvelope({
      runId,
      gateId: durableGateId(runId, 'approval', boundary),
      gateKind: 'approval',
      workflowId: 'prefix',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: boundary,
      state: {
        completed: [future],
        variables: [{ address: future, portName: 'result', value: 'forged' }],
        nextBoundary: boundary,
      },
      receipts: [],
    });
    const common = {
      inputPorts: [] as const,
      scopeNames: [] as const,
      invokedWorkflows: [] as const,
      branchArms: [] as const,
      branchPath: [] as const,
      predecessors: [] as const,
    };
    const decoded = decodeContinuation(envelope, {
      runId,
      workflowId: 'prefix',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      graph: {
        nodes: [
          {
            ...common,
            workflowId: 'prefix',
            nodeId: 'gate',
            nodeType: 'approval',
            executionOrder: 1,
            outputPorts: [],
            durableGate: 'approval',
          },
          {
            ...common,
            workflowId: 'prefix',
            nodeId: 'future',
            nodeType: 'pureNode',
            executionOrder: 2,
            outputPorts: ['result'],
          },
        ],
      },
    });

    expect(decoded).toMatchObject({ accepted: false, reason: 'wrong-graph' });
  });

  it('rejects a completed set that omits a required compiled predecessor', () => {
    const frame = [{ workflowId: 'strict-prefix', invocation: 0 }] as const;
    const start: ExecutionAddress = {
      frames: frame,
      scopes: [],
      branches: [],
      nodeId: 'Start',
      nodeType: 'Start',
      executionIndex: 0,
    };
    const boundary: ExecutionAddress = {
      ...start,
      nodeId: 'gate',
      nodeType: 'approval',
    };
    const runId = 'missing-prefix-run';
    const envelope = createContinuationEnvelope({
      runId,
      gateId: durableGateId(runId, 'approval', boundary),
      gateKind: 'approval',
      workflowId: 'strict-prefix',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: boundary,
      state: {
        completed: [start],
        variables: [],
        nextBoundary: boundary,
      },
      receipts: [],
    });
    const common = {
      workflowId: 'strict-prefix',
      inputPorts: [] as const,
      outputPorts: [] as const,
      scopeNames: [] as const,
      invokedWorkflows: [] as const,
      branchArms: [] as const,
      branchPath: [] as const,
    };

    expect(
      decodeContinuation(envelope, {
        runId,
        workflowId: 'strict-prefix',
        bundleDigest: `sha256:${'a'.repeat(64)}`,
        graphFingerprint: 'b'.repeat(64),
        graph: {
          nodes: [
            {
              ...common,
              nodeId: 'Start',
              nodeType: 'Start',
              executionOrder: -1,
              predecessors: [],
            },
            {
              ...common,
              nodeId: 'pure',
              nodeType: 'pureNode',
              executionOrder: 0,
              predecessors: [{ nodeId: 'Start', branchPath: [] }],
            },
            {
              ...common,
              nodeId: 'gate',
              nodeType: 'approval',
              executionOrder: 1,
              predecessors: [
                { nodeId: 'Start', branchPath: [] },
                { nodeId: 'pure', branchPath: [] },
              ],
              durableGate: 'approval',
            },
          ],
        },
      }),
    ).toMatchObject({ accepted: false, reason: 'wrong-graph' });
  });

  it('rejects nested callers, scopes, and branch arms not owned by the graph', () => {
    const common = {
      inputPorts: [] as const,
      outputPorts: [] as const,
      scopeNames: [] as const,
      invokedWorkflows: [] as const,
      branchArms: [] as const,
      branchPath: [] as const,
      predecessors: [] as const,
    };
    const cases = [
      {
        name: 'nested caller target',
        address: {
          frames: [
            { workflowId: 'root', invocation: 0 },
            {
              workflowId: 'inner',
              invocation: 0,
              callerNodeId: 'call',
              callerExecutionIndex: 0,
            },
          ],
          scopes: [],
          branches: [],
          nodeId: 'gate',
          nodeType: 'approval',
          executionIndex: 0,
        } satisfies ExecutionAddress,
        nodes: [
          {
            ...common,
            workflowId: 'root',
            nodeId: 'call',
            nodeType: 'invoke',
            executionOrder: 0,
            invokedWorkflows: ['different'],
          },
          {
            ...common,
            workflowId: 'inner',
            nodeId: 'gate',
            nodeType: 'approval',
            executionOrder: 0,
            durableGate: 'approval' as const,
          },
        ],
      },
      {
        name: 'scope',
        address: {
          frames: [{ workflowId: 'root', invocation: 0 }],
          scopes: [
            {
              parentNodeId: 'owner',
              parentExecutionIndex: 0,
              scopeName: 'iteration',
              invocation: 0,
              loopIteration: 0,
            },
          ],
          branches: [],
          nodeId: 'gate',
          nodeType: 'approval',
          executionIndex: 0,
        } satisfies ExecutionAddress,
        nodes: [
          {
            ...common,
            workflowId: 'root',
            nodeId: 'owner',
            nodeType: 'owner',
            executionOrder: 0,
            scopeNames: ['different'],
          },
          {
            ...common,
            workflowId: 'root',
            nodeId: 'gate',
            nodeType: 'approval',
            executionOrder: 1,
            durableGate: 'approval' as const,
          },
        ],
      },
      {
        name: 'branch arm',
        address: {
          frames: [{ workflowId: 'root', invocation: 0 }],
          scopes: [],
          branches: [
            {
              workflowId: 'root',
              frameDepth: 0,
              nodeId: 'decision',
              executionIndex: 0,
              arm: 'success',
            },
          ],
          nodeId: 'gate',
          nodeType: 'approval',
          executionIndex: 0,
        } satisfies ExecutionAddress,
        nodes: [
          {
            ...common,
            workflowId: 'root',
            nodeId: 'decision',
            nodeType: 'decision',
            executionOrder: 0,
            branchArms: ['failure'],
          },
          {
            ...common,
            workflowId: 'root',
            nodeId: 'gate',
            nodeType: 'approval',
            executionOrder: 1,
            durableGate: 'approval' as const,
          },
        ],
      },
    ];

    for (const testCase of cases) {
      const runId = `invalid-${testCase.name}`;
      const envelope = createContinuationEnvelope({
        runId,
        gateId: durableGateId(runId, 'approval', testCase.address),
        gateKind: 'approval',
        workflowId: 'root',
        bundleDigest: `sha256:${'a'.repeat(64)}`,
        graphFingerprint: 'b'.repeat(64),
        location: testCase.address,
        state: { completed: [], variables: [], nextBoundary: testCase.address },
        receipts: [],
      });

      expect(
        decodeContinuation(envelope, {
          runId,
          workflowId: 'root',
          bundleDigest: `sha256:${'a'.repeat(64)}`,
          graphFingerprint: 'b'.repeat(64),
          graph: { nodes: testCase.nodes },
        }),
        testCase.name,
      ).toMatchObject({ accepted: false, reason: 'wrong-graph' });
    }
  });

  it('rejects a boundary address that omits its exact active compiled branch path', () => {
    const frame = [{ workflowId: 'branch-path', invocation: 0 }] as const;
    const boundary: ExecutionAddress = {
      frames: frame,
      scopes: [],
      branches: [],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const runId = 'omitted-branch-path-run';
    const envelope = createContinuationEnvelope({
      runId,
      gateId: durableGateId(runId, 'approval', boundary),
      gateKind: 'approval',
      workflowId: 'branch-path',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: boundary,
      state: { completed: [], variables: [], nextBoundary: boundary },
      receipts: [],
    });
    const common = {
      workflowId: 'branch-path',
      inputPorts: [] as const,
      outputPorts: [] as const,
      scopeNames: [] as const,
      invokedWorkflows: [] as const,
    };
    const successPath = [{ nodeId: 'decision', arm: 'success' }] as const;

    expect(
      decodeContinuation(envelope, {
        runId,
        workflowId: 'branch-path',
        bundleDigest: `sha256:${'a'.repeat(64)}`,
        graphFingerprint: 'b'.repeat(64),
        graph: {
          nodes: [
            {
              ...common,
              nodeId: 'decision',
              nodeType: 'decision',
              executionOrder: 0,
              branchArms: ['success', 'failure'],
              branchPath: [],
              predecessors: [],
            },
            {
              ...common,
              nodeId: 'pure',
              nodeType: 'pureNode',
              executionOrder: 1,
              branchArms: [],
              branchPath: successPath,
              predecessors: [{ nodeId: 'decision', branchPath: [] }],
            },
            {
              ...common,
              nodeId: 'gate',
              nodeType: 'approval',
              executionOrder: 2,
              branchArms: [],
              branchPath: successPath,
              predecessors: [
                { nodeId: 'decision', branchPath: [] },
                { nodeId: 'pure', branchPath: successPath },
              ],
              durableGate: 'approval',
            },
          ],
        },
      }),
    ).toMatchObject({ accepted: false, reason: 'wrong-graph' });
  });

  it('cannot reassign an outer recursive branch to the inner workflow frame', () => {
    const address: ExecutionAddress = {
      frames: [
        { workflowId: 'recursive', invocation: 0 },
        {
          workflowId: 'recursive',
          invocation: 0,
          callerNodeId: 'call',
          callerExecutionIndex: 0,
        },
      ],
      scopes: [],
      branches: [
        {
          workflowId: 'recursive',
          frameDepth: 0,
          nodeId: 'decision',
          executionIndex: 0,
          arm: 'success',
        },
        {
          workflowId: 'recursive',
          frameDepth: 1,
          nodeId: 'decision',
          executionIndex: 0,
          arm: 'success',
        },
      ],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const runId = 'recursive-branch-owner-run';
    const envelope = createContinuationEnvelope({
      runId,
      gateId: durableGateId(runId, 'approval', address),
      gateKind: 'approval',
      workflowId: 'recursive',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: address,
      state: { completed: [], variables: [], nextBoundary: address },
      receipts: [],
    });
    const common = {
      workflowId: 'recursive',
      inputPorts: [] as const,
      outputPorts: [] as const,
      scopeNames: [] as const,
      parentScope: undefined,
      predecessors: [] as const,
    };
    const successPath = [{ nodeId: 'decision', arm: 'success' }] as const;
    const graph = {
      nodes: [
        {
          ...common,
          nodeId: 'decision',
          nodeType: 'decision',
          executionOrder: 0,
          invokedWorkflows: [],
          branchArms: ['success'],
          branchPath: [],
        },
        {
          ...common,
          nodeId: 'call',
          nodeType: 'recursive',
          executionOrder: 1,
          invokedWorkflows: ['recursive'],
          branchArms: [],
          branchPath: successPath,
        },
        {
          ...common,
          nodeId: 'gate',
          nodeType: 'approval',
          executionOrder: 2,
          invokedWorkflows: [],
          branchArms: [],
          branchPath: successPath,
          durableGate: 'approval' as const,
        },
      ],
    };

    expect(
      decodeContinuation(envelope, {
        runId,
        workflowId: 'recursive',
        bundleDigest: `sha256:${'a'.repeat(64)}`,
        graphFingerprint: 'b'.repeat(64),
        graph,
      }),
    ).toMatchObject({ accepted: true });

    const mutations: Array<(location: ExecutionAddress) => void> = [
      (location) => {
        (location as { branches: ExecutionAddress['branches'] }).branches = [
          location.branches[1],
        ];
      },
      (location) => {
        (
          location.frames.at(-1) as { invocation: number }
        ).invocation = 7;
      },
      (location) => {
        (
          location.frames.at(-1) as { callerExecutionIndex: number }
        ).callerExecutionIndex = 7;
      },
      (location) => {
        (location as { executionIndex: number }).executionIndex = 7;
      },
      (location) => {
        (
          location.branches.at(-1) as { executionIndex: number }
        ).executionIndex = 7;
      },
    ];
    for (const mutate of mutations) {
      const forgedLocation = JSON.parse(
        JSON.stringify(address),
      ) as ExecutionAddress;
      mutate(forgedLocation);
      const forged = {
        ...envelope,
        gateId: durableGateId(runId, 'approval', forgedLocation),
        location: forgedLocation,
        state: { ...envelope.state, nextBoundary: forgedLocation },
        checksum: '',
      };
      forged.checksum = continuationChecksum(forged);
      expect(
        decodeContinuation(forged, {
          runId,
          workflowId: 'recursive',
          bundleDigest: `sha256:${'a'.repeat(64)}`,
          graphFingerprint: 'b'.repeat(64),
          graph,
        }),
      ).toMatchObject({ accepted: false, reason: 'wrong-graph' });
    }
  });

  it.each(['approval', 'input', 'agent'] as const)(
    'produces a terminal %s yield object rather than retaining a waiter',
    (kind) => {
    const runtime = createWorkflowRuntime({
      runId: `terminal-${kind}-yield-run`,
      workflowId: 'portable',
    });
    expect(() =>
      runtime.durable.resolveGate(runtime, {
        kind,
        nodeId: kind,
        nodeType: `request${kind}`,
        executionIndex: 0,
        payload: { prompt: 'value' },
      }),
    ).toThrow(DurableGateYield);
    },
  );

  it('rejects raw structural envelopes at the public runtime factory', () => {
    const address: ExecutionAddress = {
      frames: [{ workflowId: 'raw', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const raw = createContinuationEnvelope({
      runId: 'raw-run',
      gateId: durableGateId('raw-run', 'approval', address),
      gateKind: 'approval',
      workflowId: 'raw',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: address,
      state: { completed: [], variables: [], nextBoundary: address },
      receipts: [],
    });

    expect(() =>
      createWorkflowRuntime({
        runId: 'raw-run',
        workflowId: 'raw',
        continuation: raw as never,
      }),
    ).toThrow(/successful decodeContinuation/);
  });

  it('binds accepted continuations to the public runtime run and root workflow', () => {
    const address: ExecutionAddress = {
      frames: [{ workflowId: 'bound', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const runId = 'bound-run';
    const raw = createContinuationEnvelope({
      runId,
      gateId: durableGateId(runId, 'approval', address),
      gateKind: 'approval',
      workflowId: 'bound',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: address,
      state: { completed: [], variables: [], nextBoundary: address },
      receipts: [],
    });
    const decoded = decodeContinuation(raw, {
      runId,
      workflowId: 'bound',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      graph: graphForAddress(address),
    });
    if (!decoded.accepted) throw new Error(decoded.message);
    const predecessorEffect = vi.fn();

    expect(
      () =>
        new DurableExecution(
          'different-run',
          'bound',
          decoded.envelope,
        ),
    ).toThrow(/another run/);
    expect(() =>
      createWorkflowRuntime({
        runId,
        workflowId: 'different-workflow',
        continuation: decoded.envelope,
      }),
    ).toThrow(/another workflow/);
    expect(predecessorEffect).not.toHaveBeenCalled();
  });

  it('clones and freezes accepted continuation state before public runtime use', () => {
    const address: ExecutionAddress = {
      frames: [{ workflowId: 'immutable', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const injected: ExecutionAddress = {
      ...address,
      nodeId: 'injected',
      nodeType: 'pureNode',
    };
    const runId = 'immutable-run';
    const raw = createContinuationEnvelope({
      runId,
      gateId: durableGateId(runId, 'approval', address),
      gateKind: 'approval',
      workflowId: 'immutable',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: address,
      state: { completed: [], variables: [], nextBoundary: address },
      receipts: [],
    });
    const decoded = decodeContinuation(raw, {
      runId,
      workflowId: 'immutable',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      graph: graphForAddress(address),
    });
    if (!decoded.accepted) throw new Error(decoded.message);

    (raw.state.completed as ExecutionAddress[]).push(injected);
    expect(decoded.envelope.state.completed).toEqual([]);
    expect(Object.isFrozen(decoded.envelope.state.completed)).toBe(true);
    expect(() =>
      (decoded.envelope.state.completed as ExecutionAddress[]).push(injected),
    ).toThrow();

    const runtime = createWorkflowRuntime({
      runId,
      workflowId: 'immutable',
      continuation: decoded.envelope,
    });
    expect(runtime.durable.shouldExecute(injected)).toBe(true);
  });

  it('clones and freezes a gate resolution at the public runtime boundary', () => {
    const address: ExecutionAddress = {
      frames: [{ workflowId: 'immutable-resolution', invocation: 0 }],
      scopes: [],
      branches: [],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const runId = 'immutable-resolution-run';
    const gateId = durableGateId(runId, 'approval', address);
    const raw = createContinuationEnvelope({
      runId,
      gateId,
      gateKind: 'approval',
      workflowId: 'immutable-resolution',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: address,
      state: { completed: [], variables: [], nextBoundary: address },
      receipts: [],
    });
    const decoded = decodeContinuation(raw, {
      runId,
      workflowId: 'immutable-resolution',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      graph: graphForAddress(address),
    });
    if (!decoded.accepted) throw new Error(decoded.message);
    const resolution = { gateId, value: { approved: true } };
    const runtime = createWorkflowRuntime({
      runId,
      workflowId: 'immutable-resolution',
      continuation: decoded.envelope,
      resolution,
    });

    resolution.value.approved = false;
    expect(() =>
      Object.assign((runtime.durable as unknown as { resolution: object }).resolution, {
        gateId: '0'.repeat(64),
      }),
    ).toThrow();
    expect(
      runtime.durable.resolveGate(runtime, {
        kind: 'approval',
        nodeId: 'gate',
        nodeType: 'approval',
        executionIndex: 0,
        payload: {},
      }),
    ).toEqual({ approved: true });
  });

  it('cannot finalize a resume that did not consume its resolution exactly once', () => {
    const address: ExecutionAddress = {
      frames: [{ workflowId: 'skip', invocation: 0 }],
      scopes: [],
      branches: [
        {
          workflowId: 'skip',
          frameDepth: 0,
          nodeId: 'decision',
          executionIndex: 0,
          arm: 'success',
        },
      ],
      nodeId: 'gate',
      nodeType: 'approval',
      executionIndex: 0,
    };
    const runId = 'unconsumed-run';
    const gateId = durableGateId(runId, 'approval', address);
    const raw = createContinuationEnvelope({
      runId,
      gateId,
      gateKind: 'approval',
      workflowId: 'skip',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      location: address,
      state: { completed: [], variables: [], nextBoundary: address },
      receipts: [],
    });
    const decoded = decodeContinuation(raw, {
      runId,
      workflowId: 'skip',
      bundleDigest: `sha256:${'a'.repeat(64)}`,
      graphFingerprint: 'b'.repeat(64),
      gateId,
      graph: graphForAddress(address),
    });
    if (!decoded.accepted) throw new Error(decoded.message);
    const runtime = createWorkflowRuntime({
      runId,
      workflowId: 'skip',
      continuation: decoded.envelope,
      resolution: { gateId, value: { approved: true } },
    });

    expect(() => runtime.durable.assertResumeResolutionConsumed()).toThrowError(
      expect.objectContaining({ name: 'UnconsumedGateResolutionError' }),
    );
  });

  it('keeps live debug promises outside the durable gate contract', () => {
    expect(() =>
      storeDebugSession({
        debugId: 'not-durable',
        filePath: '/tmp/workflow.ts',
        controller: {} as never,
        executionPromise: Promise.resolve(),
        createdAt: 0,
        tmpFiles: [],
        continuation: {},
      } as never),
    ).toThrow(/cannot retain durable continuation or gate state/);
  });

  it('enforces every aggregate wire bound and forbidden JavaScript category', () => {
    for (const value of [
      undefined,
      1n,
      Symbol('x'),
      () => undefined,
      Number.NaN,
      new Date(),
      Object.assign(Object.create({ inherited: true }), { own: true }),
    ]) {
      expect(() => validateWireValue(value)).toThrow();
    }

    const sparse = new Array(2);
    sparse[1] = 'value';
    expect(() => validateWireValue(sparse)).toThrow(/sparse array/);
    const symbolProperty = { value: true };
    Object.defineProperty(symbolProperty, Symbol('hidden'), { value: true });
    expect(() => validateWireValue(symbolProperty)).toThrow(/symbol property/);
    const nonEnumerable = {};
    Object.defineProperty(nonEnumerable, 'hidden', { value: true });
    expect(() => validateWireValue(nonEnumerable)).toThrow(/non-enumerable/);

    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => validateWireValue(cycle)).toThrow(/cycle or repeated object/);

    let deep: unknown = null;
    for (let index = 0; index <= MAX_CONTINUATION_DEPTH; index++) deep = [deep];
    expect(() => validateWireValue(deep)).toThrow(/maximum depth/);

    expect(() =>
      validateWireValue('x'.repeat(MAX_CONTINUATION_STRING_BYTES + 1)),
    ).toThrow(/maximum string size/);
    expect(() =>
      validateWireValue(Array.from({ length: MAX_CONTINUATION_ENTRIES }, () => null)),
    ).toThrow(/aggregate entry limit/);

    expect(
      decodeContinuation(' '.repeat(MAX_CONTINUATION_BYTES + 1), {
        runId: 'oversized',
        workflowId: 'oversized',
        bundleDigest: `sha256:${'a'.repeat(64)}`,
        graphFingerprint: 'b'.repeat(64),
        graph: { nodes: [] },
      }),
    ).toMatchObject({ accepted: false, reason: 'oversized' });
  });
});
