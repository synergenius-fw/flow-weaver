import {
  acceptExecutorChannelWireValue,
  assertExecutorChannelDirection,
  canonicalExecutorChannelMessage,
  encodeExecutorChannelFrame,
  type ExecutorChannelFrame,
  type ExecutorChannelWireValue,
} from "./wire.js";
import {
  acceptExecutorChannelLimits,
  EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  type ExecutorChannelLimits,
} from "./limits.js";
import {
  consumeDurableAcknowledgementProof,
  type DurableAcknowledgementProof,
} from "./durable-acknowledgement.js";

export interface GenericInvocationAuthority {
  readonly bindingId: string;
  readonly providerId: string;
  readonly interfaceId: string;
  readonly interfaceVersion: string;
  readonly method: string;
  readonly authorityDigest: string;
  readonly executionEpoch: number;
}

export interface GenericInvocationOffer {
  readonly invocationId: string;
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly deadline: string;
  readonly authority: GenericInvocationAuthority;
  readonly input: ExecutorChannelWireValue;
}

export type GenericInvocationRefusalCode =
  | "unauthenticated"
  | "unauthorized"
  | "stale-authority"
  | "unsupported-interface"
  | "unsupported-method"
  | "provider-replaced"
  | "draining"
  | "capacity"
  | "malformed-input"
  | "deadline-expired";

export interface GenericInvocationRefusal {
  readonly code: GenericInvocationRefusalCode;
  readonly retryable: boolean;
  readonly message: string;
}

export interface GenericInvocationEvent {
  readonly eventId: string;
  readonly name: string;
  readonly value: ExecutorChannelWireValue;
}

export interface GenericInvocationSuspension {
  readonly suspensionId: string;
  readonly value: ExecutorChannelWireValue;
}

export interface GenericInvocationError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: ExecutorChannelWireValue;
}

export type GenericInvocationCompletion =
  | {
      readonly status: "succeeded";
      readonly result: ExecutorChannelWireValue;
    }
  | {
      readonly status: "failed" | "cancelled" | "indeterminate";
      readonly error: GenericInvocationError;
    };

export type GenericInvocationState =
  | "offered"
  | "accepted"
  | "active"
  | "cancelling"
  | "suspended"
  | "completed"
  | "refused";

interface InvocationCorrelation {
  readonly kind: "invocation";
  readonly invocationId: string;
  readonly attemptId: string;
  state: GenericInvocationState;
  readonly offeredAt: number;
  readonly offerDeadline: number;
  readonly admissionExpiresAt: number;
  terminalDigest?: string;
  eventWindowStartedAt: number;
  eventCount: number;
  retainedEventBytes: number;
  lastEventSequence: number;
  readonly events: Map<
    string,
    {
      readonly digest: string;
      readonly sequence: number;
      readonly byteLength: number;
    }
  >;
}

interface RecoveryCorrelation {
  readonly kind: "recovery";
  readonly requestDirection: "host-to-executor" | "executor-to-host";
  state: "requested" | "completed";
}

type Correlation = InvocationCorrelation | RecoveryCorrelation;
const exactCorrelationLedgers = new WeakSet<object>();
const correlationLedgerOwners = new WeakMap<object, object>();

export interface ExecutorCorrelationLedgerSnapshot {
  readonly formatVersion: 1;
  readonly correlations: readonly (
    | {
        readonly correlationId: string;
        readonly kind: "recovery";
        readonly requestDirection: "host-to-executor" | "executor-to-host";
        readonly state: "requested" | "completed";
      }
    | {
        readonly correlationId: string;
        readonly kind: "invocation";
        readonly invocationId: string;
        readonly attemptId: string;
        readonly state: GenericInvocationState;
        readonly offeredAt: number;
        readonly offerDeadline: number;
        readonly admissionExpiresAt: number;
        readonly terminalDigest?: string;
        readonly eventWindowStartedAt: number;
        readonly eventCount: number;
        readonly retainedEventBytes: number;
        readonly lastEventSequence: number;
        readonly events: readonly {
          readonly eventId: string;
          readonly digest: string;
          readonly sequence: number;
          readonly byteLength: number;
        }[];
      }
  )[];
}

