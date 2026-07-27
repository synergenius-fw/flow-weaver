import { createHash } from "node:crypto";
import {
  acceptExecutorChannelLimits,
  EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
  type ExecutorChannelLimits,
} from "./limits.js";
import { parseStrictJson, StrictJsonError } from "../runtime/strict-json.js";
import {
  copyIntrinsicUint8Array,
  intrinsicUint8ArrayLength,
} from "./intrinsics.js";

export type ExecutorChannelWireValue =
  | null
  | boolean
  | number
  | string
  | readonly ExecutorChannelWireValue[]
  | { readonly [key: string]: ExecutorChannelWireValue };

export const EXECUTOR_CHANNEL_FORMAT_VERSION = 1 as const;

export const EXECUTOR_CHANNEL_FRAME_KINDS = [
  "invocation.offer",
  "invocation.accepted",
  "invocation.refused",
  "invocation.event",
  "invocation.suspended",
  "invocation.completed",
  "invocation.cancel",
  "invocation.cancel-observed",
  "recovery.request",
  "recovery.state",
  "ack",
] as const;

export type ExecutorChannelFrameKind =
  (typeof EXECUTOR_CHANNEL_FRAME_KINDS)[number];
export type ExecutorChannelDirection = "host-to-executor" | "executor-to-host";

const HOST_ONLY_KINDS: ReadonlySet<ExecutorChannelFrameKind> = new Set([
  "invocation.offer",
  "invocation.cancel",
]);
const EXECUTOR_ONLY_KINDS: ReadonlySet<ExecutorChannelFrameKind> = new Set([
  "invocation.accepted",
  "invocation.refused",
  "invocation.event",
  "invocation.suspended",
  "invocation.completed",
  "invocation.cancel-observed",
]);

export interface ExecutorChannelFrame {
  readonly formatVersion: typeof EXECUTOR_CHANNEL_FORMAT_VERSION;
  readonly generation: number;
  readonly connectionEpoch: number;
  readonly sequence: number;
  readonly messageId: string;
  readonly kind: ExecutorChannelFrameKind;
  readonly correlationId?: string;
  readonly invocationId?: string;
  readonly attemptId?: string;
  readonly payload: ExecutorChannelWireValue;
}

const FRAME_FIELDS = new Set([
  "formatVersion",
  "generation",
  "connectionEpoch",
  "sequence",
  "messageId",
  "kind",
  "correlationId",
  "invocationId",
  "attemptId",
  "payload",
]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function assertIdentifier(
  value: unknown,
  field: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !IDENTIFIER_PATTERN.test(value) ||
    byteLength(value) > 128
  ) {
    throw new ExecutorChannelWireError(
      "malformed",
      `${field} must be a 1-128 byte canonical identifier`,
    );
  }
}

function assertPositiveSafeInteger(
  value: unknown,
  field: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ExecutorChannelWireError(
      "malformed",
      `${field} must be a positive safe integer`,
    );
  }
}

function assertNonNegativeSafeInteger(
  value: unknown,
  field: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ExecutorChannelWireError(
      "malformed",
      `${field} must be a non-negative safe integer`,
    );
  }
}

function assertExactIsoTimestamp(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new ExecutorChannelWireError(
      "malformed",
      `${field} must be a timestamp`,
    );
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new ExecutorChannelWireError(
      "malformed",
      `${field} must be an exact ISO UTC timestamp`,
    );
  }
}

function asRecord(
  value: ExecutorChannelWireValue,
  field: string,
): { readonly [key: string]: ExecutorChannelWireValue } {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ExecutorChannelWireError(
      "malformed",
      `${field} must be an object`,
    );
  }
  return value as { readonly [key: string]: ExecutorChannelWireValue };
}

function assertExactFields(
  value: { readonly [key: string]: ExecutorChannelWireValue },
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new ExecutorChannelWireError(
        "malformed",
        `payload field ${key} is required`,
      );
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ExecutorChannelWireError(
        "malformed",
        `unknown payload field ${key}`,
      );
    }
  }
}

