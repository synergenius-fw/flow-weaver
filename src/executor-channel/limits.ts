/**
 * Frozen format-1 executor-channel limits.
 *
 * Hosts may negotiate values downward. No peer may increase a value above
 * these deployment maxima.
 */
export interface ExecutorChannelLimits {
  readonly maxFrameBytes: number;
  readonly maxStringBytes: number;
  readonly maxJsonDepth: number;
  readonly maxObjectKeys: number;
  readonly maxArrayItems: number;
  readonly maxAggregateEntries: number;
  readonly maxInFlightInvocations: number;
  readonly maxEventRatePerSecond: number;
  readonly maxRetainedEventBytesPerInvocation: number;
  readonly maxContinuationBytes: number;
  readonly maxArtifactMetadataBytes: number;
  readonly maxReplayFrames: number;
  readonly maxReplayBytes: number;
  readonly replayLifetimeMs: number;
  readonly maxAuthenticationInboxFrames: number;
  readonly maxAuthenticationInboxBytes: number;
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly acknowledgementDeadlineMs: number;
  readonly admissionDeadlineMs: number;
  readonly cancellationGraceMs: number;
  readonly drainDeadlineMs: number;
  readonly recoveryBatchSize: number;
  readonly cursorWindow: number;
}

export const EXECUTOR_CHANNEL_DEPLOYMENT_MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const FLOW_WEAVER_CONTINUATION_MAX_BYTES = 1024 * 1024;
export const EXECUTOR_CHANNEL_CONTINUATION_FRAME_OVERHEAD_BYTES = 64 * 1024;

export const EXECUTOR_CHANNEL_FORMAT_1_LIMITS: Readonly<ExecutorChannelLimits> =
  Object.freeze({
    maxFrameBytes: 2 * 1024 * 1024,
    maxStringBytes: 256 * 1024,
    maxJsonDepth: 40,
    maxObjectKeys: 1_024,
    maxArrayItems: 10_000,
    maxAggregateEntries: 12_000,
    maxInFlightInvocations: 32,
    maxEventRatePerSecond: 200,
    maxRetainedEventBytesPerInvocation: 16 * 1024 * 1024,
    maxContinuationBytes: FLOW_WEAVER_CONTINUATION_MAX_BYTES,
    maxArtifactMetadataBytes: 64 * 1024,
    maxReplayFrames: 4_096,
    maxReplayBytes: 64 * 1024 * 1024,
    replayLifetimeMs: 24 * 60 * 60 * 1_000,
    maxAuthenticationInboxFrames: 8,
    maxAuthenticationInboxBytes: 64 * 1024,
    heartbeatIntervalMs: 10_000,
    leaseDurationMs: 30_000,
    acknowledgementDeadlineMs: 5_000,
    admissionDeadlineMs: 30_000,
    cancellationGraceMs: 10_000,
    drainDeadlineMs: 60_000,
    recoveryBatchSize: 256,
    cursorWindow: 4_096,
  });

export function negotiateExecutorChannelLimits(
  requested: Partial<ExecutorChannelLimits>,
  host: ExecutorChannelLimits = EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
): Readonly<ExecutorChannelLimits> {
  const acceptedHost = acceptExecutorChannelLimits(host);
  if (
    requested === null ||
    typeof requested !== "object" ||
    (Object.getPrototypeOf(requested) !== Object.prototype &&
      Object.getPrototypeOf(requested) !== null)
  ) {
    throw new ExecutorChannelLimitError(
      "negotiated limits must be a plain record",
    );
  }
  const requestedDescriptors = Object.getOwnPropertyDescriptors(requested);
  const known = new Set(Object.keys(EXECUTOR_CHANNEL_FORMAT_1_LIMITS));
  if (
    Reflect.ownKeys(requestedDescriptors).some(
      (name) => typeof name !== "string" || !known.has(name),
    ) ||
    Object.values(requestedDescriptors).some(
      (field) => !Object.hasOwn(field, "value") || field.enumerable !== true,
    )
  ) {
    throw new ExecutorChannelLimitError(
      "negotiated limits cannot contain unknown, accessor, symbol, or hidden fields",
    );
  }
  const acceptedRequested = Object.fromEntries(
    Object.entries(requestedDescriptors).map(([name, field]) => [
      name,
      field.value,
    ]),
  ) as Partial<ExecutorChannelLimits>;
  const negotiated = Object.fromEntries(
    Object.entries(acceptedHost).map(([name, hostValue]) => {
      const requestedValue =
        acceptedRequested[name as keyof ExecutorChannelLimits];
      if (requestedValue === undefined) return [name, hostValue];
      if (
        !Number.isSafeInteger(requestedValue) ||
        requestedValue <= 0 ||
        requestedValue > hostValue
      ) {
        throw new ExecutorChannelLimitError(
          `${name} must be a positive safe integer no greater than host policy ${hostValue}`,
        );
      }
      return [name, requestedValue];
    }),
  ) as unknown as ExecutorChannelLimits;

  return acceptExecutorChannelLimits(negotiated);
}