export class ExecutorCorrelationLedger {
  readonly #correlations = new Map<string, Correlation>();
  readonly #limits: Readonly<ExecutorChannelLimits>;
  #retainedEventIdentities = 0;

  constructor(
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ) {
    this.#limits = acceptExecutorChannelLimits(limits);
    exactCorrelationLedgers.add(this);
  }

  snapshot(): Readonly<ExecutorCorrelationLedgerSnapshot> {
    return Object.freeze({
      formatVersion: 1,
      correlations: Object.freeze(
        [...this.#correlations.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([correlationId, correlation]) =>
            Object.freeze(
              correlation.kind === "recovery"
                ? {
                    correlationId,
                    kind: "recovery" as const,
                    requestDirection: correlation.requestDirection,
                    state: correlation.state,
                  }
                : {
                    correlationId,
                    kind: "invocation" as const,
                    invocationId: correlation.invocationId,
                    attemptId: correlation.attemptId,
                    state: correlation.state,
                    offeredAt: correlation.offeredAt,
                    offerDeadline: correlation.offerDeadline,
                    admissionExpiresAt: correlation.admissionExpiresAt,
                    eventWindowStartedAt: correlation.eventWindowStartedAt,
                    eventCount: correlation.eventCount,
                    retainedEventBytes: correlation.retainedEventBytes,
                    lastEventSequence: correlation.lastEventSequence,
                    events: Object.freeze(
                      [...correlation.events.entries()]
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([eventId, retained]) =>
                          Object.freeze({ eventId, ...retained }),
                        ),
                    ),
                    ...(correlation.terminalDigest === undefined
                      ? {}
                      : { terminalDigest: correlation.terminalDigest }),
                  },
            ),
          ),
      ),
    });
  }

  static hydrate(
    input: unknown,
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ): ExecutorCorrelationLedger {
    const acceptedLimits = acceptExecutorChannelLimits(limits);
    const value = acceptExecutorChannelWireValue(input, acceptedLimits);
    if (
      !isExactRecord(value, ["formatVersion", "correlations"]) ||
      value.formatVersion !== 1 ||
      !Array.isArray(value.correlations) ||
      value.correlations.length > maxCorrelationEntries(acceptedLimits)
    ) {
      throw new GenericInvocationProtocolError(
        "malformed-correlation",
        "correlation snapshot is malformed",
      );
    }
    const ledger = new ExecutorCorrelationLedger(acceptedLimits);
    const invocationAttempts = new Set<string>();
    let activeInvocationCount = 0;
    for (const entry of value.correlations) {
      if (
        entry === null ||
        Array.isArray(entry) ||
        typeof entry !== "object" ||
        typeof entry.correlationId !== "string" ||
        !isIdentifier(entry.correlationId) ||
        ledger.#correlations.has(entry.correlationId)
      ) {
        throw new GenericInvocationProtocolError(
          "malformed-correlation",
          "correlation snapshot contains an invalid or duplicate identity",
        );
      }
      if (
        entry.kind === "recovery" &&
        isExactRecord(entry, [
          "correlationId",
          "kind",
          "requestDirection",
          "state",
        ]) &&
        (entry.requestDirection === "host-to-executor" ||
          entry.requestDirection === "executor-to-host") &&
        (entry.state === "requested" || entry.state === "completed")
      ) {
        ledger.#correlations.set(entry.correlationId, {
          kind: "recovery",
          requestDirection: entry.requestDirection,
          state: entry.state,
        });
        continue;
      }
      if (
        entry.kind !== "invocation" ||
        !isExactRecord(
          entry,
          [
            "correlationId",
            "kind",
            "invocationId",
            "attemptId",
            "state",
            "offeredAt",
            "offerDeadline",
            "admissionExpiresAt",
            "eventWindowStartedAt",
            "eventCount",
            "retainedEventBytes",
            "lastEventSequence",
            "events",
          ],
          ["terminalDigest"],
        ) ||
        typeof entry.invocationId !== "string" ||
        !isIdentifier(entry.invocationId) ||
        typeof entry.attemptId !== "string" ||
        !isIdentifier(entry.attemptId) ||
        typeof entry.state !== "string" ||
        ![
          "offered",
          "accepted",
          "active",
          "cancelling",
          "suspended",
          "completed",
          "refused",
        ].includes(entry.state) ||
        !Number.isSafeInteger(entry.offeredAt) ||
        (entry.offeredAt as number) < 0 ||
        !Number.isSafeInteger(entry.offerDeadline) ||
        (entry.offerDeadline as number) <= (entry.offeredAt as number) ||
        !Number.isSafeInteger(entry.admissionExpiresAt) ||
        (entry.admissionExpiresAt as number) !==
          Math.min(
            entry.offerDeadline as number,
            (entry.offeredAt as number) + acceptedLimits.admissionDeadlineMs,
          ) ||
        !Number.isSafeInteger(entry.eventWindowStartedAt) ||
        (entry.eventWindowStartedAt as number) < 0 ||
        !Number.isSafeInteger(entry.eventCount) ||
        (entry.eventCount as number) < 0 ||
        (entry.eventCount as number) > acceptedLimits.maxEventRatePerSecond ||
        !Number.isSafeInteger(entry.retainedEventBytes) ||
        (entry.retainedEventBytes as number) < 0 ||
        (entry.retainedEventBytes as number) >
          acceptedLimits.maxRetainedEventBytesPerInvocation ||
        !Number.isSafeInteger(entry.lastEventSequence) ||
        (entry.lastEventSequence as number) < 0 ||
        !Array.isArray(entry.events) ||
        entry.events.length > acceptedLimits.maxReplayFrames ||
        (entry.terminalDigest !== undefined &&
          (typeof entry.terminalDigest !== "string" ||
            !/^[0-9a-f]{64}$/.test(entry.terminalDigest))) ||
        ["suspended", "completed", "refused"].includes(entry.state) !==
          (entry.terminalDigest !== undefined)
      ) {
        throw new GenericInvocationProtocolError(
          "malformed-correlation",
          "invocation correlation snapshot is malformed",
        );
      }
      const events = new Map<
        string,
        {
          readonly digest: string;
          readonly sequence: number;
          readonly byteLength: number;
        }
      >();
      const eventSequences = new Set<number>();
      let retainedEventBytes = 0;
      for (const event of entry.events) {
        if (
          !isExactRecord(event, [
            "eventId",
            "digest",
            "sequence",
            "byteLength",
          ]) ||
          typeof event.eventId !== "string" ||
          !isIdentifier(event.eventId) ||
          typeof event.digest !== "string" ||
          !/^[0-9a-f]{64}$/.test(event.digest) ||
          !Number.isSafeInteger(event.sequence) ||
          (event.sequence as number) <= 0 ||
          (event.sequence as number) > (entry.lastEventSequence as number) ||
          eventSequences.has(event.sequence as number) ||
          !Number.isSafeInteger(event.byteLength) ||
          (event.byteLength as number) <= 0 ||
          (event.byteLength as number) > acceptedLimits.maxFrameBytes ||
          events.has(event.eventId)
        ) {
          throw new GenericInvocationProtocolError(
            "malformed-correlation",
            "invocation event identity snapshot is malformed",
          );
        }
        retainedEventBytes += event.byteLength as number;
        if (
          retainedEventBytes > acceptedLimits.maxRetainedEventBytesPerInvocation
        ) {
          throw new GenericInvocationProtocolError(
            "malformed-correlation",
            "invocation event snapshot exceeds the retained byte bound",
          );
        }
        eventSequences.add(event.sequence as number);
        events.set(event.eventId, {
          digest: event.digest,
          sequence: event.sequence as number,
          byteLength: event.byteLength as number,
        });
        ledger.#retainedEventIdentities += 1;
        if (
          ledger.#retainedEventIdentities >
          maxCorrelationEntries(acceptedLimits)
        ) {
          throw new GenericInvocationProtocolError(
            "malformed-correlation",
            "correlation snapshot exceeds the global event identity bound",
          );
        }
      }
      if (
        retainedEventBytes !== entry.retainedEventBytes ||
        ((entry.eventCount as number) === 0 &&
          (entry.eventWindowStartedAt as number) !== 0) ||
        ((entry.eventCount as number) === 0) !==
          ((entry.lastEventSequence as number) === 0) ||
        (entry.eventCount as number) > (entry.lastEventSequence as number) ||
        ((entry.eventCount as number) > 0 &&
          (entry.eventWindowStartedAt as number) <
            (entry.offeredAt as number)) ||
        (["offered", "accepted", "refused"].includes(entry.state) &&
          ((entry.eventCount as number) !== 0 ||
            (entry.retainedEventBytes as number) !== 0 ||
            (entry.lastEventSequence as number) !== 0 ||
            events.size !== 0)) ||
        (entry.state === "active" && (entry.lastEventSequence as number) === 0)
      ) {
        throw new GenericInvocationProtocolError(
          "malformed-correlation",
          "invocation correlation snapshot state and retained event facts conflict",
        );
      }
      const invocationAttempt = `${entry.invocationId}\u0000${entry.attemptId}`;
      if (invocationAttempts.has(invocationAttempt)) {
        throw new GenericInvocationProtocolError(
          "malformed-correlation",
          "correlation snapshot aliases one invocation attempt to multiple calls",
        );
      }
      invocationAttempts.add(invocationAttempt);
      if (
        ["offered", "accepted", "active", "cancelling"].includes(entry.state)
      ) {
        activeInvocationCount += 1;
        if (activeInvocationCount > acceptedLimits.maxInFlightInvocations) {
          throw new GenericInvocationProtocolError(
            "malformed-correlation",
            "correlation snapshot exceeds the in-flight invocation bound",
          );
        }
      }
      ledger.#correlations.set(entry.correlationId, {
        kind: "invocation",
        invocationId: entry.invocationId,
        attemptId: entry.attemptId,
        state: entry.state as GenericInvocationState,
        offeredAt: entry.offeredAt as number,
        offerDeadline: entry.offerDeadline as number,
        admissionExpiresAt: entry.admissionExpiresAt as number,
        eventWindowStartedAt: entry.eventWindowStartedAt as number,
        eventCount: entry.eventCount as number,
        retainedEventBytes: entry.retainedEventBytes as number,
        lastEventSequence: entry.lastEventSequence as number,
        events,
        ...(entry.terminalDigest === undefined
          ? {}
          : { terminalDigest: entry.terminalDigest }),
      });
    }
    return ledger;
  }

  accept(
    frame: ExecutorChannelFrame,
    direction: "host-to-executor" | "executor-to-host",
    now: number,
  ): "applied" | "duplicate" {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new GenericInvocationProtocolError(
        "invalid-clock",
        "correlation transition requires valid database time",
      );
    }
    frame = assertExecutorChannelDirection(frame, direction, this.#limits);
    if (frame.kind === "ack") return "applied";
    const correlationId = frame.correlationId;
    if (correlationId === undefined) {
      throw new GenericInvocationProtocolError(
        "wrong-correlation",
        "correlated frame is missing its originating correlation identity",
      );
    }
    if (frame.kind === "invocation.offer") {
      if (this.#correlations.has(correlationId)) {
        throw new GenericInvocationProtocolError(
          "wrong-correlation",
          "one correlation identity cannot originate two calls",
        );
      }
      if (
        [...this.#correlations.values()].some(
          (item) =>
            item.kind === "invocation" &&
            item.invocationId === frame.invocationId &&
            item.attemptId === frame.attemptId,
        )
      ) {
        throw new GenericInvocationProtocolError(
          "wrong-correlation",
          "one invocation attempt cannot originate multiple calls",
        );
      }
      if (
        [...this.#correlations.values()].filter(
          (item) =>
            item.kind === "invocation" &&
            ["offered", "accepted", "active", "cancelling"].includes(
              item.state,
            ),
        ).length >= this.#limits.maxInFlightInvocations
      ) {
        throw new GenericInvocationProtocolError(
          "capacity",
          "maximum in-flight invocation policy reached",
        );
      }
      const deadline = Date.parse(
        (frame.payload as { deadline: string }).deadline,
      );
      if (deadline <= now) {
        throw new GenericInvocationProtocolError(
          "deadline-expired",
          "invocation offer deadline already expired",
        );
      }
      this.#assertCapacity();
      this.#correlations.set(correlationId, {
        kind: "invocation",
        invocationId: frame.invocationId!,
        attemptId: frame.attemptId!,
        state: "offered",
        offeredAt: now,
        offerDeadline: deadline,
        admissionExpiresAt: Math.min(
          deadline,
          now + this.#limits.admissionDeadlineMs,
        ),
        eventWindowStartedAt: 0,
        eventCount: 0,
        retainedEventBytes: 0,
        lastEventSequence: 0,
        events: new Map(),
      });
      return "applied";
    }
    if (frame.kind === "recovery.request") {
      if (this.#correlations.has(correlationId)) {
        throw new GenericInvocationProtocolError(
          "wrong-correlation",
          "one correlation identity cannot originate two recovery calls",
        );
      }
      this.#assertCapacity();
      this.#correlations.set(correlationId, {
        kind: "recovery",
        requestDirection: direction,
        state: "requested",
      });
      return "applied";
    }

    const correlation = this.#correlations.get(correlationId);
    if (frame.kind === "recovery.state") {
      if (correlation?.kind !== "recovery") {
        throw new GenericInvocationProtocolError(
          "wrong-correlation",
          "recovery state does not match an exact recovery request",
        );
      }
      if (correlation.state !== "requested") {
        throw new GenericInvocationProtocolError(
          "illegal-transition",
          "one recovery request accepts exactly one state response",
        );
      }
      if (correlation.requestDirection === direction) {
        throw new GenericInvocationProtocolError(
          "wrong-correlation",
          "recovery response must arrive from the opposite direction",
        );
      }
      this.#reconcileActiveAttempts(frame);
      correlation.state = "completed";
      return "applied";
    }
    if (
      correlation?.kind !== "invocation" ||
      frame.invocationId !== correlation.invocationId ||
      frame.attemptId !== correlation.attemptId
    ) {
      throw new GenericInvocationProtocolError(
        "wrong-correlation",
        "frame does not match the exact originating invocation offer",
      );
    }
    if (frame.kind === "invocation.cancel") {
      this.#requireState(correlation, ["accepted", "active"]);
      correlation.state = "cancelling";
      return "applied";
    }
    if (frame.kind === "invocation.accepted") {
      this.#requireState(correlation, ["offered"]);
      const acceptedAt = Date.parse(
        (frame.payload as { acceptedAt: string }).acceptedAt,
      );
      if (
        now > correlation.admissionExpiresAt ||
        acceptedAt < correlation.offeredAt ||
        acceptedAt > now
      ) {
        throw new GenericInvocationProtocolError(
          "deadline-expired",
          "invocation acceptance is outside its database-time admission window",
        );
      }
      correlation.state = "accepted";
      return "applied";
    }
    if (frame.kind === "invocation.refused") {
      this.#requireState(correlation, ["offered"]);
      if (now > correlation.admissionExpiresAt) {
        throw new GenericInvocationProtocolError(
          "deadline-expired",
          "invocation refusal arrived after the admission window",
        );
      }
      correlation.state = "refused";
      correlation.terminalDigest = canonicalExecutorChannelMessage(
        frame,
        this.#limits,
      );
      return "applied";
    }
    if (frame.kind === "invocation.event") {
      this.#requireState(correlation, ["accepted", "active"]);
      const payload = frame.payload as { eventId: string };
      const digest = canonicalExecutorChannelMessage(frame, this.#limits);
      const prior = correlation.events.get(payload.eventId);
      if (prior !== undefined) {
        if (prior.digest === digest) return "duplicate";
        throw new GenericInvocationProtocolError(
          "conflicting-event",
          "one event identity cannot carry incompatible content",
        );
      }
      if (
        correlation.events.size >= this.#limits.maxReplayFrames ||
        this.#retainedEventIdentities >= maxCorrelationEntries(this.#limits)
      ) {
        throw new GenericInvocationProtocolError(
          "event-retention",
          "event identity retention limit reached",
        );
      }
      if (frame.sequence <= correlation.lastEventSequence) {
        throw new GenericInvocationProtocolError(
          "illegal-transition",
          "new invocation events must advance the sender sequence",
        );
      }
      if (now < correlation.offeredAt) {
        throw new GenericInvocationProtocolError(
          "invalid-clock",
          "event clock cannot precede the invocation offer",
        );
      }
      if (
        correlation.eventCount === 0 ||
        now - correlation.eventWindowStartedAt >= 1_000
      ) {
        correlation.eventWindowStartedAt = now;
        correlation.eventCount = 0;
      } else if (now < correlation.eventWindowStartedAt) {
        throw new GenericInvocationProtocolError(
          "invalid-clock",
          "event clock cannot move backwards",
        );
      }
      if (correlation.eventCount >= this.#limits.maxEventRatePerSecond) {
        throw new GenericInvocationProtocolError(
          "event-rate",
          "event rate policy exceeded",
        );
      }
      const eventBytes = encodeExecutorChannelFrame(
        frame,
        this.#limits,
      ).byteLength;
      if (
        correlation.retainedEventBytes + eventBytes >
        this.#limits.maxRetainedEventBytesPerInvocation
      ) {
        throw new GenericInvocationProtocolError(
          "event-retention",
          "retained event byte policy exceeded",
        );
      }
      correlation.eventCount += 1;
      correlation.retainedEventBytes += eventBytes;
      correlation.events.set(payload.eventId, {
        digest,
        sequence: frame.sequence,
        byteLength: eventBytes,
      });
      correlation.lastEventSequence = frame.sequence;
      this.#retainedEventIdentities += 1;
      correlation.state = "active";
      return "applied";
    }
    if (frame.kind === "invocation.cancel-observed") {
      this.#requireState(correlation, ["cancelling"]);
      return "applied";
    }
    if (
      frame.kind === "invocation.suspended" ||
      frame.kind === "invocation.completed"
    ) {
      const digest = canonicalExecutorChannelMessage(frame, this.#limits);
      if (correlation.terminalDigest !== undefined) {
        if (correlation.terminalDigest === digest) return "duplicate";
        throw new GenericInvocationProtocolError(
          "conflicting-terminal",
          "one invocation attempt cannot have two terminal facts",
        );
      }
      this.#requireState(correlation, ["accepted", "active", "cancelling"]);
      correlation.state =
        frame.kind === "invocation.suspended" ? "suspended" : "completed";
      correlation.terminalDigest = digest;
      return "applied";
    }
    throw new GenericInvocationProtocolError(
      "illegal-transition",
      `unsupported correlated frame ${frame.kind}`,
    );
  }

  state(
    correlationId: string,
  ): GenericInvocationState | "recovery" | undefined {
    const correlation = this.#correlations.get(correlationId);
    if (correlation?.kind === "invocation") return correlation.state;
    if (correlation?.kind === "recovery") return "recovery";
    return undefined;
  }

  assertLimits(limits: ExecutorChannelLimits): void {
    const accepted = acceptExecutorChannelLimits(limits);
    if (
      (Object.keys(accepted) as (keyof ExecutorChannelLimits)[]).some(
        (key) => accepted[key] !== this.#limits[key],
      )
    ) {
      throw new GenericInvocationProtocolError(
        "wrong-policy",
        "correlation ledger policy does not match its session",
      );
    }
  }

  assertCanApplyDurableAcknowledgementFrames(
    frames: readonly ExecutorChannelFrame[],
  ): void {
    for (const frame of frames) {
      if (frame.correlationId === undefined) continue;
      const correlation = this.#correlations.get(frame.correlationId);
      if (frame.kind === "invocation.event") {
        if (correlation?.kind !== "invocation") {
          throw new GenericInvocationProtocolError(
            "wrong-correlation",
            "durable event acknowledgement has no retained invocation correlation",
          );
        }
        const eventId = (frame.payload as { eventId: string }).eventId;
        const retained = correlation.events.get(eventId);
        if (
          retained === undefined ||
          retained.digest !==
            canonicalExecutorChannelMessage(frame, this.#limits) ||
          retained.sequence !== frame.sequence ||
          retained.byteLength !==
            encodeExecutorChannelFrame(frame, this.#limits).byteLength
        ) {
          throw new GenericInvocationProtocolError(
            "conflicting-event",
            "durable acknowledgement conflicts with retained event identity",
          );
        }
      } else if (
        frame.kind === "invocation.refused" ||
        frame.kind === "invocation.suspended" ||
        frame.kind === "invocation.completed"
      ) {
        if (
          correlation?.kind !== "invocation" ||
          correlation.terminalDigest !==
            canonicalExecutorChannelMessage(frame, this.#limits)
        ) {
          throw new GenericInvocationProtocolError(
            "conflicting-terminal",
            "durable acknowledgement does not match the retained terminal",
          );
        }
      } else if (
        frame.kind === "recovery.state" &&
        (correlation?.kind !== "recovery" || correlation.state !== "completed")
      ) {
        throw new GenericInvocationProtocolError(
          "wrong-correlation",
          "durable acknowledgement does not match completed recovery",
        );
      }
    }
  }

  applyDurableAcknowledgement(proof: DurableAcknowledgementProof): void {
    let frames: readonly ExecutorChannelFrame[];
    try {
      const acknowledgement = consumeDurableAcknowledgementProof(proof, this);
      frames = acknowledgement.frames;
    } catch {
      throw new GenericInvocationProtocolError(
        "wrong-correlation",
        "durable acknowledgement proof was forged or already consumed",
      );
    }
    this.assertCanApplyDurableAcknowledgementFrames(frames);
    for (const frame of frames) {
      if (frame.correlationId === undefined) continue;
      const correlation = this.#correlations.get(frame.correlationId);
      if (frame.kind === "invocation.event") {
        if (correlation?.kind !== "invocation") {
          throw new GenericInvocationProtocolError(
            "wrong-correlation",
            "durable event acknowledgement lost its retained invocation correlation",
          );
        }
        const eventId = (frame.payload as { eventId: string }).eventId;
        const retained = correlation.events.get(eventId);
        if (retained !== undefined && correlation.events.delete(eventId)) {
          this.#retainedEventIdentities -= 1;
          correlation.retainedEventBytes -= retained.byteLength;
        }
      } else if (
        frame.kind === "invocation.refused" ||
        frame.kind === "invocation.suspended" ||
        frame.kind === "invocation.completed" ||
        frame.kind === "recovery.state"
      ) {
        if (correlation?.kind === "invocation") {
          this.#retainedEventIdentities -= correlation.events.size;
        }
        this.#correlations.delete(frame.correlationId);
      }
    }
  }

  #reconcileActiveAttempts(frame: ExecutorChannelFrame): void {
    const reported = new Map<
      string,
      {
        readonly state: "accepted" | "active" | "cancelling";
        readonly lastEventSequence: number;
      }
    >();
    for (const attempt of (
      frame.payload as {
        activeAttempts: readonly {
          invocationId: string;
          attemptId: string;
          state: "accepted" | "active" | "cancelling";
          lastEventSequence: number;
        }[];
      }
    ).activeAttempts) {
      reported.set(
        `${attempt.invocationId}\u0000${attempt.attemptId}`,
        attempt,
      );
    }
    const expected = [...this.#correlations.values()].filter(
      (item): item is InvocationCorrelation =>
        item.kind === "invocation" &&
        ["accepted", "active", "cancelling"].includes(item.state),
    );
    if (reported.size !== expected.length) {
      throw new GenericInvocationProtocolError(
        "wrong-correlation",
        "recovery active attempts do not match durable invocation ownership",
      );
    }
    const reconciled: {
      readonly invocation: InvocationCorrelation;
      readonly peer: {
        readonly state: "accepted" | "active" | "cancelling";
        readonly lastEventSequence: number;
      };
    }[] = [];
    for (const invocation of expected) {
      const key = `${invocation.invocationId}\u0000${invocation.attemptId}`;
      const peer = reported.get(key);
      if (
        peer === undefined ||
        peer.lastEventSequence !== invocation.lastEventSequence ||
        (invocation.state === "active" && peer.state === "accepted") ||
        (invocation.state === "cancelling" && peer.state !== "cancelling") ||
        (peer.state === "accepted" && peer.lastEventSequence !== 0) ||
        (peer.state === "active" && peer.lastEventSequence === 0)
      ) {
        throw new GenericInvocationProtocolError(
          "wrong-correlation",
          "recovery active attempt state conflicts with durable invocation state",
        );
      }
      reconciled.push({ invocation, peer });
    }
    for (const { invocation, peer } of reconciled) {
      invocation.lastEventSequence = peer.lastEventSequence;
      if (invocation.state !== "cancelling") {
        invocation.state = peer.state;
      }
    }
  }

  #assertCapacity(): void {
    if (this.#correlations.size >= maxCorrelationEntries(this.#limits)) {
      throw new GenericInvocationProtocolError(
        "correlation-exhausted",
        "bounded correlation ledger is exhausted",
      );
    }
  }

  #requireState(
    correlation: InvocationCorrelation,
    allowed: readonly GenericInvocationState[],
  ): void {
    if (!allowed.includes(correlation.state)) {
      throw new GenericInvocationProtocolError(
        "illegal-transition",
        `cannot apply invocation frame while state is ${correlation.state}`,
      );
    }
  }
}

