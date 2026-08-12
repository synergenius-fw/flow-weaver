import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  acceptSealedFlowWeaverBundleDescriptor,
  sealedFlowWeaverBundleSignaturePreimage,
  verifySealedFlowWeaverBundle,
} from '../../src/sealed-bundle/index.js';

const signature = Buffer.alloc(64, 7).toString('base64url');
const bytes = new TextEncoder().encode('export default 1');
const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
const capability = { id: 'desktop-automation', interfaceVersion: 1, applicationPolicyRefs: ['phc'], modes: ['semantic'], credentialSlots: [] } as const;

function descriptor(formatVersion: 1 | 2 = 2) {
  return {
    formatVersion,
    bundleDigest: digest,
    byteLength: bytes.byteLength,
    engineVersion: '0.36.1',
    generatorAbi: 'flow-weaver-generated-v2',
    entryWorkflowId: 'invoiceDispatch',
    ...(formatVersion === 2 ? { deviceCapabilities: [capability] } : {}),
    signature: { algorithm: 'ed25519' as const, keyId: 'key-1', value: signature },
  };
}

describe('sealed bundle contract', () => {
  it('preserves v1 and signs canonical v2 capability requirements', () => {
    expect(new TextDecoder().decode(sealedFlowWeaverBundleSignaturePreimage(descriptor(1)))).toContain('flow-weaver-sealed-bundle-v1\n');
    expect(new TextDecoder().decode(sealedFlowWeaverBundleSignaturePreimage(descriptor()))).toBe(
      `flow-weaver-sealed-bundle-v2\n${JSON.stringify({ formatVersion: 2, bundleDigest: digest, byteLength: bytes.byteLength, engineVersion: '0.36.1', generatorAbi: 'flow-weaver-generated-v2', entryWorkflowId: 'invoiceDispatch', deviceCapabilities: [capability] })}`,
    );
  });

  it('rejects unknown fields and non-canonical capability ordering', () => {
    expect(() => acceptSealedFlowWeaverBundleDescriptor({ ...descriptor(), surprise: true })).toThrow(/missing or unknown|missing, unknown/);
    expect(() => acceptSealedFlowWeaverBundleDescriptor({ ...descriptor(), deviceCapabilities: [{ ...capability, modes: ['semantic', 'handoff'] }] })).toThrow(/device capabilities/);
  });

  it('verifies digest and signature without retaining caller-owned bytes', async () => {
    const verifyEd25519 = vi.fn(() => Promise.resolve(true));
    const verified = await verifySealedFlowWeaverBundle(descriptor(), bytes, { verifyEd25519 });
    const copy = verified.readBytes();
    copy[0] = 0;
    expect(verified.readBytes()[0]).toBe(bytes[0]);
    expect(verifyEd25519).toHaveBeenCalledOnce();
  });
});
