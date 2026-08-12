import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ExecutorSessionMachine,
  sealedFlowWeaverBundleSignaturePreimage,
  verifySealedFlowWeaverBundle,
  type ExecutorSessionIdentity,
  type SealedFlowWeaverBundleDescriptor,
} from "../../src/executor-channel/index.js";

const signature = Buffer.alloc(64, 7).toString("base64url");

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function descriptor(
  bytes: Uint8Array,
): SealedFlowWeaverBundleDescriptor {
  return {
    formatVersion: 2,
    bundleDigest: digest(bytes),
    byteLength: bytes.byteLength,
    engineVersion: "0.35.2",
    generatorAbi: "flow-weaver-generator-abi-v1",
    entryWorkflowId: "invoiceDispatch",
    deviceCapabilities: [
      {
        id: "desktop-automation",
        interfaceVersion: 1,
        applicationPolicyRefs: ["accounts-receivable"],
        modes: ["handoff", "semantic"],
        credentialSlots: [],
      },
    ],
    signature: { algorithm: "ed25519", keyId: "key-1", value: signature },
  };
}

function sessionIdentity(): ExecutorSessionIdentity {
  return {
    deploymentId: "deployment-1",
    consoleId: "console-1",
    executorId: "executor-1",
    generation: 1,
    connectionEpoch: 1,
    protocolVersion: 2,
    supportedInterfaceVersions: ["executor.generic:1"],
    supportedEngineRanges: ["^0.35.0"],
    supportedDeviceCapabilities: ["desktop-automation@1"],
    transportIdentityDigest: `sha256:${"a".repeat(64)}`,
    leaseExpiresAt: "2027-01-01T00:00:00.000Z",
  };
}

describe("device capability compatibility contracts", () => {
  it("uses the generation-2 signature domain and exact signed field order", async () => {
    const bytes = new TextEncoder().encode("export default 1");
    const sealed = descriptor(bytes);
    const verifyEd25519 = vi.fn(() => Promise.resolve(true));

    await expect(
      verifySealedFlowWeaverBundle(sealed, bytes, { verifyEd25519 }),
    ).resolves.toMatchObject({ descriptor: sealed });

    const preimage = new TextDecoder().decode(
      sealedFlowWeaverBundleSignaturePreimage(sealed),
    );
    expect(preimage).toBe(
      `flow-weaver-sealed-bundle-v2\n${JSON.stringify({
        formatVersion: 2,
        bundleDigest: sealed.bundleDigest,
        byteLength: sealed.byteLength,
        engineVersion: sealed.engineVersion,
        generatorAbi: sealed.generatorAbi,
        entryWorkflowId: sealed.entryWorkflowId,
        deviceCapabilities: sealed.deviceCapabilities,
      })}`,
    );
    expect(verifyEd25519).toHaveBeenCalledWith(
      expect.objectContaining({ preimage: expect.any(Uint8Array) }),
      undefined,
    );
  });

  it("keeps generation-1 descriptor bytes unchanged", () => {
    const bytes = new TextEncoder().encode("x");
    const sealed: SealedFlowWeaverBundleDescriptor = {
      formatVersion: 1,
      bundleDigest: digest(bytes),
      byteLength: 1,
      engineVersion: "0.35.2",
      generatorAbi: "flow-weaver-generator-abi-v1",
      entryWorkflowId: "one",
      signature: { algorithm: "ed25519", keyId: "key-1", value: signature },
    };
    expect(
      new TextDecoder().decode(
        sealedFlowWeaverBundleSignaturePreimage(sealed),
      ),
    ).toBe(
      `flow-weaver-sealed-bundle-v1\n${JSON.stringify({
        formatVersion: 1,
        bundleDigest: sealed.bundleDigest,
        byteLength: 1,
        engineVersion: "0.35.2",
        generatorAbi: "flow-weaver-generator-abi-v1",
        entryWorkflowId: "one",
      })}`,
    );
  });

  it("refuses non-canonical capability arrays", async () => {
    const bytes = new TextEncoder().encode("x");
    const sealed = descriptor(bytes);
    await expect(
      verifySealedFlowWeaverBundle(
        {
          ...sealed,
          deviceCapabilities: [
            { ...sealed.deviceCapabilities[0]!, modes: ["semantic", "handoff"] },
          ],
        },
        bytes,
        { verifyEd25519: () => Promise.resolve(true) },
      ),
    ).rejects.toMatchObject({ code: "malformed-descriptor" });
  });

  it("hydrates protocol 2 through the stable session identity API", () => {
    const identity = sessionIdentity();
    const machine = ExecutorSessionMachine.hydrate({
      formatVersion: 1,
      state: "authenticating",
      identity,
      reconciliationComplete: false,
    });
    expect(machine.identity).toEqual(identity);
  });

  it("does not let protocol 1 acquire device capabilities as an optional field", () => {
    expect(() =>
      ExecutorSessionMachine.hydrate({
        formatVersion: 1,
        state: "authenticating",
        identity: {
          ...sessionIdentity(),
          protocolVersion: 1,
        },
        reconciliationComplete: false,
      }),
    ).toThrow(/snapshot identity is malformed/);
  });
});
