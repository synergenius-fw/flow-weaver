import { createHash } from "node:crypto";
import {
  assertAcceptedContinuation,
  GENERATOR_ABI,
  type AcceptedContinuationEnvelope,
} from "../runtime/continuation.js";
import {
  acceptGateResolution,
  type GateResolution,
} from "../runtime/durable-execution.js";
import {
  acceptExecutorChannelWireValue,
  type ExecutorChannelWireValue,
} from "./wire.js";
import { VERSION } from "../generated-version.js";
import {
  copyIntrinsicUint8Array,
  intrinsicAbortSignalState,
  intrinsicUint8ArrayLength,
} from "./intrinsics.js";

export interface DeviceCapabilityRequirement {
  readonly id: string;
  readonly interfaceVersion: number;
  readonly applicationPolicyRefs: readonly string[];
  readonly modes: readonly string[];
  readonly credentialSlots: readonly string[];
}

interface SealedFlowWeaverBundleFields {
  readonly bundleDigest: `sha256:${string}`;
  readonly byteLength: number;
  readonly engineVersion: string;
  readonly generatorAbi: string;
  readonly entryWorkflowId: string;
  readonly signature: {
    readonly algorithm: "ed25519";
    readonly keyId: string;
    readonly value: string;
  };
}

/** Stable public name; the serialized discriminant selects an exact codec. */
export type SealedFlowWeaverBundleDescriptor = Readonly<
  SealedFlowWeaverBundleFields &
    (
      | { readonly formatVersion: 1 }
      | {
          readonly formatVersion: 2;
          readonly deviceCapabilities: readonly DeviceCapabilityRequirement[];
        }
    )
>;

export interface SealedFlowWeaverBundleVerifier {
  verifyEd25519(
    request: Readonly<{
      keyId: string;
      signature: string;
      preimage: Uint8Array;
    }>,
    signal?: AbortSignal,
  ): Promise<boolean>;
}

const verifiedBundles = new WeakSet<object>();
export interface VerifiedFlowWeaverBundle {
  readonly descriptor: Readonly<SealedFlowWeaverBundleDescriptor>;
  /** Returns a fresh copy. Verified bundle storage is never caller-mutable. */
  readBytes(): Uint8Array;
}

export async function verifySealedFlowWeaverBundle(
  descriptor: SealedFlowWeaverBundleDescriptor,
  bytes: Uint8Array,
  verifier: SealedFlowWeaverBundleVerifier,
  signal?: AbortSignal,
): Promise<VerifiedFlowWeaverBundle> {
  const acceptedDescriptor = acceptSealedDescriptor(descriptor);
  const signalState = acceptOptionalAbortSignal(signal);
  if (signalState === true) {
    throw new FlowWeaverBundleRefusalError(
      "cancelled",
      "bundle verification cancelled",
    );
  }
  const byteLength = intrinsicUint8ArrayLength(bytes);
  if (byteLength === undefined) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-descriptor",
      "sealed bundle bytes must be a Uint8Array",
    );
  }
  if (
    byteLength > 256 * 1024 * 1024 ||
    byteLength !== acceptedDescriptor.byteLength
  ) {
    throw new FlowWeaverBundleRefusalError(
      "wrong-bundle",
      "sealed bundle byte length does not match its descriptor",
    );
  }
  const retainedBytes = copyIntrinsicUint8Array(bytes, byteLength);
  const digest = `sha256:${createHash("sha256").update(retainedBytes).digest("hex")}`;
  if (digest !== acceptedDescriptor.bundleDigest) {
    throw new FlowWeaverBundleRefusalError(
      "wrong-bundle",
      "sealed bundle digest does not match its descriptor",
    );
  }
  const signatureAccepted = await verifier.verifyEd25519(
    Object.freeze({
      keyId: acceptedDescriptor.signature.keyId,
      signature: acceptedDescriptor.signature.value,
      preimage: sealedBundleSignaturePreimage(acceptedDescriptor),
    }),
    signal,
  );
  if (signatureAccepted !== true) {
    throw new FlowWeaverBundleRefusalError(
      "invalid-signature",
      "sealed bundle signature is not trusted",
    );
  }
  if (acceptOptionalAbortSignal(signal) === true) {
    throw new FlowWeaverBundleRefusalError(
      "cancelled",
      "bundle verification cancelled",
    );
  }
  const verified = Object.freeze({
    descriptor: acceptedDescriptor,
    readBytes: () => Uint8Array.from(retainedBytes),
  });
  verifiedBundles.add(verified);
  return verified;
}