export function acceptExecutorChannelLimits(
  input: unknown,
): Readonly<ExecutorChannelLimits> {
  const accepted = acceptExecutorChannelLimitRecord(input);
  if (
    accepted.maxContinuationBytes !== FLOW_WEAVER_CONTINUATION_MAX_BYTES ||
    accepted.maxFrameBytes <
      accepted.maxContinuationBytes +
        EXECUTOR_CHANNEL_CONTINUATION_FRAME_OVERHEAD_BYTES
  ) {
    throw new ExecutorChannelLimitError(
      "format 1 must carry the fixed 1 MiB continuation plus its bounded frame wrapper",
    );
  }
  if (accepted.maxReplayBytes < accepted.maxFrameBytes) {
    throw new ExecutorChannelLimitError(
      "maxReplayBytes must retain at least one maximum-size frame",
    );
  }
  if (accepted.leaseDurationMs < accepted.heartbeatIntervalMs * 2) {
    throw new ExecutorChannelLimitError(
      "leaseDurationMs must permit at least two heartbeat intervals",
    );
  }
  if (accepted.recoveryBatchSize > accepted.maxReplayFrames) {
    throw new ExecutorChannelLimitError(
      "recoveryBatchSize cannot exceed maxReplayFrames",
    );
  }
  if (
    accepted.recoveryBatchSize > accepted.cursorWindow ||
    accepted.cursorWindow > accepted.maxReplayFrames
  ) {
    throw new ExecutorChannelLimitError(
      "recoveryBatchSize, cursorWindow, and maxReplayFrames must be monotonically bounded",
    );
  }
  return Object.freeze(accepted);
}

function acceptExecutorChannelLimitRecord(
  input: unknown,
): ExecutorChannelLimits {
  if (
    input === null ||
    typeof input !== "object" ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null)
  ) {
    throw new ExecutorChannelLimitError("host limits must be a plain record");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const expected = Object.keys(EXECUTOR_CHANNEL_FORMAT_1_LIMITS).sort();
  const fields = Reflect.ownKeys(descriptors);
  if (
    fields.some((field) => typeof field !== "string") ||
    JSON.stringify([...fields].sort()) !== JSON.stringify(expected) ||
    Object.values(descriptors).some(
      (field) => !Object.hasOwn(field, "value") || field.enumerable !== true,
    )
  ) {
    throw new ExecutorChannelLimitError(
      "host limits have missing, unknown, accessor, symbol, or hidden fields",
    );
  }
  const accepted = Object.fromEntries(
    Object.entries(descriptors).map(([name, field]) => [name, field.value]),
  ) as unknown as ExecutorChannelLimits;
  for (const name of expected as (keyof ExecutorChannelLimits)[]) {
    const value = accepted[name];
    const deploymentMaximum =
      name === "maxFrameBytes"
        ? EXECUTOR_CHANNEL_DEPLOYMENT_MAX_FRAME_BYTES
        : EXECUTOR_CHANNEL_FORMAT_1_LIMITS[name];
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > deploymentMaximum
    ) {
      throw new ExecutorChannelLimitError(
        `host ${name} must be a positive safe integer no greater than deployment policy ${deploymentMaximum}`,
      );
    }
  }
  return accepted;
}

export class ExecutorChannelLimitError extends Error {
  readonly name = "ExecutorChannelLimitError";
}
