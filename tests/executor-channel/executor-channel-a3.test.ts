import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ExecutorChannelLimitError,
  ExecutorChannelWireError,
  ExecutorReplayError,
  ExecutorSessionError,
  ExecutorSessionMachine,
  ExecutorAuthenticationInbox,
  DurableReplayLedger,
  InboundReplayCursor,
  GenericInvocationMachine,
  ExecutorCorrelationLedger,
  GenericInvocationProtocolError,
  decodeExecutorChannelFrame,
  encodeExecutorChannelFrame,
  canonicalExecutorChannelMessage,
  canonicalExecutorChannelWireValue,
  assertExecutorChannelDirection,
  negotiateExecutorChannelLimits,
  assertCredentialAuthenticatedWssEndpoint,
  loadExecutorAuthorization,
  openCredentialAuthenticatedWss,
  verifySealedFlowWeaverBundle,
  assertVerifiedFlowWeaverBundle,
  acceptVerifiedFlowWeaverInvocation,
  FlowWeaverBundleRefusalError,
  type ExecutorChannelFrame,
  type SealedFlowWeaverBundleDescriptor,
} from "../../src/executor-channel/index.js";
import {
  createContinuationEnvelope,
  decodeContinuation,
  durableGateId,
  GENERATOR_ABI,
  type AcceptedContinuationEnvelope,
  type ContinuationCompatibility,
  type ContinuationEnvelope,
  type ContinuationGraphCompatibility,
  type ExecutionAddress,
} from "../../src/runtime/continuation.js";
import { VERSION } from "../../src/generated-version.js";

function frame(
  overrides: Partial<ExecutorChannelFrame> = {},
): ExecutorChannelFrame {
  const generation = overrides.generation ?? 4;
  const sequence = overrides.sequence ?? 1;
  return {
    formatVersion: 1,
    generation,
    connectionEpoch: 2,
    sequence,
    messageId: `g${generation}:s${sequence}:message`,
    kind: "invocation.event",
    correlationId: "message:offer",
    invocationId: "invocation:1",
    attemptId: "attempt:1",
    payload: { eventId: "event:1", name: "progress", value: { value: 1 } },
    ...overrides,
  };
}

function acknowledgementFrame(
  connectionEpoch: number,
  sequence = 1,
  throughSequence = 0,
): ExecutorChannelFrame {
  return {
    formatVersion: 1,
    generation: 4,
    connectionEpoch,
    sequence,
    messageId: `g4:s${sequence}:ack`,
    kind: "ack",
    payload: { throughSequence },
  };
}

function invocationOffer(
  overrides: Partial<ExecutorChannelFrame> = {},
): ExecutorChannelFrame {
  return frame({
    kind: "invocation.offer",
    payload: {
      idempotencyKey: "operation:1",
      deadline: "2026-07-27T02:00:00.000Z",
      authority: {
        bindingId: "binding:1",
        providerId: "provider:1",
        interfaceId: "executor.generic",
        interfaceVersion: "1",
        method: "invoke",
        authorityDigest: `sha256:${"a".repeat(64)}`,
        executionEpoch: 7,
      },
      input: {},
    },
    ...overrides,
  });
}

function recoveryFrame(
  kind: "recovery.request" | "recovery.state",
  connectionEpoch: number,
  sequence: number,
  correlationId: string,
  receivedThrough = 0,
): ExecutorChannelFrame {
  return {
    formatVersion: 1,
    generation: 4,
    connectionEpoch,
    sequence,
    messageId: `g4:s${sequence}:${kind}`,
    kind,
    correlationId,
    payload:
      kind === "recovery.request"
        ? { receivedThrough, sentThrough: sequence }
        : {
            receivedThrough,
            sentThrough: sequence,
            activeAttempts: [],
          },
  };
}

function descriptor(bytes: Uint8Array): SealedFlowWeaverBundleDescriptor {
  return {
    formatVersion: 1,
    bundleDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    byteLength: bytes.byteLength,
    engineVersion: VERSION,
    generatorAbi: GENERATOR_ABI,
    entryWorkflowId: "invoiceDispatch",
    signature: {
      algorithm: "ed25519",
      keyId: "release-key-1",
      value: Buffer.alloc(64, 0xa5).toString("base64url"),
    },
  };
}

function acceptedContinuation(
  sealed: SealedFlowWeaverBundleDescriptor,
): AcceptedContinuationEnvelope {
  const fixture = continuationFixture(sealed);
  const decoded = decodeContinuation(fixture.envelope, fixture.compatibility);
  if (!decoded.accepted) {
    throw new Error(`test continuation was refused: ${decoded.reason}`);
  }
  return decoded.envelope;
}

function continuationFixture(sealed: SealedFlowWeaverBundleDescriptor): {
  envelope: ContinuationEnvelope;
  compatibility: ContinuationCompatibility;
} {
  const runId = "invocation:1";
  const workflowId = sealed.entryWorkflowId;
  const start: ExecutionAddress = {
    frames: [{ workflowId, invocation: 0 }],
    scopes: [],
    branches: [],
    nodeId: "Start",
    nodeType: "Start",
    executionIndex: 0,
  };
  const gate: ExecutionAddress = {
    frames: [{ workflowId, invocation: 0 }],
    scopes: [],
    branches: [],
    nodeId: "approval",
    nodeType: "waitForApproval",
    executionIndex: 0,
  };
  const graph: ContinuationGraphCompatibility = {
    nodes: [
      {
        workflowId,
        nodeId: "Start",
        nodeType: "Start",
        executionOrder: -1,
        inputPorts: [],
        outputPorts: [],
        scopeNames: [],
        invokedWorkflows: [],
        branchArms: [],
        branchPath: [],
        predecessors: [],
      },
      {
        workflowId,
        nodeId: "approval",
        nodeType: "waitForApproval",
        executionOrder: 0,
        inputPorts: [],
        outputPorts: ["approved"],
        scopeNames: [],
        invokedWorkflows: [],
        branchArms: [],
        branchPath: [],
        predecessors: [{ nodeId: "Start", branchPath: [] }],
        durableGate: "approval",
      },
    ],
  };
  const graphFingerprint = "b".repeat(64);
  const envelope = createContinuationEnvelope({
    runId,
    gateId: durableGateId(runId, "approval", gate),
    gateKind: "approval",
    workflowId,
    bundleDigest: sealed.bundleDigest,
    graphFingerprint,
    location: gate,
    state: {
      completed: [start],
      variables: [],
      nextBoundary: gate,
    },
    receipts: [],
    createdAt: "2026-07-27T02:00:00.000Z",
  });
  return {
    envelope,
    compatibility: {
      runId,
      workflowId,
      bundleDigest: sealed.bundleDigest,
      graphFingerprint,
      graph,
    },
  };
}