function assertBoundedText(
  value: unknown,
  field: string,
  maximum = 1_024,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    byteLength(value) > maximum
  ) {
    throw new ExecutorChannelWireError(
      "malformed",
      `${field} must be non-empty and no more than ${maximum} bytes`,
    );
  }
}

function assertInvocationMetadata(
  frame: { readonly [key: string]: ExecutorChannelWireValue },
  required: boolean,
): void {
  if (required) {
    assertIdentifier(frame.invocationId, "invocationId");
    assertIdentifier(frame.attemptId, "attemptId");
  } else if (
    frame.invocationId !== undefined ||
    frame.attemptId !== undefined
  ) {
    throw new ExecutorChannelWireError(
      "malformed",
      "this frame kind cannot carry invocation or attempt identity",
    );
  }
}

function assertCorrelation(frame: {
  readonly [key: string]: ExecutorChannelWireValue;
}): void {
  assertIdentifier(frame.correlationId, "correlationId");
}

function assertPayloadSemantics(
  kind: ExecutorChannelFrameKind,
  frame: { readonly [key: string]: ExecutorChannelWireValue },
  payloadValue: ExecutorChannelWireValue,
  limits: ExecutorChannelLimits,
): void {
  const payload = asRecord(payloadValue, `${kind} payload`);
  switch (kind) {
    case "invocation.offer": {
      assertInvocationMetadata(frame, true);
      assertCorrelation(frame);
      assertExactFields(payload, [
        "idempotencyKey",
        "deadline",
        "authority",
        "input",
      ]);
      assertIdentifier(payload.idempotencyKey, "idempotencyKey");
      assertExactIsoTimestamp(payload.deadline, "deadline");
      const authority = asRecord(payload.authority, "authority");
      assertExactFields(authority, [
        "bindingId",
        "providerId",
        "interfaceId",
        "interfaceVersion",
        "method",
        "authorityDigest",
        "executionEpoch",
      ]);
      for (const field of [
        "bindingId",
        "providerId",
        "interfaceId",
        "interfaceVersion",
        "method",
      ]) {
        assertIdentifier(authority[field], field);
      }
      if (
        typeof authority.authorityDigest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(authority.authorityDigest)
      ) {
        throw new ExecutorChannelWireError(
          "malformed",
          "authorityDigest must use canonical sha256 form",
        );
      }
      assertPositiveSafeInteger(authority.executionEpoch, "executionEpoch");
      break;
    }
    case "invocation.accepted": {
      assertInvocationMetadata(frame, true);
      assertCorrelation(frame);
      assertExactFields(payload, ["acceptedAt"]);
      assertExactIsoTimestamp(payload.acceptedAt, "acceptedAt");
      break;
    }
    case "invocation.refused": {
      assertInvocationMetadata(frame, true);
      assertCorrelation(frame);
      assertExactFields(payload, ["code", "retryable", "message"]);
      const codes = [
        "unauthenticated",
        "unauthorized",
        "stale-authority",
        "unsupported-interface",
        "unsupported-method",
        "provider-replaced",
        "draining",
        "capacity",
        "malformed-input",
        "deadline-expired",
      ];
      if (typeof payload.code !== "string" || !codes.includes(payload.code)) {
        throw new ExecutorChannelWireError(
          "malformed",
          "unknown invocation refusal code",
        );
      }
      if (typeof payload.retryable !== "boolean") {
        throw new ExecutorChannelWireError(
          "malformed",
          "retryable must be boolean",
        );
      }
      assertBoundedText(payload.message, "message", 4_096);
      break;
    }
    case "invocation.event": {
      assertInvocationMetadata(frame, true);
      assertCorrelation(frame);
      assertExactFields(payload, ["eventId", "name", "value"]);
      assertIdentifier(payload.eventId, "eventId");
      assertIdentifier(payload.name, "event name");
      break;
    }
    case "invocation.suspended": {
      assertInvocationMetadata(frame, true);
      assertCorrelation(frame);
      assertExactFields(payload, ["suspensionId", "value"]);
      assertIdentifier(payload.suspensionId, "suspensionId");
      break;
    }
    case "invocation.completed": {
      assertInvocationMetadata(frame, true);
      assertCorrelation(frame);
      if (payload.status === "succeeded") {
        assertExactFields(payload, ["status", "result"]);
      } else if (
        payload.status === "failed" ||
        payload.status === "cancelled" ||
        payload.status === "indeterminate"
      ) {
        assertExactFields(payload, ["status", "error"]);
        const error = asRecord(payload.error, "completion error");
        assertExactFields(error, ["code", "message", "retryable"], ["details"]);
        assertIdentifier(error.code, "error code");
        assertBoundedText(error.message, "error message", 16_384);
        if (typeof error.retryable !== "boolean") {
          throw new ExecutorChannelWireError(
            "malformed",
            "error retryable must be boolean",
          );
        }
      } else {
        throw new ExecutorChannelWireError(
          "malformed",
          "unknown invocation completion status",
        );
      }
      break;
    }
    case "invocation.cancel": {
      assertInvocationMetadata(frame, true);
      assertCorrelation(frame);
      assertExactFields(payload, ["reason", "graceMs"]);
      assertBoundedText(payload.reason, "cancellation reason", 4_096);
      assertNonNegativeSafeInteger(payload.graceMs, "graceMs");
      if (payload.graceMs > limits.cancellationGraceMs) {
        throw new ExecutorChannelWireError(
          "oversized",
          "cancellation grace exceeds the accepted policy",
        );
      }
      break;
    }
    case "invocation.cancel-observed": {
      assertInvocationMetadata(frame, true);
      assertCorrelation(frame);
      assertExactFields(payload, ["observedAt"]);
      assertExactIsoTimestamp(payload.observedAt, "observedAt");
      break;
    }
    case "recovery.request": {
      assertInvocationMetadata(frame, false);
      assertCorrelation(frame);
      assertExactFields(payload, ["receivedThrough", "sentThrough"]);
      assertNonNegativeSafeInteger(payload.receivedThrough, "receivedThrough");
      assertNonNegativeSafeInteger(payload.sentThrough, "sentThrough");
      if (payload.sentThrough !== frame.sequence) {
        throw new ExecutorChannelWireError(
          "malformed",
          "recovery sender cursor must equal the recovery frame sequence",
        );
      }
      break;
    }
    case "recovery.state": {
      assertInvocationMetadata(frame, false);
      assertCorrelation(frame);
      assertExactFields(payload, [
        "receivedThrough",
        "sentThrough",
        "activeAttempts",
      ]);
      assertNonNegativeSafeInteger(payload.receivedThrough, "receivedThrough");
      assertNonNegativeSafeInteger(payload.sentThrough, "sentThrough");
      if (payload.sentThrough !== frame.sequence) {
        throw new ExecutorChannelWireError(
          "malformed",
          "recovery sender cursor must equal the recovery frame sequence",
        );
      }
      if (!Array.isArray(payload.activeAttempts)) {
        throw new ExecutorChannelWireError(
          "malformed",
          "activeAttempts must be an array",
        );
      }
      if (payload.activeAttempts.length > limits.maxInFlightInvocations) {
        throw new ExecutorChannelWireError(
          "oversized",
          "active recovery attempts exceed the accepted policy",
        );
      }
      const activeAttemptIds = new Set<string>();
      for (const attemptValue of payload.activeAttempts) {
        const attempt = asRecord(attemptValue, "active attempt");
        assertExactFields(attempt, [
          "invocationId",
          "attemptId",
          "state",
          "lastEventSequence",
        ]);
        assertIdentifier(attempt.invocationId, "invocationId");
        assertIdentifier(attempt.attemptId, "attemptId");
        const activeAttemptIdentity = `${attempt.invocationId}\u0000${attempt.attemptId}`;
        if (activeAttemptIds.has(activeAttemptIdentity)) {
          throw new ExecutorChannelWireError(
            "malformed",
            "recovery state contains a duplicate active attempt",
          );
        }
        activeAttemptIds.add(activeAttemptIdentity);
        if (
          attempt.state !== "accepted" &&
          attempt.state !== "active" &&
          attempt.state !== "cancelling"
        ) {
          throw new ExecutorChannelWireError(
            "malformed",
            "active attempt state is invalid",
          );
        }
        assertNonNegativeSafeInteger(
          attempt.lastEventSequence,
          "lastEventSequence",
        );
      }
      break;
    }
    case "ack": {
      assertInvocationMetadata(frame, false);
      assertExactFields(payload, ["throughSequence"]);
      assertNonNegativeSafeInteger(payload.throughSequence, "throughSequence");
      break;
    }
  }
}

