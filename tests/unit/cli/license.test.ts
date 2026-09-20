/**
 * The offline license gate behind licensed CLI builds.
 *
 * The pinned root key's private half never ships, so the success path signs
 * with an ephemeral Ed25519 keypair and verifies against its public half via
 * the `rootPublicKeyB64` seam. Everything else exercises the pinned key.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  enforceLicense,
  licenseModeEnabled,
  verifyLicenseKey,
  LicenseError,
  type LicenseClaim,
} from '../../../src/cli/license';

const NOW = new Date('2026-06-01T00:00:00Z');

function makeKeypair(): { privateKey: KeyObject; publicKeyB64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  // Raw 32-byte Ed25519 public key = the last 32 bytes of the SPKI DER.
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return { privateKey, publicKeyB64: spki.subarray(spki.length - 32).toString('base64') };
}

function envelope(claim: string, sig: string): string {
  return Buffer.from(JSON.stringify({ claim, sig }), 'utf8').toString('base64url');
}

function signClaim(privateKey: KeyObject, claim: string): string {
  return sign(null, Buffer.from(claim, 'utf8'), privateKey).toString('base64');
}

function makeLicense(
  privateKey: KeyObject,
  overrides: Partial<LicenseClaim> = {},
  claimText?: string,
): string {
  const claim =
    claimText ??
    JSON.stringify({
      product: 'flow-weaver',
      customer: 'Acme Ltd',
      issuedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
      ...overrides,
    });
  return envelope(claim, signClaim(privateKey, claim));
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['FW_LICENSE_MODE', 'FW_LICENSE', 'HOME', 'USERPROFILE'] as const;

let tmpDir: string;
let savedCwd: string;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  // Point every implicit search path (home, cwd) at an empty temp dir so a
  // license on the developer's machine cannot leak into the assertions.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-license-'));
  process.env.HOME = tmpDir;
  process.env.USERPROFILE = tmpDir;
  savedCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('licenseModeEnabled', () => {
  it('is off for the normal package', () => {
    expect(licenseModeEnabled()).toBe(false);
  });

  it('is on when FW_LICENSE_MODE=1', () => {
    process.env.FW_LICENSE_MODE = '1';
    expect(licenseModeEnabled()).toBe(true);
  });

  it('ignores other FW_LICENSE_MODE values', () => {
    process.env.FW_LICENSE_MODE = 'true';
    expect(licenseModeEnabled()).toBe(false);
  });
});

describe('verifyLicenseKey', () => {
  it('accepts a license signed by the root key and returns the claim', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const claim = verifyLicenseKey(makeLicense(privateKey), NOW, publicKeyB64);
    expect(claim).toEqual({
      product: 'flow-weaver',
      customer: 'Acme Ltd',
      issuedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
    });
  });

  it('rejects an empty key', () => {
    expect(() => verifyLicenseKey('', NOW)).toThrow(LicenseError);
    expect(() => verifyLicenseKey('', NOW)).toThrow(/empty/);
  });

  it('rejects a key that is not a base64url JSON envelope', () => {
    expect(() => verifyLicenseKey('not-a-license', NOW)).toThrow(/base64url JSON envelope/);
  });

  it('rejects an envelope without claim and sig strings', () => {
    const noSig = Buffer.from(JSON.stringify({ claim: '{}' }), 'utf8').toString('base64url');
    expect(() => verifyLicenseKey(noSig, NOW)).toThrow(/must carry \{ claim: string, sig: string \}/);
    const wrongTypes = Buffer.from(JSON.stringify({ claim: 1, sig: 2 }), 'utf8').toString('base64url');
    expect(() => verifyLicenseKey(wrongTypes, NOW)).toThrow(/must carry/);
  });

  it('rejects a signature from a different key', () => {
    const signer = makeKeypair();
    const other = makeKeypair();
    expect(() => verifyLicenseKey(makeLicense(signer.privateKey), NOW, other.publicKeyB64)).toThrow(
      /does not match the Synergenius root key/,
    );
  });

  it('rejects a claim that was altered after signing', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const claim = JSON.stringify({
      product: 'flow-weaver',
      customer: 'Acme Ltd',
      issuedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
    });
    const sig = signClaim(privateKey, claim);
    const tampered = envelope(claim.replace('Acme Ltd', 'Someone Else'), sig);
    expect(() => verifyLicenseKey(tampered, NOW, publicKeyB64)).toThrow(/does not match/);
  });

  it('rejects a well-signed claim that is not JSON', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const key = makeLicense(privateKey, {}, 'this is not json');
    expect(() => verifyLicenseKey(key, NOW, publicKeyB64)).toThrow(/claim is not valid JSON/);
  });

  it('rejects a claim missing a required field', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const claim = JSON.stringify({ product: 'flow-weaver', customer: 'Acme Ltd', issuedAt: '2026-01-01T00:00:00Z' });
    const key = envelope(claim, signClaim(privateKey, claim));
    expect(() => verifyLicenseKey(key, NOW, publicKeyB64)).toThrow(/must carry product, customer, issuedAt, expiresAt/);
  });

  it('rejects a license issued for another product', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const key = makeLicense(privateKey, { product: 'stitch' });
    expect(() => verifyLicenseKey(key, NOW, publicKeyB64)).toThrow(/is for "stitch", not "flow-weaver"/);
  });

  it('rejects an unparseable expiry', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const key = makeLicense(privateKey, { expiresAt: 'next year' });
    expect(() => verifyLicenseKey(key, NOW, publicKeyB64)).toThrow(/expiresAt is not a valid date/);
  });

  it('rejects an expired license, judged against the injected clock', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const key = makeLicense(privateKey, { expiresAt: '2026-05-31T23:59:59Z' });
    expect(() => verifyLicenseKey(key, NOW, publicKeyB64)).toThrow(/expired on 2026-05-31T23:59:59Z/);
    // The same license is fine a day earlier.
    expect(verifyLicenseKey(key, new Date('2026-05-30T00:00:00Z'), publicKeyB64).customer).toBe('Acme Ltd');
  });

  it('rejects a malformed root key rather than verifying against it', () => {
    const { privateKey } = makeKeypair();
    expect(() => verifyLicenseKey(makeLicense(privateKey), NOW, 'c2hvcnQ=')).toThrow(/root key is malformed/);
  });
});

describe('enforceLicense', () => {
  it('is a no-op for the normal package', () => {
    expect(enforceLicense(NOW)).toBeNull();
  });

  it('fails closed in a licensed build with no license file anywhere', () => {
    process.env.FW_LICENSE_MODE = '1';
    expect(() => enforceLicense(NOW)).toThrow(LicenseError);
    expect(() => enforceLicense(NOW)).toThrow(/No flow-weaver license found/);
  });

  it('reads the license from FW_LICENSE and returns the verified claim', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const file = path.join(tmpDir, 'acme.license');
    fs.writeFileSync(file, makeLicense(privateKey) + '\n');
    process.env.FW_LICENSE_MODE = '1';
    process.env.FW_LICENSE = file;
    expect(enforceLicense(NOW, publicKeyB64)?.customer).toBe('Acme Ltd');
  });

  it('finds a license in <home>/.synergenius/flow-weaver.license', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    fs.mkdirSync(path.join(tmpDir, '.synergenius'));
    fs.writeFileSync(path.join(tmpDir, '.synergenius', 'flow-weaver.license'), makeLicense(privateKey));
    process.env.FW_LICENSE_MODE = '1';
    expect(enforceLicense(NOW, publicKeyB64)?.product).toBe('flow-weaver');
  });

  it('finds license.synergenius.json in the working directory', () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    fs.writeFileSync(path.join(tmpDir, 'license.synergenius.json'), makeLicense(privateKey));
    process.env.FW_LICENSE_MODE = '1';
    expect(enforceLicense(NOW, publicKeyB64)?.customer).toBe('Acme Ltd');
  });

  it('still fails closed when the file it finds is invalid', () => {
    process.env.FW_LICENSE_MODE = '1';
    process.env.FW_LICENSE = path.join(tmpDir, 'bad.license');
    fs.writeFileSync(process.env.FW_LICENSE, 'garbage');
    expect(() => enforceLicense(NOW)).toThrow(/base64url JSON envelope/);
  });
});
