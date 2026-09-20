/**
 * The continuation format and the pieces of it a running workflow needs.
 *
 * This module is written to be inlined: `fw compile` copies its text into
 * every compiled file (see `src/api/inline-runtime.ts`), so it imports
 * nothing but the package version, uses no Node API, and leans on nothing
 * past ES2020. `continuation.ts` adds the graph-aware decoder on top for
 * the coordinator; that half stays in the package.
 */
import { VERSION } from "../generated-version.js";

/** The version of the engine that wrote a continuation: the package's own. */
export const ENGINE_VERSION: string = VERSION;
export const CONTINUATION_FORMAT_VERSION = 1 as const;
export const GENERATOR_ABI = "flow-weaver-generated-v2" as const;
export const MAX_CONTINUATION_BYTES = 1024 * 1024;
export const MAX_CONTINUATION_DEPTH = 32;
export const MAX_CONTINUATION_ENTRIES = 10_000;
export const MAX_CONTINUATION_STRING_BYTES = 256 * 1024;

export type DurableGateKind = "approval" | "input" | "agent";

export type WireValue =
  | null
  | boolean
  | number
  | string
  | readonly WireValue[]
  | { readonly [key: string]: WireValue };

export interface WorkflowFrameAddress {
  readonly workflowId: string;
  readonly invocation: number;
  readonly callerNodeId?: string;
  readonly callerExecutionIndex?: number;
}

export interface ScopeAddress {
  readonly parentNodeId: string;
  readonly parentExecutionIndex: number;
  readonly scopeName: string;
  readonly invocation: number;
  readonly loopIteration?: number;
  readonly branchArm?: string;
}

export interface BranchAddress {
  readonly workflowId: string;
  readonly frameDepth: number;
  readonly nodeId: string;
  readonly executionIndex: number;
  readonly arm: string;
}

export interface ExecutionAddress {
  readonly frames: readonly WorkflowFrameAddress[];
  readonly scopes: readonly ScopeAddress[];
  readonly branches: readonly BranchAddress[];
  readonly nodeId: string;
  readonly nodeType: string;
  readonly executionIndex: number;
}

export interface ContinuationVariable {
  readonly address: ExecutionAddress;
  readonly portName: string;
  readonly value: WireValue;
}

export interface EffectReceipt {
  readonly address: ExecutionAddress;
  readonly operationKey: string;
  readonly receipt: WireValue;
}

export interface ContinuationState {
  readonly completed: readonly ExecutionAddress[];
  readonly variables: readonly ContinuationVariable[];
  readonly nextBoundary: ExecutionAddress;
}

export interface DurableGate {
  readonly id: string;
  readonly kind: DurableGateKind;
  readonly address: ExecutionAddress;
  readonly payload: WireValue;
}

/** The branch arms a node sits under, as the compiled graph describes them. */
export type ContinuationGraphNodeBranchPath = readonly {
  readonly nodeId: string;
  readonly arm: string;
}[];

export interface ContinuationEnvelope {
  readonly formatVersion: typeof CONTINUATION_FORMAT_VERSION;
  readonly runId: string;
  readonly gateId: string;
  readonly gateKind: DurableGateKind;
  readonly workflowId: string;
  readonly bundleDigest: string;
  readonly graphFingerprint: string;
  readonly engineVersion: string;
  readonly generatorAbi: string;
  readonly location: ExecutionAddress;
  readonly state: ContinuationState;
  readonly receipts: readonly EffectReceipt[];
  readonly createdAt: string;
  readonly checksum: string;
}

declare const acceptedContinuationBrand: unique symbol;
export type AcceptedContinuationEnvelope = ContinuationEnvelope & {
  readonly [acceptedContinuationBrand]: true;
};

export type ContinuationRefusalReason =
  | "malformed"
  | "oversized"
  | "unsupported-format"
  | "incompatible-engine"
  | "incompatible-generator"
  | "wrong-workflow"
  | "wrong-bundle"
  | "wrong-graph"
  | "checksum-mismatch"
  | "stale-gate"
  | "wrong-run"
  | "ambiguous-effect";

export interface ContinuationRefusal {
  readonly accepted: false;
  readonly reason: ContinuationRefusalReason;
  readonly message: string;
}

