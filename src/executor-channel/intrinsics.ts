const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayNameGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;
const uint8ArraySet = Uint8Array.prototype.set;
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;

export function intrinsicUint8ArrayLength(input: unknown): number | undefined {
  if (
    typedArrayByteLengthGetter === undefined ||
    typedArrayNameGetter === undefined
  ) {
    return undefined;
  }
  try {
    if (typedArrayNameGetter.call(input) !== "Uint8Array") return undefined;
    const length = typedArrayByteLengthGetter.call(input) as unknown;
    return typeof length === "number" ? length : undefined;
  } catch {
    return undefined;
  }
}

export function copyIntrinsicUint8Array(
  input: unknown,
  byteLength: number,
): Uint8Array {
  const copy = new Uint8Array(byteLength);
  uint8ArraySet.call(copy, input as Uint8Array);
  return copy;
}

export function intrinsicAbortSignalState(input: unknown): boolean | undefined {
  if (abortSignalAbortedGetter === undefined) return undefined;
  try {
    const aborted = abortSignalAbortedGetter.call(input) as unknown;
    return typeof aborted === "boolean" ? aborted : undefined;
  } catch {
    return undefined;
  }
}
