import { createHash } from 'node:crypto';

export interface DeviceCapabilityRequirement {
  readonly id: string;
  readonly interfaceVersion: number;
  readonly applicationPolicyRefs: readonly string[];
  readonly modes: readonly string[];
  readonly credentialSlots: readonly string[];
}

interface BundleFields {
  readonly bundleDigest: `sha256:${string}`;
  readonly byteLength: number;
  readonly engineVersion: string;
  readonly generatorAbi: string;
  readonly entryWorkflowId: string;
  readonly signature: Readonly<{
    algorithm: 'ed25519';
    keyId: string;
    value: string;
  }>;
}

/** Stable public name. The format discriminant selects an exact wire codec. */
export type SealedFlowWeaverBundleDescriptor = Readonly<BundleFields & (
  | { readonly formatVersion: 1 }
  | { readonly formatVersion: 2; readonly deviceCapabilities: readonly DeviceCapabilityRequirement[] }
)>;

export interface SealedFlowWeaverBundleVerifier {
  verifyEd25519(request: Readonly<{ keyId: string; signature: string; preimage: Uint8Array }>, signal?: AbortSignal): Promise<boolean>;
}

export interface VerifiedFlowWeaverBundle {
  readonly descriptor: SealedFlowWeaverBundleDescriptor;
  readBytes(): Uint8Array;
}

export type FlowWeaverBundleRefusalCode =
  | 'malformed-descriptor'
  | 'wrong-bundle'
  | 'invalid-signature'
  | 'cancelled';

export class FlowWeaverBundleRefusalError extends Error {
  readonly name = 'FlowWeaverBundleRefusalError';
  constructor(readonly code: FlowWeaverBundleRefusalCode, message: string) { super(message); }
}

const encoder = new TextEncoder();

export function acceptDeviceCapabilityRequirements(input: unknown): readonly DeviceCapabilityRequirement[] {
  if (!Array.isArray(input) || input.length > 8) throw malformedCapabilities();
  const result = input.map((entry) => {
    const value = exactRecord(entry, ['id', 'interfaceVersion', 'applicationPolicyRefs', 'modes', 'credentialSlots'], malformedCapabilities);
    if (!identifier(value.id) || !Number.isSafeInteger(value.interfaceVersion) || (value.interfaceVersion as number) < 1) throw malformedCapabilities();
    return Object.freeze({
      id: value.id,
      interfaceVersion: value.interfaceVersion,
      applicationPolicyRefs: sortedIdentifiers(value.applicationPolicyRefs),
      modes: sortedIdentifiers(value.modes),
      credentialSlots: sortedIdentifiers(value.credentialSlots),
    }) as DeviceCapabilityRequirement;
  });
  const keys = result.map((entry) => `${entry.id}\u0000${entry.interfaceVersion}`);
  if (!sortedUnique(keys)) throw malformedCapabilities();
  return Object.freeze(result);
}

export function acceptSealedFlowWeaverBundleDescriptor(input: unknown): SealedFlowWeaverBundleDescriptor {
  const baseKeys = ['formatVersion', 'bundleDigest', 'byteLength', 'engineVersion', 'generatorAbi', 'entryWorkflowId', 'signature'];
  if (!plainRecord(input)) throw malformed('sealed bundle descriptor must be a plain object');
  const format = dataValue(input, 'formatVersion');
  const value = exactRecord(input, format === 2 ? [...baseKeys, 'deviceCapabilities'] : baseKeys, malformed);
  if ((format !== 1 && format !== 2)
    || typeof value.bundleDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.bundleDigest)
    || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) <= 0 || (value.byteLength as number) > 256 * 1024 * 1024
    || !boundedText(value.engineVersion, 128) || !boundedText(value.generatorAbi, 128) || !boundedText(value.entryWorkflowId, 256)) {
    throw malformed('sealed bundle descriptor is malformed or outside bounds');
  }
  const signature = exactRecord(value.signature, ['algorithm', 'keyId', 'value'], malformed);
  if (signature.algorithm !== 'ed25519' || !identifier(signature.keyId)
    || typeof signature.value !== 'string' || !canonicalEd25519(signature.value)) {
    throw malformed('sealed bundle signature descriptor is malformed');
  }
  const common = {
    bundleDigest: value.bundleDigest as `sha256:${string}`,
    byteLength: value.byteLength as number,
    engineVersion: value.engineVersion as string,
    generatorAbi: value.generatorAbi as string,
    entryWorkflowId: value.entryWorkflowId as string,
    signature: Object.freeze({ algorithm: 'ed25519' as const, keyId: signature.keyId as string, value: signature.value }),
  };
  return format === 1
    ? Object.freeze({ formatVersion: 1 as const, ...common })
    : Object.freeze({ formatVersion: 2 as const, ...common, deviceCapabilities: acceptDeviceCapabilityRequirements(value.deviceCapabilities) });
}