describe("A3 executor channel wire contract", () => {
  it("round-trips one strict frozen format-1 frame", () => {
    const encoded = encodeExecutorChannelFrame(frame());
    const decoded = decodeExecutorChannelFrame(encoded);

    expect(decoded).toEqual(frame());
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.payload)).toBe(true);
  });

  it("refuses unknown envelope fields, unknown kinds, invalid UTF-8, and non-finite encode values", () => {
    const unknown = new TextEncoder().encode(
      JSON.stringify({ ...frame(), workflowId: "domain-leak" }),
    );
    expect(() => decodeExecutorChannelFrame(unknown)).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );

    expect(() =>
      decodeExecutorChannelFrame(
        new TextEncoder().encode(
          JSON.stringify({ ...frame(), kind: "run.started" }),
        ),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "unknown-kind",
      }),
    );
    expect(() =>
      decodeExecutorChannelFrame(Uint8Array.from([0xc3, 0x28])),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    expect(() =>
      encodeExecutorChannelFrame({
        ...frame(),
        payload: {
          eventId: "event:1",
          name: "progress",
          value: Number.NaN,
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    const duplicateMember = new TextDecoder()
      .decode(encodeExecutorChannelFrame(frame()))
      .replace('"generation":4', '"generation":4,"generation":5');
    expect(() =>
      decodeExecutorChannelFrame(new TextEncoder().encode(duplicateMember)),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
  });

  it("never invokes accessors while validating outbound values", () => {
    const getter = vi.fn(() => "secret");
    const payload = {};
    Object.defineProperty(payload, "value", {
      enumerable: true,
      get: getter,
    });

    expect(() =>
      encodeExecutorChannelFrame({
        ...frame(),
        payload,
      } as ExecutorChannelFrame),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(() => canonicalExecutorChannelWireValue(payload)).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    expect(getter).not.toHaveBeenCalled();

    const sparse = Array(1) as unknown[];
    expect(() =>
      encodeExecutorChannelFrame({
        ...frame(),
        payload: {
          eventId: "event:1",
          name: "progress",
          value: sparse,
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );

    const symbolPayload = { value: true };
    Object.defineProperty(symbolPayload, Symbol("hidden"), {
      enumerable: true,
      value: "secret",
    });
    expect(() =>
      encodeExecutorChannelFrame({
        ...frame(),
        payload: {
          eventId: "event:1",
          name: "progress",
          value: symbolPayload,
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
  });

  it("carries a full 1 MiB continuation-class payload inside the default 2 MiB frame", () => {
    const chunk = "x".repeat(210 * 1024);
    const encoded = encodeExecutorChannelFrame(
      frame({
        kind: "invocation.suspended",
        payload: {
          suspensionId: "suspension:1",
          value: { continuation: [chunk, chunk, chunk, chunk, chunk] },
        },
      }),
    );

    expect(encoded.byteLength).toBeGreaterThan(1024 * 1024);
    expect(encoded.byteLength).toBeLessThan(
      EXECUTOR_CHANNEL_FORMAT_1_LIMITS.maxFrameBytes,
    );
    expect(decodeExecutorChannelFrame(encoded).kind).toBe(
      "invocation.suspended",
    );
  });

  it("refuses values beyond depth, aggregate, string, and frame byte bounds", () => {
    expect(() =>
      encodeExecutorChannelFrame(
        frame({
          payload: {
            eventId: "event:1",
            name: "progress",
            value: "x".repeat(
              EXECUTOR_CHANNEL_FORMAT_1_LIMITS.maxStringBytes + 1,
            ),
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "oversized",
      }),
    );
    let nested: unknown = true;
    for (
      let depth = 0;
      depth <= EXECUTOR_CHANNEL_FORMAT_1_LIMITS.maxJsonDepth;
      depth += 1
    ) {
      nested = { nested };
    }
    expect(() =>
      encodeExecutorChannelFrame(
        frame({
          payload: {
            eventId: "event:1",
            name: "progress",
            value: nested as never,
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "oversized",
      }),
    );
    expect(() =>
      encodeExecutorChannelFrame(
        frame({
          payload: {
            eventId: "event:1",
            name: "progress",
            value: Array.from({ length: 9 }, () => "x".repeat(250 * 1024)),
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "oversized",
      }),
    );
  });

  it("canonicalizes property-reordered payloads to the same logical identity", () => {
    const left = frame({
      payload: {
        eventId: "event:1",
        name: "progress",
        value: { a: 1, b: { c: 2, d: 3 } },
      },
    });
    const right = frame({
      payload: {
        eventId: "event:1",
        name: "progress",
        value: { b: { d: 3, c: 2 }, a: 1 },
      },
    });
    expect(canonicalExecutorChannelMessage(left)).toBe(
      canonicalExecutorChannelMessage(right),
    );
  });

  it("enforces the closed generic offer and completion payload schemas", () => {
    const offer = frame({
      kind: "invocation.offer",
      payload: {
        idempotencyKey: "operation:1",
        deadline: "2026-07-27T02:00:00.000Z",
        authority: {
          bindingId: "binding:1",
          providerId: "provider:1",
          interfaceId: "executor.generic",
          interfaceVersion: "1",
          method: "invoke",
          authorityDigest: `sha256:${"a".repeat(64)}`,
          executionEpoch: 7,
        },
        input: { value: true },
      },
    });
    expect(() => encodeExecutorChannelFrame(offer)).not.toThrow();
    expect(() =>
      assertExecutorChannelDirection(offer, "executor-to-host"),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "wrong-direction",
      }),
    );
    expect(() =>
      assertExecutorChannelDirection(offer, "host-to-executor"),
    ).not.toThrow();
    expect(() =>
      assertExecutorChannelDirection(offer, "forged" as never),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "wrong-direction",
      }),
    );
    const { correlationId: _missingCorrelation, ...uncorrelatedOffer } = offer;
    expect(() =>
      encodeExecutorChannelFrame(uncorrelatedOffer as ExecutorChannelFrame),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );

    expect(() =>
      encodeExecutorChannelFrame({
        formatVersion: 1,
        generation: 4,
        connectionEpoch: 2,
        sequence: 1,
        messageId: "g4:s1:recovery",
        kind: "recovery.request",
        payload: { receivedThrough: 0, sentThrough: 0 },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    expect(() =>
      encodeExecutorChannelFrame(
        recoveryFrame("recovery.state", 2, 1, "recovery:cursor", 0),
      ),
    ).not.toThrow();
    expect(() =>
      encodeExecutorChannelFrame({
        ...recoveryFrame("recovery.state", 2, 1, "recovery:cursor", 0),
        payload: {
          receivedThrough: 0,
          sentThrough: 100,
          activeAttempts: [],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    expect(() =>
      encodeExecutorChannelFrame(
        frame({
          kind: "invocation.cancel",
          payload: {
            reason: "stop",
            graceMs: EXECUTOR_CHANNEL_FORMAT_1_LIMITS.cancellationGraceMs + 1,
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "oversized",
      }),
    );
    expect(() =>
      encodeExecutorChannelFrame({
        ...offer,
        payload: { ...(offer.payload as object), workflowId: "leak" },
      } as ExecutorChannelFrame),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );

    expect(() =>
      encodeExecutorChannelFrame(
        frame({
          kind: "invocation.completed",
          payload: {
            status: "failed",
            result: { falselySuccessful: true },
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    expect(() =>
      encodeExecutorChannelFrame(
        frame({
          kind: "invocation.completed",
          payload: {
            status: "failed",
            error: {
              code: "executor-dead",
              message: "executor process ended before a terminal result",
              retryable: false,
            },
          },
        }),
      ),
    ).not.toThrow();

    const activeAttempt = {
      invocationId: "invocation:1",
      attemptId: "attempt:1",
      state: "active",
      lastEventSequence: 1,
    };
    expect(() =>
      encodeExecutorChannelFrame(
        frame({
          kind: "recovery.state",
          correlationId: "recovery:1",
          invocationId: undefined,
          attemptId: undefined,
          payload: {
            receivedThrough: 0,
            sentThrough: 1,
            activeAttempts: [activeAttempt, activeAttempt],
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
  });

  it("negotiates limits only downward and keeps lease timing coherent", () => {
    expect(
      negotiateExecutorChannelLimits({ maxInFlightInvocations: 8 }),
    ).toMatchObject({ maxInFlightInvocations: 8 });
    expect(() =>
      negotiateExecutorChannelLimits({
        maxFrameBytes: EXECUTOR_CHANNEL_FORMAT_1_LIMITS.maxFrameBytes + 1,
      }),
    ).toThrow(ExecutorChannelLimitError);
    expect(() =>
      negotiateExecutorChannelLimits({
        heartbeatIntervalMs: 20_000,
        leaseDurationMs: 30_000,
      }),
    ).toThrow(ExecutorChannelLimitError);
    expect(() =>
      negotiateExecutorChannelLimits({ maxFrameBytes: 512 }),
    ).toThrow(ExecutorChannelLimitError);
    expect(() =>
      negotiateExecutorChannelLimits({ maxReplayBytes: 1024 * 1024 }),
    ).toThrow(ExecutorChannelLimitError);
    expect(() =>
      negotiateExecutorChannelLimits(
        {},
        {
          ...EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
          maxStringBytes: EXECUTOR_CHANNEL_FORMAT_1_LIMITS.maxStringBytes + 1,
        },
      ),
    ).toThrow(ExecutorChannelLimitError);
    expect(() =>
      encodeExecutorChannelFrame(frame(), {
        ...EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
        maxFrameBytes: 8 * 1024 * 1024,
      }),
    ).toThrow(ExecutorChannelLimitError);
    expect(
      () =>
        new DurableReplayLedger({
          ...EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
          maxReplayFrames: EXECUTOR_CHANNEL_FORMAT_1_LIMITS.maxReplayFrames + 1,
        }),
    ).toThrow(ExecutorChannelLimitError);
    const deploymentPolicy = negotiateExecutorChannelLimits(
      {},
      {
        ...EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
        maxFrameBytes: 4 * 1024 * 1024,
      },
    );
    const deploymentFrame = encodeExecutorChannelFrame(
      frame({
        payload: {
          eventId: "event:1",
          name: "progress",
          value: Array.from({ length: 13 }, () => "x".repeat(250 * 1024)),
        },
      }),
      deploymentPolicy,
    );
    expect(deploymentFrame.byteLength).toBeGreaterThan(2 * 1024 * 1024);
    expect(
      decodeExecutorChannelFrame(deploymentFrame, deploymentPolicy).kind,
    ).toBe("invocation.event");
    const oversizedRaw = new Uint8Array(
      EXECUTOR_CHANNEL_FORMAT_1_LIMITS.maxFrameBytes + 1,
    );
    Object.defineProperty(oversizedRaw, "byteLength", {
      enumerable: true,
      value: 1,
    });
    expect(() => decodeExecutorChannelFrame(oversizedRaw)).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "oversized",
      }),
    );
    const clamped = new Uint8ClampedArray(encodeExecutorChannelFrame(frame()));
    expect(() => decodeExecutorChannelFrame(clamped as never)).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
  });
});

describe("A3 session, generation, connection epoch, and replay contract", () => {
  it("publishes only authenticated sessions and fences stale socket frames", async () => {
    const machine = new ExecutorSessionMachine();
    const identity = {
      deploymentId: "deployment:1",
      consoleId: "console:1",
      executorId: "executor:1",
      generation: 4,
      connectionEpoch: 2,
      protocolVersion: 1 as const,
      supportedInterfaceVersions: ["executor.generic:1"],
      supportedEngineRanges: ["flow-weaver:0.35.0"],
      transportIdentityDigest: `sha256:${"a".repeat(64)}` as const,
      leaseExpiresAt: "2026-07-27T02:00:00.000Z",
    };
    expect(() =>
      machine.publish(
        identity,
        {} as never,
        Date.parse("2026-07-27T01:59:45.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "illegal-transition",
      }),
    );

    machine.transition("authenticating");
    expect(() =>
      machine.publish(
        identity,
        {} as never,
        Date.parse("2026-07-27T01:59:45.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "unauthenticated-transport",
      }),
    );
    const transport = await openCredentialAuthenticatedWss(
      "wss://executor.example/channel",
      {
        getAuthorizationHeader: async () =>
          "Bearer executor-credential-with-sufficient-entropy",
      },
      {
        authenticate: async () => ({
          peerIdentityDigest: identity.transportIdentityDigest,
        }),
      },
    );
    machine.publish(
      identity,
      transport,
      Date.parse("2026-07-27T01:59:45.000Z"),
    );
    expect(() => machine.activate()).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "recovery-required",
      }),
    );
    const inboundCursor = new InboundReplayCursor();
    const outboundCursor = new InboundReplayCursor();
    const correlations = new ExecutorCorrelationLedger();
    const outbox = new DurableReplayLedger();
    machine.admitFrame(
      encodeExecutorChannelFrame(
        recoveryFrame("recovery.request", 2, 1, "recovery:epoch:2"),
      ),
      "host-to-executor",
      outboundCursor,
      correlations,
      outbox,
      Date.parse("2026-07-27T01:59:49.000Z"),
    );
    machine.admitFrame(
      encodeExecutorChannelFrame(
        recoveryFrame("recovery.state", 2, 1, "recovery:epoch:2"),
      ),
      "executor-to-host",
      inboundCursor,
      correlations,
      outbox,
      Date.parse("2026-07-27T01:59:49.000Z"),
    );
    machine.activate();
    class HostileCursor extends InboundReplayCursor {
      override accept(): never {
        throw new Error("hostile override");
      }
    }
    expect(() =>
      machine.admitFrame(
        encodeExecutorChannelFrame(acknowledgementFrame(2, 2)),
        "executor-to-host",
        new HostileCursor(),
        correlations,
        outbox,
        Date.parse("2026-07-27T01:59:50.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "malformed-session",
      }),
    );
    expect(machine.state).toBe("active");

    const restoredSession = ExecutorSessionMachine.hydrate(
      JSON.parse(JSON.stringify(machine.snapshot())),
    );
    expect(restoredSession.state).toBe("authenticating");
    expect(restoredSession.identity).toEqual(identity);
    const restoredTransport = await openCredentialAuthenticatedWss(
      "wss://executor.example/channel",
      {
        getAuthorizationHeader: async () =>
          "Bearer executor-credential-with-sufficient-entropy",
      },
      {
        authenticate: async () => ({
          peerIdentityDigest: identity.transportIdentityDigest,
        }),
      },
    );
    expect(() =>
      restoredSession.publish(
        identity,
        restoredTransport,
        Date.parse("2026-07-27T01:59:50.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "stale-session",
      }),
    );
    restoredSession.publish(
      {
        ...identity,
        connectionEpoch: 3,
        leaseExpiresAt: "2026-07-27T02:00:10.000Z",
      },
      restoredTransport,
      Date.parse("2026-07-27T01:59:50.000Z"),
    );
    expect(restoredSession.state).toBe("recovering");

    correlations.accept(
      invocationOffer(),
      "host-to-executor",
      Date.parse("2026-07-27T01:59:49.000Z"),
    );
    correlations.accept(
      frame({
        kind: "invocation.accepted",
        payload: { acceptedAt: "2026-07-27T01:59:49.000Z" },
      }),
      "executor-to-host",
      Date.parse("2026-07-27T01:59:49.000Z"),
    );
    const acknowledgedTerminal = frame({
      kind: "invocation.completed",
      payload: { status: "succeeded", result: true },
    });
    correlations.accept(
      acknowledgedTerminal,
      "executor-to-host",
      Date.parse("2026-07-27T01:59:49.000Z"),
    );
    outbox.append(acknowledgedTerminal, Date.parse("2026-07-27T01:59:49.000Z"));

    expect(() =>
      machine.admitFrame(
        encodeExecutorChannelFrame(acknowledgementFrame(2)),
        "executor-to-host",
        new InboundReplayCursor(
          negotiateExecutorChannelLimits({ maxEventRatePerSecond: 100 }),
        ),
        correlations,
        outbox,
        Date.parse("2026-07-27T01:59:50.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "wrong-policy",
      }),
    );
    machine.admitFrame(
      encodeExecutorChannelFrame(acknowledgementFrame(2, 2, 1)),
      "executor-to-host",
      inboundCursor,
      correlations,
      outbox,
      Date.parse("2026-07-27T01:59:50.000Z"),
    );
    expect(correlations.state("message:offer")).toBeUndefined();
    expect(() =>
      machine.admitFrame(
        encodeExecutorChannelFrame(acknowledgementFrame(1, 3)),
        "executor-to-host",
        inboundCursor,
        correlations,
        outbox,
        Date.parse("2026-07-27T01:59:50.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "stale-session",
      }),
    );
    expect(() =>
      machine.renewLease(
        4,
        1,
        "2026-07-27T02:00:10.000Z",
        Date.parse("2026-07-27T01:59:50.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "stale-session",
      }),
    );
    machine.renewLease(
      4,
      2,
      "2026-07-27T02:00:10.000Z",
      Date.parse("2026-07-27T01:59:50.000Z"),
    );
    machine.transition("authenticating");
    expect(machine.snapshot().reconciliationComplete).toBe(false);
    expect(
      ExecutorSessionMachine.hydrate(
        JSON.parse(JSON.stringify(machine.snapshot())),
      ).state,
    ).toBe("authenticating");
    expect(() =>
      machine.publish(
        {
          ...identity,
          connectionEpoch: 3,
          leaseExpiresAt: "2026-07-27T02:00:20.000Z",
        },
        transport,
        Date.parse("2026-07-27T01:59:55.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "transport-reused",
      }),
    );
    const replacementTransport = await openCredentialAuthenticatedWss(
      "wss://executor.example/channel",
      {
        getAuthorizationHeader: async () =>
          "Bearer executor-credential-with-sufficient-entropy",
      },
      {
        authenticate: async () => ({
          peerIdentityDigest: identity.transportIdentityDigest,
        }),
      },
    );
    expect(() =>
      machine.publish(
        {
          ...identity,
          consoleId: "console:other",
          connectionEpoch: 3,
          leaseExpiresAt: "2026-07-27T02:00:20.000Z",
        },
        replacementTransport,
        Date.parse("2026-07-27T01:59:55.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "cross-session",
      }),
    );
    machine.publish(
      {
        ...identity,
        connectionEpoch: 3,
        leaseExpiresAt: "2026-07-27T02:00:20.000Z",
      },
      replacementTransport,
      Date.parse("2026-07-27T01:59:55.000Z"),
    );
    machine.admitFrame(
      encodeExecutorChannelFrame(
        recoveryFrame("recovery.request", 3, 2, "recovery:epoch:3", 1),
      ),
      "host-to-executor",
      outboundCursor,
      correlations,
      outbox,
      Date.parse("2026-07-27T01:59:55.000Z"),
    );
    machine.admitFrame(
      encodeExecutorChannelFrame(
        recoveryFrame("recovery.state", 3, 3, "recovery:epoch:3", 1),
      ),
      "executor-to-host",
      inboundCursor,
      correlations,
      outbox,
      Date.parse("2026-07-27T01:59:55.000Z"),
    );
    machine.activate();
    expect(() =>
      machine.admitFrame(
        encodeExecutorChannelFrame(acknowledgementFrame(2, 4)),
        "executor-to-host",
        inboundCursor,
        correlations,
        outbox,
        Date.parse("2026-07-27T01:59:55.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "stale-session",
      }),
    );
    machine.admitFrame(
      encodeExecutorChannelFrame(acknowledgementFrame(3, 4, 1)),
      "executor-to-host",
      inboundCursor,
      correlations,
      outbox,
      Date.parse("2026-07-27T01:59:55.000Z"),
    );
    machine.transition("draining");
    expect(() =>
      machine.admitFrame(
        encodeExecutorChannelFrame(
          invocationOffer({
            connectionEpoch: 3,
            sequence: 3,
            messageId: "g4:s3:offer",
          }),
        ),
        "host-to-executor",
        outboundCursor,
        correlations,
        outbox,
        Date.parse("2026-07-27T01:59:56.000Z"),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "draining-session",
      }),
    );
    expect(machine.state).toBe("fenced");
    const byteLengthGetter = vi.fn(() => 1);
    const hostileFrame = {};
    Object.defineProperty(hostileFrame, "byteLength", {
      enumerable: true,
      get: byteLengthGetter,
    });
    expect(() =>
      machine.admitFrame(
        hostileFrame as never,
        "executor-to-host",
        inboundCursor,
        correlations,
        outbox,
        Date.parse("2026-07-27T02:00:20.000Z"),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    expect(byteLengthGetter).not.toHaveBeenCalled();
    expect(() => machine.fenceExpiredLease(Number.NaN)).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "invalid-lease",
      }),
    );
  });

  it("refuses an authenticated acknowledgement before mutating an outbox whose event correlation is missing", async () => {
    const machine = new ExecutorSessionMachine();
    machine.transition("authenticating");
    const databaseNow = Date.parse("2026-07-27T01:59:45.000Z");
    const identity = {
      deploymentId: "deployment:atomic-ack",
      consoleId: "console:atomic-ack",
      executorId: "executor:atomic-ack",
      generation: 4,
      connectionEpoch: 2,
      protocolVersion: 1 as const,
      supportedInterfaceVersions: ["executor.generic:1"],
      supportedEngineRanges: ["flow-weaver:0.35.0"],
      transportIdentityDigest: `sha256:${"b".repeat(64)}` as const,
      leaseExpiresAt: "2026-07-27T02:00:00.000Z",
    };
    const transport = await openCredentialAuthenticatedWss(
      "wss://executor.example/channel",
      {
        getAuthorizationHeader: async () =>
          "Bearer executor-credential-with-sufficient-entropy",
      },
      {
        authenticate: async () => ({
          peerIdentityDigest: identity.transportIdentityDigest,
        }),
      },
    );
    machine.publish(identity, transport, databaseNow);

    const cursor = new InboundReplayCursor();
    cursor.accept(frame());
    const correlations = new ExecutorCorrelationLedger();
    const outbox = new DurableReplayLedger();
    outbox.append(frame(), databaseNow);
    expect(() =>
      machine.admitFrame(
        encodeExecutorChannelFrame(acknowledgementFrame(2, 2, 1)),
        "executor-to-host",
        cursor,
        correlations,
        outbox,
        databaseNow + 1,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    expect(outbox.acknowledgedThrough).toBe(0);
    expect(outbox.snapshot().records).toHaveLength(1);
    expect(machine.state).toBe("fenced");
  });

  it("retains unacknowledged logical messages and rejects cursor forgery", () => {
    const ledger = new DurableReplayLedger();
    expect(() => ledger.append(frame(), Number.NaN)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "invalid-clock",
      }),
    );
    ledger.append(frame(), 1_000);
    expect(() => ledger.append(frame({ sequence: 2 }), 999)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "invalid-clock",
      }),
    );
    expect(() =>
      ledger.append(frame({ sequence: 2, messageId: "g4:s1:message" }), 1_001),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    ledger.append(frame({ sequence: 2 }), 1_001);
    const regressedSnapshot = JSON.parse(JSON.stringify(ledger.snapshot())) as {
      lastRetainedAt: number;
      records: { retainedAt: number }[];
    };
    regressedSnapshot.records[1]!.retainedAt = 999;
    regressedSnapshot.lastRetainedAt = 999;
    expect(() => DurableReplayLedger.hydrate(regressedSnapshot)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "invalid-clock",
      }),
    );

    expect(ledger.replay(0, 1_002)).toHaveLength(2);
    expect(() => ledger.replay(0, 999)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "replay-expired",
      }),
    );
    expect(() => ledger.replay(999, 1_002)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "future-cursor",
      }),
    );
    const hydrated = DurableReplayLedger.hydrate(
      JSON.parse(JSON.stringify(ledger.snapshot())),
    );
    expect(
      hydrated.replayForConnection(0, 3, 1_002).map((item) => item.sequence),
    ).toEqual([1, 2]);
    const reconnected = ledger.replayForConnection(0, 3, 1_002);
    expect(reconnected.map((item) => item.frame.connectionEpoch)).toEqual([
      3, 3,
    ]);
    expect(reconnected[0]!.canonicalDigest).toBe(
      canonicalExecutorChannelMessage(reconnected[0]!.frame),
    );
    expect(() => ledger.assertCanAcknowledge(1, 7_000)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "ack-expired",
      }),
    );
    const recoveryLedger = DurableReplayLedger.hydrate(
      JSON.parse(JSON.stringify(ledger.snapshot())),
    );
    expect(() =>
      recoveryLedger.assertCanReconcileAcknowledgement(1, 7_000),
    ).not.toThrow();
    expect(recoveryLedger.acknowledgedThrough).toBe(0);
    const expiredRecoveryLedger = DurableReplayLedger.hydrate(
      JSON.parse(JSON.stringify(ledger.snapshot())),
    );
    expect(() =>
      expiredRecoveryLedger.assertCanReconcileAcknowledgement(
        1,
        1_000 + EXECUTOR_CHANNEL_FORMAT_1_LIMITS.replayLifetimeMs + 1,
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "replay-expired",
      }),
    );
    const acknowledgedLedger = DurableReplayLedger.hydrate({
      formatVersion: 1,
      acknowledgedThrough: 1,
      lastRetainedAt: 1_001,
      records: [{ frame: frame({ sequence: 2 }), retainedAt: 1_001 }],
    });
    expect(
      acknowledgedLedger.replay(1, 1_002).map((item) => item.sequence),
    ).toEqual([2]);
    expect(() => acknowledgedLedger.assertCanAcknowledge(3, 1_002)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "future-ack",
      }),
    );
    expect(() => acknowledgedLedger.replay(0, 1_002)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "stale-cursor",
      }),
    );

    const proofCorrelations = new ExecutorCorrelationLedger();
    proofCorrelations.accept(invocationOffer(), "host-to-executor", 1_000);
    proofCorrelations.accept(
      frame({
        kind: "invocation.accepted",
        payload: { acceptedAt: "1970-01-01T00:00:01.000Z" },
      }),
      "executor-to-host",
      1_000,
    );
    const completed = frame({
      kind: "invocation.completed",
      payload: { status: "succeeded", result: true },
    });
    proofCorrelations.accept(completed, "executor-to-host", 1_001);
    const proofOutbox = new DurableReplayLedger();
    proofOutbox.append(completed, 1_001);
    expect(proofCorrelations.state("message:offer")).toBe("completed");
    expect(() => proofOutbox.acknowledge(1, 1_002, undefined)).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "unauthorized-ack",
      }),
    );
    expect(proofOutbox.acknowledgedThrough).toBe(0);
    expect(proofCorrelations.state("message:offer")).toBe("completed");
    expect(() =>
      new ExecutorCorrelationLedger().assertCanApplyDurableAcknowledgementFrames(
        [frame()],
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    expect(() =>
      proofCorrelations.applyDurableAcknowledgement({
        kind: "executor-channel-durable-acknowledgement",
      } as never),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
  });

  it("applies an inbound sequence once, requests gaps, and quarantines conflicts", () => {
    const cursor = new InboundReplayCursor();
    expect(cursor.accept(frame())).toEqual({ kind: "apply", cursor: 1 });
    expect(cursor.accept(frame())).toEqual({ kind: "duplicate", cursor: 1 });
    expect(cursor.accept(frame({ sequence: 3 }))).toEqual({
      kind: "recover",
      expectedSequence: 2,
    });
    expect(() =>
      cursor.accept(
        frame({
          payload: {
            eventId: "event:1",
            name: "progress",
            value: { incompatible: true },
          },
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "conflicting-duplicate",
      }),
    );

    const hydrated = InboundReplayCursor.hydrate(
      JSON.parse(JSON.stringify(cursor.snapshot())),
    );
    expect(hydrated.cursor).toBe(1);
    expect(hydrated.accept(frame())).toEqual({
      kind: "duplicate",
      cursor: 1,
    });
    expect(() =>
      InboundReplayCursor.hydrate({
        ...cursor.snapshot(),
        cursor: 2,
      }),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "malformed-snapshot",
      }),
    );
    expect(() =>
      InboundReplayCursor.hydrate({
        formatVersion: 1,
        cursor: 0,
        recent: [
          {
            sequence: 0,
            messageId: "g4:s0:forged",
            digest: "a".repeat(64),
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "malformed-snapshot",
      }),
    );
    expect(() =>
      InboundReplayCursor.hydrate({
        formatVersion: 1,
        cursor: 1,
        recent: [
          {
            sequence: 1,
            messageId: `g4:s1:${"x".repeat(129)}`,
            digest: "a".repeat(64),
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorReplayError>>({
        code: "malformed-snapshot",
      }),
    );
  });

  it("structurally binds message identity to generation and sequence beyond the cursor window", () => {
    const cursor = new InboundReplayCursor(
      negotiateExecutorChannelLimits({
        recoveryBatchSize: 1,
        cursorWindow: 1,
      }),
    );
    expect(cursor.accept(frame())).toMatchObject({ kind: "apply" });
    expect(cursor.accept(frame({ sequence: 2 }))).toMatchObject({
      kind: "apply",
    });
    expect(() =>
      cursor.accept(
        frame({
          sequence: 3,
          messageId: "g4:s1:message",
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
  });

  it("bounds and clears the unauthenticated inbox before frame decoding", () => {
    const limits = negotiateExecutorChannelLimits({
      maxAuthenticationInboxFrames: 2,
      maxAuthenticationInboxBytes: 8,
    });
    const inbox = new ExecutorAuthenticationInbox(limits);
    inbox.retain(Uint8Array.from([1, 2]));
    inbox.retain(Uint8Array.from([3, 4]));
    expect(() => inbox.retain(Uint8Array.from([5]))).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "authentication-flood",
      }),
    );
    const shadowed = new Uint8Array(9);
    Object.defineProperty(shadowed, "byteLength", {
      enumerable: true,
      value: 0,
    });
    expect(() =>
      new ExecutorAuthenticationInbox(limits).retain(shadowed),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "authentication-flood",
      }),
    );

    const accepted = new ExecutorAuthenticationInbox(limits);
    accepted.retain(Uint8Array.from([1, 2]));
    expect(accepted.authenticate()).toBeUndefined();
    expect(() => accepted.retain(Uint8Array.from([3]))).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "illegal-transition",
      }),
    );
  });

  it("requires WSS and obtains credentials out of band rather than from URLs or frames", async () => {
    expect(
      assertCredentialAuthenticatedWssEndpoint("wss://executor.example/channel")
        .href,
    ).toBe("wss://executor.example/channel");
    for (const endpoint of [
      "ws://executor.example/channel",
      "wss://token@executor.example/channel",
      "wss://executor.example/channel?token=secret",
      "wss://executor.example/channel#secret",
    ]) {
      expect(() => assertCredentialAuthenticatedWssEndpoint(endpoint)).toThrow(
        expect.objectContaining<Partial<ExecutorSessionError>>({
          code: "insecure-transport",
        }),
      );
    }
    const endpointCoercion = vi.fn(() => "wss://executor.example/channel");
    expect(() =>
      assertCredentialAuthenticatedWssEndpoint({
        toString: endpointCoercion,
      } as never),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorSessionError>>({
        code: "insecure-transport",
      }),
    );
    expect(endpointCoercion).not.toHaveBeenCalled();
    await expect(
      loadExecutorAuthorization({
        getAuthorizationHeader: async () =>
          "Bearer executor-credential-with-sufficient-entropy",
      }),
    ).resolves.toMatch(/^Bearer /);
    await expect(
      loadExecutorAuthorization({
        getAuthorizationHeader: async () => "Bearer short\r\nforged: header",
      }),
    ).rejects.toMatchObject({ code: "malformed-credential" });
    const credentialCoercion = vi.fn(
      () => "Bearer executor-credential-with-sufficient-entropy",
    );
    await expect(
      loadExecutorAuthorization({
        getAuthorizationHeader: async () =>
          ({ toString: credentialCoercion }) as never,
      }),
    ).rejects.toMatchObject({ code: "malformed-credential" });
    expect(credentialCoercion).not.toHaveBeenCalled();
    await expect(
      loadExecutorAuthorization(
        {
          getAuthorizationHeader: async () =>
            "Bearer executor-credential-with-sufficient-entropy",
        },
        Object.create(AbortSignal.prototype) as AbortSignal,
      ),
    ).rejects.toMatchObject({ code: "malformed-signal" });
    const shadowedSignal = new AbortController().signal;
    const abortedGetter = vi.fn(() => false);
    Object.defineProperty(shadowedSignal, "aborted", {
      configurable: true,
      get: abortedGetter,
    });
    await expect(
      loadExecutorAuthorization(
        {
          getAuthorizationHeader: async () =>
            "Bearer executor-credential-with-sufficient-entropy",
        },
        shadowedSignal,
      ),
    ).rejects.toMatchObject({ code: "malformed-signal" });
    expect(abortedGetter).not.toHaveBeenCalled();

    const providerAbort = new AbortController();
    await expect(
      loadExecutorAuthorization(
        {
          getAuthorizationHeader: async () => {
            providerAbort.abort();
            return "Bearer executor-credential-with-sufficient-entropy";
          },
        },
        providerAbort.signal,
      ),
    ).rejects.toMatchObject({ code: "authentication-cancelled" });

    const authenticatorAbort = new AbortController();
    await expect(
      openCredentialAuthenticatedWss(
        "wss://executor.example/channel",
        {
          getAuthorizationHeader: async () =>
            "Bearer executor-credential-with-sufficient-entropy",
        },
        {
          authenticate: async () => {
            authenticatorAbort.abort();
            return {
              peerIdentityDigest: `sha256:${"a".repeat(64)}`,
            };
          },
        },
        authenticatorAbort.signal,
      ),
    ).rejects.toMatchObject({ code: "authentication-cancelled" });
    const identityGetter = vi.fn(() => `sha256:${"a".repeat(64)}`);
    await expect(
      openCredentialAuthenticatedWss(
        "wss://executor.example/channel",
        {
          getAuthorizationHeader: async () =>
            "Bearer executor-credential-with-sufficient-entropy",
        },
        {
          authenticate: async () => {
            const result = {};
            Object.defineProperty(result, "peerIdentityDigest", {
              enumerable: true,
              get: identityGetter,
            });
            return result as never;
          },
        },
      ),
    ).rejects.toMatchObject({ code: "malformed-session" });
    expect(identityGetter).not.toHaveBeenCalled();
  });
});

describe("A3 generic invocation and sealed Flow Weaver adapter contracts", () => {
  it("uses one generic invocation state machine and rejects late progress or conflicting terminals", () => {
    const offer = invocationOffer();
    const invocationNow = Date.parse("2026-07-27T01:59:00.000Z");
    const machine = new GenericInvocationMachine(
      offer,
      EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
      invocationNow,
    );
    machine.record(
      frame({
        kind: "invocation.accepted",
        payload: { acceptedAt: "2026-07-27T01:59:00.000Z" },
      }),
      invocationNow,
    );
    expect(() =>
      machine.record(
        frame({
          kind: "invocation.event",
          correlationId: "message:other-offer",
        }),
        invocationNow,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    const terminal = frame({
      kind: "invocation.completed",
      payload: { status: "succeeded", result: { value: "a" } },
    });
    expect(machine.recordTerminal(terminal, invocationNow)).toBe("applied");
    expect(machine.recordTerminal(terminal, invocationNow)).toBe("duplicate");
    expect(() =>
      machine.recordTerminal(
        frame({
          kind: "invocation.completed",
          payload: { status: "succeeded", result: { value: "b" } },
        }),
        invocationNow,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "conflicting-terminal",
      }),
    );
    expect(() =>
      machine.record(
        frame({
          kind: "invocation.event",
          payload: {
            eventId: "event:late",
            name: "progress",
            value: true,
          },
        }),
        invocationNow,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "illegal-transition",
      }),
    );
  });

  it("enforces invocation admission, concurrency, event identity, rate, and retention bounds", () => {
    const invocationNow = Date.parse("2026-07-27T01:59:00.000Z");
    const oneInFlight = negotiateExecutorChannelLimits({
      maxInFlightInvocations: 1,
    });
    const capacity = new ExecutorCorrelationLedger(oneInFlight);
    capacity.accept(invocationOffer(), "host-to-executor", invocationNow);
    expect(() =>
      capacity.accept(
        invocationOffer({
          correlationId: "message:offer:2",
          invocationId: "invocation:2",
          attemptId: "attempt:2",
          sequence: 2,
          messageId: "g4:s2:offer",
        }),
        "host-to-executor",
        invocationNow,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "capacity",
      }),
    );

    const deadline = new ExecutorCorrelationLedger();
    deadline.accept(invocationOffer(), "host-to-executor", invocationNow);
    const forgedAdmission = JSON.parse(JSON.stringify(deadline.snapshot())) as {
      correlations: {
        offerDeadline: number;
        admissionExpiresAt: number;
      }[];
    };
    forgedAdmission.correlations[0]!.offerDeadline = 999_999_999_999;
    forgedAdmission.correlations[0]!.admissionExpiresAt = 999_999_999_999;
    expect(() => ExecutorCorrelationLedger.hydrate(forgedAdmission)).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "malformed-correlation",
      }),
    );
    const forgedAcceptedSequence = JSON.parse(
      JSON.stringify(deadline.snapshot()),
    ) as {
      correlations: {
        state: string;
        lastEventSequence: number;
      }[];
    };
    forgedAcceptedSequence.correlations[0]!.state = "accepted";
    forgedAcceptedSequence.correlations[0]!.lastEventSequence = 99;
    expect(() =>
      ExecutorCorrelationLedger.hydrate(forgedAcceptedSequence),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "malformed-correlation",
      }),
    );
    expect(() =>
      deadline.accept(
        frame({
          kind: "invocation.accepted",
          payload: { acceptedAt: "2026-07-27T01:59:31.000Z" },
        }),
        "executor-to-host",
        invocationNow + 31_000,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "deadline-expired",
      }),
    );

    const ratePolicy = negotiateExecutorChannelLimits({
      maxEventRatePerSecond: 1,
    });
    const events = new ExecutorCorrelationLedger(ratePolicy);
    events.accept(invocationOffer(), "host-to-executor", invocationNow);
    events.accept(
      frame({
        kind: "invocation.accepted",
        payload: { acceptedAt: "2026-07-27T01:59:00.000Z" },
      }),
      "executor-to-host",
      invocationNow,
    );
    const firstEvent = frame();
    expect(events.accept(firstEvent, "executor-to-host", invocationNow)).toBe(
      "applied",
    );
    expect(events.accept(firstEvent, "executor-to-host", invocationNow)).toBe(
      "duplicate",
    );
    const eventSnapshot = JSON.parse(JSON.stringify(events.snapshot())) as {
      correlations: {
        retainedEventBytes: number;
        eventCount: number;
        eventWindowStartedAt: number;
      }[];
    };
    expect(() =>
      ExecutorCorrelationLedger.hydrate(eventSnapshot),
    ).not.toThrow();
    eventSnapshot.correlations[0]!.retainedEventBytes += 1;
    expect(() => ExecutorCorrelationLedger.hydrate(eventSnapshot)).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "malformed-correlation",
      }),
    );
    const forgedRateWindow = JSON.parse(JSON.stringify(events.snapshot())) as {
      correlations: {
        eventCount: number;
        eventWindowStartedAt: number;
      }[];
    };
    forgedRateWindow.correlations[0]!.eventWindowStartedAt = 0;
    expect(() => ExecutorCorrelationLedger.hydrate(forgedRateWindow)).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "malformed-correlation",
      }),
    );
    expect(() =>
      events.accept(
        frame({
          payload: {
            eventId: "event:1",
            name: "progress",
            value: { value: 2 },
          },
        }),
        "executor-to-host",
        invocationNow,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "conflicting-event",
      }),
    );
    expect(() =>
      events.accept(
        frame({
          sequence: 2,
          messageId: "g4:s2:event",
          payload: {
            eventId: "event:2",
            name: "progress",
            value: { value: 2 },
          },
        }),
        "executor-to-host",
        invocationNow,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "event-rate",
      }),
    );

    const retentionPolicy = negotiateExecutorChannelLimits({
      maxRetainedEventBytesPerInvocation: 128,
    });
    const retention = new ExecutorCorrelationLedger(retentionPolicy);
    retention.accept(invocationOffer(), "host-to-executor", invocationNow);
    retention.accept(
      frame({
        kind: "invocation.accepted",
        payload: { acceptedAt: "2026-07-27T01:59:00.000Z" },
      }),
      "executor-to-host",
      invocationNow,
    );
    expect(() =>
      retention.accept(frame(), "executor-to-host", invocationNow),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "event-retention",
      }),
    );

    const kindGetter = vi.fn(() => "invocation.offer");
    const hostileOffer = { ...invocationOffer() };
    Object.defineProperty(hostileOffer, "kind", {
      enumerable: true,
      get: kindGetter,
    });
    expect(() =>
      new ExecutorCorrelationLedger().accept(
        hostileOffer as ExecutorChannelFrame,
        "host-to-executor",
        invocationNow,
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExecutorChannelWireError>>({
        code: "malformed",
      }),
    );
    expect(kindGetter).not.toHaveBeenCalled();

    const globallyBoundedPolicy = negotiateExecutorChannelLimits({
      maxReplayFrames: 2,
      recoveryBatchSize: 1,
      cursorWindow: 2,
      maxInFlightInvocations: 2,
    });
    const globallyBounded = new ExecutorCorrelationLedger(
      globallyBoundedPolicy,
    );
    for (const index of [1, 2]) {
      const correlationId = `message:offer:${index}`;
      globallyBounded.accept(
        invocationOffer({
          correlationId,
          invocationId: `invocation:${index}`,
          attemptId: `attempt:${index}`,
          sequence: index,
          messageId: `g4:s${index}:offer`,
        }),
        "host-to-executor",
        invocationNow,
      );
      globallyBounded.accept(
        frame({
          correlationId,
          invocationId: `invocation:${index}`,
          attemptId: `attempt:${index}`,
          sequence: index,
          messageId: `g4:s${index}:accepted`,
          kind: "invocation.accepted",
          payload: { acceptedAt: "2026-07-27T01:59:00.000Z" },
        }),
        "executor-to-host",
        invocationNow,
      );
      globallyBounded.accept(
        frame({
          correlationId,
          invocationId: `invocation:${index}`,
          attemptId: `attempt:${index}`,
          sequence: index,
          messageId: `g4:s${index}:event`,
          payload: {
            eventId: `event:${index}`,
            name: "progress",
            value: index,
          },
        }),
        "executor-to-host",
        invocationNow,
      );
    }
    expect(() =>
      globallyBounded.accept(
        frame({
          correlationId: "message:offer:1",
          sequence: 3,
          messageId: "g4:s3:event",
          payload: {
            eventId: "event:3",
            name: "progress",
            value: 3,
          },
        }),
        "executor-to-host",
        invocationNow,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "event-retention",
      }),
    );
  });

  it("statefully binds recovery responses to their exact request", () => {
    const correlations = new ExecutorCorrelationLedger();
    const request: ExecutorChannelFrame = {
      formatVersion: 1,
      generation: 4,
      connectionEpoch: 2,
      sequence: 1,
      messageId: "g4:s1:recovery",
      kind: "recovery.request",
      correlationId: "recovery:1",
      payload: { receivedThrough: 0, sentThrough: 1 },
    };
    correlations.accept(request, "host-to-executor", 1_000);
    const restored = ExecutorCorrelationLedger.hydrate(
      JSON.parse(JSON.stringify(correlations.snapshot())),
    );
    expect(() =>
      restored.accept(
        {
          ...request,
          sequence: 2,
          messageId: "g4:s2:recovery-state",
          kind: "recovery.state",
          payload: {
            receivedThrough: 0,
            sentThrough: 2,
            activeAttempts: [],
          },
        },
        "host-to-executor",
        1_001,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    expect(() =>
      restored.accept(
        {
          ...request,
          sequence: 2,
          messageId: "g4:s2:recovery-state",
          kind: "recovery.state",
          correlationId: "recovery:forged",
          payload: {
            receivedThrough: 0,
            sentThrough: 2,
            activeAttempts: [],
          },
        },
        "executor-to-host",
        1_001,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    expect(
      restored.accept(
        {
          ...request,
          sequence: 2,
          messageId: "g4:s2:recovery-state",
          kind: "recovery.state",
          payload: {
            receivedThrough: 0,
            sentThrough: 2,
            activeAttempts: [],
          },
        },
        "executor-to-host",
        1_001,
      ),
    ).toBe("applied");

    const activeRecovery = new ExecutorCorrelationLedger();
    activeRecovery.accept(invocationOffer(), "host-to-executor", 1_000);
    activeRecovery.accept(
      frame({
        kind: "invocation.accepted",
        payload: { acceptedAt: "1970-01-01T00:00:01.000Z" },
      }),
      "executor-to-host",
      1_000,
    );
    activeRecovery.accept(
      { ...request, correlationId: "recovery:active" },
      "host-to-executor",
      1_001,
    );
    const activeState = {
      ...request,
      sequence: 2,
      messageId: "g4:s2:active-recovery-state",
      kind: "recovery.state" as const,
      correlationId: "recovery:active",
      payload: {
        receivedThrough: 0,
        sentThrough: 2,
        activeAttempts: [],
      },
    };
    expect(() =>
      activeRecovery.accept(activeState, "executor-to-host", 1_002),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    expect(() =>
      activeRecovery.accept(
        {
          ...activeState,
          payload: {
            ...activeState.payload,
            activeAttempts: [
              {
                invocationId: "invocation:1",
                attemptId: "attempt:1",
                state: "active",
                lastEventSequence: 1,
              },
            ],
          },
        },
        "executor-to-host",
        1_002,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    expect(() =>
      activeRecovery.accept(
        {
          ...activeState,
          payload: {
            ...activeState.payload,
            activeAttempts: [
              {
                invocationId: "invocation:1",
                attemptId: "attempt:1",
                state: "active",
                lastEventSequence: 0,
              },
            ],
          },
        },
        "executor-to-host",
        1_002,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    expect(
      activeRecovery.accept(
        {
          ...activeState,
          payload: {
            ...activeState.payload,
            activeAttempts: [
              {
                invocationId: "invocation:1",
                attemptId: "attempt:1",
                state: "accepted",
                lastEventSequence: 0,
              },
            ],
          },
        },
        "executor-to-host",
        1_002,
      ),
    ).toBe("applied");

    const transactional = new ExecutorCorrelationLedger();
    transactional.accept(invocationOffer(), "host-to-executor", 1_000);
    transactional.accept(
      invocationOffer({
        correlationId: "message:offer:2",
        invocationId: "invocation:2",
        attemptId: "attempt:2",
        sequence: 2,
        messageId: "g4:s2:offer:2",
      }),
      "host-to-executor",
      1_000,
    );
    transactional.accept(
      frame({
        kind: "invocation.accepted",
        payload: { acceptedAt: "1970-01-01T00:00:01.000Z" },
      }),
      "executor-to-host",
      1_000,
    );
    transactional.accept(frame(), "executor-to-host", 1_000);
    transactional.accept(
      frame({
        kind: "invocation.accepted",
        correlationId: "message:offer:2",
        invocationId: "invocation:2",
        attemptId: "attempt:2",
        payload: { acceptedAt: "1970-01-01T00:00:01.000Z" },
      }),
      "executor-to-host",
      1_000,
    );
    transactional.accept(
      { ...request, correlationId: "recovery:transactional" },
      "host-to-executor",
      1_001,
    );
    expect(() =>
      transactional.accept(
        {
          ...activeState,
          correlationId: "recovery:transactional",
          payload: {
            ...activeState.payload,
            activeAttempts: [
              {
                invocationId: "invocation:1",
                attemptId: "attempt:1",
                state: "cancelling",
                lastEventSequence: 1,
              },
              {
                invocationId: "invocation:2",
                attemptId: "attempt:2",
                state: "active",
                lastEventSequence: 1,
              },
            ],
          },
        },
        "executor-to-host",
        1_002,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GenericInvocationProtocolError>>({
        code: "wrong-correlation",
      }),
    );
    expect(transactional.state("message:offer")).toBe("active");
    expect(transactional.state("message:offer:2")).toBe("accepted");
  });

  it("verifies digest and signature before issuing a production-only bundle capability", async () => {
    const bytes = new TextEncoder().encode("sealed executable archive");
    const signatureVerifier = {
      verifyEd25519: vi.fn(async (request: { preimage: Uint8Array }) => {
        expect(new TextDecoder().decode(request.preimage)).toBe(
          `flow-weaver-sealed-bundle-v1\n${JSON.stringify({
            formatVersion: descriptor(bytes).formatVersion,
            bundleDigest: descriptor(bytes).bundleDigest,
            byteLength: descriptor(bytes).byteLength,
            engineVersion: descriptor(bytes).engineVersion,
            generatorAbi: descriptor(bytes).generatorAbi,
            entryWorkflowId: descriptor(bytes).entryWorkflowId,
          })}`,
        );
        request.preimage[0] = 0;
        return true;
      }),
    };
    const verified = await verifySealedFlowWeaverBundle(
      descriptor(bytes),
      bytes,
      signatureVerifier,
    );
    expect(signatureVerifier.verifyEd25519).toHaveBeenCalledOnce();
    expect(() => assertVerifiedFlowWeaverBundle(verified)).not.toThrow();
    expect(verified.readBytes()[0]).toBe(bytes[0]);

    const read = verified.readBytes();
    read[0] = 0;
    expect(verified.readBytes()[0]).toBe(bytes[0]);

    const accepted = acceptVerifiedFlowWeaverInvocation({
      invocationId: "invocation:1",
      attemptId: "attempt:1",
      bundle: verified,
      parameters: { account: "example" },
    });
    expect(accepted.production).toBe(true);
    expect(accepted).not.toHaveProperty("filePath");
  });

  it("uses intrinsic bundle byte and AbortSignal brands", async () => {
    const bytes = new TextEncoder().encode("sealed executable archive");
    const sealed = descriptor(bytes);
    const byteLengthGetter = vi.fn(() => 1);
    Object.defineProperty(bytes, "byteLength", {
      configurable: true,
      get: byteLengthGetter,
    });
    const verified = await verifySealedFlowWeaverBundle(sealed, bytes, {
      verifyEd25519: async () => true,
    });
    expect(byteLengthGetter).not.toHaveBeenCalled();
    expect(verified.readBytes()).toEqual(
      new TextEncoder().encode("sealed executable archive"),
    );
    await expect(
      verifySealedFlowWeaverBundle(
        sealed,
        bytes,
        { verifyEd25519: async () => true },
        Object.create(AbortSignal.prototype) as AbortSignal,
      ),
    ).rejects.toMatchObject({ code: "malformed-signal" });
    const shadowedSignal = new AbortController().signal;
    const abortedGetter = vi.fn(() => false);
    Object.defineProperty(shadowedSignal, "aborted", {
      configurable: true,
      get: abortedGetter,
    });
    await expect(
      verifySealedFlowWeaverBundle(
        sealed,
        bytes,
        { verifyEd25519: async () => true },
        shadowedSignal,
      ),
    ).rejects.toMatchObject({ code: "malformed-signal" });
    expect(abortedGetter).not.toHaveBeenCalled();
  });

  it("refuses forged capabilities, mismatched bytes, untrusted signatures, and filePath injection", async () => {
    const bytes = new TextEncoder().encode("sealed executable archive");
    const sealed = descriptor(bytes);
    const trusted = { verifyEd25519: async () => true };

    await expect(
      verifySealedFlowWeaverBundle(
        sealed,
        new TextEncoder().encode("different archive bytes"),
        trusted,
      ),
    ).rejects.toMatchObject({ code: "wrong-bundle" });
    await expect(
      verifySealedFlowWeaverBundle(sealed, bytes, {
        verifyEd25519: async () => false,
      }),
    ).rejects.toMatchObject({ code: "invalid-signature" });
    await expect(
      verifySealedFlowWeaverBundle(sealed, bytes, {
        verifyEd25519: async () => 1 as never,
      }),
    ).rejects.toMatchObject({ code: "invalid-signature" });
    const base64url =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const finalIndex = base64url.indexOf(sealed.signature.value.at(-1)!);
    const noncanonicalSignature = `${sealed.signature.value.slice(0, -1)}${base64url[finalIndex + 1]}`;
    expect(
      Buffer.from(noncanonicalSignature, "base64url").equals(
        Buffer.from(sealed.signature.value, "base64url"),
      ),
    ).toBe(true);
    await expect(
      verifySealedFlowWeaverBundle(
        {
          ...sealed,
          signature: {
            ...sealed.signature,
            value: noncanonicalSignature,
          },
        },
        bytes,
        trusted,
      ),
    ).rejects.toMatchObject({ code: "malformed-descriptor" });

    const forged = Object.freeze({
      descriptor: sealed,
      readBytes: () => Uint8Array.from(bytes),
    });
    expect(() => assertVerifiedFlowWeaverBundle(forged)).toThrow(
      expect.objectContaining<Partial<FlowWeaverBundleRefusalError>>({
        code: "unverified-bundle",
      }),
    );

    const verified = await verifySealedFlowWeaverBundle(sealed, bytes, trusted);
    expect(() =>
      acceptVerifiedFlowWeaverInvocation({
        invocationId: "invocation:1",
        attemptId: "attempt:1",
        bundle: verified,
        parameters: {},
        filePath: "/tmp/untrusted.ts",
      } as never),
    ).toThrow(
      expect.objectContaining<Partial<FlowWeaverBundleRefusalError>>({
        code: "malformed-invocation",
      }),
    );
    expect(() =>
      acceptVerifiedFlowWeaverInvocation({
        invocationId: "invocation:1",
        attemptId: "attempt:1",
        bundle: verified,
        parameters: {},
        abortSignal: Object.create(AbortSignal.prototype) as AbortSignal,
      }),
    ).toThrow(
      expect.objectContaining<Partial<FlowWeaverBundleRefusalError>>({
        code: "malformed-invocation",
      }),
    );
    expect(() =>
      acceptVerifiedFlowWeaverInvocation({
        invocationId: "invocation:1",
        attemptId: "attempt:1",
        bundle: verified,
        parameters: {},
        abortSignal: "not-an-abort-signal",
      } as never),
    ).toThrow(
      expect.objectContaining<Partial<FlowWeaverBundleRefusalError>>({
        code: "malformed-invocation",
      }),
    );
    expect(() =>
      acceptVerifiedFlowWeaverInvocation({
        invocationId: "invocation:1",
        attemptId: "attempt:1",
        bundle: verified,
        parameters: {
          chunks: Array.from({ length: 9 }, () => "x".repeat(250 * 1024)),
        },
      }),
    ).toThrow(
      expect.objectContaining<Partial<FlowWeaverBundleRefusalError>>({
        code: "malformed-invocation",
      }),
    );
  });

  it("does not invoke descriptor or invocation accessors", async () => {
    const bytes = new TextEncoder().encode("sealed executable archive");
    const descriptorGetter = vi.fn(() => 1);
    const hostileDescriptor = { ...descriptor(bytes) };
    Object.defineProperty(hostileDescriptor, "byteLength", {
      enumerable: true,
      get: descriptorGetter,
    });
    await expect(
      verifySealedFlowWeaverBundle(
        hostileDescriptor as SealedFlowWeaverBundleDescriptor,
        bytes,
        { verifyEd25519: async () => true },
      ),
    ).rejects.toMatchObject({ code: "malformed-descriptor" });
    expect(descriptorGetter).not.toHaveBeenCalled();

    const verified = await verifySealedFlowWeaverBundle(
      descriptor(bytes),
      bytes,
      { verifyEd25519: async () => true },
    );
    const parameterGetter = vi.fn(() => ({ secret: true }));
    const hostileInvocation = {
      invocationId: "invocation:1",
      attemptId: "attempt:1",
      bundle: verified,
    };
    Object.defineProperty(hostileInvocation, "parameters", {
      enumerable: true,
      get: parameterGetter,
    });
    expect(() =>
      acceptVerifiedFlowWeaverInvocation(hostileInvocation as never),
    ).toThrow(
      expect.objectContaining<Partial<FlowWeaverBundleRefusalError>>({
        code: "malformed-invocation",
      }),
    );
    expect(parameterGetter).not.toHaveBeenCalled();
  });

  it("requires the exact branded A2 continuation and binds it to invocation, bundle, workflow, engine, ABI, and gate", async () => {
    const bytes = new TextEncoder().encode("sealed executable archive");
    const sealed = descriptor(bytes);
    const verified = await verifySealedFlowWeaverBundle(sealed, bytes, {
      verifyEd25519: async () => true,
    });
    const continuation = acceptedContinuation(sealed);
    const accepted = acceptVerifiedFlowWeaverInvocation({
      invocationId: "invocation:1",
      attemptId: "attempt:1",
      bundle: verified,
      parameters: {},
      continuation,
      resolution: {
        gateId: continuation.gateId,
        value: { approved: true },
      },
    });
    expect(accepted.continuation).toBe(continuation);
    expect(Object.isFrozen(accepted.continuation)).toBe(true);

    expect(() =>
      acceptVerifiedFlowWeaverInvocation({
        invocationId: "invocation:2",
        attemptId: "attempt:2",
        bundle: verified,
        parameters: {},
        continuation,
        resolution: {
          gateId: continuation.gateId,
          value: { approved: true },
        },
      }),
    ).toThrow(
      expect.objectContaining<Partial<FlowWeaverBundleRefusalError>>({
        code: "incompatible-continuation",
      }),
    );
    expect(() =>
      acceptVerifiedFlowWeaverInvocation({
        invocationId: "invocation:1",
        attemptId: "attempt:3",
        bundle: verified,
        parameters: {},
        continuation: { not: "decoder-issued" } as never,
        resolution: {
          gateId: continuation.gateId,
          value: { approved: true },
        },
      }),
    ).toThrow(
      expect.objectContaining<Partial<FlowWeaverBundleRefusalError>>({
        code: "incompatible-continuation",
      }),
    );

    const fixture = continuationFixture(sealed);
    const duplicateRunIdentity = JSON.stringify(fixture.envelope).replace(
      '"runId":"invocation:1"',
      '"runId":"forged","runId":"invocation:1"',
    );
    expect(
      decodeContinuation(duplicateRunIdentity, fixture.compatibility),
    ).toMatchObject({ accepted: false, reason: "malformed" });
  });
});