export function isExactExecutorCorrelationLedger(
  value: unknown,
): value is ExecutorCorrelationLedger {
  return (
    typeof value === "object" &&
    value !== null &&
    exactCorrelationLedgers.has(value) &&
    Object.getPrototypeOf(value) === ExecutorCorrelationLedger.prototype
  );
}

export function bindExecutorCorrelationLedgerOwner(
  ledger: ExecutorCorrelationLedger,
  owner: object,
): void {
  if (!isExactExecutorCorrelationLedger(ledger)) {
    throw new GenericInvocationProtocolError(
      "wrong-correlation",
      "correlation ledger is not an exact executor-channel state object",
    );
  }
  const prior = correlationLedgerOwners.get(ledger);
  if (prior !== undefined && prior !== owner) {
    throw new GenericInvocationProtocolError(
      "wrong-correlation",
      "correlation ledger belongs to another executor session",
    );
  }
  correlationLedgerOwners.set(ledger, owner);
}

function isExactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is { readonly [key: string]: ExecutorChannelWireValue } {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/.test(value);
}

function maxCorrelationEntries(limits: ExecutorChannelLimits): number {
  return Math.min(
    limits.maxReplayFrames,
    Math.floor(limits.maxFrameBytes / 1_024),
  );
}

export class GenericInvocationMachine {
  readonly #correlationId: string;
  readonly #ledger: ExecutorCorrelationLedger;
  readonly #limits: Readonly<ExecutorChannelLimits>;