export function sealedFlowWeaverBundleSignaturePreimage(input: unknown): Uint8Array {
  const descriptor = acceptSealedFlowWeaverBundleDescriptor(input);
  const signed = descriptor.formatVersion === 1
    ? { formatVersion: 1, bundleDigest: descriptor.bundleDigest, byteLength: descriptor.byteLength, engineVersion: descriptor.engineVersion, generatorAbi: descriptor.generatorAbi, entryWorkflowId: descriptor.entryWorkflowId }
    : { formatVersion: 2, bundleDigest: descriptor.bundleDigest, byteLength: descriptor.byteLength, engineVersion: descriptor.engineVersion, generatorAbi: descriptor.generatorAbi, entryWorkflowId: descriptor.entryWorkflowId, deviceCapabilities: descriptor.deviceCapabilities };
  return encoder.encode(`flow-weaver-sealed-bundle-v${descriptor.formatVersion}\n${JSON.stringify(signed)}`);
}

export async function verifySealedFlowWeaverBundle(
  input: unknown,
  bytes: Uint8Array,
  verifier: SealedFlowWeaverBundleVerifier,
  signal?: AbortSignal,
): Promise<VerifiedFlowWeaverBundle> {
  const descriptor = acceptSealedFlowWeaverBundleDescriptor(input);
  if (signal?.aborted) throw new FlowWeaverBundleRefusalError('cancelled', 'bundle verification cancelled');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== descriptor.byteLength) {
    throw new FlowWeaverBundleRefusalError('wrong-bundle', 'sealed bundle byte length does not match its descriptor');
  }
  const retained = Uint8Array.from(bytes);
  const digest = `sha256:${createHash('sha256').update(retained).digest('hex')}`;
  if (digest !== descriptor.bundleDigest) throw new FlowWeaverBundleRefusalError('wrong-bundle', 'sealed bundle digest does not match its descriptor');
  const accepted = await verifier.verifyEd25519(Object.freeze({
    keyId: descriptor.signature.keyId,
    signature: descriptor.signature.value,
    preimage: sealedFlowWeaverBundleSignaturePreimage(descriptor),
  }), signal);
  if (accepted !== true) throw new FlowWeaverBundleRefusalError('invalid-signature', 'sealed bundle signature is not trusted');
  if (signal?.aborted) throw new FlowWeaverBundleRefusalError('cancelled', 'bundle verification cancelled');
  return Object.freeze({ descriptor, readBytes: () => Uint8Array.from(retained) });
}

function exactRecord(input: unknown, keys: readonly string[], error: (message?: string) => Error): Record<string, unknown> {
  if (!plainRecord(input)) throw error();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')
    || Object.values(descriptors).some((field) => !Object.hasOwn(field, 'value') || !field.enumerable)
    || JSON.stringify(Object.keys(descriptors).sort()) !== JSON.stringify([...keys].sort())) throw error();
  return Object.fromEntries(Object.entries(descriptors).map(([key, field]) => [key, field.value]));
}

function plainRecord(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== 'object') return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function dataValue(input: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(input, key);
  return field && Object.hasOwn(field, 'value') ? field.value : undefined;
}

function sortedIdentifiers(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length > 16 || input.some((item) => !identifier(item)) || !sortedUnique(input)) throw malformedCapabilities();
  return Object.freeze([...input]);
}

function identifier(input: unknown): input is string {
  return typeof input === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input) && encoder.encode(input).byteLength <= 128;
}
function boundedText(input: unknown, max: number): input is string { return typeof input === 'string' && input.trim().length > 0 && encoder.encode(input).byteLength <= max; }
function sortedUnique(values: readonly string[]): boolean { return values.every((value, index) => index === 0 || values[index - 1]! < value); }
function canonicalEd25519(input: string): boolean { const bytes = Buffer.from(input, 'base64url'); return /^[A-Za-z0-9_-]{86}$/.test(input) && bytes.byteLength === 64 && bytes.toString('base64url') === input; }
function malformed(message = 'sealed bundle descriptor has missing, unknown, accessor, or hidden fields'): FlowWeaverBundleRefusalError { return new FlowWeaverBundleRefusalError('malformed-descriptor', message); }
function malformedCapabilities(): FlowWeaverBundleRefusalError { return malformed('sealed bundle device capabilities are malformed or outside bounds'); }