function cloneWireValue(
  input: unknown,
  limits: ExecutorChannelLimits,
): ExecutorChannelWireValue {
  let aggregateEntries = 0;
  let serializedBytes = 0;

  const charge = (bytes: number): void => {
    serializedBytes += bytes;
    if (serializedBytes > limits.maxFrameBytes) {
      throw new ExecutorChannelWireError(
        "oversized",
        "wire value serialized byte limit exceeded",
      );
    }
  };

  const visit = (value: unknown, depth: number): ExecutorChannelWireValue => {
    if (depth > limits.maxJsonDepth) {
      throw new ExecutorChannelWireError(
        "oversized",
        "JSON depth limit exceeded",
      );
    }
    if (value === null) {
      charge(4);
      return value;
    }
    if (typeof value === "boolean") {
      charge(value ? 4 : 5);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new ExecutorChannelWireError(
          "malformed",
          "wire numbers must be finite",
        );
      }
      charge(byteLength(JSON.stringify(value)));
      return value;
    }
    if (typeof value === "string") {
      if (byteLength(value) > limits.maxStringBytes) {
        throw new ExecutorChannelWireError(
          "oversized",
          "string byte limit exceeded",
        );
      }
      charge(byteLength(JSON.stringify(value)));
      return value;
    }
    if (Array.isArray(value)) {
      charge(2);
      if (value.length > limits.maxArrayItems) {
        throw new ExecutorChannelWireError(
          "oversized",
          "array item limit exceeded",
        );
      }
      aggregateEntries += value.length;
      if (aggregateEntries > limits.maxAggregateEntries) {
        throw new ExecutorChannelWireError(
          "oversized",
          "aggregate entry limit exceeded",
        );
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const ownKeys = Reflect.ownKeys(descriptors).filter(
        (key) => key !== "length",
      );
      if (
        ownKeys.length !== value.length ||
        ownKeys.some(
          (key, index) =>
            typeof key !== "string" ||
            key !== String(index) ||
            descriptors[key] === undefined ||
            !Object.hasOwn(descriptors[key], "value") ||
            descriptors[key].enumerable !== true,
        )
      ) {
        throw new ExecutorChannelWireError(
          "malformed",
          "wire arrays must be dense data-only arrays without extra properties",
        );
      }
      const indexes = ownKeys as string[];
      return Object.freeze(
        indexes.map((key, index) => {
          if (index > 0) charge(1);
          return visit(descriptors[key]!.value, depth + 1);
        }),
      );
    }
    if (typeof value !== "object") {
      throw new ExecutorChannelWireError(
        "malformed",
        `unsupported wire value type ${typeof value}`,
      );
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ExecutorChannelWireError(
        "malformed",
        "wire records must be plain objects",
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new ExecutorChannelWireError(
        "malformed",
        "wire records cannot contain symbol properties",
      );
    }
    const keys = ownKeys as string[];
    if (keys.length > limits.maxObjectKeys) {
      throw new ExecutorChannelWireError(
        "oversized",
        "object key limit exceeded",
      );
    }
    aggregateEntries += keys.length;
    if (aggregateEntries > limits.maxAggregateEntries) {
      throw new ExecutorChannelWireError(
        "oversized",
        "aggregate entry limit exceeded",
      );
    }
    const clone: Record<string, ExecutorChannelWireValue> = Object.create(
      null,
    ) as Record<string, ExecutorChannelWireValue>;
    charge(2);
    for (const [index, key] of keys.entries()) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        throw new ExecutorChannelWireError(
          "malformed",
          "wire records cannot contain accessors or hidden properties",
        );
      }
      if (byteLength(key) > limits.maxStringBytes) {
        throw new ExecutorChannelWireError(
          "oversized",
          "object key limit exceeded",
        );
      }
      if (index > 0) charge(1);
      charge(byteLength(JSON.stringify(key)) + 1);
      clone[key] = visit(descriptor.value, depth + 1);
    }
    return Object.freeze(clone);
  };

  return visit(input, 0);
}

