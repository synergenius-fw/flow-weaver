import type { ExecutorChannelFrame } from "./wire.js";

export interface DurableAcknowledgementProof {
  readonly kind: "executor-channel-durable-acknowledgement";
}

const acknowledgementProofs = new WeakMap<
  object,
  {
    readonly frames: readonly ExecutorChannelFrame[];
    readonly owner: object | undefined;
  }
>();

export function issueDurableAcknowledgementProof(
  frames: readonly ExecutorChannelFrame[],
  owner: object | undefined,
): DurableAcknowledgementProof {
  const proof = Object.freeze({
    kind: "executor-channel-durable-acknowledgement" as const,
  });
  acknowledgementProofs.set(
    proof,
    Object.freeze({ frames: Object.freeze([...frames]), owner }),
  );
  return proof;
}

export function consumeDurableAcknowledgementProof(
  proof: DurableAcknowledgementProof,
  owner: object | undefined,
): {
  readonly frames: readonly ExecutorChannelFrame[];
  readonly owner: object | undefined;
} {
  const acknowledgement = acknowledgementProofs.get(proof);
  if (acknowledgement === undefined || acknowledgement.owner !== owner) {
    throw new Error(
      "durable acknowledgement proof was forged or already consumed",
    );
  }
  acknowledgementProofs.delete(proof);
  return acknowledgement;
}