export interface AcceptedContinuation {
  readonly accepted: true;
  readonly envelope: AcceptedContinuationEnvelope;
}

export type DecodedContinuation = AcceptedContinuation | ContinuationRefusal;

/** What a resume must match before an envelope is trusted. */
export interface ContinuationIdentity {
  readonly runId: string;
  readonly workflowId: string;
  /** When given, the envelope must be the one this gate answer belongs to. */
  readonly gateId?: string;
}

export const ENVELOPE_KEYS = [
  "formatVersion",
  "runId",
  "gateId",
  "gateKind",
  "workflowId",
  "bundleDigest",
  "graphFingerprint",
  "engineVersion",
  "generatorAbi",
  "location",
  "state",
  "receipts",
  "createdAt",
  "checksum",
] as const;

const acceptedContinuations = new WeakSet<object>();

// ---------------------------------------------------------------------------
// Hashing. A compiled file has no `node:crypto`, and Web Crypto only hashes
// asynchronously, while gate ids are needed synchronously in the middle of a
// run. This is SHA-256 from the specification, over UTF-8 bytes.
// ---------------------------------------------------------------------------

function utf8BytesOf(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index++;
      }
    }
    // A lone surrogate is not encodable; every UTF-8 encoder, Node's
    // included, writes the replacement character for it.
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