export function acceptExecutorChannelWireValue(
  input: unknown,
  limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
): ExecutorChannelWireValue {
  return cloneWireValue(input, acceptExecutorChannelLimits(limits));
}

function decodeFrameObject(
  input: unknown,
  limits: ExecutorChannelLimits,
): ExecutorChannelFrame {
  const value = cloneWireValue(input, limits);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ExecutorChannelWireError("malformed", "frame must be an object");
  }
  const record = value as { readonly [key: string]: ExecutorChannelWireValue };
  const keys = Object.keys(record);
  for (const key of keys) {
    if (!FRAME_FIELDS.has(key)) {
      throw new ExecutorChannelWireError(
        "malformed",
        `unknown frame field ${key}`,
      );
    }
  }
  if (record.formatVersion !== EXECUTOR_CHANNEL_FORMAT_VERSION) {
    throw new ExecutorChannelWireError(
      "unsupported-format",
      "unsupported executor channel format",
    );
  }
  assertPositiveSafeInteger(record.generation, "generation");
  assertPositiveSafeInteger(record.connectionEpoch, "connectionEpoch");
  assertPositiveSafeInteger(record.sequence, "sequence");
  assertIdentifier(record.messageId, "messageId");
  if (
    !record.messageId.startsWith(
      `g${record.generation}:s${record.sequence}:`,
    ) ||
    record.messageId === `g${record.generation}:s${record.sequence}:`
  ) {
    throw new ExecutorChannelWireError(
      "malformed",
      "messageId must be structurally bound to its generation and sequence",
    );
  }
  if (
    typeof record.kind !== "string" ||
    !EXECUTOR_CHANNEL_FRAME_KINDS.includes(
      record.kind as ExecutorChannelFrameKind,
    )
  ) {
    throw new ExecutorChannelWireError("unknown-kind", "unknown frame kind");
  }
  if (record.correlationId !== undefined) {
    assertIdentifier(record.correlationId, "correlationId");
  }
  if (record.invocationId !== undefined) {
    assertIdentifier(record.invocationId, "invocationId");
  }
  if (record.attemptId !== undefined) {
    assertIdentifier(record.attemptId, "attemptId");
  }
  if (!Object.hasOwn(record, "payload")) {
    throw new ExecutorChannelWireError(
      "malformed",
      "frame payload is required",
    );
  }
  assertPayloadSemantics(
    record.kind as ExecutorChannelFrameKind,
    record,
    record.payload,
    limits,
  );

  return Object.freeze({
    formatVersion: EXECUTOR_CHANNEL_FORMAT_VERSION,
    generation: record.generation,
    connectionEpoch: record.connectionEpoch,
    sequence: record.sequence,
    messageId: record.messageId,
    kind: record.kind as ExecutorChannelFrameKind,
    ...(record.correlationId === undefined
      ? {}
      : { correlationId: record.correlationId }),
    ...(record.invocationId === undefined
      ? {}
      : { invocationId: record.invocationId }),
    ...(record.attemptId === undefined ? {} : { attemptId: record.attemptId }),
    payload: record.payload,
  });
}