export function sealedFlowWeaverBundleSignaturePreimage(
  descriptor: SealedFlowWeaverBundleDescriptor,
): Uint8Array {
  return sealedBundleSignaturePreimage(acceptSealedDescriptor(descriptor));
}

function sealedBundleSignaturePreimage(
  descriptor: Readonly<SealedFlowWeaverBundleDescriptor>,
): Uint8Array {
  const signed =
    descriptor.formatVersion === 1
      ? JSON.stringify({
          formatVersion: descriptor.formatVersion,
          bundleDigest: descriptor.bundleDigest,
          byteLength: descriptor.byteLength,
          engineVersion: descriptor.engineVersion,
          generatorAbi: descriptor.generatorAbi,
          entryWorkflowId: descriptor.entryWorkflowId,
        })
      : JSON.stringify({
          formatVersion: descriptor.formatVersion,
          bundleDigest: descriptor.bundleDigest,
          byteLength: descriptor.byteLength,
          engineVersion: descriptor.engineVersion,
          generatorAbi: descriptor.generatorAbi,
          entryWorkflowId: descriptor.entryWorkflowId,
          deviceCapabilities: descriptor.deviceCapabilities,
        });
  const domain =
    descriptor.formatVersion === 1
      ? "flow-weaver-sealed-bundle-v1"
      : "flow-weaver-sealed-bundle-v2";
  return new TextEncoder().encode(`${domain}\n${signed}`);
}

export function assertVerifiedFlowWeaverBundle(
  bundle: VerifiedFlowWeaverBundle,
): void {
  if (!verifiedBundles.has(bundle)) {
    throw new FlowWeaverBundleRefusalError(
      "unverified-bundle",
      "production execution requires a verifier-issued sealed bundle capability",
    );
  }
  if (
    bundle.descriptor.engineVersion !== VERSION ||
    bundle.descriptor.generatorAbi !== GENERATOR_ABI
  ) {
    throw new FlowWeaverBundleRefusalError(
      "incompatible-engine",
      "sealed bundle engine and generator identities must match exactly",
    );
  }
}

export interface VerifiedFlowWeaverInvocation {
  readonly invocationId: string;
  readonly attemptId: string;
  readonly bundle: VerifiedFlowWeaverBundle;
  readonly parameters: ExecutorChannelWireValue;
  readonly continuation?: AcceptedContinuationEnvelope;
  readonly resolution?: GateResolution;
  readonly abortSignal?: AbortSignal;
}

export interface AcceptedVerifiedFlowWeaverInvocation extends VerifiedFlowWeaverInvocation {
  readonly production: true;
}

