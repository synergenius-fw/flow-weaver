import {
  acceptExecutorChannelWireValue,
  assertExecutorChannelDirection,
  canonicalExecutorChannelMessage,
  decodeExecutorChannelFrame,
  encodeExecutorChannelFrame,
  type ExecutorChannelDirection,
  type ExecutorChannelFrame,
} from "./wire.js";
import {
  acceptExecutorChannelLimits,
  EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  type ExecutorChannelLimits,
} from "./limits.js";
import {
  bindExecutorCorrelationLedgerOwner,
  ExecutorCorrelationLedger,
  isExactExecutorCorrelationLedger,
} from "./invocation.js";
import {
  copyIntrinsicUint8Array,
  intrinsicAbortSignalState,
  intrinsicUint8ArrayLength,
} from "./intrinsics.js";
import {
  issueDurableAcknowledgementProof,
  type DurableAcknowledgementProof,
} from "./durable-acknowledgement.js";

export type ExecutorSessionState =
  | "disconnected"
  | "authenticating"
  | "recovering"
  | "active"
  | "draining"
  | "fenced"
  | "closed";

interface ExecutorSessionIdentityFields {
  readonly deploymentId: string;
  readonly consoleId: string;
  readonly executorId: string;
  readonly generation: number;
  readonly connectionEpoch: number;
  readonly supportedInterfaceVersions: readonly string[];
  readonly supportedEngineRanges: readonly string[];
  readonly transportIdentityDigest: `sha256:${string}`;
  readonly leaseExpiresAt: string;
}

/** Stable public name; protocolVersion selects the exact identity codec. */
export type ExecutorSessionIdentity = Readonly<
  ExecutorSessionIdentityFields &
    (
      | { readonly protocolVersion: 1 }
      | {
          readonly protocolVersion: 2;
          readonly supportedDeviceCapabilities: readonly string[];
        }
    )
>;

const SESSION_TRANSITIONS: Readonly<
  Record<ExecutorSessionState, readonly ExecutorSessionState[]>
> = Object.freeze({
  disconnected: ["authenticating", "closed"],
  authenticating: ["recovering", "fenced", "closed"],
  recovering: ["authenticating", "fenced", "closed"],
  active: ["authenticating", "draining", "fenced", "closed"],
  draining: ["fenced", "closed"],
  fenced: ["closed"],
  closed: [],
});
const exactReplayLedgers = new WeakSet<object>();
const exactInboundCursors = new WeakSet<object>();
const replayLedgerOwners = new WeakMap<object, object>();
const inboundCursorOwners = new WeakMap<object, object>();
const replayLedgerCorrelations = new WeakMap<
  object,
  ExecutorCorrelationLedger
>();
const correlationLedgerOutboxes = new WeakMap<object, DurableReplayLedger>();
const outboxAuthorities = new WeakMap<object, object>();

export interface ExecutorSessionSnapshot {
  readonly formatVersion: 1;
  readonly state: ExecutorSessionState;
  readonly identity: Readonly<ExecutorSessionIdentity> | null;
  readonly reconciliationComplete: boolean;
}

export class ExecutorSessionMachine {
  readonly #limits: ExecutorChannelLimits;
  #state: ExecutorSessionState = "disconnected";
  #identity?: Readonly<ExecutorSessionIdentity>;
  #deploymentId?: string;
  #consoleId?: string;
  #reconciliationComplete = false;

  constructor(
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ) {
    this.#limits = acceptExecutorChannelLimits(limits);
  }

  get state(): ExecutorSessionState {
    return this.#state;
  }

  get identity(): Readonly<ExecutorSessionIdentity> | undefined {
    return this.#identity;
  }

  snapshot(): Readonly<ExecutorSessionSnapshot> {
    return Object.freeze({
      formatVersion: 1,
      state: this.#state,
      identity: this.#identity ?? null,
      reconciliationComplete: this.#reconciliationComplete,
    });
  }

  static hydrate(
    input: unknown,
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ): ExecutorSessionMachine {
    const snapshot = snapshotRecord(
      input,
      ["formatVersion", "state", "identity", "reconciliationComplete"],
      "executor session snapshot",
    );
    if (
      snapshot.formatVersion !== 1 ||
      typeof snapshot.state !== "string" ||
      !Object.hasOwn(SESSION_TRANSITIONS, snapshot.state) ||
      typeof snapshot.reconciliationComplete !== "boolean"
    ) {
      throw new ExecutorReplayError(
        "malformed-snapshot",
        "executor session snapshot is malformed",
      );
    }
    const state = snapshot.state as ExecutorSessionState;
    let identity: Readonly<ExecutorSessionIdentity> | undefined;
    try {
      identity =
        snapshot.identity === null
          ? undefined
          : acceptSessionIdentity(snapshot.identity);
    } catch {
      throw new ExecutorReplayError(
        "malformed-snapshot",
        "executor session snapshot identity is malformed",
      );
    }
    if (
      (identity === undefined &&
        ["recovering", "active", "draining"].includes(state)) ||
      (identity !== undefined && state === "disconnected") ||
      (snapshot.reconciliationComplete === true &&
        state !== "active" &&
        state !== "draining") ||
      ((state === "active" || state === "draining") &&
        snapshot.reconciliationComplete !== true)
    ) {
      throw new ExecutorReplayError(
        "malformed-snapshot",
        "executor session snapshot state and identity are inconsistent",
      );
    }
    const machine = new ExecutorSessionMachine(limits);
    machine.#identity = identity;
    machine.#deploymentId = identity?.deploymentId;
    machine.#consoleId = identity?.consoleId;
    machine.#reconciliationComplete = false;
    machine.#state = ["recovering", "active", "draining"].includes(state)
      ? "authenticating"
      : state;
    return machine;
  }