export function decodeExecutorChannelFrame(
  input: Uint8Array,
  limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
): ExecutorChannelFrame {
  const acceptedLimits = acceptExecutorChannelLimits(limits);
  const byteLength = intrinsicUint8ArrayLength(input);
  if (byteLength === undefined) {
    throw new ExecutorChannelWireError(
      "malformed",
      "frame input must be a Uint8Array",
    );
  }
  if (byteLength > acceptedLimits.maxFrameBytes) {
    throw new ExecutorChannelWireError(
      "oversized",
      "frame byte limit exceeded",
    );
  }
  let text: string;
  try {
    text = textDecoder.decode(copyIntrinsicUint8Array(input, byteLength));
  } catch {
    throw new ExecutorChannelWireError("malformed", "frame is not valid UTF-8");
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJson(text, {
      maxDepth: acceptedLimits.maxJsonDepth,
      maxStringBytes: acceptedLimits.maxStringBytes,
      maxObjectKeys: acceptedLimits.maxObjectKeys,
      maxArrayItems: acceptedLimits.maxArrayItems,
      maxAggregateEntries: acceptedLimits.maxAggregateEntries,
    });
  } catch (error) {
    if (error instanceof StrictJsonError) {
      throw new ExecutorChannelWireError(error.code, error.message);
    }
    throw new ExecutorChannelWireError("malformed", "frame is not valid JSON");
  }
  return decodeFrameObject(parsed, acceptedLimits);
}