export function acceptVerifiedFlowWeaverInvocation(
  invocation: VerifiedFlowWeaverInvocation,
): Readonly<AcceptedVerifiedFlowWeaverInvocation> {
  if (
    invocation === null ||
    typeof invocation !== "object" ||
    (Object.getPrototypeOf(invocation) !== Object.prototype &&
      Object.getPrototypeOf(invocation) !== null)
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-invocation",
      "verified invocation must be a plain object",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(invocation);
  const fields = Reflect.ownKeys(descriptors);
  const allowed = new Set([
    "invocationId",
    "attemptId",
    "bundle",
    "parameters",
    "continuation",
    "resolution",
    "abortSignal",
  ]);
  if (
    fields.some((field) => typeof field !== "string" || !allowed.has(field)) ||
    !Object.hasOwn(descriptors, "invocationId") ||
    !Object.hasOwn(descriptors, "attemptId") ||
    !Object.hasOwn(descriptors, "bundle") ||
    !Object.hasOwn(descriptors, "parameters") ||
    Object.values(descriptors).some(
      (field) => !Object.hasOwn(field, "value") || field.enumerable !== true,
    )
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-invocation",
      "verified invocation has missing, unknown, accessor, or hidden fields",
    );
  }
  const acceptedInput = Object.fromEntries(
    Object.entries(descriptors).map(([name, field]) => [name, field.value]),
  ) as VerifiedFlowWeaverInvocation;
  assertVerifiedFlowWeaverBundle(acceptedInput.bundle);
  if (
    typeof acceptedInput.invocationId !== "string" ||
    typeof acceptedInput.attemptId !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/.test(
      acceptedInput.invocationId,
    ) ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/.test(acceptedInput.attemptId)
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-invocation",
      "invocation and attempt identities are required",
    );
  }
  let parameters: ExecutorChannelWireValue;
  try {
    parameters = acceptExecutorChannelWireValue(acceptedInput.parameters);
  } catch {
    throw new FlowWeaverBundleRefusalError(
      "malformed-invocation",
      "Flow Weaver parameters are malformed or outside channel bounds",
    );
  }
  if (
    parameters === null ||
    Array.isArray(parameters) ||
    typeof parameters !== "object"
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-invocation",
      "Flow Weaver parameters must be a bounded plain record",
    );
  }
  if (
    acceptedInput.abortSignal !== undefined &&
    !isExactNodeAbortSignal(acceptedInput.abortSignal)
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-invocation",
      "abortSignal must be a standard Node AbortSignal",
    );
  }
  if (intrinsicAbortSignalState(acceptedInput.abortSignal) === true) {
    throw new FlowWeaverBundleRefusalError(
      "cancelled",
      "production invocation was cancelled before admission",
    );
  }
  let continuation: AcceptedContinuationEnvelope | undefined;
  if (acceptedInput.continuation !== undefined) {
    try {
      assertAcceptedContinuation(acceptedInput.continuation);
    } catch {
      throw new FlowWeaverBundleRefusalError(
        "incompatible-continuation",
        "production continuation must be issued by the exact A2 decoder",
      );
    }
    continuation = acceptedInput.continuation;
    if (
      continuation.runId !== acceptedInput.invocationId ||
      continuation.workflowId !==
        acceptedInput.bundle.descriptor.entryWorkflowId ||
      continuation.bundleDigest !==
        acceptedInput.bundle.descriptor.bundleDigest ||
      continuation.engineVersion !== VERSION ||
      continuation.generatorAbi !== GENERATOR_ABI
    ) {
      throw new FlowWeaverBundleRefusalError(
        "incompatible-continuation",
        "accepted continuation does not match the invocation and sealed bundle",
      );
    }
  }
  const resolution = acceptGateResolution(acceptedInput.resolution);
  if (
    (continuation === undefined) !== (resolution === undefined) ||
    (continuation !== undefined &&
      resolution !== undefined &&
      resolution.gateId !== continuation.gateId)
  ) {
    throw new FlowWeaverBundleRefusalError(
      "incompatible-continuation",
      "gate resolution must match the exact accepted continuation",
    );
  }
  return Object.freeze({
    invocationId: acceptedInput.invocationId,
    attemptId: acceptedInput.attemptId,
    bundle: acceptedInput.bundle,
    parameters,
    ...(continuation === undefined ? {} : { continuation }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(acceptedInput.abortSignal === undefined
      ? {}
      : { abortSignal: acceptedInput.abortSignal }),
    production: true as const,
  });
}

function isExactNodeAbortSignal(input: unknown): input is AbortSignal {
  return (
    intrinsicAbortSignalState(input) !== undefined &&
    !Object.hasOwn(input as object, "aborted")
  );
}