  transition(next: ExecutorSessionState): void {
    if (!SESSION_TRANSITIONS[this.#state].includes(next)) {
      throw new ExecutorSessionError(
        "illegal-transition",
        `cannot transition executor session from ${this.#state} to ${next}`,
      );
    }
    this.#state = next;
    if (next !== "active" && next !== "draining") {
      this.#reconciliationComplete = false;
    }
  }

  publish(
    identity: ExecutorSessionIdentity,
    transport: AuthenticatedExecutorTransport,
    databaseNow: number,
  ): void {
    if (this.#state !== "authenticating") {
      throw new ExecutorSessionError(
        "illegal-transition",
        "session identity may be published only after authentication",
      );
    }
    const acceptedIdentity = acceptSessionIdentity(identity);
    if (
      (this.#deploymentId !== undefined &&
        acceptedIdentity.deploymentId !== this.#deploymentId) ||
      (this.#consoleId !== undefined &&
        acceptedIdentity.consoleId !== this.#consoleId)
    ) {
      throw new ExecutorSessionError(
        "cross-session",
        "one session machine is permanently bound to one deployment and console",
      );
    }
    if (
      this.#identity !== undefined &&
      acceptedIdentity.generation === this.#identity.generation &&
      acceptedIdentity.executorId !== this.#identity.executorId
    ) {
      throw new ExecutorSessionError(
        "cross-session",
        "a reconnect in one generation must retain the exact executor identity",
      );
    }
    const leaseExpiry = Date.parse(acceptedIdentity.leaseExpiresAt);
    if (
      !Number.isFinite(databaseNow) ||
      leaseExpiry <= databaseNow ||
      leaseExpiry > databaseNow + this.#limits.leaseDurationMs
    ) {
      throw new ExecutorSessionError(
        "invalid-lease",
        "published lease must be inside the host duration from database time",
      );
    }
    const transportState = authenticatedTransports.get(transport);
    if (
      transportState === undefined ||
      transport.peerIdentityDigest !== acceptedIdentity.transportIdentityDigest
    ) {
      throw new ExecutorSessionError(
        "unauthenticated-transport",
        "session publication requires the exact authenticated WSS transport identity",
      );
    }
    if (transportState.published) {
      throw new ExecutorSessionError(
        "transport-reused",
        "one authenticated transport capability may publish exactly one connection epoch",
      );
    }
    if (
      this.#identity !== undefined &&
      (acceptedIdentity.generation < this.#identity.generation ||
        (acceptedIdentity.generation === this.#identity.generation &&
          acceptedIdentity.connectionEpoch <= this.#identity.connectionEpoch))
    ) {
      throw new ExecutorSessionError(
        "stale-session",
        "session generation and connection epoch must advance monotonically",
      );
    }
    this.#identity = acceptedIdentity;
    this.#reconciliationComplete = false;
    this.#deploymentId ??= acceptedIdentity.deploymentId;
    this.#consoleId ??= acceptedIdentity.consoleId;
    transportState.published = true;
    this.transition("recovering");
  }

  admitFrame(
    input: Uint8Array,
    direction: ExecutorChannelDirection,
    cursor: InboundReplayCursor,
    correlations: ExecutorCorrelationLedger,
    outbox: DurableReplayLedger,
    databaseNow: number,
  ): Readonly<{
    frame: ExecutorChannelFrame;
    decision: InboundFrameDecision;
  }> {
    let frame: ExecutorChannelFrame;
    try {
      frame = decodeExecutorChannelFrame(input, this.#limits);
    } catch (error) {
      if (
        this.#state === "recovering" ||
        this.#state === "active" ||
        this.#state === "draining"
      ) {
        this.#fence();
      }
      throw error;
    }
    if (!Number.isSafeInteger(databaseNow) || databaseNow < 0) {
      throw new ExecutorSessionError(
        "invalid-lease",
        "frame admission requires valid database time",
      );
    }
    if (this.fenceExpiredLease(databaseNow)) {
      throw new ExecutorSessionError(
        "expired-lease",
        "an expired session was fenced before frame admission",
      );
    }
    if (
      this.#state !== "recovering" &&
      this.#state !== "active" &&
      this.#state !== "draining"
    ) {
      throw new ExecutorSessionError(
        "inactive-session",
        "frames are accepted only by a published live session",
      );
    }
    if (
      this.#identity === undefined ||
      frame.generation !== this.#identity.generation ||
      frame.connectionEpoch !== this.#identity.connectionEpoch
    ) {
      throw new ExecutorSessionError(
        "stale-session",
        "frame does not belong to the current generation and connection epoch",
      );
    }
    if (
      !isExactInboundReplayCursor(cursor) ||
      !isExactExecutorCorrelationLedger(correlations) ||
      !isExactDurableReplayLedger(outbox)
    ) {
      throw new ExecutorSessionError(
        "malformed-session",
        "frame admission requires the exact replay and correlation state machines",
      );
    }
    cursor.assertLimits(this.#limits);
    correlations.assertLimits(this.#limits);
    outbox.assertLimits(this.#limits);
    bindSessionStateOwner(cursor, inboundCursorOwners, this);
    bindExecutorCorrelationLedgerOwner(correlations, this);
    bindSessionStateOwner(outbox, replayLedgerOwners, this);
    bindOutboxCorrelationPair(outbox, correlations);
    try {
      assertExecutorChannelDirection(frame, direction, this.#limits);
      if (
        this.#state === "recovering" &&
        frame.kind !== "recovery.request" &&
        frame.kind !== "recovery.state" &&
        frame.kind !== "ack"
      ) {
        throw new ExecutorSessionError(
          "recovery-required",
          "recovering sessions admit only recovery and acknowledgement frames",
        );
      }
      if (this.#state === "draining" && frame.kind === "invocation.offer") {
        throw new ExecutorSessionError(
          "draining-session",
          "draining sessions cannot admit new invocation offers",
        );
      }
      const candidateCursor = InboundReplayCursor.hydrate(
        cursor.snapshot(),
        this.#limits,
      );
      const candidateCorrelations = ExecutorCorrelationLedger.hydrate(
        correlations.snapshot(),
        this.#limits,
      );
      applyFrameToDurableSessionState(
        frame,
        direction,
        candidateCursor,
        candidateCorrelations,
        databaseNow,
      );
      validateFrameAgainstDurableOutbox(frame, outbox, databaseNow);
      candidateCorrelations.assertCanApplyDurableAcknowledgementFrames(
        acknowledgedFramesForFrame(frame, outbox),
      );

      const acknowledgement = applyFrameToDurableOutbox(
        frame,
        outbox,
        databaseNow,
      );
      const decision = applyFrameToDurableSessionState(
        frame,
        direction,
        cursor,
        correlations,
        databaseNow,
      );
      if (acknowledgement !== undefined) {
        correlations.applyDurableAcknowledgement(acknowledgement);
      }
      if (decision.kind === "apply" && frame.kind === "recovery.state") {
        this.#reconciliationComplete = true;
      }
      return Object.freeze({ frame, decision });
    } catch (error) {
      this.#fence();
      throw error;
    }
  }

  activate(): void {
    if (this.#state !== "recovering" || !this.#reconciliationComplete) {
      throw new ExecutorSessionError(
        "recovery-required",
        "session activation requires a completed durable recovery exchange",
      );
    }
    this.#state = "active";
  }

  #fence(): void {
    this.#state = "fenced";
    this.#reconciliationComplete = false;
  }

  renewLease(
    generation: number,
    connectionEpoch: number,
    leaseExpiresAt: string,
    databaseNow: number,
  ): void {
    if (
      (this.#state !== "recovering" && this.#state !== "active") ||
      this.#identity === undefined
    ) {
      throw new ExecutorSessionError(
        "inactive-session",
        "only a current live session may renew its lease",
      );
    }
    if (
      generation !== this.#identity.generation ||
      connectionEpoch !== this.#identity.connectionEpoch
    ) {
      throw new ExecutorSessionError(
        "stale-session",
        "stale generation or connection epoch cannot renew a lease",
      );
    }
    const expiry = Date.parse(leaseExpiresAt);
    const priorExpiry = Date.parse(this.#identity.leaseExpiresAt);
    if (
      !Number.isFinite(databaseNow) ||
      !Number.isFinite(expiry) ||
      new Date(expiry).toISOString() !== leaseExpiresAt ||
      expiry <= databaseNow ||
      expiry <= priorExpiry ||
      expiry > databaseNow + this.#limits.leaseDurationMs
    ) {
      throw new ExecutorSessionError(
        "invalid-lease",
        "renewed lease must advance within the host duration from database time",
      );
    }
    this.#identity = Object.freeze({
      ...this.#identity,
      leaseExpiresAt,
    });
  }

  fenceExpiredLease(databaseNow: number): boolean {
    if (!Number.isSafeInteger(databaseNow) || databaseNow < 0) {
      throw new ExecutorSessionError(
        "invalid-lease",
        "lease fencing requires valid database time",
      );
    }
    if (
      this.#identity === undefined ||
      this.#state === "fenced" ||
      this.#state === "closed"
    ) {
      return false;
    }
    if (databaseNow < Date.parse(this.#identity.leaseExpiresAt)) return false;
    if (
      this.#state !== "authenticating" &&
      this.#state !== "recovering" &&
      this.#state !== "active" &&
      this.#state !== "draining"
    ) {
      return false;
    }
    this.#fence();
    return true;
  }
}

function applyFrameToDurableSessionState(
  frame: ExecutorChannelFrame,
  direction: ExecutorChannelDirection,
  cursor: InboundReplayCursor,
  correlations: ExecutorCorrelationLedger,
  databaseNow: number,
): InboundFrameDecision {
  if (frame.kind === "recovery.request" || frame.kind === "recovery.state") {
    cursor.assertPeerSentThrough(
      (frame.payload as { sentThrough: number }).sentThrough,
    );
  }
  const decision = cursor.accept(frame);
  if (decision.kind === "apply") {
    correlations.accept(frame, direction, databaseNow);
  }
  return decision;
}

function acknowledgedFramesForFrame(
  frame: ExecutorChannelFrame,
  outbox: DurableReplayLedger,
): readonly ExecutorChannelFrame[] {
  if (frame.kind === "ack") {
    return outbox.acknowledgedFrames(
      (frame.payload as { throughSequence: number }).throughSequence,
    );
  }
  if (frame.kind === "recovery.request" || frame.kind === "recovery.state") {
    return outbox.acknowledgedFrames(
      (frame.payload as { receivedThrough: number }).receivedThrough,
    );
  }
  return Object.freeze([]);
}

function isExactDurableReplayLedger(
  value: unknown,
): value is DurableReplayLedger {
  return (
    typeof value === "object" &&
    value !== null &&
    exactReplayLedgers.has(value) &&
    Object.getPrototypeOf(value) === DurableReplayLedger.prototype
  );
}

function isExactInboundReplayCursor(
  value: unknown,
): value is InboundReplayCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    exactInboundCursors.has(value) &&
    Object.getPrototypeOf(value) === InboundReplayCursor.prototype
  );
}

function bindSessionStateOwner(
  value: object,
  owners: WeakMap<object, object>,
  owner: object,
): void {
  const prior = owners.get(value);
  if (prior !== undefined && prior !== owner) {
    throw new ExecutorSessionError(
      "malformed-session",
      "durable state object belongs to another executor session",
    );
  }
  owners.set(value, owner);
}

function bindOutboxCorrelationPair(
  outbox: DurableReplayLedger,
  correlations: ExecutorCorrelationLedger,
): void {
  const priorCorrelations = replayLedgerCorrelations.get(outbox);
  const priorOutbox = correlationLedgerOutboxes.get(correlations);
  if (
    (priorCorrelations !== undefined && priorCorrelations !== correlations) ||
    (priorOutbox !== undefined && priorOutbox !== outbox)
  ) {
    throw new ExecutorSessionError(
      "malformed-session",
      "outbox and correlation ledger must retain one exact durable pairing",
    );
  }
  replayLedgerCorrelations.set(outbox, correlations);
  correlationLedgerOutboxes.set(correlations, outbox);
  if (!outboxAuthorities.has(outbox)) {
    outboxAuthorities.set(outbox, Object.freeze({}));
  }
}

function applyFrameToDurableOutbox(
  frame: ExecutorChannelFrame,
  outbox: DurableReplayLedger,
  databaseNow: number,
): DurableAcknowledgementProof | undefined {
  if (frame.kind === "ack") {
    return outbox.acknowledge(
      (frame.payload as { throughSequence: number }).throughSequence,
      databaseNow,
      outboxAuthorities.get(outbox),
    );
  } else if (
    frame.kind === "recovery.request" ||
    frame.kind === "recovery.state"
  ) {
    return outbox.reconcileAcknowledgement(
      (frame.payload as { receivedThrough: number }).receivedThrough,
      databaseNow,
      outboxAuthorities.get(outbox),
    );
  }
  return undefined;
}

function validateFrameAgainstDurableOutbox(
  frame: ExecutorChannelFrame,
  outbox: DurableReplayLedger,
  databaseNow: number,
): void {
  if (frame.kind === "ack") {
    outbox.assertCanAcknowledge(
      (frame.payload as { throughSequence: number }).throughSequence,
      databaseNow,
    );
  } else if (
    frame.kind === "recovery.request" ||
    frame.kind === "recovery.state"
  ) {
    outbox.assertCanReconcileAcknowledgement(
      (frame.payload as { receivedThrough: number }).receivedThrough,
      databaseNow,
    );
  }
}

export class ExecutorAuthenticationInbox {
  readonly #limits: ExecutorChannelLimits;
  readonly #frames: Uint8Array[] = [];
  #bytes = 0;
  #authenticated = false;

  constructor(
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ) {
    this.#limits = acceptExecutorChannelLimits(limits);
  }

  retain(frame: Uint8Array): void {
    if (this.#authenticated) {
      throw new ExecutorSessionError(
        "illegal-transition",
        "authenticated frames cannot enter the authentication inbox",
      );
    }
    const byteLength = intrinsicUint8ArrayLength(frame);
    if (byteLength === undefined) {
      throw new ExecutorSessionError(
        "malformed-session",
        "authentication inbox accepts only Uint8Array frames",
      );
    }
    if (
      this.#frames.length >= this.#limits.maxAuthenticationInboxFrames ||
      this.#bytes + byteLength > this.#limits.maxAuthenticationInboxBytes
    ) {
      this.clear();
      throw new ExecutorSessionError(
        "authentication-flood",
        "pre-authentication inbox limit exceeded",
      );
    }
    const retained = copyIntrinsicUint8Array(frame, byteLength);
    this.#frames.push(retained);
    this.#bytes += retained.byteLength;
  }

  authenticate(): void {
    if (this.#authenticated) {
      throw new ExecutorSessionError(
        "illegal-transition",
        "authentication inbox was already consumed",
      );
    }
    this.#authenticated = true;
    this.clear();
  }

  clear(): void {
    this.#frames.splice(0);
    this.#bytes = 0;
  }
}

function acceptSessionIdentity(
  input: unknown,
): Readonly<ExecutorSessionIdentity> {
  if (
    input === null ||
    typeof input !== "object" ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null)
  ) {
    throw new ExecutorSessionError(
      "malformed-session",
      "session identity must be a plain object",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.values(descriptors).some(
      (field) => !Object.hasOwn(field, "value") || field.enumerable !== true,
    )
  ) {
    throw new ExecutorSessionError(
      "malformed-session",
      "session identity has missing, unknown, accessor, or hidden fields",
    );
  }
  const protocolVersion = descriptors["protocolVersion"]?.value;
  const expected = [
    "deploymentId",
    "consoleId",
    "executorId",
    "generation",
    "connectionEpoch",
    "protocolVersion",
    "supportedInterfaceVersions",
    "supportedEngineRanges",
    "transportIdentityDigest",
    "leaseExpiresAt",
    ...(protocolVersion === 2 ? ["supportedDeviceCapabilities"] : []),
  ].sort();
  const fields = Reflect.ownKeys(descriptors);
  if (
    fields.some((field) => typeof field !== "string") ||
    JSON.stringify([...fields].sort()) !== JSON.stringify(expected)
  ) {
    throw new ExecutorSessionError(
      "malformed-session",
      "session identity has missing, unknown, accessor, or hidden fields",
    );
  }
  const identity = Object.fromEntries(
    Object.entries(descriptors).map(([name, field]) => [name, field.value]),
  ) as ExecutorSessionIdentity;
  for (const [name, value] of [
    ["deploymentId", identity.deploymentId],
    ["consoleId", identity.consoleId],
    ["executorId", identity.executorId],
  ] as const) {
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.length > 128
    ) {
      throw new ExecutorSessionError(
        "malformed-session",
        `${name} must be a non-empty bounded identity`,
      );
    }
  }
  if (
    !Number.isSafeInteger(identity.generation) ||
    identity.generation <= 0 ||
    !Number.isSafeInteger(identity.connectionEpoch) ||
    identity.connectionEpoch <= 0 ||
    (identity.protocolVersion !== 1 && identity.protocolVersion !== 2)
  ) {
    throw new ExecutorSessionError(
      "malformed-session",
      "generation, connectionEpoch, and protocolVersion are invalid",
    );
  }
  const acceptedCompatibility = new Map<string, readonly string[]>();
  for (const [name, values] of [
    ["supportedInterfaceVersions", identity.supportedInterfaceVersions],
    ["supportedEngineRanges", identity.supportedEngineRanges],
  ] as const) {
    const acceptedValues = acceptExecutorChannelWireValue(values);
    if (
      !Array.isArray(acceptedValues) ||
      acceptedValues.length === 0 ||
      acceptedValues.length > 64 ||
      acceptedValues.some(
        (value) =>
          typeof value !== "string" ||
          value.trim().length === 0 ||
          value.length > 128,
      )
    ) {
      throw new ExecutorSessionError(
        "malformed-session",
        `${name} must contain 1-64 bounded compatibility identifiers`,
      );
    }
    acceptedCompatibility.set(name, acceptedValues as readonly string[]);
  }
  let supportedDeviceCapabilities: readonly string[] | undefined;
  if (identity.protocolVersion === 2) {
    const acceptedValues = acceptExecutorChannelWireValue(
      identity.supportedDeviceCapabilities,
    );
    if (
      !Array.isArray(acceptedValues) ||
      acceptedValues.length > 64 ||
      acceptedValues.some(
        (value) =>
          typeof value !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/.test(value),
      ) ||
      acceptedValues.some(
        (value, index) => index > 0 && acceptedValues[index - 1]! >= value,
      )
    ) {
      throw new ExecutorSessionError(
        "malformed-session",
        "supportedDeviceCapabilities must be a sorted unique bounded compatibility list",
      );
    }
    supportedDeviceCapabilities = Object.freeze([
      ...(acceptedValues as readonly string[]),
    ]);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(identity.transportIdentityDigest)) {
    throw new ExecutorSessionError(
      "malformed-session",
      "transportIdentityDigest must use canonical sha256 form",
    );
  }
  const lease = Date.parse(identity.leaseExpiresAt);
  if (
    !Number.isFinite(lease) ||
    new Date(lease).toISOString() !== identity.leaseExpiresAt
  ) {
    throw new ExecutorSessionError(
      "malformed-session",
      "leaseExpiresAt must be an exact ISO UTC timestamp",
    );
  }
  return Object.freeze({
    ...identity,
    supportedInterfaceVersions: acceptedCompatibility.get(
      "supportedInterfaceVersions",
    )!,
    supportedEngineRanges: acceptedCompatibility.get("supportedEngineRanges")!,
    ...(supportedDeviceCapabilities === undefined
      ? {}
      : { supportedDeviceCapabilities }),
  });
}

export interface ReplayRecord {
  readonly sequence: number;
  readonly messageId: string;
  readonly canonicalDigest: string;
  readonly frame: ExecutorChannelFrame;
  readonly encodedBytes: number;
  readonly retainedAt: number;
}

export interface DurableReplayLedgerSnapshot {
  readonly formatVersion: 1;
  readonly acknowledgedThrough: number;
  readonly lastRetainedAt: number;
  readonly records: readonly {
    readonly frame: ExecutorChannelFrame;
    readonly retainedAt: number;
  }[];
}

export class DurableReplayLedger {
  readonly #limits: ExecutorChannelLimits;
  readonly #records = new Map<number, ReplayRecord>();
  readonly #messageIds = new Map<string, string>();
  #acknowledgedThrough = 0;
  #retainedBytes = 0;
  #lastRetainedAt = 0;

  constructor(
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ) {
    this.#limits = acceptExecutorChannelLimits(limits);
    exactReplayLedgers.add(this);
  }

  get acknowledgedThrough(): number {
    return this.#acknowledgedThrough;
  }

  snapshot(): Readonly<DurableReplayLedgerSnapshot> {
    return Object.freeze({
      formatVersion: 1,
      acknowledgedThrough: this.#acknowledgedThrough,
      lastRetainedAt: this.#lastRetainedAt,
      records: Object.freeze(
        [...this.#records.values()]
          .sort((left, right) => left.sequence - right.sequence)
          .map((record) =>
            Object.freeze({
              frame: record.frame,
              retainedAt: record.retainedAt,
            }),
          ),
      ),
    });
  }

  static hydrate(
    input: unknown,
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ): DurableReplayLedger {
    const snapshot = snapshotRecord(
      input,
      ["formatVersion", "acknowledgedThrough", "lastRetainedAt", "records"],
      "replay ledger snapshot",
    );
    if (
      snapshot.formatVersion !== 1 ||
      !Number.isSafeInteger(snapshot.acknowledgedThrough) ||
      (snapshot.acknowledgedThrough as number) < 0 ||
      !Number.isSafeInteger(snapshot.lastRetainedAt) ||
      (snapshot.lastRetainedAt as number) < 0 ||
      !Array.isArray(snapshot.records)
    ) {
      throw new ExecutorReplayError(
        "malformed-snapshot",
        "replay ledger snapshot is malformed",
      );
    }
    const ledger = new DurableReplayLedger(limits);
    ledger.#acknowledgedThrough = snapshot.acknowledgedThrough as number;
    for (const retainedValue of snapshotArray(
      snapshot.records,
      ledger.#limits.maxReplayFrames,
    )) {
      const retained = snapshotRecord(
        retainedValue,
        ["frame", "retainedAt"],
        "retained replay record",
      );
      if (
        !Number.isSafeInteger(retained.retainedAt) ||
        (retained.retainedAt as number) < 0
      ) {
        throw new ExecutorReplayError(
          "malformed-snapshot",
          "retained replay timestamp is malformed",
        );
      }
      const encoded = encodeExecutorChannelFrame(
        retained.frame as unknown as ExecutorChannelFrame,
        ledger.#limits,
      );
      ledger.append(
        decodeExecutorChannelFrame(encoded, ledger.#limits),
        retained.retainedAt as number,
      );
    }
    if (
      ledger.#records.size > 0 &&
      ledger.#lastRetainedAt !== snapshot.lastRetainedAt
    ) {
      throw new ExecutorReplayError(
        "malformed-snapshot",
        "replay snapshot clock does not match its newest retained record",
      );
    }
    ledger.#lastRetainedAt = snapshot.lastRetainedAt as number;
    return ledger;
  }

  append(frame: ExecutorChannelFrame, now: number): void {
    if (!Number.isSafeInteger(now) || now < 0 || now < this.#lastRetainedAt) {
      throw new ExecutorReplayError(
        "invalid-clock",
        "replay retention time must be a non-negative safe integer",
      );
    }
    const encoded = encodeExecutorChannelFrame(frame, this.#limits);
    const acceptedFrame = decodeExecutorChannelFrame(encoded, this.#limits);
    const expected =
      this.#records.size === 0
        ? this.#acknowledgedThrough + 1
        : Math.max(...this.#records.keys()) + 1;
    if (acceptedFrame.sequence !== expected) {
      throw new ExecutorReplayError(
        "sequence-gap",
        `outbox sequence ${acceptedFrame.sequence} does not follow ${expected - 1}`,
      );
    }
    if (
      this.#records.size >= this.#limits.maxReplayFrames ||
      this.#retainedBytes + encoded.byteLength > this.#limits.maxReplayBytes
    ) {
      throw new ExecutorReplayError(
        "outbox-exhausted",
        "durable replay outbox limit exceeded",
      );
    }
    const digest = canonicalExecutorChannelMessage(acceptedFrame, this.#limits);
    const existingMessage = this.#messageIds.get(acceptedFrame.messageId);
    if (existingMessage !== undefined) {
      throw new ExecutorReplayError(
        "duplicate-message",
        existingMessage === digest
          ? "outbound message identity must be replayed from its existing record"
          : "outbound message identity conflicts with different logical content",
      );
    }
    const record = Object.freeze({
      sequence: acceptedFrame.sequence,
      messageId: acceptedFrame.messageId,
      canonicalDigest: digest,
      frame: acceptedFrame,
      encodedBytes: encoded.byteLength,
      retainedAt: now,
    });
    this.#records.set(acceptedFrame.sequence, record);
    this.#messageIds.set(acceptedFrame.messageId, digest);
    this.#retainedBytes += encoded.byteLength;
    this.#lastRetainedAt = now;
  }

  acknowledge(
    throughSequence: number,
    now: number,
    authority: object | undefined,
  ): DurableAcknowledgementProof {
    this.#assertMutationAuthority(authority);
    this.assertCanAcknowledge(throughSequence, now);
    return this.#applyAcknowledgement(throughSequence);
  }

  reconcileAcknowledgement(
    throughSequence: number,
    now: number,
    authority: object | undefined,
  ): DurableAcknowledgementProof {
    this.#assertMutationAuthority(authority);
    const records = this.#assertAcknowledgementCursor(throughSequence, now);
    if (
      records.some(
        (record) => now - record.retainedAt > this.#limits.replayLifetimeMs,
      )
    ) {
      throw new ExecutorReplayError(
        "replay-expired",
        "recovery acknowledgement refers to an expired replay record",
      );
    }
    return this.#applyAcknowledgement(throughSequence);
  }

  #assertMutationAuthority(authority: object | undefined): void {
    const accepted = outboxAuthorities.get(this);
    if (accepted === undefined || authority !== accepted) {
      throw new ExecutorReplayError(
        "unauthorized-ack",
        "outbox mutation requires its exact authenticated session authority",
      );
    }
  }

  assertCanReconcileAcknowledgement(
    throughSequence: number,
    now: number,
  ): void {
    const records = this.#assertAcknowledgementCursor(throughSequence, now);
    if (
      records.some(
        (record) => now - record.retainedAt > this.#limits.replayLifetimeMs,
      )
    ) {
      throw new ExecutorReplayError(
        "replay-expired",
        "recovery acknowledgement refers to an expired replay record",
      );
    }
  }

  #applyAcknowledgement(throughSequence: number): DurableAcknowledgementProof {
    const acknowledgedFrames = this.acknowledgedFrames(throughSequence);
    for (const [sequence, record] of this.#records) {
      if (sequence <= throughSequence) {
        this.#records.delete(sequence);
        this.#messageIds.delete(record.messageId);
        this.#retainedBytes -= record.encodedBytes;
      }
    }
    this.#acknowledgedThrough = throughSequence;
    return issueDurableAcknowledgementProof(
      acknowledgedFrames,
      replayLedgerCorrelations.get(this),
    );
  }

  acknowledgedFrames(throughSequence: number): readonly ExecutorChannelFrame[] {
    return Object.freeze(
      [...this.#records.values()]
        .filter((record) => record.sequence <= throughSequence)
        .sort((left, right) => left.sequence - right.sequence)
        .map((record) => record.frame),
    );
  }

  assertCanAcknowledge(throughSequence: number, now: number): void {
    const records = this.#assertAcknowledgementCursor(throughSequence, now);
    if (
      records.some(
        (record) =>
          now - record.retainedAt > this.#limits.acknowledgementDeadlineMs,
      )
    ) {
      throw new ExecutorReplayError(
        "ack-expired",
        "acknowledgement arrived outside the accepted database-time window",
      );
    }
  }

  #assertAcknowledgementCursor(
    throughSequence: number,
    now: number,
  ): readonly ReplayRecord[] {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new ExecutorReplayError(
        "invalid-clock",
        "acknowledgement requires valid database time",
      );
    }
    if (
      !Number.isSafeInteger(throughSequence) ||
      throughSequence < this.#acknowledgedThrough
    ) {
      throw new ExecutorReplayError(
        "stale-ack",
        "acknowledgement cursor cannot move backwards",
      );
    }
    const highest =
      this.#records.size === 0
        ? this.#acknowledgedThrough
        : Math.max(...this.#records.keys());
    if (throughSequence > highest) {
      throw new ExecutorReplayError(
        "future-ack",
        "acknowledgement cannot advance beyond the sent cursor",
      );
    }
    const records = [...this.#records.values()].filter(
      (record) => record.sequence <= throughSequence,
    );
    if (records.some((record) => record.retainedAt > now)) {
      throw new ExecutorReplayError(
        "invalid-clock",
        "acknowledgement database time predates a retained record",
      );
    }
    return records;
  }

  get sentThrough(): number {
    return this.#records.size === 0
      ? this.#acknowledgedThrough
      : Math.max(...this.#records.keys());
  }

  assertLimits(limits: ExecutorChannelLimits): void {
    const accepted = acceptExecutorChannelLimits(limits);
    if (
      (Object.keys(accepted) as (keyof ExecutorChannelLimits)[]).some(
        (key) => accepted[key] !== this.#limits[key],
      )
    ) {
      throw new ExecutorReplayError(
        "wrong-policy",
        "durable outbox policy does not match its session",
      );
    }
  }

  replay(afterSequence: number, now: number): readonly ReplayRecord[] {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new ExecutorReplayError(
        "invalid-clock",
        "recovery time must be a non-negative safe integer",
      );
    }
    if (
      !Number.isSafeInteger(afterSequence) ||
      afterSequence < this.#acknowledgedThrough
    ) {
      throw new ExecutorReplayError(
        "stale-cursor",
        "recovery cursor is older than retained acknowledgement state",
      );
    }
    const records = [...this.#records.values()]
      .filter((record) => record.sequence > afterSequence)
      .sort((left, right) => left.sequence - right.sequence);
    const highest =
      this.#records.size === 0
        ? this.#acknowledgedThrough
        : Math.max(...this.#records.keys());
    if (afterSequence > highest) {
      throw new ExecutorReplayError(
        "future-cursor",
        "recovery cursor cannot advance beyond the sent cursor",
      );
    }
    if (records.length > this.#limits.cursorWindow) {
      throw new ExecutorReplayError(
        "cursor-window",
        "recovery cursor is outside the bounded replay window",
      );
    }
    if (
      records.some(
        (record) =>
          record.retainedAt > now ||
          now - record.retainedAt > this.#limits.replayLifetimeMs,
      )
    ) {
      throw new ExecutorReplayError(
        "replay-expired",
        "recovery requires a replay record that has expired",
      );
    }
    return Object.freeze(records.slice(0, this.#limits.recoveryBatchSize));
  }

  replayForConnection(
    afterSequence: number,
    connectionEpoch: number,
    now: number,
  ): readonly ReplayRecord[] {
    if (!Number.isSafeInteger(connectionEpoch) || connectionEpoch <= 0) {
      throw new ExecutorReplayError(
        "stale-cursor",
        "connection epoch must be a positive safe integer",
      );
    }
    return Object.freeze(
      this.replay(afterSequence, now).map((record) => {
        const encoded = encodeExecutorChannelFrame(
          { ...record.frame, connectionEpoch },
          this.#limits,
        );
        const frame = decodeExecutorChannelFrame(encoded, this.#limits);
        return Object.freeze({
          ...record,
          frame,
          encodedBytes: encoded.byteLength,
        });
      }),
    );
  }
}

export type InboundFrameDecision =
  | { readonly kind: "apply"; readonly cursor: number }
  | { readonly kind: "duplicate"; readonly cursor: number }
  | { readonly kind: "recover"; readonly expectedSequence: number };

export class InboundReplayCursor {
  readonly #recent = new Map<number, string>();
  readonly #messageIds = new Map<
    string,
    { sequence: number; digest: string }
  >();
  readonly #limits: Readonly<ExecutorChannelLimits>;
  #cursor = 0;

  constructor(
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ) {
    this.#limits = acceptExecutorChannelLimits(limits);
    exactInboundCursors.add(this);
  }

  get window(): number {
    return this.#limits.cursorWindow;
  }

  get cursor(): number {
    return this.#cursor;
  }

  snapshot(): Readonly<InboundReplayCursorSnapshot> {
    return Object.freeze({
      formatVersion: 1,
      cursor: this.#cursor,
      recent: Object.freeze(
        [...this.#recent.entries()]
          .sort(([left], [right]) => left - right)
          .map(([sequence, digest]) => {
            const message = [...this.#messageIds.entries()].find(
              ([, retained]) =>
                retained.sequence === sequence && retained.digest === digest,
            );
            return Object.freeze({
              sequence,
              messageId: message?.[0] ?? "",
              digest,
            });
          }),
      ),
    });
  }

  static hydrate(
    input: unknown,
    limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  ): InboundReplayCursor {
    const acceptedLimits = acceptExecutorChannelLimits(limits);
    const window = acceptedLimits.cursorWindow;
    const snapshot = snapshotRecord(
      input,
      ["formatVersion", "cursor", "recent"],
      "inbound cursor snapshot",
    );
    if (
      snapshot.formatVersion !== 1 ||
      !Number.isSafeInteger(snapshot.cursor) ||
      (snapshot.cursor as number) < 0 ||
      !Array.isArray(snapshot.recent) ||
      snapshot.recent.length > window ||
      snapshot.recent.length > (snapshot.cursor as number)
    ) {
      throw new ExecutorReplayError(
        "malformed-snapshot",
        "inbound cursor snapshot is malformed",
      );
    }
    const cursor = new InboundReplayCursor(acceptedLimits);
    cursor.#cursor = snapshot.cursor as number;
    const expectedFirst = cursor.#cursor - snapshot.recent.length + 1;
    const seenMessageIds = new Set<string>();
    snapshotArray(snapshot.recent, window).forEach((retainedValue, index) => {
      const retained = snapshotRecord(
        retainedValue,
        ["sequence", "messageId", "digest"],
        "inbound cursor record",
      );
      const expectedSequence = expectedFirst + index;
      if (
        expectedSequence <= 0 ||
        retained.sequence !== expectedSequence ||
        !isCanonicalMessageIdentity(retained.messageId, expectedSequence) ||
        seenMessageIds.has(retained.messageId as string) ||
        typeof retained.digest !== "string" ||
        !/^[0-9a-f]{64}$/.test(retained.digest)
      ) {
        throw new ExecutorReplayError(
          "malformed-snapshot",
          "inbound cursor record is malformed or non-contiguous",
        );
      }
      seenMessageIds.add(retained.messageId as string);
      cursor.#recent.set(expectedSequence, retained.digest);
      cursor.#messageIds.set(retained.messageId, {
        sequence: expectedSequence,
        digest: retained.digest,
      });
    });
    return cursor;
  }

  accept(frame: ExecutorChannelFrame): InboundFrameDecision {
    const digest = canonicalExecutorChannelMessage(frame, this.#limits);
    const priorMessage = this.#messageIds.get(frame.messageId);
    if (
      priorMessage !== undefined &&
      (priorMessage.sequence !== frame.sequence ||
        priorMessage.digest !== digest)
    ) {
      throw new ExecutorReplayError(
        "conflicting-duplicate",
        "the same message identity was received with different logical content",
      );
    }
    if (frame.sequence <= this.#cursor) {
      const existing = this.#recent.get(frame.sequence);
      if (existing === digest) {
        return Object.freeze({ kind: "duplicate", cursor: this.#cursor });
      }
      throw new ExecutorReplayError(
        "conflicting-duplicate",
        "the same sequence was received with different canonical bytes",
      );
    }
    if (frame.sequence !== this.#cursor + 1) {
      if (frame.sequence - this.#cursor > this.window) {
        throw new ExecutorReplayError(
          "cursor-window",
          "inbound sequence gap is outside the bounded recovery window",
        );
      }
      return Object.freeze({
        kind: "recover",
        expectedSequence: this.#cursor + 1,
      });
    }
    this.#cursor = frame.sequence;
    this.#recent.set(frame.sequence, digest);
    this.#messageIds.set(frame.messageId, { sequence: frame.sequence, digest });
    while (this.#recent.size > this.window) {
      const oldest = Math.min(...this.#recent.keys());
      const oldestDigest = this.#recent.get(oldest);
      this.#recent.delete(oldest);
      for (const [messageId, retained] of this.#messageIds) {
        if (retained.sequence === oldest && retained.digest === oldestDigest) {
          this.#messageIds.delete(messageId);
        }
      }
    }
    return Object.freeze({ kind: "apply", cursor: this.#cursor });
  }

  assertLimits(limits: ExecutorChannelLimits): void {
    const accepted = acceptExecutorChannelLimits(limits);
    if (
      (Object.keys(accepted) as (keyof ExecutorChannelLimits)[]).some(
        (key) => accepted[key] !== this.#limits[key],
      )
    ) {
      throw new ExecutorReplayError(
        "wrong-policy",
        "inbound cursor policy does not match its session",
      );
    }
  }

  assertPeerSentThrough(sentThrough: number): void {
    if (
      !Number.isSafeInteger(sentThrough) ||
      sentThrough < this.#cursor ||
      sentThrough - this.#cursor > this.window
    ) {
      throw new ExecutorReplayError(
        "cursor-window",
        "peer sent cursor is stale or outside the recovery window",
      );
    }
  }
}

function isCanonicalMessageIdentity(
  value: unknown,
  sequence: number,
): value is string {
  if (typeof value !== "string" || value.length > 128) return false;
  const match = value.match(/^g([1-9]\d*):s([1-9]\d*):([A-Za-z0-9._:-]+)$/);
  if (match === null) return false;
  const generation = Number(match[1]);
  const encodedSequence = Number(match[2]);
  return (
    Number.isSafeInteger(generation) &&
    Number.isSafeInteger(encodedSequence) &&
    encodedSequence === sequence
  );
}

export interface InboundReplayCursorSnapshot {
  readonly formatVersion: 1;
  readonly cursor: number;
  readonly recent: readonly {
    readonly sequence: number;
    readonly messageId: string;
    readonly digest: string;
  }[];
}

function snapshotRecord(
  value: unknown,
  exactKeys: readonly string[],
  name: string,
): { readonly [key: string]: unknown } {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new ExecutorReplayError(
      "malformed-snapshot",
      `${name} must be an object`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (field) => !Object.hasOwn(field, "value") || field.enumerable !== true,
    )
  ) {
    throw new ExecutorReplayError(
      "malformed-snapshot",
      `${name} contains accessor, symbol, or hidden fields`,
    );
  }
  const keys = (ownKeys as string[]).sort();
  const expected = [...exactKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new ExecutorReplayError(
      "malformed-snapshot",
      `${name} has missing or unknown fields`,
    );
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [
      key,
      descriptor.value,
    ]),
  );
}

function snapshotArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ExecutorReplayError(
      "malformed-snapshot",
      "snapshot array is malformed or outside bounds",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors).filter((key) => key !== "length");
  if (
    keys.length !== value.length ||
    keys.some(
      (key, index) =>
        typeof key !== "string" ||
        key !== String(index) ||
        descriptors[key] === undefined ||
        !Object.hasOwn(descriptors[key], "value") ||
        descriptors[key].enumerable !== true,
    )
  ) {
    throw new ExecutorReplayError(
      "malformed-snapshot",
      "snapshot arrays must be dense data-only arrays",
    );
  }
  return (keys as string[]).map((key) => descriptors[key]!.value);
}

export function assertCredentialAuthenticatedWssEndpoint(
  endpoint: string,
): URL {
  if (typeof endpoint !== "string") {
    throw new ExecutorSessionError(
      "insecure-transport",
      "executor endpoint must be a string WSS URL",
    );
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ExecutorSessionError(
      "insecure-transport",
      "executor endpoint is invalid",
    );
  }
  if (
    url.protocol !== "wss:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ExecutorSessionError(
      "insecure-transport",
      "executor transport requires credential-authenticated WSS with no URL credentials, query, or fragment",
    );
  }
  return url;
}

export interface ExecutorCredentialProvider {
  getAuthorizationHeader(signal?: AbortSignal): Promise<string>;
}

const authenticatedTransports = new WeakMap<object, { published: boolean }>();

export interface AuthenticatedExecutorTransport {
  readonly endpoint: string;
  readonly peerIdentityDigest: `sha256:${string}`;
}

export interface ExecutorWssAuthenticator {
  authenticate(
    endpoint: URL,
    authorizationHeader: string,
    signal?: AbortSignal,
  ): Promise<{ readonly peerIdentityDigest: `sha256:${string}` }>;
}

export async function openCredentialAuthenticatedWss(
  endpoint: string,
  credentialProvider: ExecutorCredentialProvider,
  authenticator: ExecutorWssAuthenticator,
  signal?: AbortSignal,
): Promise<AuthenticatedExecutorTransport> {
  const url = assertCredentialAuthenticatedWssEndpoint(endpoint);
  const canonicalEndpoint = url.href;
  const authorization = await loadExecutorAuthorization(
    credentialProvider,
    signal,
  );
  const authenticated = await authenticator.authenticate(
    new URL(canonicalEndpoint),
    authorization,
    signal,
  );
  acceptOptionalSessionSignal(signal);
  if (intrinsicAbortSignalState(signal) === true) {
    throw new ExecutorSessionError(
      "authentication-cancelled",
      "authentication cancelled",
    );
  }
  const peerIdentityDigest = acceptAuthenticatedPeerIdentity(authenticated);
  const transport = Object.freeze({
    endpoint: canonicalEndpoint,
    peerIdentityDigest,
  });
  authenticatedTransports.set(transport, { published: false });
  return transport;
}

/**
 * Accept one inbound executor WebSocket after the deployment has supplied the
 * public WSS endpoint and the peer's HTTP Authorization header.
 *
 * This is the host-side counterpart to `openCredentialAuthenticatedWss`.
 * It deliberately does not parse an HTTP request, select a credential, or
 * decide which executor is allowed to connect. Those are deployment concerns.
 * It only validates the same bounded credential form, invokes the deployment
 * verifier, and brands the resulting authenticated transport so a session
 * machine can publish exactly one connection epoch from real peer evidence.
 */
export async function acceptCredentialAuthenticatedWss(
  endpoint: string,
  authorizationHeader: string,
  authenticator: ExecutorWssAuthenticator,
  signal?: AbortSignal,
): Promise<AuthenticatedExecutorTransport> {
  const url = assertCredentialAuthenticatedWssEndpoint(endpoint);
  const authorization = acceptExecutorAuthorization(authorizationHeader);
  acceptOptionalSessionSignal(signal);
  const authenticated = await authenticator.authenticate(
    new URL(url.href),
    authorization,
    signal,
  );
  acceptOptionalSessionSignal(signal);
  if (intrinsicAbortSignalState(signal) === true) {
    throw new ExecutorSessionError(
      "authentication-cancelled",
      "authentication cancelled",
    );
  }
  const peerIdentityDigest = acceptAuthenticatedPeerIdentity(authenticated);
  const transport = Object.freeze({
    endpoint: url.href,
    peerIdentityDigest,
  });
  authenticatedTransports.set(transport, { published: false });
  return transport;
}

export async function loadExecutorAuthorization(
  provider: ExecutorCredentialProvider,
  signal?: AbortSignal,
): Promise<string> {
  const initialSignalState = acceptOptionalSessionSignal(signal);
  if (initialSignalState === true) {
    throw new ExecutorSessionError(
      "authentication-cancelled",
      "authentication cancelled",
    );
  }
  const header = await provider.getAuthorizationHeader(signal);
  if (acceptOptionalSessionSignal(signal) === true) {
    throw new ExecutorSessionError(
      "authentication-cancelled",
      "authentication cancelled",
    );
  }
  return acceptExecutorAuthorization(header);
}

function acceptExecutorAuthorization(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^Bearer [\x21-\x7e]{16,4096}$/.test(input) ||
    input.includes("\r") ||
    input.includes("\n")
  ) {
    throw new ExecutorSessionError(
      "malformed-credential",
      "credential must be one bounded Bearer authorization header",
    );
  }
  return input;
}

function acceptAuthenticatedPeerIdentity(input: unknown): `sha256:${string}` {
  if (
    input === null ||
    Array.isArray(input) ||
    typeof input !== "object" ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new ExecutorSessionError(
      "malformed-session",
      "authenticator result must be one exact data-only object",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const identity = descriptors.peerIdentityDigest;
  if (
    keys.length !== 1 ||
    keys[0] !== "peerIdentityDigest" ||
    identity === undefined ||
    !Object.hasOwn(identity, "value") ||
    identity.enumerable !== true ||
    typeof identity.value !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(identity.value)
  ) {
    throw new ExecutorSessionError(
      "malformed-session",
      "authenticated peer identity must be one canonical sha256 data field",
    );
  }
  return identity.value as `sha256:${string}`;
}

function acceptOptionalSessionSignal(input: unknown): boolean | undefined {
  if (input === undefined) return undefined;
  const state = intrinsicAbortSignalState(input);
  if (state === undefined || Object.hasOwn(input as object, "aborted")) {
    throw new ExecutorSessionError(
      "malformed-signal",
      "signal must be a standard Node AbortSignal",
    );
  }
  return state;
}

export type ExecutorSessionErrorCode =
  | "illegal-transition"
  | "inactive-session"
  | "stale-session"
  | "malformed-session"
  | "unauthenticated-transport"
  | "invalid-lease"
  | "transport-reused"
  | "cross-session"
  | "recovery-required"
  | "draining-session"
  | "insecure-transport"
  | "authentication-cancelled"
  | "authentication-flood"
  | "expired-lease"
  | "malformed-signal"
  | "malformed-credential";

export class ExecutorSessionError extends Error {
  readonly name = "ExecutorSessionError";

  constructor(
    readonly code: ExecutorSessionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ExecutorReplayErrorCode =
  | "sequence-gap"
  | "outbox-exhausted"
  | "stale-ack"
  | "future-ack"
  | "stale-cursor"
  | "cursor-window"
  | "replay-expired"
  | "conflicting-duplicate"
  | "duplicate-message"
  | "future-cursor"
  | "invalid-clock"
  | "ack-expired"
  | "unauthorized-ack"
  | "wrong-policy"
  | "malformed-snapshot";

export class ExecutorReplayError extends Error {
  readonly name = "ExecutorReplayError";

  constructor(
    readonly code: ExecutorReplayErrorCode,
    message: string,
  ) {
    super(message);
  }
}