export function assertExecutorChannelDirection(
  frame: ExecutorChannelFrame,
  direction: ExecutorChannelDirection,
  limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
): ExecutorChannelFrame {
  if (direction !== "host-to-executor" && direction !== "executor-to-host") {
    throw new ExecutorChannelWireError(
      "wrong-direction",
      "executor channel direction is invalid",
    );
  }
  const accepted = decodeFrameObject(
    frame,
    acceptExecutorChannelLimits(limits),
  );
  if (
    (direction === "host-to-executor" &&
      EXECUTOR_ONLY_KINDS.has(accepted.kind)) ||
    (direction === "executor-to-host" && HOST_ONLY_KINDS.has(accepted.kind))
  ) {
    throw new ExecutorChannelWireError(
      "wrong-direction",
      `${accepted.kind} is not permitted ${direction}`,
    );
  }
  return accepted;
}

export function encodeExecutorChannelFrame(
  input: ExecutorChannelFrame,
  limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
): Uint8Array {
  const acceptedLimits = acceptExecutorChannelLimits(limits);
  const frame = decodeFrameObject(input, acceptedLimits);
  const encoded = textEncoder.encode(JSON.stringify(frame));
  if (encoded.byteLength > acceptedLimits.maxFrameBytes) {
    throw new ExecutorChannelWireError(
      "oversized",
      "frame byte limit exceeded",
    );
  }
  return encoded;
}

export function canonicalExecutorChannelMessage(
  frame: ExecutorChannelFrame,
  limits: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
): string {
  const accepted = decodeFrameObject(
    frame,
    acceptExecutorChannelLimits(limits),
  );
  const logical = {
    formatVersion: accepted.formatVersion,
    generation: accepted.generation,
    sequence: accepted.sequence,
    messageId: accepted.messageId,
    kind: accepted.kind,
    ...(accepted.correlationId === undefined
      ? {}
      : { correlationId: accepted.correlationId }),
    ...(accepted.invocationId === undefined
      ? {}
      : { invocationId: accepted.invocationId }),
    ...(accepted.attemptId === undefined
      ? {}
      : { attemptId: accepted.attemptId }),
    payload: accepted.payload,
  };
  return createHash("sha256")
    .update(canonicalAcceptedExecutorChannelWireValue(logical))
    .digest("hex");
}

export function canonicalExecutorChannelWireValue(value: unknown): string {
  return canonicalAcceptedExecutorChannelWireValue(
    acceptExecutorChannelWireValue(value),
  );
}

function canonicalAcceptedExecutorChannelWireValue(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalAcceptedExecutorChannelWireValue).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new ExecutorChannelWireError(
      "malformed",
      "canonical channel values must be plain wire values",
    );
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalAcceptedExecutorChannelWireValue(record[key])}`,
    );
  return `{${entries.join(",")}}`;
}

export type ExecutorChannelWireErrorCode =
  | "malformed"
  | "oversized"
  | "unsupported-format"
  | "unknown-kind"
  | "wrong-direction";

export class ExecutorChannelWireError extends Error {
  readonly name = "ExecutorChannelWireError";

  constructor(
    readonly code: ExecutorChannelWireErrorCode,
    message: string,
  ) {
    super(message);
  }
}