function acceptOptionalAbortSignal(input: unknown): boolean | undefined {
  if (input === undefined) return undefined;
  const state = intrinsicAbortSignalState(input);
  if (state === undefined || Object.hasOwn(input as object, "aborted")) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-signal",
      "signal must be a standard Node AbortSignal",
    );
  }
  return state;
}

function acceptSealedDescriptor(
  input: unknown,
): Readonly<SealedFlowWeaverBundleDescriptor> {
  if (
    input === null ||
    typeof input !== "object" ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null)
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-descriptor",
      "sealed bundle descriptor must be a plain object",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = Reflect.ownKeys(descriptors);
  if (
    Object.values(descriptors).some(
      (field) => !Object.hasOwn(field, "value") || field.enumerable !== true,
    )
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-descriptor",
      "sealed bundle descriptor has missing, unknown, accessor, or hidden fields",
    );
  }
  const formatVersion = descriptors["formatVersion"]?.value;
  const expected = [
    "bundleDigest",
    "byteLength",
    "engineVersion",
    "entryWorkflowId",
    "formatVersion",
    "generatorAbi",
    "signature",
    ...(formatVersion === 2 ? ["deviceCapabilities"] : []),
  ].sort();
  if (
    fields.some((field) => typeof field !== "string") ||
    JSON.stringify([...fields].sort()) !== JSON.stringify(expected)
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-descriptor",
      "sealed bundle descriptor has missing or unknown fields",
    );
  }
  const descriptor = Object.fromEntries(
    Object.entries(descriptors).map(([name, field]) => [name, field.value]),
  ) as SealedFlowWeaverBundleDescriptor;
  if (
    (descriptor.formatVersion !== 1 && descriptor.formatVersion !== 2) ||
    !/^sha256:[0-9a-f]{64}$/.test(descriptor.bundleDigest) ||
    !Number.isSafeInteger(descriptor.byteLength) ||
    descriptor.byteLength <= 0 ||
    descriptor.byteLength > 256 * 1024 * 1024 ||
    typeof descriptor.engineVersion !== "string" ||
    descriptor.engineVersion.trim().length === 0 ||
    new TextEncoder().encode(descriptor.engineVersion).byteLength > 128 ||
    typeof descriptor.generatorAbi !== "string" ||
    descriptor.generatorAbi.trim().length === 0 ||
    new TextEncoder().encode(descriptor.generatorAbi).byteLength > 128 ||
    typeof descriptor.entryWorkflowId !== "string" ||
    descriptor.entryWorkflowId.trim().length === 0 ||
    new TextEncoder().encode(descriptor.entryWorkflowId).byteLength > 256
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-descriptor",
      "sealed bundle descriptor is malformed or outside bounds",
    );
  }
  const deviceCapabilities =
    descriptor.formatVersion === 2
      ? acceptDeviceCapabilities(descriptor.deviceCapabilities)
      : undefined;
  if (
    descriptor.signature === null ||
    typeof descriptor.signature !== "object" ||
    (Object.getPrototypeOf(descriptor.signature) !== Object.prototype &&
      Object.getPrototypeOf(descriptor.signature) !== null)
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-descriptor",
      "sealed bundle signature descriptor must be a plain object",
    );
  }
  const signatureDescriptors = Object.getOwnPropertyDescriptors(
    descriptor.signature,
  );
  const signatureFields = Reflect.ownKeys(signatureDescriptors);
  if (
    signatureFields.some((field) => typeof field !== "string") ||
    JSON.stringify([...signatureFields].sort()) !==
      JSON.stringify(["algorithm", "keyId", "value"].sort()) ||
    Object.values(signatureDescriptors).some(
      (field) => !Object.hasOwn(field, "value") || field.enumerable !== true,
    ) ||
    descriptor.signature.algorithm !== "ed25519" ||
    typeof descriptor.signature.keyId !== "string" ||
    descriptor.signature.keyId.trim().length === 0 ||
    descriptor.signature.keyId.length > 128 ||
    typeof descriptor.signature.value !== "string" ||
    !isCanonicalEd25519Signature(descriptor.signature.value)
  ) {
    throw new FlowWeaverBundleRefusalError(
      "malformed-descriptor",
      "sealed bundle signature descriptor is malformed",
    );
  }
  return Object.freeze({
    ...descriptor,
    ...(deviceCapabilities === undefined ? {} : { deviceCapabilities }),
    signature: Object.freeze({ ...descriptor.signature }),
  });
}