  constructor(
    offer: ExecutorChannelFrame,
    limits: ExecutorChannelLimits,
    now: number,
  ) {
    this.#limits = acceptExecutorChannelLimits(limits);
    this.#ledger = new ExecutorCorrelationLedger(this.#limits);
    offer = assertExecutorChannelDirection(
      offer,
      "host-to-executor",
      this.#limits,
    );
    if (
      offer.kind !== "invocation.offer" ||
      offer.correlationId === undefined
    ) {
      throw new GenericInvocationProtocolError(
        "wrong-correlation",
        "invocation machine requires its exact originating offer",
      );
    }
    this.#correlationId = offer.correlationId;
    this.#ledger.accept(offer, "host-to-executor", now);
  }

  get state(): GenericInvocationState {
    return this.#ledger.state(this.#correlationId) as GenericInvocationState;
  }

  record(frame: ExecutorChannelFrame, now: number): "applied" | "duplicate" {
    return this.#ledger.accept(frame, "executor-to-host", now);
  }

  recordTerminal(
    frame: ExecutorChannelFrame,
    now: number,
  ): "applied" | "duplicate" {
    frame = assertExecutorChannelDirection(
      frame,
      "executor-to-host",
      this.#limits,
    );
    if (frame.kind !== "invocation.completed") {
      throw new GenericInvocationProtocolError(
        "wrong-terminal",
        "recordTerminal accepts only an invocation completion",
      );
    }
    return this.record(frame, now);
  }
}

export type GenericInvocationProtocolErrorCode =
  | "illegal-transition"
  | "conflicting-terminal"
  | "conflicting-event"
  | "capacity"
  | "deadline-expired"
  | "event-rate"
  | "event-retention"
  | "invalid-clock"
  | "malformed-correlation"
  | "correlation-exhausted"
  | "wrong-correlation"
  | "wrong-policy"
  | "wrong-terminal";

export class GenericInvocationProtocolError extends Error {
  readonly name = "GenericInvocationProtocolError";

  constructor(
    readonly code: GenericInvocationProtocolErrorCode,
    message: string,
  ) {
    super(message);
  }
}