export function utf8ByteLength(text: string): number {
  return utf8BytesOf(text).length;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The SHA-256 of a string's UTF-8 bytes, as lowercase hex. */
export function sha256Hex(text: string): string {
  const bytes = utf8BytesOf(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // The length is a 64-bit big-endian integer; strings this long never occur,
  // so the high word is the floor of the division.
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push(
    (high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff,
    (low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff,
  );

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, "0")).join("");
}

// ---------------------------------------------------------------------------
// Wire values: what may cross a gate or live in a continuation.
// ---------------------------------------------------------------------------

export class WireValidationError extends Error {
  constructor(
    readonly reason: "malformed" | "oversized",
    message: string,
  ) {
    super(message);
    this.name = "WireValidationError";
  }
}

interface ValidationBudget {
  entries: number;
  bytes: number;
  readonly seen: Set<object>;
}

const ownKeyOf = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function assertWireValue(
  value: unknown,
  path: string,
  depth: number,
  budget: ValidationBudget,
): asserts value is WireValue {
  if (depth > MAX_CONTINUATION_DEPTH) {
    throw new WireValidationError("oversized", `${path} exceeds maximum depth`);
  }

  budget.entries++;
  if (budget.entries > MAX_CONTINUATION_ENTRIES) {
    throw new WireValidationError("oversized", "continuation exceeds aggregate entry limit");
  }

  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new WireValidationError("malformed", `${path} contains a non-finite number`);
    }
    return;
  }
  if (typeof value === "string") {
    const bytes = utf8ByteLength(value);
    if (bytes > MAX_CONTINUATION_STRING_BYTES) {
      throw new WireValidationError("oversized", `${path} exceeds maximum string size`);
    }
    budget.bytes += bytes;
    if (budget.bytes > MAX_CONTINUATION_BYTES) {
      throw new WireValidationError("oversized", "continuation exceeds maximum wire size");
    }
    return;
  }
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    throw new WireValidationError("malformed", `${path} is not a plain wire value`);
  }
  if (budget.seen.has(value)) {
    throw new WireValidationError("malformed", `${path} contains a cycle or repeated object`);
  }
  budget.seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new WireValidationError("malformed", `${path} contains a symbol property`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length") continue;
      if (!/^(0|[1-9]\d*)$/.test(key) || descriptor.get || descriptor.set || !descriptor.enumerable) {
        throw new WireValidationError("malformed", `${path} contains an accessor or property`);
      }
    }
    for (let index = 0; index < value.length; index++) {
      if (!ownKeyOf(descriptors, String(index))) {
        throw new WireValidationError("malformed", `${path} contains a sparse array`);
      }
      assertWireValue(descriptors[String(index)].value, `${path}[${index}]`, depth + 1, budget);
    }
    budget.seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WireValidationError("malformed", `${path} contains a class or host object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new WireValidationError("malformed", `${path} contains a symbol property`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new WireValidationError("malformed", `${path}.${key} is an accessor or non-enumerable property`);
    }
    const keyBytes = utf8ByteLength(key);
    if (keyBytes > MAX_CONTINUATION_STRING_BYTES) {
      throw new WireValidationError("oversized", `${path} contains an oversized key`);
    }
    budget.bytes += keyBytes;
    assertWireValue(descriptor.value, `${path}.${key}`, depth + 1, budget);
  }
  budget.seen.delete(value);
}

export function validateWireValue(value: unknown): asserts value is WireValue {
  assertWireValue(value, "$", 0, { entries: 0, bytes: 0, seen: new Set() });
}

function canonicalJson(value: WireValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as { readonly [key: string]: WireValue };
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function canonicalWireValue(value: unknown): string {
  validateWireValue(value);
  return canonicalJson(value);
}

export function cloneAndFreezeWireValue<T extends WireValue>(value: T): T {
  const cloned = JSON.parse(canonicalJson(value)) as T;
  const freeze = (entry: WireValue): void => {
    if (typeof entry !== "object" || entry === null) return;
    for (const child of Array.isArray(entry) ? entry : Object.values(entry)) {
      freeze(child);
    }
    Object.freeze(entry);
  };
  freeze(cloned);
  return cloned;
}

// ---------------------------------------------------------------------------
// Identity: addresses, gate ids, operation keys, checksums.
// ---------------------------------------------------------------------------

export function executionAddressKey(address: ExecutionAddress): string {
  return canonicalWireValue(address);
}

export function durableGateId(runId: string, kind: DurableGateKind, address: ExecutionAddress): string {
  return sha256Hex(`${runId}\0${kind}\0${executionAddressKey(address)}`);
}

export function operationKey(runId: string, address: ExecutionAddress): string {
  validateWireValue(address);
  return sha256Hex(`${runId}\0${canonicalJson(address as unknown as WireValue)}`);
}

function withoutChecksum(envelope: ContinuationEnvelope): WireValue {
  const { checksum: _checksum, ...unsigned } = envelope;
  return unsigned as unknown as WireValue;
}

export function continuationChecksum(envelope: ContinuationEnvelope): string {
  validateWireValue(withoutChecksum(envelope));
  return sha256Hex(canonicalJson(withoutChecksum(envelope)));
}

export function createContinuationEnvelope(
  fields: Omit<
    ContinuationEnvelope,
    "formatVersion" | "engineVersion" | "generatorAbi" | "createdAt" | "checksum"
  > & {
    readonly engineVersion?: string;
    readonly generatorAbi?: string;
    readonly createdAt?: string;
  },
): ContinuationEnvelope {
  const unsigned = {
    formatVersion: CONTINUATION_FORMAT_VERSION,
    runId: fields.runId,
    gateId: fields.gateId,
    gateKind: fields.gateKind,
    workflowId: fields.workflowId,
    bundleDigest: fields.bundleDigest,
    graphFingerprint: fields.graphFingerprint,
    engineVersion: fields.engineVersion ?? VERSION,
    generatorAbi: fields.generatorAbi ?? GENERATOR_ABI,
    location: fields.location,
    state: fields.state,
    receipts: fields.receipts,
    createdAt: fields.createdAt ?? new Date().toISOString(),
  } satisfies Omit<ContinuationEnvelope, "checksum">;
  validateWireValue(unsigned);
  const envelope = Object.assign({}, unsigned, { checksum: "" }) as ContinuationEnvelope;
  return { ...envelope, checksum: continuationChecksum(envelope) };
}

// ---------------------------------------------------------------------------
// Structure: is this JSON shaped like an envelope at all?
// ---------------------------------------------------------------------------

export function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactlyTheKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasRequiredAndOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => ownKeyOf(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFrameAddress(value: unknown): value is WorkflowFrameAddress {
  return (
    isPlainObjectRecord(value) &&
    hasRequiredAndOptionalKeys(value, ["workflowId", "invocation"], ["callerNodeId", "callerExecutionIndex"]) &&
    typeof value.workflowId === "string" &&
    value.workflowId.length > 0 &&
    isNonNegativeInteger(value.invocation) &&
    (value.callerNodeId === undefined || typeof value.callerNodeId === "string") &&
    (value.callerExecutionIndex === undefined || isNonNegativeInteger(value.callerExecutionIndex)) &&
    ((value.callerNodeId === undefined && value.callerExecutionIndex === undefined) ||
      (typeof value.callerNodeId === "string" && isNonNegativeInteger(value.callerExecutionIndex)))
  );
}

function isScopeAddress(value: unknown): value is ScopeAddress {
  return (
    isPlainObjectRecord(value) &&
    hasRequiredAndOptionalKeys(
      value,
      ["parentNodeId", "parentExecutionIndex", "scopeName", "invocation"],
      ["loopIteration", "branchArm"],
    ) &&
    typeof value.parentNodeId === "string" &&
    value.parentNodeId.length > 0 &&
    isNonNegativeInteger(value.parentExecutionIndex) &&
    typeof value.scopeName === "string" &&
    value.scopeName.length > 0 &&
    isNonNegativeInteger(value.invocation) &&
    (value.loopIteration === undefined || isNonNegativeInteger(value.loopIteration)) &&
    (value.branchArm === undefined || typeof value.branchArm === "string")
  );
}

export function isExecutionAddress(value: unknown): value is ExecutionAddress {
  return (
    isPlainObjectRecord(value) &&
    hasExactlyTheKeys(value, ["frames", "scopes", "branches", "nodeId", "nodeType", "executionIndex"]) &&
    Array.isArray(value.frames) &&
    value.frames.length > 0 &&
    value.frames.every(isFrameAddress) &&
    Array.isArray(value.scopes) &&
    value.scopes.every(isScopeAddress) &&
    Array.isArray(value.branches) &&
    value.branches.every(
      (branch) =>
        isPlainObjectRecord(branch) &&
        hasExactlyTheKeys(branch, ["workflowId", "frameDepth", "nodeId", "executionIndex", "arm"]) &&
        typeof branch.workflowId === "string" &&
        branch.workflowId.length > 0 &&
        isNonNegativeInteger(branch.frameDepth) &&
        typeof branch.nodeId === "string" &&
        branch.nodeId.length > 0 &&
        isNonNegativeInteger(branch.executionIndex) &&
        typeof branch.arm === "string" &&
        branch.arm.length > 0,
    ) &&
    typeof value.nodeId === "string" &&
    value.nodeId.length > 0 &&
    typeof value.nodeType === "string" &&
    value.nodeType.length > 0 &&
    isNonNegativeInteger(value.executionIndex)
  );
}

function isContinuationVariable(value: unknown): value is ContinuationVariable {
  return (
    isPlainObjectRecord(value) &&
    hasExactlyTheKeys(value, ["address", "portName", "value"]) &&
    isExecutionAddress(value.address) &&
    typeof value.portName === "string" &&
    value.portName.length > 0
  );
}

function isEffectReceipt(value: unknown): value is EffectReceipt {
  return (
    isPlainObjectRecord(value) &&
    hasExactlyTheKeys(value, ["address", "operationKey", "receipt"]) &&
    isExecutionAddress(value.address) &&
    typeof value.operationKey === "string" &&
    /^[0-9a-f]{64}$/.test(value.operationKey)
  );
}

function isContinuationState(value: unknown): value is ContinuationState {
  return (
    isPlainObjectRecord(value) &&
    hasExactlyTheKeys(value, ["completed", "variables", "nextBoundary"]) &&
    Array.isArray(value.completed) &&
    value.completed.every(isExecutionAddress) &&
    Array.isArray(value.variables) &&
    value.variables.every(isContinuationVariable) &&
    isExecutionAddress(value.nextBoundary)
  );
}

function isExactIsoUtc(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function structurallyValidEnvelope(value: unknown): value is ContinuationEnvelope {
  if (!isPlainObjectRecord(value) || !hasExactlyTheKeys(value, ENVELOPE_KEYS)) return false;
  return !(
    typeof value.formatVersion !== "number" ||
    typeof value.runId !== "string" ||
    typeof value.gateId !== "string" ||
    !["approval", "input", "agent"].includes(value.gateKind as string) ||
    typeof value.workflowId !== "string" ||
    typeof value.bundleDigest !== "string" ||
    typeof value.graphFingerprint !== "string" ||
    typeof value.engineVersion !== "string" ||
    typeof value.generatorAbi !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.checksum !== "string" ||
    value.runId.length === 0 ||
    !/^[0-9a-f]{64}$/.test(value.gateId) ||
    value.workflowId.length === 0 ||
    value.engineVersion.length === 0 ||
    value.generatorAbi.length === 0 ||
    !isExecutionAddress(value.location) ||
    !isContinuationState(value.state) ||
    !Array.isArray(value.receipts) ||
    !value.receipts.every(isEffectReceipt) ||
    !/^sha256:[0-9a-f]{64}$/.test(value.bundleDigest) ||
    !/^[0-9a-f]{64}$/.test(value.graphFingerprint) ||
    !/^[0-9a-f]{64}$/.test(value.checksum) ||
    !isExactIsoUtc(value.createdAt) ||
    executionAddressKey(value.location) !== executionAddressKey(value.state.nextBoundary)
  );
}

// ---------------------------------------------------------------------------
// Acceptance: the checks a host can make without the compiled graph.
// ---------------------------------------------------------------------------

/**
 * Take an envelope back from wherever a host kept it. It is parsed when given
 * as text, checked for shape, checksum, gate identity, engine and generator
 * versions, and bound to the run and workflow it is about to resume. What is
 * accepted is a frozen copy; the input is never trusted afterwards.
 *
 * This is what the compiled file offers a host of its own. The coordinator's
 * `decodeContinuation` does this and, having the compiled graph, more.
 */
export function acceptContinuation(input: unknown, identity: ContinuationIdentity): DecodedContinuation {
  let value: unknown = input;
  if (typeof input === "string") {
    if (utf8ByteLength(input) > MAX_CONTINUATION_BYTES) {
      return { accepted: false, reason: "oversized", message: "continuation exceeds maximum wire size" };
    }
    try {
      value = JSON.parse(input);
    } catch {
      return { accepted: false, reason: "malformed", message: "continuation is not valid JSON" };
    }
  }
  try {
    validateWireValue(value);
  } catch (error) {
    if (error instanceof WireValidationError) {
      return { accepted: false, reason: error.reason, message: error.message };
    }
    return { accepted: false, reason: "malformed", message: "continuation is not a wire value" };
  }
  if (!structurallyValidEnvelope(value)) {
    return { accepted: false, reason: "malformed", message: "continuation has missing, unknown, or invalid fields" };
  }
  if (value.formatVersion !== CONTINUATION_FORMAT_VERSION) {
    return { accepted: false, reason: "unsupported-format", message: `unsupported continuation format ${value.formatVersion}` };
  }
  if (continuationChecksum(value) !== value.checksum) {
    return { accepted: false, reason: "checksum-mismatch", message: "continuation checksum does not match" };
  }
  if (value.gateId !== durableGateId(value.runId, value.gateKind, value.location)) {
    return { accepted: false, reason: "malformed", message: "continuation gate identity does not match its execution address" };
  }
  if (value.engineVersion !== VERSION) {
    return { accepted: false, reason: "incompatible-engine", message: `continuation was written by engine ${value.engineVersion}, this is ${VERSION}` };
  }
  if (value.generatorAbi !== GENERATOR_ABI) {
    return { accepted: false, reason: "incompatible-generator", message: "continuation generator ABI does not match" };
  }
  if (value.runId !== identity.runId) {
    return { accepted: false, reason: "wrong-run", message: "continuation belongs to another run" };
  }
  if (value.workflowId !== identity.workflowId) {
    return { accepted: false, reason: "wrong-workflow", message: "continuation belongs to another workflow" };
  }
  if (identity.gateId !== undefined && value.gateId !== identity.gateId) {
    return { accepted: false, reason: "stale-gate", message: "continuation gate is stale or reordered" };
  }
  const accepted = cloneAndFreezeWireValue(value as unknown as WireValue) as unknown as AcceptedContinuationEnvelope;
  acceptedContinuations.add(accepted);
  return { accepted: true, envelope: accepted };
}

export function assertAcceptedContinuation(
  value: ContinuationEnvelope,
): asserts value is AcceptedContinuationEnvelope {
  if (!acceptedContinuations.has(value)) {
    throw new Error("ContinuationEnvelope must come from a successful decodeContinuation or acceptContinuation result");
  }
}