function acceptDeviceCapabilities(
  input: unknown,
): readonly DeviceCapabilityRequirement[] {
  if (!Array.isArray(input) || input.length > 8) {
    throw malformedDeviceCapabilities();
  }
  const accepted = input.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      (Object.getPrototypeOf(entry) !== Object.prototype &&
        Object.getPrototypeOf(entry) !== null)
    ) {
      throw malformedDeviceCapabilities();
    }
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    const fields = Reflect.ownKeys(descriptors);
    const expected = [
      "id",
      "interfaceVersion",
      "applicationPolicyRefs",
      "modes",
      "credentialSlots",
    ].sort();
    if (
      fields.some((field) => typeof field !== "string") ||
      JSON.stringify([...fields].sort()) !== JSON.stringify(expected) ||
      Object.values(descriptors).some(
        (field) => !Object.hasOwn(field, "value") || field.enumerable !== true,
      )
    ) {
      throw malformedDeviceCapabilities();
    }
    const value = Object.fromEntries(
      Object.entries(descriptors).map(([name, field]) => [name, field.value]),
    ) as unknown as DeviceCapabilityRequirement;
    if (
      !boundedIdentifier(value.id) ||
      !Number.isSafeInteger(value.interfaceVersion) ||
      value.interfaceVersion < 1
    ) {
      throw malformedDeviceCapabilities();
    }
    return Object.freeze({
      id: value.id,
      interfaceVersion: value.interfaceVersion,
      applicationPolicyRefs: acceptSortedIdentifiers(
        value.applicationPolicyRefs,
      ),
      modes: acceptSortedIdentifiers(value.modes),
      credentialSlots: acceptSortedIdentifiers(value.credentialSlots),
    });
  });
  const keys = accepted.map(
    (entry) => `${entry.id}\u0000${String(entry.interfaceVersion)}`,
  );
  if (!strictlySortedUnique(keys)) throw malformedDeviceCapabilities();
  return Object.freeze(accepted);
}

function acceptSortedIdentifiers(input: unknown): readonly string[] {
  if (
    !Array.isArray(input) ||
    input.length > 16 ||
    input.some((value) => !boundedIdentifier(value)) ||
    !strictlySortedUnique(input as readonly string[])
  ) {
    throw malformedDeviceCapabilities();
  }
  return Object.freeze([...(input as readonly string[])]);
}

function boundedIdentifier(input: unknown): input is string {
  return (
    typeof input === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input) &&
    new TextEncoder().encode(input).byteLength <= 128
  );
}

function strictlySortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function malformedDeviceCapabilities(): FlowWeaverBundleRefusalError {
  return new FlowWeaverBundleRefusalError(
    "malformed-descriptor",
    "sealed bundle device capabilities are malformed or outside bounds",
  );
}

function isCanonicalEd25519Signature(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{86}$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === 64 && decoded.toString("base64url") === value;
}

export type FlowWeaverBundleRefusalCode =
  | "malformed-descriptor"
  | "wrong-bundle"
  | "invalid-signature"
  | "unverified-bundle"
  | "incompatible-engine"
  | "malformed-invocation"
  | "malformed-signal"
  | "incompatible-continuation"
  | "cancelled";

export class FlowWeaverBundleRefusalError extends Error {
  readonly name = "FlowWeaverBundleRefusalError";

  constructor(
    readonly code: FlowWeaverBundleRefusalCode,
    message: string,
  ) {
    super(message);
  }
}
